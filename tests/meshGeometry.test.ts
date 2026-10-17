import { describe, expect, it } from 'vitest';
import {
  areaWeightedPca,
  buildEdges,
  fitPlane,
  intersectPlane,
  meshTopology,
  partitionFaces,
  signedVolume,
  surfaceArea,
  vertexPca,
  type Polyline,
} from '../src/compute/meshGeometry';
import type { Vec3 } from '../src/core/types';
import { box, merge, moved, sphere, type Mesh } from './meshes';

const polyLength = (p: Polyline): number => {
  let l = 0;
  const n = p.points.length;
  for (let i = 1; i < n + (p.closed ? 1 : 0); i++) {
    const a = p.points[i - 1], b = p.points[i % n];
    l += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }
  return l;
};

const parallel = (a: Vec3, b: Vec3): number => Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);

describe('area and volume', () => {
  it('match a box, a sphere and an open box', () => {
    const b = box([6, 4, 2], 4);
    expect(surfaceArea(b.positions, b.index)).toBeCloseTo(88, 9);
    expect(signedVolume(b.positions, b.index)).toBeCloseTo(48, 9);
    // translation changes nothing
    const far = moved(b, [1000, -2000, 500]);
    expect(surfaceArea(far.positions, far.index)).toBeCloseTo(88, 3);
    expect(signedVolume(far.positions, far.index)).toBeCloseTo(48, 2);

    const s = sphere(2, 4);
    expect(surfaceArea(s.positions, s.index) / (16 * Math.PI)).toBeCloseTo(1, 2);
    expect(signedVolume(s.positions, s.index) / ((32 / 3) * Math.PI)).toBeCloseTo(1, 2);

    const open = box([2, 2, 2], 4, ['+x']);
    expect(surfaceArea(open.positions, open.index)).toBeCloseTo(20, 9);
  });
});

describe('topology', () => {
  it('tells closed meshes from open, split and non-manifold ones', () => {
    const b = box([2, 2, 2], 4);
    const vc = (m: Mesh) => m.positions.length / 3;
    expect(meshTopology(b.index, vc(b))).toEqual({ boundaryEdges: 0, boundaryLoops: 0, nonManifoldEdges: 0, components: 1, closed: true });
    const s = sphere(1, 2);
    expect(meshTopology(s.index, vc(s)).closed).toBe(true);

    const open = box([2, 2, 2], 4, ['+x']);
    expect(meshTopology(open.index, vc(open))).toEqual({ boundaryEdges: 16, boundaryLoops: 1, nonManifoldEdges: 0, components: 1, closed: false });
    const tube = box([2, 2, 2], 4, ['+x', '-x']);
    expect(meshTopology(tube.index, vc(tube))).toMatchObject({ boundaryEdges: 32, boundaryLoops: 2, closed: false });

    const two = merge(b, moved(b, [5, 0, 0]));
    expect(meshTopology(two.index, vc(two))).toMatchObject({ components: 2, closed: true });

    // a fin on one edge of the box: that edge has three triangles
    const edges = buildEdges(b.index, vc(b));
    const e = 0;
    const fin: Mesh = {
      positions: new Float32Array([...b.positions, 9, 9, 9]),
      index: new Uint32Array([...b.index, edges.v0[e], edges.v1[e], vc(b)]),
    };
    expect(meshTopology(fin.index, vc(fin))).toEqual({ boundaryEdges: 2, boundaryLoops: 1, nonManifoldEdges: 1, components: 1, closed: false });
  });
});

describe('principal axes', () => {
  it('finds the axes of a box from its surface, rotated and far from the origin', () => {
    const [a, b, c] = [6, 4, 2];
    const area = 2 * (a * b + b * c + c * a);
    // uniform on the surface: faces across an axis sit at ±half, the other four spread evenly
    const variance = (u: number, v: number, w: number) => (2 * v * w * (u / 2) ** 2 + (2 * u * w + 2 * u * v) * (u * u) / 12) / area;
    const expected = [variance(a, b, c), variance(b, a, c), variance(c, a, b)];

    const rot = (p: Vec3): Vec3 => {
      // 30° about z, then 50° about x
      const [cz, sz, cx, sx] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), Math.cos((5 * Math.PI) / 18), Math.sin((5 * Math.PI) / 18)];
      const q: Vec3 = [cz * p[0] - sz * p[1], sz * p[0] + cz * p[1], p[2]];
      return [q[0], cx * q[1] - sx * q[2], sx * q[1] + cx * q[2]];
    };
    const centre: Vec3 = [1000, -2000, 500];
    const m = box([a, b, c], 4);
    const pos = new Float64Array(m.positions.length);
    for (let i = 0; i < pos.length; i += 3) {
      const r = rot([m.positions[i], m.positions[i + 1], m.positions[i + 2]]);
      for (let k = 0; k < 3; k++) pos[i + k] = r[k] + centre[k];
    }
    const pca = areaWeightedPca(pos, m.index);
    pca.mean.forEach((x, k) => expect(x).toBeCloseTo(centre[k], 6));
    pca.variances.forEach((v, k) => expect(v).toBeCloseTo(expected[k], 6));
    const axes: Vec3[] = [rot([1, 0, 0]), rot([0, 1, 0]), rot([0, 0, 1])];
    pca.axes.forEach((ax, k) => expect(parallel(ax, axes[k])).toBeCloseTo(1, 9));
  });

  it('weights every vertex equally in the vertex PCA', () => {
    const corners = box([6, 4, 2], 1);
    const pca = vertexPca(corners.positions);
    expect(pca.mean.map((x) => x + 0)).toEqual([0, 0, 0]);
    pca.variances.forEach((v, k) => expect(v).toBeCloseTo([9, 4, 1][k], 9));
    pca.axes.forEach((ax, k) => expect(parallel(ax, [[1, 0, 0], [0, 1, 0], [0, 0, 1]][k] as Vec3)).toBeCloseTo(1, 9));
    // a densely sampled end pulls the vertex mean, not the surface mean
    const dense = merge(box([2, 2, 2], 8, ['-x']), box([2, 2, 2], 1, ['+x', '-y', '+y', '-z', '+z']));
    expect(vertexPca(dense.positions).mean[0]).toBeGreaterThan(0.05);
  });
});

describe('plane fitting', () => {
  it('recovers a tilted plane from noisy points', () => {
    const n: Vec3 = [-0.3, 0.2, 1];
    const len = Math.hypot(...n);
    const unit: Vec3 = [n[0] / len, n[1] / len, n[2] / len];
    const pts: Vec3[] = [];
    let k = 0;
    for (let i = -5; i <= 5; i++)
      for (let j = -5; j <= 5; j++) {
        const x = 300 + i, y = -40 + j;
        const z = 0.3 * (x - 300) - 0.2 * (y + 40) + 12;
        const e = (k++ % 2 ? 1 : -1) * 0.01; // ± 0.01 along the normal
        pts.push([x + e * unit[0], y + e * unit[1], z + e * unit[2]]);
      }
    const plane = fitPlane(pts)!;
    expect(parallel(plane.normal, unit)).toBeCloseTo(1, 9);
    expect(plane.rms).toBeCloseTo(0.01, 4);
    plane.centroid.forEach((x, i) => expect(x).toBeCloseTo([300, -40, 12][i], 3));
  });

  it('needs three points and reports collinear ones through the in-plane variance', () => {
    expect(fitPlane([[0, 0, 0], [1, 1, 1]])).toBeNull();
    const line = fitPlane([[0, 0, 0], [1, 1, 1], [2, 2, 2], [3, 3, 3]])!;
    expect(line.variances[1]).toBeCloseTo(0, 12);
    expect(fitPlane(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))!.normal.map(Math.abs)).toEqual([0, 0, 1]);
  });
});

describe('plane sections', () => {
  it('cuts a box into one closed loop, also through vertices', () => {
    const b = box([2, 2, 2], 4);
    for (const z of [0.3, 0]) {
      const loops = intersectPlane(b.positions, b.index, [0, 0, z], [0, 0, 1]);
      expect(loops).toHaveLength(1);
      expect(loops[0].closed).toBe(true);
      expect(polyLength(loops[0])).toBeCloseTo(8, 6);
      for (const p of loops[0].points) expect(p[2]).toBeCloseTo(z, 6);
    }
    expect(intersectPlane(b.positions, b.index, [0, 0, 5], [0, 0, 1])).toEqual([]);
  });

  it('gives a circle through a sphere, open lines on open meshes, and one loop per piece', () => {
    const s = sphere(3, 4);
    const tilted: Vec3 = [0.2, -0.4, 1];
    const loops = intersectPlane(s.positions, s.index, [0, 0, 0], tilted);
    expect(loops).toHaveLength(1);
    expect(polyLength(loops[0]) / (6 * Math.PI)).toBeCloseTo(1, 2);

    const open = box([2, 2, 2], 4, ['+x']);
    const cut = intersectPlane(open.positions, open.index, [0, 0, 0.3], [0, 0, 1]);
    expect(cut).toHaveLength(1);
    expect(cut[0].closed).toBe(false);
    expect(polyLength(cut[0])).toBeCloseTo(6, 6);
    const ends = [cut[0].points[0], cut[0].points[cut[0].points.length - 1]];
    for (const p of ends) expect(p[0]).toBeCloseTo(1, 6);

    const two = merge(box([2, 2, 2], 4), moved(box([2, 2, 2], 4), [5, 0, 0]));
    expect(intersectPlane(two.positions, two.index, [0, 0, 0.3], [0, 0, 1]).map((l) => l.closed)).toEqual([true, true]);
  });
});

describe('face partitions', () => {
  it('splits a box along a ring of edges into two halves', () => {
    const b = box([2, 2, 2], 4);
    const vc = b.positions.length / 3;
    const edges = buildEdges(b.index, vc);
    const z = (v: number) => b.positions[3 * v + 2];
    const ring: number[] = [];
    for (let e = 0; e < edges.v0.length; e++) if (z(edges.v0[e]) === 0 && z(edges.v1[e]) === 0) ring.push(edges.v0[e], edges.v1[e]);
    expect(ring.length / 2).toBe(16);

    const split = partitionFaces(b.index, vc, ring, edges);
    expect(split.count).toBe(2);
    const areas = [0, 0];
    for (let t = 0; t < split.region.length; t++) {
      const tri = new Uint32Array([b.index[3 * t], b.index[3 * t + 1], b.index[3 * t + 2]]);
      areas[split.region[t]] += surfaceArea(b.positions, tri);
    }
    expect(areas[0]).toBeCloseTo(12, 9);
    expect(areas[1]).toBeCloseTo(12, 9);

    // a ring with a gap does not separate anything; pairs that are not edges are ignored
    expect(partitionFaces(b.index, vc, ring.slice(2), edges).count).toBe(1);
    expect(partitionFaces(b.index, vc, [0, 0, 1, 1], edges).count).toBe(1);
    expect(partitionFaces(b.index, vc, []).count).toBe(1);
  });
});

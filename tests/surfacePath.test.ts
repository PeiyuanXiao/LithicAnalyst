import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildAdjacency, meanCurvature, robustAbsRange, type Adjacency } from '../src/compute/curvature';
import { featureCost, featureStrength, PathSearch, pathMobility, relaxPath, snapToFeature, type SnapMode, type SurfaceProjector } from '../src/compute/surfacePath';

/** Regular grid of (nx+1)×(ny+1) vertices, triangles wound so normals face +z for z = f(x, y). */
function gridMesh(nx: number, ny: number, step: number, f: (x: number, y: number) => number) {
  const pos: number[] = [];
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) {
      const x = (i - nx / 2) * step;
      const y = j * step;
      pos.push(x, y, f(x, y));
    }
  const id = (i: number, j: number) => j * (nx + 1) + i;
  const idx: number[] = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      idx.push(id(i, j), id(i + 1, j), id(i + 1, j + 1));
      idx.push(id(i, j), id(i + 1, j + 1), id(i, j + 1));
    }
  const positions = new Float32Array(pos);
  const index = new Uint32Array(idx);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeVertexNormals();
  const normals = g.getAttribute('normal').array as Float32Array;
  const adj = buildAdjacency(index, positions.length / 3);
  const vertexAt = (x: number, y: number) => {
    let best = 0;
    let bd = Infinity;
    for (let v = 0; v < positions.length / 3; v++) {
      const d = Math.hypot(positions[3 * v] - x, positions[3 * v + 1] - y);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  };
  return { positions, index, normals, adj, vertexAt, nx, ny };
}

/** Reference Dijkstra (O(V²)) for checking PathSearch. */
function bruteForce(positions: Float32Array, adj: Adjacency, seed: number, cost: Float32Array | null): Float64Array {
  const n = adj.offsets.length - 1;
  const dist = new Float64Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  dist[seed] = 0;
  for (;;) {
    let u = -1;
    for (let v = 0; v < n; v++) if (!done[v] && dist[v] < Infinity && (u < 0 || dist[v] < dist[u])) u = v;
    if (u < 0) break;
    done[u] = 1;
    for (let e = adj.offsets[u]; e < adj.offsets[u + 1]; e++) {
      const v = adj.neighbors[e];
      const len = Math.hypot(positions[3 * v] - positions[3 * u], positions[3 * v + 1] - positions[3 * u + 1], positions[3 * v + 2] - positions[3 * u + 2]);
      const w = cost ? len * 0.5 * (cost[u] + cost[v]) : len;
      if (dist[u] + w < dist[v]) dist[v] = dist[u] + w;
    }
  }
  return dist;
}

const crest = (y: number) => 6 * Math.sin(y / 8);
/** A sharp roof whose crest meanders (x = crest(y)); `sign` −1 turns it into a valley. */
const roof = (sign: 1 | -1) => (x: number, y: number) => sign * (10 - 0.9 * Math.abs(x - crest(y)));

async function featureField(m: ReturnType<typeof gridMesh>, mode: SnapMode) {
  const k = await meanCurvature(m.positions, m.normals, m.adj, 1);
  const strength = featureStrength(k, robustAbsRange(k, 0.96), mode);
  return { k, strength, cost: featureCost(strength) };
}

function pathOffCrest(m: ReturnType<typeof gridMesh>, chain: Uint32Array): number {
  let worst = 0;
  for (const v of chain) worst = Math.max(worst, Math.abs(m.positions[3 * v] - crest(m.positions[3 * v + 1])));
  return worst;
}

describe('PathSearch', () => {
  it('matches a reference Dijkstra, with and without a cost field', () => {
    const m = gridMesh(14, 12, 1, (x, y) => 0.3 * Math.sin(x) * Math.cos(y / 2));
    const n = m.positions.length / 3;
    const cost = new Float32Array(n).map((_, i) => 0.1 + ((i * 7919) % 97) / 97);
    const search = new PathSearch(m.positions, m.adj);
    for (const field of [null, cost]) {
      for (const seed of [0, 37, n - 1]) {
        const ref = bruteForce(m.positions, m.adj, seed, field);
        search.start(seed, field);
        for (const target of [5, 60, 111, n - 3]) {
          expect(search.reach(target)).toBe(true);
          expect(search.distanceTo(target)).toBeCloseTo(ref[target], 6);
          const chain = search.path(target)!;
          expect(chain[0]).toBe(seed);
          expect(chain[chain.length - 1]).toBe(target);
          // consecutive vertices are mesh neighbours
          for (let i = 1; i < chain.length; i++) {
            const a = chain[i - 1];
            const nb = Array.from(m.adj.neighbors.subarray(m.adj.offsets[a], m.adj.offsets[a + 1]));
            expect(nb).toContain(chain[i]);
          }
        }
      }
    }
  });

  it('can be expanded in small steps and reports unreachable targets', () => {
    const m = gridMesh(10, 10, 1, () => 0);
    const search = new PathSearch(m.positions, m.adj);
    search.start(0, null);
    const far = m.positions.length / 3 - 1;
    let calls = 0;
    while (!search.reach(far, 7)) calls++;
    expect(calls).toBeGreaterThan(5);
    expect(search.distanceTo(far)).toBeCloseTo(Math.SQRT2 * 10, 5);

    // two separate triangles
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 0, 6, 5, 0, 5, 6, 0]);
    const adj = buildAdjacency(new Uint32Array([0, 1, 2, 3, 4, 5]), 6);
    const s2 = new PathSearch(pos, adj);
    s2.start(0, null);
    expect(s2.reach(4)).toBe(false);
    expect(s2.unreachable(4)).toBe(true);
    expect(s2.path(4)).toBeNull();
    expect(s2.path(2)!.length).toBe(2);
  });
});

describe('ridge and valley tracing', () => {
  it('follows a meandering ridge that the shortest path cuts across', async () => {
    const m = gridMesh(60, 100, 0.4, roof(1));
    const { cost, strength } = await featureField(m, 'ridge');
    const a = m.vertexAt(crest(4), 4);
    const b = m.vertexAt(crest(34), 34);
    const search = new PathSearch(m.positions, m.adj);

    search.start(a, null);
    search.reach(b);
    const straight = search.path(b)!;
    expect(pathOffCrest(m, straight)).toBeGreaterThan(2);

    search.start(a, cost);
    search.reach(b);
    const traced = search.path(b)!;
    expect(pathOffCrest(m, traced)).toBeLessThan(0.45);
    const mean = Array.from(traced).reduce((s, v) => s + strength[v], 0) / traced.length;
    expect(mean).toBeGreaterThan(0.6);
  });

  it('follows a valley in valley mode and ignores it in ridge mode', async () => {
    const m = gridMesh(60, 100, 0.4, roof(-1));
    const valley = await featureField(m, 'valley');
    const ridge = await featureField(m, 'ridge');
    const a = m.vertexAt(crest(4), 4);
    const b = m.vertexAt(crest(34), 34);
    const search = new PathSearch(m.positions, m.adj);
    search.start(a, valley.cost);
    search.reach(b);
    const traced = search.path(b)!;
    expect(pathOffCrest(m, traced)).toBeLessThan(0.45);
    // the valley floor has no ridge strength at all
    for (const v of traced) expect(ridge.strength[v]).toBe(0);
  });

  it('snaps a nearby click onto the ridge and leaves distant clicks alone', async () => {
    const m = gridMesh(60, 100, 0.4, roof(1));
    const { strength } = await featureField(m, 'ridge');
    for (const side of [1.6, -1.6, 0.6]) {
      const off = m.vertexAt(crest(20) + side, 20);
      const snapped = snapToFeature(off, 3, strength, m.positions, m.adj);
      expect(Math.abs(m.positions[3 * snapped] - crest(m.positions[3 * snapped + 1]))).toBeLessThan(0.3);
      expect(Math.abs(m.positions[3 * snapped + 1] - 20)).toBeLessThan(1.5);
    }
    const far = m.vertexAt(crest(20) + 1.6, 20);
    expect(snapToFeature(far, 0.5, strength, m.positions, m.adj)).toBe(far);
    expect(featureStrength(strength, 1, 'off').every((v) => v === 0)).toBe(true);
  });
});

/** Unit sphere as a projector (normal = position). */
const sphere: SurfaceProjector = {
  closest(p, out, normal) {
    const r = Math.hypot(p[0], p[1], p[2]);
    if (!(r > 0)) return false;
    for (let k = 0; k < 3; k++) out[k] = normal[k] = p[k] / r;
    return true;
  },
};

const plane: SurfaceProjector = {
  closest(p, out, normal) {
    out[0] = p[0];
    out[1] = p[1];
    out[2] = 0;
    normal[0] = 0;
    normal[1] = 0;
    normal[2] = 1;
    return true;
  },
};

function polyLength(pts: Float64Array): number {
  let L = 0;
  for (let i = 3; i < pts.length; i += 3) L += Math.hypot(pts[i] - pts[i - 3], pts[i + 1] - pts[i - 2], pts[i + 2] - pts[i - 1]);
  return L;
}

describe('pulling traced paths taut', () => {
  it('straightens a staircase on a plane and keeps its ends', () => {
    // staircase from (0,0) to (8,8) along grid edges
    const xy: Array<[number, number]> = [[0, 0]];
    for (let i = 0; i < 8; i++) xy.push([i + 1, i], [i + 1, i + 1]);
    const pts = new Float64Array(xy.flatMap(([x, y]) => [x, y, 0]));
    const nor = new Float64Array(xy.flatMap(() => [0, 0, 1]));
    expect(polyLength(pts)).toBeCloseTo(16, 6);
    relaxPath(pts, nor, null, plane);
    // the zig-zag is gone (length of the straight line), what is left is a smooth offset of under half an edge
    expect(polyLength(pts)).toBeLessThan(8 * Math.SQRT2 * 1.01);
    expect([pts[0], pts[1]]).toEqual([0, 0]);
    expect([pts[pts.length - 3], pts[pts.length - 2]]).toEqual([8, 8]);
    const dev = (i: number) => pts[3 * i] - pts[3 * i + 1];
    for (let i = 1; i < xy.length - 1; i++) {
      expect(Math.abs(dev(i))).toBeLessThanOrEqual(0.5 + 1e-9);
      expect(Math.abs(dev(i) - 0.5 * (dev(i - 1) + dev(i + 1)))).toBeLessThan(0.08);
    }
  });

  it('approaches the great circle on a sphere and stays on it', () => {
    // a detour from (1,0,0) to (0,1,0) via the north pole region
    const n = 40;
    const pts = new Float64Array(3 * n);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x = Math.cos((t * Math.PI) / 2), y = Math.sin((t * Math.PI) / 2), z = 0.8 * Math.sin(t * Math.PI);
      const r = Math.hypot(x, y, z);
      pts.set([x / r, y / r, z / r], 3 * i);
    }
    const nor = pts.slice();
    const before = polyLength(pts);
    relaxPath(pts, nor, null, sphere, 3000);
    const after = polyLength(pts);
    // given time, the detour flattens toward the great circle (length π/2), always on the sphere
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThan(Math.PI / 2 + 0.03);
    for (let i = 0; i < n; i++) expect(Math.hypot(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2])).toBeCloseTo(1, 9);
  });

  it('holds points with zero mobility and refuses to flip onto a facing sheet', () => {
    const xy: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]];
    const pts = new Float64Array(xy.flatMap(([x, y]) => [x, y, 0]));
    const nor = new Float64Array(xy.flatMap(() => [0, 0, 1]));
    const fixed = pts.slice();
    relaxPath(pts, nor, new Float32Array(5), plane, 10);
    expect(Array.from(pts)).toEqual(Array.from(fixed));
    const flipped: SurfaceProjector = { closest: (p, out, normal) => plane.closest(p, out, normal) && ((normal[2] = -1), true) };
    relaxPath(pts, nor, null, flipped, 10);
    expect(Array.from(pts)).toEqual(Array.from(fixed));
  });

  it('gives crest points little room to move', () => {
    const strength = new Float32Array([0, 0.95, 0.2]);
    const m = pathMobility([0, 1, 2], strength);
    expect(m[0]).toBeCloseTo(1, 6);
    expect(m[1]).toBeLessThan(0.15);
    expect(m[2]).toBeGreaterThan(0.6);
    expect(Array.from(pathMobility([0, 1], null))).toEqual([1, 1]);
  });
});

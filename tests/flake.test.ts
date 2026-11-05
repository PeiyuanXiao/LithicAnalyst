import { describe, expect, it } from 'vitest';
import { convexHull } from '../src/compute/convexHull';
import { emptyFlakeMeasures, FLAKE_PARAMETERS, flakeMeasures, FLAKE_MEASURES, morphDimensions, morphTechAngle, type FlakeMeasure, type FlakeMeasures, type FlakeResult } from '../src/compute/flake';
import { buildEdges } from '../src/compute/meshGeometry';
import { crossSectionAt, lineNear, sectionByPlane } from '../src/compute/meshSection';
import { regionPlane } from '../src/compute/planes';
import { regionPath } from '../src/compute/regionPath';
import { polylineEdges, regionsSteps, smallerPieceSteps } from '../src/compute/regions';
import { runSync } from '../src/compute/steps';
import { techAngleDeg, technicalFrame, MIN_AXIS_EDGES } from '../src/compute/technicalFrame';
import { frameAxes, frameMatrix, type FrameAxes } from '../src/core/frame';
import type { Vec3 } from '../src/core/types';
import { box, cylinderPatch, ellipsoid, flakeT1, flakeT2, flakeT6, mapped, rigid, T1, T6, t6Zv, type Mesh } from './meshes';

const deg = (r: number) => (r * 180) / Math.PI;
const IPA = 180 - deg(Math.atan(10 / 2));
const EPA = deg(Math.acos((2 * 62 + 10 * 10) / (Math.hypot(2, 10) * Math.hypot(62, 10))));
const closeTo = (v: number | null, want: number, tol: number) => {
  expect(v).not.toBeNull();
  expect(Math.abs(v! - want)).toBeLessThanOrEqual(tol);
};

const meanEdge = (m: Mesh): number => {
  const e = buildEdges(m.index, m.positions.length / 3);
  let s = 0;
  for (let i = 0; i < e.v0.length; i++) {
    const a = 3 * e.v0[i], b = 3 * e.v1[i];
    s += Math.hypot(m.positions[a] - m.positions[b], m.positions[a + 1] - m.positions[b + 1], m.positions[a + 2] - m.positions[b + 2]);
  }
  return s / e.v0.length;
};

/** The triangles of T1's platform (the P–E face), and their area. */
function platformOf(m: Mesh, f: (p: Vec3) => Vec3 = (p) => p): { faces: Uint32Array; area: number } {
  // the plane of the platform and the ends of the strip, moved with the mesh
  const a = f(T1.P), b = f(T1.E), c = f(T1.ends[1]);
  const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n);
  const onPlane = (w: number) => Math.abs((m.positions[3 * w] - a[0]) * n[0] + (m.positions[3 * w + 1] - a[1]) * n[1] + (m.positions[3 * w + 2] - a[2]) * n[2]) / l < 1e-3;
  const faces: number[] = [];
  let area = 0;
  for (let t = 0; t < m.index.length / 3; t++) {
    const [x, y, z] = [m.index[3 * t], m.index[3 * t + 1], m.index[3 * t + 2]];
    if (!onPlane(x) || !onPlane(y) || !onPlane(z)) continue;
    faces.push(t);
    const px = (w: number): Vec3 => [m.positions[3 * w], m.positions[3 * w + 1], m.positions[3 * w + 2]];
    const [A, B, C] = [px(x), px(y), px(z)];
    const e1: Vec3 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2: Vec3 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    area += 0.5 * Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
  }
  return { faces: Uint32Array.from(faces), area };
}

function measure(m: Mesh, opts: { f?: (p: Vec3) => Vec3; unit?: string; platform?: boolean; ends?: boolean } = {}): FlakeMeasures {
  const f = opts.f ?? ((p: Vec3) => p);
  const edge = meanEdge(m);
  const P = f(T1.P), A = f(T1.A);
  const fr = technicalFrame({ positions: m.positions, index: m.index, meanEdge: edge }, P, A);
  expect(fr.ok).toBe(true);
  if (!fr.ok) return emptyFlakeMeasures();
  const plat = opts.platform === false ? null : platformOf(m, f);
  return flakeMeasures({
    positions: m.positions,
    index: m.index,
    matrix: fr.matrix,
    P,
    ends: opts.ends === false ? [] : T1.ends.map(f),
    platformFaces: plat?.faces ?? null,
    platformArea: plat?.area ?? null,
    unit: opts.unit ?? 'mm',
    meanEdge: edge,
    morph: morphDimensions(m.positions),
  }).measures;
}

const T1_TURN = rigid([1, 2, -0.5], 73, [120, -40, 15]);
const T3_TURN = rigid([-2, 1, 3], 137, [-5, 60, 22]);

describe('the technical frame', () => {
  const m = flakeT1();
  const input = { positions: m.positions, index: m.index, meanEdge: meanEdge(m) };
  it('T1: origin P, +Z toward the dorsal face, +Y distal, +X = Y × Z', () => {
    const fr = technicalFrame(input, T1.P, T1.A);
    expect(fr.ok).toBe(true);
    if (!fr.ok) return;
    const err = (u: Vec3, v: Vec3) => deg(Math.acos(Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2])));
    expect(err(fr.axes.z, [0, 0, 1])).toBeLessThan(0.1);
    expect(err(fr.axes.y, [0, 1, 0])).toBeLessThan(0.1);
    expect(err(fr.axes.x, [1, 0, 0])).toBeLessThan(0.1);
    expect(frameAxes(fr.matrix).origin.map((x) => Math.abs(x) < 1e-9)).toEqual([true, true, true]);
    // the frame stands on the triangles that face one way: the platform and the dorsal face are left out
    expect(fr.triangles).toBeGreaterThan(10);
  });
  it('a triangle facing inward (a mesh turned inside out) gives the same frame', () => {
    const flipped = { positions: m.positions, index: m.index.map((_, i, a) => (i % 3 === 1 ? a[i + 1] : i % 3 === 2 ? a[i - 1] : a[i])), meanEdge: input.meanEdge, orientationSign: -1 };
    const fr = technicalFrame(flipped, T1.P, T1.A);
    expect(fr.ok && fr.axes.z[2]).toBeCloseTo(1, 6);
  });
  it('no frame from an arrow under five mean edges, nor with fewer than ten triangles', () => {
    const short: Vec3 = [0, (MIN_AXIS_EDGES - 1) * input.meanEdge, 0];
    expect(technicalFrame(input, T1.P, short)).toEqual({ ok: false, reason: 'short' });
    const coarse = box([40, 40, 10], 1);
    const fr = technicalFrame({ positions: coarse.positions, index: coarse.index, meanEdge: 1 }, [-20, -20, -5], [20, 20, -5]);
    expect(fr).toEqual({ ok: false, reason: 'few' });
  });
  it('the scars\' angle: +Y is 0°, −X is +90° (counter-clockwise from the dorsal side), in (−180°, 180°]', () => {
    const fr = technicalFrame(input, T1.P, T1.A);
    if (!fr.ok) throw new Error('no frame');
    const a = (d: Vec3) => techAngleDeg(fr.matrix, [0, 0, 0], d)!;
    expect(a([0, 5, 0])).toBeCloseTo(0, 5);
    expect(a([-5, 0, 0])).toBeCloseTo(90, 5);
    expect(a([5, 0, 0])).toBeCloseTo(-90, 5);
    expect(a([0, -5, 0])).toBeCloseTo(180, 5);
    expect(techAngleDeg(fr.matrix, [0, 0, 0], [0, 0, 3])).toBeNull();
  });
});

describe('dimensions', () => {
  it('the convex hull of a box is its corners, of a flat grid its outline', () => {
    const b = box([4, 6, 8], 4);
    const hull = convexHull(b.positions);
    // the corners (a first point may stay on a face or an edge: it only adds a candidate)
    expect(hull.length).toBeLessThanOrEqual(12);
    const at = [...hull].map((v) => [b.positions[3 * v], b.positions[3 * v + 1], b.positions[3 * v + 2]].join());
    for (const x of [-2, 2]) for (const y of [-3, 3]) for (const z of [-4, 4]) expect(at).toContain([x, y, z].join());
    const grid = new Float32Array(3 * 25);
    for (let i = 0; i < 25; i++) grid.set([i % 5, Math.floor(i / 5), 0], 3 * i);
    expect(convexHull(grid).length).toBeLessThanOrEqual(16);
    const ends = [...convexHull(grid)].map((v) => [grid[3 * v], grid[3 * v + 1]].join());
    for (const corner of ['0,0', '4,0', '0,4', '4,4']) expect(ends).toContain(corner);
  });
  it('T1: technical length, width and thickness 60, 30, 10', () => {
    const r = measure(flakeT1());
    closeTo(r.tech_length, 60, 0.3);
    closeTo(r.tech_width, 30, 0.15);
    closeTo(r.tech_thickness, 10, 0.05);
  });
  it('T3: morphological length, width and thickness 80, 50, 16', () => {
    for (const m of [ellipsoid(40, 25, 8), mapped(ellipsoid(40, 25, 8), T3_TURN)]) {
      const d = morphDimensions(m.positions)!;
      closeTo(d.length, 80, 0.4);
      closeTo(d.width, 50, 0.25);
      closeTo(d.thickness, 16, 0.08);
    }
  });
  it('the angle between the morphological length and the Y axis is 0–90°', () => {
    const f: FrameAxes = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], origin: [0, 0, 0] };
    expect(morphTechAngle([0, 1, 0], f)).toBeCloseTo(0, 8);
    expect(morphTechAngle([0, -1, 0], f)).toBeCloseTo(0, 8);
    expect(morphTechAngle([1, 0, 0], f)).toBeCloseTo(90, 8);
    expect(morphTechAngle([Math.SQRT1_2, -Math.SQRT1_2, 0], f)).toBeCloseTo(45, 8);
    expect(morphTechAngle([0, 0, 1], f)).toBeNull();
  });
  it('the cross-section at Y = t · 80 of T3 has the width and thickness of the ellipse there', () => {
    const m = mapped(ellipsoid(40, 25, 8), T3_TURN);
    // the technical axis along the long axis, from one end to the other
    const P = T3_TURN([-40, 0, 0]);
    const at = (v: Vec3): Vec3 => {
      const o = T3_TURN([0, 0, 0]), q = T3_TURN(v);
      return [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
    };
    const f: FrameAxes = { x: at([0, -1, 0]), y: at([1, 0, 0]), z: at([0, 0, 1]), origin: P };
    for (const t of [0.15, 0.3, 0.5, 0.8]) {
      const s = Math.sqrt(1 - (80 * t - 40) ** 2 / 1600);
      const c = crossSectionAt(m.positions, m.index, f, t * 80);
      expect(c.loops.length).toBe(1);
      closeTo(c.width, 50 * s, 0.25);
      closeTo(c.thickness, 16 * s, 0.08);
    }
  });
});

describe('the section of the mesh', () => {
  it('runs through vertices on the plane, keeps the triangle of each stretch, closes the loop', () => {
    const m = flakeT1();
    const lines = sectionByPlane(m.positions, m.index, [0, 0, 0], [1, 0, 0]);
    expect(lines.length).toBe(1);
    const [l] = lines;
    expect(l.closed).toBe(true);
    expect(l.faces.length).toBe(l.points.length);
    for (const p of l.points) expect(Math.abs(p[0])).toBeLessThan(1e-3);
    // each stretch lies on its triangle
    l.faces.forEach((t, i) => {
      const verts = [m.index[3 * t], m.index[3 * t + 1], m.index[3 * t + 2]];
      const near = (p: Vec3) => {
        const a = verts.map((v): Vec3 => [m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]]);
        const ys = a.map((q) => q[1]), zs = a.map((q) => q[2]);
        return p[1] >= Math.min(...ys) - 1e-3 && p[1] <= Math.max(...ys) + 1e-3 && p[2] >= Math.min(...zs) - 1e-3 && p[2] <= Math.max(...zs) + 1e-3;
      };
      expect(near(l.points[i]) && near(l.points[(i + 1) % l.points.length])).toBe(true);
    });
    expect(lineNear(lines, [0, 30, 0])).toBe(l);
  });
  it('gives the same lines through candidates as over all the triangles', () => {
    const m = flakeT1();
    const candidates = (_p: Vec3, _n: Vec3, visit: (t: number) => void) => {
      for (let t = m.index.length / 3 - 1; t >= 0; t--) visit(t);
    };
    const a = sectionByPlane(m.positions, m.index, [0, 20, 0], [0, 1, 0]);
    const b = sectionByPlane(m.positions, m.index, [0, 20, 0], [0, 1, 0], candidates);
    expect(b.length).toBe(a.length);
    expect(b[0].points.length).toBe(a[0].points.length);
  });
});

describe('the shortest path within a region', () => {
  const all = (m: Mesh) => Uint32Array.from({ length: m.index.length / 3 }, (_, i) => i);
  it('T5: along the cylinder between the middles of its straight edges, 20 · π / 2', () => {
    const m = cylinderPatch(20, 90, 10);
    const r = regionPath(m.positions, m.index, all(m), [20, 0, 5], [0, 20, 5])!;
    closeTo(r.length, (20 * Math.PI) / 2, 0.01 * 31.42);
    expect(Math.hypot(20, 20)).toBeCloseTo(28.28, 2);
    expect(r.length).toBeGreaterThan(30);
  });
  it('is pulled taut across the triangles (not along their edges)', () => {
    const m = cylinderPatch(1000, 2, 30, 20, 20); // nearly flat, about 34.9 × 30
    const a: Vec3 = [1000, 0, 2], b: Vec3 = [1000 * Math.cos((1.7 * Math.PI) / 180), 1000 * Math.sin((1.7 * Math.PI) / 180), 27];
    const straight = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const r = regionPath(m.positions, m.index, all(m), a, b)!;
    expect(r.length).toBeLessThan(straight * 1.005);
    expect(r.length).toBeGreaterThanOrEqual(straight * 0.9999);
  });
  it('stays within the region (round a part left out)', () => {
    const m = cylinderPatch(1000, 2, 30, 20, 20);
    // a wall across the middle, with a gap at the top
    const keep: number[] = [];
    for (let t = 0; t < m.index.length / 3; t++) {
      const c = [0, 1, 2].map((k) => m.positions[3 * m.index[3 * t + k] + 1]);
      const z = Math.max(...[0, 1, 2].map((k) => m.positions[3 * m.index[3 * t + k] + 2]));
      const y = (c[0] + c[1] + c[2]) / 3;
      if (Math.abs(y - 17.45) > 2.5 || z > 25) keep.push(t);
    }
    const a: Vec3 = [1000, 0, 5], b: Vec3 = [1000 * Math.cos((2 * Math.PI) / 180), 1000 * Math.sin((2 * Math.PI) / 180), 5];
    const r = regionPath(m.positions, m.index, Uint32Array.from(keep), a, b)!;
    expect(r.length).toBeGreaterThan(Math.hypot(b[1] - a[1], b[2] - a[2]) + 5);
    // nothing connects two parts apart
    const lower = keep.filter((t) => Math.max(...[0, 1, 2].map((k) => m.positions[3 * m.index[3 * t + k] + 2])) <= 25);
    expect(regionPath(m.positions, m.index, Uint32Array.from(lower), a, b)).toBeNull();
  });
});

describe('the platform (T1)', () => {
  const m = flakeT1();
  it('its width, depth, area, EPA and IPA', () => {
    const r = measure(m);
    closeTo(r.platform_width_chord, 30, 0.15);
    closeTo(r.platform_width_path, 30, 0.3);
    closeTo(r.platform_depth_chord, Math.sqrt(104), 0.05);
    closeTo(r.platform_depth_path, Math.sqrt(104), 0.1);
    closeTo(r.platform_area, 30 * Math.sqrt(104), 1.5);
    for (const k of ['epa_3pt_1mm', 'epa_3pt_2mm', 'epa_3pt_3mm', 'epa_2ln_1mm', 'epa_2ln_2mm', 'epa_2ln_3mm'] as const) closeTo(r[k], EPA, 0.5);
    closeTo(r.ipa, IPA, 0.5);
  });
  it('without a stated unit there is no EPA, and the rest is measured', () => {
    const r = measure(m, { unit: '' });
    for (const k of ['epa_3pt_1mm', 'epa_3pt_2mm', 'epa_3pt_3mm', 'epa_2ln_1mm', 'epa_2ln_2mm', 'epa_2ln_3mm'] as const) expect(r[k]).toBeNull();
    closeTo(r.ipa, IPA, 0.5);
    closeTo(r.platform_width_chord, 30, 0.15);
    closeTo(r.platform_depth_chord, Math.sqrt(104), 0.05);
  });
  it('EPA takes its distances in the stated unit', () => {
    // 1 mm in cm: the points are nearer; T1's face is flat, so the angle is the same; 2.5 cm is past no end
    const r = measure(m, { unit: 'cm' });
    closeTo(r.epa_3pt_3mm, EPA, 0.5);
    // in metres 1 mm is under the section's spacing, still on the flat face
    closeTo(measure(m, { unit: 'in' }).epa_2ln_2mm, EPA, 0.5);
  });
  it('without a platform region every platform measure is empty; the dimensions stay', () => {
    const r = measure(m, { platform: false });
    for (const k of FLAKE_MEASURES.filter((x) => x.startsWith('platform') || x.startsWith('epa') || x === 'ipa')) expect(r[k]).toBeNull();
    closeTo(r.tech_length, 60, 0.3);
  });
  it('with fewer than two ends the width is empty', () => {
    const r = measure(m, { ends: false });
    expect(r.platform_width_chord).toBeNull();
    expect(r.platform_width_path).toBeNull();
    closeTo(r.platform_depth_chord, Math.sqrt(104), 0.05);
  });
  it('a stretch too far from P is not the platform', () => {
    const fr = technicalFrame({ positions: m.positions, index: m.index, meanEdge: meanEdge(m) }, T1.P, T1.A);
    if (!fr.ok) throw new Error('no frame');
    const plat = platformOf(m);
    // P moved 20 along the ventral face: the section's platform stretch now starts far from it
    const r = flakeMeasures({ positions: m.positions, index: m.index, matrix: fr.matrix, P: [0, 20, 0], ends: T1.ends, platformFaces: plat.faces, platformArea: plat.area, unit: 'mm', meanEdge: meanEdge(m), morph: null }).measures;
    expect(r.platform_depth_chord).toBeNull();
    expect(r.ipa).toBeNull();
  });
  it('T2 (a bulb, a curved distal end): IPA as on T1, technical length 60', () => {
    const r = measure(flakeT2());
    closeTo(r.ipa, IPA, 0.5);
    closeTo(r.tech_length, 60, 0.3);
    closeTo(r.epa_3pt_1mm, EPA, 0.5);
  });
  it('the smaller piece along the outline is the platform, wherever it lies', () => {
    const edges = buildEdges(m.index, m.positions.length / 3);
    // the platform's boundary as mesh edges: round the four corners of the face
    const vertexAt = (p: Vec3) => {
      let best = 0, d = Infinity;
      for (let v = 0; v < m.positions.length / 3; v++) {
        const x = Math.hypot(m.positions[3 * v] - p[0], m.positions[3 * v + 1] - p[1], m.positions[3 * v + 2] - p[2]);
        if (x < d) {
          d = x;
          best = v;
        }
      }
      return best;
    };
    const corners: Vec3[] = [[-15, 0, 0], [15, 0, 0], [15, -2, 10], [-15, -2, 10]];
    const barrier = polylineEdges(corners.flatMap((a, i) => {
      const b = corners[(i + 1) % 4];
      return Array.from({ length: 40 }, (_, k): Vec3 => [a[0] + ((b[0] - a[0]) * k) / 40, a[1] + ((b[1] - a[1]) * k) / 40, a[2] + ((b[2] - a[2]) * k) / 40]);
    }), true, vertexAt, edges, () => null);
    const part = runSync(regionsSteps(m.positions, m.index, edges, barrier));
    const r = runSync(smallerPieceSteps(m.positions, m.index, edges, barrier, part))!;
    closeTo(r.area, 30 * Math.sqrt(104), 1.5);
    // on the P–E face
    expect(Math.abs(r.seed[2] / 10 + r.seed[1] / 2)).toBeLessThan(0.05);
  });
  it('the plane of a region, weighted by area', () => {
    const plat = platformOf(m);
    const fit = regionPlane(m.positions, m.index, plat.faces)!;
    const n: Vec3 = [0, 10, 2];
    const l = Math.hypot(...n);
    expect(Math.abs((fit.normal[1] * n[1] + fit.normal[2] * n[2]) / l)).toBeCloseTo(1, 4);
    closeTo(fit.centroid[1], -1, 0.05);
    closeTo(fit.centroid[2], 5, 0.05);
  });
});

describe('a rigid movement changes nothing', () => {
  it('T1', () => {
    const a = measure(flakeT1());
    const b = measure(mapped(flakeT1(), T1_TURN), { f: T1_TURN });
    for (const k of FLAKE_MEASURES) {
      if (a[k] === null) expect(b[k]).toBeNull();
      else closeTo(b[k], a[k]!, k.includes('path') ? 0.3 : k === 'platform_area' ? 1 : k.includes('deg') || k.includes('pa') ? 0.5 : 0.3);
    }
  });
  it('T3: morphological dimensions, and the technical ones in a frame moved with it', () => {
    const m = ellipsoid(40, 25, 8);
    const moved = mapped(m, T3_TURN);
    const a = morphDimensions(m.positions)!, b = morphDimensions(moved.positions)!;
    closeTo(b.length, a.length, 0.05);
    closeTo(b.width, a.width, 0.05);
    closeTo(b.thickness, a.thickness, 0.05);
    const frame = (f: (p: Vec3) => Vec3): number[] => {
      const o = f([0, 0, 0]);
      const dir = (v: Vec3): Vec3 => {
        const q = f(v);
        return [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
      };
      return frameMatrix({ x: dir([0, -1, 0]), y: dir([1, 0, 0]), z: dir([0, 0, 1]), origin: f([-40, 0, 0]) });
    };
    const run = (x: Mesh, f: (p: Vec3) => Vec3) => flakeMeasures({ positions: x.positions, index: x.index, matrix: frame(f), P: f([-40, 0, 0]), ends: [], platformFaces: null, platformArea: null, unit: 'mm', meanEdge: 1, morph: null }).measures;
    const ra = run(m, (p) => p), rb = run(moved, T3_TURN);
    closeTo(ra.tech_length, 80, 0.4);
    closeTo(ra.tech_width, 50, 0.25);
    closeTo(ra.tech_thickness, 16, 0.08);
    closeTo(rb.tech_length, ra.tech_length!, 0.05);
    closeTo(rb.tech_width, ra.tech_width!, 0.05);
    closeTo(rb.tech_thickness, ra.tech_thickness!, 0.05);
  });
});

describe('T6, a flake of realistic shape', () => {
  const faceNormal = (m: Mesh, t: number): Vec3 => {
    const p = (k: number): Vec3 => {
      const v = 3 * m.index[3 * t + k];
      return [m.positions[v], m.positions[v + 1], m.positions[v + 2]];
    };
    const [a, b, c] = [p(0), p(1), p(2)];
    const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  };

  /** The rows of triangles over the platform: all at y ≤ 0, and facing −y (more than the dorsal face's first rows do). */
  const platformOfT6 = (m: Mesh): { faces: Uint32Array; area: number } => {
    const faces: number[] = [];
    let area = 0;
    for (let t = 0; t < m.index.length / 3; t++) {
      const low = [0, 1, 2].every((k) => m.positions[3 * m.index[3 * t + k] + 1] <= 1e-5);
      const n = faceNormal(m, t);
      if (!low || n[1] >= 0 || Math.abs(n[1]) <= Math.abs(n[2])) continue;
      faces.push(t);
      area += 0.5 * Math.hypot(...n);
    }
    return { faces: Uint32Array.from(faces), area };
  };

  it.each([[14, 9300, 18594], [1, 8689, 17372]])('K = %i: closed, manifold, turned one way, with a positive volume', (K, vertices, triangles) => {
    const m = flakeT6(K);
    expect(m.positions.length / 3).toBe(vertices);
    expect(m.index.length / 3).toBe(triangles);
    const uses = new Map<string, number>();
    for (let t = 0; t < triangles; t++) {
      for (let k = 0; k < 3; k++) {
        const a = m.index[3 * t + k], b = m.index[3 * t + ((k + 1) % 3)];
        const key = `${a},${b}`;
        uses.set(key, (uses.get(key) ?? 0) + 1);
      }
    }
    // each edge once each way: two triangles, turned alike
    for (const [key, n] of uses) {
      expect(n).toBe(1);
      const [a, b] = key.split(',');
      expect(uses.get(`${b},${a}`)).toBe(1);
    }
    let volume = 0;
    const p = m.positions;
    for (let t = 0; t < triangles; t++) {
      const a = 3 * m.index[3 * t], b = 3 * m.index[3 * t + 1], c = 3 * m.index[3 * t + 2];
      volume += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
    }
    expect(volume).toBeCloseTo(5799.3, 0);
  });

  it.each([14, 1])('K = %i: the platform measures, with one row of triangles as with many', (K) => {
    const m = flakeT6(K);
    const P: Vec3 = [0, 0, t6Zv(0, 0)], A: Vec3 = [0, 40, t6Zv(0, 40)];
    const edge = meanEdge(m);
    const fr = technicalFrame({ positions: m.positions, index: m.index, meanEdge: edge }, P, A);
    expect(fr.ok).toBe(true);
    if (!fr.ok) return;
    const plat = platformOfT6(m);
    // two to a quad, one at each end of a row, where it comes to a point
    expect(plat.faces.length).toBe(K * (2 * T6.ns - 2));
    const ends: Vec3[] = [[-T6.w0, 0, t6Zv(-T6.w0, 0)], [T6.w0, 0, t6Zv(T6.w0, 0)]];
    const r = flakeMeasures({ positions: m.positions, index: m.index, matrix: fr.matrix, P, ends, platformFaces: plat.faces, platformArea: plat.area, unit: 'mm', meanEdge: edge, morph: morphDimensions(m.positions) }).measures;
    const within = (v: number | null, want: number) => closeTo(v, want, 0.01 * want);
    within(r.platform_depth_chord, 7.04);
    within(r.platform_width_chord, 22.0);
    for (const [key, want] of [['epa_3pt_1mm', 59.83], ['epa_3pt_2mm', 59.59], ['epa_3pt_3mm', 59.98], ['epa_2ln_1mm', 59.32], ['epa_2ln_2mm', 59.73], ['epa_2ln_3mm', 62.23], ['ipa', 106.46]] as Array<[FlakeMeasure, number]>) closeTo(r[key], want, 1);
  });

  it('T1 measures the same as before', () => {
    const r = measure(flakeT1());
    closeTo(r.ipa, IPA, 0.5);
    for (const k of ['epa_3pt_1mm', 'epa_3pt_2mm', 'epa_3pt_3mm', 'epa_2ln_1mm', 'epa_2ln_2mm', 'epa_2ln_3mm'] as const) closeTo(r[k], EPA, 0.5);
    closeTo(r.platform_depth_chord, Math.sqrt(104), 0.01);
    closeTo(r.platform_width_chord, 30, 0.01);
    expect(FLAKE_PARAMETERS).toMatchObject({ MIN_FIT_POINTS: 2, PLATFORM_START_EDGES: 3 });
  });
});

describe('why a measure is empty', () => {
  const EPA_KEYS = ['epa_3pt_1mm', 'epa_3pt_2mm', 'epa_3pt_3mm', 'epa_2ln_1mm', 'epa_2ln_2mm', 'epa_2ln_3mm'] as const;
  const PLATFORM_KEYS = ['platform_width_chord', 'platform_width_path', 'platform_depth_chord', 'platform_depth_path', 'platform_area', ...EPA_KEYS, 'ipa'] as const;

  function run(opts: { P?: Vec3 | null; unit?: string; platform?: boolean; ends?: Vec3[]; matrix?: 'none' } = {}): FlakeResult {
    const m = flakeT1();
    const edge = meanEdge(m);
    const P = opts.P === undefined ? T1.P : opts.P;
    const fr = P && !opts.matrix ? technicalFrame({ positions: m.positions, index: m.index, meanEdge: edge }, P, T1.A) : null;
    const plat = opts.platform === false ? null : platformOf(m);
    return flakeMeasures({
      positions: m.positions,
      index: m.index,
      matrix: fr?.ok ? fr.matrix : null,
      P,
      ends: opts.ends ?? T1.ends,
      platformFaces: plat?.faces ?? null,
      platformArea: plat?.area ?? null,
      unit: opts.unit ?? 'mm',
      meanEdge: edge,
      morph: morphDimensions(m.positions),
    });
  }

  it('nothing is empty on a flake annotated in full', () => {
    const r = run();
    expect(r.reasons).toEqual({});
    for (const k of FLAKE_MEASURES) expect(r.measures[k]).not.toBeNull();
  });

  it('no stated unit: the EPAs, not the IPA', () => {
    const r = run({ unit: '' });
    for (const k of EPA_KEYS) expect(r.reasons[k]).toBe('no_unit');
    expect(r.measures.ipa).not.toBeNull();
    expect(r.reasons.ipa).toBeUndefined();
  });

  it('no platform outline: everything of the platform', () => {
    const r = run({ platform: false });
    for (const k of PLATFORM_KEYS) expect(r.reasons[k]).toBe('no_platform');
  });

  it('one platform end: the widths, not the depth', () => {
    const r = run({ ends: [T1.ends[0]] });
    expect(r.reasons.platform_width_chord).toBe('no_ends');
    expect(r.reasons.platform_width_path).toBe('no_ends');
    expect(r.measures.platform_depth_chord).not.toBeNull();
    expect(r.reasons.platform_depth_chord).toBeUndefined();
  });

  it('the axis starts on the ventral face, away from the platform: everything of the platform', () => {
    const r = run({ P: [0, 5, 0] });
    for (const k of PLATFORM_KEYS) expect(r.reasons[k]).toBe('section_misses_platform');
  });

  it('no axis: the technical dimensions, not the morphological ones', () => {
    const r = run({ P: null });
    for (const k of ['tech_length', 'tech_width', 'tech_thickness', 'morph_tech_angle_deg'] as const) expect(r.reasons[k]).toBe('no_axis');
    for (const k of PLATFORM_KEYS) expect(r.reasons[k]).toBe('no_axis');
    for (const k of ['morph_length', 'morph_width', 'morph_thickness'] as const) expect(r.measures[k]).not.toBeNull();
  });

  it('an axis without a frame', () => {
    const r = run({ matrix: 'none' });
    expect(r.reasons.tech_length).toBe('frame_failed');
    expect(r.reasons.ipa).toBe('frame_failed');
  });

  it('a section that ends before the distance', () => {
    // a platform at the very end of a short piece: on from E there is little of the dorsal side
    const scale = (p: Vec3): Vec3 => [p[0] / 60, p[1] / 60, p[2] / 60];
    const m = mapped(flakeT1(), scale);
    const edge = meanEdge(m);
    const fr = technicalFrame({ positions: m.positions, index: m.index, meanEdge: edge }, scale(T1.P), scale(T1.A));
    expect(fr.ok).toBe(true);
    if (!fr.ok) return;
    const plat = platformOf(m, scale);
    const r = flakeMeasures({ positions: m.positions, index: m.index, matrix: fr.matrix, P: scale(T1.P), ends: T1.ends.map(scale), platformFaces: plat.faces, platformArea: plat.area, unit: 'mm', meanEdge: edge, morph: null });
    expect(r.reasons.epa_3pt_3mm).toBe('section_ends');
    expect(r.reasons.morph_length).toBe('no_hull');
  });

  it('the reasons are not in the measures, so neither in the file nor in the tables', () => {
    expect(Object.keys(run({ platform: false }).measures)).toEqual([...FLAKE_MEASURES]);
  });
});

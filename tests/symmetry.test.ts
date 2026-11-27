import { describe, expect, it } from 'vitest';
import { gmLandPairs, gmPoints } from '../src/compute/gm';
import { meshTopology } from '../src/compute/meshGeometry';
import type { PlaneResult } from '../src/compute/planes';
import { weightedQuantile } from '../src/compute/robust';
import { runSync } from '../src/compute/steps';
import {
  insideMesh,
  SYMMETRY_PARAMETERS,
  symmetryMeshSteps,
  symmetrySource,
  symmetrySteps,
  symmetryValues,
  vertexDeviationSteps,
  type SymmetryComputed,
  type SymmetryMesh,
  type SymmetryPlane,
} from '../src/compute/symmetry';
import { addCurve, addSymmetry, placePlatformEnd, setCurveAttribute, setSpecimenType, setSymmetryLabel, setSymmetryNote, setTechnologicalAxis, swapSymmetry, updateSpecimen } from '../src/core/actions';
import { frameMatrix } from '../src/core/frame';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import type { Vec3 } from '../src/core/types';
import { storedSymmetry } from '../src/io/batch';
import { measurementsCsv, symmetryCsv } from '../src/io/csv';
import { gmLandPairsCsv } from '../src/io/landmarks';
import { pageBackend, type SymmetryReply, type SymmetryRequest } from '../src/io/symmetryJobs';
import { SYMMETRY_CACHE_SIZE, SymmetryRunner, type SymmetryModel } from '../src/ui/symmetryRunner';
import { flakeT1, S_BODY, sphere, symmetryS1, symmetryS2, T1, type Mesh } from './meshes';

/** S1: an ellipsoid of three different half-axes, symmetric about each coordinate plane; S2: with a bump on its +X end. */
const { a: A, b: B, c: C } = S_BODY;
const S1 = symmetryS1();
const S2 = symmetryS2();
/** A sphere of radius R about the origin (an icosphere: symmetric about each coordinate plane). */
const R = 10;
const BALL = sphere(R, 5);

/** The volume of a closed mesh (divergence theorem). */
function volumeOf(m: Mesh): number {
  let v = 0;
  const P = (i: number) => [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]];
  for (let t = 0; 3 * t < m.index.length; t++) {
    const [a, b, c] = [P(m.index[3 * t]), P(m.index[3 * t + 1]), P(m.index[3 * t + 2])];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

const YZ: SymmetryPlane = { point: [0, 0, 0], normal: [1, 0, 0] };
const closedOf = (m: Mesh) => meshTopology(m.index, m.positions.length / 3).closed;
const meshOf = new Map<Mesh, SymmetryMesh>();
const prepared = (m: Mesh): SymmetryMesh => {
  if (!meshOf.has(m)) meshOf.set(m, runSync(symmetryMeshSteps(m.positions, m.index, closedOf(m))));
  return meshOf.get(m)!;
};
function compute(m: Mesh, plane: SymmetryPlane): Required<SymmetryComputed> {
  return runSync(symmetrySteps(prepared(m), { plane, chain: null, closed: closedOf(m) }));
}
const valuesOf = (c: SymmetryComputed, swap = false) => symmetryValues({ id: 's', swap }, c, [0, 0, 0]);

/** A fixed sequence in [0, 1) (the same every run). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

describe('the three symmetries', () => {
  it('a sphere about a plane through its centre: all three 1 (volume and area to 1e-9, shape to 0.001)', () => {
    const v = valuesOf(compute(BALL, YZ));
    expect(Math.abs(v.volumeSymmetry! - 1)).toBeLessThan(1e-9);
    expect(Math.abs(v.areaSymmetry! - 1)).toBeLessThan(1e-9);
    expect(v.shapeSymmetry!).toBeGreaterThan(0.999);
    expect(v.shapeSymmetry!).toBeLessThanOrEqual(1);
    expect(v.reasons).toEqual({ volume: null, area: null, shape: null, deviation: null });
  });

  it('a sphere about a plane d from its centre: shape = the lens of two spheres 2d apart over the sphere (to 1 %)', () => {
    for (const d of [1, 2.5, 5]) {
      const v = valuesOf(compute(BALL, { point: [d, 0, 0], normal: [1, 0, 0] }));
      const lens = (Math.PI * (4 * R + 2 * d) * (2 * R - 2 * d) ** 2) / 12;
      const expected = lens / ((4 / 3) * Math.PI * R ** 3);
      expect(Math.abs(v.shapeSymmetry! / expected - 1)).toBeLessThan(0.01);
      // the caps: the side the normal points to is the smaller
      expect(v.volumeA!).toBeLessThan(v.volumeB!);
      expect(v.volumeSymmetry!).toBeCloseTo(v.volumeA! / v.volumeB!, 12);
    }
    // (three references in full: more than the default 5 s on a busy machine)
  }, 30_000);

  it('S1 about its plane of symmetry: volume and area 1, shape > 0.99, no deviation', () => {
    const r = compute(S1, YZ);
    const v = valuesOf(r);
    const [va, vb] = r.sides.volumes!;
    // the sides together are the whole; the mesh within 0.2 % of the ellipsoid's 4/3 π a b c
    expect(va + vb).toBeCloseTo(volumeOf(S1), 6);
    expect(Math.abs((va + vb) / ((4 / 3) * Math.PI * A * B * C) - 1)).toBeLessThan(0.002);
    expect(Math.abs(v.volumeSymmetry! - 1)).toBeLessThan(1e-9);
    expect(Math.abs(v.areaSymmetry! - 1)).toBeLessThan(1e-9);
    expect(v.shapeSymmetry!).toBeGreaterThan(0.99);
    // every point of the surface mirrors onto the surface
    expect(v.deviationMean!).toBeLessThan(1e-6);
    expect(v.deviationRms!).toBeLessThan(1e-6);
    expect(v.deviationP95!).toBeLessThan(1e-6);
  });

  it('S2: volume = (V₁/2) / (V₁/2 + bump) to 1e-6, shape = V₁ / (V₁ + bump) to 0.001', () => {
    const v1 = volumeOf(S1), bump = volumeOf(S2) - v1;
    expect(bump).toBeGreaterThan(50);
    const v = valuesOf(compute(S2, YZ));
    expect(Math.abs(v.volumeSymmetry! - v1 / 2 / (v1 / 2 + bump))).toBeLessThan(1e-6);
    expect(Math.abs(v.shapeSymmetry! - v1 / (v1 + bump))).toBeLessThan(0.001);
    expect(v.areaSymmetry!).toBeLessThan(1);
    expect(v.deviationMean!).toBeGreaterThan(0);
    expect(v.deviationP95!).toBeLessThanOrEqual(S_BODY.bump);
  });

  it('the inside test agrees with the sphere’s and the ellipsoid’s own on random points (≥ 99.9 %)', () => {
    const next = lcg(7);
    const cases: Array<[Mesh, (p: Vec3) => boolean, Vec3]> = [
      [BALL, (p) => Math.hypot(...p) < R, [R, R, R]],
      [S1, (p) => (p[0] / A) ** 2 + (p[1] / B) ** 2 + (p[2] / C) ** 2 < 1, [A, B, C]],
    ];
    for (const [m, inside, half] of cases) {
      const bvh = prepared(m).bvh;
      let agree = 0, ins = 0;
      const n = 20000;
      for (let i = 0; i < n; i++) {
        const p: Vec3 = [0, 1, 2].map((k) => (2 * next() - 1) * 1.2 * half[k]) as Vec3;
        const got = insideMesh(bvh, p);
        if (got === inside(p)) agree++;
        if (got) ins++;
      }
      expect(agree / n).toBeGreaterThanOrEqual(0.999);
      // (about π/6 of the box: the test is no trivial one)
      expect(ins / n).toBeGreaterThan(0.25);
    }
  });

  it('the samples: about SYM_OVERLAP_SAMPLES inside, SYM_DEVIATION_SAMPLES on the surface', () => {
    const m = prepared(S1);
    expect(m.surfaceSamples.length / 3).toBe(SYMMETRY_PARAMETERS.SYM_DEVIATION_SAMPLES);
    expect(Math.abs(m.interiorSamples.length / 3 / SYMMETRY_PARAMETERS.SYM_OVERLAP_SAMPLES - 1)).toBeLessThan(0.02);
    expect(m.gridStep!).toBeCloseTo(Math.cbrt(volumeOf(S1) / SYMMETRY_PARAMETERS.SYM_OVERLAP_SAMPLES), 9);
  });

  it('S2: the mean deviation of the surface samples is within 3 % of that over every vertex (by area)', () => {
    const m = prepared(S2);
    const r = compute(S2, YZ);
    const d = runSync(vertexDeviationSteps(m, YZ));
    // a vertex weighs a third of the area of its triangles
    const w = new Float64Array(d.length);
    for (let t = 0; 3 * t < S2.index.length; t++) {
      const [a, b, c] = [0, 1, 2].map((k) => S2.index[3 * t + k]);
      const P = (i: number): Vec3 => [S2.positions[3 * i], S2.positions[3 * i + 1], S2.positions[3 * i + 2]];
      const u = P(b).map((x, k) => x - P(a)[k]), v = P(c).map((x, k) => x - P(a)[k]);
      const s = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 6;
      w[a] += s;
      w[b] += s;
      w[c] += s;
    }
    let sw = 0, sd = 0;
    for (let i = 0; i < d.length; i++) {
      sw += w[i];
      sd += w[i] * d[i];
    }
    expect(Math.abs(r.deviation.mean / (sd / sw) - 1)).toBeLessThan(0.03);
    // the deviation is there only at the bump and where it mirrors
    let away = 0;
    for (let v = 0; v < d.length; v++) if (Math.abs(S1.positions[3 * v]) < 0.8 * A) away = Math.max(away, d[v]);
    expect(away).toBeLessThan(1e-5);
  });

  it('the same inputs twice: the same results, to the last bit', () => {
    const fresh = () => runSync(symmetrySteps(runSync(symmetryMeshSteps(S2.positions, S2.index, true)), { plane: { point: [1, 0, 0], normal: [0.99, 0.1, 0] }, chain: null, closed: true }));
    const a = fresh(), b = fresh();
    expect(b).toEqual(a);
  });

  it('swapped: the three symmetries alike, A and B exchanged, the normal the other way; in original coordinates', () => {
    const r = compute(S2, YZ);
    const plain = symmetryValues({ id: 's', swap: false }, r, [100, 0, 0]);
    const swapped = symmetryValues({ id: 's', swap: true }, r, [100, 0, 0]);
    expect([swapped.volumeSymmetry, swapped.areaSymmetry, swapped.shapeSymmetry]).toEqual([plain.volumeSymmetry, plain.areaSymmetry, plain.shapeSymmetry]);
    expect([swapped.volumeA, swapped.volumeB, swapped.areaA, swapped.areaB]).toEqual([plain.volumeB, plain.volumeA, plain.areaB, plain.areaA]);
    expect(plain.plane).toEqual({ point: [100, 0, 0], normal: [1, 0, 0] });
    expect(swapped.plane!.normal).toEqual([-1, -0, -0]);
    expect(swapped.deviationMean).toBe(plain.deviationMean);
  });

  it('an open mesh: no volume or shape symmetry (not_closed), the area symmetry and the deviation still', () => {
    // without the triangles round the −Z pole
    const keep: number[] = [];
    for (let t = 0; 3 * t < S1.index.length; t++) {
      const z = [0, 1, 2].map((k) => S1.positions[3 * S1.index[3 * t + k] + 2]);
      if (Math.min(...z) > -0.95 * C) keep.push(S1.index[3 * t], S1.index[3 * t + 1], S1.index[3 * t + 2]);
    }
    const open = { positions: S1.positions, index: new Uint32Array(keep) };
    expect(closedOf(open)).toBe(false);
    expect(prepared(open).interiorSamples.length).toBe(0);
    const v = valuesOf(compute(open, YZ));
    expect([v.volumeSymmetry, v.shapeSymmetry, v.volumeA, v.volumeB]).toEqual([null, null, null, null]);
    expect(v.reasons).toEqual({ volume: 'not_closed', area: null, shape: 'not_closed', deviation: null });
    expect(Math.abs(v.areaSymmetry! - 1)).toBeLessThan(1e-9);
    expect(v.deviationMean!).toBeLessThan(1e-6);
  });

  it('a plane that does not cut the mesh: none of the three (no_cut), the deviation still', () => {
    const r = compute(S1, { point: [2 * A, 0, 0], normal: [1, 0, 0] });
    expect(r.shape).toBeNull();
    const v = valuesOf(r);
    expect([v.volumeSymmetry, v.areaSymmetry, v.shapeSymmetry, v.volumeA, v.areaA]).toEqual([null, null, null, null, null]);
    expect(v.reasons).toEqual({ volume: 'no_cut', area: 'no_cut', shape: 'no_cut', deviation: null });
    expect(v.deviationMean!).toBeGreaterThan(A);
  });

  it('the parameters are named and as asked', () => {
    expect(SYMMETRY_PARAMETERS).toMatchObject({ SYM_OVERLAP_SAMPLES: 50000, SYM_DEVIATION_SAMPLES: 50000, DEVIATION_QUANTILE: 0.95, EMPTY_SIDE_SHARE: 1e-9 });
    // three unit directions, none along an axis
    for (const d of SYMMETRY_PARAMETERS.SYM_RAY_DIRECTIONS) {
      expect(Math.hypot(...d)).toBeCloseTo(1, 5);
      for (const x of d) expect(Math.abs(x)).toBeGreaterThan(0.1);
    }
    expect(Object.keys(SYMMETRY_PARAMETERS).sort()).toEqual(['DEVIATION_QUANTILE', 'EMPTY_SIDE_SHARE', 'SYM_DEVIATION_SAMPLES', 'SYM_OVERLAP_SAMPLES', 'SYM_RAY_DIRECTIONS']);
  });

  it('the weighted quantile', () => {
    expect(weightedQuantile([1, 2, 3, 4], [1, 1, 1, 1], 0.95)).toBe(4);
    expect(weightedQuantile([4, 1, 3, 2], [1, 1, 1, 1], 0.5)).toBe(2);
    expect(weightedQuantile([1, 2, 3], [0.5, 0.5, 9], 0.04)).toBe(1);
    expect(weightedQuantile([1, 2, 3], [0.5, 0.5, 9], 0.2)).toBe(3);
  });
});

describe('the references', () => {
  it('their planes from the sources: a plane, a closed curve turned by upHint, the frames’ mid-planes; none without one', () => {
    const s = new ProjectStore(emptyProject());
    const ring: Vec3[] = Array.from({ length: 16 }, (_, k) => [10 * Math.cos((k * Math.PI) / 8), 10 * Math.sin((k * Math.PI) / 8), 5]);
    const c = addCurve(s, { anchors: ring, points: ring, anchorIndex: ring.map((_, i) => i), closed: true });
    const planes = [{ id: 'p', label: 'P1', method: 'curves' as const, valid: true, center: [1, 2, 3] as Vec3, normal: [0, 1, 0] as Vec3, matrix: null, inputCount: 3 }];
    const centroid: Vec3 = [4, 5, 6];
    const at = (source: Parameters<typeof addSymmetry>[1], up: Vec3 = [0, 0, 1]) => symmetrySource({ source, upHint: up }, s.state, planes, centroid);
    expect(at({ kind: 'plane', planeId: 'p' })).toEqual({ plane: { point: [1, 2, 3], normal: [0, 1, 0] }, curveId: null });
    expect(at({ kind: 'plane', planeId: 'gone' })).toBeNull();
    expect(at({ kind: 'curve', curveId: c.id })!.plane.normal[2]).toBeCloseTo(1, 9);
    expect(at({ kind: 'curve', curveId: c.id }, [0, 0, -1])!.plane.normal[2]).toBeCloseTo(-1, 9);
    expect(at({ kind: 'curve', curveId: c.id })!.plane.point[2]).toBeCloseTo(5, 9);
    expect(at({ kind: 'curve', curveId: c.id })!.curveId).toBe(c.id);
    // no specimen frame, no technological frame (a core's): none
    expect(at({ kind: 'frame', frame: 'specimen', axis: 'x' })).toBeNull();
    expect(at({ kind: 'frame', frame: 'technological', axis: 'x' })).toBeNull();
    // the specimen frame: through the surface centroid
    const m = frameMatrix({ origin: [9, 9, 9], x: [0, 1, 0], y: [0, 0, 1], z: [1, 0, 0] });
    updateSpecimen(s, { frame: { matrix: m, source: 'view' } }, false);
    expect(at({ kind: 'frame', frame: 'specimen', axis: 'x' })).toEqual({ plane: { point: centroid, normal: [0, 1, 0] }, curveId: null });
    expect(at({ kind: 'frame', frame: 'specimen', axis: 'z' })!.plane.normal).toEqual([1, 0, 0]);
    // a flake's technological frame: through the point of percussion
    setSpecimenType(s, 'flake');
    setTechnologicalAxis(s, { start: [1, 1, 1], end: [1, 11, 1], startNormal: [0, 0, 1], endNormal: [0, 0, 1], matrix: frameMatrix({ origin: [1, 1, 1], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }), failure: null });
    const tech = at({ kind: 'frame', frame: 'technological', axis: 'x' })!.plane;
    tech.point.forEach((x) => expect(x).toBeCloseTo(1, 9));
    expect(tech.normal).toEqual([1, 0, 0]);
  });

  it('are kept in the project file, labelled in turn; every change one undo step', () => {
    const s = new ProjectStore(emptyProject());
    const a = addSymmetry(s, { kind: 'frame', frame: 'specimen', axis: 'y' }, [0, 0, 1]);
    const b = addSymmetry(s, { kind: 'plane', planeId: 'p' }, [0, 0, 1]);
    expect([a.label, b.label]).toEqual(['S1', 'S2']);
    swapSymmetry(s, a.id);
    setSymmetryNote(s, a.id, 'bifacial');
    expect(s.state.symmetry[0]).toMatchObject({ swap: true, note: 'bifacial' });
    expect('optimize' in s.state.symmetry[0]).toBe(false);
    const back = parseProjectFile(JSON.parse(JSON.stringify(serializeProject(s.state, 'test'))));
    expect(back.symmetry).toEqual(s.state.symmetry);
    expect(back.nextSymmetryNumber).toBe(3);
    s.history.undo();
    expect(s.state.symmetry[0]).toMatchObject({ swap: true, note: '' });
  });

  it('a reference of stage 34 with `optimize` is read, the field let go; its stored values give the volume and area symmetries', () => {
    const s = new ProjectStore(emptyProject());
    addSymmetry(s, { kind: 'frame', frame: 'specimen', axis: 'x' }, [0, 0, 1]);
    const raw = JSON.parse(JSON.stringify(serializeProject(s.state, 'test')));
    raw.symmetry[0].optimize = true;
    const back = parseProjectFile(raw);
    expect(back.symmetry).toHaveLength(1);
    expect('optimize' in back.symmetry[0]).toBe(false);
    expect(back.symmetry[0]).toMatchObject({ label: 'S1', source: { kind: 'frame', frame: 'specimen', axis: 'x' } });
    // what stage 34 stored: no symmetries, a ratio, the best plane's angle
    const old = { id: back.symmetry[0].id, sourcePlane: null, plane: { point: [0, 0, 0], normal: [1, 0, 0] }, optimized: true, rounds: 3, angleToSourceDeg: 2, offsetToSource: 1, volumeA: 30, volumeB: 40, volumeRatio: 0.75, areaA: 10, areaB: 8, deviationMean: 0.2, deviationRms: 0.3, deviationP95: 0.5, reasons: { volume: null, area: null, deviation: null } };
    const [v] = storedSymmetry({ symmetry: { refs: [old] } }, back);
    expect(v).toEqual({
      id: old.id,
      plane: { point: [0, 0, 0], normal: [1, 0, 0] },
      volumeSymmetry: 0.75,
      areaSymmetry: 0.8,
      shapeSymmetry: null,
      volumeA: 30,
      volumeB: 40,
      areaA: 10,
      areaB: 8,
      deviationMean: 0.2,
      deviationRms: 0.3,
      deviationP95: 0.5,
      reasons: { volume: null, area: null, shape: null, deviation: null },
    });
  });

  it('symmetry.csv: one row per reference, as asked; the empty ones by their reasons; measurements.csv without the upper and lower volumes', () => {
    const s = new ProjectStore(emptyProject());
    updateSpecimen(s, { id: 'K1', unit: 'mm' });
    const a = addSymmetry(s, { kind: 'frame', frame: 'specimen', axis: 'x' }, [0, 0, 1]);
    const b = addSymmetry(s, { kind: 'plane', planeId: 'gone' }, [0, 0, 1]);
    const c = addSymmetry(s, { kind: 'frame', frame: 'specimen', axis: 'y' }, [0, 0, 1]);
    setSymmetryNote(s, b.id, 'a, b');
    const v = symmetryValues({ id: a.id, swap: false }, compute(S2, YZ), [0, 0, 0]);
    const cut = symmetryValues({ id: c.id, swap: false }, compute(S1, { point: [2 * A, 0, 0], normal: [1, 0, 0] }), [0, 0, 0]);
    const csv = symmetryCsv(s.state, [v, cut], { excelBom: false }).trim().split('\n');
    expect(csv[0]).toBe('specimen_id,symmetry_id,source,source_id,volume_symmetry,area_symmetry,shape_symmetry,volume_a,volume_b,area_a,area_b,deviation_mean,deviation_rms,deviation_p95,unit,note');
    const row = csv[1].split(',');
    expect(row.slice(0, 4)).toEqual(['K1', 'S1', 'frame', 'specimen_x']);
    expect(Number(row[4])).toBeCloseTo(v.volumeSymmetry!, 6);
    expect(Number(row[5])).toBeCloseTo(v.areaSymmetry!, 6);
    expect(Number(row[6])).toBeCloseTo(v.shapeSymmetry!, 6);
    expect(Number(row[7])).toBeCloseTo(v.volumeA!, 3);
    expect(Number(row[10])).toBeCloseTo(v.areaB!, 3);
    expect(Number(row[11])).toBeCloseTo(v.deviationMean!, 5);
    expect(row[14]).toBe('mm');
    // a reference without its values: empty cells; a plane that is gone: no label
    expect(csv[2]).toBe('K1,S2,plane,,,,,,,,,,,,mm,"a, b"');
    // a plane that does not cut: no symmetries, no sides; the deviation
    const third = csv[3].split(',');
    expect(third.slice(4, 11)).toEqual(['', '', '', '', '', '', '']);
    expect(Number(third[11])).toBeGreaterThan(A);
    const head = measurementsCsv(s.state, null, { excelBom: false }).split('\n')[0].split(',');
    for (const col of ['volume_upper', 'volume_lower', 'volume_ratio']) expect(head).not.toContain(col);
  });
});

/** The references' scheduler on the page's engine (no worker): what it asks for, and what the engine did. */
function scheduler() {
  const backend = pageBackend();
  const sent: SymmetryRequest[] = [];
  let hook: ((m: SymmetryReply) => void) | null = null;
  const watched = {
    inWorker: false,
    send: (m: SymmetryRequest) => {
      sent.push(m);
      backend.send(m);
    },
    listen: (f: (m: SymmetryReply) => void) =>
      backend.listen((m) => {
        f(m);
        hook?.(m);
      }),
    dispose: () => backend.dispose(),
  };
  const runner = new SymmetryRunner(watched, () => {});
  const model: SymmetryModel = { positions: S2.positions, index: S2.index, offset: [0, 0, 0], closed: true, chainOf: async () => null };
  const s = new ProjectStore(emptyProject());
  const ref = addSymmetry(s, { kind: 'plane', planeId: 'p' }, [0, 0, 1]);
  const plane = (normal: Vec3): PlaneResult[] => [{ id: 'p', label: 'P1', method: 'curves', valid: true, center: [0, 0, 0], normal, matrix: null, inputCount: 3 }];
  const tasks = () => sent.filter((m) => m.type === 'task') as Array<Extract<SymmetryRequest, { type: 'task' }>>;
  const settled = async () => {
    for (let i = 0; i < 2000 && runner.busy; i++) await new Promise((r) => setTimeout(r, 5));
    expect(runner.busy).toBe(false);
  };
  return { backend, runner, model, s, ref, plane, tasks, settled, setHook: (f: typeof hook) => (hook = f) };
}

describe('the task scheduler (the same with or without the worker)', () => {
  it('a new task drops the part in hand when it no longer asks for it', async () => {
    const x = scheduler();
    const p1 = x.plane([1, 0, 0]), p2 = x.plane([0, 1, 0]);
    let switched = false;
    // once the first plane's shape is begun, another plane
    x.setHook((m) => {
      if (!switched && m.type === 'progress' && m.stage === 'shape') {
        switched = true;
        x.runner.update(x.s.state, p2, x.model);
      }
    });
    x.runner.update(x.s.state, p1, x.model);
    expect(x.runner.shown(x.ref, [0, 0, 0]).progress).not.toBeNull();
    await x.settled();
    expect(switched).toBe(true);
    const [k1, k2] = x.tasks().map((t) => t.jobs[0].key);
    expect(k1).not.toBe(k2);
    // the first plane's shape was let go midway and never told; the second's every part was computed
    expect(x.backend.engine.log).toContainEqual({ key: k1, phase: 'shape', outcome: 'dropped' });
    expect(x.backend.engine.log.filter((l) => l.key === k1 && l.outcome === 'done').map((l) => l.phase)).toEqual(['sides', 'deviation']);
    expect(x.backend.engine.log.filter((l) => l.key === k2 && l.outcome === 'done').map((l) => l.phase).sort()).toEqual(['deviation', 'shape', 'sides']);
    const v = x.runner.values(x.s.state, [0, 0, 0]);
    expect(v).toHaveLength(1);
    expect(v[0].plane!.normal).toEqual([0, 1, 0]);
    // S2 is symmetric about XZ: all three near 1
    expect(v[0].shapeSymmetry!).toBeGreaterThan(0.99);
  });

  it('inputs used before: their values at once, nothing computed again; a swap, a label or a note computes nothing', async () => {
    const x = scheduler();
    const p1 = x.plane([1, 0, 0]), p2 = x.plane([0, 1, 0]);
    x.runner.update(x.s.state, p1, x.model);
    await x.settled();
    const first = x.runner.values(x.s.state, [0, 0, 0])[0];
    x.runner.update(x.s.state, p2, x.model);
    // asked for, being computed: the values before stay (faded in the card) until the new ones come
    const shown = x.runner.shown(x.ref, [0, 0, 0]);
    expect(shown.progress).not.toBeNull();
    expect(shown.before!.shapeSymmetry).toBe(first.shapeSymmetry);
    await x.settled();
    const sentBefore = x.tasks().length;
    const runsBefore = x.backend.engine.log.length;
    // back to the first plane: from the cache, at once
    x.runner.update(x.s.state, p1, x.model);
    expect(x.runner.shown(x.ref, [0, 0, 0]).progress).toBeNull();
    expect(x.runner.values(x.s.state, [0, 0, 0])[0]).toEqual(first);
    swapSymmetry(x.s, x.ref.id);
    setSymmetryLabel(x.s, x.ref.id, 'mid');
    setSymmetryNote(x.s, x.ref.id, 'n');
    x.runner.update(x.s.state, p1, x.model);
    expect(x.runner.busy).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(x.tasks().length).toBe(sentBefore);
    expect(x.backend.engine.log.length).toBe(runsBefore);
    // swapped: A and B the other way round, nothing else
    const now = x.runner.values(x.s.state, [0, 0, 0])[0];
    expect([now.volumeA, now.volumeB, now.shapeSymmetry]).toEqual([first.volumeB, first.volumeA, first.shapeSymmetry]);
  });

  it('keeps at most SYMMETRY_CACHE_SIZE results, the oldest let go first', async () => {
    const x = scheduler();
    const normal = (i: number): Vec3 => [Math.cos((i * Math.PI) / 40), Math.sin((i * Math.PI) / 40), 0];
    for (let i = 0; i <= SYMMETRY_CACHE_SIZE; i++) {
      x.runner.update(x.s.state, x.plane(normal(i)), x.model);
      await x.settled();
    }
    const sent = x.tasks().length;
    // the newest is there; the oldest was let go
    x.runner.update(x.s.state, x.plane(normal(1)), x.model);
    expect(x.runner.busy).toBe(false);
    x.runner.update(x.s.state, x.plane(normal(0)), x.model);
    expect(x.runner.busy).toBe(true);
    await x.settled();
    expect(x.tasks().length).toBe(sent + 1);
  }, 120_000);
});

describe('left–right pairs of a flake’s grid points', () => {
  it('on a flake symmetric about technological X = 0: each pair mirrored, all but the middle paired once', () => {
    const m = flakeT1();
    const s = new ProjectStore(emptyProject());
    setSpecimenType(s, 'flake');
    setTechnologicalAxis(s, { start: [0, 0, 0], end: T1.A, startNormal: [0, 0, 1], endNormal: [0, 0, 1], matrix: frameMatrix({ origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }), failure: null });
    const shape = (points: Vec3[], closed: boolean) => ({ anchors: points, points, anchorIndex: points.map((_, i) => i), closed });
    const outline = addCurve(s, shape([[-15, 0, 0], [0, 0, 0], [15, 0, 0], [15, -2, 10], [-15, -2, 10]], true));
    setCurveAttribute(s, outline.id, 'type', 'platform_outline');
    for (const x of [-15, 15]) placePlatformEnd(s, [x, 0, 0]);
    const edge = addCurve(s, shape([[-15, 0, 0], [-15, 60, 0], [15, 60, 0], [15, 0, 0]], false));
    setCurveAttribute(s, edge.id, 'type', 'edge');
    const platformFaces: number[] = [];
    for (let t = 0; 3 * t < m.index.length; t++) if ([0, 1, 2].every((k) => Math.abs(m.positions[3 * m.index[3 * t + k] + 2] + 5 * m.positions[3 * m.index[3 * t + k] + 1]) < 1e-3)) platformFaces.push(t);
    const r = gmPoints(s.state, { positions: m.positions, index: m.index, platformFaces });
    expect(r.complete).toBe(true);
    const pairs = gmLandPairs(r);
    const at = (i: number) => r.rows[i - 1].point!;
    // mirrored: x opposite (the left one at x < 0), y and z alike, to a float's step on a model 60 long
    for (const [l, rr] of pairs) {
      const p = at(l), q = at(rr);
      expect(p[0]).toBeLessThan(0);
      expect(Math.abs(p[0] + q[0])).toBeLessThan(1e-4);
      expect(Math.abs(p[1] - q[1])).toBeLessThan(1e-4);
      expect(Math.abs(p[2] - q[2])).toBeLessThan(1e-4);
    }
    const used = pairs.flat();
    expect(new Set(used).size).toBe(used.length);
    const middle = r.rows.filter((x) => Math.abs(x.point![0]) < 1e-4).length;
    expect(2 * pairs.length).toBe(r.rows.length - middle);
    // the point of percussion, the edge's middle point (50: none), the outer rim's (10: none), the grids' middle columns (10 and 8: none)
    expect(middle).toBe(1);
    expect(pairs[0]).toEqual([r.rows.find((x) => x.name === 'platform_left')!.index, r.rows.find((x) => x.name === 'platform_right')!.index]);
    expect(gmLandPairsCsv(r).split('\n')[0]).toBe('left,right');
    expect(gmLandPairsCsv(r).trim().split('\n')).toHaveLength(pairs.length + 1);
  });
});

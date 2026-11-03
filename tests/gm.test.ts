import { describe, expect, it } from 'vitest';
import { GM_OUTLINE_SETS, gmCounts, gmMissingInputs, gmPoints, gmTotal, type GmResult } from '../src/compute/gm';
import { addCurve, addLandmark, addSemilandmarkSet, placePlatformEnd, setCurveAttribute, setGmConfig, setSpecimenType, setTechnicalAxis } from '../src/core/actions';
import { frameAxes, frameMatrix } from '../src/core/frame';
import { parseGmConfig, parseProjectFile, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import { defaultGmConfig, type GmConfig, type Vec3 } from '../src/core/types';
import { gmOutputs, type BatchSpecimen } from '../src/io/batch';
import { gmCurvesCsv, gmSurfacesCsv, landmarksCsv, landmarksTps } from '../src/io/landmarks';
import { ellipsoid, flakeT1, mapped, rigid, T1, type Mesh } from './meshes';

const id3 = (p: Vec3): Vec3 => p;
const shape = (points: Vec3[], closed: boolean) => ({ anchors: points, points, anchorIndex: points.map((_, i) => i), closed });

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

interface Scene {
  s: ProjectStore;
  m: Mesh;
  /** Into the frame of the specimen as first made, whichever way it was moved. */
  run: (changes?: Partial<GmConfig>) => GmResult;
  platformFaces: number[];
}

/** T1, annotated: the axis, the platform's two ends and its outline, the edge; moved by `f`. */
function t1Scene(f: (p: Vec3) => Vec3 = id3, opts: { closedEdge?: boolean; ends?: boolean; outline?: boolean; edge?: boolean } = {}): Scene {
  const m = mapped(flakeT1(), f);
  const s = new ProjectStore(emptyProject());
  setSpecimenType(s, 'flake');
  const o = f([0, 0, 0]);
  const dir = (a: Vec3): Vec3 => {
    const b = f(a);
    return [b[0] - o[0], b[1] - o[1], b[2] - o[2]];
  };
  const matrix = frameMatrix({ origin: o, x: dir([1, 0, 0]), y: dir([0, 1, 0]), z: dir([0, 0, 1]) });
  const n: Vec3 = dir([0, 0, 1]);
  setTechnicalAxis(s, { start: o, end: f(T1.A), startNormal: n, endNormal: n, matrix, failure: null });
  const corner = (x: number, k: number): Vec3 => f([x, -2 * k, 10 * k]);
  if (opts.outline !== false) {
    const c = addCurve(s, shape([f([-15, 0, 0]), f([0, 0, 0]), f([15, 0, 0]), corner(15, 1), corner(-15, 1)], true));
    setCurveAttribute(s, c.id, 'type', 'platform_outline');
  }
  if (opts.ends !== false) for (const x of [-15, 15]) placePlatformEnd(s, f([x, 0, 0]));
  if (opts.edge !== false) {
    const edge: Vec3[] = [[-15, 0, 0], [-15, 60, 0], [15, 60, 0], [15, 0, 0]];
    // closed: on along the platform, back to where it began
    const points = (opts.closedEdge ? [...edge, [15, -2, 10], [-15, -2, 10]] as Vec3[] : edge).map(f);
    const c = addCurve(s, shape(points, !!opts.closedEdge));
    setCurveAttribute(s, c.id, 'type', 'edge');
  }
  // the face P–E, by its triangles
  const platformFaces: number[] = [];
  const base = flakeT1();
  for (let t = 0; 3 * t < base.index.length; t++) {
    const ids = [base.index[3 * t], base.index[3 * t + 1], base.index[3 * t + 2]];
    const on = ids.every((v) => Math.abs(base.positions[3 * v + 2] + 5 * base.positions[3 * v + 1]) < 1e-3);
    if (on) platformFaces.push(t);
  }
  const run = (changes: Partial<GmConfig> = {}) => {
    setGmConfig(s, changes);
    return gmPoints(s.state, { positions: m.positions, index: m.index, platformFaces });
  };
  return { s, m, run, platformFaces };
}

/** In the specimen's technical frame. */
const inFrame = (s: ProjectStore, p: Vec3): Vec3 => {
  const f = frameAxes(s.state.flake.axis!.matrix!);
  const d: Vec3 = [p[0] - f.origin[0], p[1] - f.origin[1], p[2] - f.origin[2]];
  return [d[0] * f.x[0] + d[1] * f.x[1] + d[2] * f.x[2], d[0] * f.y[0] + d[1] * f.y[1] + d[2] * f.y[2], d[0] * f.z[0] + d[1] * f.z[1] + d[2] * f.z[2]];
};
const ofSet = (r: GmResult, set: string) => r.rows.filter((x) => x.setId === set);

describe('the points of a flake', () => {
  it('the default: as many as asked for, the ends of the curves written once', () => {
    const { run } = t1Scene();
    const r = run();
    expect(r.missing).toEqual([]);
    expect(r.complete).toBe(true);
    const c = defaultGmConfig();
    expect(gmCounts(c)).toEqual({ fixed: 3, edge: 50, platformOutline: 30, ventral: 150, dorsal: 150, platform: 32 });
    // 3 fixed, 48 + 3 × 8 between the ends, the grids
    expect(gmTotal(c)).toBe(3 + 48 + 24 + 150 + 150 + 32);
    expect(r.rows.length).toBe(gmTotal(c));
    expect(r.rows.map((x) => x.index)).toEqual(r.rows.map((_, i) => i + 1));
    expect(ofSet(r, 'edge').length).toBe(48);
    for (const set of GM_OUTLINE_SETS) expect(ofSet(r, set).length).toBe(8);
    expect(r.surfaces.length).toBe(332);
    expect(r.curves.length).toBe(48 + 24);
  });

  it('the order: fixed, curves, surfaces, ventral before dorsal before platform', () => {
    const r = t1Scene().run();
    expect(r.rows.slice(0, 3).map((x) => [x.name, x.kind])).toEqual([['pop', 'fixed'], ['platform_left', 'fixed'], ['platform_right', 'fixed']]);
    const kinds = r.rows.map((x) => x.kind);
    expect(kinds.lastIndexOf('fixed')).toBeLessThan(kinds.indexOf('curve'));
    expect(kinds.lastIndexOf('curve')).toBeLessThan(kinds.indexOf('surface'));
    const sets = [...new Set(r.rows.map((x) => x.setId))];
    expect(sets).toEqual(['', 'edge', ...GM_OUTLINE_SETS, 'ventral', 'dorsal', 'platform']);
  });

  it('counts follow the configuration, and an item can be left out', () => {
    const { run } = t1Scene();
    const c = defaultGmConfig();
    const change: Partial<GmConfig> = { edge: { on: true, points: 20 }, platformOutline: { on: false, points: 10 }, ventral: { on: true, rows: 3, cols: 4 }, dorsal: { on: false, rows: 15, cols: 10 }, platform: { on: true, rows: 2, cols: 2 } };
    const r = run(change);
    expect(r.complete).toBe(true);
    expect(r.rows.length).toBe(gmTotal({ ...c, ...change }));
    expect(r.rows.length).toBe(3 + 18 + 12 + 4);
    expect(ofSet(r, 'ventral').length).toBe(12);
    expect(ofSet(r, 'dorsal').length).toBe(0);
    expect(ofSet(r, GM_OUTLINE_SETS[0]).length).toBe(0);
  });

  it('a fixed landmark left out: the end of a curve is still one point, written where it is first needed', () => {
    const { run } = t1Scene();
    const c = defaultGmConfig();
    const change: Partial<GmConfig> = { fixed: { pop: false, platform_left: true, platform_right: false } };
    const r = run(change);
    expect(r.complete).toBe(true);
    expect(r.rows.filter((x) => x.kind === 'fixed').map((x) => x.name)).toEqual(['platform_left']);
    expect(r.rows.filter((x) => x.name === 'platform_right').length).toBe(1);
    expect(r.rows.filter((x) => x.name === 'pop').length).toBe(1);
    expect(r.rows.length).toBe(gmTotal({ ...c, ...change }));
    // only the curve that does not end on them
    const noCurves = run({ fixed: { pop: false, platform_left: false, platform_right: false }, edge: { on: false, points: 50 }, platformOutline: { on: false, points: 10 } });
    expect(noCurves.rows.filter((x) => ['pop', 'platform_left', 'platform_right'].includes(x.name))).toEqual([]);
  });
});

describe('the edge', () => {
  it('runs from the platform\'s left end by the distal end to its right end: clockwise, seen with the dorsal face toward the viewer', () => {
    const { s, run } = t1Scene();
    const r = run();
    const edge = ofSet(r, 'edge');
    const left = r.rows.find((x) => x.name === 'platform_left')!.point;
    const right = r.rows.find((x) => x.name === 'platform_right')!.point;
    expect(left).toEqual([-15, 0, 0]);
    expect(right).toEqual([15, 0, 0]);
    // the first point after the left end lies on the left side, going distally
    const first = inFrame(s, edge[0].point), last = inFrame(s, edge[edge.length - 1].point);
    expect(first[0]).toBeCloseTo(-15, 6);
    expect(first[1]).toBeGreaterThan(0);
    expect(last[0]).toBeCloseTo(15, 6);
    expect(last[1]).toBeGreaterThan(0);
    // evenly along the line: 148.2... the length 60 + 30 + 60
    const step = 150 / 49;
    expect(first[1]).toBeCloseTo(step, 6);
    // over the distal end from left to right
    const distal = edge.map((x) => inFrame(s, x.point)).filter((p) => p[1] === 60).map((p) => p[0]);
    expect(distal.length).toBeGreaterThan(5);
    expect([...distal].sort((a, b) => a - b)).toEqual(distal);
  });

  it('a curve drawn the other way round gives the same points', () => {
    const a = t1Scene();
    const b = t1Scene();
    const c = b.s.state.curves.find((x) => x.attributes.type === 'edge')!;
    const reversed = [...c.points].reverse();
    const forward = b.s.state.curves.find((x) => x.attributes.type === 'edge')!.points;
    expect(forward.length).toBe(reversed.length);
    b.s.state.curves.find((x) => x.attributes.type === 'edge')!.points = reversed;
    expect(b.run().rows.filter((x) => x.setId === 'edge')).toEqual(a.run().rows.filter((x) => x.setId === 'edge'));
  });

  it('a closed curve is cut at the ends, and the part away from the platform taken', () => {
    const open = t1Scene().run();
    const closed = t1Scene(id3, { closedEdge: true }).run();
    expect(closed.complete).toBe(true);
    const pts = (r: GmResult) => ofSet(r, 'edge').map((x) => x.point);
    expect(pts(closed).length).toBe(pts(open).length);
    pts(closed).forEach((p, i) => {
      for (let k = 0; k < 3; k++) expect(p[k]).toBeCloseTo(pts(open)[i][k], 5);
    });
  });

  it('without platform ends it begins and ends at the point of percussion', () => {
    const { s, run } = t1Scene(id3, { ends: false, outline: false });
    const r = run({ fixed: { pop: true, platform_left: false, platform_right: false }, platformOutline: { on: false, points: 10 }, platform: { on: false, rows: 4, cols: 8 } });
    expect(r.complete).toBe(true);
    const edge = ofSet(r, 'edge');
    expect(edge.length).toBe(48);
    // pop is point 1; the curve begins and ends on it
    expect(r.curves[0]).toEqual([1, edge[0].index, edge[1].index]);
    expect(r.curves[r.curves.length - 1]).toEqual([edge[46].index, edge[47].index, 1]);
    // clockwise: on the left side first
    expect(inFrame(s, edge[2].point)[0]).toBeLessThan(0);
    expect(inFrame(s, edge[45].point)[0]).toBeGreaterThan(0);
    expect(r.rows.length).toBe(gmTotal(s.state.gm, true));
  });
});

describe('the platform outline', () => {
  it('in three parts: left end to the point of percussion, on to the right end, and back round the outer rim', () => {
    const { s, run } = t1Scene();
    const r = run({ platformOutline: { on: true, points: 6 } });
    const of = (i: number) => ofSet(r, GM_OUTLINE_SETS[i]).map((x) => inFrame(s, x.point));
    expect(of(0).length).toBe(4);
    // left → pop: x from −15 to 0 in steps of 3, on the inner rim
    expect(of(0).map((p) => Math.round(p[0] * 1e6) / 1e6)).toEqual([-12, -9, -6, -3]);
    expect(of(1).map((p) => Math.round(p[0] * 1e6) / 1e6)).toEqual([3, 6, 9, 12]);
    for (const p of [...of(0), ...of(1)]) expect(p[2]).toBeCloseTo(0, 6);
    // right → left: round the far side
    const outer = of(2);
    expect(outer[0][0]).toBeCloseTo(15, 6);
    expect(outer[outer.length - 1][0]).toBeCloseTo(-15, 6);
    expect(outer.every((p) => p[2] > 0)).toBe(true);
  });

  it('whichever way the outline was drawn', () => {
    const a = t1Scene();
    const b = t1Scene();
    const c = b.s.state.curves.find((x) => x.attributes.type === 'platform_outline')!;
    c.points = [...c.points].reverse();
    const pts = (r: GmResult, i: number) => ofSet(r, GM_OUTLINE_SETS[i]).map((x) => x.point);
    const ra = a.run(), rb = b.run();
    for (const i of [0, 1, 2]) {
      pts(ra, i).forEach((p, k) => {
        for (let d = 0; d < 3; d++) expect(p[d]).toBeCloseTo(pts(rb, i)[k][d], 5);
      });
    }
  });

  it('a point of percussion off the outline: the parts part at the nearest point of it, and still end on the landmark', () => {
    const { s, run } = t1Scene();
    const c = s.state.curves.find((x) => x.attributes.type === 'platform_outline')!;
    // the outline passes a little beside the point of percussion
    c.points = [[-15, 0, 0], [0, 0.5, 0.2], [15, 0, 0], [15, -2, 10], [-15, -2, 10]];
    const r = run({ platformOutline: { on: true, points: 6 } });
    expect(r.complete).toBe(true);
    const first = r.curves.find((x) => x[1] === ofSet(r, GM_OUTLINE_SETS[0])[3].index)!;
    expect(first[2]).toBe(1);
  });
});

describe('the sliding definition', () => {
  it('gm_curves.csv: each point between its neighbours, the ends of a curve (fixed points) not sliding', () => {
    const r = t1Scene().run({ edge: { on: true, points: 5 }, platformOutline: { on: true, points: 3 }, ventral: { on: false, rows: 1, cols: 1 }, dorsal: { on: false, rows: 1, cols: 1 }, platform: { on: false, rows: 1, cols: 1 } });
    // 1 pop, 2 left, 3 right; 4, 5, 6 along the edge; 7, 8, 9 one each along the outline
    expect(gmCurvesCsv(r).trim().split('\n')).toEqual(['before,slide,after', '2,4,5', '4,5,6', '5,6,3', '2,7,1', '1,8,3', '3,9,2']);
    expect(r.rows.length).toBe(9);
    for (const [, slide] of r.curves) expect(r.rows[slide - 1].kind).toBe('curve');
    const fixed = new Set([1, 2, 3]);
    expect(r.curves.some(([, slide]) => fixed.has(slide))).toBe(false);
  });

  it('gm_surfaces.csv: the surface points by number', () => {
    const r = t1Scene().run({ edge: { on: false, points: 5 }, platformOutline: { on: false, points: 3 }, ventral: { on: true, rows: 1, cols: 2 }, dorsal: { on: true, rows: 1, cols: 1 }, platform: { on: false, rows: 1, cols: 1 } });
    expect(gmSurfacesCsv(r).trim().split('\n')).toEqual(['index', '4', '5', '6']);
  });

  it('the user\'s own landmarks and sets go along, with their numbers made good', () => {
    const { s, run } = t1Scene();
    const mine = addLandmark(s, [0, 30, 0], 'mine');
    const c = addCurve(s, shape([[0, 20, 0], [0, 25, 0], [0, 40, 0]], false));
    const q = addSemilandmarkSet(s, c.id);
    expect(mine.name).toBe('mine');
    const r = run({ edge: { on: false, points: 5 }, platformOutline: { on: false, points: 3 }, ventral: { on: false, rows: 1, cols: 1 }, dorsal: { on: false, rows: 1, cols: 1 }, platform: { on: false, rows: 1, cols: 1 } });
    expect(r.rows.slice(0, 4).map((x) => x.name)).toEqual(['pop', 'platform_left', 'platform_right', 'mine']);
    const set = r.rows.filter((x) => x.setId === q.label);
    expect(set.length).toBe(q.count);
    expect(r.curves.length).toBeGreaterThan(0);
    for (const row of r.curves) for (const k of row) expect(r.rows[k - 1]).toBeDefined();
    // the sets stay in the exports of the landmarks as they were: this is a table of its own
    expect(s.state.landmarks.some((l) => l.name === 'mine')).toBe(true);
  });
});

describe('the surface grids', () => {
  const T3 = { a: 40, b: 25, c: 8 };

  /** T3 with its long axis along the frame's Y; moved by `f`. An ellipse round it as the edge, from the point of percussion. */
  function t3Scene(f: (p: Vec3) => Vec3 = id3): { s: ProjectStore; m: Mesh; run: (changes?: Partial<GmConfig>) => GmResult } {
    const m = mapped(ellipsoid(T3.a, T3.b, T3.c), f);
    const s = new ProjectStore(emptyProject());
    setSpecimenType(s, 'flake');
    const P = f([-T3.a, 0, 0]);
    const o = f([0, 0, 0]);
    const dir = (a: Vec3): Vec3 => {
      const b = f(a);
      return [b[0] - o[0], b[1] - o[1], b[2] - o[2]];
    };
    // Y along the long axis, Z toward the model's +z, X = Y × Z
    const matrix = frameMatrix({ origin: P, x: dir([0, -1, 0]), y: dir([1, 0, 0]), z: dir([0, 0, 1]) });
    const n = norm(dir([-1, 0, 0]));
    setTechnicalAxis(s, { start: P, end: f([T3.a, 0, 0]), startNormal: n, endNormal: n, matrix, failure: null });
    const ring = Array.from({ length: 128 }, (_, k): Vec3 => f([T3.a * Math.cos(Math.PI + (2 * Math.PI * k) / 128), T3.b * Math.sin(Math.PI + (2 * Math.PI * k) / 128), 0]));
    const c = addCurve(s, shape(ring, true));
    setCurveAttribute(s, c.id, 'type', 'edge');
    const off: Partial<GmConfig> = { fixed: { pop: true, platform_left: false, platform_right: false }, platformOutline: { on: false, points: 10 }, platform: { on: false, rows: 4, cols: 8 } };
    return {
      s,
      m,
      run: (changes = {}) => {
        setGmConfig(s, { ...off, ...changes });
        return gmPoints(s.state, { positions: m.positions, index: m.index, platformFaces: null });
      },
    };
  }

  /** Distance from a point to the mesh: to the nearest point of its nearest triangle. */
  function offSurface(m: Mesh, p: Vec3): number {
    let least = Infinity;
    const v = (i: number): Vec3 => [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]];
    const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (let t = 0; 3 * t < m.index.length; t++) {
      const a = v(m.index[3 * t]), b = v(m.index[3 * t + 1]), c = v(m.index[3 * t + 2]);
      // (only those near it)
      if (Math.hypot(...sub(a, p)) > 6) continue;
      const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
      const d00 = dot(ab, ab), d01 = dot(ab, ac), d11 = dot(ac, ac), d20 = dot(ap, ab), d21 = dot(ap, ac);
      const det = d00 * d11 - d01 * d01;
      if (det <= 0) continue;
      const s = (d11 * d20 - d01 * d21) / det, u = (d00 * d21 - d01 * d20) / det;
      // inside the triangle: the distance to its plane; the points of a grid lie in one by construction
      if (s < -1e-6 || u < -1e-6 || s + u > 1 + 1e-6) continue;
      const q: Vec3 = [a[0] + s * ab[0] + u * ac[0], a[1] + s * ab[1] + u * ac[1], a[2] + s * ab[2] + u * ac[2]];
      least = Math.min(least, Math.hypot(...sub(p, q)));
    }
    return least;
  }

  it('T3: the points lie on the surface, row by row and column by column', () => {
    const { s, m, run } = t3Scene();
    const r = run();
    expect(r.complete).toBe(true);
    const meanEdge = (2 * Math.PI * T3.b) / 128;
    for (const face of ['ventral', 'dorsal'] as const) {
      const pts = ofSet(r, face);
      expect(pts.length).toBe(150);
      for (const x of pts) expect(offSurface(m, x.point)).toBeLessThan(0.01 * meanEdge);
      const local = pts.map((x) => inFrame(s, x.point));
      // ventral: below, dorsal: above
      for (const p of local) expect(face === 'ventral' ? p[2] < 0 : p[2] > 0).toBe(true);
      for (let i = 0; i < 15; i++) {
        const row = local.slice(10 * i, 10 * i + 10);
        // a row at one Y, its columns from left to right
        for (const p of row) expect(p[1]).toBeCloseTo(row[0][1], 5);
        for (let j = 1; j < 10; j++) expect(row[j][0]).toBeGreaterThan(row[j - 1][0]);
        // rows from the platform to the distal end, at i / 16 of the length
        expect(row[0][1]).toBeCloseTo(((i + 1) / 16) * 2 * T3.a, 1);
        // columns evenly across this row's width
        const half = T3.b * Math.sqrt(1 - ((row[0][1] - T3.a) / T3.a) ** 2);
        expect(Math.abs(row[4][0] - (-half + (5 / 11) * 2 * half))).toBeLessThan(meanEdge);
      }
    }
  });

  it('T1: the faces as they are: flat ventral, sloping dorsal', () => {
    const r = t1Scene().run();
    for (const x of ofSet(r, 'ventral')) expect(x.point[2]).toBeCloseTo(0, 5);
    for (const x of ofSet(r, 'dorsal')) expect(x.point[2]).toBeCloseTo((10 * (60 - x.point[1])) / 62, 4);
  });

  it('T1: the platform\'s grid is regular, across its width and from the inner rim to the outer', () => {
    const { s, run } = t1Scene();
    const r = run();
    const pts = ofSet(r, 'platform').map((x) => inFrame(s, x.point));
    expect(pts.length).toBe(32);
    const R = 4, C = 8;
    for (let i = 0; i < R; i++) {
      for (let j = 0; j < C; j++) {
        const p = pts[i * C + j];
        // u: from the left end to the right, at (j + 1) / (C + 1)
        expect(p[0]).toBeCloseTo(-15 + ((j + 1) / (C + 1)) * 30, 4);
        // v: from the inner rim (z = 0) to the outer (z = 10), at (i + 1) / (R + 1)
        expect(p[2]).toBeCloseTo(((i + 1) / (R + 1)) * 10, 4);
        // on the face P–E
        expect(p[1]).toBeCloseTo(-p[2] / 5, 4);
      }
    }
  });

  it('a point that finds no triangle: incomplete, and says where', () => {
    const { m, s, platformFaces } = t1Scene();
    // the grid over a part of the platform region only
    const few = platformFaces.slice(0, 2);
    const r = gmPoints(s.state, { positions: m.positions, index: m.index, platformFaces: few });
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual(['platform_miss']);
    expect(gmPoints(s.state, { positions: m.positions, index: m.index, platformFaces: null }).missing).toEqual(['platform_region']);
  });

  it('the same in any position: T1 and T3', () => {
    const f = rigid([1, 2, 3], 40, [100, -50, 7]);
    const pairs: Array<[{ s: ProjectStore; run: () => GmResult }, { s: ProjectStore; run: () => GmResult }, number]> = [
      [t1Scene(), t1Scene(f), 1e-2],
      [t3Scene(), t3Scene(f), 2e-2],
    ];
    for (const [a, b, tolerance] of pairs) {
      const ra = a.run(), rb = b.run();
      expect(rb.rows.length).toBe(ra.rows.length);
      ra.rows.forEach((x, i) => {
        const p = inFrame(a.s, x.point), q = inFrame(b.s, rb.rows[i].point);
        for (let k = 0; k < 3; k++) expect(Math.abs(p[k] - q[k])).toBeLessThan(tolerance);
      });
    }
  });
});

describe('what a specimen lacks', () => {
  it('is told by name, and its points are left out', () => {
    const noEnds = t1Scene(id3, { ends: false });
    expect(noEnds.run().missing).toEqual(['platform_ends']);
    expect(noEnds.run().complete).toBe(false);
    expect(t1Scene(id3, { outline: false }).run().missing).toEqual(['platform_outline']);
    expect(t1Scene(id3, { edge: false }).run().missing).toEqual(['edge']);
    const empty = new ProjectStore(emptyProject());
    setSpecimenType(empty, 'flake');
    expect(gmMissingInputs(empty.state)).toEqual(['technical_axis', 'platform_ends', 'edge', 'platform_outline']);
  });

  it('nothing asked for: nothing lacks', () => {
    const empty = new ProjectStore(emptyProject());
    setSpecimenType(empty, 'flake');
    setGmConfig(empty, { fixed: { pop: false, platform_left: false, platform_right: false }, edge: { on: false, points: 5 }, platformOutline: { on: false, points: 5 }, ventral: { on: false, rows: 1, cols: 1 }, dorsal: { on: false, rows: 1, cols: 1 }, platform: { on: false, rows: 1, cols: 1 } });
    expect(gmMissingInputs(empty.state)).toEqual([]);
  });
});

describe('the configuration in the project', () => {
  it('goes through the file; what is not understood takes its default; one undo step', () => {
    const s = new ProjectStore(emptyProject());
    expect(s.state.gm).toEqual(defaultGmConfig());
    setGmConfig(s, { edge: { on: true, points: 30 } });
    expect(s.state.gm.edge.points).toBe(30);
    const file = JSON.parse(JSON.stringify(serializeProject(s.state, '0.2.0')));
    expect(parseProjectFile(file).gm.edge.points).toBe(30);
    s.history.undo();
    expect(s.state.gm.edge.points).toBe(50);
    delete file.gm;
    expect(parseProjectFile(file).gm).toEqual(defaultGmConfig());
    const odd = parseGmConfig({ edge: { on: 'x', points: 1 }, ventral: { on: false, rows: 2.5, cols: 9999 }, fixed: { pop: false } });
    expect(odd.edge).toEqual({ on: true, points: 50 });
    expect(odd.ventral).toEqual({ on: false, rows: 15, cols: 10 });
    expect(odd.fixed).toEqual({ pop: false, platform_left: true, platform_right: true });
  });

  it('a core\'s derived results have no points', () => {
    const s = new ProjectStore(emptyProject());
    const none: GmResult = { complete: true, missing: [], rows: [], curves: [], surfaces: [] };
    expect(serializeProject(s.state, '0.2.0', { measurements: null, vertices: null, gm: none }).derived.gm).toBeNull();
    setSpecimenType(s, 'flake');
    expect(serializeProject(s.state, '0.2.0', { measurements: null, vertices: null, gm: none }).derived.gm?.config).toEqual(defaultGmConfig());
  });
});

describe('the exports', () => {
  it('as the landmarks are: kinds and sets in the table, every point in the TPS', () => {
    const { s, run } = t1Scene();
    const r = run({ edge: { on: true, points: 4 }, platformOutline: { on: false, points: 3 }, ventral: { on: true, rows: 1, cols: 1 }, dorsal: { on: false, rows: 1, cols: 1 }, platform: { on: false, rows: 1, cols: 1 } });
    const rows = landmarksCsv(s.state, r, { excelBom: false }).trim().split('\n');
    expect(rows[0]).toBe('specimen_id,index,name,kind,set_id,x,y,z');
    expect(rows.length - 1).toBe(r.rows.length);
    expect(rows[1].startsWith(',1,pop,fixed,,')).toBe(true);
    expect(rows[4].split(',').slice(1, 5)).toEqual(['4', 'edge_2', 'curve', 'edge']);
    expect(rows[rows.length - 1].split(',').slice(1, 5)).toEqual([String(r.rows.length), 'ventral_1_1', 'surface', 'ventral']);
    expect(landmarksTps(s.state, r).split('\n')[0]).toBe(`LM3=${r.rows.length}`);
  });

  it('a batch: the complete flakes; the others skipped with what they lack, as those with another number of points', () => {
    const spec = (id: string, scene: Scene | null, file = `${id}.ply`) => {
      const s = scene?.s ?? new ProjectStore(emptyProject());
      if (!scene) updateId(s, id);
      else updateId(s, id);
      return { file, state: s.state, gm: scene ? { config: s.state.gm, ...scene.run() } : null } as unknown as BatchSpecimen;
    };
    const updateId = (s: ProjectStore, id: string) => {
      s.state.specimen.id = id;
    };
    const small: Partial<GmConfig> = { edge: { on: true, points: 5 }, platformOutline: { on: true, points: 3 }, ventral: { on: true, rows: 2, cols: 2 }, dorsal: { on: true, rows: 2, cols: 2 }, platform: { on: true, rows: 1, cols: 2 } };
    const scene = () => {
      const x = t1Scene();
      x.run(small);
      return x;
    };
    const extra = scene();
    addLandmark(extra.s, [0, 30, 0], 'mine');
    const out = gmOutputs(
      [spec('a', scene()), spec('b', t1Scene(id3, { ends: false })), spec('core', null), spec('c', scene()), spec('d', extra)],
      { excelBom: false },
    );
    expect(out.files.map((f) => f.suffix)).toEqual(['gm_landmarks.csv', 'gm_landmarks.tps', 'gm_curves.csv', 'gm_surfaces.csv']);
    expect(out.skipped).toEqual([{ file: 'b.ply', id: 'b', missing: ['platform_ends'] }, { file: 'd.ply', id: 'd', missing: ['point_count'] }]);
    const csv = out.files[0].text.trim().split('\n');
    expect(new Set(csv.slice(1).map((l) => l.split(',')[0]))).toEqual(new Set(['a', 'c']));
    expect(out.files[1].text.match(/LM3=/g)!.length).toBe(2);
    // nothing complete: no files
    expect(gmOutputs([spec('b', t1Scene(id3, { ends: false }))], { excelBom: false }).files).toEqual([]);
  });
});

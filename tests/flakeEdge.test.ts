import { describe, expect, it } from 'vitest';
import { morphDimensions } from '../src/compute/flake';
import { lineOffOutline, measuredLine, type MeasuredLine } from '../src/compute/measuredLine';
import { buildEdges, signedVolume } from '../src/compute/meshGeometry';
import { flakeFacePieces, joinOpenEndsSteps, polylineEdges, regionsSteps } from '../src/compute/regions';
import { retouchSections, type RetouchPiece } from '../src/compute/retouchAngle';
import { FACE_DORSAL, FACE_NONE, FACE_PLATFORM, FACE_VENTRAL, retouchIndices, segmentFrame, type RetouchCurve } from '../src/compute/retouchIndex';
import { runSync } from '../src/compute/steps';
import { addCurve, addWorkingEdge } from '../src/core/actions';
import { curveLength } from '../src/core/curveGeometry';
import { serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import { defaultRetouchSettings, type ProjectState, type Vec3 } from '../src/core/types';
import { edgeLabels } from '../src/compute/workingEdge';
import { flakeT1 } from './meshes';

/** A polyline through these corners, a point every `step`. */
function through(corners: Vec3[], closed: boolean, step = 1): Vec3[] {
  const out: Vec3[] = [];
  const stops = closed ? [...corners, corners[0]] : corners;
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i], b = stops[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n]);
  }
  if (!closed) out.push(stops[stops.length - 1]);
  return out;
}

const length = (l: MeasuredLine) => curveLength(l);
const near = (a: Vec3, b: Vec3, within = 1e-9) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= within;

// the flake of the end-to-end tests, seen from the ventral face: its width on x, its length on y, the platform off y = 0
const L: Vec3 = [-15, 0, 0], R: Vec3 = [15, 0, 0], FL: Vec3 = [-15, 60, 0], FR: Vec3 = [15, 60, 0];
const OUTLINE = through([L, R, [15, -2, 10], [-15, -2, 10]], true);

describe('what runs along the platform outline is no part of the edge', () => {
  it('a closed edge round the whole flake is measured from one end of the platform to the other', () => {
    const whole = through([L, FL, FR, R], true);
    expect(curveLength({ points: whole, closed: true })).toBeCloseTo(180, 9);
    const line = lineOffOutline({ points: whole, closed: true }, OUTLINE, 1, 2);
    expect(line.closed).toBe(false);
    expect(length(line)).toBeCloseTo(150, 9);
    expect(near(line.points[0], L) && near(line.points[line.points.length - 1], R)).toBe(true);
  });

  it('wherever the closed curve starts', () => {
    // from the middle of the platform's rim, and from the far end
    for (const start of [[[0, 0, 0], R, FR, FL, L], [[0, 60, 0], FL, L, R, FR]] as Vec3[][]) {
      const line = lineOffOutline({ points: through(start, true), closed: true }, OUTLINE, 1, 2);
      expect(line.closed).toBe(false);
      expect(length(line)).toBeCloseTo(150, 9);
      const ends = [line.points[0], line.points[line.points.length - 1]];
      expect(ends.some((p) => near(p, L)) && ends.some((p) => near(p, R))).toBe(true);
    }
  });

  it('along the outer rim of the platform as well as the inner', () => {
    const backOver: Vec3[] = [[-15, -2, 10], [-15, 60, 0], [15, 60, 0], [15, -2, 10]];
    const line = lineOffOutline({ points: through(backOver, true), closed: true }, OUTLINE, 1, 2);
    expect(line.closed).toBe(false);
    expect(length(line)).toBeCloseTo(curveLength({ points: through(backOver, false), closed: false }), 9);
  });

  it('an open edge ending on the outline, or just short of it, stays as it is, the very points', () => {
    for (const from of [0, 0.3]) {
      const points = through([[-15, from, 0], FL, FR, [15, from, 0]], false);
      const raw = { points, closed: false };
      expect(lineOffOutline(raw, OUTLINE, 1, 2)).toBe(raw);
    }
  });

  it('an open edge going on along the platform past its ends loses that much', () => {
    const line = lineOffOutline({ points: through([[0, 0, 0], L, FL, FR, R, [0, 0, 0]], false), closed: false }, OUTLINE, 1, 2);
    expect(line.closed).toBe(false);
    expect(length(line)).toBeCloseTo(150, 9);
  });

  it('merely meeting the outline, or running along it for less than the least, is not running along it', () => {
    // a corner on the outline
    const corner = { points: through([[0, 0, 0], [20, 30, 0], [0, 60, 0], [-20, 30, 0]], true, 0.5), closed: true };
    expect(lineOffOutline(corner, OUTLINE, 0.5, 2)).toBe(corner);
    // 3 mm along it: a matter of how long the least is
    const tooth = { points: through([[-1.5, 0, 0], [1.5, 0, 0], [1.5, 30, 0], [-1.5, 30, 0]], true), closed: true };
    expect(lineOffOutline(tooth, OUTLINE, 0.1, 4)).toBe(tooth);
    expect(lineOffOutline(tooth, OUTLINE, 0.1, 2).closed).toBe(false);
  });

  it('a curve nowhere near the outline, or all along it, stays as it is', () => {
    const far = { points: through([[-5, 20, 0], [5, 20, 0], [5, 30, 0], [-5, 30, 0]], true), closed: true };
    expect(lineOffOutline(far, OUTLINE, 1, 2)).toBe(far);
    const same = { points: OUTLINE, closed: true };
    expect(lineOffOutline(same, OUTLINE, 1, 2)).toBe(same);
  });

  it('only a flake\'s edge, with a closed outline and a stated unit', () => {
    const points = through([L, FL, FR, R], true);
    const edge = { points, closed: true, attributes: { type: 'edge' } };
    const outline = { points: OUTLINE, closed: true, attributes: { type: 'platform_outline' } };
    const st = (type: 'flake' | 'core' | 'generic', unit: string, curves = [edge, outline]) => ({ specimen: { type, unit }, curves });
    expect(measuredLine(edge, st('flake', 'mm')).closed).toBe(false);
    for (const other of [st('core', 'mm'), st('generic', 'mm'), st('flake', ''), st('flake', 'mm', [edge]), st('flake', 'mm', [edge, { ...outline, closed: false }])]) {
      const line = measuredLine(edge, other);
      expect(line.closed).toBe(true);
      expect(line.points).toBe(points);
    }
    // not another type of curve along the same line
    const scar = { ...edge, points: [...points], attributes: { type: 'scar_boundary' } };
    expect(measuredLine(scar, st('flake', 'mm', [scar, outline])).closed).toBe(true);
  });

  it('the distances are in millimetres, by the stated unit', () => {
    // the rim half a unit off the outline
    const off = through([[-15, 0.5, 0], [-15, 60, 0], [15, 60, 0], [15, 0.5, 0]], true);
    const outline = { points: OUTLINE, closed: true, attributes: { type: 'platform_outline' } };
    const edge = { points: off, closed: true, attributes: { type: 'edge' } };
    expect(measuredLine(edge, { specimen: { type: 'flake', unit: 'mm' }, curves: [edge, outline] }).closed).toBe(false);
    // half a centimetre is 5 mm
    const inCm = { ...edge, points: [...off] };
    expect(measuredLine(inCm, { specimen: { type: 'flake', unit: 'cm' }, curves: [inCm, outline] }).closed).toBe(true);
  });

  it('follows the curves: a new outline is taken into account, the curve is not changed', () => {
    const edge = { points: through([L, FL, FR, R], true), closed: true, attributes: { type: 'edge' } };
    const before = JSON.stringify(edge);
    const none = { points: through([[-3, 20, 5], [3, 20, 5], [3, 25, 5]], true), closed: true, attributes: { type: 'platform_outline' } };
    const outline = { points: OUTLINE, closed: true, attributes: { type: 'platform_outline' } };
    const state = (o: typeof outline) => ({ specimen: { type: 'flake' as const, unit: 'mm' }, curves: [edge, o] });
    expect(measuredLine(edge, state(none)).closed).toBe(true);
    const line = measuredLine(edge, state(outline));
    expect(line.closed).toBe(false);
    expect(measuredLine(edge, state(outline))).toBe(line);
    expect(measuredLine(edge, state(none)).closed).toBe(true);
    expect(JSON.stringify(edge)).toBe(before);
  });
});

describe('the data of a closed edge beside a platform outline', () => {
  const shape = (points: Vec3[], closed: boolean) => ({ anchors: [points[0], points[points.length - 1]], points, anchorIndex: [0, points.length - 1], closed });
  const flake = () => {
    const st = emptyProject();
    st.specimen = { ...st.specimen, type: 'flake', unit: 'mm' };
    const store = new ProjectStore(st);
    const edge = addCurve(store, { ...shape(through([L, FL, FR, R], true), true), attributes: { type: 'edge' } });
    return { store, edge };
  };

  it('stays closed in the file, which says what was measured', () => {
    const { store, edge } = flake();
    expect(serializeProject(store.state as ProjectState, 'x').derived.measuredLines).toBeUndefined();
    addCurve(store, { ...shape(OUTLINE, true), attributes: { type: 'platform_outline' } });
    const file = serializeProject(store.state as ProjectState, 'x');
    expect(file.annotations.curves[0]).toMatchObject({ id: edge.id, closed: true });
    expect(file.derived.measuredLines?.parameters).toEqual({ EDGE_RIM_REACH_MM: 1, EDGE_RIM_MIN_MM: 2 });
    expect(file.derived.measuredLines?.curves).toHaveLength(1);
    expect(file.derived.measuredLines?.curves[0]).toMatchObject({ curveId: edge.id, start: L, end: R });
  });

  it('has its working edges along that line: one ending on the platform is cut there, and none can lie on it', () => {
    const { store, edge } = flake();
    addCurve(store, { ...shape(OUTLINE, true), attributes: { type: 'platform_outline' } });
    const out = addWorkingEdge(store, { curveId: edge.id, start: [-15, 30, 0], end: [15, 30, 0] });
    expect(out.refused).toBeNull();
    // round by the far end: E1 at positions from 30 to 120 of the line of 150
    const label = edgeLabels(store.state);
    expect(label(edge.id, 15)).toBe('');
    expect(label(edge.id, 75)).toBe('E1');
    expect(label(edge.id, 135)).toBe('');
    // the rim's points go to the line's two ends, not along the rim: the whole line, where E1 is
    expect(addWorkingEdge(store, { curveId: edge.id, start: [-5, 0, 0], end: [5, 0, 0] }).refused).toMatchObject({ reason: 'overlap' });
  });
});

/** T1 with all that goes with a mesh, by hand. */
function onT1() {
  const m = flakeT1(1);
  const pos = m.positions, idx = m.index;
  const edges = buildEdges(idx, pos.length / 3);
  let sum = 0;
  const nbr = new Map<number, Array<[number, number]>>();
  for (let i = 0; i < edges.v0.length; i++) {
    const a = edges.v0[i], b = edges.v1[i];
    const d = Math.hypot(pos[3 * a] - pos[3 * b], pos[3 * a + 1] - pos[3 * b + 1], pos[3 * a + 2] - pos[3 * b + 2]);
    sum += d;
    (nbr.get(a) ?? nbr.set(a, []).get(a)!).push([b, d]);
    (nbr.get(b) ?? nbr.set(b, []).get(b)!).push([a, d]);
  }
  const path = (from: number, to: number): number[] | null => {
    const dist = new Map<number, number>([[from, 0]]);
    const prev = new Map<number, number>();
    const open = new Set<number>([from]);
    while (open.size) {
      let u = -1, least = Infinity;
      for (const v of open) {
        if (dist.get(v)! < least) {
          least = dist.get(v)!;
          u = v;
        }
      }
      open.delete(u);
      if (u === to) break;
      for (const [v, d] of nbr.get(u) ?? []) {
        if (least + d < (dist.get(v) ?? Infinity)) {
          dist.set(v, least + d);
          prev.set(v, u);
          open.add(v);
        }
      }
    }
    if (!dist.has(to)) return null;
    const out = [to];
    while (out[out.length - 1] !== from) out.push(prev.get(out[out.length - 1])!);
    return out.reverse();
  };
  const nearestVertex = (p: Vec3): number => {
    let best = -1, bd = Infinity;
    for (let v = 0; v < pos.length / 3; v++) {
      const d = (pos[3 * v] - p[0]) ** 2 + (pos[3 * v + 1] - p[1]) ** 2 + (pos[3 * v + 2] - p[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  };
  const faceAt = (p: Vec3): number => {
    let best = -1, bd = Infinity;
    for (let t = 0; 3 * t + 2 < idx.length; t++) {
      const c = [0, 1, 2].map((k) => (pos[3 * idx[3 * t] + k] + pos[3 * idx[3 * t + 1] + k] + pos[3 * idx[3 * t + 2] + k]) / 3);
      const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  };
  const meanEdge = sum / edges.v0.length;
  return {
    m,
    edges,
    meanEdge,
    path,
    faceAt,
    chain: (pts: Vec3[], closed: boolean) => polylineEdges(pts, closed, nearestVertex, edges, path),
    pieces: (barrier: number[]) => runSync(regionsSteps(pos, idx, edges, barrier)),
    join: (chains: number[][], open: boolean[], boundary?: boolean[]) => runSync(joinOpenEndsSteps(chains, open, pos, 4 * meanEdge, path, boundary)),
  };
}

const PLATFORM: Vec3 = [0, -1, 5], VENTRAL: Vec3 = [0, 40, 0];
const CORNERS: Vec3[] = [L, R, [15, -2, 10], [-15, -2, 10]];

describe('an edge stopping short of the platform outline, with another curve nearer', () => {
  const t = onT1();
  const outline = t.chain(CORNERS, true);
  // 3 mm short of the outline at both ends; a scar's outline a little over 1 mm from each
  const edge = t.chain([[-15, 3, 0], FL, FR, [15, 3, 0]], false);
  const scarA = t.chain([[-14, 2, 0], [-5, 2, 0]], false);
  const scarB = t.chain([[14, 2, 0], [5, 2, 0]], false);
  const chains = [outline, edge, scarA, scarB];
  const open = [false, true, true, true];
  const apart = (barrier: number[]) => {
    const part = t.pieces(barrier);
    return { count: part.count, ...flakeFacePieces(part, part.region[t.faceAt(PLATFORM)], part.region[t.faceAt(VENTRAL)]) };
  };

  it('joined to the nearest of all, it leaves the two faces one piece', () => {
    const joined = t.join(chains, open);
    expect(apart([...joined[0], ...joined[1]])).toMatchObject({ count: 2, ventral: -1, dorsal: -1 });
  });

  it('joined to the outline, the upper layer has the platform and the two faces', () => {
    const joined = t.join(chains, open, [true, true, false, false]);
    const up = apart([...joined[0], ...joined[1]]);
    expect(up.count).toBe(3);
    expect(up.dorsal).toBeGreaterThanOrEqual(0);
    // the same as with no scar there
    const alone = t.join([outline, edge], [false, true]);
    expect(t.pieces([...joined[0], ...joined[1]]).areas).toEqual(t.pieces(alone.flat()).areas);
    // the lower layer holds all that the upper does, so a lower piece lies in one upper piece
    const lower = new Set(joined.flat());
    expect([...joined[0], ...joined[1]].every((v) => lower.has(v))).toBe(true);
  });

  it('an end lying on another curve goes on to the outline, when that is within reach', () => {
    // the edge ends on the scar's outline
    const onScar = t.chain([[-14, 2, 0], FL, FR, [14, 2, 0]], false);
    const joined = t.join([outline, onScar, scarA, scarB], open, [true, true, false, false]);
    expect(joined[1].length).toBeGreaterThan(onScar.length);
    expect(apart([...joined[0], ...joined[1]]).count).toBe(3);
  });

  it('with no boundary curve in reach, it is joined to what is, for the lower layer', () => {
    const far = t.chain([[-15, 30, 0], FL, FR, [15, 30, 0]], false);
    const across = t.chain([[-13, 30, 0], [13, 30, 0]], true);
    const joined = t.join([outline, far, across], [false, true, false], [true, true, false]);
    expect(joined[1].length).toBeGreaterThan(far.length);
    // ... and another curve as before: to the nearest of all, a curve of either layer
    const scar = t.chain([[-13, 40, 0], [-5, 40, 0]], false);
    const withScar = t.join([outline, far, scar], [false, true, true], [true, true, false]);
    const asBefore = t.join([outline, far, scar], [false, true, true]);
    expect(withScar[2]).toEqual(asBefore[2]);
    expect(withScar[2].length).toBeGreaterThan(scar.length);
  });

  it('with no such argument, as before', () => {
    expect(t.join(chains, open)).toEqual(t.join(chains, open, []));
  });
});

describe('the same flake and the same retouch, however the edge is drawn', () => {
  const t = onT1();
  const { positions: pos, index: idx } = t.m;
  const volume = Math.abs(signedVolume(pos, idx));
  const outline = t.chain(CORNERS, true);
  const measure = (raw: MeasuredLine) => {
    const edge = t.chain(raw.points as Vec3[], raw.closed);
    const upper = t.pieces([...outline, ...edge]);
    const ventral = upper.region[t.faceAt(VENTRAL)], platform = upper.region[t.faceAt(PLATFORM)];
    const faces = flakeFacePieces(upper, platform, ventral);
    const faceOf = new Uint8Array(upper.region.length);
    for (let f = 0; f < faceOf.length; f++) {
      const c = upper.region[f];
      faceOf[f] = c === ventral ? FACE_VENTRAL : c === faces.dorsal ? FACE_DORSAL : c === platform ? FACE_PLATFORM : FACE_NONE;
    }
    const lower = t.pieces([...outline, ...edge, ...t.chain([[-15, 55, 0], [15, 55, 0]], false)]);
    const pieces = new Map<number, RetouchPiece>([[lower.region[t.faceAt([0, 57.5, 0])], { region: 'R1', layer: 1 }]]);
    // measured along the line, as the app does
    const line = measuredLine({ ...raw, points: raw.points as Vec3[], attributes: { type: 'edge' } }, { specimen: { type: 'flake', unit: 'mm' }, curves: [{ points: OUTLINE, closed: true, attributes: { type: 'platform_outline' } }] });
    const sec = retouchSections({ positions: pos, index: idx, points: line.points, closed: line.closed, unit: 'mm', meanEdge: t.meanEdge, pieceOfFace: lower.region, pieces })!;
    const curves: RetouchCurve[] = [{ curveId: 'C1', edge: true, closed: line.closed, length: sec.length, stations: sec.result.stations, sections: sec.sections }];
    const frame = segmentFrame({ positions: pos, index: idx, faceOf, settings: defaultRetouchSettings(), matrix: null, morph: morphDimensions(pos), specimenFrame: null });
    return { line, sec, result: retouchIndices({ positions: pos, index: idx, faceOf, pieceOfFace: lower.region, pieces, curves, unit: 'mm', meanEdge: t.meanEdge, volume, fitLength: null, frame }) };
  };
  const open = measure({ points: through([L, FL, FR, R], false), closed: false });
  const closed = measure({ points: through([L, FL, FR, R], true), closed: true });

  it('the open edge is not touched', () => {
    expect(open.line.closed).toBe(false);
    expect(length(open.line)).toBeCloseTo(150, 9);
    expect(open.result.indices.retouch_perimeter).toBeCloseTo(0.2568, 3);
  });

  it('the closed one has the same stations and the same retouch perimeter, none of its stations on the platform', () => {
    expect(closed.line.closed).toBe(false);
    expect(closed.sec.result.stations.length).toBe(open.sec.result.stations.length);
    expect(closed.sec.length).toBeCloseTo(open.sec.length, 6);
    expect(closed.result.indices.retouch_perimeter).toBeCloseTo(open.result.indices.retouch_perimeter!, 9);
    expect(closed.result.indices.edge_curvature).toBeCloseTo(open.result.indices.edge_curvature!, 9);
    const onRim = closed.sec.result.stations.filter((s) => s.point && Math.abs(s.point[1]) < 0.5 && Math.abs(s.point[0]) < 13);
    expect(onRim).toEqual([]);
  });
});

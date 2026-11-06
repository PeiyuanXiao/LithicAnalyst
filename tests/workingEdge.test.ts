import { describe, expect, it } from 'vitest';
import { edgeAngles } from '../src/compute/edgeAngle';
import { morphDimensions } from '../src/compute/flake';
import { buildEdges, signedVolume } from '../src/compute/meshGeometry';
import { polylineEdges, regionsSteps } from '../src/compute/regions';
import { retouchSections, type RetouchPiece } from '../src/compute/retouchAngle';
import { FACE_DORSAL, FACE_NONE, FACE_VENTRAL, retouchIndices, segmentFrame, type RetouchCurve, type RetouchIndexResult } from '../src/compute/retouchIndex';
import { sharpSegments } from '../src/compute/sharpEdge';
import { runSync } from '../src/compute/steps';
import { clampedEnd, curveStretch, edgeAxis, edgeLabeller, ownerAt, placedEdges, rangeOf, refusalOf, retouchRunEdges, sharpPieces, stationWeights, workingEdgeDetails, WORKING_EDGE_MIN_MM, type EdgeCurve, type WorkingEdgeDetail } from '../src/compute/workingEdge';
import { addCurve, addWorkingEdge, deleteCurve, deleteWorkingEdge, generateWorkingEdges, otherWorkingEdgeStretch, setCurveEdgeAngle, updateWorkingEdge } from '../src/core/actions';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import { defaultRetouchSettings, type ProjectState, type Vec3, type WorkingEdge } from '../src/core/types';
import { batchOutputs, batchSpecimen } from '../src/io/batch';
import { edgeAnglesCsv, edgeSharpCsv, retouchAnglesCsv, retouchSectionsCsv, retouchSegmentsCsv, WORKING_EDGE_COLUMNS, workingEdgesCsv } from '../src/io/csv';
import { heightAt, mapped, retouchPrism, rigid, SEGMENTS, steppedTool, type Mesh } from './meshes';

const near = (value: number | null, expected: number, share = 0.01) => {
  expect(value).not.toBeNull();
  expect(Math.abs(value! - expected)).toBeLessThanOrEqual(Math.abs(expected) * share);
};
const nearAbs = (value: number | null, expected: number, within: number) => {
  expect(value).not.toBeNull();
  expect(Math.abs(value! - expected)).toBeLessThanOrEqual(within);
};

function meanEdgeOf(m: Mesh): number {
  const e = buildEdges(m.index, m.positions.length / 3);
  let s = 0;
  for (let i = 0; i < e.v0.length; i++) {
    const a = 3 * e.v0[i], b = 3 * e.v1[i];
    s += Math.hypot(m.positions[a] - m.positions[b], m.positions[a + 1] - m.positions[b + 1], m.positions[a + 2] - m.positions[b + 2]);
  }
  return s / e.v0.length;
}

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const t = '2026-11-05T00:00:00.000Z';
const edgeOf = (label: string, curveId: string, start: Vec3, end: Vec3): WorkingEdge => ({ id: label, label, name: '', curveId, start, end, createdAt: t, modifiedAt: t });

/** A closed curve or an open one, as a curve of the project (anchors at its ends). */
const shape = (points: Vec3[], closed: boolean) => ({ anchors: [points[0], points[points.length - 1]], points, anchorIndex: [0, points.length - 1], closed });

/** All that is measured along one curve, and the working edges on it. */
function measure(m: Mesh, edge: Vec3[], closed: boolean, faceOf: ArrayLike<number>, pieceOf: ArrayLike<number>, pieces: ReadonlyMap<number, RetouchPiece>, edges: readonly WorkingEdge[], matrix: readonly number[] | null, sharp: EdgeCurve['sharp'] = null): { result: RetouchIndexResult; details: WorkingEdgeDetail[]; stations: EdgeCurve['stations'] } {
  const meanEdge = meanEdgeOf(m);
  const sec = pieces.size ? retouchSections({ positions: m.positions, index: m.index, points: edge, closed, unit: 'mm', meanEdge, pieceOfFace: pieceOf, pieces }) : null;
  const curves: RetouchCurve[] = [{ curveId: 'C1', edge: true, closed, length: sec?.length ?? 0, stations: sec?.result.stations ?? [], sections: sec?.sections ?? [] }];
  const frame = segmentFrame({ positions: m.positions, index: m.index, faceOf, settings: defaultRetouchSettings(), matrix, morph: matrix ? null : morphDimensions(m.positions), specimenFrame: null });
  const volume = Math.abs(signedVolume(m.positions, m.index));
  const result = retouchIndices({ positions: m.positions, index: m.index, faceOf, pieceOfFace: pieceOf, pieces, curves, unit: 'mm', meanEdge, volume, fitLength: null, frame });
  const stations = sec?.result.stations ?? edgeAngles({ positions: m.positions, index: m.index, points: edge, closed, unit: 'mm', meanEdge })!.stations;
  const details = workingEdgeDetails({ curves: [{ id: 'C1', points: edge, closed, stations, sharp }], edges, unit: 'mm', retouch: result, volume });
  return { result, details, stations };
}

// ------------------------------------------------------------ T7

const prismEdge = (): Vec3[] => Array.from({ length: 61 }, (_, i) => [4, 5 + i / 2, 0]);

function labelledPrism(m: ReturnType<typeof retouchPrism>) {
  const faceOf = new Uint8Array(m.side.length);
  const pieceOf = new Uint32Array(m.side.length);
  m.side.forEach((s, tri) => {
    faceOf[tri] = s === 'AR' || s === 'RC' || s === 'CF' ? FACE_DORSAL : s === 'FA' ? FACE_VENTRAL : FACE_NONE;
    pieceOf[tri] = s === 'AR' ? 1 : 0;
  });
  return { faceOf, pieceOf, pieces: new Map<number, RetouchPiece>([[1, { region: 'R1', layer: 1 }]]) };
}

describe('working edges on T7, unifacial', () => {
  const E1 = edgeOf('E1', 'C1', [4, 5, 0], [4, 20, 0]);
  const E2 = edgeOf('E2', 'C1', [4, 20, 0], [4, 35, 0]);
  const run = (edges: WorkingEdge[], f: (p: Vec3) => Vec3 = (p) => p) => {
    const raw = retouchPrism('unifacial');
    const { faceOf, pieceOf, pieces } = labelledPrism(raw);
    const m = mapped(raw, f);
    const axis = (d: Vec3): Vec3 => {
      const o = f([0, 0, 0]), q = f(d);
      return [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
    };
    const x = axis([1, 0, 0]), y = axis([0, 1, 0]), z = axis([0, 0, 1]), o = f([0, 0, 0]);
    const matrix = [x[0], x[1], x[2], -(x[0] * o[0] + x[1] * o[1] + x[2] * o[2]), y[0], y[1], y[2], -(y[0] * o[0] + y[1] * o[1] + y[2] * o[2]), z[0], z[1], z[2], -(z[0] * o[0] + z[1] * o[1] + z[2] * o[2]), 0, 0, 0, 1];
    return measure(m, prismEdge().map(f), false, faceOf, pieceOf, pieces, edges.map((e) => ({ ...e, start: f(e.start), end: f(e.end) })), matrix);
  };

  const expectHalf = (d: WorkingEdgeDetail) => {
    const r = d.row;
    near(r.length, 15);
    near(r.removed_volume, 138.56);
    nearAbs(r.erp, 0.015152, 0.005);
    near(r.erp, 138.56 / (277.13 + 8868.1));
    nearAbs(r.giur, 0.4, 0.005);
    nearAbs(r.retouch_perimeter, 1, 1e-9);
    nearAbs(r.retouch_perimeter_dorsal, 1, 1e-9);
    nearAbs(r.retouch_perimeter_ventral, 0, 1e-9);
    nearAbs(r.edge_curvature, 0, 0.005);
    near(r.edge_curvature_chord, 15);
    nearAbs(r.edge_curvature_depth, 0, 0.01);
    expect(r.erp_filled_share).toBe(0);
    near(r.retouched_length, 15);
  };

  it('two edges: each half of it, and together the whole', () => {
    const { result, details } = run([E1, E2]);
    expect(details.map((d) => d.row.label)).toEqual(['E1', 'E2']);
    details.forEach(expectHalf);
    const x = result.indices;
    near(details[0].row.removed_volume! + details[1].row.removed_volume!, 277.13);
    near(details[0].row.removed_volume! + details[1].row.removed_volume!, x.removed_volume!, 1e-9);
    near(details[0].row.erp! + details[1].row.erp!, 0.030303);
    near(details[0].row.erp! + details[1].row.erp!, x.erp!, 1e-9);
    // the station on the boundary goes to the one that begins there; each station counted once
    expect(details.reduce((s, d) => s + d.row.giur_stations!, 0)).toBe(x.giur_stations);
    expect(details[0].row.start_position).toBeCloseTo(0, 6);
    expect(details[0].row.end_position).toBeCloseTo(15, 6);
  });

  it('after a rigid motion: the same', () => {
    const { details } = run([E1, E2], rigid([1, 2, 3], 35, [12, -7, 40]));
    details.forEach(expectHalf);
  });

  it('only E1: the rest counts for the whole, and no row stands for it', () => {
    const { result, details } = run([E1]);
    expect(details.length).toBe(1);
    expectHalf(details[0]);
    near(result.indices.removed_volume, 277.13);
    expect(result.indices.stations.length).toBe(31);
    const state = { ...emptyProject(), curves: [{ id: 'C1', label: 'C1', ...shape(prismEdge(), false), attributes: { type: 'edge' }, createdAt: t, modifiedAt: t }], workingEdges: [E1] } as ProjectState;
    const lines = workingEdgesCsv(state, details.map((d) => d.row), [], { excelBom: false }).trim().split('\n');
    expect(lines[0]).toBe(['specimen_id', ...WORKING_EDGE_COLUMNS].join(','));
    expect(lines.length).toBe(2);
    expect(lines[1].split(',')[1]).toBe('E1');
    // the stations beyond it say so: nothing
    const sections = retouchSectionsCsv(state, result.indices, { excelBom: false }).trim().split('\n');
    expect(sections[0].endsWith(',working_edge')).toBe(true);
    expect(sections.slice(1, 16).every((l) => l.endsWith(',E1'))).toBe(true);
    expect(sections[31].endsWith(',')).toBe(true);
  });

  it('no working edge: the whole curve is one implied edge, by its curve', () => {
    const { result, details } = run([]);
    expect(details.length).toBe(1);
    const r = details[0].row;
    expect(r.label).toBe('');
    near(r.length, 30);
    near(r.removed_volume, 277.13);
    near(r.erp, result.indices.erp!, 1e-9);
    expect(r.giur_stations).toBe(31);
    nearAbs(r.edge_curvature, 0, 0.005);
    near(r.edge_curvature_chord, 30);
  });

  it('an edge with no retouch on it counts as not retouched; its curvature is still its own', () => {
    const raw = retouchPrism('unifacial');
    const { faceOf, pieceOf, pieces } = labelledPrism(raw);
    const none = new Uint32Array(pieceOf.length);
    const { details } = measure(raw, prismEdge(), false, faceOf, none, new Map(), [E1], identity);
    const r = details[0].row;
    expect([r.removed_volume, r.erp, r.giur, r.giur_stations, r.retouch_perimeter, r.retouched_length]).toEqual([0, 0, 0, 0, 0, 0]);
    near(r.edge_curvature_chord, 15);
    // and a flake with retouch elsewhere: the same for this edge
    expect(pieces.size).toBe(1);
  });

  it('too many gaps on one edge: that edge is empty, the whole stands', () => {
    const raw = retouchPrism('unifacial');
    const { faceOf, pieceOf, pieces } = labelledPrism(raw);
    // the faces unknown on a third of the edge: no missing area there, filled in from the rest
    const untold = faceOf.map((f, tri) => {
      const y = (raw.positions[3 * raw.index[3 * tri] + 1] + raw.positions[3 * raw.index[3 * tri + 1] + 1] + raw.positions[3 * raw.index[3 * tri + 2] + 1]) / 3;
      return y > 25 && f !== FACE_NONE ? FACE_NONE : f;
    });
    const { result, details } = measure(raw, prismEdge(), false, untold, pieceOf, pieces, [E1, E2], identity);
    // 10 of 15 mm of E2, 10 of 30 of the whole
    expect(result.indices.erp_filled_share!).toBeGreaterThan(0.25);
    expect(details[0].row.erp_filled_share).toBe(0);
    expect(details[1].row.erp_filled_share!).toBeGreaterThan(0.25);
    expect(details[1].row.removed_volume).toBeNull();
    expect(details[1].reasons.removed_volume).toBe('too_many_gaps');
    expect(details[1].reasons.erp).toBe('too_many_gaps');
    expect(details[0].row.removed_volume).not.toBeNull();
  });
});

// ------------------------------------------------------------ the stepped tool

describe('working edges on the stepped tool', () => {
  const ringPoints = (m: Mesh, first: number): Vec3[] => Array.from({ length: SEGMENTS }, (_, j) => [m.positions[3 * (first + j)], m.positions[3 * (first + j) + 1], m.positions[3 * (first + j) + 2]]);
  const onTop = (r: number, theta = 0.7): Vec3 => [r * Math.cos(theta), r * Math.sin(theta), heightAt(r)];

  function tool() {
    const m = steppedTool();
    const edge = ringPoints(m, m.ringAt(30, true));
    const edges = buildEdges(m.index, m.positions.length / 3);
    const nearest = (p: Vec3): number => {
      let best = 0, least = Infinity;
      for (let i = 0; 3 * i < m.positions.length; i++) {
        const d = (m.positions[3 * i] - p[0]) ** 2 + (m.positions[3 * i + 1] - p[1]) ** 2 + (m.positions[3 * i + 2] - p[2]) ** 2;
        if (d < least) {
          least = d;
          best = i;
        }
      }
      return best;
    };
    const barrier = [edge, ringPoints(m, m.ringAt(24, true)), ringPoints(m, m.ringAt(12, true))].flatMap((r) => polylineEdges(r, true, nearest, edges, () => null));
    const part = runSync(regionsSteps(m.positions, m.index, edges, barrier));
    const tris = m.index.length / 3;
    const centre = (tri: number) => [0, 1, 2].map((k) => (m.positions[3 * m.index[3 * tri] + k] + m.positions[3 * m.index[3 * tri + 1] + k] + m.positions[3 * m.index[3 * tri + 2] + k]) / 3) as Vec3;
    const at = (p: Vec3): number => {
      let best = 0, least = Infinity;
      for (let tri = 0; tri < tris; tri++) {
        const c = centre(tri);
        const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
        if (d < least) {
          least = d;
          best = tri;
        }
      }
      return part.region[best];
    };
    const faceOf = new Uint8Array(tris);
    const top = new Set([at(onTop(27)), at(onTop(18)), at(onTop(5))]);
    for (let tri = 0; tri < tris; tri++) faceOf[tri] = top.has(part.region[tri]) ? FACE_DORSAL : FACE_VENTRAL;
    return { m, edge, part, at, faceOf, centre, tris };
  }

  const rim = (deg: number): Vec3 => [30 * Math.cos((deg * Math.PI) / 180), 30 * Math.sin((deg * Math.PI) / 180), 0];

  it('two halves: each its own chord; together the whole', () => {
    const { m, edge, part, at, faceOf } = tool();
    const pieces = new Map<number, RetouchPiece>([[at(onTop(27)), { region: 'R1', layer: 1 }], [at(onTop(18)), { region: 'R2', layer: 2 }]]);
    const E1 = edgeOf('E1', 'C1', rim(0), rim(180)), E2 = edgeOf('E2', 'C1', rim(180), rim(360));
    const { result, details } = measure(m, edge, true, faceOf, part.region, pieces, [E1, E2], null);
    expect(details.map((d) => d.row.label)).toEqual(['E1', 'E2']);
    for (const d of details) {
      nearAbs(d.row.edge_curvature, 0.5, 0.02);
      near(d.row.edge_curvature_chord, 60, 0.02);
      near(d.row.edge_curvature_depth, 30, 0.02);
      nearAbs(d.row.giur, 0.941, 0.01);
      nearAbs(d.row.retouch_perimeter, 1, 0.005);
    }
    near(details[0].row.removed_volume! + details[1].row.removed_volume!, result.indices.removed_volume!, 1e-9);
    near(details[0].row.erp! + details[1].row.erp!, result.indices.erp!, 1e-9);
    // the whole closed curve has no chord
    expect(result.indices.edge_curvature).toBeNull();
    // implied, on a closed curve: none either
    const whole = measure(m, edge, true, faceOf, part.region, pieces, [], null).details[0];
    expect(whole.row.edge_curvature).toBeNull();
    expect(whole.reasons.edge_curvature).toBe('whole_edge');
  });

  it('the other stretch of E1 would be E2: refused, and E1 stays', () => {
    const store = new ProjectStore(emptyProject());
    const { edge } = tool();
    const c = addCurve(store, { ...shape(edge, true), attributes: { type: 'core_edge' } });
    const a = addWorkingEdge(store, { curveId: c.id, start: rim(0), end: rim(180) });
    const b = addWorkingEdge(store, { curveId: c.id, start: rim(180), end: rim(360) });
    expect(a.refused).toBeNull();
    expect(b.refused).toBeNull();
    const before = structuredClone(store.workingEdge(a.edge!.id));
    const steps = store.history.canUndo;
    const out = otherWorkingEdgeStretch(store, a.edge!.id);
    expect(out?.refused).toEqual({ reason: 'overlap', with: 'E2' });
    expect(store.workingEdge(a.edge!.id)).toEqual(before);
    expect(steps).toBe(true);
    // once E2 is gone, it can
    deleteWorkingEdge(store, b.edge!.id);
    expect(otherWorkingEdgeStretch(store, a.edge!.id)?.refused).toBeNull();
    const axis = edgeAxis(c, 'mm');
    const r = rangeOf(axis, store.workingEdge(a.edge!.id)!.start, store.workingEdge(a.edge!.id)!.end);
    near(r.length, axis.length / 2);
    near(r.from, axis.length / 2);
  });

  it('from the retouched stretches: half of the first layer gives one edge on that half', () => {
    const { m, edge, part, at, centre, tris } = tool();
    const pieceOf = new Uint32Array(tris);
    const band = at(onTop(27));
    for (let tri = 0; tri < tris; tri++) pieceOf[tri] = part.region[tri] === band && centre(tri)[1] > 0 ? 1 : 0;
    const sec = retouchSections({ positions: m.positions, index: m.index, points: edge, closed: true, unit: 'mm', meanEdge: meanEdgeOf(m), pieceOfFace: pieceOf, pieces: new Map([[1, { region: 'R1', layer: 1 }]]) })!;
    const store = new ProjectStore(emptyProject());
    const c = addCurve(store, { ...shape(edge, true), attributes: { type: 'core_edge' } });
    expect(generateWorkingEdges(store, [{ curveId: c.id, stations: sec.result.stations }])).toBe(1);
    const made = store.state.workingEdges[0];
    const axis = edgeAxis(c, 'mm');
    const r = rangeOf(axis, made.start, made.end);
    // the half with y > 0, to within a station at each end (the line begins a little past the curve's first point)
    const ringGap = (a: number, b: number) => Math.min(Math.abs(a - b), axis.length - Math.abs(a - b));
    expect(ringGap(r.from, rangeOf(axis, rim(0), rim(0)).from)).toBeLessThanOrEqual(1);
    expect(ringGap(r.to, rangeOf(axis, rim(180), rim(180)).from)).toBeLessThanOrEqual(1);
    expect(made.label).toBe('E1');
    // one step
    store.history.undo();
    expect(store.state.workingEdges.length).toBe(0);
    store.history.redo();
    // the curve has one now: it stays as it is
    expect(generateWorkingEdges(store, [{ curveId: c.id, stations: sec.result.stations }])).toBe(0);
  });

  it('a stretch all round gives none', () => {
    const { m, edge, part, at } = tool();
    const sec = retouchSections({ positions: m.positions, index: m.index, points: edge, closed: true, unit: 'mm', meanEdge: meanEdgeOf(m), pieceOfFace: part.region, pieces: new Map([[at(onTop(27)), { region: 'R1', layer: 1 }]]) })!;
    expect(retouchRunEdges({ points: edge, closed: true }, sec.result.stations, 'mm')).toEqual([]);
  });
});

// ------------------------------------------------------------ on a line

describe('along a line', () => {
  const line: Vec3[] = Array.from({ length: 41 }, (_, i) => [i, 0, 0]);
  const ring: Vec3[] = Array.from({ length: 120 }, (_, i) => [20 * Math.cos((i * Math.PI) / 60), 20 * Math.sin((i * Math.PI) / 60), 0]);
  const open = edgeAxis({ points: line, closed: false }, 'mm');
  const round = edgeAxis({ points: ring, closed: true }, 'mm');
  const positions = Array.from({ length: 41 }, (_, k) => k);

  it('an open curve: in either order; a closed one: the way it runs', () => {
    expect(rangeOf(open, [30, 0, 0], [10, 0, 0])).toEqual({ from: 10, to: 30, length: 20 });
    const r = rangeOf(round, [0, 20, 0], [20, 0, 0]);
    // from 90° on round, past the start, to 0°
    near(r.length, (3 * round.length) / 4, 0.01);
    // and the other way round, the rest of it
    near(rangeOf(round, [20, 0, 0], [0, 20, 0]).length, round.length / 4, 0.02);
  });

  it('too short, and overlapping: refused; sharing an end: not', () => {
    const E = edgeOf('E1', 'C', [10, 0, 0], [20, 0, 0]);
    expect(refusalOf(open, [20, 0, 0], [20 + WORKING_EDGE_MIN_MM - 0.1, 0, 0], [])).toEqual({ reason: 'short' });
    expect(refusalOf(open, [20, 0, 0], [20 + WORKING_EDGE_MIN_MM, 0, 0], [])).toBeNull();
    expect(refusalOf(open, [15, 0, 0], [30, 0, 0], [E])).toEqual({ reason: 'overlap', with: 'E1' });
    expect(refusalOf(open, [5, 0, 0], [30, 0, 0], [E])).toEqual({ reason: 'overlap', with: 'E1' });
    expect(refusalOf(open, [20, 0, 0], [30, 0, 0], [E])).toBeNull();
    expect(refusalOf(open, [2, 0, 0], [10, 0, 0], [E])).toBeNull();
    // round the start of a closed curve
    const over = edgeOf('E2', 'C', [20 * Math.cos(-0.5), 20 * Math.sin(-0.5), 0], [20 * Math.cos(0.5), 20 * Math.sin(0.5), 0]);
    expect(refusalOf(round, [20, 0, 0], [0, 20, 0], [over])).toEqual({ reason: 'overlap', with: 'E2' });
    expect(refusalOf(round, [20 * Math.cos(0.5), 20 * Math.sin(0.5), 0], [0, 20, 0], [over])).toBeNull();
  });

  it('the stations: a share of each by the part of its stretch in the edge; adding up to the curve', () => {
    const w1 = stationWeights(positions, false, 40, 1, { from: 0, to: 15.3 });
    const w2 = stationWeights(positions, false, 40, 1, { from: 15.3, to: 40 });
    near(w1.reduce((a, b) => a + b, 0), 15.3, 1e-9);
    near(w2.reduce((a, b) => a + b, 0), 24.7, 1e-9);
    expect(w1[0]).toBeCloseTo(0.5, 9);
    expect(w1[15]).toBeCloseTo(0.8, 9);
    expect(w2[15]).toBeCloseTo(0.2, 9);
    expect(w2[40]).toBeCloseTo(0.5, 9);
    // a closed curve whose last gap is short: its two stations share theirs, and all together are the stations' weights
    const L = 40.4;
    const p = Array.from({ length: 41 }, (_, k) => k);
    const a = stationWeights(p, true, L, 1, { from: 3, to: 21 }), b = stationWeights(p, true, L, 1, { from: 21, to: 3 });
    for (let k = 0; k < 41; k++) expect(a[k] + b[k]).toBeCloseTo(1, 9);
  });

  it('a station on the boundary: the edge that begins there; alone, the one that ends there', () => {
    const placed = placedEdges(open, [edgeOf('E1', 'C', [0, 0, 0], [15, 0, 0]), edgeOf('E2', 'C', [15, 0, 0], [40, 0, 0])]);
    expect(placed[ownerAt(placed, 14, 40)].edge.label).toBe('E1');
    expect(placed[ownerAt(placed, 15, 40)].edge.label).toBe('E2');
    expect(placed[ownerAt(placed, 40, 40)].edge.label).toBe('E2');
    const alone = placedEdges(open, [edgeOf('E1', 'C', [0, 0, 0], [15, 0, 0])]);
    expect(ownerAt(alone, 15, 40)).toBe(0);
    expect(ownerAt(alone, 16, 40)).toBe(-1);
    const f = edgeLabeller({ points: line, closed: false }, [edgeOf('E1', 'C', [0, 0, 0], [15, 0, 0])], 'mm');
    expect([f(3), f(30)]).toEqual(['E1', '']);
    // no working edge: nothing
    expect(edgeLabeller({ points: line, closed: false }, [], 'mm')(3)).toBe('');
  });

  it('a sharp stretch across a boundary: two pieces that add up to it', () => {
    const placed = placedEdges(open, [edgeOf('E1', 'C', [0, 0, 0], [15, 0, 0]), edgeOf('E2', 'C', [15, 0, 0], [40, 0, 0])]);
    const values = positions.map((p) => (p >= 10 && p <= 25 ? 20 : 80));
    const sharp = sharpSegments(values, positions, false, 40, 30, 'mm');
    expect(sharp.segments).toEqual([{ start: 10, end: 25, length: 15 }]);
    const pieces = sharpPieces(sharp.segments, placed, 40, false);
    expect(pieces).toEqual([
      { segment: 1, start: 10, end: 15, length: 5, edge: 'E1' },
      { segment: 1, start: 15, end: 25, length: 10, edge: 'E2' },
    ]);
    // no edge there: whole, and empty
    expect(sharpPieces(sharp.segments, [], 40, false)).toEqual([{ segment: 1, start: 10, end: 25, length: 15, edge: '' }]);
    // round the start of a closed curve: a stretch from 35 on over the start to 5, with an edge beginning at 0
    const placedRound = [{ edge: edgeOf('E1', 'C', [0, 0, 0], [0, 0, 0]), range: { from: 0, to: 20, length: 20 }, fromPoint: [0, 0, 0] as Vec3, toPoint: [0, 0, 0] as Vec3 }];
    const over = sharpPieces([{ start: 35, end: 5, length: 10 }], placedRound, 40, true);
    expect(over).toEqual([
      { segment: 1, start: 35, end: 40, length: 5, edge: '' },
      { segment: 1, start: 0, end: 5, length: 5, edge: 'E1' },
    ]);
  });

  it('an end stops at its neighbour\'s, on that very point, and short of its own other end', () => {
    const curve = { points: line, closed: false };
    const E1 = edgeOf('E1', 'C', [0, 0, 0], [15, 0, 0]), E2 = edgeOf('E2', 'C', [20, 0, 0], [40, 0, 0]);
    expect(clampedEnd(curve, open, E1, 'end', [E2], [12, 0, 0])[0]).toBeCloseTo(12, 6);
    expect(clampedEnd(curve, open, E1, 'end', [E2], [25, 0, 0])).toEqual([20, 0, 0]);
    expect(clampedEnd(curve, open, E2, 'start', [E1], [5, 0, 0])).toEqual([15, 0, 0]);
    // not closer than the shortest
    expect(clampedEnd(curve, open, E1, 'end', [E2], [0.5, 0, 0])[0]).toBeCloseTo(WORKING_EDGE_MIN_MM * 1.001, 6);
    expect(clampedEnd(curve, open, E1, 'start', [E2], [14.5, 0, 0])[0]).toBeCloseTo(15 - WORKING_EDGE_MIN_MM * 1.001, 6);
    // round a closed curve
    const ringCurve = { points: ring, closed: true };
    const at = (deg: number): Vec3 => [20 * Math.cos((deg * Math.PI) / 180), 20 * Math.sin((deg * Math.PI) / 180), 0];
    const A = edgeOf('A', 'C', at(0), at(90)), B = edgeOf('B', 'C', at(180), at(270));
    const past = clampedEnd(ringCurve, round, A, 'end', [B], at(200));
    expect(past).toEqual(at(180));
    const back = clampedEnd(ringCurve, round, B, 'start', [A], at(45));
    expect(back).toEqual(at(90));
    // within reach: the curve's own point
    const free = clampedEnd(ringCurve, round, A, 'end', [B], at(120));
    expect(Math.hypot(free[0] - at(120)[0], free[1] - at(120)[1])).toBeLessThan(0.05);
  });

  it('the way along a curve between two points', () => {
    const open2 = curveStretch({ points: line, closed: false }, [12.5, 0, 0], [10.25, 0, 0]);
    expect(open2.map((p) => p[0])).toEqual([10.25, 11, 12, 12.5]);
    const back = curveStretch({ points: ring, closed: true }, [20 * Math.cos(-0.3), 20 * Math.sin(-0.3), 0], [20 * Math.cos(0.3), 20 * Math.sin(0.3), 0]);
    // over the curve's start, in its direction
    expect(back.length).toBeGreaterThan(10);
    expect(back.length).toBeLessThan(25);
    expect(back.every((p) => p[0] > 0)).toBe(true);
  });
});

// ------------------------------------------------------------ the data

describe('the working edges as data', () => {
  const line: Vec3[] = Array.from({ length: 41 }, (_, i) => [i, 0, 0]);
  const made = () => {
    const store = new ProjectStore(emptyProject());
    store.state.specimen.type = 'flake';
    const c = addCurve(store, { ...shape(line, false), attributes: { type: 'edge' } });
    return { store, c };
  };

  it('numbered in turn; refused where they overlap or are short; undo and redo', () => {
    const { store, c } = made();
    const a = addWorkingEdge(store, { curveId: c.id, start: [0, 0, 0], end: [10, 0, 0] });
    expect(a.edge?.label).toBe('E1');
    const over = addWorkingEdge(store, { curveId: c.id, start: [5, 0, 0], end: [20, 0, 0] });
    expect(over.refused).toEqual({ reason: 'overlap', with: 'E1' });
    expect(store.state.workingEdges.length).toBe(1);
    expect(addWorkingEdge(store, { curveId: c.id, start: [20, 0, 0], end: [21, 0, 0] }).refused).toEqual({ reason: 'short' });
    const b = addWorkingEdge(store, { curveId: c.id, start: [10, 0, 0], end: [20, 0, 0], name: 'left' });
    expect(b.edge?.label).toBe('E2');
    store.history.undo();
    expect(store.state.workingEdges.map((e) => e.label)).toEqual(['E1']);
    expect(store.state.nextWorkingEdgeNumber).toBe(2);
    store.history.redo();
    expect(store.state.workingEdges.map((e) => e.name)).toEqual(['', 'left']);
    deleteWorkingEdge(store, a.edge!.id);
    // numbers are not used again
    expect(addWorkingEdge(store, { curveId: c.id, start: [25, 0, 0], end: [30, 0, 0] }).edge?.label).toBe('E3');
  });

  it('a curve not measured takes none; one that stops being measured keeps them', () => {
    const { store, c } = made();
    const other = addCurve(store, { ...shape(line, false), attributes: { type: 'ridge' } });
    expect(addWorkingEdge(store, { curveId: other.id, start: [0, 0, 0], end: [10, 0, 0] }).refused).toEqual({ reason: 'not_measured' });
    addWorkingEdge(store, { curveId: c.id, start: [0, 0, 0], end: [10, 0, 0] });
    setCurveEdgeAngle(store, c.id, false);
    expect(store.state.workingEdges.length).toBe(1);
    // and takes no part: there is no row for it
    const details = workingEdgeDetails({ curves: [], edges: store.state.workingEdges, unit: 'mm', retouch: null, volume: null });
    expect(details).toEqual([]);
  });

  it('a curve deleted takes them with it, in one step', () => {
    const { store, c } = made();
    addWorkingEdge(store, { curveId: c.id, start: [0, 0, 0], end: [10, 0, 0] });
    deleteCurve(store, c.id);
    expect(store.state.curves.length).toBe(0);
    expect(store.state.workingEdges.length).toBe(0);
    store.history.undo();
    expect(store.state.curves.length).toBe(1);
    expect(store.state.workingEdges.length).toBe(1);
    store.history.redo();
    expect(store.state.workingEdges.length).toBe(0);
  });

  it('typing a name is one step; ends that do not fit are refused', () => {
    const { store, c } = made();
    const a = addWorkingEdge(store, { curveId: c.id, start: [0, 0, 0], end: [10, 0, 0] }).edge!;
    addWorkingEdge(store, { curveId: c.id, start: [10, 0, 0], end: [20, 0, 0] });
    updateWorkingEdge(store, a.id, { name: 'l' });
    updateWorkingEdge(store, a.id, { name: 'le' });
    updateWorkingEdge(store, a.id, { name: 'left' });
    store.history.undo();
    expect(store.workingEdge(a.id)?.name).toBe('');
    expect(updateWorkingEdge(store, a.id, { end: [15, 0, 0] })?.refused).toEqual({ reason: 'overlap', with: 'E2' });
    expect(store.workingEdge(a.id)?.end).toEqual([10, 0, 0]);
    expect(updateWorkingEdge(store, a.id, { end: [8, 0, 0] })?.refused).toBeNull();
    expect(store.workingEdge(a.id)?.end).toEqual([8, 0, 0]);
  });

  it('the project file: kept; older files have none; one on a missing curve is dropped', () => {
    const { store, c } = made();
    addWorkingEdge(store, { curveId: c.id, start: [0, 0, 0], end: [10, 0, 0], name: 'left' });
    const file = JSON.parse(JSON.stringify(serializeProject(store.state, 'test')));
    expect(file.workingEdges.length).toBe(1);
    expect(file.nextWorkingEdgeNumber).toBe(2);
    const back = parseProjectFile(file);
    expect(back.workingEdges).toEqual(store.state.workingEdges);
    expect(back.nextWorkingEdgeNumber).toBe(2);
    const { workingEdges: _w, nextWorkingEdgeNumber: _n, ...older } = file;
    const old = parseProjectFile(older);
    expect(old.workingEdges).toEqual([]);
    expect(old.nextWorkingEdgeNumber).toBe(1);
    const stray = parseProjectFile({ ...file, workingEdges: [{ ...file.workingEdges[0], curveId: 'gone' }] });
    expect(stray.workingEdges).toEqual([]);
    // the counter follows what is there
    const low = parseProjectFile({ ...file, workingEdges: [{ ...file.workingEdges[0], label: 'E7' }], nextWorkingEdgeNumber: 1 });
    expect(low.nextWorkingEdgeNumber).toBe(8);
  });

  it('the columns: at the end of each file, the old ones as they were', () => {
    const { store, c } = made();
    const st = store.state;
    addWorkingEdge(store, { curveId: c.id, start: [0, 0, 0], end: [10, 0, 0] });
    const plain = { excelBom: false };
    const station = { position: 3, point: [3, 0, 0] as Vec3, three_points: [20, 20, 20], two_lines: [20, 20, 20] };
    const later = { position: 30, point: [30, 0, 0] as Vec3, three_points: [20, 20, 20], two_lines: [20, 20, 20] };
    const angles = [{ curveId: c.id, distances: [2, 5, 10], length: 40, stations: [station, later] }];
    const lines = edgeAnglesCsv(st, angles, plain).trim().split('\n');
    expect(lines[0]).toBe('specimen_id,curve_id,curve_type,station,position,distance,method,angle_deg,working_edge');
    expect(lines[1].endsWith(',E1')).toBe(true);
    expect(lines[lines.length - 1].endsWith(',')).toBe(true);
    const stretch = { region: 'none', layer: 1, distance: 4, three_points: 30, two_lines: 30, layer_face: 30 };
    const retouch = retouchAnglesCsv(st, [{ curveId: c.id, stations: [{ position: 3, point: [3, 0, 0], stretches: [stretch] }] }], plain).trim().split('\n');
    expect(retouch[0]).toBe('specimen_id,curve_id,station,position,retouch_region,retouch_layer,distance,method,angle_deg,working_edge');
    expect(retouch[1].endsWith(',E1')).toBe(true);
    expect(retouchSegmentsCsv(st, null, plain).trim()).toBe('specimen_id,curve_id,retouch_region,retouch_layer,face,start_position,end_position,length,chord,depth,working_edge');
    expect(edgeSharpCsv(st, [], plain).trim()).toBe('specimen_id,curve_id,method,distance,threshold_deg,segment,start_position,end_position,length,working_edge');
  });

  it('edge_sharp.csv: cut at the boundary; the sharp length of each edge; the whole unchanged', () => {
    const { store, c } = made();
    addWorkingEdge(store, { curveId: c.id, start: [0, 0, 0], end: [15, 0, 0] });
    addWorkingEdge(store, { curveId: c.id, start: [15, 0, 0], end: [40, 0, 0] });
    store.history.execute({ labelKey: 'x', createdAt: 0, apply: (s) => s._setSharpEdge({ method: 'three_points', distance: 2, threshold: 30 }), revert: () => {} });
    const stations = Array.from({ length: 41 }, (_, k) => {
      const v = k >= 10 && k <= 25 ? 20 : 80;
      return { position: k, point: [k, 0, 0] as Vec3, three_points: [v, v, v], two_lines: [v, v, v] };
    });
    const angles = [{ curveId: c.id, distances: [2, 5, 10], length: 40, stations }];
    const lines = edgeSharpCsv(store.state, angles, { excelBom: false }).trim().split('\n').slice(1).map((l) => l.split(','));
    expect(lines.map((l) => [l[5], l[6], l[7], l[8], l[9]])).toEqual([['1', '10', '15', '5', 'E1'], ['1', '15', '25', '10', 'E2']]);
    const details = workingEdgeDetails({ curves: [{ id: c.id, points: c.points, closed: false, stations, sharp: [{ start: 10, end: 25, length: 15 }] }], edges: store.state.workingEdges, unit: 'mm', retouch: null, volume: null });
    expect(details.map((d) => d.row.sharp_length)).toEqual([5, 10]);
    // a core or a general specimen: its measures from the retouch indices stay empty
    expect(details[0].row.removed_volume).toBeNull();
    expect(details[0].row.giur).toBeNull();
    const csv = workingEdgesCsv(store.state, details.map((d) => d.row), angles, { excelBom: false }).trim().split('\n').slice(1).map((l) => l.split(','));
    expect(csv.map((l) => [l[1], l[6], l[7], l[8]])).toEqual([['E1', '15', '5', ''], ['E2', '25', '10', '']]);
  });

  it('no unit: the rows stand, with what needs one empty, and say why', () => {
    const { store, c } = made();
    addWorkingEdge(store, { curveId: c.id, start: [0, 0, 0], end: [10, 0, 0] });
    store.state.specimen.unit = '';
    expect(refusalOf(edgeAxis(c, ''), [20, 0, 0], [20.5, 0, 0], [])).toBeNull();
    const details = workingEdgeDetails({ curves: [{ id: c.id, points: c.points, closed: false, stations: [], sharp: null }], edges: store.state.workingEdges, unit: '', retouch: null, volume: null });
    expect(details[0].row.length).toBe(10);
    expect(details[0].row.start_position).toBe(0);
    expect(details[0].row.end_position).toBe(10);
  });

  it('a summary: read from what the project stored', () => {
    const { store, c } = made();
    store.state.specimen.id = 'A';
    addWorkingEdge(store, { curveId: c.id, start: [0, 0, 0], end: [10, 0, 0] });
    const stations = Array.from({ length: 41 }, (_, k) => ({ position: k, point: [k, 0, 0] as Vec3, three_points: [20, 20, 20], two_lines: [20, 20, 20] }));
    const curves = [{ curveId: c.id, distances: [2, 5, 10], length: 40, stations }];
    const details = workingEdgeDetails({ curves: [{ id: c.id, points: c.points, closed: false, stations, sharp: null }], edges: store.state.workingEdges, unit: 'mm', retouch: null, volume: null });
    const project = { path: 'a.json', state: store.state as ProjectState, derived: { edgeAngles: { curves }, workingEdges: { edges: details.map((d) => d.row) } }, appVersion: 'x' };
    const auto = { frame: 'principal' as const, length: 1, width: 1, thickness: 1, surfaceArea: 1, volume: 1, closed: true };
    const specimen = batchSpecimen('a.ply', { project, measures: { auto, vertices: null, box: null } }, []);
    const out = batchOutputs([specimen], { excelBom: false }).find((f) => f.suffix === 'working_edges.csv');
    expect(out?.text.trim().split('\n').length).toBe(2);
    expect(out?.text.split('\n')[1].startsWith('A,E1,,')).toBe(true);
  });
});

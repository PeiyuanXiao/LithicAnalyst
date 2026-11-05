import { describe, expect, it } from 'vitest';
import { morphDimensions } from '../src/compute/flake';
import { buildEdges, meshTopology, signedVolume } from '../src/compute/meshGeometry';
import { polylineEdges, regionsSteps } from '../src/compute/regions';
import { retouchSections, type RetouchPiece } from '../src/compute/retouchAngle';
import {
  chordDepth,
  clampFitLength,
  FACE_DORSAL,
  FACE_NONE,
  FACE_VENTRAL,
  fillGaps,
  retouchIndices,
  RETOUCH_INDEX_PARAMETERS,
  segmentFrame,
  type RetouchCurve,
  type RetouchIndexResult,
} from '../src/compute/retouchIndex';
import { runSync } from '../src/compute/steps';
import { setRetouchAxis, setRetouchFitLength, setRetouchFlip } from '../src/core/actions';
import { frameMatrix } from '../src/core/frame';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import { defaultRetouchSettings, retouchSettingsOf, type RetouchSettings, type Vec3 } from '../src/core/types';
import { batchOutputs, batchSpecimen } from '../src/io/batch';
import { flakesCsv, invasivenessCsv, RETOUCH_FLAKE_COLUMNS, retouchSectionsCsv, retouchSegmentsCsv } from '../src/io/csv';
import { heightAt, mapped, retouchPrism, rigid, SEGMENTS, steppedTool, type Mesh, type RetouchPrismKind } from './meshes';

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

/** Everything from the labelled triangles: `faceOf`, `pieceOf` and the pieces in a layer given directly. */
function run(
  m: Mesh,
  edge: readonly Vec3[],
  closed: boolean,
  faceOf: ArrayLike<number>,
  pieceOf: ArrayLike<number>,
  pieces: ReadonlyMap<number, RetouchPiece>,
  opts: { fitLength?: number | null; matrix?: readonly number[] | null; settings?: Partial<RetouchSettings>; unit?: string; volume?: number | null; specimenFrame?: readonly number[] | null } = {},
): RetouchIndexResult {
  const meanEdge = meanEdgeOf(m);
  const unit = opts.unit ?? 'mm';
  const sec = pieces.size ? retouchSections({ positions: m.positions, index: m.index, points: edge, closed, unit, meanEdge, pieceOfFace: pieceOf, pieces }) : null;
  const curves: RetouchCurve[] = [{ curveId: 'C1', edge: true, closed, length: sec?.length ?? 0, stations: sec?.result.stations ?? [], sections: sec?.sections ?? [] }];
  const matrix = opts.matrix === undefined ? null : opts.matrix;
  const settings = { ...defaultRetouchSettings(), ...opts.settings };
  const frame = segmentFrame({ positions: m.positions, index: m.index, faceOf, settings, matrix, morph: matrix ? null : morphDimensions(m.positions), specimenFrame: opts.specimenFrame ?? null });
  const volume = opts.volume === undefined ? Math.abs(signedVolume(m.positions, m.index)) : opts.volume;
  return retouchIndices({ positions: m.positions, index: m.index, faceOf, pieceOfFace: pieceOf, pieces, curves, unit, meanEdge, volume, fitLength: opts.fitLength ?? null, frame });
}

// ------------------------------------------------------------ T7

const prismEdge = (): Vec3[] => Array.from({ length: 61 }, (_, i) => [4, 5 + i / 2, 0]);

/** T7's faces and regions by the side of the polygon each triangle lies on. */
function labelled(kind: RetouchPrismKind) {
  const m = retouchPrism(kind);
  const faceOf = new Uint8Array(m.side.length);
  const pieceOf = new Uint32Array(m.side.length);
  m.side.forEach((s, t) => {
    if (s === 'AR' || s === 'RC' || s === 'CF') faceOf[t] = FACE_DORSAL;
    else if (s === 'FA' || s === 'FCv' || s === 'CvRv' || s === 'RvA') faceOf[t] = FACE_VENTRAL;
    else faceOf[t] = FACE_NONE;
    pieceOf[t] = s === 'AR' ? 1 : s === 'RvA' ? 2 : 0;
  });
  const pieces = new Map<number, RetouchPiece>([[1, { region: 'R1', layer: 1 }]]);
  if (kind === 'bifacial') pieces.set(2, { region: 'R2', layer: 1 });
  return { m, faceOf, pieceOf, pieces };
}

function prism(kind: RetouchPrismKind, opts: Parameters<typeof run>[6] = {}): RetouchIndexResult {
  const { m, faceOf, pieceOf, pieces } = labelled(kind);
  return run(m, prismEdge(), false, faceOf, pieceOf, pieces, { matrix: identity, ...opts });
}

describe('T7, the retouch prism', () => {
  const UNI = { D: Math.hypot(4, 8 * Math.tan(Math.PI / 6)), area: 9.2376, angle: 30, e: 4, t: 4.6188, T: 11.547 };

  it('is closed, with the volume and the stations the roadmap gives', () => {
    const m = retouchPrism('unifacial');
    near(Math.abs(signedVolume(m.positions, m.index)), 8868.1);
    const top = meshTopology(m.index, m.positions.length / 3);
    expect(top.boundaryEdges).toBe(0);
    expect(top.nonManifoldEdges).toBe(0);
    expect(prism('unifacial').indices.stations.length).toBe(31);
  });

  const expectUnifacial = (r: RetouchIndexResult) => {
    const { indices: x, reasons } = r;
    expect(x.stations.length).toBe(31);
    for (const s of x.stations) {
      near(s.depth_dorsal, UNI.D);
      expect(s.depth_ventral).toBe(0);
      near(s.removed_area, UNI.area);
      expect(s.filled).toBe(false);
      nearAbs(s.original_angle_deg, UNI.angle, 0.5);
      near(s.recession, UNI.e);
      near(s.retouch_height, UNI.t);
      near(s.thickness, UNI.T);
      nearAbs(s.giur, 0.4, 0.005);
    }
    near(x.removed_volume, 277.13);
    nearAbs(x.erp, 0.0303, 0.005);
    near(x.erp, 277.13 / (277.13 + 8868.1));
    expect(x.erp_filled_share).toBe(0);
    nearAbs(x.giur, 0.4, 0.005);
    expect(x.giur_stations).toBe(31);
    expect(x.retouch_perimeter).toBeCloseTo(1, 9);
    expect(x.retouch_perimeter_dorsal).toBeCloseTo(1, 9);
    expect(x.retouch_perimeter_ventral).toBe(0);
    nearAbs(x.edge_curvature, 0, 0.005);
    near(x.edge_curvature_chord, 30);
    nearAbs(x.edge_curvature_depth, 0, 0.01);
    expect(x.axis).toBe('technical');
    expect(reasons).toEqual({});
  };

  it('unifacial at the default length: all the known answers', () => {
    const r = prism('unifacial');
    expectUnifacial(r);
    expect(r.indices.fitLength).toBe(5);
    expect(r.indices.parameters).toBe(RETOUCH_INDEX_PARAMETERS);
    // the row of a station: where A lies on the plan
    const s = r.indices.stations[10];
    expect(s.position).toBeCloseTo(10, 6);
    expect(s.x).toBeCloseTo(4, 5);
    expect(s.y).toBeCloseTo(15, 5);
    // y 15 is in the second of five rows of 8 mm; x 4 is left of the middle, 22
    expect(s.segment).toBe(2);
  });

  it('a longer fit stops at the ridge: the same; longer still, too little of it is left', () => {
    expectUnifacial(prism('unifacial', { fitLength: 20 }));
    const r = prism('unifacial', { fitLength: 30 });
    expect(r.details.map((d) => d.reason)).toEqual(new Array(31).fill('no_original_surface'));
    expect(r.indices.removed_volume).toBeNull();
    expect(r.indices.erp).toBeNull();
    expect(r.reasons.removed_volume).toBe('too_many_gaps');
    expect(r.reasons.erp).toBe('too_many_gaps');
    expect(r.indices.erp_filled_share).toBe(1);
    expect(r.indices.stations.every((s) => s.filled && s.removed_area === 0 && s.original_angle_deg === null && s.recession === null)).toBe(true);
  });

  it('the same in any position', () => {
    const f = rigid([1, 2, 3], 40, [100, -50, 7]);
    const { m, faceOf, pieceOf, pieces } = labelled('unifacial');
    const a = f([0, 0, 0]), minus = (p: Vec3): Vec3 => [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const matrix = frameMatrix({ origin: a, x: minus(f([1, 0, 0])), y: minus(f([0, 1, 0])), z: minus(f([0, 0, 1])) });
    expectUnifacial(run(mapped(m, f), prismEdge().map(f), false, faceOf, pieceOf, pieces, { matrix }));
  });

  it('bifacial: both sides from outside their retouch; no GIUR; both faces count in full', () => {
    const r = prism('bifacial');
    for (const s of r.indices.stations) {
      near(s.removed_area, 11.647);
      nearAbs(s.original_angle_deg, 40, 0.5);
      near(s.recession, 4);
      expect(s.giur).toBeNull();
    }
    expect(r.details.every((d) => d.giurReason === 'bifacial')).toBe(true);
    expect(r.indices.giur).toBeNull();
    expect(r.reasons.giur).toBe('no_dorsal_retouch');
    expect(r.indices.giur_stations).toBe(0);
    expect(r.indices.retouch_perimeter).toBeCloseTo(1, 9);
    expect(r.indices.retouch_perimeter_dorsal).toBeCloseTo(1, 9);
    expect(r.indices.retouch_perimeter_ventral).toBeCloseTo(1, 9);
  });

  it('flat: the two lines are parallel, and GIUR is 1', () => {
    const r = prism('flat');
    expect(r.details.map((d) => d.reason)).toEqual(new Array(31).fill('lines_do_not_meet'));
    expect(r.indices.removed_volume).toBeNull();
    expect(r.reasons.erp).toBe('too_many_gaps');
    for (const s of r.indices.stations) {
      near(s.retouch_height, 4.6188);
      near(s.thickness, 4.6188);
    }
    nearAbs(r.indices.giur, 1, 0.005);
  });

  it('inverse retouch: no GIUR; retouch on the ventral side counts for that face', () => {
    const { m, faceOf, pieceOf, pieces } = labelled('unifacial');
    // the same prism, with the faces the other way round
    const swapped = faceOf.map((f) => (f === FACE_DORSAL ? FACE_VENTRAL : f === FACE_VENTRAL ? FACE_DORSAL : f));
    const r = run(m, prismEdge(), false, swapped, pieceOf, pieces, { matrix: identity });
    expect(r.details.every((d) => d.giurReason === 'inverse')).toBe(true);
    expect(r.reasons.giur).toBe('no_dorsal_retouch');
    expect(r.indices.retouch_perimeter_dorsal).toBe(0);
    expect(r.indices.retouch_perimeter_ventral).toBeCloseTo(1, 9);
  });

  it('why values are empty', () => {
    const { m, faceOf, pieceOf, pieces } = labelled('unifacial');
    // no unit: no stations
    const noUnit = run(m, prismEdge(), false, faceOf, pieceOf, pieces, { matrix: identity, unit: '' });
    for (const k of ['removed_volume', 'erp', 'giur', 'retouch_perimeter', 'edge_curvature'] as const) expect(noUnit.reasons[k]).toBe('no_unit');
    // invasiveness asks for none
    expect(noUnit.indices.invasiveness).not.toBeNull();
    // an open mesh: no ERP, the volume removed stays
    const open = run(m, prismEdge(), false, faceOf, pieceOf, pieces, { matrix: identity, volume: null });
    near(open.indices.removed_volume, 277.13);
    expect(open.indices.erp).toBeNull();
    expect(open.reasons.erp).toBe('mesh_open');
    // faces not told
    const none = run(m, prismEdge(), false, new Uint8Array(faceOf.length), pieceOf, pieces, { matrix: identity });
    for (const k of ['removed_volume', 'erp', 'giur', 'invasiveness', 'invasiveness_continuous', 'retouch_perimeter_dorsal', 'retouch_perimeter_ventral'] as const) expect(none.reasons[k]).toBe('no_faces');
    expect(none.indices.retouch_perimeter).toBeCloseTo(1, 9);
    // a technical frame asked for, and none there
    const axisless = run(m, prismEdge(), false, faceOf, pieceOf, pieces, { matrix: null, settings: { axis: 'technical' } });
    expect(axisless.indices.axis).toBeNull();
    expect(axisless.reasons.invasiveness).toBe('no_axis');
    expect(axisless.reasons.edge_curvature).toBe('no_axis');
    expect(axisless.indices.stations[0].segment).toBeNull();
    // a retouch region, not on the edge
    const away = new Uint32Array(pieceOf.length);
    m.side.forEach((s, t) => (away[t] = s === 'CF' ? 1 : 0));
    const off = run(m, prismEdge(), false, faceOf, away, pieces, { matrix: identity });
    for (const k of ['removed_volume', 'erp', 'giur', 'edge_curvature'] as const) expect(off.reasons[k]).toBe('no_retouch_on_edge');
    expect(off.indices.retouch_perimeter).toBe(0);
    expect(off.indices.invasiveness).toBeGreaterThan(0);
    // no edge
    const sec = retouchSections({ positions: m.positions, index: m.index, points: prismEdge(), closed: false, unit: 'mm', meanEdge: meanEdgeOf(m), pieceOfFace: pieceOf, pieces })!;
    const frame = segmentFrame({ positions: m.positions, index: m.index, faceOf, settings: defaultRetouchSettings(), matrix: identity, morph: null, specimenFrame: null });
    const notEdge = retouchIndices({ positions: m.positions, index: m.index, faceOf, pieceOfFace: pieceOf, pieces, curves: [{ curveId: 'C1', edge: false, closed: false, length: sec.length, stations: sec.result.stations, sections: sec.sections }], unit: 'mm', meanEdge: meanEdgeOf(m), volume: 1, fitLength: null, frame });
    expect(notEdge.reasons.retouch_perimeter).toBe('no_edge');
    expect(notEdge.reasons.edge_curvature).toBe('no_retouch_on_edge');
    // it still counts for the volume removed
    near(notEdge.indices.removed_volume, 277.13);
  });

  it('no retouch region at all: not retouched', () => {
    const { m, faceOf, pieceOf } = labelled('unifacial');
    const r = run(m, prismEdge(), false, faceOf, pieceOf, new Map(), { matrix: identity });
    for (const k of ['removed_volume', 'erp', 'erp_filled_share', 'giur', 'giur_stations', 'invasiveness', 'invasiveness_continuous', 'retouch_perimeter', 'retouch_perimeter_dorsal', 'retouch_perimeter_ventral'] as const) expect(r.indices[k]).toBe(0);
    expect(r.indices.edge_curvature).toBeNull();
    expect(r.reasons.edge_curvature).toBe('no_retouch_on_edge');
    expect(r.indices.penetration.length).toBe(16);
    expect(r.indices.stations).toEqual([]);
  });
});

// ------------------------------------------------------------ the gaps

describe('gaps along a curve', () => {
  it('by the values on either side', () => {
    expect(fillGaps([1, null, 3])).toEqual([1, 2, 3]);
    expect(fillGaps([null, 2, 4])).toEqual([2, 2, 4]);
    expect(fillGaps([1, 2, null])).toEqual([1, 2, 2]);
  });
  it('round a closed curve', () => {
    expect(fillGaps([null, 2, null, 4], true)).toEqual([3, 2, 3, 4]);
  });
  it('by position, not by number', () => {
    expect(fillGaps([0, null, 10], false, [0, 1, 10])).toEqual([0, 1, 10]);
    // round a closed curve of length 10: from 8 past the start to 2
    expect(fillGaps([4, null, 8], true, [2, 5, 8], 10)).toEqual([4, 6, 8]);
    expect(fillGaps([null, 4, 8], true, [0, 2, 8], 10)).toEqual([6, 4, 8]);
  });
  it('none at all: 0; one: that one', () => {
    expect(fillGaps([null, null])).toEqual([0, 0]);
    expect(fillGaps([null, 5, null], true)).toEqual([5, 5, 5]);
  });
});

// ------------------------------------------------------------ the chord

describe('chord and depth', () => {
  const half: Array<[number, number]> = Array.from({ length: 181 }, (_, i) => [-30 * Math.cos((i * Math.PI) / 180), 30 * Math.sin((i * Math.PI) / 180)]);
  it('a half circle round its centre is convex', () => {
    const { chord, depth } = chordDepth(half, [0, 0]);
    expect(chord).toBeCloseTo(60, 6);
    expect(depth).toBeCloseTo(30, 6);
  });
  it('seen from beyond it, concave', () => {
    const { chord, depth } = chordDepth(half, [0, 50]);
    expect(chord).toBeCloseTo(60, 6);
    expect(depth).toBeCloseTo(-30, 6);
  });
  it('in either direction', () => {
    expect(chordDepth([...half].reverse(), [0, 0]).depth).toBeCloseTo(30, 6);
    expect(chordDepth([...half].reverse(), [0, 50]).depth).toBeCloseTo(-30, 6);
    expect(chordDepth([...half].reverse(), [0, -1]).depth).toBeCloseTo(30, 6);
  });
});

// ------------------------------------------------------------ invasiveness

/** A plate x in [−10, 10], y in [0, 40], z in [0, 2]: top and bottom in a 0.5 mm grid, a band round the side. */
function plate(): Mesh & { face: number[] } {
  const nx = 40, ny = 80;
  const pos: number[] = [];
  const v = (z: number, i: number, j: number) => z * (nx + 1) * (ny + 1) + j * (nx + 1) + i;
  for (const z of [0, 2]) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) pos.push(-10 + i / 2, j / 2, z);
  const index: number[] = [];
  const face: number[] = [];
  const tri = (a: number, b: number, c: number, f: number) => {
    index.push(a, b, c);
    face.push(f);
  };
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      tri(v(1, i, j), v(1, i + 1, j), v(1, i + 1, j + 1), FACE_DORSAL);
      tri(v(1, i, j), v(1, i + 1, j + 1), v(1, i, j + 1), FACE_DORSAL);
      tri(v(0, i, j), v(0, i + 1, j + 1), v(0, i + 1, j), FACE_VENTRAL);
      tri(v(0, i, j), v(0, i, j + 1), v(0, i + 1, j + 1), FACE_VENTRAL);
    }
  const rim: Array<[number, number]> = [];
  for (let i = 0; i < nx; i++) rim.push([i, 0]);
  for (let j = 0; j < ny; j++) rim.push([nx, j]);
  for (let i = nx; i > 0; i--) rim.push([i, ny]);
  for (let j = ny; j > 0; j--) rim.push([0, j]);
  rim.forEach(([i, j], k) => {
    const [a, b] = rim[(k + 1) % rim.length];
    tri(v(0, i, j), v(0, a, b), v(1, a, b), FACE_NONE);
    tri(v(0, i, j), v(1, a, b), v(1, i, j), FACE_NONE);
  });
  return { positions: new Float32Array(pos), index: new Uint32Array(index), face };
}

describe('invasiveness on a plate', () => {
  it('each segment by its reach; the side retouch that falls into a proximal segment counts by the end alone', () => {
    const m = plate();
    const pieceOf = new Uint32Array(m.face.length);
    m.face.forEach((f, t) => {
      const c = [0, 1].map((k) => (m.positions[3 * m.index[3 * t] + k] + m.positions[3 * m.index[3 * t + 1] + k] + m.positions[3 * m.index[3 * t + 2] + k]) / 3);
      const [x, y] = c;
      const dorsal = (x < -8 && y >= 8 && y < 32) || (x < -3 && y >= 16 && y < 24) || y > 38;
      const ventral = x > 9 && y < 8;
      pieceOf[t] = (f === FACE_DORSAL && dorsal) || (f === FACE_VENTRAL && ventral) ? 1 : 0;
    });
    const r = run(m, [[0, 0, 0], [0, 1, 0]], false, m.face, pieceOf, new Map([[1, { region: 'R1', layer: 1 }]]), { matrix: identity });
    const row = (n: number) => r.indices.penetration[n - 1];
    expect(r.indices.penetration.map((p) => p.segment)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(r.indices.penetration.map((p) => p.score)).toEqual([0, 0.5, 0, 1, 0, 0.5, 0, 0.5, 1, 0, 0, 0, 0, 0, 0, 0]);
    expect(r.indices.invasiveness).toBe(0.21875);
    nearAbs(r.indices.invasiveness_continuous, 0.1411, 0.005);
    nearAbs(row(2).penetration, 0.1833, 0.001);
    nearAbs(row(6).penetration, 0.1833, 0.001);
    nearAbs(row(4).penetration, 0.6833, 0.001);
    nearAbs(row(8).penetration, 0.2292, 0.001);
    nearAbs(row(9).penetration, 0.9792, 0.001);
    expect(row(2).face).toBe('dorsal');
    expect(row(9).face).toBe('ventral');
  });
});

// ------------------------------------------------------------ the stepped tool

describe('the stepped tool', () => {
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
    const centre = (t: number) => [0, 1, 2].map((k) => (m.positions[3 * m.index[3 * t] + k] + m.positions[3 * m.index[3 * t + 1] + k] + m.positions[3 * m.index[3 * t + 2] + k]) / 3) as Vec3;
    const at = (p: Vec3): number => {
      let best = 0, least = Infinity;
      for (let t = 0; t < tris; t++) {
        const c = centre(t);
        const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
        if (d < least) {
          least = d;
          best = t;
        }
      }
      return part.region[best];
    };
    const faceOf = new Uint8Array(tris);
    const top = new Set([at(onTop(27)), at(onTop(18)), at(onTop(5))]);
    for (let t = 0; t < tris; t++) faceOf[t] = top.has(part.region[t]) ? FACE_DORSAL : FACE_VENTRAL;
    return { m, edge, part, at, faceOf, centre, tris };
  }

  it('two layers: GIUR by the outer end of the second; half the segments reached past their middle', () => {
    const { m, edge, part, at, faceOf } = tool();
    const r = run(m, edge, true, faceOf, part.region, new Map([[at(onTop(27)), { region: 'R1', layer: 1 }], [at(onTop(18)), { region: 'R2', layer: 2 }]]));
    const x = r.indices;
    nearAbs(x.giur, 0.941, 0.01);
    expect(x.axis).toBe('longest');
    nearAbs(x.retouch_perimeter, 1, 1e-9);
    expect(x.edge_curvature).toBeNull();
    expect(r.reasons.edge_curvature).toBe('whole_edge');
    expect(x.invasiveness).toBe(0.5);
    nearAbs(x.invasiveness_continuous, 0.45, 0.02);
    near(x.stations[30].retouch_height, 8, 0.02);
    near(x.stations[30].thickness, 8.5, 0.01);
    expect(x.erp).toBeGreaterThan(0);
    expect(x.erp).toBeLessThan(1);
    // each region a row: all the way round, so no chord
    expect(x.segments.map((s) => [s.region, s.layer, s.face])).toEqual([['R1', 1, 'dorsal'], ['R2', 2, 'dorsal']]);
    const total = x.stations.length;
    for (const s of x.segments) {
      nearAbs(s.length, total, 1.5);
      expect(s.chord).toBeNull();
      expect(s.depth).toBeNull();
    }
  });

  it('the first layer alone', () => {
    const { m, edge, part, at, faceOf } = tool();
    const r = run(m, edge, true, faceOf, part.region, new Map([[at(onTop(27)), { region: 'R1', layer: 1 }]]));
    nearAbs(r.indices.giur, 0.706, 0.01);
    expect(r.indices.invasiveness).toBe(0.3125);
    expect(r.indices.penetration.slice(0, 8).map((p) => p.score)).toEqual([1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1]);
    expect(r.indices.penetration.slice(8).every((p) => p.score === 0)).toBe(true);
  });

  it('half of the first layer: the chord across the edge, as deep as the radius; the region has the same', () => {
    const { m, edge, part, at, faceOf, centre, tris } = tool();
    const pieceOf = new Uint32Array(tris);
    const band = at(onTop(27));
    for (let t = 0; t < tris; t++) pieceOf[t] = part.region[t] === band && centre(t)[1] > 0 ? 1 : 0;
    const r = run(m, edge, true, faceOf, pieceOf, new Map([[1, { region: 'R1', layer: 1 }]]));
    nearAbs(r.indices.edge_curvature, 0.5, 0.02);
    near(r.indices.edge_curvature_chord, 60, 0.02);
    near(r.indices.edge_curvature_depth, 30, 0.02);
    expect(r.indices.retouch_perimeter).toBeGreaterThan(0.45);
    expect(r.indices.retouch_perimeter).toBeLessThan(0.55);
    const [row] = r.indices.segments;
    near(row.chord, 60, 0.02);
    near(row.depth, 30, 0.02);
    near(row.length, Math.PI * 30, 0.03);
  });

  it('a stretch over the start of a closed edge: from its far side round', () => {
    const { m, edge, part, at, faceOf, centre, tris } = tool();
    const pieceOf = new Uint32Array(tris);
    const band = at(onTop(27));
    // round the start of the ring, which is at angle 0
    for (let t = 0; t < tris; t++) {
      const c = centre(t);
      pieceOf[t] = part.region[t] === band && Math.abs(Math.atan2(c[1], c[0])) < Math.PI / 3 ? 1 : 0;
    }
    const r = run(m, edge, true, faceOf, pieceOf, new Map([[1, { region: 'R1', layer: 1 }]]));
    const [row] = r.indices.segments;
    expect(row.start_position).toBeGreaterThan(row.end_position);
    // 120° of the ring: the chord of that arc, and its sagitta
    near(row.chord, 2 * 30 * Math.sin(Math.PI / 3), 0.03);
    near(row.depth, 30 * (1 - Math.cos(Math.PI / 3)), 0.08);
    expect(r.indices.edge_curvature_chord).toBeCloseTo(row.chord!, 6);
  });

  it('a gap of up to 2 mm is part of the stretch; a longer one parts it', () => {
    const { m, edge, part, at, faceOf, centre, tris } = tool();
    const band = at(onTop(27));
    const piece = (halfGap: number) => {
      const pieceOf = new Uint32Array(tris);
      for (let t = 0; t < tris; t++) {
        const c = centre(t);
        const a = Math.atan2(c[1], c[0]);
        // from 30° to 150° with a gap at the middle
        pieceOf[t] = part.region[t] === band && a > Math.PI / 6 && a < (5 * Math.PI) / 6 && Math.abs(a - Math.PI / 2) > halfGap ? 1 : 0;
      }
      return pieceOf;
    };
    const chord = (halfGap: number) => run(m, edge, true, faceOf, piece(halfGap), new Map([[1, { region: 'R1', layer: 1 }]])).indices.edge_curvature_chord;
    // the whole 120°
    near(chord(0.5 / 30), 2 * 30 * Math.sin(Math.PI / 3), 0.04);
    // one of the two parts
    near(chord(6 / 30), 2 * 30 * Math.sin((Math.PI / 3 - 6 / 30) / 2), 0.08);
  });
});

// ------------------------------------------------------------ the frame

describe('the frame of the plan', () => {
  const { m, faceOf } = labelled('unifacial');
  const morph = { length: 40, width: 1, thickness: 1, lengthDir: [0, 1, 0] as Vec3 };
  const frameOf = (settings: Partial<RetouchSettings>, matrix: readonly number[] | null = null, specimenFrame: readonly number[] | null = null, faces: ArrayLike<number> = faceOf, dir: Vec3 = morph.lengthDir) =>
    segmentFrame({ positions: m.positions, index: m.index, faceOf: faces, settings: { ...defaultRetouchSettings(), ...settings }, matrix, morph: { ...morph, lengthDir: dir }, specimenFrame });

  it('auto: the technical axis when there is one, else the longest', () => {
    expect(frameOf({}, identity).frame?.kind).toBe('technical');
    expect(frameOf({}).frame?.kind).toBe('longest');
    expect(frameOf({ axis: 'longest' }, identity).frame?.kind).toBe('longest');
    expect(frameOf({ axis: 'technical' }).reason).toBe('no_axis');
  });

  it('the technical axis: from 0 to its length', () => {
    const f = frameOf({}, identity).frame!;
    expect(f.y0).toBe(0);
    expect(f.y1).toBeCloseTo(40, 5);
  });

  it('the longest axis: Y with the specimen frame, the other way when flipped; Z by the dorsal normals, X = Y × Z', () => {
    const f = frameOf({ axis: 'longest' }, null, identity, faceOf, [0, -1, 0]).frame!;
    expect(f.y[1]).toBeCloseTo(1, 9);
    expect(f.y0).toBeCloseTo(0, 5);
    expect(f.y1).toBeCloseTo(40, 5);
    // the dorsal face of the prism looks up (and a little to the left), the Y component gone
    expect(f.z[1]).toBeCloseTo(0, 9);
    expect(f.z[2]).toBeGreaterThan(0.5);
    const c = [f.y[1] * f.z[2] - f.y[2] * f.z[1], f.y[2] * f.z[0] - f.y[0] * f.z[2], f.y[0] * f.z[1] - f.y[1] * f.z[0]];
    expect(f.x[0]).toBeCloseTo(c[0], 9);
    expect(f.x[2]).toBeCloseTo(c[2], 9);
    const flipped = frameOf({ axis: 'longest', flip: true }, null, identity, faceOf, [0, -1, 0]).frame!;
    expect(flipped.y[1]).toBeCloseTo(-1, 9);
    expect(flipped.y0).toBeCloseTo(-40, 5);
  });

  it('without a dorsal face, the ventral normal turned round; with neither, or along Y, no frame', () => {
    const ventralOnly = faceOf.map((f) => (f === FACE_VENTRAL ? f : FACE_NONE));
    const f = frameOf({ axis: 'longest' }, null, null, ventralOnly).frame!;
    expect(f.z[2]).toBeCloseTo(1, 9);
    expect(frameOf({ axis: 'longest' }, null, null, new Uint8Array(faceOf.length)).reason).toBe('frame_failed');
    expect(frameOf({ axis: 'longest' }, null, null, ventralOnly, [0, 0, 1]).reason).toBe('frame_failed');
  });
});

// ------------------------------------------------------------ in the project

describe('the settings in the project', () => {
  const store = () => new ProjectStore(emptyProject());

  it('default, and in a file that lacks them', () => {
    const s = store();
    expect(retouchSettingsOf(s.state.flake)).toEqual({ fitLength: null, axis: 'auto', flip: false });
    const file = JSON.parse(JSON.stringify(serializeProject(s.state, '0.2.0')));
    expect(file.flake.retouch).toEqual({ fitLength: null, axis: 'auto', flip: false });
    delete file.flake.retouch;
    expect(retouchSettingsOf(parseProjectFile(file).flake)).toEqual({ fitLength: null, axis: 'auto', flip: false });
  });

  it('each a step of its own, undone; out of range, the nearest in it', () => {
    const s = store();
    setRetouchFitLength(s, 8);
    expect(retouchSettingsOf(s.state.flake).fitLength).toBe(8);
    setRetouchAxis(s, 'longest');
    setRetouchFlip(s, true);
    expect(retouchSettingsOf(s.state.flake)).toEqual({ fitLength: 8, axis: 'longest', flip: true });
    s.history.undo();
    s.history.undo();
    expect(retouchSettingsOf(s.state.flake)).toEqual({ fitLength: 8, axis: 'auto', flip: false });
    s.history.undo();
    expect(s.state.flake.retouch).toBeUndefined();
    setRetouchFitLength(s, 100);
    expect(retouchSettingsOf(s.state.flake).fitLength).toBe(20);
    setRetouchFitLength(s, 0.1);
    expect(retouchSettingsOf(s.state.flake).fitLength).toBe(1);
    setRetouchFitLength(s, 7.3);
    expect(retouchSettingsOf(s.state.flake).fitLength).toBe(7.5);
    setRetouchFitLength(s, null);
    expect(retouchSettingsOf(s.state.flake).fitLength).toBeNull();
    // nothing changes: no step
    s.history.clear();
    setRetouchFitLength(s, null);
    expect(s.history.canUndo).toBe(false);
  });

  it('through the file, what it does not understand taking its default', () => {
    const s = store();
    setRetouchFitLength(s, 12.5);
    setRetouchAxis(s, 'technical');
    setRetouchFlip(s, true);
    const file = JSON.parse(JSON.stringify(serializeProject(s.state, '0.2.0')));
    expect(file.flake.retouch).toEqual({ fitLength: 12.5, axis: 'technical', flip: true });
    expect(retouchSettingsOf(parseProjectFile(file).flake)).toEqual({ fitLength: 12.5, axis: 'technical', flip: true });
    file.flake.retouch = { fitLength: 99, axis: 'sideways', flip: 'yes' };
    expect(retouchSettingsOf(parseProjectFile(file).flake)).toEqual({ fitLength: 20, axis: 'auto', flip: false });
  });

  it('a fitted length is clamped and stepped', () => {
    expect(clampFitLength(0)).toBe(1);
    expect(clampFitLength(21)).toBe(20);
    expect(clampFitLength(5.2)).toBe(5);
  });

  it('the derived results: a flake has them, a core does not; no reasons in the file', () => {
    const s = store();
    const r = prism('unifacial');
    s.state.specimen.type = 'flake';
    const file = JSON.parse(JSON.stringify(serializeProject(s.state, '0.2.0', { measurements: null, vertices: null, retouchIndices: r.indices })));
    expect(file.derived.retouchIndices.fitLength).toBe(5);
    expect(file.derived.retouchIndices.axis).toBe('technical');
    expect(file.derived.retouchIndices.parameters.ORIGINAL_FIT_MM).toBe(5);
    expect(file.derived.retouchIndices.stations.length).toBe(31);
    expect(file.derived.retouchIndices.penetration.length).toBe(16);
    expect(JSON.stringify(file.derived.retouchIndices)).not.toContain('reason');
    s.state.specimen.type = 'core';
    expect(serializeProject(s.state, '0.2.0', { measurements: null, vertices: null, retouchIndices: r.indices }).derived.retouchIndices).toBeUndefined();
  });
});

describe('the tables', () => {
  const s = new ProjectStore(emptyProject());
  s.state.curves.push({ id: 'C1', label: 'C7', anchors: [], points: [], anchorIndex: [], closed: false, attributes: { type: 'edge' }, createdAt: '', modifiedAt: '' });
  s.state.regions.push({ id: 'R1', label: 'R4', seed: [0, 0, 0], type: 'retouch', scarId: null, retouchLayer: 1, createdAt: '', modifiedAt: '' });
  const r = prism('unifacial').indices;

  it('flakes.csv ends with the fifteen columns of the indices, in their order', () => {
    const [head, row] = flakesCsv(s.state, null, { excelBom: false }, r).trim().split('\n');
    const names = head.split(',');
    expect(names.slice(-15)).toEqual(['retouch_axis', 'retouch_fit_length', 'removed_volume', 'erp', 'erp_filled_share', 'giur', 'giur_stations', 'invasiveness', 'invasiveness_continuous', 'retouch_perimeter', 'retouch_perimeter_dorsal', 'retouch_perimeter_ventral', 'edge_curvature', 'edge_curvature_chord', 'edge_curvature_depth']);
    expect(RETOUCH_FLAKE_COLUMNS.length).toBe(15);
    const cells = Object.fromEntries(names.map((n, i) => [n, row.split(',')[i]]));
    expect(cells.retouch_axis).toBe('technical');
    expect(cells.retouch_fit_length).toBe('5');
    near(Number(cells.erp), 0.0303);
    expect(cells.giur_stations).toBe('31');
    // not computed yet: the columns, empty
    const empty = flakesCsv(s.state, null, { excelBom: false }, null).trim().split('\n');
    expect(empty[0]).toBe(head);
    expect(empty[1].split(',').slice(-15)).toEqual(new Array(15).fill(''));
  });

  it('retouch_sections.csv: a row per retouched station', () => {
    const [head, ...rows] = retouchSectionsCsv(s.state, r, { excelBom: false }).trim().split('\n');
    expect(head).toBe('specimen_id,curve_id,station,position,segment,x,y,depth_dorsal,depth_ventral,removed_area,filled,original_angle_deg,recession,retouch_height,thickness,giur');
    expect(rows.length).toBe(31);
    const c = rows[10].split(',');
    expect(c[1]).toBe('C7');
    expect(c[2]).toBe('10');
    expect(c[4]).toBe('2');
    expect(c[8]).toBe('0');
    expect(c[10]).toBe('false');
    expect(retouchSectionsCsv(s.state, null, { excelBom: true }).charCodeAt(0)).toBe(0xfeff);
  });

  it('retouch_segments.csv: a row per region, by its label', () => {
    const [head, ...rows] = retouchSegmentsCsv(s.state, r, { excelBom: false }).trim().split('\n');
    expect(head).toBe('specimen_id,curve_id,retouch_region,retouch_layer,face,start_position,end_position,length,chord,depth');
    expect(rows.length).toBe(1);
    const c = rows[0].split(',');
    expect(c.slice(1, 7)).toEqual(['C7', 'R4', '1', 'dorsal', '0', '30']);
    near(Number(c[7]), 30);
    near(Number(c[8]), 30);
    nearAbs(Number(c[9]), 0, 0.01);
  });

  it('the summary: from what each project stored; a project without them has the columns, empty', () => {
    const measures = { auto: { frame: 'principal' as const, length: 1, width: 1, thickness: 1, surfaceArea: 1, volume: 1, closed: true }, vertices: null, box: null };
    const specimen = (id: string, derived: Record<string, unknown>) => {
      const p = new ProjectStore(emptyProject());
      p.state.specimen.id = id;
      p.state.specimen.type = 'flake';
      p.state.curves.push(s.state.curves[0]);
      p.state.regions.push(s.state.regions[0]);
      const project = { path: `${id}.json`, state: p.state, derived, appVersion: '0.2.0' };
      return batchSpecimen(`${id}.ply`, { project, measures }, [{ project, measures }]);
    };
    const files = batchOutputs([specimen('A', { retouchIndices: JSON.parse(JSON.stringify(r)) }), specimen('B', {})], { excelBom: false });
    const text = (name: string) => files.find((f) => f.suffix === name)!.text.trim().split('\n');
    expect(text('flakes.csv').slice(1).map((l) => l.split(',').slice(-14, -13)[0])).toEqual(['5', '']);
    expect(text('retouch_sections.csv').length).toBe(1 + 31);
    expect(text('retouch_segments.csv').length).toBe(2);
    expect(text('invasiveness.csv').length).toBe(1 + 16);
    expect(new Set(text('invasiveness.csv').slice(1).map((l) => l.split(',')[0]))).toEqual(new Set(['A']));
  });

  it('invasiveness.csv: sixteen rows', () => {
    const [head, ...rows] = invasivenessCsv(s.state, r, { excelBom: false }).trim().split('\n');
    expect(head).toBe('specimen_id,face,segment,penetration,score');
    expect(rows.length).toBe(16);
    expect(rows[0].split(',').slice(1, 3)).toEqual(['dorsal', '1']);
    expect(rows[15].split(',').slice(1, 3)).toEqual(['ventral', '16']);
  });
});

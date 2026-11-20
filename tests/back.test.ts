import { describe, expect, it } from 'vitest';
import { compareObservers, FACE_TYPES, type FaceLabels } from '../src/compute/agreement';
import { gmPoints } from '../src/compute/gm';
import { projectLayersSteps, type RegionLayers } from '../src/compute/projectRegions';
import { overPiecesSteps, resolveRegions } from '../src/compute/regions';
import { buildEdges, signedVolume } from '../src/compute/meshGeometry';
import { retouchSections, type RetouchPiece } from '../src/compute/retouchAngle';
import { FACE_DORSAL, FACE_NONE, faceCodeOf, retouchIndices, segmentFrame } from '../src/compute/retouchIndex';
import { defaultRetouchSettings } from '../src/core/types';
import { runSync } from '../src/compute/steps';
import { addCurveOfType, addRegion, setRegionType, setSpecimenType, setTechnicalAxis } from '../src/core/actions';
import { CURVE_FIELDS, isBoundaryCurve, keyedOptions, keyIndex, numberKeyField, optionKey, REGION_FIELDS } from '../src/core/fields';
import { frameMatrix } from '../src/core/frame';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import type { ProjectState, Vec3 } from '../src/core/types';
import { flakeT9, T9, T9_AREAS } from './meshes';

/** Stage 33: the back of a core-edge flake (T9: tests/meshes.ts). */

const m = flakeT9();
/** A curve through these points, traced as the app traces one: points about half a millimetre apart (an open end joins a boundary curve within four of them). */
const shape = (corners: Vec3[], closed: boolean) => {
  const points: Vec3[] = [];
  const anchorIndex: number[] = [];
  const legs = closed ? corners.length : corners.length - 1;
  for (let i = 0; i < legs; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.5));
    anchorIndex.push(points.length);
    for (let j = 0; j < k; j++) points.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k, a[2] + ((b[2] - a[2]) * j) / k]);
  }
  if (!closed) {
    anchorIndex.push(points.length);
    points.push(corners[corners.length - 1]);
  }
  return { anchors: anchorIndex.map((i) => points[i]), points, anchorIndex, closed };
};
const { A, B, C, F } = T9;
/** Points on the faces: the midpoints of A–C and A–F (vertices of the mesh, n even). */
const M1: Vec3 = [(A[0] + C[0]) / 2, 0, (A[2] + C[2]) / 2], M2: Vec3 = [(A[0] + F[0]) / 2, (A[1] + F[1]) / 2, 0];

/** T9 annotated as a flake: its axis from P on the platform's ventral edge, the platform outline A–B–C, the edge A–F–B, and its back ridges. */
function t9(o: { ridges?: Vec3[][]; lower?: Array<{ type: string; seed: Vec3 }> } = {}): ProjectStore {
  const s = new ProjectStore(emptyProject());
  setSpecimenType(s, 'flake');
  const P: Vec3 = [-2.5, 0, 0];
  setTechnicalAxis(s, { start: P, end: [5, 30, 0], startNormal: [0, 0, -1], endNormal: [0, 0, -1], matrix: frameMatrix({ origin: P, x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }), failure: null });
  addCurveOfType(s, shape([A, B, C], true), 'platform_outline');
  addCurveOfType(s, shape([A, F, B], false), 'edge');
  for (const r of o.ridges ?? [[C, F]]) addCurveOfType(s, shape(r, false), 'back_ridge');
  for (const l of o.lower ?? []) addRegion(s, l.seed, l.type, null);
  return s;
}

const layersOf = (st: Readonly<ProjectState>): RegionLayers => runSync(projectLayersSteps(st, { positions: m.positions, index: m.index, offset: [0, 0, 0] }));

function regionsOf(st: Readonly<ProjectState>) {
  const layers = layersOf(st);
  const over = runSync(overPiecesSteps(layers.lower, layers.upper!));
  let total = 0;
  for (const a of layers.lower.areas) total += a;
  return { layers, ...resolveRegions(st.regions, layers.lowerComponent, layers.lower, total, { component: layers.upperComponent, partition: layers.upper!, over }) };
}

/** Each upper region's area, by type (summed). */
const areaByType = (st: Readonly<ProjectState>, r: ReturnType<typeof regionsOf>) => {
  const out: Record<string, number> = {};
  st.regions.forEach((x, i) => {
    const c = r.layers.upperComponent[i];
    if (c >= 0) out[x.type] = (out[x.type] ?? 0) + r.layers.upper!.areas[c];
  });
  return out;
};

describe('the back ridge and the back (33)', () => {
  it('T9 is closed, its four faces as their areas say', () => {
    let sum = 0;
    for (let t = 0; t < m.index.length / 3; t++) {
      const p = [0, 1, 2].map((k) => [0, 1, 2].map((j) => m.positions[3 * m.index[3 * t + k] + j]));
      const u = p[1].map((x, j) => x - p[0][j]), v = p[2].map((x, j) => x - p[0][j]);
      sum += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
    }
    expect(sum).toBeCloseTo(T9_AREAS.platform + T9_AREAS.ventral + T9_AREAS.back + T9_AREAS.dorsal, 3);
    // the back is square to the ventral face
    expect(T9_AREAS.back).toBeCloseTo(0.5 * 6 * 40, 9);
  });

  it('is a flake\'s boundary curve, keyed 7 among its curve types; the back keyed 8 among its region types, the user\'s own 0', () => {
    expect(isBoundaryCurve('back_ridge', 'flake')).toBe(true);
    expect(isBoundaryCurve('back_ridge', 'core')).toBe(false);
    const curves = keyedOptions(numberKeyField(CURVE_FIELDS)!, 'flake');
    expect(curves.map((o) => (o === 'custom' ? o : o.value)).indexOf('back_ridge')).toBe(keyIndex('7'));
    expect(curves.length).toBe(8);
    const regions = keyedOptions(numberKeyField(REGION_FIELDS)!, 'flake');
    expect(regions.map((o) => (o === 'custom' ? o : o.value))).toEqual(['scar', 'cortex', 'joint', 'damage', 'platform', 'ventral', 'dorsal', 'back', 'retouch', 'custom']);
    expect(regions[keyIndex('8')]).toMatchObject({ value: 'back' });
    expect(regions[keyIndex('9')]).toMatchObject({ value: 'retouch' });
    expect(regions[keyIndex('0')]).toBe('custom');
    expect([0, 8, 9, 10].map(optionKey)).toEqual(['1', '9', '0', undefined]);
    // a core has neither
    expect(keyedOptions(numberKeyField(CURVE_FIELDS)!, 'core').some((o) => o !== 'custom' && o.value === 'back_ridge')).toBe(false);
    expect(keyedOptions(numberKeyField(REGION_FIELDS)!, 'core').some((o) => o !== 'custom' && o.value === 'back')).toBe(false);
  });

  it('a back ridge: the upper layer parts into platform, ventral face, dorsal face and back, each its own area (the curves on the mesh\'s edges: exact)', () => {
    const s = t9();
    const back = s.state.regions.filter((r) => r.type === 'back');
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ auto: true, curveId: s.state.curves.find((c) => c.attributes.type === 'back_ridge')!.id });
    const r = regionsOf(s.state);
    const areas = areaByType(s.state, r);
    for (const k of ['platform', 'ventral', 'dorsal', 'back'] as const) expect(Math.abs(areas[k] - T9_AREAS[k]), k).toBeLessThan(1e-3);
    expect(r.totals.back).toBeCloseTo(T9_AREAS.back, 3);
  });

  it('cortex on the back lies in the back (its parent region)', () => {
    const s = t9({ lower: [{ type: 'cortex', seed: [10, 10, 1.5] }] });
    const r = regionsOf(s.state);
    const cortex = s.state.regions.find((x) => x.type === 'cortex')!;
    const back = s.state.regions.find((x) => x.type === 'back')!;
    expect(r.results.find((x) => x.id === cortex.id)!.parent).toBe(back.id);
    expect(r.results.find((x) => x.id === cortex.id)!.area).toBeCloseTo(T9_AREAS.back, 3);
  });

  it('two back ridges, two backs: the second cuts the dorsal face from A–C\'s middle to A–F\'s, a quarter of it', () => {
    const s = t9({ ridges: [[C, F], [M1, M2]] });
    const backs = s.state.regions.filter((x) => x.type === 'back');
    expect(backs).toHaveLength(2);
    const r = regionsOf(s.state);
    const got = backs.map((b) => r.layers.upper!.areas[r.layers.upperComponent[s.state.regions.indexOf(b)]]).sort((a, b) => a - b);
    expect(got[0]).toBeCloseTo(T9_AREAS.back, 3);
    expect(got[1]).toBeCloseTo(T9_AREAS.dorsal / 4, 3);
    expect(areaByType(s.state, r).dorsal).toBeCloseTo((3 * T9_AREAS.dorsal) / 4, 3);
  });

  it('a ridge that does not reach the edge parts nothing: no back (its piece none), the dorsal face whole', () => {
    // from C into the dorsal face, to its incentre: about 9 mm from every boundary curve, beyond the reach an open end joins one at
    // (four of the traced curve's segments, here the mesh's 1.7 mm)
    const a = Math.hypot(C[0] - F[0], C[1] - F[1], C[2] - F[2]), b = Math.hypot(A[0] - F[0], A[1] - F[1], A[2] - F[2]), c = Math.hypot(A[0] - C[0], A[1] - C[1], A[2] - C[2]);
    const I = [0, 1, 2].map((k) => (a * A[k] + b * C[k] + c * F[k]) / (a + b + c)) as Vec3;
    const s = t9({ ridges: [[C, I]] });
    const r = regionsOf(s.state);
    const i = s.state.regions.findIndex((x) => x.type === 'back');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(r.layers.upperComponent[i]).toBe(-1);
    expect(areaByType(s.state, r).dorsal).toBeCloseTo(T9_AREAS.dorsal + T9_AREAS.back, 3);
  });

  it('the back given another type by hand is the user\'s, and the ridge has no back from then on', () => {
    const s = t9();
    const back = s.state.regions.find((x) => x.type === 'back')!;
    setRegionType(s, back.id, 'joint', null, [10, 10, 1.5]);
    const r = s.state.regions.find((x) => x.id === back.id)!;
    expect(r.auto).toBeUndefined();
    expect(r.curveId).toBeUndefined();
    expect(s.state.curves.find((c) => c.attributes.type === 'back_ridge')!.retouchSide).toBe('off');
    expect(s.state.regions.some((x) => x.type === 'back')).toBe(false);
    // undo: the back again
    s.history.undo();
    expect(s.state.regions.some((x) => x.type === 'back' && x.auto)).toBe(true);
  });

  it('the dorsal face\'s points by the grid are the same with a back ridge as without', () => {
    const run = (s: ProjectStore) => gmPoints(s.state, { positions: m.positions, index: m.index, platformFaces: Array.from(m.platform) });
    const a = run(t9({ ridges: [] })), b = run(t9());
    const dorsal = (g: typeof a) => g.rows.filter((x) => x.kind === 'surface' && x.setId === 'dorsal');
    expect(dorsal(a).length).toBeGreaterThan(0);
    expect(dorsal(b)).toEqual(dorsal(a));
  });

  it('retouch on the back counts as the dorsal side: coded so for the retouch indices, its invasiveness in the dorsal segments', () => {
    expect(faceCodeOf('back')).toBe(FACE_DORSAL);
    expect(faceCodeOf('dorsal')).toBe(FACE_DORSAL);
    expect(faceCodeOf('cortex')).toBe(FACE_NONE);
    // the faces coded by their regions' types, as the app codes them; a retouch strip on the back along the edge B–F, 3 mm high (wider than a sliver of T9's coarse mesh)
    const faceOf = new Uint8Array(m.index.length / 3);
    for (const [name, list] of [['platform', m.platform], ['ventral', m.ventral], ['back', m.back], ['dorsal', m.dorsal]] as const) for (const t of list) faceOf[t] = faceCodeOf(name);
    const pieceOf = new Uint32Array(faceOf.length);
    for (const t of m.back) if ([0, 1, 2].every((k) => m.positions[3 * m.index[3 * t + k] + 2] <= 3 + 1e-6)) pieceOf[t] = 1;
    const pieces = new Map<number, RetouchPiece>([[1, { region: 'R1', layer: 1 }]]);
    const e = buildEdges(m.index, m.positions.length / 3);
    let sum = 0;
    for (let i = 0; i < e.v0.length; i++) sum += Math.hypot(...[0, 1, 2].map((k) => m.positions[3 * e.v0[i] + k] - m.positions[3 * e.v1[i] + k]));
    const meanEdge = sum / e.v0.length;
    const edge = shape([A, F, B], false).points;
    const sec = retouchSections({ positions: m.positions, index: m.index, points: edge, closed: false, unit: 'mm', meanEdge, pieceOfFace: pieceOf, pieces })!;
    const curves = [{ curveId: 'C1', edge: true, closed: false, length: sec.length, stations: sec.result.stations, sections: sec.sections }];
    const matrix = frameMatrix({ origin: [-2.5, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] });
    const frame = segmentFrame({ positions: m.positions, index: m.index, faceOf, settings: defaultRetouchSettings(), matrix, morph: null, specimenFrame: null });
    const r = retouchIndices({ positions: m.positions, index: m.index, faceOf, pieceOfFace: pieceOf, pieces, curves, unit: 'mm', meanEdge, volume: Math.abs(signedVolume(m.positions, m.index)), fitLength: null, frame });
    // its invasiveness in the dorsal eight segments, its perimeter dorsal
    const scored = r.indices.penetration.filter((p) => p.score > 0);
    expect(scored.length).toBeGreaterThan(0);
    expect(scored.every((p) => p.face === 'dorsal' && p.segment <= 8)).toBe(true);
    expect(r.indices.retouch_perimeter_dorsal).toBeGreaterThan(0);
    expect(r.indices.retouch_perimeter_ventral).toBe(0);
  });

  it('two observers\' backs: their overlap is a row of the agreement table', () => {
    const labels = (st: Readonly<ProjectState>): FaceLabels => {
      const layers = layersOf(st);
      const n = m.index.length / 3;
      const out: FaceLabels = { type: new Uint8Array(n), region: new Int32Array(n).fill(-1) };
      st.regions.forEach((r, i) => {
        const c = layers.upperComponent[i];
        if (c < 0) return;
        for (let t = 0; t < n; t++) if (layers.upper!.region[t] === c) {
          out.type[t] = FACE_TYPES.indexOf(r.type);
          out.region[t] = i;
        }
      });
      return out;
    };
    const a = t9(), b = t9({ ridges: [[C, F], [M1, M2]] });
    const area = new Float64Array(m.index.length / 3).fill(1);
    const rows = compareObservers([
      { label: 'A', state: a.state, planes: [], faces: null, upper: labels(a.state), measures: {} },
      { label: 'B', state: b.state, planes: [], faces: null, upper: labels(b.state), measures: {} },
    ], { gate: 1, faceArea: area });
    const iou = rows.find((x) => x.itemType === 'region' && x.itemKey === 'back' && x.metric === 'iou');
    expect(iou).toBeDefined();
    // B's back is A's and a quarter of the dorsal face more: their overlap below 1
    expect(iou!.value).toBeGreaterThan(0);
    expect(iou!.value).toBeLessThan(1);
  });

  it('the project file keeps the ridge and the back; a file from before has neither, and all is as it was', () => {
    const s = t9();
    const back = parseProjectFile(JSON.parse(JSON.stringify(serializeProject(s.state, 'test'))));
    expect(back.curves.some((c) => c.attributes.type === 'back_ridge')).toBe(true);
    expect(back.regions.find((r) => r.type === 'back')).toMatchObject({ auto: true });
    const before = t9({ ridges: [] });
    const old = parseProjectFile(JSON.parse(JSON.stringify(serializeProject(before.state, 'test'))));
    expect(old.regions.some((r) => r.type === 'back')).toBe(false);
    expect(areaByType(old, regionsOf(old)).dorsal).toBeCloseTo(T9_AREAS.dorsal + T9_AREAS.back, 3);
  });
});

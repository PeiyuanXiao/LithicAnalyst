import { describe, expect, it } from 'vitest';
import { morphDimensions } from '../src/compute/flake';
import { signedVolume } from '../src/compute/meshGeometry';
import { flakeFacePieces, type Partition } from '../src/compute/regions';
import { retouchSections, type RetouchPiece } from '../src/compute/retouchAngle';
import { assignBands, autoRetouchCurves, bandPiecesSteps, mergePieces, reachesEdge, retouchSideSteps } from '../src/compute/retouchBand';
import { FACE_DORSAL, FACE_NONE, FACE_PLATFORM, FACE_VENTRAL, retouchIndices, segmentFrame, type RetouchCurve } from '../src/compute/retouchIndex';
import { runSync } from '../src/compute/steps';
import { addCurve, addCurveOfType, addRegion, deleteCurve, deleteRegion, otherRetouchSide, setCurveAttribute, setCurveShape, setRegionRetouchLayer, setRegionType, withRetouchCurvesKept } from '../src/core/actions';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import { defaultRetouchSettings, type ProjectState, type SpecimenInfo, type Vec3 } from '../src/core/types';
import { onT1 } from './t1Surface';

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

const L: Vec3 = [-15, 0, 0], R: Vec3 = [15, 0, 0], FL: Vec3 = [-15, 60, 0], FR: Vec3 = [15, 60, 0];
const EDGE = through([L, FL, FR, R], false);
const OUTLINE: Vec3[] = [L, R, [15, -2, 10], [-15, -2, 10]];
const across = (y: number): Vec3[] => through([[-15, y, 0], [15, y, 0]], false);

const curve = (type: string, points: Vec3[], closed = false, retouchSide?: 'larger' | 'off') => ({ id: `${type}${points.length}`, points, closed, attributes: { type }, ...(retouchSide ? { retouchSide } : {}) });

describe('a retouch curve reaching the edge', () => {
  const edge = curve('edge', EDGE);

  it('both ends on the edge, or within reach of it', () => {
    expect(reachesEdge(curve('retouch', across(55)), [edge])).toBe(true);
    expect(reachesEdge(curve('retouch', through([[-13, 55, 0], [13, 55, 0]], false)), [edge])).toBe(true);
  });

  it('one end or none: no', () => {
    expect(reachesEdge(curve('retouch', through([[-15, 55, 0], [0, 55, 0]], false)), [edge])).toBe(false);
    expect(reachesEdge(curve('retouch', through([[-5, 55, 0], [5, 55, 0]], false)), [edge])).toBe(false);
  });

  it('a closed curve, another type of curve, or no edge: no', () => {
    const ring = through([[-15, 55, 0], [15, 55, 0], [15, 60, 0], [-15, 60, 0]], true);
    expect(reachesEdge(curve('retouch', ring, true), [edge])).toBe(false);
    expect(reachesEdge(curve('scar_boundary', across(55)), [edge])).toBe(false);
    expect(reachesEdge(curve('retouch', across(55)), [curve('scar_boundary', EDGE)])).toBe(false);
  });

  it('against a closed edge as well', () => {
    expect(reachesEdge(curve('retouch', across(55)), [curve('edge', through([L, FL, FR, R], true), true)])).toBe(true);
  });

  it('those the user has done without have none', () => {
    const on = curve('retouch', across(55)), off = curve('retouch', across(50), false, 'off'), larger = curve('retouch', across(45), false, 'larger');
    expect(autoRetouchCurves([edge, on, off, larger]).map((c) => c.id)).toEqual([on.id, larger.id]);
  });
});

describe('which side of it, on the flake T1', () => {
  const t = onT1();
  const { positions: pos, index: idx } = t.m;
  const outline = t.chain(OUTLINE, true);
  const edge = t.chain([L, FL, FR, R], false);
  const boundary = [...outline, ...edge];
  const side = (chain: number[], which: 'smaller' | 'larger') => runSync(retouchSideSteps(pos, idx, t.edges, boundary, chain, which));

  it('the smaller by itself: the stretch between it and the edge', () => {
    const s = side(t.chain(across(55), false), 'smaller')!;
    // 30 wide, 5 from the edge
    expect(s.cut.areas[s.piece]).toBeCloseTo(150, 6);
    expect(s.cut.region[t.faceAt([0, 57.5, 0])]).toBe(s.piece);
  });

  it('the larger when asked: all the rest of that face', () => {
    const s = side(t.chain(across(55), false), 'larger')!;
    expect(s.cut.areas[s.piece]).toBeCloseTo(1800 - 150, 6);
    expect(s.cut.region[t.faceAt([0, 30, 0])]).toBe(s.piece);
    // the other face is no side of it
    expect(s.cut.region[t.faceAt([0, 30, 5.2])]).not.toBe(s.piece);
  });

  it('the smaller whichever way round the band is largest: past the middle it is the far side', () => {
    const s = side(t.chain(across(20), false), 'smaller')!;
    expect(s.cut.areas[s.piece]).toBeCloseTo(30 * 20, 6);
    expect(s.cut.region[t.faceAt([0, 10, 0])]).toBe(s.piece);
  });

  it('on the dorsal face the same, down the sides to the edge', () => {
    const y = 55, z = (10 * (60 - y)) / 62;
    const s = side(t.chain([[-15, y, 0], [-15, y, z], [15, y, z], [15, y, 0]], false), 'smaller')!;
    // the slope from there to the far end, and the two small triangles of the sides; as near as the mesh's vertices go
    const area = s.cut.areas[s.piece];
    expect(area).toBeGreaterThan(30 * Math.hypot(5, z) - 15);
    expect(area).toBeLessThan(30 * Math.hypot(5, z) + 2 * 0.5 * 5 * z + 15);
    expect(s.cut.region[t.faceAt([0, 59, 1 / 6.2])]).toBe(s.piece);
    expect(s.cut.region[t.faceAt([0, 57.5, 0])]).not.toBe(s.piece);
  });

  it('parting nothing, it has no side', () => {
    expect(side(t.chain(through([[-5, 55, 0], [5, 55, 0]], false), false), 'smaller')).toBeNull();
  });

  it('holds all the pieces of the lower layer on that side, whatever else crosses it', () => {
    const line = t.chain(across(55), false);
    // a scar's outline from the curve to the edge
    const lower = t.pieces([...boundary, ...line, ...t.chain([[0, 55, 0], [0, 60, 0]], false)]);
    const s = side(line, 'smaller')!;
    const pieces = runSync(bandPiecesSteps(lower, s));
    expect(pieces).toHaveLength(2);
    expect(pieces.reduce((sum, p) => sum + lower.areas[p], 0)).toBeCloseTo(150, 6);
    for (const p of [[-7, 57, 0], [7, 57, 0]] as Vec3[]) expect(pieces).toContain(lower.region[t.faceAt(p)]);
  });
});

describe('bands and pieces', () => {
  it('each piece goes to the smallest band it lies in, so a band inside another keeps its own', () => {
    const groups = assignBands([{ regionId: 'outer', pieces: [1, 2, 3], area: 300 }, { regionId: 'inner', pieces: [1], area: 100 }], new Set());
    expect(groups.get('inner')).toEqual([1]);
    expect(groups.get('outer')).toEqual([2, 3]);
  });

  it('a piece a region of its own holds stays that region\'s; a band left with nothing is not there', () => {
    const groups = assignBands([{ regionId: 'a', pieces: [1, 2], area: 100 }, { regionId: 'b', pieces: [5], area: 50 }], new Set([2, 5]));
    expect(groups.get('a')).toEqual([1]);
    expect(groups.has('b')).toBe(false);
  });

  const part = (): Partition => ({ region: Uint32Array.from([0, 1, 2, 1, 3]), count: 4, areas: Float64Array.from([1, 2, 3, 4]) });

  it('pieces made one: their triangles and their area together, the others numbered on', () => {
    const { partition, map } = mergePieces(part(), [[0, 2]]);
    expect(partition.count).toBe(3);
    expect([...partition.areas]).toEqual([4, 2, 4]);
    expect([...partition.region]).toEqual([0, 1, 0, 1, 2]);
    expect([...map]).toEqual([0, 1, 0, 2]);
  });

  it('nothing to merge: the same partition', () => {
    const p = part();
    const { partition, map } = mergePieces(p, [[2], []]);
    expect(partition).toBe(p);
    expect([...map]).toEqual([0, 1, 2, 3]);
  });
});

describe('the retouch of a band a scar\'s outline crosses', () => {
  const t = onT1();
  const { positions: pos, index: idx } = t.m;
  const volume = Math.abs(signedVolume(pos, idx));
  const outline = t.chain(OUTLINE, true);
  const edge = t.chain([L, FL, FR, R], false);
  const boundary = [...outline, ...edge];
  const line = t.chain(across(55), false);
  const lowerRaw = t.pieces([...boundary, ...line, ...t.chain([[0, 55, 0], [0, 60, 0]], false)]);
  const upper = t.pieces(boundary);
  const faceOf = new Uint8Array(upper.region.length);
  const ventral = upper.region[t.faceAt([0, 40, 0])], platform = upper.region[t.faceAt([0, -1, 5])];
  const faces = flakeFacePieces(upper, platform, ventral);
  for (let f = 0; f < faceOf.length; f++) {
    const c = upper.region[f];
    faceOf[f] = c === ventral ? FACE_VENTRAL : c === faces.dorsal ? FACE_DORSAL : c === platform ? FACE_PLATFORM : FACE_NONE;
  }
  const perimeter = (lower: Partition, pieces: Map<number, RetouchPiece>) => {
    const sec = retouchSections({ positions: pos, index: idx, points: EDGE, closed: false, unit: 'mm', meanEdge: t.meanEdge, pieceOfFace: lower.region, pieces })!;
    const curves: RetouchCurve[] = [{ curveId: 'C1', edge: true, closed: false, length: sec.length, stations: sec.result.stations, sections: sec.sections }];
    const frame = segmentFrame({ positions: pos, index: idx, faceOf, settings: defaultRetouchSettings(), matrix: null, morph: morphDimensions(pos), specimenFrame: null });
    return retouchIndices({ positions: pos, index: idx, faceOf, pieceOfFace: lower.region, pieces, curves, unit: 'mm', meanEdge: t.meanEdge, volume, fitLength: null, frame }).indices.retouch_perimeter!;
  };

  it('counts all of it once it is one piece; by one of its pieces only, half', () => {
    const s = runSync(retouchSideSteps(pos, idx, t.edges, boundary, line, 'smaller'))!;
    const pieces = runSync(bandPiecesSteps(lowerRaw, s));
    const { partition, map } = mergePieces(lowerRaw, [pieces]);
    expect(partition.areas[map[pieces[0]]]).toBeCloseTo(150, 6);
    const whole = perimeter(partition, new Map([[map[pieces[0]], { region: 'R1', layer: 1 }]]));
    // 5 + 30 + 5 of 150, as on an edge with nothing crossing the band
    expect(whole).toBeCloseTo(0.2568, 2);
    const onePiece = perimeter(lowerRaw, new Map([[pieces[0], { region: 'R1', layer: 1 }]]));
    expect(onePiece).toBeLessThan(0.17);
  });
});

const shape = (points: Vec3[], closed = false) => {
  const anchorIndex = closed ? [0, Math.floor(points.length / 3), Math.floor((2 * points.length) / 3)] : [0, points.length - 1];
  return { anchors: anchorIndex.map((i) => points[i]), points, anchorIndex, closed };
};
const storeOf = (type: SpecimenInfo['type'] = 'flake') => {
  const st = emptyProject();
  st.specimen = { ...st.specimen, type, unit: 'mm' };
  return new ProjectStore(st);
};
const bandsOf = (s: ProjectStore) => s.state.regions.filter((r) => r.curveId);
const withEdge = () => {
  const s = storeOf();
  addCurveOfType(s, shape(EDGE), 'edge');
  return s;
};

describe('a region that follows its retouch curve', () => {
  it('comes with the curve, in its step: retouch, layer 1, following it', () => {
    const s = withEdge();
    const c = addCurveOfType(s, shape(across(55)), 'retouch');
    expect(bandsOf(s)).toHaveLength(1);
    expect(bandsOf(s)[0]).toMatchObject({ type: 'retouch', retouchLayer: 1, auto: true, curveId: c.id, scarId: null });
    expect(s.state.scars).toEqual([]);
    s.history.undo();
    expect(s.state.curves).toHaveLength(1);
    expect(bandsOf(s)).toEqual([]);
    s.history.redo();
    expect(bandsOf(s)).toHaveLength(1);
  });

  it('comes when the curve is given its type', () => {
    const s = withEdge();
    const c = addCurve(s, shape(across(55)));
    expect(bandsOf(s)).toEqual([]);
    setCurveAttribute(s, c.id, 'type', 'retouch');
    expect(bandsOf(s)).toHaveLength(1);
    setCurveAttribute(s, c.id, 'type', 'scar_boundary');
    expect(bandsOf(s)).toEqual([]);
  });

  it('comes when the edge does, drawn after the curve', () => {
    const s = storeOf();
    addCurveOfType(s, shape(across(55)), 'retouch');
    expect(bandsOf(s)).toEqual([]);
    const e = addCurveOfType(s, shape(EDGE), 'edge');
    expect(bandsOf(s)).toHaveLength(1);
    deleteCurve(s, e.id);
    expect(bandsOf(s)).toEqual([]);
  });

  it('goes with the curve, and when its end is moved off the edge', () => {
    const s = withEdge();
    const c = addCurveOfType(s, shape(across(55)), 'retouch');
    setCurveShape(s, c.id, shape(through([[-15, 55, 0], [0, 55, 0]], false)));
    expect(bandsOf(s)).toEqual([]);
    s.history.undo();
    expect(bandsOf(s)).toHaveLength(1);
    deleteCurve(s, c.id);
    expect(bandsOf(s)).toEqual([]);
    s.history.undo();
    expect(bandsOf(s)).toHaveLength(1);
  });

  it('none for a closed curve, one not reaching the edge, or on another type of specimen', () => {
    const s = withEdge();
    addCurveOfType(s, shape(through([[-5, 50, 0], [5, 50, 0], [5, 55, 0], [-5, 55, 0]], true), true), 'retouch');
    addCurveOfType(s, shape(through([[-5, 45, 0], [5, 45, 0]], false)), 'retouch');
    expect(bandsOf(s)).toEqual([]);
    const core = storeOf('core');
    addCurveOfType(core, shape(EDGE), 'edge');
    addCurveOfType(core, shape(across(55)), 'retouch');
    expect(bandsOf(core)).toEqual([]);
  });

  it('keeps its layer, its label and its id as the curve moves; each curve has its own', () => {
    const s = withEdge();
    const a = addCurveOfType(s, shape(across(55)), 'retouch');
    addCurveOfType(s, shape(across(50)), 'retouch');
    expect(bandsOf(s).map((r) => r.label)).toEqual(['R1', 'R2']);
    const r = bandsOf(s)[0];
    setRegionRetouchLayer(s, r.id, 2);
    setCurveShape(s, a.id, shape(across(54)));
    expect(s.region(r.id)).toMatchObject({ retouchLayer: 2, label: 'R1', auto: true });
  });

  it('goes to the other side and back, the curve saying which', () => {
    const s = withEdge();
    const c = addCurveOfType(s, shape(across(55)), 'retouch');
    const r = bandsOf(s)[0];
    otherRetouchSide(s, r.id);
    expect(s.curve(c.id)!.retouchSide).toBe('larger');
    expect(s.region(r.id)!.auto).toBe(true);
    otherRetouchSide(s, r.id);
    expect(s.curve(c.id)!.retouchSide).toBeUndefined();
    s.history.undo();
    expect(s.curve(c.id)!.retouchSide).toBe('larger');
  });

  it('given another type by hand it is the user\'s, and does not come back', () => {
    const s = withEdge();
    const c = addCurveOfType(s, shape(across(55)), 'retouch');
    const r = bandsOf(s)[0];
    setRegionType(s, r.id, 'cortex', null, [0, 57, 0]);
    expect(s.region(r.id)).toMatchObject({ type: 'cortex', seed: [0, 57, 0] });
    expect(s.region(r.id)!.auto).toBeUndefined();
    expect(s.region(r.id)!.curveId).toBeUndefined();
    expect(s.curve(c.id)!.retouchSide).toBe('off');
    // another curve changes: nothing new
    setCurveShape(s, c.id, shape(across(54)));
    expect(bandsOf(s)).toEqual([]);
    expect(s.state.regions).toHaveLength(1);
    // undone at once
    s.history.undo();
    s.history.undo();
    expect(bandsOf(s)).toHaveLength(1);
    expect(s.curve(c.id)!.retouchSide).toBeUndefined();
  });

  it('deleted it stays so, until the curve is made a retouch curve anew', () => {
    const s = withEdge();
    const c = addCurveOfType(s, shape(across(55)), 'retouch');
    deleteRegion(s, bandsOf(s)[0].id);
    expect(s.curve(c.id)!.retouchSide).toBe('off');
    addCurveOfType(s, shape(through([[-5, 20, 0], [5, 20, 0]], false)), 'scar_boundary');
    expect(bandsOf(s)).toEqual([]);
    s.history.undo();
    s.history.undo();
    expect(bandsOf(s)).toHaveLength(1);
    s.history.redo();
    expect(bandsOf(s)).toEqual([]);
    setCurveAttribute(s, c.id, 'type', 'scar_boundary');
    setCurveAttribute(s, c.id, 'type', 'retouch');
    expect(s.curve(c.id)!.retouchSide).toBeUndefined();
    expect(bandsOf(s)).toHaveLength(1);
  });

  it('a retouch region by hand on a closed curve\'s band goes on as ever', () => {
    const s = withEdge();
    const r = addRegion(s, [0, 57, 0], 'scar', null);
    setRegionType(s, r.id, 'retouch', null);
    expect(s.region(r.id)).toMatchObject({ type: 'retouch', retouchLayer: 1 });
    expect(s.region(r.id)!.curveId).toBeUndefined();
  });

  it('is kept with its curve in the file', () => {
    const s = withEdge();
    const c = addCurveOfType(s, shape(across(55)), 'retouch');
    otherRetouchSide(s, bandsOf(s)[0].id);
    const again = parseProjectFile(JSON.parse(JSON.stringify(serializeProject(s.state as ProjectState, 'x'))));
    expect(again.curves.find((x) => x.id === c.id)!.retouchSide).toBe('larger');
    expect(again.regions[0]).toMatchObject({ auto: true, curveId: c.id, type: 'retouch', retouchLayer: 1 });
    // only what it knows
    const file = JSON.parse(JSON.stringify(serializeProject(s.state as ProjectState, 'x')));
    file.annotations.curves[1].retouchSide = 'nonsense';
    file.annotations.regions[0].auto = false;
    const odd = parseProjectFile(file);
    expect(odd.curves[1].retouchSide).toBeUndefined();
    expect(odd.regions[0].curveId).toBeUndefined();
  });

  it('a file from before: its curves and its own regions as they are, and no new ones', () => {
    const s = withEdge();
    const c = addCurve(s, { ...shape(across(55)), attributes: { type: 'retouch' } });
    addRegion(s, [0, 57, 0], 'retouch', null);
    const file = parseProjectFile(JSON.parse(JSON.stringify(serializeProject(s.state as ProjectState, 'x'))));
    expect(file.curves.find((x) => x.id === c.id)!.retouchSide).toBeUndefined();
    const opened = withRetouchCurvesKept(file);
    expect(opened.curves.find((x) => x.id === c.id)!.retouchSide).toBe('off');
    expect(opened.regions).toHaveLength(1);
    // one saved by this version keeps following
    const now = withEdge();
    const d = addCurveOfType(now, shape(across(55)), 'retouch');
    const kept = withRetouchCurvesKept(parseProjectFile(JSON.parse(JSON.stringify(serializeProject(now.state as ProjectState, 'x')))));
    expect(kept.curves.find((x) => x.id === d.id)!.retouchSide).toBeUndefined();
    expect(kept.regions.filter((r) => r.curveId)).toHaveLength(1);
  });
});

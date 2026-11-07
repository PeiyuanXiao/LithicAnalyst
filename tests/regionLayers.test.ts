import { describe, expect, it } from 'vitest';
import { buildEdges, type EdgeTable } from '../src/compute/meshGeometry';
import { flakeFacePieces, overPiecesSteps, polylineEdges, regionsSteps, resolveRegions, type Partition } from '../src/compute/regions';
import { runSync } from '../src/compute/steps';
import { addCurve, addRegion, addScarVector, deleteCurve, deleteTechnicalAxis, setCurveAttribute, setCurveEdgeAngle, setRegionScar, setRegionType, setSpecimenType, setTechnicalAxis } from '../src/core/actions';
import { customValue, isBoundaryCurve, isUpperRegion, keyedOptions, measuresEdgeAngle, numberKeyField, REGION_FIELDS } from '../src/core/fields';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import type { Region, Vec3 } from '../src/core/types';
import { edgeAnglesCsv, regionsCsv } from '../src/io/csv';
import { flakeT1, type Mesh } from './meshes';

const line = (a: Vec3, b: Vec3, n = 80): Vec3[] => Array.from({ length: n }, (_, k): Vec3 => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n]);

function barrierOf(m: Mesh, edges: EdgeTable, corners: Vec3[], closed: boolean): number[] {
  const vertexAt = (p: Vec3) => {
    let best = 0, d = Infinity;
    for (let v = 0; v < m.positions.length / 3; v++) {
      const x = (m.positions[3 * v] - p[0]) ** 2 + (m.positions[3 * v + 1] - p[1]) ** 2 + (m.positions[3 * v + 2] - p[2]) ** 2;
      if (x < d) {
        d = x;
        best = v;
      }
    }
    return best;
  };
  const pts: Vec3[] = [];
  const n = corners.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) pts.push(...line(corners[i], corners[(i + 1) % n]));
  if (!closed) pts.push(corners[n - 1]);
  return polylineEdges(pts, closed, vertexAt, edges, () => null);
}

/** T1 with its outline, its edge along the ventral face, and a rectangle on the dorsal face. */
function t1Layers() {
  const m = flakeT1();
  const edges = buildEdges(m.index, m.positions.length / 3);
  const outline = barrierOf(m, edges, [[-15, 0, 0], [15, 0, 0], [15, -2, 10], [-15, -2, 10]], true);
  const edge = barrierOf(m, edges, [[-15, 0, 0], [-15, 60, 0], [15, 60, 0], [15, 0, 0]], false);
  const dorsal = (k: number, x: number): Vec3 => [x, 60 - (62 * k) / 63, (10 * k) / 63];
  const scar = barrierOf(m, edges, [dorsal(20, -5), dorsal(20, 5), dorsal(40, 5), dorsal(40, -5)], true);
  const lower = runSync(regionsSteps(m.positions, m.index, edges, [...outline, ...edge, ...scar]));
  const upper = runSync(regionsSteps(m.positions, m.index, edges, [...outline, ...edge]));
  const over = runSync(overPiecesSteps(lower, upper));
  const faceAt = (p: Vec3) => {
    let best = 0, d = Infinity;
    for (let t = 0; t < m.index.length / 3; t++) {
      const [a, b, c] = [3 * m.index[3 * t], 3 * m.index[3 * t + 1], 3 * m.index[3 * t + 2]];
      const x = ((m.positions[a] + m.positions[b] + m.positions[c]) / 3 - p[0]) ** 2 + ((m.positions[a + 1] + m.positions[b + 1] + m.positions[c + 1]) / 3 - p[1]) ** 2 + ((m.positions[a + 2] + m.positions[b + 2] + m.positions[c + 2]) / 3 - p[2]) ** 2;
      if (x < d) {
        d = x;
        best = t;
      }
    }
    return best;
  };
  return { m, lower, upper, over, faceAt, dorsal };
}

const region = (id: string, type: string): Region => ({ id, label: id, seed: [0, 0, 0], type, scarId: null, createdAt: '', modifiedAt: '' });

describe('two layers of regions', () => {
  const { m, lower, upper, over, faceAt, dorsal } = t1Layers();
  const piece = (p: Partition, at: Vec3) => p.region[faceAt(at)];

  it('a lower piece lies wholly in one upper piece', () => {
    expect(upper.count).toBe(3);
    expect(lower.count).toBe(4);
    for (let t = 0; t < m.index.length / 3; t++) expect(over[lower.region[t]]).toBe(upper.region[t]);
  });

  it('the dorsal face keeps its whole area; the scar on it is a region of its own, and says where it lies', () => {
    const regions = [region('V', 'ventral'), region('D', 'dorsal'), region('P', 'platform'), region('S', 'scar'), region('C', 'retouch')];
    const onScar = dorsal(30, 0), besides = dorsal(5, 10);
    const component = [-1, -1, -1, piece(lower, onScar), piece(lower, besides)];
    const up = [piece(upper, [0, 30, 0]), piece(upper, onScar), piece(upper, [0, -1, 5]), -1, -1];
    const { results, totals } = resolveRegions(regions, component, lower, 5000, { component: up, partition: upper, over });
    const byId = new Map(results.map((r) => [r.id, r]));
    const faceArea = Math.hypot(62, 10) * 30;
    const scarArea = 10 * ((20 / 63) * Math.hypot(62, 10));
    // the two ends of the prism go with the dorsal face: the edge runs along the ventral face
    expect(byId.get('D')!.area!).toBeCloseTo(faceArea + 2 * 300, 0);
    expect(byId.get('V')!.area!).toBeCloseTo(60 * 30, 0);
    expect(byId.get('P')!.area!).toBeCloseTo(30 * Math.sqrt(104), 0);
    expect(byId.get('S')!.area!).toBeCloseTo(scarArea, 0);
    expect(byId.get('S')!.parent).toBe('D');
    expect(byId.get('C')!.parent).toBe('D');
    expect(byId.get('D')!.parent).toBeNull();
    // a part and what lies in it are no conflict, and each counts in its own layer
    expect(results.every((r) => !r.conflict)).toBe(true);
    expect(totals.dorsal).toBeCloseTo(faceArea + 2 * 300, 0);
    expect(totals.scar).toBeCloseTo(scarArea, 0);
    expect(totals.platform).toBeCloseTo(30 * Math.sqrt(104), 0);
  });

  it('two regions in one piece of a layer are a conflict', () => {
    const regions = [region('A', 'dorsal'), region('B', 'dorsal')];
    const u = piece(upper, dorsal(30, 0));
    const { results } = resolveRegions(regions, [-1, -1], lower, 5000, { component: [u, u], partition: upper, over });
    expect(results.map((r) => r.conflict)).toEqual([true, true]);
  });

  it('a flake\'s faces: under the axis, and the largest other; none when the edge does not close', () => {
    const platform = piece(upper, [0, -1, 5]);
    const ventral = piece(upper, [0, 30, 0]);
    expect(flakeFacePieces(upper, platform, ventral)).toEqual({ ventral, dorsal: piece(upper, dorsal(30, 0)) });
    expect(flakeFacePieces(upper, platform, -1)).toEqual({ ventral: -1, dorsal: -1 });
    expect(flakeFacePieces(upper, platform, platform)).toEqual({ ventral: -1, dorsal: -1 });
    // only the platform and the rest: nothing to tell the two faces apart
    const two: Partition = { region: new Uint32Array(0), count: 2, areas: Float64Array.of(300, 4200) };
    expect(flakeFacePieces(two, 0, 1)).toEqual({ ventral: -1, dorsal: -1 });
    // a crumb is not the other face
    const crumb: Partition = { region: new Uint32Array(0), count: 3, areas: Float64Array.of(300, 4200, 1) };
    expect(flakeFacePieces(crumb, 0, 1)).toEqual({ ventral: -1, dorsal: -1 });
    // a point platform: the edge alone parts the two
    const none: Partition = { region: new Uint32Array(0), count: 2, areas: Float64Array.of(2000, 2200) };
    expect(flakeFacePieces(none, -1, 0)).toEqual({ ventral: 0, dorsal: 1 });
  });

  it('regions.csv ends with the upper region; the user\'s own type is written as it is', () => {
    const s = new ProjectStore(emptyProject());
    const results = [
      { id: 'a', label: 'R1', type: 'dorsal', scarId: null, area: 100, conflict: false, parent: null, retouchLayer: null },
      { id: 'b', label: 'R2', type: 'retouch, fine', scarId: null, area: 10, conflict: false, parent: 'a', retouchLayer: null },
    ];
    const rows = regionsCsv(s.state, results, { excelBom: false }).trim().split('\n');
    expect(rows[0]).toBe('specimen_id,region_id,type,scar_id,area,unit,parent_region,retouch_layer');
    expect(rows[1]).toBe(',R1,dorsal,,100,mm,,');
    expect(rows[2]).toBe(',R2,"retouch, fine",,10,mm,R1,');
  });
});

describe('region types', () => {
  it('the layers and the boundary curves', () => {
    for (const t of ['flaking_surface', 'platform', 'ventral', 'dorsal']) expect(isUpperRegion(t)).toBe(true);
    for (const t of ['scar', 'cortex', 'joint', 'damage', 'retouch']) expect(isUpperRegion(t)).toBe(false);
    expect(isBoundaryCurve('core_edge', 'core')).toBe(true);
    expect(isBoundaryCurve('edge', 'core')).toBe(false);
    expect(isBoundaryCurve('scar_boundary', 'core')).toBe(false);
    expect(isBoundaryCurve('edge', 'flake')).toBe(true);
    expect(isBoundaryCurve('platform_outline', 'flake')).toBe(true);
    expect(isBoundaryCurve('core_edge', 'flake')).toBe(false);
  });
  it('the user\'s own text is always the last choice', () => {
    const f = numberKeyField(REGION_FIELDS)!;
    const codes = (type: 'core' | 'flake') => keyedOptions(f, type).map((o) => (o === 'custom' ? o : o.value));
    expect(codes('core')).toEqual(['scar', 'cortex', 'joint', 'damage', 'flaking_surface', 'platform', 'retouch', 'custom']);
    expect(codes('flake')).toEqual(['scar', 'cortex', 'joint', 'damage', 'platform', 'ventral', 'dorsal', 'retouch', 'custom']);
    expect(customValue(f, ' Dorsal face ', 'flake')).toBe('dorsal');
    expect(customValue(f, 'Dorsal face', 'core')).toBe('Dorsal face');
    expect(customValue(f, ' 石皮 ', 'core')).toBe('cortex');
  });
  it('a file keeps the user\'s own type, and a region needs one', () => {
    const s = new ProjectStore(emptyProject());
    addRegion(s, [1, 2, 3], 'retouch', null);
    const file = JSON.parse(JSON.stringify(serializeProject(s.state, '0.1.0')));
    expect(parseProjectFile(file).regions[0].type).toBe('retouch');
    file.annotations.regions[0].type = ' ';
    expect(() => parseProjectFile(file)).toThrow(/Region 1 needs a type/);
  });
});

describe('the regions that follow other annotations', () => {
  const n: Vec3 = [0, 0, -1];
  const axis = { start: [0, 0, 0] as Vec3, end: [0, 40, 0] as Vec3, startNormal: n, endNormal: n, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], failure: null };
  const shape = () => {
    const pts: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
    return { anchors: pts, points: pts, anchorIndex: [0, 1, 2, 3], closed: true };
  };
  const autos = (s: ProjectStore) => s.state.regions.filter((r) => r.auto).map((r) => r.type).sort();

  it('the faces come with an edge and a technical frame, in the step that completes them', () => {
    const s = new ProjectStore(emptyProject());
    setSpecimenType(s, 'flake');
    const edge = addCurve(s, shape());
    setCurveAttribute(s, edge.id, 'type', 'edge');
    expect(autos(s)).toEqual([]);
    setTechnicalAxis(s, axis);
    expect(autos(s)).toEqual(['dorsal', 'ventral']);
    s.history.undo();
    expect(autos(s)).toEqual([]);
    s.history.redo();
    const outline = addCurve(s, shape());
    setCurveAttribute(s, outline.id, 'type', 'platform_outline');
    expect(autos(s)).toEqual(['dorsal', 'platform', 'ventral']);
    deleteCurve(s, edge.id);
    expect(autos(s)).toEqual(['platform']);
    s.history.undo();
    expect(autos(s)).toEqual(['dorsal', 'platform', 'ventral']);
    deleteTechnicalAxis(s);
    expect(autos(s)).toEqual(['platform']);
  });
  it('a type given by hand makes one the user\'s', () => {
    const s = new ProjectStore(emptyProject());
    setSpecimenType(s, 'flake');
    const edge = addCurve(s, shape());
    setCurveAttribute(s, edge.id, 'type', 'edge');
    setTechnicalAxis(s, axis);
    const v = s.state.regions.find((r) => r.type === 'ventral')!;
    setRegionType(s, v.id, 'retouch', null, [3, 3, 3]);
    expect(s.state.regions.find((r) => r.id === v.id)).toMatchObject({ type: 'retouch', seed: [3, 3, 3] });
    expect(s.state.regions.find((r) => r.id === v.id)!.auto).toBeUndefined();
  });
  it('a core has none', () => {
    const s = new ProjectStore(emptyProject());
    const edge = addCurve(s, shape());
    setCurveAttribute(s, edge.id, 'type', 'core_edge');
    expect(s.state.regions).toEqual([]);
  });
  it('a core does not export those of the flake, which wait for it', () => {
    const s = new ProjectStore(emptyProject());
    setSpecimenType(s, 'flake');
    const edge = addCurve(s, shape());
    setCurveAttribute(s, edge.id, 'type', 'edge');
    setTechnicalAxis(s, axis);
    const results = s.state.regions.map((r) => ({ id: r.id, label: r.label, type: r.type, scarId: null, area: 1, conflict: false, parent: null, retouchLayer: null }));
    const rows = () => regionsCsv(s.state, results, { excelBom: false }).trim().split('\n').length - 1;
    expect(rows()).toBe(2);
    setSpecimenType(s, 'core');
    expect(rows()).toBe(0);
    expect(autos(s)).toEqual(['dorsal', 'ventral']);
    setSpecimenType(s, 'flake');
    expect(rows()).toBe(2);
  });
});

describe('the scar of a region', () => {
  const n: Vec3 = [0, 0, 1];
  it('two pieces of one scar can be one scar; a scar made only for the region goes', () => {
    const s = new ProjectStore(emptyProject());
    const a = addScarVector(s, { start: [0, 0, 0], end: [1, 0, 0], startNormal: n, endNormal: n });
    const first = addRegion(s, [0, 0, 0], 'scar', a.id);
    const second = addRegion(s, [5, 5, 5], 'scar', null);
    const made = s.region(second.id)!.scarId!;
    expect(s.state.scars.length).toBe(2);
    setRegionScar(s, second.id, a.id);
    expect(s.state.regions.map((r) => r.scarId)).toEqual([a.id, a.id]);
    expect(s.scar(made)).toBeUndefined();
    s.history.undo();
    expect(s.region(second.id)!.scarId).toBe(made);
    expect(s.scar(made)).toBeDefined();
    expect(s.region(first.id)!.scarId).toBe(a.id);
  });
});

describe('measuring edge angles', () => {
  const pts: Vec3[] = [[0, 0, 0], [1, 0, 0]];
  const shape = { anchors: pts, points: pts, anchorIndex: [0, 1], closed: false };
  it('by default a flake\'s edge; not on a core; the user decides, in one undo step; a file keeps it', () => {
    const s = new ProjectStore(emptyProject());
    const c = addCurve(s, shape);
    const on = () => measuresEdgeAngle(s.curve(c.id)!, s.state.specimen.type);
    expect(on()).toBe(false);
    setCurveAttribute(s, c.id, 'type', 'core_edge');
    expect(on()).toBe(false);
    // what a core held shows on a flake
    setSpecimenType(s, 'flake');
    expect(on()).toBe(true);
    setCurveAttribute(s, c.id, 'type', 'scar_boundary');
    expect(on()).toBe(false);
    setCurveAttribute(s, c.id, 'type', 'edge');
    expect(on()).toBe(true);
    setCurveEdgeAngle(s, c.id, false);
    expect(on()).toBe(false);
    s.history.undo();
    expect(on()).toBe(true);
    setCurveEdgeAngle(s, c.id, false);
    const again = parseProjectFile(JSON.parse(JSON.stringify(serializeProject(s.state, '0.1.0'))));
    expect(again.curves[0].edgeAngle).toBe(false);
  });
  it('edge_angles.csv: one row for each station, distance and method; empty where there is no value', () => {
    const s = new ProjectStore(emptyProject());
    const c = addCurve(s, shape);
    setCurveAttribute(s, c.id, 'type', 'core_edge');
    const rows = edgeAnglesCsv(s.state, [{ curveId: c.id, distances: [2, 5], length: 0, stations: [{ position: 0, point: [0, 0, 0], three_points: [30.5, null], two_lines: [31, null] }] }], { excelBom: false }).trim().split('\n');
    expect(rows[0]).toBe('specimen_id,curve_id,curve_type,station,position,distance,method,angle_deg,working_edge');
    expect(rows.slice(1)).toEqual([',C1,core_edge,0,0,2,three_points,30.5,', ',C1,core_edge,0,0,2,two_lines,31,', ',C1,core_edge,0,0,5,three_points,,', ',C1,core_edge,0,0,5,two_lines,,']);
  });
});

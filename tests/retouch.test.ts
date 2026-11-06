import { describe, expect, it } from 'vitest';
import { buildEdges, type EdgeTable } from '../src/compute/meshGeometry';
import { joinOpenEndsSteps, polylineEdges, regionsSteps, type Partition } from '../src/compute/regions';
import { retouchAngles, type RetouchAngleResult, type RetouchPiece, type RetouchStretch } from '../src/compute/retouchAngle';
import { runSync } from '../src/compute/steps';
import { addCurve, addRegion, setRegionRetouchLayer, setRegionType } from '../src/core/actions';
import { keyedOptions, numberKeyField, REGION_FIELDS, CURVE_FIELDS } from '../src/core/fields';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import type { Vec3 } from '../src/core/types';
import { regionsCsv, retouchAnglesCsv } from '../src/io/csv';
import { heightAt, mapped, rigid, SEGMENTS, steppedTool, type Mesh } from './meshes';

const deg = (r: number) => (r * 180) / Math.PI;

const ringPoints = (m: Mesh, first: number): Vec3[] => Array.from({ length: SEGMENTS }, (_, j) => [m.positions[3 * (first + j)], m.positions[3 * (first + j) + 1], m.positions[3 * (first + j) + 2]]);

function meanEdge(e: EdgeTable, m: Mesh): number {
  let s = 0;
  for (let i = 0; i < e.v0.length; i++) {
    const a = 3 * e.v0[i], b = 3 * e.v1[i];
    s += Math.hypot(m.positions[a] - m.positions[b], m.positions[a + 1] - m.positions[b + 1], m.positions[a + 2] - m.positions[b + 2]);
  }
  return s / e.v0.length;
}

const nearestOf = (m: Mesh) => (p: Vec3): number => {
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

/** The pieces between closed rings, and which piece holds a point (the triangle whose middle is nearest it). */
function pieces(m: Mesh, rings: readonly Vec3[][], extra: readonly number[] = []): { part: Partition; edges: EdgeTable; at: (p: Vec3) => number } {
  const edges = buildEdges(m.index, m.positions.length / 3);
  const nearest = nearestOf(m);
  const barrier = [...rings.flatMap((r) => polylineEdges(r, true, nearest, edges, () => null)), ...extra];
  const part = runSync(regionsSteps(m.positions, m.index, edges, barrier));
  const at = (p: Vec3): number => {
    let best = 0, least = Infinity;
    for (let t = 0; 3 * t < m.index.length; t++) {
      const c = [0, 1, 2].map((k) => (m.positions[3 * m.index[3 * t]! + k] + m.positions[3 * m.index[3 * t + 1]! + k] + m.positions[3 * m.index[3 * t + 2]! + k]) / 3);
      const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
      if (d < least) {
        least = d;
        best = t;
      }
    }
    return part.region[best];
  };
  return { part, edges, at };
}

const onTop = (r: number, theta = 0.7): Vec3 => [r * Math.cos(theta), r * Math.sin(theta), heightAt(r)];

/** The two tiers of the tool, each its own retouch layer. */
function twoTiers(): { m: ReturnType<typeof steppedTool>; run: (typed?: Array<[number, RetouchPiece]>, unit?: string) => RetouchAngleResult | null; at: (p: Vec3) => number; edge: Vec3[] } {
  const m = steppedTool();
  const edge = ringPoints(m, m.ringAt(30, true));
  const { part, edges, at } = pieces(m, [edge, ringPoints(m, m.ringAt(24, true)), ringPoints(m, m.ringAt(12, true))]);
  const standard: Array<[number, RetouchPiece]> = [[at(onTop(27)), { region: 'R1', layer: 1 }], [at(onTop(18)), { region: 'R2', layer: 2 }]];
  const me = meanEdge(edges, m);
  const run = (typed = standard, unit = 'mm') => retouchAngles({ positions: m.positions, index: m.index, points: edge, closed: true, unit, meanEdge: me, pieceOfFace: part.region, pieces: new Map(typed) });
  return { m, run, at, edge };
}

const layer = (s: { stretches: RetouchStretch[] }, n: number) => s.stretches.find((x) => x.layer === n);

describe('the angles of retouch layers', () => {
  const L1_FACE = 45;
  const L2_FACE = deg(Math.atan(2 / 12));
  const L2_CUMULATIVE = deg(Math.atan(8 / 18));
  const L1_LENGTH = 6 * Math.SQRT2, L2_LENGTH = L1_LENGTH + Math.hypot(12, 2);

  it('two tiers above a flat ventral face: each one\'s own slope, and from the edge', () => {
    const { run } = twoTiers();
    const r = run()!;
    expect(r.stations.length).toBeGreaterThan(180);
    for (const s of r.stations.filter((_, k) => k % 12 === 0)) {
      expect(s.point).not.toBeNull();
      const one = layer(s, 1)!, two = layer(s, 2)!;
      expect(Math.abs(one.layer_face! - L1_FACE)).toBeLessThan(1);
      expect(Math.abs(one.three_points! - L1_FACE)).toBeLessThan(1);
      expect(Math.abs(two.layer_face! - L2_FACE)).toBeLessThan(1);
      expect(Math.abs(two.three_points! - L2_CUMULATIVE)).toBeLessThan(1);
      expect(Math.abs(one.distance - L1_LENGTH)).toBeLessThan(1.2);
      expect(Math.abs(two.distance - L2_LENGTH)).toBeLessThan(1.2);
      // only on the side that is retouched
      expect(s.stretches.length).toBe(2);
    }
  });

  it('two lines: the chords at the layers\' outer ends, against the other side', () => {
    const { run } = twoTiers();
    const s = run()!.stations[40];
    // the chord across the bend at the end of the second tier: half on each slope
    const a: Vec3 = [Math.cos(Math.atan(2 / 12)), Math.sin(Math.atan(2 / 12)), 0];
    const b: Vec3 = [Math.cos(Math.atan(1 / 24)), Math.sin(Math.atan(1 / 24)), 0];
    const across = deg(Math.atan2(a[1] + b[1], a[0] + b[0]));
    expect(Math.abs(layer(s, 2)!.two_lines! - across)).toBeLessThan(1.5);
  });

  it('a layer only over part of the edge: the other stations have none', () => {
    const m = steppedTool();
    const edge = ringPoints(m, m.ringAt(30, true));
    const edges0 = buildEdges(m.index, m.positions.length / 3);
    // the second tier cut across at two places: only one side of it is retouch
    const across = (j: number): number[] => {
      const out: number[] = [];
      const ring = (r: number) => m.ringAt(r, true) + j;
      const radii: number[] = [];
      for (let r = 24; r > 12 + 1e-9; r -= 0.8) radii.push(r);
      radii.push(12);
      radii.forEach((r, i) => {
        if (i) out.push(ring(radii[i - 1]), r === 12 ? m.ringAt(12, true) + j : ring(r));
      });
      return out;
    };
    const { part, at } = pieces(m, [edge, ringPoints(m, m.ringAt(24, true)), ringPoints(m, m.ringAt(12, true))], [...across(0), ...across(SEGMENTS / 2)]);
    const typed: Array<[number, RetouchPiece]> = [[at(onTop(27)), { region: 'R1', layer: 1 }], [at(onTop(18, Math.PI / 2)), { region: 'R2', layer: 2 }]];
    const r = retouchAngles({ positions: m.positions, index: m.index, points: edge, closed: true, unit: 'mm', meanEdge: meanEdge(edges0, m), pieceOfFace: part.region, pieces: new Map(typed) })!;
    const withTwo = r.stations.filter((s) => layer(s, 2));
    expect(withTwo.length).toBeGreaterThan(80);
    expect(withTwo.length).toBeLessThan(100);
    expect(r.stations.every((s) => layer(s, 1))).toBe(true);
  });

  it('stops at the first piece that is not retouch: what lies beyond it belongs to no layer of this edge', () => {
    const { run, at } = twoTiers();
    const r = run([[at(onTop(18)), { region: 'R2', layer: 2 }]])!;
    expect(r.stations.every((s) => s.stretches.length === 0)).toBe(true);
  });

  it('two pieces of one layer in a row count as one, the region being the first', () => {
    const { run, at } = twoTiers();
    const r = run([[at(onTop(27)), { region: 'R1', layer: 1 }], [at(onTop(18)), { region: 'R2', layer: 1 }]])!;
    const s = r.stations[30];
    expect(s.stretches.length).toBe(1);
    expect(s.stretches[0].region).toBe('R1');
    expect(Math.abs(s.stretches[0].distance - L2_LENGTH)).toBeLessThan(1.2);
  });

  it('retouch on both faces: each side of the edge has its own, against the other', () => {
    const m = steppedTool();
    const edge = ringPoints(m, m.ringAt(30, true));
    const { part, edges, at } = pieces(m, [edge, ringPoints(m, m.ringAt(24, true)), ringPoints(m, m.ringAt(30 - 8 * 0.8, false))]);
    const bottom: Vec3 = [27 * Math.cos(0.7), 27 * Math.sin(0.7), 0];
    const typed: Array<[number, RetouchPiece]> = [[at(onTop(27)), { region: 'R1', layer: 1 }], [at(bottom), { region: 'R3', layer: 1 }]];
    const r = retouchAngles({ positions: m.positions, index: m.index, points: edge, closed: true, unit: 'mm', meanEdge: meanEdge(edges, m), pieceOfFace: part.region, pieces: new Map(typed) })!;
    const s = r.stations[50];
    expect(s.stretches.map((x) => x.region).sort()).toEqual(['R1', 'R3']);
    // the flat face's stretch against the slope: walking 6.4 along each
    const flat = s.stretches.find((x) => x.region === 'R3')!;
    expect(Math.abs(flat.distance - 6.4)).toBeLessThan(1.2);
    expect(Math.abs(flat.three_points! - 45)).toBeLessThan(1.5);
  });

  it('the same in any position', () => {
    const { m, edge, at } = twoTiers();
    const f = rigid([1, 2, 3], 40, [100, -50, 7]);
    const moved = mapped(m, f);
    const movedEdge = edge.map(f);
    const { part, edges, at: atMoved } = pieces(moved, [movedEdge, ringPoints(moved, m.ringAt(24, true)), ringPoints(moved, m.ringAt(12, true))]);
    void at;
    const typed: Array<[number, RetouchPiece]> = [[atMoved(f(onTop(27))), { region: 'R1', layer: 1 }], [atMoved(f(onTop(18))), { region: 'R2', layer: 2 }]];
    const r = retouchAngles({ positions: moved.positions, index: moved.index, points: movedEdge, closed: true, unit: 'mm', meanEdge: meanEdge(edges, moved), pieceOfFace: part.region, pieces: new Map(typed) })!;
    const s = r.stations[20];
    expect(Math.abs(layer(s, 1)!.layer_face! - L1_FACE)).toBeLessThan(1);
    expect(Math.abs(layer(s, 2)!.layer_face! - L2_FACE)).toBeLessThan(1);
  });

  it('nothing without a stated unit, or without a piece in a layer', () => {
    const { run } = twoTiers();
    expect(run(undefined, '')).toBeNull();
    expect(run([])).toBeNull();
  });
});

describe('curves that stop short of another', () => {
  /** A flat grid of squares, with its vertices by column and row. */
  function grid(n: number): { m: Mesh; v: (i: number, j: number) => number } {
    const pos: number[] = [];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pos.push(i, j, 0);
    const v = (i: number, j: number) => j * (n + 1) + i;
    const idx: number[] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) idx.push(v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j), v(i + 1, j + 1), v(i, j + 1));
    return { m: { positions: new Float32Array(pos), index: new Uint32Array(idx) }, v };
  }
  const walk = (a: number[]): number[] => a.slice(1).flatMap((x, i) => [a[i], x]);
  const straight = (from: number, to: number) => [from, to];

  it('are joined to it, which parts the surface; a curve further away is not', () => {
    const { m, v } = grid(10);
    const edges = buildEdges(m.index, m.positions.length / 3);
    const left = walk(Array.from({ length: 11 }, (_, j) => v(3, j)));
    const right = walk(Array.from({ length: 11 }, (_, j) => v(7, j)));
    // from the left line toward the right one, a square short of it
    const across = walk([v(3, 5), v(4, 5), v(5, 5), v(6, 5)]);
    const path = (a: number, b: number) => straight(a, b);
    const before = runSync(regionsSteps(m.positions, m.index, edges, [...left, ...right, ...across]));
    expect(before.count).toBe(3);
    const joined = runSync(joinOpenEndsSteps([left, right, across], [true, true, true], m.positions, 1.5, path));
    expect(joined[2].length).toBe(across.length + 2);
    const after = runSync(regionsSteps(m.positions, m.index, edges, joined.flat()));
    expect(after.count).toBe(4);
    // out of reach: left as it is
    const far = runSync(joinOpenEndsSteps([left, right, across], [true, true, true], m.positions, 0.5, path));
    expect(far[2]).toEqual(across);
  });

  it('a closed curve, or an end already on the other, has nothing to join', () => {
    const { m, v } = grid(6);
    const line = walk([v(1, 2), v(2, 2), v(3, 2)]);
    const branch = walk([v(2, 2), v(2, 3)]);
    const called: number[] = [];
    const path = (a: number, b: number) => {
      called.push(a);
      return [a, b];
    };
    const out = runSync(joinOpenEndsSteps([line, branch], [false, true], m.positions, 10, path));
    expect(out[0]).toEqual(line);
    // the branch's far end does reach back to the line, its near end is on it
    expect(called.every((a) => a === v(2, 3))).toBe(true);
  });
});

describe('retouch in the project', () => {
  const shape = () => {
    const pts: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0]];
    return { anchors: pts, points: pts, anchorIndex: [0, 1, 2], closed: false };
  };

  it('is offered on both kinds of specimen, with the user\'s own type still last', () => {
    const codes = (f: typeof REGION_FIELDS, type: 'core' | 'flake') => keyedOptions(numberKeyField(f)!, type).map((o) => (o === 'custom' ? o : o.value));
    expect(codes(CURVE_FIELDS, 'flake')).toEqual(['scar_boundary', 'edge', 'cortex', 'joint', 'platform_outline', 'retouch', 'custom']);
    expect(codes(CURVE_FIELDS, 'core')).toEqual(['scar_boundary', 'core_edge', 'cortex', 'joint', 'retouch', 'custom']);
    expect(codes(REGION_FIELDS, 'flake')).toEqual(['scar', 'cortex', 'joint', 'damage', 'platform', 'ventral', 'dorsal', 'retouch', 'custom']);
    expect(codes(REGION_FIELDS, 'core')).toEqual(['scar', 'cortex', 'joint', 'damage', 'flaking_surface', 'platform', 'retouch', 'custom']);
  });

  it('a retouch region starts in layer 1, keeps its layer through the file, and loses it with its type; one undo step each', () => {
    const s = new ProjectStore(emptyProject());
    addCurve(s, shape());
    const r = addRegion(s, [0, 0, 0], 'cortex', null);
    setRegionType(s, r.id, 'retouch', null);
    expect(s.region(r.id)!.retouchLayer).toBe(1);
    setRegionRetouchLayer(s, r.id, 3);
    expect(s.region(r.id)!.retouchLayer).toBe(3);
    const back = parseProjectFile(JSON.parse(JSON.stringify(serializeProject(s.state, '0.2.0'))));
    expect(back.regions[0]).toMatchObject({ type: 'retouch', retouchLayer: 3 });
    s.history.undo();
    expect(s.region(r.id)!.retouchLayer).toBe(1);
    s.history.redo();
    setRegionType(s, r.id, 'cortex', null);
    expect(s.region(r.id)!.retouchLayer).toBeUndefined();
    // only of a retouch region
    setRegionRetouchLayer(s, r.id, 2);
    expect(s.region(r.id)!.retouchLayer).toBeUndefined();
  });

  it('a file without a layer reads as layer 1; other regions have none', () => {
    const s = new ProjectStore(emptyProject());
    const r = addRegion(s, [0, 0, 0], 'cortex', null);
    setRegionType(s, r.id, 'retouch', null);
    const file = JSON.parse(JSON.stringify(serializeProject(s.state, '0.2.0')));
    delete file.annotations.regions[0].retouchLayer;
    expect(parseProjectFile(file).regions[0].retouchLayer).toBe(1);
    file.annotations.regions[0].type = 'cortex';
    file.annotations.regions[0].retouchLayer = 2;
    expect(parseProjectFile(file).regions[0].retouchLayer).toBeUndefined();
  });

  it('regions.csv ends with the layer; retouch_angles.csv has a row per station, layer and method', () => {
    const s = new ProjectStore(emptyProject());
    const c = addCurve(s, shape());
    const g = addRegion(s, [0, 0, 0], 'cortex', null);
    setRegionType(s, g.id, 'retouch', null);
    setRegionRetouchLayer(s, g.id, 2);
    const rows = regionsCsv(s.state, [{ id: g.id, label: g.label, type: 'retouch', scarId: null, area: 5, conflict: false, parent: null, retouchLayer: 2 }], { excelBom: false }).trim().split('\n');
    expect(rows[0]).toBe('specimen_id,region_id,type,scar_id,area,unit,parent_region,retouch_layer');
    expect(rows[1]).toBe(`,${g.label},retouch,,5,mm,,2`);
    const angles = retouchAnglesCsv(s.state, [{ curveId: c.id, stations: [{ position: 0, point: [0, 0, 0], stretches: [{ region: g.id, layer: 2, distance: 4.5, three_points: 30, two_lines: null, layer_face: 12.5 }] }] }], { excelBom: false }).trim().split('\n');
    expect(angles[0]).toBe('specimen_id,curve_id,station,position,retouch_region,retouch_layer,distance,method,angle_deg,working_edge');
    expect(angles.slice(1)).toEqual([`,C1,0,0,${g.label},2,4.5,three_points,30,`, `,C1,0,0,${g.label},2,4.5,two_lines,,`, `,C1,0,0,${g.label},2,4.5,layer_face,12.5,`]);
  });
});

import { describe, expect, it } from 'vitest';
import { EDGE_ANGLE_MEAN_COLUMNS, edgeAngleMeans, edgeAngles, type EdgeAngleStation } from '../src/compute/edgeAngle';
import { buildEdges } from '../src/compute/meshGeometry';
import { workingEdgeDetails } from '../src/compute/workingEdge';
import { addCurve, addWorkingEdge } from '../src/core/actions';
import { emptyProject, ProjectStore } from '../src/core/store';
import type { Vec3 } from '../src/core/types';
import { edgeAnglesCsv, workingEdgesCsv } from '../src/io/csv';
import { mapped, retouchPrism, type Mesh } from './meshes';

/** Stations with known angles (null: none at that distance), as `three_points` and `two_lines` by distance (2, 5, 10 mm). */
const station = (three_points: Array<number | null>, two_lines: Array<number | null>): Pick<EdgeAngleStation, 'three_points' | 'two_lines'> => ({ three_points, two_lines });
const STATIONS = [station([10, 20, null], [12, null, null]), station([20, null, null], [14, null, null]), station([30, 40, null], [null, null, null]), station([null, 60, null], [16, null, null])];

describe('mean edge angles', () => {
  it('all the stations: the plain mean of those with a value, the sample SD, how many', () => {
    const m = edgeAngleMeans({ stations: STATIONS });
    expect(m.three_points).toEqual([
      { mean: 20, sd: 10, n: 3 },
      { mean: 40, sd: 20, n: 3 },
      { mean: null, sd: null, n: 0 },
    ]);
    expect(m.two_lines).toEqual([
      { mean: 14, sd: 2, n: 3 },
      { mean: null, sd: null, n: 0 },
      { mean: null, sd: null, n: 0 },
    ]);
  });

  it('the stations in scope only; one value has no SD; none in scope, nothing', () => {
    const m = edgeAngleMeans({ stations: STATIONS }, [0, 2]);
    expect(m.three_points[0].mean).toBe(20);
    expect(m.three_points[0].sd).toBeCloseTo(Math.SQRT2 * 10, 12);
    expect(m.three_points[0].n).toBe(2);
    expect(m.three_points[1]).toMatchObject({ mean: 30, n: 2 });
    expect(m.two_lines[0]).toEqual({ mean: 12, sd: null, n: 1 });
    const none = edgeAngleMeans({ stations: STATIONS }, []);
    expect([...none.three_points, ...none.two_lines].every((x) => x.mean === null && x.sd === null && x.n === 0)).toBe(true);
  });

  it('the columns are named as the EPA columns of flakes.csv', () => {
    expect(EDGE_ANGLE_MEAN_COLUMNS).toEqual(['edge_angle_3pt_2mm', 'edge_angle_3pt_5mm', 'edge_angle_3pt_10mm', 'edge_angle_2ln_2mm', 'edge_angle_2ln_5mm', 'edge_angle_2ln_10mm']);
  });
});

function meanEdgeOf(m: Mesh): number {
  const e = buildEdges(m.index, m.positions.length / 3);
  let s = 0;
  for (let i = 0; i < e.v0.length; i++) {
    const a = 3 * e.v0[i], b = 3 * e.v1[i];
    s += Math.hypot(m.positions[a] - m.positions[b], m.positions[a + 1] - m.positions[b + 1], m.positions[a + 2] - m.positions[b + 2]);
  }
  return s / e.v0.length;
}

/** A table of CSV text (no quoted cells in these files) by column name. */
const table = (text: string): Array<Record<string, string>> => {
  const [head, ...rows] = text.trim().split('\n').map((l) => l.split(','));
  return rows.map((r) => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ''])));
};

describe('working_edges.csv: the means are those of edge_angles.csv grouped by curve, working edge, method and distance', () => {
  // T7 bent and widened along its length, so the angles change from station to station
  const bend = (p: Vec3): Vec3 => [p[0] * (1 + 0.012 * p[1]) + 0.002 * p[1] * p[1], p[1], p[2] * (1 + 0.006 * p[1])];
  const mesh = mapped(retouchPrism('unifacial'), bend);
  const edge = Array.from({ length: 61 }, (_, i) => bend([4, 5 + i / 2, 0]));
  const result = edgeAngles({ positions: mesh.positions, index: mesh.index, points: edge, closed: false, unit: 'mm', meanEdge: meanEdgeOf(mesh) })!;

  const check = (edges: Array<[Vec3, Vec3]>) => {
    const store = new ProjectStore(emptyProject());
    store.state.specimen.type = 'flake';
    store.state.specimen.id = 'T7';
    const c = addCurve(store, { anchors: [edge[0], edge[60]], points: edge, anchorIndex: [0, 60], closed: false, attributes: { type: 'edge' } });
    for (const [start, end] of edges) expect(addWorkingEdge(store, { curveId: c.id, start, end }).refused).toBeNull();
    const curves = [{ curveId: c.id, ...result }];
    const rows = workingEdgeDetails({ curves: [{ id: c.id, points: edge, closed: false, stations: result.stations, sharp: null }], edges: store.state.workingEdges, unit: 'mm', retouch: null, volume: null }).map((d) => d.row);
    const angles = table(edgeAnglesCsv(store.state, curves, { excelBom: false }));
    const edgesCsv = table(workingEdgesCsv(store.state, rows, curves, { excelBom: false }));
    expect(edgesCsv.length).toBe(Math.max(1, edges.length));
    let compared = 0;
    for (const row of edgesCsv) {
      for (const method of ['three_points', 'two_lines'] as const)
        for (const d of [2, 5, 10]) {
          // in R: aggregate(angle_deg ~ curve_id + working_edge + method + distance, edge_angles, mean)
          const values = angles.filter((a) => a.curve_id === row.curve_id && a.working_edge === row.working_edge && a.method === method && a.distance === String(d) && a.angle_deg !== '').map((a) => Number(a.angle_deg));
          const cell = row[`edge_angle_${method === 'three_points' ? '3pt' : '2ln'}_${d}mm`];
          if (!values.length) {
            expect(cell).toBe('');
            continue;
          }
          const mean = values.reduce((s, v) => s + v, 0) / values.length;
          expect(Math.abs(Number(cell) - mean)).toBeLessThanOrEqual(1e-9);
          compared++;
        }
      expect(row.note).toBe('');
    }
    return { compared, edgesCsv };
  };

  it('two working edges: each its own stations', () => {
    const { compared, edgesCsv } = check([
      [bend([4, 5, 0]), bend([4, 20, 0])],
      [bend([4, 20, 0]), bend([4, 35, 0])],
    ]);
    expect(edgesCsv.map((r) => r.working_edge)).toEqual(['E1', 'E2']);
    expect(compared).toBeGreaterThanOrEqual(8);
    // the angles do change along the edge: the two edges' means differ
    expect(edgesCsv[0].edge_angle_3pt_2mm).not.toBe(edgesCsv[1].edge_angle_3pt_2mm);
  });

  it('no working edge: the whole curve, its row with working_edge empty', () => {
    const { compared, edgesCsv } = check([]);
    expect(edgesCsv.map((r) => r.working_edge)).toEqual(['']);
    expect(compared).toBeGreaterThanOrEqual(4);
  });
});

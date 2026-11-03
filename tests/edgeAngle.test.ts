import { describe, expect, it } from 'vitest';
import { EDGE_ANGLE_DISTANCES_MM, edgeAngles, referenceCurve, valuesAlongCurve, type EdgeAngleResult } from '../src/compute/edgeAngle';
import { arcLengths } from '../src/compute/landmarks';
import { buildEdges } from '../src/compute/meshGeometry';
import type { Vec3 } from '../src/core/types';
import { bicone, flakeT1, mapped, rigid, type Mesh } from './meshes';

const deg = (r: number) => (r * 180) / Math.PI;
const T4_ANGLE = deg(Math.atan(8 / 30)) + deg(Math.atan(5 / 30));
const T1_ANGLE = deg(Math.atan(10 / 62));

const meanEdge = (m: Mesh): number => {
  const e = buildEdges(m.index, m.positions.length / 3);
  let s = 0;
  for (let i = 0; i < e.v0.length; i++) {
    const a = 3 * e.v0[i], b = 3 * e.v1[i];
    s += Math.hypot(m.positions[a] - m.positions[b], m.positions[a + 1] - m.positions[b + 1], m.positions[a + 2] - m.positions[b + 2]);
  }
  return s / e.v0.length;
};

const SEGMENTS = 192;
const t4 = () => bicone(30, 8, 5, SEGMENTS, 16);
const rim = (m: Mesh & { rim: number }): Vec3[] => Array.from({ length: SEGMENTS }, (_, j) => [m.positions[3 * (m.rim + j)], m.positions[3 * (m.rim + j) + 1], m.positions[3 * (m.rim + j) + 2]]);

/** T1's distal ridge, from one side to the other. */
const ridge = (f: (p: Vec3) => Vec3 = (p) => p): Vec3[] => Array.from({ length: 31 }, (_, i) => f([-15 + i, 60, 0]));

function run(m: Mesh, points: Vec3[], closed: boolean, unit = 'mm'): EdgeAngleResult | null {
  return edgeAngles({ positions: m.positions, index: m.index, points, closed, unit, meanEdge: meanEdge(m) });
}

describe('edge angles', () => {
  it('T4: all round the edge of the bicone, at every distance, by both methods', () => {
    const m = t4();
    const r = run(m, rim(m), true)!;
    expect(r.distances).toEqual([2, 5, 10]);
    // about the circumference, one station per millimetre
    expect(r.stations.length).toBeGreaterThan(180);
    expect(r.stations.length).toBeLessThan(190);
    for (const s of r.stations) {
      expect(s.point).not.toBeNull();
      expect(s.three_points).toHaveLength(3);
      for (const a of [...s.three_points, ...s.two_lines]) {
        expect(a).not.toBeNull();
        expect(Math.abs(a! - T4_ANGLE)).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('T1: along the distal ridge, away from its ends', () => {
    const r = run(flakeT1(), ridge(), false)!;
    const inner = r.stations.filter((s) => s.point && s.point[0] > -14 && s.point[0] < 14);
    expect(inner.length).toBeGreaterThanOrEqual(27);
    for (const s of inner)
      for (const a of [...s.three_points, ...s.two_lines]) {
        expect(a).not.toBeNull();
        expect(Math.abs(a! - T1_ANGLE)).toBeLessThanOrEqual(0.5);
      }
  });

  it('a rigid movement changes nothing', () => {
    const f = rigid([1, -2, 0.7], 61, [40, 15, -90]);
    const a = run(flakeT1(), ridge(), false)!;
    const b = run(mapped(flakeT1(), f), ridge(f), false)!;
    expect(b.stations.length).toBe(a.stations.length);
    a.stations.forEach((s, k) => {
      if (!s.point || s.point[0] <= -14 || s.point[0] >= 14) return;
      s.three_points.forEach((x, i) => expect(Math.abs(b.stations[k].three_points[i]! - x!)).toBeLessThanOrEqual(0.5));
      s.two_lines.forEach((x, i) => expect(Math.abs(b.stations[k].two_lines[i]! - x!)).toBeLessThanOrEqual(0.5));
    });
  });

  it('stations of an open curve: the length of the reference curve, one a millimetre, and one more', () => {
    const points = ridge();
    const r = run(flakeT1(), points, false)!;
    const ref = referenceCurve(points, false, 1, 5);
    const cum = arcLengths(ref, false);
    expect(r.stations.length).toBe(Math.floor(cum[cum.length - 1]) + 1);
    expect(r.stations.map((s) => s.position).slice(0, 3)).toEqual([0, 1, 2]);
  });

  it('the reference curve is smoothed; a straight curve stays where it is, its ends too', () => {
    const line: Vec3[] = [[0, 0, 0], [10, 0, 0]];
    const ref = referenceCurve(line, false, 1, 5);
    expect(ref.length).toBe(11);
    ref.forEach((p, i) => expect(p[0]).toBeCloseTo(i, 8));
    // a corner is rounded by the average, its ends are not moved
    const corner: Vec3[] = [[0, 0, 0], [10, 0, 0], [10, 10, 0]];
    const r = referenceCurve(corner, false, 1, 5);
    expect(r[0]).toEqual([0, 0, 0]);
    expect(r[r.length - 1]).toEqual([10, 10, 0]);
    expect(Math.hypot(r[10][0] - 10, r[10][1])).toBeGreaterThan(0.5);
  });

  it('no angle where the section ends before the distance', () => {
    // a roof 8 across: 4 on each side of the ridge
    const pos: number[] = [];
    const idx: number[] = [];
    const nx = 40, ny = 16;
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) pos.push(i, -4 + j * 0.5, -0.25 * Math.abs(-4 + j * 0.5));
    const id = (i: number, j: number) => j * (nx + 1) + i;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) idx.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
    const m: Mesh = { positions: new Float32Array(pos), index: new Uint32Array(idx) };
    const line: Vec3[] = Array.from({ length: 21 }, (_, i): Vec3 => [10 + i, 0, 0]);
    const r = run(m, line, false)!;
    const s = r.stations[10];
    const want = 180 - 2 * deg(Math.atan(0.25));
    expect(Math.abs(s.three_points[0]! - want)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(s.two_lines[0]! - want)).toBeLessThanOrEqual(0.5);
    // 5 and 10 mm are past the edge of the roof
    expect(s.three_points.slice(1)).toEqual([null, null]);
    expect(s.two_lines.slice(1)).toEqual([null, null]);
  });

  it('nothing without a stated unit; the distances follow the unit', () => {
    const m = flakeT1();
    expect(run(m, ridge(), false, '')).toBeNull();
    // the same flake in centimetres: distances and positions in cm, the same angles
    const cm = mapped(m, (p) => [p[0] / 10, p[1] / 10, p[2] / 10]);
    const r = run(cm, ridge((p) => [p[0] / 10, p[1] / 10, p[2] / 10]), false, 'cm')!;
    expect(r.distances.map((d) => Math.round(d * 10) / 10)).toEqual(EDGE_ANGLE_DISTANCES_MM.map((d) => d / 10));
    expect(r.stations.length).toBe(31);
    expect(r.stations[1].position).toBeCloseTo(0.1, 8);
    const s = r.stations[15];
    for (const a of s.three_points) expect(Math.abs(a! - T1_ANGLE)).toBeLessThanOrEqual(0.5);
  });
});

describe('the colours along a curve', () => {
  const station = (position: number, value: number | null) => ({ position, point: [position, 0, 0] as Vec3, value });

  it('keeps to the curve, with a point at least every half station, the value of the nearest station', () => {
    const out = valuesAlongCurve([[0, 0, 0], [4, 0, 0]], false, [0, 1, 2, 3, 4].map((x) => station(x, 10 * x)));
    expect(out.map((p) => p.point[0])).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
    expect(out[0].value).toBe(0);
    expect(out[2].value).toBe(10);
    expect(out[8].value).toBe(40);
  });

  it('does not cut a corner: all the points lie on the curve, as the stations between them need not', () => {
    const corner: Vec3[] = [[0, 0, 0], [1.5, 0, 0], [1.5, 1.5, 0]];
    const stations = [{ position: 0, point: [0, 0, 0] as Vec3, value: 1 }, { position: 1, point: [1, 0, 0] as Vec3, value: 2 }, { position: 2, point: [1.5, 0.5, 0] as Vec3, value: 3 }, { position: 3, point: [1.5, 1.5, 0] as Vec3, value: 4 }];
    const out = valuesAlongCurve(corner, false, stations);
    expect(out.some((p) => p.point[0] === 1.5 && p.point[1] === 0)).toBe(true);
    for (const { point: [x, y] } of out) expect(y === 0 || x === 1.5).toBe(true);
  });

  it('goes round a closed curve, and leaves a station without a value empty', () => {
    const square: Vec3[] = [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]];
    const stations = [{ position: 0, point: [0, 0, 0] as Vec3, value: 1 }, { position: 2, point: [2, 0, 0] as Vec3, value: null }, { position: 4, point: [2, 2, 0] as Vec3, value: 3 }, { position: 6, point: [0, 2, 0] as Vec3, value: 4 }];
    const out = valuesAlongCurve(square, true, stations);
    // two pieces a side, the last point being the one before the first
    expect(out.length).toBe(8);
    expect(out.at(-1)!.point).toEqual([0, 1, 0]);
    expect(out[2]).toEqual({ point: [2, 0, 0], value: null });
    expect(out[4].value).toBe(3);
  });

  it('has nothing to colour without a station on the mesh', () => {
    expect(valuesAlongCurve([[0, 0, 0], [1, 0, 0]], false, [{ position: 0, point: null, value: null }])).toEqual([]);
  });
});

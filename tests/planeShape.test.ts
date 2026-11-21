import { describe, expect, it } from 'vitest';
import { fallbackAxis, gridStep, PLANE_SHAPE, planeShape, roundedRectOutline, type PlaneShape } from '../src/compute/planeShape';
import type { Vec3 } from '../src/core/types';

const XY = { point: [0, 0, 0] as Vec3, normal: [0, 0, 1] as Vec3 };
/** A closed polyline: the rectangle w × h about (cx, cy) in the XY plane, turned by `deg`. */
function rectangle(w: number, h: number, deg = 0, cx = 0, cy = 0): Vec3[] {
  const t = (deg * Math.PI) / 180;
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [cx + x * Math.cos(t) - y * Math.sin(t), cy + x * Math.sin(t) + y * Math.cos(t), 0]);
}
const circle = (r: number, n = 64): Vec3[] => Array.from({ length: n }, (_, k) => [r * Math.cos((2 * Math.PI * k) / n), r * Math.sin((2 * Math.PI * k) / n), 0]);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** How far a point lies outside the rounded rectangle (≤ 0 inside), in the plane's own terms. */
function outside(s: PlaneShape, p: Vec3): number {
  const d: Vec3 = [p[0] - s.center[0], p[1] - s.center[1], p[2] - s.center[2]];
  const qx = Math.abs(dot(d, s.u)) - (s.halfWidth - s.radius), qy = Math.abs(dot(d, s.v)) - (s.halfHeight - s.radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - s.radius;
}
const lengthOf = ([a, b]: [Vec3, Vec3]) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

describe('the shape of a plane', () => {
  it('a 40 × 20 rectangle in XY: u along its long side, half sides 20 + 6 and 10 + 6, corners 0.10 × 32', () => {
    const s = planeShape({ ...XY, lines: [{ points: rectangle(40, 20), closed: true }], box: null, frameX: null })!;
    expect(s.from).toBe('section');
    expect(s.fallback).toBe(false);
    expect(Math.abs(s.u[0])).toBeCloseTo(1, 12);
    expect(s.halfWidth).toBeCloseTo(26, 12);
    expect(s.halfHeight).toBeCloseTo(16, 12);
    expect(s.radius).toBeCloseTo(3.2, 12);
    expect(s.normalLength).toBeCloseTo(0.4 * 32, 12);
    // v = n × u
    expect(dot(s.v, [0, 0, 1])).toBeCloseTo(0, 12);
    expect(s.u[0] * s.v[1] - s.u[1] * s.v[0]).toBeCloseTo(1, 12);
    s.center.forEach((c) => expect(c).toBeCloseTo(0, 12));
  });

  it('turned 30° and off the plane’s point: u along the long side, the centre the middle of the section', () => {
    const s = planeShape({ ...XY, lines: [{ points: rectangle(40, 20, 30, 5, -3), closed: true }], box: null, frameX: null })!;
    expect(Math.abs(dot(s.u, [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0]))).toBeCloseTo(1, 9);
    expect(s.center[0]).toBeCloseTo(5, 9);
    expect(s.center[1]).toBeCloseTo(-3, 9);
    expect(s.center[2]).toBeCloseTo(0, 12);
    expect(s.halfWidth).toBeCloseTo(26, 9);
    expect(s.halfHeight).toBeCloseTo(16, 9);
  });

  it('a round section: the fallback direction (the specimen frame’s x in the plane; without it the world axis furthest from the normal)', () => {
    const lines = [{ points: circle(10), closed: true }];
    const plain = planeShape({ ...XY, lines, box: null, frameX: null })!;
    expect(plain.fallback).toBe(true);
    expect(plain.u).toEqual([1, 0, 0]);
    expect(plain.halfWidth).toBeCloseTo(10 + 0.15 * 20, 9);
    const framed = planeShape({ ...XY, lines, box: null, frameX: [0.6, 0.8, 0.5] })!;
    expect(framed.fallback).toBe(true);
    framed.u.forEach((x, k) => expect(x).toBeCloseTo([0.6, 0.8, 0][k], 12));
    // a frame x along the normal: no help; the world axes
    expect(fallbackAxis([0, 0, 1], [0, 0, 2])).toEqual([1, 0, 0]);
    // a plane tilted about Y: Y is the axis furthest from its normal
    const n: Vec3 = [Math.SQRT1_2, 0, Math.SQRT1_2];
    fallbackAxis(n, null).forEach((x, k) => expect(x).toBeCloseTo([0, 1, 0][k], 12));
    // nearly round (an ellipse 1 : 0.95): still the fallback; clearly long (1 : 0.8): its own direction
    const ellipse = (b: number): Vec3[] => circle(10).map((p) => [p[1], b * p[0], 0]);
    expect(planeShape({ ...XY, lines: [{ points: ellipse(0.95), closed: true }], box: null, frameX: null })!.fallback).toBe(true);
    const long = planeShape({ ...XY, lines: [{ points: ellipse(1 / 0.8), closed: true }], box: null, frameX: null })!;
    expect(long.fallback).toBe(false);
    expect(Math.abs(long.u[1])).toBeCloseTo(1, 9);
    expect(PLANE_SHAPE.PLANE_ROUND_RATIO).toBe(0.85);
  });

  it('the grid step: the least of 1, 2, 5 × 10^k with at most 8 cells along the longer side', () => {
    const cases: Array<[number, number]> = [
      [52, 10],
      [7.3, 1],
      [8, 1],
      [8.01, 2],
      [16, 2],
      [16.5, 5],
      [40, 5],
      [41, 10],
      [0.37, 0.05],
      [1234, 200],
    ];
    for (const [longer, g] of cases) {
      expect(gridStep(longer)).toBeCloseTo(g, 12);
      expect(longer / gridStep(longer)).toBeLessThanOrEqual(8 + 1e-9);
    }
    expect(gridStep(0)).toBe(0);
    // the 40 × 20 rectangle's: 52 long, step 10
    expect(planeShape({ ...XY, lines: [{ points: rectangle(40, 20), closed: true }], box: null, frameX: null })!.gridStep).toBe(10);
  });

  it('the grid lies within the rounded rectangle (to 1e-9 of its size); lines by the corners are shorter than the middle ones', () => {
    // 30 × 25: 39 × 34 with the margin, corners 3.4, step 5; the lines at v = ±15 run into the corners
    const s = planeShape({ ...XY, lines: [{ points: rectangle(30, 25), closed: true }], box: null, frameX: null })!;
    expect(s.gridStep).toBe(5);
    expect(s.radius).toBeCloseTo(3.4, 12);
    const tol = 1e-9 * s.halfWidth;
    for (const line of s.grid) for (const p of line) expect(outside(s, p)).toBeLessThanOrEqual(tol);
    // through the centre, every 5 either way: 7 along u (v = −15 … 15), 7 along v (u = −15 … 15)
    expect(s.grid).toHaveLength(14);
    const alongU = s.grid.filter(([a, b]) => Math.abs(a[1] - b[1]) < 1e-12);
    const middle = alongU.find(([a]) => Math.abs(a[1]) < 1e-12)!;
    const edge = alongU.find(([a]) => Math.abs(a[1] - 15) < 1e-9)!;
    expect(lengthOf(middle)).toBeCloseTo(2 * s.halfWidth, 9);
    expect(lengthOf(edge)).toBeLessThan(lengthOf(middle));
    // the corner's arc: 19.5 − 3.4 + √(3.4² − (15 − 13.6)²), each way
    expect(lengthOf(edge)).toBeCloseTo(2 * (19.5 - 3.4 + Math.sqrt(3.4 ** 2 - 1.4 ** 2)), 9);
    // its ends on the arc
    for (const p of edge) expect(Math.abs(outside(s, p))).toBeLessThan(tol);
    // the outline: on the boundary all round
    for (const p of roundedRectOutline(s)) expect(Math.abs(outside(s, p))).toBeLessThan(tol);
  });

  it('no section: the box’s corners projected onto the plane, the fallback direction', () => {
    const s = planeShape({ ...XY, lines: null, box: { min: [-10, -5, -2], max: [10, 5, 2] }, frameX: null })!;
    expect(s.from).toBe('box');
    expect(s.fallback).toBe(true);
    expect(s.u).toEqual([1, 0, 0]);
    expect(s.halfWidth).toBeCloseTo(10 + 0.15 * 20, 12);
    expect(s.halfHeight).toBeCloseTo(5 + 0.15 * 20, 12);
    // an empty section is none
    expect(planeShape({ ...XY, lines: [], box: { min: [-10, -5, -2], max: [10, 5, 2] }, frameX: null })!.from).toBe('box');
    // nothing at all: no shape
    expect(planeShape({ ...XY, lines: null, box: null, frameX: null })).toBeNull();
  });

  it('a tilted plane: the rectangle in the plane, its centre on it', () => {
    const n: Vec3 = [0, Math.SQRT1_2, Math.SQRT1_2];
    const point: Vec3 = [1, 2, 3];
    // a section 40 × 10 in that plane: along X and along (0, 1, −1)
    const w: Vec3 = [0, Math.SQRT1_2, -Math.SQRT1_2];
    const pts = [[-20, -5], [20, -5], [20, 5], [-20, 5]].map(([a, b]): Vec3 => [point[0] + a, point[1] + b * w[1], point[2] + b * w[2]]);
    const s = planeShape({ point, normal: n, lines: [{ points: pts, closed: true }], box: null, frameX: null })!;
    expect(Math.abs(s.u[0])).toBeCloseTo(1, 9);
    expect(dot([s.center[0] - point[0], s.center[1] - point[1], s.center[2] - point[2]], n)).toBeCloseTo(0, 9);
    expect(s.halfWidth).toBeCloseTo(26, 9);
    expect(s.halfHeight).toBeCloseTo(11, 9);
    for (const line of s.grid) for (const p of line) expect(Math.abs(dot([p[0] - point[0], p[1] - point[1], p[2] - point[2]], n))).toBeLessThan(1e-9);
  });
});

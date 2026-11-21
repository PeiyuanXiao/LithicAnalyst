import type { Vec3 } from '../core/types';

/**
 * How a plane is drawn: a rounded rectangle in the plane fitted to where the plane cuts the model (its section), with a sparse grid.
 * Pure (no three.js): the drawing (`render/planeLayer.ts`) only turns this into lines and triangles.
 */

/** The parameters of the shape. */
export const PLANE_SHAPE = {
  /** λ₂ / λ₁ of the section above this: nearly round, its main direction unsteady; the fallback direction is taken instead. */
  PLANE_ROUND_RATIO: 0.85,
  /** The margin round the section on each side, as a share of the section's longer side. */
  PLANE_MARGIN: 0.15,
  /** The corners' radius, as a share of the rectangle's shorter side. */
  PLANE_CORNER: 0.1,
  /** The grid's step: the least of 1, 2, 5 × 10^k that cuts the longer side into at most this many cells. */
  GRID_MAX_CELLS: 8,
  /** The normal drawn: its length as a share of the shorter side. */
  NORMAL_SHARE: 0.4,
} as const;

export interface PlaneShapeInput {
  /** A point of the plane and its unit normal (original coordinates). */
  point: Vec3;
  normal: Vec3;
  /** Where the plane cuts the model (or a curve's points): lines of points; null or none: the box instead. */
  lines: ReadonlyArray<{ points: readonly Vec3[]; closed: boolean }> | null;
  /** The model's bounding box, for when there is no section. */
  box: { min: Vec3; max: Vec3 } | null;
  /** The specimen frame's x axis (null: no specimen frame), for the fallback direction. */
  frameX: Vec3 | null;
}

export interface PlaneShape {
  /** The rectangle's centre, in the plane (not necessarily the plane's own point). */
  center: Vec3;
  /** In-plane axes: u along the section's main direction (or the fallback), v = n × u. */
  u: Vec3;
  v: Vec3;
  normal: Vec3;
  /** Half the extent along u and along v, the margin included. */
  halfWidth: number;
  halfHeight: number;
  /** The corners' radius. */
  radius: number;
  /** The grid's step (model units) and its lines, cut to the rounded rectangle: their end points. */
  gridStep: number;
  grid: Array<[Vec3, Vec3]>;
  /** The normal's length as drawn. */
  normalLength: number;
  /** What the rectangle was fitted to: the section, or the box's corners; whether u is the fallback direction. */
  from: 'section' | 'box';
  fallback: boolean;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const along = (p: Vec3, a: Vec3, s: number): Vec3 => [p[0] + s * a[0], p[1] + s * a[1], p[2] + s * a[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
const inPlane = (a: Vec3, n: Vec3): Vec3 => along(a, n, -dot(a, n));

/**
 * The direction taken when the section gives none (nearly round, or no section): the specimen frame's x axis in the plane; without
 * a specimen frame (or with its x along the normal), the world axis at the largest angle from the normal, in the plane.
 */
export function fallbackAxis(normal: Vec3, frameX: Vec3 | null): Vec3 {
  const n = unit(normal);
  if (frameX) {
    const p = inPlane(frameX, n);
    if (Math.hypot(p[0], p[1], p[2]) > 1e-6 * Math.hypot(frameX[0], frameX[1], frameX[2])) return unit(p);
  }
  // the smallest |n_k|: the axis furthest from the normal (the first of equals)
  let k = 0;
  for (const j of [1, 2]) if (Math.abs(n[j]) < Math.abs(n[k]) - 1e-12) k = j;
  const axis: Vec3 = [0, 0, 0];
  axis[k] = 1;
  return unit(inPlane(axis, n));
}

/** The least of 1, 2, 5 × 10^k that cuts `longer` into at most `maxCells` cells (0 for no length). */
export function gridStep(longer: number, maxCells: number = PLANE_SHAPE.GRID_MAX_CELLS): number {
  if (!(longer > 0) || !Number.isFinite(longer)) return 0;
  let k = Math.floor(Math.log10(longer / maxCells)) - 1;
  for (;;) {
    for (const m of [1, 2, 5]) {
      const g = k >= 0 ? m * 10 ** k : m / 10 ** -k;
      if (longer / g <= maxCells * (1 + 1e-9)) return g;
    }
    k++;
  }
}

/** How far a chord at `c` from the centre line reaches within a rounded rectangle of half sides `half`, `across` and corner `r`. */
function reach(c: number, half: number, across: number, r: number): number {
  const a = Math.abs(c);
  if (a <= across - r) return half;
  const dy = a - (across - r);
  return half - r + Math.sqrt(Math.max(0, r * r - dy * dy));
}

/** The plane's rounded rectangle and grid; null when there is neither a section nor a box. */
export function planeShape(input: PlaneShapeInput): PlaneShape | null {
  const n = unit(input.normal);
  const p0 = input.point;
  const e1 = fallbackAxis(n, input.frameX);
  const e2 = cross(n, e1);
  // the section's points, or the box's corners
  const lines = (input.lines ?? []).filter((l) => l.points.length > 0);
  let from: PlaneShape['from'] = 'section';
  let runs: Array<{ points: readonly Vec3[]; closed: boolean }> = lines;
  if (!lines.length) {
    const b = input.box;
    if (!b) return null;
    from = 'box';
    const corners: Vec3[] = [];
    for (let i = 0; i < 8; i++) corners.push([i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]);
    runs = [{ points: corners, closed: false }];
  }
  const flat = runs.map((l) => l.points.map((p): [number, number] => {
    const d = sub(p, p0);
    return [dot(d, e1), dot(d, e2)];
  }));
  // the main direction: principal components of the lines (each segment by its length; points alone, each the same)
  let u = e1, fallback = true;
  if (from === 'section') {
    let w = 0, mx = 0, my = 0, sxx = 0, sxy = 0, syy = 0;
    const seg = (a: [number, number], b: [number, number]) => {
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!(l > 0)) return;
      w += l;
      mx += (l * (a[0] + b[0])) / 2;
      my += (l * (a[1] + b[1])) / 2;
      sxx += l * ((a[0] * a[0] + b[0] * b[0]) / 3 + (a[0] * b[0]) / 3);
      syy += l * ((a[1] * a[1] + b[1] * b[1]) / 3 + (a[1] * b[1]) / 3);
      sxy += l * ((a[0] * a[1] + b[0] * b[1]) / 3 + (a[0] * b[1] + b[0] * a[1]) / 6);
    };
    flat.forEach((pts, i) => {
      for (let k = 0; k + 1 < pts.length; k++) seg(pts[k], pts[k + 1]);
      if (runs[i].closed && pts.length > 2) seg(pts[pts.length - 1], pts[0]);
    });
    if (!(w > 0)) {
      // (no length: the points, each the same)
      for (const pts of flat)
        for (const q of pts) {
          w++;
          mx += q[0];
          my += q[1];
          sxx += q[0] * q[0];
          syy += q[1] * q[1];
          sxy += q[0] * q[1];
        }
    }
    if (w > 0) {
      mx /= w;
      my /= w;
      const a = sxx / w - mx * mx, c = syy / w - my * my, b = sxy / w - mx * my;
      const mid = (a + c) / 2, rad = Math.hypot((a - c) / 2, b);
      const l1 = mid + rad, l2 = mid - rad;
      if (l1 > 0 && l2 / l1 <= PLANE_SHAPE.PLANE_ROUND_RATIO) {
        // (θ within (−90°, 90°]: u leans toward the fallback direction)
        const th = 0.5 * Math.atan2(2 * b, a - c);
        u = unit([Math.cos(th) * e1[0] + Math.sin(th) * e2[0], Math.cos(th) * e1[1] + Math.sin(th) * e2[1], Math.cos(th) * e1[2] + Math.sin(th) * e2[2]]);
        fallback = false;
      }
    }
  }
  const v = cross(n, u);
  // the extent along u and v, a margin round it
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const run of runs)
    for (const p of run.points) {
      const d = sub(p, p0);
      const x = dot(d, u), y = dot(d, v);
      if (x < u0) u0 = x;
      if (x > u1) u1 = x;
      if (y < v0) v0 = y;
      if (y > v1) v1 = y;
    }
  const margin = PLANE_SHAPE.PLANE_MARGIN * Math.max(u1 - u0, v1 - v0);
  const halfWidth = (u1 - u0) / 2 + margin, halfHeight = (v1 - v0) / 2 + margin;
  const center = along(along(p0, u, (u0 + u1) / 2), v, (v0 + v1) / 2);
  const shorter = 2 * Math.min(halfWidth, halfHeight);
  const radius = PLANE_SHAPE.PLANE_CORNER * shorter;
  // the grid: through the centre, every step either way, cut to the rounded rectangle
  const step = gridStep(2 * Math.max(halfWidth, halfHeight));
  const grid: Array<[Vec3, Vec3]> = [];
  if (step > 0) {
    const eps = 1e-9 * Math.max(halfWidth, halfHeight);
    const lines = (half: number, across: number, dir: Vec3, off: Vec3) => {
      const m = Math.floor((across - eps) / step);
      for (let j = -m; j <= m; j++) {
        const c = j * step;
        if (Math.abs(c) >= across - eps) continue;
        const x = reach(c, half, across, radius);
        if (!(x > eps)) continue;
        const o = along(center, off, c);
        grid.push([along(o, dir, -x), along(o, dir, x)]);
      }
    };
    // along u (v constant), then along v (u constant)
    lines(halfWidth, halfHeight, u, v);
    lines(halfHeight, halfWidth, v, u);
  }
  return { center, u, v, normal: n, halfWidth, halfHeight, radius, gridStep: step, grid, normalLength: PLANE_SHAPE.NORMAL_SHARE * shorter, from, fallback };
}

/** The rounded rectangle's outline, a closed loop (original coordinates), `perCorner` segments a corner. */
export function roundedRectOutline(s: Pick<PlaneShape, 'center' | 'u' | 'v' | 'halfWidth' | 'halfHeight' | 'radius'>, perCorner = 12): Vec3[] {
  const r = Math.min(s.radius, s.halfWidth, s.halfHeight);
  const ax = s.halfWidth - r, ay = s.halfHeight - r;
  const out: Vec3[] = [];
  const corners: Array<[number, number, number]> = [
    [ax, ay, 0],
    [-ax, ay, 90],
    [-ax, -ay, 180],
    [ax, -ay, 270],
  ];
  for (const [cx, cy, start] of corners)
    for (let k = 0; k <= (r > 0 ? perCorner : 0); k++) {
      const t = ((start + (90 * k) / perCorner) * Math.PI) / 180;
      const x = cx + r * Math.cos(t), y = cy + r * Math.sin(t);
      out.push(along(along(s.center, s.u, x), s.v, y));
    }
  return out;
}

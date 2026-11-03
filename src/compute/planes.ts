import type { Plane, PlaneMethod, ProjectState, Vec3 } from '../core/types';
import { symmetricEigen3 } from './linalg';
import { fitPlane, type FittedPlane, type PrincipalAxes } from './meshGeometry';
import { runSync, YIELD_EVERY, type Steps } from './steps';

/** A fitted plane, derived from its inputs. */
export interface PlaneResult {
  id: string;
  label: string;
  method: PlaneMethod;
  /** False when the inputs are not enough (fewer than 3 points, or fewer than 2 non-parallel directions). */
  valid: boolean;
  center: Vec3 | null;
  /** Unit normal, on the side of the plane's upHint. */
  normal: Vec3 | null;
  /** Row-major 4×4 matrix from original coordinates to the plane frame. */
  matrix: number[] | null;
  /** Points (or directions) the plane was fitted to. */
  inputCount: number;
}

/** Points per plane when curves are resampled at equal arc length. */
export const CURVE_SAMPLES = 256;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const l = len(a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mean = (pts: Vec3[]): Vec3 => {
  const s: Vec3 = [0, 0, 0];
  for (const p of pts) for (let k = 0; k < 3; k++) s[k] += p[k];
  return [s[0] / pts.length, s[1] / pts.length, s[2] / pts.length];
};

/** Points every `spacing` along a polyline, from its start (closed: around the loop, the start not repeated; open: the end kept). */
export function resampleCurve(points: Vec3[], closed: boolean, spacing: number): Vec3[] {
  if (points.length < 2 || !(spacing > 0)) return points.slice();
  const ring = closed ? [...points, points[0]] : points;
  const out: Vec3[] = [ring[0]];
  const arcs = [0];
  let next = spacing;
  let s = 0;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i];
    const l = len(sub(b, a));
    while (next <= s + l) {
      const t = l > 0 ? (next - s) / l : 0;
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]);
      arcs.push(next);
      next += spacing;
    }
    s += l;
  }
  const eps = 1e-9 * Math.max(s, 1);
  // closed: a sample at the full length is the start again
  while (closed && out.length > 1 && arcs[arcs.length - 1] > s - eps) {
    out.pop();
    arcs.pop();
  }
  if (!closed && arcs[arcs.length - 1] < s - eps) out.push(ring[ring.length - 1]);
  return out;
}

/**
 * Plane frame: origin at the centre, +Z the normal, +X the model's first
 * principal axis (vertex PCA) projected onto the plane (the second axis when
 * the first is almost along the normal), its largest component positive;
 * +Y = Z × X. Returns the row-major matrix from original to plane coordinates.
 */
export function planeFrame(center: Vec3, normal: Vec3, axes: readonly Vec3[] | null): number[] {
  const z = unit(normal);
  const candidates: Vec3[] = [...(axes ?? []), [1, 0, 0], [0, 1, 0]];
  let x: Vec3 = [1, 0, 0];
  for (const a of candidates) {
    const p = sub(a, [z[0] * dot(a, z), z[1] * dot(a, z), z[2] * dot(a, z)]);
    if (len(p) > 0.1 * len(a)) {
      x = unit(p);
      break;
    }
  }
  const big = [0, 1, 2].reduce((best, k) => (Math.abs(x[k]) > Math.abs(x[best]) ? k : best), 0);
  if (x[big] < 0) x = [-x[0], -x[1], -x[2]];
  const y: Vec3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return [x[0], x[1], x[2], -dot(x, center), y[0], y[1], y[2], -dot(y, center), z[0], z[1], z[2], -dot(z, center), 0, 0, 0, 1];
}

/**
 * The plane of a surface region: least squares over the region's vertices, each weighted by a third of
 * the area of its triangles in the region (`positions` as the index gives them; `faces`: the region's triangles).
 */
export function* regionPlaneSteps(positions: ArrayLike<number>, index: ArrayLike<number>, faces: ArrayLike<number>, offset: Vec3 = [0, 0, 0]): Steps<Pick<FittedPlane, 'centroid' | 'normal'> & { count: number } | null> {
  const weights = new Map<number, number>();
  for (let i = 0; i < faces.length; i++) {
    if (i % YIELD_EVERY === 0) yield;
    const t = faces[i];
    const a = index[3 * t], b = index[3 * t + 1], c = index[3 * t + 2];
    const ux = positions[3 * b] - positions[3 * a], uy = positions[3 * b + 1] - positions[3 * a + 1], uz = positions[3 * b + 2] - positions[3 * a + 2];
    const vx = positions[3 * c] - positions[3 * a], vy = positions[3 * c + 1] - positions[3 * a + 1], vz = positions[3 * c + 2] - positions[3 * a + 2];
    const w = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 6;
    for (const v of [a, b, c]) weights.set(v, (weights.get(v) ?? 0) + w);
  }
  if (weights.size < 3) return null;
  let total = 0;
  const m: Vec3 = [0, 0, 0];
  for (const [v, w] of weights) {
    total += w;
    for (let k = 0; k < 3; k++) m[k] += w * positions[3 * v + k];
  }
  if (!(total > 0)) return null;
  for (let k = 0; k < 3; k++) m[k] /= total;
  const cov = new Array<number>(9).fill(0);
  let n = 0;
  for (const [v, w] of weights) {
    if (n++ % YIELD_EVERY === 0) yield;
    const d = [positions[3 * v] - m[0], positions[3 * v + 1] - m[1], positions[3 * v + 2] - m[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[3 * i + j] += w * d[i] * d[j];
  }
  const { vectors } = symmetricEigen3(cov);
  return { centroid: [m[0] + offset[0], m[1] + offset[1], m[2] + offset[2]], normal: vectors[2], count: weights.size };
}

export const regionPlane = (positions: ArrayLike<number>, index: ArrayLike<number>, faces: ArrayLike<number>, offset: Vec3 = [0, 0, 0]) => runSync(regionPlaneSteps(positions, index, faces, offset));

/**
 * Compute a plane from its inputs. `vertices`: principal axes of all mesh
 * vertices (original coordinates), or null before the mesh is measured.
 * `regionFit`: for a region plane, the fit to its regions (it needs the mesh; null until known).
 */
export function computePlane(plane: Plane, state: Readonly<ProjectState>, vertices: PrincipalAxes | null, regionFit: { centroid: Vec3; normal: Vec3; count: number } | null = null): PlaneResult {
  const result = (center: Vec3 | null, normal: Vec3 | null, inputCount: number): PlaneResult => {
    if (!center || !normal || !(len(normal) > 0)) return { id: plane.id, label: plane.label, method: plane.method, valid: false, center: null, normal: null, matrix: null, inputCount };
    let n = unit(normal);
    if (dot(n, plane.upHint) < 0) n = [-n[0], -n[1], -n[2]];
    return { id: plane.id, label: plane.label, method: plane.method, valid: true, center, normal: n, matrix: planeFrame(center, n, vertices?.axes ?? null), inputCount };
  };
  switch (plane.method) {
    case 'all_vertices':
      return vertices ? result(vertices.mean, vertices.axes[2], 0) : result(null, null, 0);
    case 'scar_directions': {
      const scars = state.scars.filter((s) => s.vector && len(sub(s.vector.end, s.vector.start)) > 0);
      if (scars.length < 2) return result(null, null, scars.length);
      // direction tensor T = Σ u uᵀ; the normal is the direction least like any of them
      const t = new Array<number>(9).fill(0);
      for (const s of scars) {
        const u = unit(sub(s.vector!.end, s.vector!.start));
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) t[3 * i + j] += u[i] * u[j];
      }
      const { values, vectors } = symmetricEigen3(t);
      if (!(values[1] > 1e-9 * values[0])) return result(null, null, scars.length);
      const mids = scars.map((s) => {
        const v = s.vector!;
        return [(v.start[0] + v.end[0]) / 2, (v.start[1] + v.end[1]) / 2, (v.start[2] + v.end[2]) / 2] as Vec3;
      });
      return result(mean(mids), vectors[2], scars.length);
    }
    case 'scar_starts': {
      const excluded = new Set(plane.excludeCompleteness);
      const starts = state.scars.filter((s) => s.vector && !excluded.has(String(s.attributes.completeness))).map((s) => s.vector!.start);
      const fit = fitPlane(starts);
      return fit ? result(fit.centroid, fit.normal, starts.length) : result(null, null, starts.length);
    }
    case 'curves': {
      const curves = plane.curveIds.map((id) => state.curves.find((c) => c.id === id)).filter((c) => !!c);
      const lengths = curves.map((c) => {
        let l = 0;
        const n = c.points.length;
        for (let i = 1; i < n + (c.closed ? 1 : 0); i++) l += len(sub(c.points[i % n], c.points[i - 1]));
        return l;
      });
      const total = lengths.reduce((a, b) => a + b, 0);
      if (!(total > 0)) return result(null, null, 0);
      const pts = curves.flatMap((c) => resampleCurve(c.points, c.closed, total / CURVE_SAMPLES));
      const fit = fitPlane(pts);
      return fit ? result(fit.centroid, fit.normal, pts.length) : result(null, null, pts.length);
    }
    case 'region':
      return regionFit ? result(regionFit.centroid, regionFit.normal, regionFit.count) : result(null, null, 0);
  }
}

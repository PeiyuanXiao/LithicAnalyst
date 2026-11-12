import type { Vec3 } from '../core/types';
import { add, cross, dot, length, normalize, scale, sub } from '../core/vec';
import { symmetricEigen3 } from './linalg';
import type { Steps } from './steps';
import { triangleBvhSteps } from './triangleBvh';

/**
 * Bringing scar vectors read from another program (an IGES file) onto the model: which unit they are in,
 * whether they already lie on it, the placement of the whole set (the unit's scale, a rotation, a
 * translation) from points the user put where they belong and from an automatic fit, and the arrows on the
 * surface. Only the vectors move: the model and its coordinates never change. Pure: no DOM, no three.js.
 */
export const IGES_IMPORT = {
  /** Two segments of a file are the same when both their ends lie within this share of the diagonal of all the segments' ends. */
  SAME_SHARE: 1e-6,
  /** `tol`, what counts as on the surface: this share of the model's box diagonal. */
  TOL_SHARE: 0.005,
  /** Already on the model: the ends' median distance to the surface at most `tol`, and this quantile at most `P90_TOLS × tol`. */
  QUANTILE: 0.9,
  P90_TOLS: 3,
  /** An end further than this many `tol` from the surface: the arrow is drawn in the warning colour, and to be checked once imported. */
  REVIEW_TOLS: 3,
  /** A unit is sensible when the box of the ends is at most this many times the model's diagonal. */
  SIZE_RATIO: 1.2,
  /** The factors the unit menu offers on the file's coordinates: as they are, × 0.1, × 10, × 25.4, ÷ 25.4, × 1000, ÷ 1000. */
  UNIT_FACTORS: [1, 0.1, 10, 25.4, 1 / 25.4, 1000, 0.001] as readonly number[],
  /** How near a preview end the pointer must be to take it, CSS px. */
  GRAB_PX: 8,
  /** The preview moves to a new placement in this time, ms. */
  MOVE_MS: 150,
  /** The automatic fit uses this share of the ends each round, the nearest (ends may lie where the model was cut away). */
  ICP_KEEP: 0.8,
  ICP_MAX_ROUNDS: 50,
  /** It stops when the RMS distance changes by less than this share of the diagonal. */
  ICP_STOP_SHARE: 1e-6,
} as const;

/** Where the file's coordinates go on the model: x ↦ scale · R x + translation (R row-major, a rotation). The scale is the unit's, never fitted. */
export interface Placement {
  scale: number;
  rotation: number[];
  translation: Vec3;
}

/** A point of the file (its own coordinates) and where the user put it on the model. */
export interface AlignPair {
  from: Vec3;
  to: Vec3;
}

/** The model's surface: the nearest point, its outward unit normal and the distance; and the model's box. */
export interface SurfaceQuery {
  closest(p: Vec3): { point: Vec3; normal: Vec3; distance: number } | null;
  min: Vec3;
  max: Vec3;
}

export interface Segment {
  start: Vec3;
  end: Vec3;
}

export interface Residual {
  median: number;
  p90: number;
  max: number;
}

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const placementOf = (scale = 1): Placement => ({ scale, rotation: [...IDENTITY], translation: [0, 0, 0] });

const mulVec = (r: readonly number[], p: Vec3): Vec3 => [r[0] * p[0] + r[1] * p[1] + r[2] * p[2], r[3] * p[0] + r[4] * p[1] + r[5] * p[2], r[6] * p[0] + r[7] * p[1] + r[8] * p[2]];

const mulMat = (a: readonly number[], b: readonly number[]): number[] => {
  const out = new Array<number>(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[3 * i + j] = a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j];
  return out;
};

export const applyPlacement = (t: Placement, p: Vec3): Vec3 => add(scale(mulVec(t.rotation, p), t.scale), t.translation);

/** The placement as a row-major 4×4 matrix (file coordinates → model coordinates). */
export const placementMatrix = (t: Placement): number[] => {
  const r = t.rotation, s = t.scale;
  return [s * r[0], s * r[1], s * r[2], t.translation[0], s * r[3], s * r[4], s * r[5], t.translation[1], s * r[6], s * r[7], s * r[8], t.translation[2], 0, 0, 0, 1];
};

/** The box diagonal of the surface. */
export const diagonalOf = (s: Pick<SurfaceQuery, 'min' | 'max'>): number => Math.hypot(s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]);

/** What counts as on the surface. */
export const toleranceOf = (s: Pick<SurfaceQuery, 'min' | 'max'>): number => IGES_IMPORT.TOL_SHARE * diagonalOf(s);

/** The rotation by `angle` (radians) about the unit `axis` (Rodrigues). */
export function axisRotation(axis: Vec3, angle: number): number[] {
  const [x, y, z] = axis;
  const c = Math.cos(angle), s = Math.sin(angle), k = 1 - c;
  return [c + x * x * k, x * y * k - z * s, x * z * k + y * s, y * x * k + z * s, c + y * y * k, y * z * k - x * s, z * x * k - y * s, z * y * k + x * s, c + z * z * k];
}

/** The smallest rotation turning direction `a` onto direction `b`. */
export function rotationBetween(a: Vec3, b: Vec3): number[] {
  const u = normalize(a), v = normalize(b);
  const c = Math.max(-1, Math.min(1, dot(u, v)));
  const axis = cross(u, v);
  const s = length(axis);
  if (s < 1e-12) {
    if (c > 0) return [...IDENTITY];
    // half a turn about any axis across `u`
    const other: Vec3 = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    return axisRotation(normalize(cross(u, other)), Math.PI);
  }
  return axisRotation(scale(axis, 1 / s), Math.atan2(s, c));
}

/** Eigenvalues and vectors of a symmetric n × n matrix (cyclic Jacobi), largest first. */
export function symmetricEigen(n: number, m: ArrayLike<number>): { values: number[]; vectors: number[][] } {
  const a: number[][] = [];
  const v: number[][] = [];
  for (let i = 0; i < n; i++) {
    a.push(Array.from({ length: n }, (_, j) => m[n * i + j]));
    v.push(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  }
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0, size = 0;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        size += Math.abs(a[i][j]);
        if (i !== j) off += Math.abs(a[i][j]);
      }
    if (off === 0 || off <= 1e-17 * size) break;
    for (let p = 0; p < n - 1; p++)
      for (let q = p + 1; q < n; q++) {
        if (a[p][q] === 0) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[j][j] - a[i][i]);
  return { values: order.map((i) => a[i][i]), vectors: order.map((i) => v.map((row) => row[i])) };
}

/** The rotation and translation taking points `a` onto `b` best in least squares (Horn's quaternion; a proper rotation, never a mirror). */
export function kabsch(a: readonly Vec3[], b: readonly Vec3[]): { rotation: number[]; translation: Vec3 } {
  const n = a.length;
  const ca: Vec3 = [0, 0, 0], cb: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) {
      ca[k] += a[i][k] / n;
      cb[k] += b[i][k] / n;
    }
  const S = new Array<number>(9).fill(0);
  for (let i = 0; i < n; i++) {
    const p = sub(a[i], ca), q = sub(b[i], cb);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[3 * r + c] += p[r] * q[c];
  }
  const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = S;
  const N = [
    xx + yy + zz, yz - zy, zx - xz, xy - yx,
    yz - zy, xx - yy - zz, xy + yx, zx + xz,
    zx - xz, xy + yx, -xx + yy - zz, yz + zy,
    xy - yx, zx + xz, yz + zy, -xx - yy + zz,
  ];
  const [w, x, y, z] = symmetricEigen(4, N).vectors[0];
  const q = Math.hypot(w, x, y, z);
  const [qw, qx, qy, qz] = [w / q, x / q, y / q, z / q];
  const rotation = [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qw * qz), 2 * (qx * qz + qw * qy),
    2 * (qx * qy + qw * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qw * qx),
    2 * (qx * qz - qw * qy), 2 * (qy * qz + qw * qx), 1 - 2 * (qx * qx + qy * qy),
  ];
  return { rotation, translation: sub(cb, mulVec(rotation, ca)) };
}

/** The translation that brings the pairs together best for this rotation and scale. */
function meanTranslation(pairs: readonly AlignPair[], rotation: number[], s: number): Vec3 {
  const t: Vec3 = [0, 0, 0];
  for (const p of pairs) {
    const d = sub(p.to, scale(mulVec(rotation, p.from), s));
    for (let k = 0; k < 3; k++) t[k] += d[k] / pairs.length;
  }
  return t;
}

/** Two pairs: the current rotation turned by the least that lines up the two points' direction; the translation by least squares. */
function twoPairs(pairs: readonly AlignPair[], current: Placement, i: number, j: number): Placement {
  const s = current.scale;
  const from = scale(mulVec(current.rotation, sub(pairs[j].from, pairs[i].from)), s);
  const to = sub(pairs[j].to, pairs[i].to);
  if (length(from) === 0 || length(to) === 0) return { ...current, translation: meanTranslation(pairs, current.rotation, s) };
  const rotation = mulMat(rotationBetween(from, to), current.rotation);
  return { scale: s, rotation, translation: meanTranslation(pairs, rotation, s) };
}

/**
 * The placement from the pairs, its scale kept: one pair moves the set only, so that the pair meets; two turn it by the least
 * that lines up the two points (the translation by least squares); three or more by Kabsch (in a line, as for two).
 */
export function fitPairs(pairs: readonly AlignPair[], current: Placement): Placement {
  const s = current.scale;
  if (!pairs.length) return current;
  if (pairs.length === 1) return { scale: s, rotation: [...current.rotation], translation: sub(pairs[0].to, scale(mulVec(current.rotation, pairs[0].from), s)) };
  if (pairs.length === 2) return twoPairs(pairs, current, 0, 1);
  // the file's points in a line: the turn about that line is not told by them
  const mean: Vec3 = [0, 0, 0];
  for (const p of pairs) for (let k = 0; k < 3; k++) mean[k] += p.from[k] / pairs.length;
  const cov = new Array<number>(9).fill(0);
  for (const p of pairs) {
    const d = sub(p.from, mean);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cov[3 * r + c] += d[r] * d[c];
  }
  const e = symmetricEigen3(cov);
  if (e.values[1] <= 1e-10 * e.values[0]) {
    let best = [0, 1], far = -1;
    for (let i = 0; i < pairs.length; i++)
      for (let j = i + 1; j < pairs.length; j++) {
        const d = length(sub(pairs[i].from, pairs[j].from));
        if (d > far) [far, best] = [d, [i, j]];
      }
    return twoPairs(pairs, current, best[0], best[1]);
  }
  const k = kabsch(
    pairs.map((p) => scale(p.from, s)),
    pairs.map((p) => p.to),
  );
  return { scale: s, rotation: k.rotation, translation: k.translation };
}

/** The `q` quantile of sorted values (linear between the two nearest ranks). */
export function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return NaN;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at), hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/** Each end's distance to the surface under the placement (start, end of each segment in turn). */
export function endDistances(segments: readonly Segment[], t: Placement, surface: SurfaceQuery): number[] {
  const out: number[] = [];
  for (const s of segments) for (const p of [s.start, s.end]) out.push(surface.closest(applyPlacement(t, p))?.distance ?? Infinity);
  return out;
}

/** The median, 90 % quantile and largest distance of the ends to the surface. */
export function residualOf(distances: readonly number[]): Residual {
  const sorted = [...distances].sort((a, b) => a - b);
  return { median: quantile(sorted, 0.5), p90: quantile(sorted, IGES_IMPORT.QUANTILE), max: sorted.length ? sorted[sorted.length - 1] : NaN };
}

/** On the model already: the median within `tol`, the 90 % quantile within `P90_TOLS × tol`. */
export const isAligned = (r: Residual, tol: number): boolean => r.median <= tol && r.p90 <= IGES_IMPORT.P90_TOLS * tol;

/** The diagonal of the box of the ends, scaled. */
export function endsDiagonal(segments: readonly Segment[], factor = 1): number {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const s of segments)
    for (const p of [s.start, s.end])
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k] * factor);
        max[k] = Math.max(max[k], p[k] * factor);
      }
  return segments.length ? Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) : 0;
}

/** Millimetres per model unit; a unit not stated counts as the millimetre. */
const modelMm = (unit: string): number => ({ mm: 1, cm: 10, m: 1000, in: 25.4 } as Record<string, number>)[unit] ?? 1;

/** The factor the file's own unit gives on the model's (null when the file does not say one that is known). */
export const headerFactor = (fileMm: number | null, modelUnit: string): number | null => (fileMm ? fileMm / modelMm(modelUnit) : null);

export interface UnitGuess {
  factor: number;
  /** The ends' median distance to the surface with no move but the scale. */
  median: number;
  /** The diagonal of the box of the ends. */
  diagonal: number;
  /** That box is at most `SIZE_RATIO` times the model's. */
  sensible: boolean;
}

export interface UnitJudgement {
  /** The factor taken. */
  factor: number;
  guesses: UnitGuess[];
  /** On the model with the scale alone. */
  aligned: boolean;
  residual: Residual;
}

/**
 * Which unit the vectors are in: as they are (the model's), or as the file's header says, converted to the model's. The one
 * of a sensible size nearest the surface; when neither is of a sensible size, the one whose size is nearest the model's.
 */
export function judgeUnits(segments: readonly Segment[], fileFactor: number | null, surface: SurfaceQuery): UnitJudgement {
  const diag = diagonalOf(surface);
  const factors = [1];
  if (fileFactor && Number.isFinite(fileFactor) && Math.abs(fileFactor - 1) > 1e-9) factors.push(fileFactor);
  const guesses = factors.map((factor): UnitGuess => {
    const sorted = endDistances(segments, placementOf(factor), surface).sort((a, b) => a - b);
    const diagonal = endsDiagonal(segments, factor);
    return { factor, median: quantile(sorted, 0.5), diagonal, sensible: diagonal <= IGES_IMPORT.SIZE_RATIO * diag };
  });
  const sensible = guesses.filter((g) => g.sensible);
  const pick = sensible.length
    ? sensible.reduce((a, b) => (b.median < a.median ? b : a))
    : guesses.reduce((a, b) => (Math.abs(Math.log(b.diagonal / diag)) < Math.abs(Math.log(a.diagonal / diag)) ? b : a));
  const residual = residualOf(endDistances(segments, placementOf(pick.factor), surface));
  return { factor: pick.factor, guesses, aligned: isAligned(residual, toleranceOf(surface)), residual };
}

/** Where the preview starts at this scale: as it is, or, when the middle of its ends lies outside the model's box, moved to the box's middle so that it can be seen. */
export function startPlacement(segments: readonly Segment[], factor: number, box: Pick<SurfaceQuery, 'min' | 'max'>): Placement {
  const t = placementOf(factor);
  if (!segments.length) return t;
  const c: Vec3 = [0, 0, 0];
  for (const s of segments) for (const p of [s.start, s.end]) for (let k = 0; k < 3; k++) c[k] += (p[k] * factor) / (2 * segments.length);
  const inside = c.every((v, k) => v >= box.min[k] && v <= box.max[k]);
  if (!inside) t.translation = sub(scale(add(box.min, box.max), 0.5), c);
  return t;
}

/** Solve A x = b (n × n, row-major) by Gaussian elimination with partial pivoting; null when singular. */
function solve(n: number, A: number[], b: number[]): number[] | null {
  const m = A.slice(), r = b.slice();
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(m[n * i + c]) > Math.abs(m[n * p + c])) p = i;
    if (Math.abs(m[n * p + c]) < 1e-300) return null;
    if (p !== c) {
      for (let k = 0; k < n; k++) [m[n * c + k], m[n * p + k]] = [m[n * p + k], m[n * c + k]];
      [r[c], r[p]] = [r[p], r[c]];
    }
    for (let i = c + 1; i < n; i++) {
      const f = m[n * i + c] / m[n * c + c];
      if (f === 0) continue;
      for (let k = c; k < n; k++) m[n * i + k] -= f * m[n * c + k];
      r[i] -= f * r[c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = r[i];
    for (let k = i + 1; k < n; k++) s -= m[n * i + k] * x[k];
    x[i] = s / m[n * i + i];
  }
  return x.every(Number.isFinite) ? x : null;
}

export interface IcpResult {
  placement: Placement;
  /** RMS distance of the ends used in the last round. */
  rms: number;
  rounds: number;
}

/**
 * The automatic fit: from `start`, rigid point-to-plane ICP on the ends (the scale kept). Each round takes the `ICP_KEEP` share of
 * the ends nearest the surface, solves the small turn and move that brings them onto the tangent planes of their nearest points
 * and applies it; it stops after `ICP_MAX_ROUNDS` rounds or when the RMS distance changes by less than `ICP_STOP_SHARE` of the
 * diagonal. A move the surface does not tell (along a flat patch) is not made: the system is damped by a millionth of a millionth
 * of its trace, which leaves the directions it does tell alone.
 */
export function* icpSteps(points: readonly Vec3[], start: Placement, surface: SurfaceQuery): Steps<IcpResult> {
  let t: Placement = { scale: start.scale, rotation: [...start.rotation], translation: [...start.translation] as Vec3 };
  const stop = IGES_IMPORT.ICP_STOP_SHARE * diagonalOf(surface);
  let last = Infinity, rms = Infinity, rounds = 0;
  for (; rounds < IGES_IMPORT.ICP_MAX_ROUNDS; rounds++) {
    const near: Array<{ x: Vec3; q: Vec3; n: Vec3; d: number }> = [];
    for (const p of points) {
      const x = applyPlacement(t, p);
      const c = surface.closest(x);
      if (c) near.push({ x, q: c.point, n: c.normal, d: c.distance });
    }
    if (near.length < 3) break;
    near.sort((a, b) => a.d - b.d);
    const kept = near.slice(0, Math.max(3, Math.ceil(IGES_IMPORT.ICP_KEEP * near.length)));
    rms = Math.sqrt(kept.reduce((s, k) => s + k.d * k.d, 0) / kept.length);
    if (Math.abs(last - rms) < stop) break;
    last = rms;
    // turns about the middle of the ends used, for a well-conditioned system
    const c: Vec3 = [0, 0, 0];
    for (const k of kept) for (let j = 0; j < 3; j++) c[j] += k.x[j] / kept.length;
    const H = new Array<number>(36).fill(0), g = new Array<number>(6).fill(0);
    for (const k of kept) {
      // the end's distance to the tangent plane of its nearest point, as a turn ω about c and a move τ change it
      const j = [...cross(sub(k.x, c), k.n), ...k.n];
      const r = dot(sub(k.q, k.x), k.n);
      for (let a = 0; a < 6; a++) {
        g[a] += j[a] * r;
        for (let b = 0; b < 6; b++) H[6 * a + b] += j[a] * j[b];
      }
    }
    const trace = H[0] + H[7] + H[14] + H[21] + H[28] + H[35];
    for (let a = 0; a < 6; a++) H[7 * a] += 1e-12 * trace;
    const x = solve(6, H, g);
    if (!x) break;
    const omega: Vec3 = [x[0], x[1], x[2]];
    const angle = length(omega);
    const turn = angle > 0 ? axisRotation(scale(omega, 1 / angle), angle) : [...IDENTITY];
    t = { scale: t.scale, rotation: mulMat(turn, t.rotation), translation: add(add(mulVec(turn, sub(t.translation, c)), c), [x[3], x[4], x[5]]) };
    yield;
  }
  return { placement: t, rms, rounds };
}

export interface PlacedArrow {
  start: Vec3;
  end: Vec3;
  /** The outward normal at the surface point nearest the arrow's middle, for both ends. */
  normal: Vec3;
  /** An end lay further than `REVIEW_TOLS × tol` from the surface before it was put on it. */
  review: boolean;
  /** The segment it came from (its index). */
  index: number;
}

/** The arrows on the surface: each placed end to its nearest surface point, the normal at the middle's. Ends that meet in one point give none. */
export function placeArrows(segments: readonly Segment[], t: Placement, surface: SurfaceQuery): PlacedArrow[] {
  const tol = toleranceOf(surface);
  const out: PlacedArrow[] = [];
  segments.forEach((s, index) => {
    const a = applyPlacement(t, s.start), b = applyPlacement(t, s.end);
    const ca = surface.closest(a), cb = surface.closest(b), cm = surface.closest(scale(add(a, b), 0.5));
    if (!ca || !cb || !cm || length(sub(ca.point, cb.point)) === 0) return;
    out.push({ start: ca.point, end: cb.point, normal: cm.normal, review: Math.max(ca.distance, cb.distance) > IGES_IMPORT.REVIEW_TOLS * tol, index });
  });
  return out;
}

/** The segments the other way round (start and end exchanged). */
export const reversed = <T extends Segment>(segments: readonly T[]): T[] => segments.map((s) => ({ ...s, start: s.end, end: s.start }));

/**
 * The surface of a mesh for the nearest points: `positions` relative to `offset` (as the app keeps them), `sign` +1 when its
 * triangles face outward (−1 inward). Built in slices.
 */
export function* meshSurfaceSteps(positions: ArrayLike<number>, index: ArrayLike<number>, offset: Vec3, sign: number): Steps<SurfaceQuery> {
  const bvh = yield* triangleBvhSteps(positions, index);
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k] + offset[k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  return {
    min,
    max,
    closest: (p) => {
      const c = bvh.closest(sub(p, offset));
      if (!c || c.face < 0) return null;
      return { point: add(c.point, offset), normal: faceNormal(positions, index, c.face, sign), distance: c.distance };
    },
  };
}

/** A triangle's unit normal, turned outward by `sign`. */
export function faceNormal(positions: ArrayLike<number>, index: ArrayLike<number>, face: number, sign: number): Vec3 {
  const P = (v: number): Vec3 => [positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]];
  const a = P(index[3 * face]), b = P(index[3 * face + 1]), c = P(index[3 * face + 2]);
  const n = cross(sub(b, a), sub(c, a));
  const l = length(n);
  return l > 0 ? scale(n, sign / l) : [0, 0, 1];
}

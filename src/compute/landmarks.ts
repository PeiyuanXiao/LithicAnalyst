/**
 * Landmarks for geometric morphometrics: fixed landmarks, and curve
 * semilandmarks at equal arc length along a curve, with the sliding
 * definition (before, slider, after) that geomorph and Morpho take.
 * Sliding itself happens in R.
 */

import { frameAxes } from '../core/frame';
import type { Landmark, ProjectState, Vec3 } from '../core/types';

/** Arc length at each point of a polyline; a closed one gets one more entry (back to the first point). */
export function arcLengths(points: readonly Vec3[], closed: boolean): number[] {
  const out = [0];
  const n = points.length + (closed ? 1 : 0);
  for (let i = 1; i < n; i++) {
    const a = points[i - 1], b = points[i % points.length];
    out.push(out[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  return out;
}

/** The point at arc length `s` (clamped to the ends; a closed polyline wraps). */
export function pointAtArc(points: readonly Vec3[], closed: boolean, cum: readonly number[], s: number): Vec3 {
  const L = cum[cum.length - 1];
  if (closed && L > 0) s = ((s % L) + L) % L;
  s = Math.max(0, Math.min(L, s));
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const a = points[lo % points.length], b = points[hi % points.length];
  const seg = cum[hi] - cum[lo];
  const t = seg > 0 ? (s - cum[lo]) / seg : 0;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
}

/** Arc length of the point of the polyline nearest to `p`. */
export function nearestArc(points: readonly Vec3[], closed: boolean, cum: readonly number[], p: Vec3): number {
  let best = Infinity, at = 0;
  const n = points.length + (closed ? 1 : 0);
  if (points.length === 1) return 0;
  for (let i = 1; i < n; i++) {
    const a = points[i - 1], b = points[i % points.length];
    const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / len2)) : 0;
    const q: Vec3 = [a[0] + t * d[0], a[1] + t * d[1], a[2] + t * d[2]];
    const dist = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    if (dist < best) {
      best = dist;
      at = cum[i - 1] + t * (cum[i] - cum[i - 1]);
    }
  }
  return at;
}

export interface CurveSampling {
  points: Vec3[];
  /** The first and the last point slide against these fixed landmarks (ids), or against nothing. */
  before: string | null;
  after: string | null;
  /** A closed curve without landmarks: the points slide round the loop. */
  loop: boolean;
}

/**
 * `count` points at equal arc length along a curve. The stretch runs between
 * the points of the curve nearest the start and end landmarks (each one left
 * out, as it is a fixed landmark); without them, an open curve runs to its
 * ends (included) — with one landmark, to the farther end — and a closed curve
 * goes once round, from its first point or from the one landmark given.
 */
export function sampleCurve(
  curve: { points: readonly Vec3[]; closed: boolean },
  count: number,
  start: { id: string; point: Vec3 } | null,
  end: { id: string; point: Vec3 } | null,
): CurveSampling | null {
  const { points, closed } = curve;
  if (points.length < 2 || count < 1) return null;
  const cum = arcLengths(points, closed);
  const L = cum[cum.length - 1];
  if (!(L > 0)) return null;
  const at = (s: number) => pointAtArc(points, closed, cum, s);
  if (closed && !start && !end) return { points: Array.from({ length: count }, (_, k) => at((L * k) / count)), before: null, after: null, loop: true };
  let a: number, len: number, before: string | null, after: string | null;
  if (closed) {
    const first = (start ?? end)!, last = (end ?? start)!;
    a = nearestArc(points, closed, cum, first.point);
    const b = nearestArc(points, closed, cum, last.point);
    len = (((b - a) % L) + L) % L || L;
    [before, after] = [first.id, last.id];
  } else {
    const sa = start ? nearestArc(points, closed, cum, start.point) : null;
    const sb = end ? nearestArc(points, closed, cum, end.point) : null;
    const far = (s: number) => (s > L - s ? 0 : L);
    a = sa ?? (sb !== null ? far(sb) : 0);
    len = (sb ?? (sa !== null ? far(sa) : L)) - a;
    [before, after] = [start?.id ?? null, end?.id ?? null];
  }
  const fa = before ? 1 : 0, fb = after ? 1 : 0;
  const m = count - 1 + fa + fb;
  return { points: Array.from({ length: count }, (_, k) => at(a + len * (m === 0 ? 0.5 : (k + fa) / m))), before, after, loop: false };
}

export interface LandmarkRow {
  /** 1-based position in the exports. */
  index: number;
  name: string;
  kind: 'fixed' | 'curve';
  /** Label of the semilandmark set ('' for fixed landmarks). */
  setId: string;
  point: Vec3;
}

export interface SemilandmarkResult {
  id: string;
  label: string;
  curveId: string;
  /** False when the curve is missing (no points then). */
  valid: boolean;
  points: Vec3[];
}

export interface LandmarkTable {
  /** Fixed landmarks in list order, then each set's semilandmarks. */
  rows: LandmarkRow[];
  /** geomorph `curves` matrix: [before, slider, after] by row index. */
  sliders: Array<[number, number, number]>;
  sets: SemilandmarkResult[];
}

/** The platform's two ends as left and right of the technical frame (−X left, +X right; two ends on one side: the one further to that side); ids. */
export function platformSides(matrix: readonly number[] | null | undefined, landmarks: readonly Landmark[]): { left: string | null; right: string | null } {
  const ends = landmarks.filter((l) => l.code === 'platform_end');
  if (!matrix || !ends.length) return { left: null, right: null };
  const f = frameAxes(matrix);
  const xs = ends.map((e) => ({ id: e.id, x: (e.point[0] - f.origin[0]) * f.x[0] + (e.point[1] - f.origin[1]) * f.x[1] + (e.point[2] - f.origin[2]) * f.x[2] }));
  if (xs.length === 1) return xs[0].x < 0 ? { left: xs[0].id, right: null } : { left: null, right: xs[0].id };
  const [a, b] = xs[0].x <= xs[1].x ? [xs[0], xs[1]] : [xs[1], xs[0]];
  return { left: a.id, right: b.id };
}

type TableInput = Pick<ProjectState, 'landmarks' | 'semilandmarks' | 'curves'> & Partial<Pick<ProjectState, 'specimen' | 'flake'>>;

/** The landmarks a specimen shows and exports: those of a flake's own (`code`) only on a flake. */
export const shownLandmarks = (state: Pick<TableInput, 'landmarks' | 'specimen'>): Landmark[] => (state.specimen?.type === 'flake' ? [...state.landmarks] : state.landmarks.filter((l) => !l.code));

/** The name a landmark is exported with: a platform end's follows its side of the technical frame. */
export function landmarkName(l: Landmark, sides: { left: string | null; right: string | null }): string {
  return l.id === sides.left ? 'platform_left' : l.id === sides.right ? 'platform_right' : l.name;
}

export function landmarkTable(state: TableInput): LandmarkTable {
  const fixed = shownLandmarks(state);
  const sides = platformSides(state.flake?.axis?.matrix, fixed);
  const rows: LandmarkRow[] = fixed.map((l, i) => ({ index: i + 1, name: landmarkName(l, sides), kind: 'fixed', setId: '', point: [...l.point] as Vec3 }));
  const fixedIndex = new Map(fixed.map((l, i) => [l.id, i + 1]));
  const sliders: LandmarkTable['sliders'] = [];
  const sets: SemilandmarkResult[] = state.semilandmarks.map((q) => {
    const curve = state.curves.find((c) => c.id === q.curveId);
    const lm = (id: string | null) => {
      const l = id ? fixed.find((x) => x.id === id) : undefined;
      return l ? { id: l.id, point: l.point } : null;
    };
    const s = curve ? sampleCurve(curve, q.count, lm(q.startLandmarkId), lm(q.endLandmarkId)) : null;
    if (!s) return { id: q.id, label: q.label, curveId: q.curveId, valid: false, points: [] };
    const first = rows.length + 1;
    s.points.forEach((p, k) => rows.push({ index: first + k, name: `${q.label}_${k + 1}`, kind: 'curve', setId: q.label, point: p }));
    const n = s.points.length;
    for (let k = 0; k < n; k++) {
      const before = k > 0 ? first + k - 1 : s.loop ? first + n - 1 : s.before ? fixedIndex.get(s.before)! : null;
      const after = k < n - 1 ? first + k + 1 : s.loop ? first : s.after ? fixedIndex.get(s.after)! : null;
      if (before !== null && after !== null && before !== first + k && after !== first + k) sliders.push([before, first + k, after]);
    }
    return { id: q.id, label: q.label, curveId: q.curveId, valid: true, points: s.points };
  });
  return { rows, sliders, sets };
}

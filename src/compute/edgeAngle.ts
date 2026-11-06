import { mmPerUnit } from '../core/format';
import type { Vec3 } from '../core/types';
import { angleDeg, TWO_LINES_LENGTH_MM } from './flake';
import { arcLengths, pointAtArc } from './landmarks';
import { sectionByPlane, type PlaneCandidates, type SectionLine } from './meshSection';
import { resampleCurve } from './planes';
import { runSync, type Steps } from './steps';

/**
 * Edge angles along a curve, after Schunk et al. 2023 (3D-EdgeAngle): at stations along a smoothed
 * copy of the curve, the mesh is cut square to the curve, and the angle at the curve is taken
 * in that section from points at several distances along it.
 */

/** The window of the moving average that smooths the reference curve; it only sets the sections' direction. */
export const SMOOTH_WINDOW_MM = 5;
/** Spacing of the points the reference curve is averaged over. */
const REFERENCE_SPACING_MM = 1;
/** One station every so far along the reference curve. */
export const EDGE_ANGLE_STEP_MM = 1;
/** How far from the edge along the section the angle is taken. */
export const EDGE_ANGLE_DISTANCES_MM = [2, 5, 10] as const;
/** The section is looked for within this many times the largest distance of the reference point. */
const SECTION_REACH = 1.5;
/** The curve further than this many mean edge lengths from the section line: no angle at this station. */
export const LINE_REACH_EDGES = 3;

export const EDGE_ANGLE_METHODS = ['three_points', 'two_lines'] as const;
export type EdgeAngleMethod = (typeof EDGE_ANGLE_METHODS)[number];

/** The parameters of the edge angles, as stored with the results and in the manifest. */
export const EDGE_ANGLE_PARAMETERS = {
  SMOOTH_WINDOW_MM,
  EDGE_ANGLE_STEP_MM,
  EDGE_ANGLE_DISTANCES_MM: [...EDGE_ANGLE_DISTANCES_MM],
  TWO_LINES_LENGTH_MM,
};

/** The angles at one station, by distance (null where the section ends before it). */
export interface EdgeAngleStation {
  /** Along the reference curve from its start. */
  position: number;
  /** Where the edge is at this station, original coordinates (null: the section misses the curve). */
  point: Vec3 | null;
  three_points: Array<number | null>;
  two_lines: Array<number | null>;
}

export interface EdgeAngleResult {
  /** The distances in the coordinate unit. */
  distances: number[];
  /** Of the reference curve. */
  length: number;
  stations: EdgeAngleStation[];
}

/**
 * What to colour: the curve itself, with a point at least every half station, each with the value of the
 * station nearest it. The straight lines from station to station would cut through the mesh where it turns.
 */
export function valuesAlongCurve(
  points: readonly Vec3[],
  closed: boolean,
  stations: ReadonlyArray<{ position: number; point: Vec3 | null; value: number | null }>,
): Array<{ point: Vec3; value: number | null }> {
  const placed = stations.filter((s) => s.point);
  if (!placed.length) return [];
  const value = (p: Vec3): number | null => {
    let best = placed[0], least = Infinity;
    for (const s of placed) {
      const a = s.point!, d = (a[0] - p[0]) ** 2 + (a[1] - p[1]) ** 2 + (a[2] - p[2]) ** 2;
      if (d < least) {
        least = d;
        best = s;
      }
    }
    return best.value;
  };
  const piece = stations.length > 1 ? (stations[1].position - stations[0].position) / 2 : Infinity;
  const out: Array<{ point: Vec3; value: number | null }> = [];
  points.forEach((a, i) => {
    out.push({ point: a, value: value(a) });
    if (i === points.length - 1 && !closed) return;
    const b = points[(i + 1) % points.length];
    const k = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / piece);
    for (let j = 1; j < k; j++) {
      const p: Vec3 = [a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k, a[2] + ((b[2] - a[2]) * j) / k];
      out.push({ point: p, value: value(p) });
    }
  });
  return out;
}

/**
 * The reference curve: the curve at equal spacing, then a moving average of `window` length, as
 * many points on each side (a closed curve goes round, an open one takes fewer near its ends, which stay).
 */
export function referenceCurve(points: readonly Vec3[], closed: boolean, spacing: number, window: number): Vec3[] {
  const pts = resampleCurve([...points], closed, spacing);
  const n = pts.length;
  const half = Math.max(0, Math.round((window / spacing - 1) / 2));
  return pts.map((_, i) => {
    const h = closed ? Math.min(half, Math.floor((n - 1) / 2)) : Math.min(half, i, n - 1 - i);
    const m: Vec3 = [0, 0, 0];
    for (let k = -h; k <= h; k++) {
      const q = pts[closed ? (i + k + n) % n : i + k];
      m[0] += q[0];
      m[1] += q[1];
      m[2] += q[2];
    }
    return [m[0] / (2 * h + 1), m[1] / (2 * h + 1), m[2] / (2 * h + 1)];
  });
}

/** The reference curve of the edge angles for a curve, at the spacing and window they use. `mm`: millimetres per coordinate unit. */
export const referenceOf = (curve: readonly Vec3[], closed: boolean, mm: number): Vec3[] => referenceCurve(curve, closed, REFERENCE_SPACING_MM / mm, SMOOTH_WINDOW_MM / mm);

/** Where the plane through `at` with normal `n` crosses the curve, nearest `at`; null when it does not. */
function curveCrossing(points: readonly Vec3[], closed: boolean, at: Vec3, n: Vec3): Vec3 | null {
  const dist = (p: Vec3) => (p[0] - at[0]) * n[0] + (p[1] - at[1]) * n[1] + (p[2] - at[2]) * n[2];
  let best: Vec3 | null = null, bd = Infinity;
  const count = points.length + (closed ? 1 : 0);
  let da = dist(points[0]);
  for (let i = 1; i < count; i++) {
    const a = points[i - 1], b = points[i % points.length];
    const db = dist(b);
    if ((da <= 0 && db >= 0) || (da >= 0 && db <= 0)) {
      const s = da === db ? 0 : da / (da - db);
      const q: Vec3 = [a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1]), a[2] + s * (b[2] - a[2])];
      const d = Math.hypot(q[0] - at[0], q[1] - at[1], q[2] - at[2]);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    da = db;
  }
  return best;
}

/** The point of the section lines nearest `p`: which line, which stretch, and the point. */
export function nearestOnLines(lines: readonly SectionLine[], p: Vec3): { line: SectionLine; seg: number; point: Vec3; distance: number } | null {
  let out: { line: SectionLine; seg: number; point: Vec3; distance: number } | null = null;
  for (const line of lines) {
    const n = line.points.length;
    for (let i = 0; i < n - (line.closed ? 0 : 1); i++) {
      const a = line.points[i], b = line.points[(i + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const l2 = dx * dx + dy * dy + dz * dz;
      const s = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / l2)) : 0;
      const q: Vec3 = [a[0] + s * dx, a[1] + s * dy, a[2] + s * dz];
      const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      if (!out || d < out.distance) out = { line, seg: i, point: q, distance: d };
    }
  }
  return out;
}

/** The two ways along a section line from a point on it, each as a polyline starting there. */
function twoWays(line: SectionLine, seg: number, at: Vec3): [Vec3[], Vec3[]] {
  const pts = line.points, n = pts.length;
  const forward: Vec3[] = [at], back: Vec3[] = [at];
  if (line.closed) {
    for (let k = 1; k <= n; k++) forward.push(pts[(seg + k) % n]);
    for (let k = 0; k < n; k++) back.push(pts[(seg - k + n) % n]);
  } else {
    for (let i = seg + 1; i < n; i++) forward.push(pts[i]);
    for (let i = seg; i >= 0; i--) back.push(pts[i]);
  }
  return [forward, back];
}

const away = (from: Vec3, to: Vec3): Vec3 => [to[0] - from[0], to[1] - from[1], to[2] - from[2]];

/** The angles at A on its section line, for each distance: three points, and two lines (chords of length `chord` at the two points, pointing away from A). */
function anglesAt(line: SectionLine, seg: number, A: Vec3, distances: readonly number[], chord: number): { three: Array<number | null>; two: Array<number | null> } {
  const [one, other] = twoWays(line, seg, A);
  const c1 = arcLengths(one, false), c2 = arcLengths(other, false);
  const l1 = c1[c1.length - 1], l2 = c2[c2.length - 1];
  // round a closed line, the two ways must not meet
  const whole = line.closed ? l1 : Infinity;
  const three: Array<number | null> = [], two: Array<number | null> = [];
  const half = chord / 2;
  for (const d of distances) {
    if (d > l1 || d > l2 || 2 * d > whole) {
      three.push(null);
      two.push(null);
      continue;
    }
    three.push(angleDeg(away(A, pointAtArc(one, false, c1, d)), away(A, pointAtArc(other, false, c2, d))));
    const fits = d + half <= l1 && d + half <= l2 && 2 * (d + half) <= whole;
    two.push(fits ? angleDeg(away(pointAtArc(one, false, c1, d - half), pointAtArc(one, false, c1, d + half)), away(pointAtArc(other, false, c2, d - half), pointAtArc(other, false, c2, d + half))) : null);
  }
  return { three, two };
}

/** A station of a curve: its section's plane, and where that crosses the curve (null where it cannot be told). */
export interface StationPlane {
  position: number;
  reference: Vec3;
  normal: Vec3 | null;
  crossing: Vec3 | null;
}

/** Where the stations of a curve lie; null for a curve too short for one. `mm`: millimetres per coordinate unit. */
export function stationPlan(curve: readonly Vec3[], closed: boolean, mm: number): { length: number; count: number; at: (k: number) => StationPlane } | null {
  const reference = referenceOf(curve, closed, mm);
  if (reference.length < 2) return null;
  const step = EDGE_ANGLE_STEP_MM / mm;
  const cum = arcLengths(reference, closed);
  const length = cum[cum.length - 1];
  const count = closed ? Math.ceil(length / step - 1e-9) : Math.floor(length / step + 1e-9) + 1;
  const on = (s: number) => pointAtArc(reference, closed, cum, s);
  const at = (k: number): StationPlane => {
    const position = k * step;
    const ref = on(position);
    const t = away(on(position - step), on(position + step));
    const tl = Math.hypot(t[0], t[1], t[2]);
    if (!(tl > 0)) return { position, reference: ref, normal: null, crossing: null };
    const normal: Vec3 = [t[0] / tl, t[1] / tl, t[2] / tl];
    return { position, reference: ref, normal, crossing: curveCrossing(curve, closed, ref, normal) };
  };
  return { length, count, at };
}

export interface EdgeAngleInput {
  /** Positions relative to `offset`; the curve is in original coordinates. */
  positions: ArrayLike<number>;
  index: ArrayLike<number>;
  offset?: Vec3;
  points: readonly Vec3[];
  closed: boolean;
  /** The coordinate unit: without one nothing is measured. */
  unit: string;
  meanEdge: number;
  candidates?: PlaneCandidates | null;
}

/** The edge angles along a curve; null without a stated unit, or for a curve too short for a station. */
export function* edgeAnglesSteps(input: EdgeAngleInput): Steps<EdgeAngleResult | null> {
  const mm = mmPerUnit(input.unit);
  if (mm === null || input.points.length < 2) return null;
  const o: Vec3 = input.offset ?? [0, 0, 0];
  const curve = input.points.map((p): Vec3 => [p[0] - o[0], p[1] - o[1], p[2] - o[2]]);
  const plan = stationPlan(curve, input.closed, mm);
  if (!plan) return null;
  const distances = EDGE_ANGLE_DISTANCES_MM.map((d) => d / mm);
  const reach = SECTION_REACH * Math.max(...distances);
  const chord = TWO_LINES_LENGTH_MM / mm;
  const stations: EdgeAngleStation[] = [];
  for (let k = 0; k < plan.count; k++) {
    yield;
    const s = plan.at(k);
    const position = s.position;
    const empty: EdgeAngleStation = { position, point: null, three_points: distances.map(() => null), two_lines: distances.map(() => null) };
    if (!s.normal || !s.crossing) {
      stations.push(empty);
      continue;
    }
    const lines = sectionByPlane(input.positions, input.index, s.reference, s.normal, input.candidates ?? null, { center: s.reference, radius: reach });
    const near = nearestOnLines(lines, s.crossing);
    if (!near || near.distance > LINE_REACH_EDGES * input.meanEdge) {
      stations.push(empty);
      continue;
    }
    const { three, two } = anglesAt(near.line, near.seg, near.point, distances, chord);
    stations.push({ position, point: [near.point[0] + o[0], near.point[1] + o[1], near.point[2] + o[2]], three_points: three, two_lines: two });
  }
  return { distances, length: plan.length, stations };
}

export const edgeAngles = (input: EdgeAngleInput): EdgeAngleResult | null => runSync(edgeAnglesSteps(input));

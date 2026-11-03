import { mmPerUnit } from '../core/format';
import type { SharpEdgeRule } from '../core/types';
import { EDGE_ANGLE_DISTANCES_MM, type EdgeAngleResult } from './edgeAngle';

/**
 * The sharp part of an edge: the stations whose angle, in one series (method and distance), is at most a
 * threshold the user sets. The threshold is the user's; this only makes the definition explicit.
 */

/** A stretch this long or shorter between two sharp ones counts as sharp. */
export const SHARP_MERGE_GAP_MM = 2;
/** A sharp stretch shorter than this does not count. */
export const SHARP_MIN_RUN_MM = 3;
/** The suggested threshold: histogram of the angles, in steps of this. */
export const SHARP_AUTO_BIN_DEG = 5;
/** The suggested threshold: the two groups' means at least this far apart. */
export const SHARP_AUTO_MIN_GAP_DEG = 10;
/** The suggested threshold: the valley between the two peaks at most this fraction of the lower peak. */
export const SHARP_AUTO_MAX_VALLEY = 0.5;

/** The parameters of the sharp edge, as stored with the results and in the manifest. */
export const SHARP_EDGE_PARAMETERS = { SHARP_MERGE_GAP_MM, SHARP_MIN_RUN_MM, SHARP_AUTO_BIN_DEG, SHARP_AUTO_MIN_GAP_DEG, SHARP_AUTO_MAX_VALLEY };

/** One sharp stretch of a curve, by positions along its reference curve (round a closed curve, `start` may lie after `end`). */
export interface SharpSegment {
  start: number;
  end: number;
  length: number;
}

export interface SharpResult {
  /** Whether each station counts as sharp. */
  mask: boolean[];
  segments: SharpSegment[];
  /** The segments' total length. */
  length: number;
}

/** The angles of the rule's series along a curve (null where a station has none). */
export function ruleValues(result: EdgeAngleResult, rule: SharpEdgeRule): Array<number | null> {
  const i = EDGE_ANGLE_DISTANCES_MM.indexOf(rule.distance as (typeof EDGE_ANGLE_DISTANCES_MM)[number]);
  return i < 0 ? result.stations.map(() => null) : result.stations.map((s) => s[rule.method][i]);
}

/** The runs of true in a mask, each [first, count]; round a closed curve a run may go on past the end. */
function runsOf(mask: readonly boolean[], closed: boolean): Array<[number, number]> {
  const n = mask.length;
  const runs: Array<[number, number]> = [];
  // a closed curve is read from a station outside any run
  const from = closed ? mask.indexOf(false) : 0;
  if (from < 0) return n ? [[0, n]] : [];
  let start = -1;
  for (let k = 0; k <= n; k++) {
    const on = k < n && mask[(from + k) % n];
    if (on && start < 0) start = k;
    if (!on && start >= 0) {
      runs.push([(from + start) % n, k - start]);
      start = -1;
    }
  }
  return runs;
}

/**
 * The sharp stretches of a curve at a threshold: first the short gaps are filled, then the short runs dropped.
 * `step`: from station to station; `length`: of the reference curve; lengths in the coordinate unit.
 */
export function sharpSegments(values: ReadonlyArray<number | null>, positions: readonly number[], closed: boolean, length: number, threshold: number, unit: string): SharpResult {
  const n = values.length;
  const mm = mmPerUnit(unit) ?? 1;
  const step = n > 1 ? positions[1] - positions[0] : 0;
  const raw = values.map((v) => v !== null && v <= threshold);
  const mask = [...raw];
  if (step > 0 && raw.some(Boolean)) {
    const gaps = runsOf(raw.map((on) => !on), closed);
    for (const [first, count] of gaps) {
      // the two ends of an open curve lie between nothing
      if (!closed && (first === 0 || first + count === n)) continue;
      if (count * step * mm <= SHARP_MERGE_GAP_MM + 1e-9) for (let k = 0; k < count; k++) mask[(first + k) % n] = true;
    }
  }
  const segments: SharpSegment[] = [];
  for (const [first, count] of runsOf(mask, closed)) {
    const last = (first + count - 1) % n;
    const whole = closed && count === n;
    const span = whole ? length : first + count > n ? length - positions[first] + positions[last] : positions[last] - positions[first];
    if (span * mm + 1e-9 < SHARP_MIN_RUN_MM) {
      for (let k = 0; k < count; k++) mask[(first + k) % n] = false;
      continue;
    }
    segments.push({ start: whole ? 0 : positions[first], end: whole ? length : positions[last], length: span });
  }
  segments.sort((a, b) => a.start - b.start);
  return { mask, segments, length: segments.reduce((s, x) => s + x.length, 0) };
}

/** The curve's sharp stretches under a rule; null without a threshold or a station. */
export function sharpOfCurve(result: EdgeAngleResult, closed: boolean, rule: SharpEdgeRule, unit: string): SharpResult | null {
  if (rule.threshold === null || !result.stations.length) return null;
  return sharpSegments(ruleValues(result, rule), result.stations.map((s) => s.position), closed, result.length, rule.threshold, unit);
}

/**
 * A threshold suggested by the angles themselves: Otsu's split into two groups (the largest variance between
 * them), when they are two: their means far enough apart and a valley between the peaks of their histogram.
 * Null when they are not: the angles are not of two kinds, and a split would be arbitrary.
 */
export function suggestThreshold(values: readonly number[]): number | null {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  if (n < 4) return null;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + v[i];
  let best = -1, cut = -1;
  for (let k = 1; k < n; k++) {
    if (v[k] === v[k - 1]) continue;
    const a = prefix[k] / k, b = (prefix[n] - prefix[k]) / (n - k);
    const between = k * (n - k) * (a - b) ** 2;
    if (between > best) {
      best = between;
      cut = k;
    }
  }
  if (cut < 0) return null;
  const lower = prefix[cut] / cut, upper = (prefix[n] - prefix[cut]) / (n - cut);
  if (upper - lower < SHARP_AUTO_MIN_GAP_DEG) return null;
  const threshold = (v[cut - 1] + v[cut]) / 2;
  // the histogram: a peak on each side, and how low it goes between them
  const origin = Math.floor(v[0] / SHARP_AUTO_BIN_DEG);
  const bins = new Array<number>(Math.floor(v[n - 1] / SHARP_AUTO_BIN_DEG) - origin + 1).fill(0);
  for (const a of v) bins[Math.floor(a / SHARP_AUTO_BIN_DEG) - origin]++;
  const split = Math.floor(threshold / SHARP_AUTO_BIN_DEG) - origin;
  const peakAt = (from: number, to: number) => {
    let at = from;
    for (let i = from; i <= to; i++) if (bins[i] > bins[at]) at = i;
    return at;
  };
  const low = peakAt(0, split), high = peakAt(Math.min(split + 1, bins.length - 1), bins.length - 1);
  let valley = Infinity;
  for (let i = low; i <= high; i++) valley = Math.min(valley, bins[i]);
  return valley <= SHARP_AUTO_MAX_VALLEY * Math.min(bins[low], bins[high]) ? threshold : null;
}

import { PLATFORM_OUTLINE, type SpecimenType } from '../core/fields';
import { mmPerUnit } from '../core/format';
import type { Curve, Vec3 } from '../core/types';

/**
 * What a flake's edge is measured along. The edge is where the dorsal and ventral faces meet, so a stretch of the curve
 * that runs along the platform outline is no part of it, whichever way the curve was drawn: closed round the whole flake,
 * or on past the platform's ends. Only the measuring goes by this: the curve keeps its points, and the regions its cut.
 */

/** A point of the edge this near the platform outline lies along it. */
export const EDGE_RIM_REACH_MM = 1;
/** Along it for at least this long, it runs along it: less is only meeting it. */
export const EDGE_RIM_MIN_MM = 2;

/** The parameters of the line measured, as stored with the results and in the manifest. */
export const MEASURED_LINE_PARAMETERS = { EDGE_RIM_REACH_MM, EDGE_RIM_MIN_MM };

export interface MeasuredLine {
  points: readonly Vec3[];
  closed: boolean;
}

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function toSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const len2 = ux * ux + uy * uy + uz * uz;
  const k = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ux + (p[1] - a[1]) * uy + (p[2] - a[2]) * uz) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - k * ux, p[1] - a[1] - k * uy, p[2] - a[2] - k * uz);
}

/** How far each point lies from a closed line; beyond `reach` of its box, Infinity (the box leaves most points out at once). */
function distancesToLoop(points: readonly Vec3[], loop: readonly Vec3[], reach: number): Float64Array {
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const q of loop)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], q[k] - reach);
      hi[k] = Math.max(hi[k], q[k] + reach);
    }
  const out = new Float64Array(points.length).fill(Infinity);
  points.forEach((p, i) => {
    if (p[0] < lo[0] || p[0] > hi[0] || p[1] < lo[1] || p[1] > hi[1] || p[2] < lo[2] || p[2] > hi[2]) return;
    let least = Infinity;
    for (let j = 0; j < loop.length; j++) least = Math.min(least, toSegment(p, loop[j], loop[(j + 1) % loop.length]));
    out[i] = least;
  });
  return out;
}

/**
 * The longest stretch of a line off a closed outline: a run of points within `reach` of the outline and at least `least` long
 * is taken out, what is left is open; each of its ends goes on to where it comes nearest the outline, so a line that merely
 * reaches the outline, or leaves it at a corner, keeps all it has up to there. The line itself where nothing runs along the outline.
 */
export function lineOffOutline(line: MeasuredLine, outline: readonly Vec3[], reach: number, least: number): MeasuredLine {
  const pts = line.points, n = pts.length;
  if (n < 2 || outline.length < 2) return line;
  const d = distancesToLoop(pts, outline, reach);
  const near = (i: number) => d[i] <= reach;
  // a closed line is read from a point off the outline
  let origin = 0;
  if (line.closed) {
    origin = d.findIndex((v) => v > reach);
    if (origin < 0) return line;
  }
  const at = (t: number) => (origin + t) % n;
  const gap = (t: number) => dist(pts[at(t)], pts[at(t + 1)]);
  const arc = (from: number, to: number) => {
    let s = 0;
    for (let t = from; t < to; t++) s += gap(t);
    return s;
  };
  const runs: Array<[number, number]> = [];
  for (let t = 0; t < n; t++) {
    if (!near(at(t))) continue;
    let end = t;
    while (end + 1 < n && near(at(end + 1))) end++;
    if (arc(t, end) >= least) runs.push([t, end]);
    t = end;
  }
  if (!runs.length) return line;
  // what lies between the runs, each with the run before and after it to go on into
  const between: Array<{ from: number; to: number; before: number | null; after: number | null }> = [];
  runs.forEach((r, k) => {
    const next = runs[k + 1];
    if (next) between.push({ from: r[1] + 1, to: next[0] - 1, before: r[0], after: next[1] });
    else if (line.closed) between.push({ from: r[1] + 1, to: runs[0][0] + n - 1, before: r[0], after: runs[0][1] + n });
    else between.push({ from: r[1] + 1, to: n - 1, before: r[0], after: null });
  });
  if (!line.closed) between.unshift({ from: 0, to: runs[0][0] - 1, before: null, after: runs[0][1] });
  let best: (typeof between)[number] | null = null, longest = -1;
  for (const s of between) {
    if (s.to <= s.from) continue;
    const length = arc(s.from, s.to);
    if (length > longest) {
      longest = length;
      best = s;
    }
  }
  if (!best) return line;
  let { from, to } = best;
  if (best.before !== null) while (from - 1 >= best.before && d[at(from - 1)] < d[at(from)]) from--;
  if (best.after !== null) while (to + 1 <= best.after && d[at(to + 1)] < d[at(to)]) to++;
  if (!line.closed && from === 0 && to === n - 1) return line;
  const points: Vec3[] = [];
  for (let t = from; t <= to; t++) points.push(pts[at(t)]);
  return { points, closed: false };
}

type CurveOf = Pick<Curve, 'points' | 'closed' | 'attributes'>;

const known = new WeakMap<readonly Vec3[], { outline: readonly Vec3[]; mm: number; closed: boolean; line: MeasuredLine }>();

/**
 * The line a curve is measured along: on a flake with a closed platform outline, an edge without what runs along the outline
 * (see above); any other curve as it is. Without a stated unit nothing is measured, and nothing is cut. Curves change by being replaced, so each is worked out once.
 */
export function measuredLine(c: CurveOf, state: { specimen: { type: SpecimenType; unit: string }; curves: readonly CurveOf[] }): MeasuredLine {
  const raw: MeasuredLine = { points: c.points, closed: c.closed };
  if (state.specimen.type !== 'flake' || c.attributes.type !== 'edge') return raw;
  const mm = mmPerUnit(state.specimen.unit);
  const outline = state.curves.find((x) => x.attributes.type === PLATFORM_OUTLINE && x.closed)?.points;
  if (mm === null || !outline) return raw;
  const had = known.get(c.points);
  if (had && had.outline === outline && had.mm === mm && had.closed === c.closed) return had.line;
  const line = lineOffOutline(raw, outline, EDGE_RIM_REACH_MM / mm, EDGE_RIM_MIN_MM / mm);
  known.set(c.points, { outline, mm, closed: c.closed, line });
  return line;
}

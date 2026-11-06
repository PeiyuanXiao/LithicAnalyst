import { mmPerUnit } from '../core/format';
import type { Curve, Vec3, WorkingEdge } from '../core/types';
import type { SpecimenType } from '../core/fields';
import { EDGE_ANGLE_STEP_MM, referenceOf } from './edgeAngle';
import { measuredLine } from './measuredLine';
import { arcLengths, nearestArc, pointAtArc } from './landmarks';
import type { RetouchStation } from './retouchAngle';
import { chordDepth, ERP_MAX_FILLED_SHARE, onPlan, RETOUCH_MERGE_GAP_MM, type LongestStretch, type RetouchEmptyReason, type RetouchIndexResult, type RetouchStationRow } from './retouchIndex';
import { runsOf, withGapsFilled, type SharpSegment } from './sharpEdge';

/**
 * Working edges: stretches of a curve that are measured on their own. The curve keeps its stations; a stretch only says
 * which of them are its own and how much of each. Positions are along the curve's reference line (that of the edge angles),
 * or, with no unit stated and so no stations, along the curve itself.
 */

/** A working edge is at least this long. */
export const WORKING_EDGE_MIN_MM = 2;

/** The parameters of the working edges, as stored with the results and in the manifest. */
export const WORKING_EDGE_PARAMETERS = { WORKING_EDGE_MIN_MM };

type CurveLine = { points: readonly Vec3[]; closed: boolean };

/** The line positions along a curve are measured on. */
export interface EdgeAxis {
  points: Vec3[];
  cum: number[];
  length: number;
  closed: boolean;
  /** Millimetres per coordinate unit; null: no unit stated. */
  mm: number | null;
}

export function edgeAxis(curve: CurveLine, unit: string): EdgeAxis {
  const mm = mmPerUnit(unit);
  const reference = mm === null ? [] : referenceOf(curve.points, curve.closed, mm);
  const points = reference.length >= 2 ? reference : [...curve.points];
  const cum = arcLengths(points, curve.closed);
  return { points, cum, length: cum[cum.length - 1] ?? 0, closed: curve.closed, mm };
}

/** Where a point is along the line. */
export function positionOn(axis: EdgeAxis, p: Vec3): number {
  const at = nearestArc(axis.points, axis.closed, axis.cum, p);
  // the closing stretch ends where the line begins
  return axis.closed && at >= axis.length ? 0 : at;
}

/** The point of a curve nearest to a point. */
export function pointOnCurve(curve: CurveLine, p: Vec3): Vec3 {
  const cum = arcLengths(curve.points, curve.closed);
  return pointAtArc(curve.points, curve.closed, cum, nearestArc(curve.points, curve.closed, cum, p));
}

/** Along a line: `from` to `to`; round a closed one it may run on past the line's start (`to` < `from`). */
export interface EdgeRange {
  from: number;
  to: number;
  length: number;
}

export function rangeOf(axis: EdgeAxis, start: Vec3, end: Vec3): EdgeRange {
  const a = positionOn(axis, start), b = positionOn(axis, end);
  if (axis.closed) return { from: a, to: b, length: b >= a ? b - a : axis.length - a + b };
  return { from: Math.min(a, b), to: Math.max(a, b), length: Math.abs(b - a) };
}

/** A range as stretches of the line that do not run past its start. */
const piecesOf = (r: Pick<EdgeRange, 'from' | 'to'>, length: number): Array<[number, number]> => (r.to >= r.from ? [[r.from, r.to]] : [[r.from, length], [0, r.to]]);

const overlapLength = (a: ReadonlyArray<[number, number]>, b: ReadonlyArray<[number, number]>): number => {
  let sum = 0;
  for (const p of a) for (const q of b) sum += Math.max(0, Math.min(p[1], q[1]) - Math.max(p[0], q[0]));
  return sum;
};

/** Whether a position lies in a range: its end not counted. */
const within = (r: EdgeRange, p: number): boolean => (r.to >= r.from ? p >= r.from && p < r.to : p >= r.from || p < r.to);

/** A working edge on its line. */
export interface PlacedEdge {
  edge: WorkingEdge;
  range: EdgeRange;
  /** The stored point at each end of the range. */
  fromPoint: Vec3;
  toPoint: Vec3;
}

/** These edges of the curve on its line, in the order given. */
export function placedEdges(axis: EdgeAxis, edges: readonly WorkingEdge[]): PlacedEdge[] {
  return edges.map((edge): PlacedEdge => {
    const range = rangeOf(axis, edge.start, edge.end);
    const swapped = !axis.closed && positionOn(axis, edge.start) > positionOn(axis, edge.end);
    return { edge, range, fromPoint: swapped ? edge.end : edge.start, toPoint: swapped ? edge.start : edge.end };
  });
}

/** What is wrong with a stretch of a curve as a working edge. */
export type WorkingEdgeRefusal = { reason: 'not_measured' } | { reason: 'short' } | { reason: 'overlap'; with: string };

/** Two stretches may share an end; further than this they overlap. */
const OVERLAP_SHARE = 1e-6;

/** Why this stretch cannot be a working edge beside `others` on the same curve; null: it can. */
export function refusalOf(axis: EdgeAxis, start: Vec3, end: Vec3, others: readonly WorkingEdge[]): WorkingEdgeRefusal | null {
  const r = rangeOf(axis, start, end);
  if (!(r.length > 0) || (axis.mm !== null && r.length * axis.mm < WORKING_EDGE_MIN_MM - 1e-9)) return { reason: 'short' };
  const mine = piecesOf(r, axis.length);
  const tiny = OVERLAP_SHARE * axis.length;
  for (const o of others) if (overlapLength(mine, piecesOf(rangeOf(axis, o.start, o.end), axis.length)) > tiny) return { reason: 'overlap', with: o.label };
  return null;
}

/**
 * Where an end of a working edge can go on the way to `target`: not past the next edge's end (it stops on that very
 * point, so the two share it), nor closer than the shortest length to its own other end.
 */
export function clampedEnd(curve: CurveLine, axis: EdgeAxis, edge: WorkingEdge, which: 'start' | 'end', others: readonly WorkingEdge[], target: Vec3): Vec3 {
  const L = axis.length;
  // a little over the shortest, so that the point it stands for on the curve still counts
  const least = axis.mm !== null ? (WORKING_EDGE_MIN_MM * 1.001) / axis.mm : 1e-6 * L;
  const t = positionOn(axis, target);
  const placed = placedEdges(axis, others);
  const at = (s: number): Vec3 => pointOnCurve(curve, pointAtArc(axis.points, axis.closed, axis.cum, s));
  if (!axis.closed) {
    const fixed = positionOn(axis, which === 'start' ? edge.end : edge.start);
    const moving = positionOn(axis, edge[which]);
    if (moving >= fixed) {
      const next = placed.filter((o) => o.range.from >= moving - 1e-9).sort((a, b) => a.range.from - b.range.from)[0];
      if (next && t >= next.range.from) return next.fromPoint;
      return t < fixed + least ? at(fixed + least) : pointOnCurve(curve, target);
    }
    const prior = placed.filter((o) => o.range.to <= moving + 1e-9).sort((a, b) => b.range.to - a.range.to)[0];
    if (prior && t <= prior.range.to) return prior.toPoint;
    return t > fixed - least ? at(fixed - least) : pointOnCurve(curve, target);
  }
  const ring = (x: number) => ((x % L) + L) % L;
  const fixed = positionOn(axis, which === 'end' ? edge.start : edge.end);
  // how far from the fixed end, in the direction the edge lies
  const away = (p: number) => ring(which === 'end' ? p - fixed : fixed - p);
  let room = L - least;
  let stop: Vec3 | null = null;
  for (const o of placed) {
    const d = away(which === 'end' ? o.range.from : o.range.to);
    if (d <= room) {
      room = d;
      stop = which === 'end' ? o.fromPoint : o.toPoint;
    }
  }
  const u = away(t);
  if (u >= least && u <= room) return pointOnCurve(curve, target);
  // beyond either limit: the nearer one, round the ring
  const toRoom = u > room ? u - room : u + L - room;
  const toLeast = u < least ? least - u : L - u + least;
  if (toRoom <= toLeast) return stop ?? at(fixed + (which === 'end' ? room : -room));
  return at(fixed + (which === 'end' ? least : -least));
}

/** The way along a curve from one point to another: round a closed one in its direction, on an open one in either order. */
export function curveStretch(curve: CurveLine, start: Vec3, end: Vec3): Vec3[] {
  const { points, closed } = curve;
  const cum = arcLengths(points, closed);
  let a = nearestArc(points, closed, cum, start), b = nearestArc(points, closed, cum, end);
  if (!closed && a > b) [a, b] = [b, a];
  const out: Vec3[] = [pointAtArc(points, closed, cum, a)];
  const inside = (s: number) => (closed && b < a ? s > a || s < b : s > a && s < b);
  const n = points.length;
  // from the first point past a, on along the line
  let k = 0;
  while (k < n && cum[k] <= a) k++;
  for (let i = 0; i < n; i++) {
    const j = (k + i) % n;
    if (!closed && k + i >= n) break;
    if (!inside(cum[j])) break;
    out.push(points[j]);
  }
  out.push(pointAtArc(points, closed, cum, b));
  return out;
}

// ---------------------------------------------------------------- stations

/** What a curve's stations stand for: each one's stretch of the line, cut where it meets the line's ends. */
function cellsOf(positions: readonly number[], closed: boolean, length: number): Array<Array<[number, number]>> {
  const n = positions.length;
  if (!n) return [];
  const step = n > 1 ? positions[1] - positions[0] : length;
  if (closed) {
    // round a closed line the last gap may be shorter: its two stations meet in its middle
    const gap = length - (n - 1) * step;
    if (n === 1) return [[[0, length]]];
    return positions.map((p, k): Array<[number, number]> => {
      if (k === 0) return [[length - gap / 2, length], [0, p + step / 2]];
      if (k === n - 1) return [[p - step / 2, p + gap / 2]];
      return [[p - step / 2, p + step / 2]];
    });
  }
  return positions.map((p): Array<[number, number]> => [[Math.max(0, p - step / 2), Math.min(length, p + step / 2)]]);
}

const cellLength = (c: ReadonlyArray<[number, number]>) => c.reduce((s, x) => s + x[1] - x[0], 0);

/** A station's weight as the retouch indices have it: the two ends of an open curve take half. */
const stationWeight = (k: number, n: number, closed: boolean, step: number): number => (closed || (k > 0 && k < n - 1) ? step : step / 2);

/**
 * How much of each station's weight falls in a stretch of the line: by the share of its cell that lies there. Stretches
 * that part the whole line share out each weight exactly, so what is summed over them is what the whole line has.
 */
export function stationWeights(positions: readonly number[], closed: boolean, length: number, step: number, range: Pick<EdgeRange, 'from' | 'to'>): Float64Array {
  const cells = cellsOf(positions, closed, length);
  const pieces = piecesOf(range, length);
  const n = positions.length;
  return Float64Array.from(cells, (c, k) => {
    const whole = cellLength(c);
    return whole > 0 ? (stationWeight(k, n, closed, step) * overlapLength(c, pieces)) / whole : 0;
  });
}

const TOLERANCE = 1e-6;

/** The edge a position belongs to (index, −1: none): where one ends and another begins, the one that begins; alone, the one that ends there. */
export function ownerAt(placed: readonly PlacedEdge[], position: number, length: number): number {
  const i = placed.findIndex((e) => within(e.range, position));
  if (i >= 0) return i;
  const tiny = TOLERANCE * Math.max(1, length);
  return placed.findIndex((e) => Math.abs(e.range.to - position) <= tiny || (length > 0 && Math.abs(Math.abs(e.range.to - position) - length) <= tiny));
}

/** The stations a stretch takes in, both ends included, in order along it. */
function stationsIn(positions: readonly number[], closed: boolean, length: number, range: EdgeRange): number[] {
  const tiny = TOLERANCE * Math.max(1, length);
  const inside = (p: number) => (range.to >= range.from ? p >= range.from - tiny && p <= range.to + tiny : p >= range.from - tiny || p <= range.to + tiny);
  const on = positions.flatMap((p, k) => (inside(p) ? [k] : []));
  if (!closed || range.to >= range.from) return on;
  // from the part past `from`, on over the line's start
  return [...on.filter((k) => positions[k] >= range.from - tiny), ...on.filter((k) => positions[k] < range.from - tiny)];
}

/** A curve's labels by station position, for what is written per station: empty outside its edges, and on a curve without any. */
export function edgeLabeller(curve: CurveLine, edges: readonly WorkingEdge[], unit: string): (position: number) => string {
  if (!edges.length) return () => '';
  const axis = edgeAxis(curve, unit);
  const placed = placedEdges(axis, edges);
  return (position) => placed[ownerAt(placed, position, axis.length)]?.edge.label ?? '';
}

/** The state's labels by curve and station position (the curves whose edges are asked for are kept once made). */
export function edgeLabels(state: { curves: readonly Curve[]; workingEdges: readonly WorkingEdge[]; specimen: { unit: string; type: SpecimenType } }): (curveId: string, position: number) => string {
  const made = new Map<string, (position: number) => string>();
  return (curveId, position) => {
    let f = made.get(curveId);
    if (!f) {
      const c = state.curves.find((x) => x.id === curveId);
      f = c ? edgeLabeller(measuredLine(c, state), state.workingEdges.filter((e) => e.curveId === curveId), state.specimen.unit) : () => '';
      made.set(curveId, f);
    }
    return f(position);
  };
}

/** A sharp stretch, or the part of one in a working edge (`segment`: the stretch's number, from 1). */
export interface SharpPiece {
  segment: number;
  start: number;
  end: number;
  length: number;
  /** The working edge it lies in, by label; empty: none. */
  edge: string;
}

/** The sharp stretches of a curve, cut where a working edge begins or ends: the lengths still add up to the stretch's. */
export function sharpPieces(segments: readonly SharpSegment[], placed: readonly PlacedEdge[], length: number, closed: boolean): SharpPiece[] {
  const out: SharpPiece[] = [];
  const tiny = TOLERANCE * Math.max(1, length);
  segments.forEach((s, i) => {
    const from = s.start, upto = s.start + s.length;
    const cuts: number[] = [];
    for (const e of placed) {
      for (const at of [e.range.from, e.range.to]) {
        // round a closed line, the place again each time round
        for (const x of closed ? [at, at + length, at - length] : [at]) if (x > from + tiny && x < upto - tiny) cuts.push(x);
      }
    }
    const marks = [from, ...[...new Set(cuts)].sort((a, b) => a - b), upto];
    const wrap = (x: number) => (closed && length > 0 ? ((x % length) + length) % length : x);
    for (let k = 0; k + 1 < marks.length; k++) {
      const a = marks[k], b = marks[k + 1];
      if (b - a <= tiny) continue;
      const owner = placed[ownerAt(placed, wrap((a + b) / 2), length)];
      const end = wrap(b);
      out.push({ segment: i + 1, start: wrap(a), end: end === 0 && b > 0 ? length : end, length: b - a, edge: owner?.edge.label ?? '' });
    }
  });
  return out;
}

// ---------------------------------------------------------------- the edges' own measures

/** One curve measured. */
export interface EdgeCurve {
  id: string;
  points: readonly Vec3[];
  closed: boolean;
  /** Its stations (none without a stated unit). */
  stations: ReadonlyArray<{ position: number; point: Vec3 | null }>;
  /** Its sharp stretches; null: no threshold set. */
  sharp: readonly SharpSegment[] | null;
}

/** One row of working_edges.csv; an implied edge (the whole of a curve without any) has an empty label. */
export interface WorkingEdgeRow {
  /** Its id, or the curve's for an implied one. */
  id: string;
  label: string;
  name: string;
  curveId: string;
  start_position: number;
  end_position: number;
  length: number;
  sharp_length: number | null;
  retouched_length: number | null;
  retouch_perimeter: number | null;
  retouch_perimeter_dorsal: number | null;
  retouch_perimeter_ventral: number | null;
  removed_volume: number | null;
  erp: number | null;
  erp_filled_share: number | null;
  giur: number | null;
  giur_stations: number | null;
  edge_curvature: number | null;
  edge_curvature_chord: number | null;
  edge_curvature_depth: number | null;
}

/** The columns of a row that come from the retouch indices. */
export const EDGE_RETOUCH_KEYS = ['retouched_length', 'retouch_perimeter', 'retouch_perimeter_dorsal', 'retouch_perimeter_ventral', 'removed_volume', 'erp', 'erp_filled_share', 'giur', 'giur_stations', 'edge_curvature', 'edge_curvature_chord', 'edge_curvature_depth'] as const;
export type EdgeRetouchKey = (typeof EDGE_RETOUCH_KEYS)[number];

/** What an edge's row needs on the screen, and is not stored. */
export interface WorkingEdgeDetail {
  row: WorkingEdgeRow;
  /** Why each empty retouch value is empty. */
  reasons: Partial<Record<EdgeRetouchKey, RetouchEmptyReason>>;
  /** Its chord and depth on the plan. */
  chord: LongestStretch | null;
  /** Its stations' points on the plan, in order along it. */
  plan: Array<[number, number]>;
  /** Its station with the largest missing area, else its middle one (null: it has none). */
  focus: number | null;
}

export interface WorkingEdgeInput {
  curves: readonly EdgeCurve[];
  edges: readonly WorkingEdge[];
  unit: string;
  /** A flake's retouch indices; null: those columns stay empty. */
  retouch: RetouchIndexResult | null;
  /** Of the model; null when the mesh is not closed. */
  volume: number | null;
}

/** Every working edge of the curves measured, and the whole of each curve that has none. */
export function workingEdgeDetails(input: WorkingEdgeInput): WorkingEdgeDetail[] {
  const { curves, edges, unit, retouch, volume } = input;
  const mm = mmPerUnit(unit);
  const step = mm === null ? 0 : EDGE_ANGLE_STEP_MM / mm;
  const out: WorkingEdgeDetail[] = [];
  const frame = retouch?.indices.frame ?? null;
  const centre = retouch?.outline?.centre ?? null;
  for (const c of curves) {
    const axis = edgeAxis(c, unit);
    const L = axis.length;
    const own = placedEdges(axis, edges.filter((e) => e.curveId === c.id));
    const positions = c.stations.map((s) => s.position);
    const n = positions.length;
    const owners = positions.map((p) => ownerAt(own, p, L));
    const rowsAt = new Map<number, RetouchStationRow>();
    for (const r of retouch?.indices.stations ?? []) if (r.curveId === c.id) rowsAt.set(r.station, r);
    const pieces = c.sharp ? sharpPieces(c.sharp, own, L, c.closed) : null;
    const targets: Array<{ placed: PlacedEdge | null; range: EdgeRange; index: number }> = own.length ? own.map((p, index) => ({ placed: p, range: p.range, index })) : [{ placed: null, range: { from: 0, to: L, length: L }, index: -1 }];
    for (const target of targets) {
      const { placed, range } = target;
      const implied = !placed;
      const weights = implied ? Float64Array.from(positions, (_, k) => stationWeight(k, n, c.closed, step)) : stationWeights(positions, c.closed, L, step, range);
      const total = weights.reduce((a, b) => a + b, 0);
      const members = implied ? positions.map((_, k) => k) : positions.flatMap((_, k) => (owners[k] === target.index ? [k] : []));
      const span = implied ? members : stationsIn(positions, c.closed, L, range);
      const row: WorkingEdgeRow = {
        id: placed?.edge.id ?? c.id,
        label: placed?.edge.label ?? '',
        name: placed?.edge.name ?? '',
        curveId: c.id,
        start_position: range.from,
        end_position: range.to,
        length: n ? total : range.length,
        sharp_length: pieces ? pieces.filter((p) => (implied ? true : p.edge === placed!.edge.label)).reduce((s, p) => s + p.length, 0) : null,
        retouched_length: null,
        retouch_perimeter: null,
        retouch_perimeter_dorsal: null,
        retouch_perimeter_ventral: null,
        removed_volume: null,
        erp: null,
        erp_filled_share: null,
        giur: null,
        giur_stations: null,
        edge_curvature: null,
        edge_curvature_chord: null,
        edge_curvature_depth: null,
      };
      const reasons: WorkingEdgeDetail['reasons'] = {};
      const detail: WorkingEdgeDetail = { row, reasons, chord: null, plan: [], focus: null };
      out.push(detail);
      const placedPoints = span.flatMap((k) => (c.stations[k].point ? [c.stations[k].point!] : []));
      if (frame) detail.plan = placedPoints.map((p) => onPlan(frame, p));
      detail.focus = members.length ? members[Math.floor(members.length / 2)] : (span[Math.floor(span.length / 2)] ?? null);
      if (!retouch) continue;
      const empty = (reason: RetouchEmptyReason, keys: readonly EdgeRetouchKey[]) => {
        for (const k of keys) reasons[k] ??= reason;
      };
      if (mm === null) {
        empty('no_unit', EDGE_RETOUCH_KEYS);
        continue;
      }

      // the stretch's own retouched stations
      let retouched = 0, filled = 0, removed = 0, dorsal = 0, ventral = 0, told = false, knownFaces = false;
      let largest = -1, focus: number | null = null;
      const taken = new Set(span);
      for (let k = 0; k < n; k++) {
        const r = rowsAt.get(k);
        if (!r) continue;
        const weight = weights[k];
        if (weight > 0) {
          retouched += weight;
          if (r.filled) filled += weight;
          removed += weight * (r.removed_area ?? 0);
          if (r.depth_dorsal !== null) {
            told = true;
            knownFaces = true;
            if (r.depth_dorsal > 0) dorsal += weight;
            if ((r.depth_ventral ?? 0) > 0) ventral += weight;
          }
        }
        if (taken.has(k) && !r.filled && (r.removed_area ?? 0) > largest) {
          largest = r.removed_area ?? 0;
          focus = k;
        }
      }
      if (focus !== null) detail.focus = focus;

      // the missing volume, its share of the flake's, and how much of it is filled in
      const whole = retouch.indices;
      if (!retouched) {
        // nothing of it retouched: counts as not retouched
        row.erp_filled_share = 0;
        row.removed_volume = 0;
        if (volume === null) empty('mesh_open', ['erp']);
        else row.erp = 0;
      } else {
        row.erp_filled_share = filled / retouched;
        if (!knownFaces) empty('no_faces', ['removed_volume', 'erp']);
        else if (filled / retouched > ERP_MAX_FILLED_SHARE) empty('too_many_gaps', ['removed_volume', 'erp']);
        else {
          row.removed_volume = removed;
          if (volume === null) empty('mesh_open', ['erp']);
          else if (whole.removed_volume === null) empty(retouch.reasons.removed_volume ?? 'too_many_gaps', ['erp']);
          else row.erp = whole.removed_volume + volume > 0 ? removed / (whole.removed_volume + volume) : null;
        }
      }

      // GIUR over its own stations, the two ends of the stretch taken by whichever owns them
      let giurSum = 0, giurCount = 0;
      for (const k of members) {
        const v = rowsAt.get(k)?.giur ?? null;
        if (v === null) continue;
        giurSum += v;
        giurCount++;
      }
      row.giur_stations = giurCount;
      if (giurCount) row.giur = giurSum / giurCount;
      else if (!retouched) row.giur = 0;
      else if (!knownFaces) empty('no_faces', ['giur']);
      else empty('no_unifacial_station', ['giur']);

      // the perimeter
      row.retouched_length = retouched;
      if (!(total > 0)) empty('no_edge', ['retouch_perimeter', 'retouch_perimeter_dorsal', 'retouch_perimeter_ventral']);
      else {
        row.retouch_perimeter = retouched / total;
        if (retouched && !told) empty('no_faces', ['retouch_perimeter_dorsal', 'retouch_perimeter_ventral']);
        else {
          row.retouch_perimeter_dorsal = dorsal / total;
          row.retouch_perimeter_ventral = ventral / total;
        }
      }

      // the curvature of its own stations, retouched or not
      const CURVATURE = ['edge_curvature', 'edge_curvature_chord', 'edge_curvature_depth'] as const;
      if (implied && c.closed) empty('whole_edge', CURVATURE);
      else if (!frame || !centre) empty(retouch.frameReason ?? 'frame_failed', CURVATURE);
      else {
        const points = detail.plan;
        const { chord, depth, far } = chordDepth(points.length ? points : [[0, 0]], centre);
        if (chord > 0) {
          row.edge_curvature = depth / chord;
          row.edge_curvature_chord = chord;
          row.edge_curvature_depth = depth;
          const a = points[0], b = points[points.length - 1], p = points[far];
          const along = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (chord * chord);
          detail.chord = { curveId: c.id, a, b, far: p, foot: [a[0] + along * (b[0] - a[0]), a[1] + along * (b[1] - a[1])] };
        } else empty('section_misses_curve', CURVATURE);
      }
    }
  }
  return out;
}

/** The rows as they are stored: `derived.workingEdges`. */
export type WorkingEdgesDerived = { parameters: typeof WORKING_EDGE_PARAMETERS; edges: WorkingEdgeRow[] };

/** Where working edges would go along a curve that has none: its retouched stretches (`RETOUCH_MERGE_GAP_MM` or less between them is part of them). None for a stretch that goes all round. */
export function retouchRunEdges(curve: CurveLine, stations: readonly RetouchStation[], unit: string): Array<{ start: Vec3; end: Vec3 }> {
  const mm = mmPerUnit(unit);
  if (mm === null || !stations.length) return [];
  const n = stations.length;
  const raw = stations.map((s) => s.stretches.length > 0);
  const out: Array<{ start: Vec3; end: Vec3 }> = [];
  for (const [first, count] of runsOf(withGapsFilled(raw, curve.closed, EDGE_ANGLE_STEP_MM, RETOUCH_MERGE_GAP_MM), curve.closed)) {
    if (curve.closed && count === n) continue;
    const placed: Vec3[] = [];
    for (let i = 0; i < count; i++) {
      const p = stations[(first + i) % n].point;
      if (p) placed.push(p);
    }
    if (placed.length < 2) continue;
    out.push({ start: pointOnCurve(curve, placed[0]), end: pointOnCurve(curve, placed[placed.length - 1]) });
  }
  return out;
}

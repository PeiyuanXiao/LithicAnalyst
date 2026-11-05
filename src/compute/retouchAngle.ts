import { mmPerUnit } from '../core/format';
import type { Vec3 } from '../core/types';
import { LINE_REACH_EDGES, nearestOnLines, stationPlan, type EdgeAngleInput } from './edgeAngle';
import { angleDeg, TWO_LINES_LENGTH_MM } from './flake';
import { arcLengths, pointAtArc } from './landmarks';
import { sectionByPlane, type SectionLine } from './meshSection';
import { runSync, type Steps } from './steps';

/**
 * The angles of retouch layers along an edge. At the stations of the edge angles, the section is followed from the
 * edge across the retouch regions it meets, without leaving them; each layer ends where the next piece begins.
 * Region borders follow mesh edges, so these points are good to about one mesh edge.
 */

/** A stretch shorter than this many mean edge lengths is no layer: the line runs by a sliver of a piece where the borders do not quite meet it. */
export const SLIVER_EDGES = 2;

/** A piece of surface in a retouch layer. */
export interface RetouchPiece {
  region: string;
  layer: number;
}

/** One layer at one station, on one side of the edge. */
export interface RetouchStretch {
  /** The region where it begins (its id). */
  region: string;
  layer: number;
  /** From the edge to the layer's outer end, along the section. */
  distance: number;
  /** At the edge, to the layer's outer end and the same distance along the other side. */
  three_points: number | null;
  /** The chords at those two points, pointing away from the edge. */
  two_lines: number | null;
  /** This layer's own chord, from its inner to its outer end, against the other side's. */
  layer_face: number | null;
}

export interface RetouchStation {
  /** Along the reference curve from its start. */
  position: number;
  /** Where the edge is at this station, original coordinates (null: the section misses the curve). */
  point: Vec3 | null;
  stretches: RetouchStretch[];
}

export const RETOUCH_ANGLE_METHODS = ['three_points', 'two_lines', 'layer_face'] as const;
export type RetouchAngleMethod = (typeof RETOUCH_ANGLE_METHODS)[number];

export interface RetouchAngleResult {
  stations: RetouchStation[];
}

export interface RetouchAngleInput extends EdgeAngleInput {
  /** The piece of each triangle. */
  pieceOfFace: ArrayLike<number>;
  /** The pieces in a retouch layer. */
  pieces: ReadonlyMap<number, RetouchPiece>;
}

/** One way along a section line from a point on it: its polyline, each stretch's triangle, and the lengths along it. */
export interface RetouchWay {
  points: Vec3[];
  faces: number[];
  cum: number[];
  length: number;
}

/** A retouch layer along a way, from `from` to `to` along it. */
export interface RetouchRun {
  region: string;
  layer: number;
  from: number;
  to: number;
}

/** A station's section, kept in memory only (not in the file) for what is worked out along it; in the coordinates of the positions. */
export interface StationSection {
  /** The section plane's normal. */
  normal: Vec3;
  /** The edge on the section. */
  A: Vec3;
  ways: [RetouchWay, RetouchWay];
  /** The section is a closed line: the first way goes all round it. */
  closed: boolean;
  /** The layers along each way. */
  runs: [RetouchRun[], RetouchRun[]];
}

/** The layers along a curve, and the sections of its stations that have any (null: the others). */
export interface RetouchSections {
  result: RetouchAngleResult;
  sections: Array<StationSection | null>;
  /** Of the reference curve. */
  length: number;
}

function ways(line: SectionLine, seg: number, at: Vec3): [RetouchWay, RetouchWay] {
  const pts = line.points, fs = line.faces, n = pts.length;
  const fwd: Vec3[] = [at], bck: Vec3[] = [at];
  const ff: number[] = [], bf: number[] = [];
  if (line.closed) {
    for (let k = 1; k <= n; k++) {
      fwd.push(pts[(seg + k) % n]);
      ff.push(fs[(seg + k - 1) % n]);
    }
    for (let k = 0; k < n; k++) {
      bck.push(pts[(seg - k + n) % n]);
      bf.push(fs[(seg - k + n) % n]);
    }
  } else {
    for (let i = seg + 1; i < n; i++) {
      fwd.push(pts[i]);
      ff.push(fs[i - 1]);
    }
    for (let i = seg; i >= 0; i--) {
      bck.push(pts[i]);
      bf.push(fs[i]);
    }
  }
  const way = (points: Vec3[], faces: number[]): RetouchWay => {
    const cum = arcLengths(points, false);
    return { points, faces, cum, length: cum[cum.length - 1] };
  };
  return [way(fwd, ff), way(bck, bf)];
}

const along = (w: RetouchWay, d: number): Vec3 => pointAtArc(w.points, false, w.cum, d);
const away = (from: Vec3, to: Vec3): Vec3 => [to[0] - from[0], to[1] - from[1], to[2] - from[2]];

/** The layers a way goes through from the edge: slivers left out, stopping at the first piece that is not retouch. */
function layersAlong(w: RetouchWay, input: Pick<RetouchAngleInput, 'pieceOfFace' | 'pieces'>, sliver: number): RetouchRun[] {
  const runs: RetouchRun[] = [];
  w.faces.forEach((f, i) => {
    const piece = input.pieces.get(input.pieceOfFace[f]);
    const region = piece?.region ?? '';
    const last = runs[runs.length - 1];
    if (last?.region === region) last.to = w.cum[i + 1];
    else runs.push({ region, layer: piece?.layer ?? 0, from: w.cum[i], to: w.cum[i + 1] });
  });
  const kept: typeof runs = [];
  for (const r of runs) {
    if (r.to - r.from < sliver) continue;
    const last = kept[kept.length - 1];
    // each begins where the one before it ended
    if (last?.layer === r.layer) last.to = r.to;
    else kept.push({ ...r, from: last ? last.to : 0 });
  }
  const end = kept.findIndex((r) => r.layer === 0);
  return end < 0 ? kept : kept.slice(0, end);
}

/** The angles of a layer that reaches `to` along `S`, from `from`; the other side `O` is walked as far. */
function stretchAngles(S: RetouchWay, O: RetouchWay, A: Vec3, from: number, to: number, half: number, whole: number): Pick<RetouchStretch, 'three_points' | 'two_lines' | 'layer_face'> {
  const fits = (d: number) => d <= S.length && d <= O.length && 2 * d <= whole;
  if (!fits(to)) return { three_points: null, two_lines: null, layer_face: null };
  const P = along(S, to), Q = along(O, to);
  const opposite = away(A, Q);
  return {
    three_points: angleDeg(away(A, P), opposite),
    two_lines: fits(to + half) && to >= half ? angleDeg(away(along(S, to - half), along(S, to + half)), away(along(O, to - half), along(O, to + half))) : null,
    layer_face: angleDeg(away(along(S, from), P), opposite),
  };
}

/** The retouch layers along a curve and their sections; null without a stated unit, or without a piece in a layer. */
export function* retouchSectionsSteps(input: RetouchAngleInput): Steps<RetouchSections | null> {
  const mm = mmPerUnit(input.unit);
  if (mm === null || input.points.length < 2 || !input.pieces.size) return null;
  const o: Vec3 = input.offset ?? [0, 0, 0];
  const curve = input.points.map((p): Vec3 => [p[0] - o[0], p[1] - o[1], p[2] - o[2]]);
  const plan = stationPlan(curve, input.closed, mm);
  if (!plan) return null;
  const half = TWO_LINES_LENGTH_MM / mm / 2;
  const sliver = SLIVER_EDGES * input.meanEdge;
  const stations: RetouchStation[] = [];
  const sections: Array<StationSection | null> = [];
  for (let k = 0; k < plan.count; k++) {
    yield;
    const s = plan.at(k);
    const empty: RetouchStation = { position: s.position, point: null, stretches: [] };
    sections.push(null);
    if (!s.normal || !s.crossing) {
      stations.push(empty);
      continue;
    }
    // however far the layers go: the whole section
    const lines = sectionByPlane(input.positions, input.index, s.reference, s.normal, input.candidates ?? null);
    const near = nearestOnLines(lines, s.crossing);
    if (!near || near.distance > LINE_REACH_EDGES * input.meanEdge) {
      stations.push(empty);
      continue;
    }
    const [one, other] = ways(near.line, near.seg, near.point);
    const whole = near.line.closed ? one.length : Infinity;
    const stretches: RetouchStretch[] = [];
    const runs: [RetouchRun[], RetouchRun[]] = [layersAlong(one, input, sliver), layersAlong(other, input, sliver)];
    for (const r of runs[0]) stretches.push({ region: r.region, layer: r.layer, distance: r.to, ...stretchAngles(one, other, near.point, r.from, r.to, half, whole) });
    for (const r of runs[1]) stretches.push({ region: r.region, layer: r.layer, distance: r.to, ...stretchAngles(other, one, near.point, r.from, r.to, half, whole) });
    stations.push({ position: s.position, point: [near.point[0] + o[0], near.point[1] + o[1], near.point[2] + o[2]], stretches });
    // only where there is a layer: sections are long
    if (stretches.length) sections[k] = { normal: s.normal, A: near.point, ways: [one, other], closed: near.line.closed, runs };
  }
  return { result: { stations }, sections, length: plan.length };
}

export const retouchSections = (input: RetouchAngleInput): RetouchSections | null => runSync(retouchSectionsSteps(input));

/** The section of one station, cut when it is asked for (a station without a layer keeps none); null where it misses the curve. In the coordinates of the positions. */
export function sectionAtStation(input: RetouchAngleInput, k: number): StationSection | null {
  const mm = mmPerUnit(input.unit);
  if (mm === null || input.points.length < 2) return null;
  const o: Vec3 = input.offset ?? [0, 0, 0];
  const plan = stationPlan(input.points.map((p): Vec3 => [p[0] - o[0], p[1] - o[1], p[2] - o[2]]), input.closed, mm);
  if (!plan || k < 0 || k >= plan.count) return null;
  const s = plan.at(k);
  if (!s.normal || !s.crossing) return null;
  const near = nearestOnLines(sectionByPlane(input.positions, input.index, s.reference, s.normal, input.candidates ?? null), s.crossing);
  if (!near || near.distance > LINE_REACH_EDGES * input.meanEdge) return null;
  const [one, other] = ways(near.line, near.seg, near.point);
  const sliver = SLIVER_EDGES * input.meanEdge;
  return { normal: s.normal, A: near.point, ways: [one, other], closed: near.line.closed, runs: [layersAlong(one, input, sliver), layersAlong(other, input, sliver)] };
}

/** The retouch layers along a curve; null without a stated unit, or without a piece in a layer. */
export function* retouchAnglesSteps(input: RetouchAngleInput): Steps<RetouchAngleResult | null> {
  return (yield* retouchSectionsSteps(input))?.result ?? null;
}

export const retouchAngles = (input: RetouchAngleInput): RetouchAngleResult | null => runSync(retouchAnglesSteps(input));

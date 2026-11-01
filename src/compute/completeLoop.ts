import type { Vec3 } from '../core/types';
import type { Adjacency } from './curvature';
import { vertexPca } from './meshGeometry';
import { YIELD_EVERY, type Steps } from './steps';
import { PathSearch, snapToFeature } from './surfacePath';

/**
 * "Complete loop": an open curve along part of a core's edge is carried on
 * round the edge until it closes. Seen along the normal of the curve's plane,
 * the model's outline in the stretch the curve does not cover gives a point
 * every few degrees; each is moved onto the ridge nearby and they are joined by
 * the curve tracing, from the curve's end back to its start. Pure functions on
 * typed arrays, in steps (a 2-million-triangle scan does not freeze the view).
 */

/** One outline point per this many degrees of the gap. */
export const COMPLETE_STEP_DEG = 2;
/** A curve this close to a straight line (second over first principal variance) has no plane to go round in. */
export const COMPLETE_MIN_SPREAD = 0.01;
/** The curve must already go this far round the centre (degrees). */
export const COMPLETE_MIN_TURN_DEG = 90;
/** An outline point snaps onto a ridge within this share of its distance from the centre. */
export const COMPLETE_SNAP_SHARE = 0.05;
/** An outline point this much nearer the centre than one within OUTLINE_REACH stretches is inside the outline (a stretch the edge's vertices missed): left out. */
export const OUTLINE_KEEP = 0.9;
const OUTLINE_REACH = 3;

/** Why a curve could not be completed: too short or straight, no edge found, or no way round. */
export type CompleteFailure = 'short' | 'edge' | 'loop';

export interface CompleteLoopInput {
  /** Mesh vertex positions (the coordinates `points` are given in). */
  positions: ArrayLike<number>;
  adjacency: Adjacency;
  /** Ridge strength per vertex for snapping (null: no snapping) and the cost field of the tracing (null: shortest way). */
  strength: Float32Array | null;
  cost: Float32Array | null;
  /** The open curve's points, in order. */
  points: readonly Vec3[];
  /** The vertices of its first and last anchor. */
  first: number;
  last: number;
  stepDeg?: number;
}

export type CompleteLoopResult =
  | {
      ok: true;
      /** The new anchors (vertices) from the curve's end round to its start. */
      anchors: number[];
      /** Vertex chains: last anchor → first new one → … → last new one → first anchor (one more than the new anchors). */
      chains: Uint32Array[];
    }
  | { ok: false; reason: CompleteFailure };

/** Vertices settled per step of a trace. */
const TRACE_BUDGET = 20_000;

const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

export function* completeLoopSteps(input: CompleteLoopInput): Steps<CompleteLoopResult> {
  const { positions: pos, adjacency, strength, cost, points } = input;
  const step = ((input.stepDeg ?? COMPLETE_STEP_DEG) * Math.PI) / 180;
  if (points.length < 3) return { ok: false, reason: 'short' };
  // ① the curve's plane; a nearly straight curve has none
  const pca = vertexPca(points.flat());
  const [v1, v2] = pca.variances;
  if (!(v1 > 0) || v2 / v1 < COMPLETE_MIN_SPREAD) return { ok: false, reason: 'short' };
  const n = pca.axes[2], e1 = pca.axes[0];
  const e2: Vec3 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
  const c = pca.mean;
  // ② the centre: the vertices' mean, on the plane
  const count = Math.floor(pos.length / 3);
  if (!count) return { ok: false, reason: 'edge' };
  const ref: Vec3 = [pos[0], pos[1], pos[2]];
  const mean = [0, 0, 0];
  for (let v = 0; v < count; v++) {
    if (v % YIELD_EVERY === 0) yield;
    for (let k = 0; k < 3; k++) mean[k] += pos[3 * v + k] - ref[k];
  }
  const m: Vec3 = [0, 1, 2].map((k) => mean[k] / count + ref[k]) as Vec3;
  const lift = (m[0] - c[0]) * n[0] + (m[1] - c[1]) * n[1] + (m[2] - c[2]) * n[2];
  const o: Vec3 = [m[0] - lift * n[0], m[1] - lift * n[1], m[2] - lift * n[2]];
  const flat = (x: number, y: number, z: number): [number, number] => {
    const dx = x - o[0], dy = y - o[1], dz = z - o[2];
    return [dx * e1[0] + dy * e1[1] + dz * e1[2], dx * e2[0] + dy * e2[1] + dz * e2[2]];
  };
  const angle = (p: Vec3) => {
    const [x, y] = flat(p[0], p[1], p[2]);
    return Math.atan2(y, x);
  };
  // how far the curve goes round the centre, and which way
  let turn = 0;
  for (let i = 1; i < points.length; i++) turn += wrap(angle(points[i]) - angle(points[i - 1]));
  if (Math.abs(turn) < (COMPLETE_MIN_TURN_DEG * Math.PI) / 180) return { ok: false, reason: 'short' };
  const dir = Math.sign(turn);
  const from = angle(points[points.length - 1]);
  const gap = Math.max(0, 2 * Math.PI - Math.abs(turn));
  // ③ the outline over the gap: in each stretch of about `step` the vertex furthest from the centre
  // (stretches centred every step from the curve's end, the ends themselves left out)
  const bins = Math.round(gap / step);
  const width = bins > 0 ? gap / bins : 0;
  const best = new Int32Array(Math.max(0, bins)).fill(-1);
  const far = new Float64Array(Math.max(0, bins));
  if (bins > 1)
    for (let v = 0; v < count; v++) {
      if (v % YIELD_EVERY === 0) yield;
      const [x, y] = flat(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]);
      let along = dir * (Math.atan2(y, x) - from);
      along -= 2 * Math.PI * Math.floor(along / (2 * Math.PI));
      const k = Math.round(along / width);
      if (k < 1 || k >= bins) continue;
      const r = x * x + y * y;
      if (best[k] < 0 || r > far[k]) {
        best[k] = v;
        far[k] = r;
      }
    }
  const found: Array<{ k: number; v: number; r: number }> = [];
  for (let k = 1; k < bins; k++) if (best[k] >= 0) found.push({ k, v: best[k], r: Math.sqrt(far[k]) });
  const outline = found.filter((p) => found.every((q) => Math.abs(q.k - p.k) > OUTLINE_REACH || p.r >= OUTLINE_KEEP * q.r));
  if (bins > 1 && !outline.length) return { ok: false, reason: 'edge' };
  // ④ onto the ridge nearby
  const anchors: number[] = [];
  for (const { v, r } of outline) {
    const s = strength ? snapToFeature(v, COMPLETE_SNAP_SHARE * r, strength, pos, adjacency) : v;
    if (s !== input.first && s !== input.last && s !== anchors[anchors.length - 1]) anchors.push(s);
    yield;
  }
  // ⑤ traced from the curve's end through them back to its start
  const search = new PathSearch(pos, adjacency);
  const stops = [input.last, ...anchors, input.first];
  const chains: Uint32Array[] = [];
  for (let i = 1; i < stops.length; i++) {
    search.start(stops[i - 1], cost);
    while (!search.reach(stops[i], TRACE_BUDGET)) {
      if (search.unreachable(stops[i])) return { ok: false, reason: 'loop' };
      yield;
    }
    chains.push(search.path(stops[i])!);
    yield;
  }
  return { ok: true, anchors, chains };
}

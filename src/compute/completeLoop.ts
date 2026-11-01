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
 * the curve tracing, from the curve's end back to its start. Of those points
 * only about one per COMPLETE_ANCHOR_STEP_DEG stays as an anchor (easy to edit),
 * more where tracing straight between them would leave the outline. Pure
 * functions on typed arrays, in steps (a 2-million-triangle scan does not
 * freeze the view).
 */

/** One outline point per this many degrees of the gap. */
export const COMPLETE_STEP_DEG = 2;
/** The outline points kept as anchors: about one per this many degrees. */
export const COMPLETE_ANCHOR_STEP_DEG = 12;
/** A stretch between kept anchors may run this many mean edge lengths from the traced outline; further, more anchors stay there. */
export const COMPLETE_MAX_DEVIATION = 2;
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
  anchorStepDeg?: number;
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

/** The mean length of the mesh's edges (from at most about 100 000 vertices, evenly picked). */
function* meanEdgeSteps(pos: ArrayLike<number>, adj: Adjacency): Steps<number> {
  const n = adj.offsets.length - 1;
  const stride = Math.max(1, Math.floor(n / 100_000));
  let sum = 0, count = 0;
  for (let v = 0, i = 0; v < n; v += stride, i++) {
    if (i % YIELD_EVERY === 0) yield;
    for (let e = adj.offsets[v]; e < adj.offsets[v + 1]; e++) {
      const u = adj.neighbors[e];
      sum += Math.hypot(pos[3 * u] - pos[3 * v], pos[3 * u + 1] - pos[3 * v + 1], pos[3 * u + 2] - pos[3 * v + 2]);
      count++;
    }
  }
  return count ? sum / count : 0;
}

/** Distance from vertex `v` to the polyline through `chain`. */
function toChain(pos: ArrayLike<number>, v: number, chain: ArrayLike<number>): number {
  const x = pos[3 * v], y = pos[3 * v + 1], z = pos[3 * v + 2];
  let best = Infinity;
  for (let i = 0; i < chain.length; i++) {
    const a = 3 * chain[i], b = 3 * chain[Math.min(i + 1, chain.length - 1)];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const wx = x - pos[a], wy = y - pos[a + 1], wz = z - pos[a + 2];
    const len2 = ux * ux + uy * uy + uz * uz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (wx * ux + wy * uy + wz * uz) / len2)) : 0;
    best = Math.min(best, Math.hypot(wx - t * ux, wy - t * uy, wz - t * uz));
  }
  return best;
}

/** How far two chains run apart: the largest distance from a vertex of one to the other. */
function chainsApart(pos: ArrayLike<number>, a: ArrayLike<number>, b: ArrayLike<number>): number {
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, toChain(pos, a[i], b));
  for (let i = 0; i < b.length; i++) worst = Math.max(worst, toChain(pos, b[i], a));
  return worst;
}

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
  const angle = (p: Vec3) => {
    const dx = p[0] - o[0], dy = p[1] - o[1], dz = p[2] - o[2];
    return Math.atan2(dx * e2[0] + dy * e2[1] + dz * e2[2], dx * e1[0] + dy * e1[1] + dz * e1[2]);
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
      const dx = pos[3 * v] - o[0], dy = pos[3 * v + 1] - o[1], dz = pos[3 * v + 2] - o[2];
      const x = dx * e1[0] + dy * e1[1] + dz * e1[2], y = dx * e2[0] + dy * e2[1] + dz * e2[2];
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
  const stops = [input.last];
  const around = [0];
  for (const { v, r } of outline) {
    const s = strength ? snapToFeature(v, COMPLETE_SNAP_SHARE * r, strength, pos, adjacency) : v;
    if (s !== input.first && s !== input.last && s !== stops[stops.length - 1]) {
      stops.push(s);
      // how far round from the curve's end it is, now that it is on the ridge
      const a = dir * (angle([pos[3 * s], pos[3 * s + 1], pos[3 * s + 2]]) - from);
      around.push(a - 2 * Math.PI * Math.floor(a / (2 * Math.PI)));
    }
    yield;
  }
  stops.push(input.first);
  around.push(gap);
  // ⑤ traced from the curve's end through them back to its start
  const search = new PathSearch(pos, adjacency);
  const trace = function* (from: number, to: number): Steps<Uint32Array | null> {
    search.start(from, cost);
    while (!search.reach(to, TRACE_BUDGET)) {
      if (search.unreachable(to)) return null;
      yield;
    }
    return search.path(to);
  };
  const dense: Uint32Array[] = [];
  for (let i = 1; i < stops.length; i++) {
    const chain = yield* trace(stops[i - 1], stops[i]);
    if (!chain) return { ok: false, reason: 'loop' };
    dense.push(chain);
    yield;
  }
  // ⑥ about one stop per anchor step stays, the one nearest each multiple of the step…
  const stretches = Math.max(1, Math.round(gap / ((input.anchorStepDeg ?? COMPLETE_ANCHOR_STEP_DEG) * Math.PI) * 180));
  const kept = [0];
  for (let j = 1; j < stretches; j++) {
    const target = (gap * j) / stretches;
    let near = -1, nearest = Infinity;
    for (let i = kept[kept.length - 1] + 1; i < stops.length - 1; i++) {
      const d = Math.abs(around[i] - target);
      if (d < nearest) [near, nearest] = [i, d];
    }
    if (near >= 0) kept.push(near);
  }
  kept.push(stops.length - 1);
  // …traced again between those; where that leaves the dense line, the stop furthest from it stays too
  const tolerance = COMPLETE_MAX_DEVIATION * (yield* meanEdgeSteps(pos, adjacency));
  const todo: Array<[number, number]> = [];
  for (let j = kept.length - 1; j > 0; j--) todo.push([kept[j - 1], kept[j]]);
  const anchors: number[] = [];
  const chains: Uint32Array[] = [];
  while (todo.length) {
    const [a, b] = todo.pop()!;
    let chain: Uint32Array | null = dense[a];
    if (b - a > 1) {
      chain = yield* trace(stops[a], stops[b]);
      const line = dense.slice(a, b).flatMap((d, i) => Array.from(i ? d.subarray(1) : d));
      if (!chain || chainsApart(pos, line, chain) > tolerance) {
        let split = (a + b) >> 1, far = -1;
        for (let i = a + 1; chain && i < b; i++) {
          const d = toChain(pos, stops[i], chain);
          if (d > far) [split, far] = [i, d];
        }
        todo.push([split, b], [a, split]);
        yield;
        continue;
      }
    }
    chains.push(chain);
    if (b < stops.length - 1) anchors.push(stops[b]);
    yield;
  }
  return { ok: true, anchors, chains };
}

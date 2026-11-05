/**
 * Tracing curves on a triangle mesh: shortest paths over mesh edges that are
 * drawn toward ridges or valleys ("live-wire"), and snapping of picked points
 * onto those features. Pure functions on typed arrays, independent of three.js.
 */

import type { Adjacency } from './curvature';
import { symmetricEigen3 } from './linalg';

/** What a traced curve is attracted to: convex ridges, concave valleys, or nothing. */
export type SnapMode = 'ridge' | 'valley' | 'off';

export const SNAP_MODES: readonly SnapMode[] = ['ridge', 'valley', 'off'];

/** Curvature (as a fraction of the robust range) that gives a strength of 1 − 1/e ≈ 0.63. */
const REFERENCE = 0.5;
/** Cost multiplier approached on the most pronounced features (1 = no attraction). */
const FEATURE_COST = 0.03;
/** Strength a vertex needs before a click snaps to it. */
export const SNAP_MIN_STRENGTH = 0.5;
/** What counts as the same feature when a point snaps to it: at least this share of its crest's strength. */
export const POINT_SNAP_SHARE = 0.5;
/** Which way a feature runs is told by the vertices of at least this share of its crest's strength: a smoothed feature is several rows wide, its crest one. */
const POINT_CREST_SHARE = 0.9;

/**
 * Per-vertex feature strength in [0, 1) from signed mean curvature (positive =
 * convex): how clearly a vertex lies on a ridge ('ridge') or in a valley ('valley').
 * `range` is the robust curvature range used for shading (CurvatureService).
 * The mapping never saturates, so the crest of a ridge is always stronger than
 * its shoulders.
 */
export function featureStrength(curvature: Float32Array, range: number, mode: SnapMode, out?: Float32Array): Float32Array {
  const n = curvature.length;
  const s = out && out.length === n ? out : new Float32Array(n);
  if (mode === 'off') {
    s.fill(0);
    return s;
  }
  const scale = (mode === 'ridge' ? 1 : -1) / Math.max(1e-12, range * REFERENCE);
  for (let i = 0; i < n; i++) {
    const v = curvature[i] * scale;
    s[i] = v > 0 ? 1 - Math.exp(-v) : 0;
  }
  return s;
}

/** Per-vertex cost multiplier for path search: low on features, 1 on featureless surface. */
export function featureCost(strength: Float32Array, out?: Float32Array): Float32Array {
  const n = strength.length;
  const c = out && out.length === n ? out : new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = FEATURE_COST + (1 - FEATURE_COST) * (1 - strength[i]);
  return c;
}

/**
 * Single-source shortest paths over mesh edges, expanded lazily: the search
 * grows from the seed only as far as needed to settle the requested target and
 * keeps its frontier, so following a moving cursor costs little. Edge weight =
 * edge length × mean cost multiplier of its two vertices (1 without a cost field).
 * Buffers are allocated once per mesh and reused for every new seed.
 */
export class PathSearch {
  private readonly dist: Float64Array;
  private readonly prev: Int32Array;
  /** Epoch at which dist/prev of a vertex were last written. */
  private readonly seen: Uint32Array;
  /** Epoch at which a vertex was settled. */
  private readonly done: Uint32Array;
  private epoch = 0;
  private heapKey = new Float64Array(4096);
  private heapVal = new Int32Array(4096);
  private heapSize = 0;
  private cost: Float32Array | null = null;
  private seedVertex = -1;
  private exhausted = false;

  constructor(
    private readonly positions: ArrayLike<number>,
    private readonly adj: Adjacency,
  ) {
    const n = adj.offsets.length - 1;
    this.dist = new Float64Array(n);
    this.prev = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.done = new Uint32Array(n);
  }

  get seed(): number {
    return this.seedVertex;
  }

  get costField(): Float32Array | null {
    return this.cost;
  }

  /** Start a new search from `seed`; `cost` null means plain surface distance. */
  start(seed: number, cost: Float32Array | null): void {
    this.epoch++;
    if (this.epoch >= 0xfffffff0) {
      this.seen.fill(0);
      this.done.fill(0);
      this.epoch = 1;
    }
    this.cost = cost;
    this.seedVertex = seed;
    this.heapSize = 0;
    this.exhausted = false;
    this.dist[seed] = 0;
    this.prev[seed] = -1;
    this.seen[seed] = this.epoch;
    this.push(seed, 0);
  }

  /** True when the shortest path to `target` is known. */
  reached(target: number): boolean {
    return this.seedVertex >= 0 && this.done[target] === this.epoch;
  }

  /**
   * Expand until `target` is settled, or `budget` vertices were settled in this
   * call. Returns true when the target is reached; false when the budget ran out
   * (call again to continue) or the target is unreachable (see `unreachable`).
   */
  reach(target: number, budget = Infinity): boolean {
    const ep = this.epoch;
    if (this.seedVertex < 0) return false;
    if (this.done[target] === ep) return true;
    if (this.exhausted) return false;
    const { offsets, neighbors } = this.adj;
    const pos = this.positions;
    const cost = this.cost;
    const dist = this.dist;
    let settled = 0;
    while (this.heapSize > 0) {
      const d = this.heapKey[0];
      const u = this.pop();
      if (this.done[u] === ep) continue;
      this.done[u] = ep;
      const ux = pos[3 * u], uy = pos[3 * u + 1], uz = pos[3 * u + 2];
      const cu = cost ? cost[u] : 1;
      for (let e = offsets[u], end = offsets[u + 1]; e < end; e++) {
        const v = neighbors[e];
        if (this.done[v] === ep) continue;
        const dx = pos[3 * v] - ux, dy = pos[3 * v + 1] - uy, dz = pos[3 * v + 2] - uz;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const nd = d + (cost ? len * 0.5 * (cu + cost[v]) : len);
        if (this.seen[v] !== ep || nd < dist[v]) {
          this.seen[v] = ep;
          dist[v] = nd;
          this.prev[v] = u;
          this.push(v, nd);
        }
      }
      if (u === target) return true;
      if (++settled >= budget) return false;
    }
    this.exhausted = true;
    return this.done[target] === ep;
  }

  /** True once the search has run out of vertices without reaching `target`. */
  unreachable(target: number): boolean {
    return this.exhausted && this.done[target] !== this.epoch;
  }

  /** Path cost to a reached target. */
  distanceTo(target: number): number {
    return this.reached(target) ? this.dist[target] : Infinity;
  }

  /** Vertex chain seed → target (both included), or null if the target is not reached yet. */
  path(target: number): Uint32Array | null {
    if (!this.reached(target)) return null;
    let n = 1;
    for (let v = target; v !== this.seedVertex; v = this.prev[v]) n++;
    const out = new Uint32Array(n);
    let i = n - 1;
    for (let v = target; ; v = this.prev[v]) {
      out[i--] = v;
      if (v === this.seedVertex) break;
    }
    return out;
  }

  // ---- binary min-heap with lazy deletion ----

  private push(v: number, key: number): void {
    if (this.heapSize === this.heapKey.length) {
      const k = new Float64Array(this.heapKey.length * 2);
      k.set(this.heapKey);
      const val = new Int32Array(this.heapVal.length * 2);
      val.set(this.heapVal);
      this.heapKey = k;
      this.heapVal = val;
    }
    const keys = this.heapKey;
    const vals = this.heapVal;
    let i = this.heapSize++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = v;
  }

  private pop(): number {
    const keys = this.heapKey;
    const vals = this.heapVal;
    const top = vals[0];
    const n = --this.heapSize;
    if (n > 0) {
      const key = keys[n];
      const val = vals[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return top;
  }
}

/** Closest point on the surface, for pulling paths taut (see relaxPath). */
export interface SurfaceProjector {
  /**
   * Write the surface point closest to `p` into `out` (both xyz) and the unit
   * normal of the surface there into `normal`. Return false if there is none
   * within reach.
   */
  closest(p: Float64Array, out: Float64Array, normal: Float64Array): boolean;
}

/** Share of a pronounced feature point's movement that is still allowed (see pathMobility). */
const CREST_MOBILITY = 0.12;

/**
 * How freely each point of a traced chain may move when the path is pulled
 * taut: 1 on featureless surface, down to CREST_MOBILITY on the crest of a
 * ridge (or floor of a valley) that the path was drawn to, so the line keeps
 * to the feature but loses the zig-zag of mesh edges.
 */
export function pathMobility(chain: ArrayLike<number>, strength: Float32Array | null): Float32Array {
  const m = new Float32Array(chain.length);
  for (let i = 0; i < chain.length; i++) {
    const s = strength ? strength[chain[i]] : 0;
    m[i] = CREST_MOBILITY + (1 - CREST_MOBILITY) * (1 - s) * (1 - s);
  }
  return m;
}

/**
 * Pull a polyline taut along a surface ("string pulling"): each pass moves
 * every interior point part of the way toward the midpoint of its neighbours
 * and back onto the surface; the end points stay. On a smooth surface this
 * converges to the shortest line between the ends; `mobility` (0…1 per point)
 * holds points on features in place. A step is undone when it would land on
 * a differently facing sheet (the other face of a thin edge) or jump further
 * than the spacing of the points. `points` (xyz, length 3n) are changed in place.
 */
export function relaxPath(
  points: Float64Array,
  normals: Float64Array,
  mobility: Float32Array | null,
  surface: SurfaceProjector,
  iterations = 12,
  rate = 0.5,
): void {
  const n = Math.floor(points.length / 3);
  if (n < 3) return;
  const q = new Float64Array(3);
  const out = new Float64Array(3);
  const nrm = new Float64Array(3);
  for (let it = 0; it < iterations; it++) {
    let moved = 0;
    for (let i = 1; i < n - 1; i++) {
      const a = 3 * (i - 1), b = 3 * i, c = 3 * (i + 1);
      const w = rate * (mobility ? mobility[i] : 1);
      if (w <= 0) continue;
      const mx = 0.5 * (points[a] + points[c]), my = 0.5 * (points[a + 1] + points[c + 1]), mz = 0.5 * (points[a + 2] + points[c + 2]);
      q[0] = points[b] + w * (mx - points[b]);
      q[1] = points[b + 1] + w * (my - points[b + 1]);
      q[2] = points[b + 2] + w * (mz - points[b + 2]);
      if (!surface.closest(q, out, nrm)) continue;
      // reject a landing on another sheet or far away
      if (nrm[0] * normals[b] + nrm[1] * normals[b + 1] + nrm[2] * normals[b + 2] < 0.2) continue;
      const span = Math.hypot(points[c] - points[a], points[c + 1] - points[a + 1], points[c + 2] - points[a + 2]);
      const jump = Math.hypot(out[0] - points[b], out[1] - points[b + 1], out[2] - points[b + 2]);
      if (jump > span) continue;
      moved = Math.max(moved, jump / (span || 1));
      points[b] = out[0];
      points[b + 1] = out[1];
      points[b + 2] = out[2];
      normals[b] = nrm[0];
      normals[b + 1] = nrm[1];
      normals[b + 2] = nrm[2];
    }
    if (moved < 1e-4) break;
  }
}

/**
 * Move a picked vertex onto a pronounced feature nearby, then onto its crest:
 * (1) among vertices within `radius` (along the surface) whose strength reaches
 * `minStrength`, the one maximising strength − 0.5 · distance / radius, so a
 * marked ridge a little further away beats a faint one under the cursor;
 * (2) uphill in strength from there to a local maximum.
 * Returns `start` when no feature is within reach.
 */
export function snapToFeature(
  start: number,
  radius: number,
  strength: Float32Array,
  positions: ArrayLike<number>,
  adj: Adjacency,
  minStrength = SNAP_MIN_STRENGTH,
): number {
  if (!(radius > 0)) return start;
  const entry = bestNearby(start, radius, strength, positions, adj, minStrength);
  if (entry < 0) return start;
  // climb to the crest, without wandering far from the click
  const sx = positions[3 * start], sy = positions[3 * start + 1], sz = positions[3 * start + 2];
  const leash2 = 4 * radius * radius;
  let cur = entry;
  for (let step = 0; step < 500; step++) {
    let next = cur;
    for (let e = adj.offsets[cur]; e < adj.offsets[cur + 1]; e++) {
      const v = adj.neighbors[e];
      if (strength[v] <= strength[next]) continue;
      const dx = positions[3 * v] - sx, dy = positions[3 * v + 1] - sy, dz = positions[3 * v + 2] - sz;
      if (dx * dx + dy * dy + dz * dz > leash2) continue;
      next = v;
    }
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

/**
 * Move a picked vertex onto the nearest place of the feature under it, for things that are points (the point of
 * percussion, a fixed landmark): `snapToFeature` runs along a feature to its most pronounced place, which is right for a
 * line through it but moves a point away from where it was put. (1) `snapToFeature` tells which feature; (2) its band:
 * the vertices connected to that crest, within 2 × `radius` of it, of at least `POINT_SNAP_SHARE` of its strength (straight, as
 * `snapToFeature` measures how far it may go: a path over mesh edges zig-zags, and would leave out what lies abreast of the press);
 * (3) the vertex of the band nearest `start`; (4) from there uphill across the feature only: no further along it
 * (the main direction of the band's strongest vertices) than half a mean edge length. No clear direction: no last step.
 * Returns `start` when no feature is within reach.
 */
export function snapToFeaturePoint(
  start: number,
  radius: number,
  strength: Float32Array,
  positions: ArrayLike<number>,
  adj: Adjacency,
  minStrength = SNAP_MIN_STRENGTH,
): number {
  const crest = snapToFeature(start, radius, strength, positions, adj, minStrength);
  if (strength[crest] < minStrength) return start;
  const band = featureBand(crest, 2 * radius, POINT_SNAP_SHARE * strength[crest], strength, positions, adj);
  const at = (v: number, k: number) => positions[3 * v + k];
  let near = crest, least = Infinity;
  for (const v of band) {
    const d = (at(v, 0) - at(start, 0)) ** 2 + (at(v, 1) - at(start, 1)) ** 2 + (at(v, 2) - at(start, 2)) ** 2;
    if (d < least) {
      least = d;
      near = v;
    }
  }
  const top = band.filter((v) => strength[v] >= POINT_CREST_SHARE * strength[crest]);
  if (top.length < 3) return near;
  const mean = [0, 0, 0];
  for (const v of top) for (let k = 0; k < 3; k++) mean[k] += at(v, k) / top.length;
  const cov = new Array<number>(9).fill(0);
  for (const v of top) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[3 * i + j] += (at(v, i) - mean[i]) * (at(v, j) - mean[j]);
  const { values, vectors } = symmetricEigen3(cov);
  if (values[0] < 4 * values[1]) return near;
  const [dx, dy, dz] = vectors[0];
  const along = (v: number) => at(v, 0) * dx + at(v, 1) * dy + at(v, 2) * dz;
  let total = 0, edges = 0;
  for (const v of band) {
    for (let e = adj.offsets[v]; e < adj.offsets[v + 1]; e++) {
      const w = adj.neighbors[e];
      total += Math.hypot(at(w, 0) - at(v, 0), at(w, 1) - at(v, 1), at(w, 2) - at(v, 2));
      edges++;
    }
  }
  const reach = edges ? (0.5 * total) / edges : 0;
  const from = along(near);
  let cur = near;
  for (let step = 0; step < 500; step++) {
    let next = cur;
    for (let e = adj.offsets[cur]; e < adj.offsets[cur + 1]; e++) {
      const v = adj.neighbors[e];
      if (strength[v] <= strength[next]) continue;
      // neither in one step nor by many small ones
      if (Math.abs(along(v) - along(cur)) > reach || Math.abs(along(v) - from) > reach) continue;
      next = v;
    }
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

/** The vertices connected to `seed` over vertices of at least `floor` strength, within `reach` of it. */
function featureBand(seed: number, reach: number, floor: number, strength: Float32Array, positions: ArrayLike<number>, adj: Adjacency, maxVisits = 40_000): number[] {
  const seen = new Set<number>([seed]);
  const queue = [seed];
  const sx = positions[3 * seed], sy = positions[3 * seed + 1], sz = positions[3 * seed + 2];
  for (let head = 0; head < queue.length && queue.length < maxVisits; head++) {
    const u = queue[head];
    for (let e = adj.offsets[u]; e < adj.offsets[u + 1]; e++) {
      const v = adj.neighbors[e];
      if (seen.has(v) || strength[v] < floor) continue;
      if (Math.hypot(positions[3 * v] - sx, positions[3 * v + 1] - sy, positions[3 * v + 2] - sz) > reach) continue;
      seen.add(v);
      queue.push(v);
    }
  }
  return queue;
}

/** Best feature vertex within `radius` of `start` (surface distance), or −1. */
function bestNearby(
  start: number,
  radius: number,
  strength: Float32Array,
  positions: ArrayLike<number>,
  adj: Adjacency,
  minStrength: number,
  maxVisits = 40_000,
): number {
  const dist = new Map<number, number>([[start, 0]]);
  const keys: number[] = [0];
  const vals: number[] = [start];
  const push = (v: number, k: number) => {
    let i = keys.length;
    keys.push(k);
    vals.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= k) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = k;
    vals[i] = v;
  };
  const pop = (): [number, number] => {
    const top: [number, number] = [keys[0], vals[0]];
    const k = keys.pop()!;
    const v = vals.pop()!;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= k) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = k;
      vals[i] = v;
    }
    return top;
  };
  let best = -1;
  let bestScore = -Infinity;
  const done = new Set<number>();
  while (keys.length > 0 && done.size < maxVisits) {
    const [d, u] = pop();
    if (done.has(u)) continue;
    if (d > radius) break;
    done.add(u);
    const s = strength[u];
    if (s >= minStrength) {
      const score = s - (0.5 * d) / radius;
      if (score > bestScore) {
        bestScore = score;
        best = u;
      }
    }
    const ux = positions[3 * u], uy = positions[3 * u + 1], uz = positions[3 * u + 2];
    for (let e = adj.offsets[u]; e < adj.offsets[u + 1]; e++) {
      const v = adj.neighbors[e];
      if (done.has(v)) continue;
      const dx = positions[3 * v] - ux, dy = positions[3 * v + 1] - uy, dz = positions[3 * v + 2] - uz;
      const nd = d + Math.sqrt(dx * dx + dy * dy + dz * dz);
      const old = dist.get(v);
      if (nd <= radius && (old === undefined || nd < old)) {
        dist.set(v, nd);
        push(v, nd);
      }
    }
  }
  return best;
}

import type { Vec3 } from '../core/types';
import type { EdgeTable } from './meshGeometry';
import { YIELD_EVERY, type Steps } from './steps';

/** Two scars whose surface regions meet along mesh edges. */
export interface ScarBorder {
  a: string;
  b: string;
  /** Length of the edges they share. */
  length: number;
  /** The shared edges as vertex pairs (a0, b0, a1, b1, …). */
  edges: number[];
  /** A point on the border near its middle (the midpoint of the shared edge closest to their centre). */
  mid: Vec3;
}

/**
 * Edges (vertex pairs a0, b0, a1, b1, …) joined end to end into chains of
 * vertices, broken where three or more edges meet; a closed loop ends with its
 * first vertex again.
 */
export function chainEdges(pairs: ArrayLike<number>): number[][] {
  const at = new Map<number, number[]>();
  const m = Math.floor(pairs.length / 2);
  for (let e = 0; e < m; e++)
    for (const v of [pairs[2 * e], pairs[2 * e + 1]]) (at.get(v) ?? at.set(v, []).get(v)!).push(e);
  const used = new Uint8Array(m);
  const other = (e: number, v: number) => (pairs[2 * e] === v ? pairs[2 * e + 1] : pairs[2 * e]);
  const walk = (start: number): number[] => {
    const chain = [start];
    let v = start;
    for (;;) {
      const e = (at.get(v) ?? []).find((x) => !used[x]);
      if (e === undefined) break;
      used[e] = 1;
      v = other(e, v);
      chain.push(v);
      if (at.get(v)!.length !== 2) break;
    }
    return chain;
  };
  const out: number[][] = [];
  // open chains first (from their ends and junctions), then the loops left
  for (const [v, list] of at) if (list.length !== 2) while (list.some((e) => !used[e])) out.push(walk(v));
  for (let e = 0; e < m; e++) if (!used[e]) out.push(walk(pairs[2 * e]));
  return out;
}

/**
 * Scars that border on each other: an edge of the mesh whose two triangles lie
 * in the regions of two different scars is shared by them. Pairs sharing less
 * than `minFactor` × the mean edge length of the mesh are left out (regions
 * that only touch at a corner).
 *
 * `region[t]`: the piece of surface of triangle t; `owner[piece]`: the scar of
 * that piece as an index into `scars`, or −1 (not a scar region).
 */
export function* scarBordersSteps(
  positions: ArrayLike<number>,
  index: ArrayLike<number>,
  edges: EdgeTable,
  region: ArrayLike<number>,
  owner: ArrayLike<number>,
  scars: readonly string[],
  minFactor = 2,
): Steps<ScarBorder[]> {
  const p = positions;
  const len = (e: number) => {
    const a = 3 * edges.v0[e], b = 3 * edges.v1[e];
    return Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
  };
  const ne = edges.v0.length;
  let total = 0;
  for (let e = 0; e < ne; e++) {
    if (e % YIELD_EVERY === 0) yield;
    total += len(e);
  }
  const mean = ne ? total / ne : 0;
  // the first triangle seen on each edge; a later one on the same edge is its neighbour
  const first = new Int32Array(ne).fill(-1);
  const pairs = new Map<number, { a: number; b: number; length: number; edges: number[] }>();
  const n = scars.length;
  const tris = Math.floor(index.length / 3);
  for (let s = 0; s < 3 * tris; s++) {
    if (s % YIELD_EVERY === 0) yield;
    const e = edges.ofSide[s];
    const t = Math.floor(s / 3);
    const f = first[e];
    if (f < 0) {
      first[e] = t;
      continue;
    }
    const x = owner[region[t]] ?? -1, y = owner[region[f]] ?? -1;
    if (x < 0 || y < 0 || x === y) continue;
    const [a, b] = x < y ? [x, y] : [y, x];
    const key = a * n + b;
    let pair = pairs.get(key);
    if (!pair) pairs.set(key, (pair = { a, b, length: 0, edges: [] }));
    pair.length += len(e);
    pair.edges.push(edges.v0[e], edges.v1[e]);
  }
  const out: ScarBorder[] = [];
  for (const q of pairs.values()) {
    if (q.length < minFactor * mean) continue;
    // the shared edge nearest the centre of the shared edges' midpoints
    const mids: Vec3[] = [];
    for (let i = 0; i < q.edges.length; i += 2) {
      const u = 3 * q.edges[i], v = 3 * q.edges[i + 1];
      mids.push([(p[u] + p[v]) / 2, (p[u + 1] + p[v + 1]) / 2, (p[u + 2] + p[v + 2]) / 2]);
    }
    const c = [0, 1, 2].map((k) => mids.reduce((sum, m) => sum + m[k], 0) / mids.length);
    const mid = mids.reduce((best, m) => (Math.hypot(m[0] - c[0], m[1] - c[1], m[2] - c[2]) < Math.hypot(best[0] - c[0], best[1] - c[1], best[2] - c[2]) ? m : best), mids[0]);
    out.push({ a: scars[q.a], b: scars[q.b], length: q.length, edges: q.edges, mid });
  }
  return out;
}

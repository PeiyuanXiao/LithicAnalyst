import type { Vec3 } from '../core/types';
import { runSync, type Steps } from './steps';

/** Points on each triangle side when the path is looked for across the triangles it passes through. */
const SIDE_POINTS = 3;
/** Sweeps of pulling the path's crossings taut. */
const TAUT_SWEEPS = 200;

export interface RegionPath {
  points: Vec3[];
  length: number;
}

/** The point of triangle abc closest to `q` (Ericson, Real-Time Collision Detection). */
export function closestOnTriangle(q: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], ap = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
  const dot = (u: ArrayLike<number>, v: ArrayLike<number>) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = [q[0] - b[0], q[1] - b[1], q[2] - b[2]];
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  const on = (o: Vec3, d: ArrayLike<number>, s: number): Vec3 => [o[0] + s * d[0], o[1] + s * d[1], o[2] + s * d[2]];
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return on(a, ab, d1 / (d1 - d3));
  const cp = [q[0] - c[0], q[1] - c[1], q[2] - c[2]];
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return on(a, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return on(b, [c[0] - b[0], c[1] - b[1], c[2] - b[2]], (d4 - d3) / (d4 - d3 + (d5 - d6)));
  const den = 1 / (va + vb + vc);
  const v = vb * den, w = vc * den;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

const dist = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** A small binary heap of (key, value), lowest key first. */
class Heap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number, val: number): void {
    const k = this.keys, v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const k = this.keys, v = this.vals;
    const top = v[0];
    const key = k.pop()!, val = v.pop()!;
    const n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= key) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = key;
      v[i] = val;
    }
    return top;
  }
}

/**
 * The shortest path along the surface between two points, on the given triangles only.
 * First the shortest way over the region's mesh edges; then, on the triangles that way
 * passes through, a finer search over points on their sides, and those crossings pulled
 * taut (each crossing slides along its side to where the two stretches meet it at equal
 * angles). Null when the two points are not connected within the region.
 */
export function* regionPathSteps(positions: ArrayLike<number>, index: ArrayLike<number>, faces: ArrayLike<number>, start: Vec3, end: Vec3): Steps<RegionPath | null> {
  if (!faces.length) return null;
  const P = (v: number): Vec3 => [positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]];
  // where the two points land on the region
  const land = (q: Vec3): { face: number; point: Vec3 } => {
    let best = Infinity, face = faces[0], point: Vec3 = q;
    for (let i = 0; i < faces.length; i++) {
      const t = faces[i];
      const x = closestOnTriangle(q, P(index[3 * t]), P(index[3 * t + 1]), P(index[3 * t + 2]));
      const d = dist(x, q);
      if (d < best) {
        best = d;
        face = t;
        point = x;
      }
    }
    return { face, point };
  };
  const a = land(start);
  yield;
  const b = land(end);
  yield;
  if (a.face === b.face) return { points: [a.point, b.point], length: dist(a.point, b.point) };

  // 1. over the mesh edges of the region
  const neighbours = new Map<number, Set<number>>();
  const touch = (x: number, y: number) => {
    let s = neighbours.get(x);
    if (!s) neighbours.set(x, (s = new Set()));
    s.add(y);
  };
  for (let i = 0; i < faces.length; i++) {
    const t = faces[i];
    const x = index[3 * t], y = index[3 * t + 1], z = index[3 * t + 2];
    touch(x, y);
    touch(y, x);
    touch(y, z);
    touch(z, y);
    touch(z, x);
    touch(x, z);
    if (i % 8192 === 0) yield;
  }
  const best = new Map<number, number>();
  const prev = new Map<number, number>();
  const heap = new Heap();
  for (let k = 0; k < 3; k++) {
    const v = index[3 * a.face + k];
    const d = dist(a.point, P(v));
    best.set(v, d);
    prev.set(v, -1);
    heap.push(d, v);
  }
  const targets = new Map<number, number>();
  for (let k = 0; k < 3; k++) {
    const v = index[3 * b.face + k];
    targets.set(v, dist(b.point, P(v)));
  }
  let endV = -1, endCost = Infinity, pops = 0;
  const settled = new Set<number>();
  while (heap.size) {
    const v = heap.pop();
    if (settled.has(v)) continue;
    settled.add(v);
    const g = best.get(v)!;
    if (g >= endCost) break;
    const tail = targets.get(v);
    if (tail !== undefined && g + tail < endCost) {
      endCost = g + tail;
      endV = v;
    }
    const pv = P(v);
    for (const u of neighbours.get(v) ?? []) {
      const d = g + dist(pv, P(u));
      if (d < (best.get(u) ?? Infinity)) {
        best.set(u, d);
        prev.set(u, v);
        heap.push(d, u);
      }
    }
    if (++pops % 4096 === 0) yield;
  }
  if (endV < 0) return null;
  const chain = new Set<number>();
  for (let v = endV; v >= 0; v = prev.get(v) ?? -1) chain.add(v);

  // 2. the triangles that way passes through (and those at the two ends)
  const corridor: number[] = [];
  for (let i = 0; i < faces.length; i++) {
    const t = faces[i];
    if (t === a.face || t === b.face || chain.has(index[3 * t]) || chain.has(index[3 * t + 1]) || chain.has(index[3 * t + 2])) corridor.push(t);
    if (i % 32768 === 0) yield;
  }
  // nodes: the corners, points on each side, and the two ends; each knows its triangles
  const nodeOf = new Map<string, number>();
  const pos: number[] = [];
  /** The side a node lies on (its two corner vertices and the node's share along it), or none for a corner or an end. */
  const onSide: Array<[number, number] | null> = [];
  const triNodes: number[][] = [];
  const nodeTris: number[][] = [];
  const node = (key: string, p: Vec3, side: [number, number] | null): number => {
    let n = nodeOf.get(key);
    if (n === undefined) {
      n = onSide.length;
      nodeOf.set(key, n);
      pos.push(p[0], p[1], p[2]);
      onSide.push(side);
      nodeTris.push([]);
    }
    return n;
  };
  corridor.forEach((t, ti) => {
    const list: number[] = [];
    for (let k = 0; k < 3; k++) {
      const u = index[3 * t + k], v = index[3 * t + ((k + 1) % 3)];
      list.push(node(`v${u}`, P(u), null));
      const lo = u < v ? u : v, hi = u < v ? v : u;
      const pl = P(lo), ph = P(hi);
      for (let s = 1; s <= SIDE_POINTS; s++) {
        const f = s / (SIDE_POINTS + 1);
        list.push(node(`e${lo},${hi},${s}`, [pl[0] + f * (ph[0] - pl[0]), pl[1] + f * (ph[1] - pl[1]), pl[2] + f * (ph[2] - pl[2])], [lo, hi]));
      }
    }
    triNodes.push(list);
    for (const n of list) nodeTris[n].push(ti);
  });
  const ti = (face: number) => corridor.indexOf(face);
  const from = node('start', a.point, null);
  const to = node('end', b.point, null);
  triNodes[ti(a.face)].push(from);
  nodeTris[from].push(ti(a.face));
  triNodes[ti(b.face)].push(to);
  nodeTris[to].push(ti(b.face));
  yield;
  const nodes = onSide.length;
  const cost = new Float64Array(nodes).fill(Infinity);
  const back = new Int32Array(nodes).fill(-1);
  const closed = new Uint8Array(nodes);
  cost[from] = 0;
  const fine = new Heap();
  fine.push(0, from);
  pops = 0;
  while (fine.size) {
    const n = fine.pop();
    if (closed[n]) continue;
    closed[n] = 1;
    if (n === to) break;
    const px = pos[3 * n], py = pos[3 * n + 1], pz = pos[3 * n + 2];
    for (const t of nodeTris[n])
      for (const m of triNodes[t]) {
        if (closed[m]) continue;
        const d = cost[n] + Math.hypot(pos[3 * m] - px, pos[3 * m + 1] - py, pos[3 * m + 2] - pz);
        if (d < cost[m]) {
          cost[m] = d;
          back[m] = n;
          fine.push(d, m);
        }
      }
    if (++pops % 2048 === 0) yield;
  }
  if (!closed[to]) return null;
  const order: number[] = [];
  for (let n = to; n >= 0; n = back[n]) order.push(n);
  order.reverse();
  // 3. pulled taut: a stretch stays inside its triangle while each crossing stays on its side
  const pts: Vec3[] = order.map((n) => [pos[3 * n], pos[3 * n + 1], pos[3 * n + 2]]);
  for (let sweep = 0; sweep < TAUT_SWEEPS; sweep++) {
    let moved = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const side = onSide[order[i]];
      if (!side) continue;
      const u = P(side[0]), v = P(side[1]);
      const d: Vec3 = [v[0] - u[0], v[1] - u[1], v[2] - u[2]];
      const l = Math.hypot(d[0], d[1], d[2]);
      if (!(l > 0)) continue;
      const e: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
      const along = (q: Vec3) => (q[0] - u[0]) * e[0] + (q[1] - u[1]) * e[1] + (q[2] - u[2]) * e[2];
      const off = (q: Vec3, s: number) => Math.hypot(q[0] - u[0] - s * e[0], q[1] - u[1] - s * e[1], q[2] - u[2] - s * e[2]);
      const sa = along(pts[i - 1]), sb = along(pts[i + 1]);
      const ha = off(pts[i - 1], sa), hb = off(pts[i + 1], sb);
      // the line between the neighbours, with the two triangles unfolded into one plane
      const s = ha + hb > 0 ? (sa * hb + sb * ha) / (ha + hb) : (sa + sb) / 2;
      const c = Math.max(0, Math.min(l, s));
      const q: Vec3 = [u[0] + c * e[0], u[1] + c * e[1], u[2] + c * e[2]];
      moved = Math.max(moved, dist(q, pts[i]));
      pts[i] = q;
    }
    if (moved < 1e-7 * (cost[to] || 1)) break;
    if (sweep % 8 === 0) yield;
  }
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += dist(pts[i - 1], pts[i]);
  return { points: pts, length };
}

export const regionPath = (positions: ArrayLike<number>, index: ArrayLike<number>, faces: ArrayLike<number>, start: Vec3, end: Vec3): RegionPath | null =>
  runSync(regionPathSteps(positions, index, faces, start, end));

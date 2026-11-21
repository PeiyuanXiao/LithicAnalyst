import type { Vec3 } from '../core/types';
import { closestOnTriangle } from './regionPath';
import { runSync, type Steps } from './steps';

/** Triangles a leaf holds, at most. */
const LEAF = 8;

/**
 * A bounding-volume tree over some of a mesh's triangles, for the closest point on them. No three.js, so it runs in the batch worker as on the page;
 * a region of surface has one of its own, so a search never leaves the region.
 */
export class TriangleBvh {
  constructor(
    private readonly positions: ArrayLike<number>,
    private readonly index: ArrayLike<number>,
    /** The triangles, in the tree's order. */
    private readonly tris: Uint32Array,
    /** Per node: min xyz, max xyz. */
    private readonly boxes: Float64Array,
    /** Per node: its first child (the next is second), or −1 − the first triangle of a leaf. */
    private readonly links: Int32Array,
    /** Per leaf node: how many triangles. */
    private readonly counts: Uint16Array,
  ) {}

  /** The nodes still to visit along a ray (the tree is built by halves: its depth stays far below this). */
  private readonly rayStack = new Int32Array(256);

  /** Whether `p` lies within the box round all the triangles. */
  inBox(p: Vec3): boolean {
    const b = this.boxes;
    return this.tris.length > 0 && p[0] >= b[0] && p[1] >= b[1] && p[2] >= b[2] && p[0] <= b[3] && p[1] <= b[4] && p[2] <= b[5];
  }

  /**
   * How many triangles the ray from `o` along `d` passes through (beyond `o`). A ray that meets an edge or a corner may count
   * a crossing twice or not at all: the caller asks along more than one direction.
   */
  crossings(o: Vec3, d: Vec3): number {
    if (!this.tris.length) return 0;
    const boxes = this.boxes, links = this.links, counts = this.counts, tris = this.tris, pos = this.positions, idx = this.index;
    const ox = o[0], oy = o[1], oz = o[2], dx = d[0], dy = d[1], dz = d[2];
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    const stack = this.rayStack;
    let sp = 0, count = 0;
    stack[sp++] = 0;
    while (sp) {
      const node = stack[--sp];
      const b = 6 * node;
      // the slabs: where the ray is within the box along each axis
      let t0 = (boxes[b] - ox) * ix, t1 = (boxes[b + 3] - ox) * ix;
      let near = t0 < t1 ? t0 : t1, far = t0 < t1 ? t1 : t0;
      t0 = (boxes[b + 1] - oy) * iy;
      t1 = (boxes[b + 4] - oy) * iy;
      near = Math.max(near, t0 < t1 ? t0 : t1);
      far = Math.min(far, t0 < t1 ? t1 : t0);
      t0 = (boxes[b + 2] - oz) * iz;
      t1 = (boxes[b + 5] - oz) * iz;
      near = Math.max(near, t0 < t1 ? t0 : t1);
      far = Math.min(far, t0 < t1 ? t1 : t0);
      if (!(far >= near && far >= 0)) continue;
      const link = links[node];
      if (link >= 0) {
        stack[sp++] = link;
        stack[sp++] = link + 1;
        continue;
      }
      const first = -1 - link;
      for (let i = 0; i < counts[node]; i++) {
        const t = tris[first + i];
        const a = 3 * idx[3 * t], bb = 3 * idx[3 * t + 1], c = 3 * idx[3 * t + 2];
        const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
        const e1x = pos[bb] - ax, e1y = pos[bb + 1] - ay, e1z = pos[bb + 2] - az;
        const e2x = pos[c] - ax, e2y = pos[c + 1] - ay, e2z = pos[c + 2] - az;
        // Möller–Trumbore
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (det === 0) continue;
        const inv = 1 / det;
        const sx = ox - ax, sy = oy - ay, sz = oz - az;
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        if ((e2x * qx + e2y * qy + e2z * qz) * inv > 0) count++;
      }
    }
    return count;
  }

  /** The closest point on the triangles to `q`, or null when there are none. */
  closest(q: Vec3): { face: number; point: Vec3; distance: number } | null {
    if (!this.tris.length) return null;
    const boxes = this.boxes;
    const gap = (node: number): number => {
      const b = 6 * node;
      let d = 0;
      for (let k = 0; k < 3; k++) {
        const v = q[k];
        const low = boxes[b + k], high = boxes[b + 3 + k];
        if (v < low) d += (low - v) * (low - v);
        else if (v > high) d += (v - high) * (v - high);
      }
      return d;
    };
    const P = (v: number): Vec3 => [this.positions[3 * v], this.positions[3 * v + 1], this.positions[3 * v + 2]];
    let best = Infinity, face = -1, point: Vec3 = q;
    const stack: number[] = [0];
    const near: number[] = [0];
    while (stack.length) {
      const node = stack.pop()!;
      if (near.pop()! >= best) continue;
      const link = this.links[node];
      if (link < 0) {
        const first = -1 - link;
        for (let i = 0; i < this.counts[node]; i++) {
          const t = this.tris[first + i];
          const x = closestOnTriangle(q, P(this.index[3 * t]), P(this.index[3 * t + 1]), P(this.index[3 * t + 2]));
          const d = (x[0] - q[0]) ** 2 + (x[1] - q[1]) ** 2 + (x[2] - q[2]) ** 2;
          if (d < best) {
            best = d;
            face = t;
            point = x;
          }
        }
        continue;
      }
      const a = gap(link), b = gap(link + 1);
      // the nearer one is looked at first
      if (a < b) {
        stack.push(link + 1, link);
        near.push(b, a);
      } else {
        stack.push(link, link + 1);
        near.push(a, b);
      }
    }
    return { face, point: [point[0], point[1], point[2]], distance: Math.sqrt(best) };
  }
}

/** The tree over these triangles (all of them when none are given), in slices. */
export function* triangleBvhSteps(positions: ArrayLike<number>, index: ArrayLike<number>, faces: ArrayLike<number> | null = null): Steps<TriangleBvh> {
  const n = faces ? faces.length : Math.floor(index.length / 3);
  const tris = new Uint32Array(n);
  for (let i = 0; i < n; i++) tris[i] = faces ? faces[i] : i;
  const centres = new Float64Array(3 * n);
  const lows = new Float64Array(3 * n), highs = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    const t = tris[i];
    for (let k = 0; k < 3; k++) {
      const a = positions[3 * index[3 * t] + k], b = positions[3 * index[3 * t + 1] + k], c = positions[3 * index[3 * t + 2] + k];
      lows[3 * i + k] = Math.min(a, b, c);
      highs[3 * i + k] = Math.max(a, b, c);
      centres[3 * i + k] = (a + b + c) / 3;
    }
    if (i % 65536 === 0) yield;
  }
  // the order of the triangles, sorted into place: `items` indexes the arrays above
  const items = new Uint32Array(n);
  for (let i = 0; i < n; i++) items[i] = i;
  const maxNodes = Math.max(1, 2 * Math.ceil(n / (LEAF / 2)) + 2);
  const boxes = new Float64Array(6 * maxNodes);
  const links = new Int32Array(maxNodes);
  const counts = new Uint16Array(maxNodes);
  let nodes = 1;
  /**
   * One pass of putting the element of rank `k` of items[l..r] by the centres along an axis in its place, the smaller before it:
   * l and r close in on it; false once it is there.
   */
  let l = 0, r = 0;
  const pass = (k: number, axis: number): boolean => {
    const pivot = centres[3 * items[(l + r) >> 1] + axis];
    let i = l, j = r;
    while (i <= j) {
      while (centres[3 * items[i] + axis] < pivot) i++;
      while (centres[3 * items[j] + axis] > pivot) j--;
      if (i <= j) {
        const s = items[i];
        items[i] = items[j];
        items[j] = s;
        i++;
        j--;
      }
    }
    if (k <= j) r = j;
    else if (k >= i) l = i;
    else return false;
    return true;
  };
  const todo: Array<[number, number, number]> = n ? [[0, 0, n]] : [];
  let done = 0;
  while (todo.length) {
    const [node, lo, hi] = todo.pop()!;
    const b = 6 * node;
    for (let k = 0; k < 3; k++) {
      boxes[b + k] = Infinity;
      boxes[b + 3 + k] = -Infinity;
    }
    for (let i = lo; i < hi; i++) {
      const it = items[i];
      for (let k = 0; k < 3; k++) {
        if (lows[3 * it + k] < boxes[b + k]) boxes[b + k] = lows[3 * it + k];
        if (highs[3 * it + k] > boxes[b + 3 + k]) boxes[b + 3 + k] = highs[3 * it + k];
      }
    }
    if (hi - lo <= LEAF) {
      links[node] = -1 - lo;
      counts[node] = hi - lo;
      done += hi - lo;
      if (done >= 65536) {
        done = 0;
        yield;
      }
      continue;
    }
    const extent = [boxes[b + 3] - boxes[b], boxes[b + 4] - boxes[b + 1], boxes[b + 5] - boxes[b + 2]];
    const axis = extent[0] >= extent[1] && extent[0] >= extent[2] ? 0 : extent[1] >= extent[2] ? 1 : 2;
    const mid = (lo + hi) >> 1;
    l = lo;
    r = hi - 1;
    while (l < r) {
      // (a pass over many takes a while: a turn first)
      if (r - l > 65536) yield;
      if (!pass(mid, axis)) break;
    }
    const left = nodes;
    nodes += 2;
    links[node] = left;
    todo.push([left, lo, mid], [left + 1, mid, hi]);
  }
  const ordered = new Uint32Array(n);
  for (let i = 0; i < n; i++) ordered[i] = tris[items[i]];
  return new TriangleBvh(positions, index, ordered, boxes, links, counts);
}

/** The same at once. */
export const triangleBvh = (positions: ArrayLike<number>, index: ArrayLike<number>, faces: ArrayLike<number> | null = null): TriangleBvh => runSync(triangleBvhSteps(positions, index, faces));

import type { Vec3 } from '../core/types';
import { runSync, YIELD_EVERY, type Steps } from './steps';

/** Share of the set's size by which a point may lie outside the hull. */
const HULL_TOLERANCE = 1e-4;

/**
 * The vertices of a point set's convex hull (quickhull). A point within a ten-thousandth of
 * the set's size of the hull counts as inside (so also the many points of a smooth convex
 * scan go; morphDimensionsSteps settles the last of it on all the points). A flat set gets a
 * helper apex out of its plane (left out of the result). Returns point indices.
 */
export function* convexHullSteps(positions: ArrayLike<number>): Steps<Uint32Array> {
  const n = Math.floor(positions.length / 3);
  if (n <= 4) return Uint32Array.from({ length: n }, (_, i) => i);
  // extreme points along the axes
  const lo = [0, 0, 0], hi = [0, 0, 0];
  for (let v = 0; v < n; v++) {
    if (v % YIELD_EVERY === 0) yield;
    for (let k = 0; k < 3; k++) {
      if (positions[3 * v + k] < positions[3 * lo[k] + k]) lo[k] = v;
      if (positions[3 * v + k] > positions[3 * hi[k] + k]) hi[k] = v;
    }
  }
  const size = Math.max(positions[3 * hi[0]] - positions[3 * lo[0]], positions[3 * hi[1] + 1] - positions[3 * lo[1] + 1], positions[3 * hi[2] + 2] - positions[3 * lo[2] + 2]);
  if (!(size > 0)) return Uint32Array.of(0);
  const eps = size * HULL_TOLERANCE;
  // room for one helper apex after the points
  const P = new Float64Array(3 * (n + 1));
  for (let i = 0; i < 3 * n; i++) P[i] = positions[i];
  const at = (v: number): Vec3 => [P[3 * v], P[3 * v + 1], P[3 * v + 2]];
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

  // the first tetrahedron: the widest pair of extremes, the point furthest from their line, the point furthest from that plane
  let a = 0, b = 0, wide = -1;
  const extremes = [...lo, ...hi];
  for (const x of extremes)
    for (const y of extremes) {
      const d = norm(sub(at(x), at(y)));
      if (d > wide) {
        wide = d;
        a = x;
        b = y;
      }
    }
  const ab = sub(at(b), at(a));
  let c = -1, far = eps;
  for (let v = 0; v < n; v++) {
    if (v % YIELD_EVERY === 0) yield;
    const d = norm(cross(ab, sub(at(v), at(a)))) / (wide || 1);
    if (d > far) {
      far = d;
      c = v;
    }
  }
  // all on one line: its two ends
  if (c < 0) return Uint32Array.of(a, b);
  const base = cross(ab, sub(at(c), at(a)));
  const baseLen = norm(base);
  const unitBase: Vec3 = [base[0] / baseLen, base[1] / baseLen, base[2] / baseLen];
  const planeD = (v: number) => {
    const q = sub(at(v), at(a));
    return q[0] * unitBase[0] + q[1] * unitBase[1] + q[2] * unitBase[2];
  };
  let d4 = -1, height = eps;
  for (let v = 0; v < n; v++) {
    if (v % YIELD_EVERY === 0) yield;
    const h = Math.abs(planeD(v));
    if (h > height) {
      height = h;
      d4 = v;
    }
  }
  const apex = n;
  const helper = d4 < 0;
  if (helper) {
    // a flat set: an apex off its plane, so the hull of the set is the base of a pyramid
    const m = at(a);
    for (let k = 0; k < 3; k++) P[3 * apex + k] = (m[k] + P[3 * b + k] + P[3 * c + k]) / 3 + unitBase[k] * size;
    d4 = apex;
  }

  // faces: three vertices, a plane, three neighbours (side k runs from vertex k to k + 1), the points outside
  const fv: number[] = [], fn: number[] = [], fo: number[] = [], fNbr: number[] = [];
  const alive: boolean[] = [];
  const outside: number[][] = [];
  const addFace = (x: number, y: number, z: number): number => {
    const f = alive.length;
    const nrm = cross(sub(at(y), at(x)), sub(at(z), at(x)));
    const l = norm(nrm) || 1;
    const u: Vec3 = [nrm[0] / l, nrm[1] / l, nrm[2] / l];
    fv.push(x, y, z);
    fn.push(u[0], u[1], u[2]);
    fo.push(u[0] * P[3 * x] + u[1] * P[3 * x + 1] + u[2] * P[3 * x + 2]);
    fNbr.push(-1, -1, -1);
    alive.push(true);
    outside.push([]);
    return f;
  };
  const distance = (f: number, v: number) => fn[3 * f] * P[3 * v] + fn[3 * f + 1] * P[3 * v + 1] + fn[3 * f + 2] * P[3 * v + 2] - fo[f];
  // the tetrahedron, faces outward
  const flip = helper || planeD(d4) > 0;
  const [p0, p1, p2] = flip ? [a, c, b] : [a, b, c];
  const f0 = addFace(p0, p1, p2);
  const f1 = addFace(p0, d4, p1);
  const f2 = addFace(p1, d4, p2);
  const f3 = addFace(p2, d4, p0);
  fNbr.splice(0, 12, f1, f2, f3, f3, f2, f0, f1, f3, f0, f2, f1, f0);
  // every point goes to the first face it is outside of
  for (let v = 0; v < n; v++) {
    if (v % YIELD_EVERY === 0) yield;
    for (const f of [f0, f1, f2, f3])
      if (distance(f, v) > eps) {
        outside[f].push(v);
        break;
      }
  }
  const open: number[] = [f0, f1, f2, f3].filter((f) => outside[f].length);
  let work = 0;
  while (open.length) {
    const f = open.pop()!;
    if (!alive[f] || !outside[f].length) continue;
    // the point furthest out
    let eye = outside[f][0], top = -Infinity;
    for (const v of outside[f]) {
      const d = distance(f, v);
      if (d > top) {
        top = d;
        eye = v;
      }
    }
    // the faces the eye sees, and the edges round them (by the visible face and its side)
    const visible = new Set<number>([f]);
    const horizon: Array<[number, number]> = [];
    const stack = [f];
    while (stack.length) {
      const cur = stack.pop()!;
      for (let side = 0; side < 3; side++) {
        const nb = fNbr[3 * cur + side];
        if (visible.has(nb)) continue;
        if (distance(nb, eye) > eps) {
          visible.add(nb);
          stack.push(nb);
        } else horizon.push([cur, side]);
      }
    }
    // new faces from the eye to each horizon edge
    const made: number[] = [];
    const madeAt = new Map<number, number>();
    for (const [cur, side] of horizon) {
      const x = fv[3 * cur + side], y = fv[3 * cur + ((side + 1) % 3)];
      const nb = fNbr[3 * cur + side];
      const g = addFace(x, y, eye);
      made.push(g);
      madeAt.set(3 * cur + side, g);
      fNbr[3 * g] = nb;
      for (let k = 0; k < 3; k++) if (fv[3 * nb + k] === y && fv[3 * nb + ((k + 1) % 3)] === x) fNbr[3 * nb + k] = g;
    }
    // each new face meets the next along the edge y → eye: the next horizon edge going round y through the
    // visible faces (with the tolerance the edge may touch itself at a vertex, so the vertex alone does not say)
    horizon.forEach(([cur, side], i) => {
      const g = made[i];
      const y = fv[3 * cur + ((side + 1) % 3)];
      let face = cur, s = (side + 1) % 3;
      for (let guard = 0; guard < 4096; guard++) {
        const key = 3 * face + s;
        const next = madeAt.get(key);
        if (next !== undefined) {
          fNbr[3 * g + 1] = next;
          fNbr[3 * next + 2] = g;
          return;
        }
        const nb = fNbr[key];
        const z = fv[3 * face + ((s + 1) % 3)];
        const j = [0, 1, 2].find((k) => fv[3 * nb + k] === z && fv[3 * nb + ((k + 1) % 3)] === y)!;
        face = nb;
        s = (j + 1) % 3;
      }
    });
    // the points of the faces that go, to the new faces
    for (const g of visible) {
      alive[g] = false;
      for (const v of outside[g]) {
        if (v === eye) continue;
        if (++work % YIELD_EVERY === 0) yield;
        for (const h of made)
          if (distance(h, v) > eps) {
            outside[h].push(v);
            break;
          }
      }
      outside[g] = [];
    }
    for (const g of made) if (outside[g].length) open.push(g);
  }
  return leftovers(alive, fv, outside, helper ? apex : -1);
}

function leftovers(alive: boolean[], fv: number[], outside: number[][], skip: number): Uint32Array {
  const seen = new Set<number>();
  for (let f = 0; f < alive.length; f++) {
    if (!alive[f]) continue;
    for (let k = 0; k < 3; k++) if (fv[3 * f + k] !== skip) seen.add(fv[3 * f + k]);
    for (const v of outside[f]) seen.add(v);
  }
  return Uint32Array.from(seen);
}

export const convexHull = (positions: ArrayLike<number>): Uint32Array => runSync(convexHullSteps(positions));

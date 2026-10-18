import type { Vec3 } from '../core/types';
import { partitionFacesSteps, type EdgeTable } from './meshGeometry';
import { YIELD_EVERY, type Steps } from './steps';

export interface VolumeSplit {
  upper: number;
  lower: number;
  /** upper / lower (null when the lower part is empty). */
  ratio: number | null;
}

const tet = (o: Vec3, p: ArrayLike<number>, a: number, b: number, c: number): number => {
  const ax = p[3 * a] - o[0], ay = p[3 * a + 1] - o[1], az = p[3 * a + 2] - o[2];
  const bx = p[3 * b] - o[0], by = p[3 * b + 1] - o[1], bz = p[3 * b + 2] - o[2];
  const cx = p[3 * c] - o[0], cy = p[3 * c + 1] - o[1], cz = p[3 * c + 2] - o[2];
  return (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
};

const tetPts = (o: Vec3, a: Vec3, b: Vec3, c: Vec3): number => {
  const ax = a[0] - o[0], ay = a[1] - o[1], az = a[2] - o[2];
  const bx = b[0] - o[0], by = b[1] - o[1], bz = b[2] - o[2];
  const cx = c[0] - o[0], cy = c[1] - o[1], cz = c[2] - o[2];
  return (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
};

/**
 * Split a closed mesh by a plane: the volume on the side `normal` points to
 * and the rest. Each part is closed by the section of the plane; with the
 * reference point on the plane those caps add no volume (divergence theorem),
 * so only the triangles (clipped at the plane) are summed.
 */
export function* splitByPlaneSteps(positions: ArrayLike<number>, index: ArrayLike<number>, point: Vec3, normal: Vec3): Steps<VolumeSplit> {
  const n = Math.floor(positions.length / 3);
  const d = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    if (v % YIELD_EVERY === 0) yield;
    d[v] = (positions[3 * v] - point[0]) * normal[0] + (positions[3 * v + 1] - point[1]) * normal[1] + (positions[3 * v + 2] - point[2]) * normal[2];
  }
  const P = (v: number): Vec3 => [positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]];
  const cut = (a: number, b: number): Vec3 => {
    const t = d[a] / (d[a] - d[b]);
    return [positions[3 * a] + t * (positions[3 * b] - positions[3 * a]), positions[3 * a + 1] + t * (positions[3 * b + 1] - positions[3 * a + 1]), positions[3 * a + 2] + t * (positions[3 * b + 2] - positions[3 * a + 2])];
  };
  let upper = 0, total = 0;
  for (let t = 0; t + 2 < index.length; t += 3) {
    if (t % YIELD_EVERY === 0) yield;
    const tri = [index[t], index[t + 1], index[t + 2]];
    total += tet(point, positions, tri[0], tri[1], tri[2]);
    const up = tri.map((v) => d[v] >= 0);
    const count = up.filter(Boolean).length;
    if (count === 3) upper += tet(point, positions, tri[0], tri[1], tri[2]);
    else if (count > 0) {
      // the part of the triangle on the upper side, keeping its winding
      const poly: Vec3[] = [];
      for (let k = 0; k < 3; k++) {
        const a = tri[k], b = tri[(k + 1) % 3];
        if (up[k]) poly.push(P(a));
        if (up[k] !== up[(k + 1) % 3]) poly.push(cut(a, b));
      }
      for (let k = 1; k + 1 < poly.length; k++) upper += tetPts(point, poly[0], poly[k], poly[k + 1]);
    }
  }
  // triangles may face inward: measure along the mesh's own orientation
  const sign = total < 0 ? -1 : 1;
  const u = upper * sign, all = total * sign;
  return { upper: u, lower: all - u, ratio: all - u > 0 ? u / (all - u) : null };
}

/**
 * Split a closed mesh along a closed chain of mesh edges (a closed curve): the
 * two sides are the two pieces of surface it separates, each closed by a fan
 * from the centre of the chain (which adds no volume with the centre as the
 * reference point). `normal` picks the upper side; null when the chain does
 * not separate the surface into exactly two pieces.
 */
export function* splitByLoopSteps(positions: ArrayLike<number>, index: ArrayLike<number>, edges: EdgeTable, chain: number[], normal: Vec3): Steps<VolumeSplit | null> {
  const { region, count } = yield* partitionFacesSteps(index, chain, edges);
  if (count !== 2) return null;
  const verts = new Set(chain);
  const o: Vec3 = [0, 0, 0];
  for (const v of verts) for (let k = 0; k < 3; k++) o[k] += positions[3 * v + k] / verts.size;
  const vol = [0, 0];
  const lean = [0, 0];
  for (let t = 0; 3 * t + 2 < index.length; t++) {
    if (t % YIELD_EVERY === 0) yield;
    const a = index[3 * t], b = index[3 * t + 1], c = index[3 * t + 2];
    const r = region[t];
    vol[r] += tet(o, positions, a, b, c);
    // which way the piece lies from the chain's centre, along the normal
    for (const v of [a, b, c]) lean[r] += (positions[3 * v] - o[0]) * normal[0] + (positions[3 * v + 1] - o[1]) * normal[1] + (positions[3 * v + 2] - o[2]) * normal[2];
  }
  const sign = vol[0] + vol[1] < 0 ? -1 : 1;
  const up = lean[0] >= lean[1] ? 0 : 1;
  const upper = vol[up] * sign, lower = vol[1 - up] * sign;
  return { upper, lower, ratio: lower > 0 ? upper / lower : null };
}

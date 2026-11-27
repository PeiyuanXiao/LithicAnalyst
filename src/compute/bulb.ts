import type { BsaSettings, Vec3 } from '../core/types';
import { symmetricEigen3 } from './linalg';
import { MAD_TO_SIGMA, weightedMedian } from './robust';
import { runSync, YIELD_EVERY, type Steps } from './steps';

/**
 * The bulb of percussion on a flake's ventral face, after Nagai 2026: the reference plane (the ventral face's least-squares plane),
 * the main bulb (where the face stands above a level of that plane, next to the point of percussion), its outline at that level,
 * the bulb surface angle (BSA) at P between the outline's two ends, and the vertical interval (VI) in strips from P to the bulb's top.
 * Pure: no DOM, no three.js; long loops yield.
 */

/** Where the bulb angle is taken along the ventral side of the section, from the platform (mm). */
export const BULB_ANGLE_DISTANCE_MM = 1.0;
/** The level of the bulb's outline above the reference plane (mm): its default, the range a specimen may set, and its step. */
export const BSA_LEVEL_DEFAULT_MM = 0.1;
export const BSA_LEVEL_RANGE_MM = [-1, 1] as const;
export const BSA_LEVEL_STEP_MM = 0.01;
/** A part above the level counts as the main bulb when it comes this near P (mm). */
export const BSA_NEAR_POP_MM = 2;
/** The widths of the strips the vertical interval is taken in (mm), and the spacing of its samples (mm). */
export const VI_WIDTHS_MM = [0.5, 1.0, 1.5] as const;
export const VI_SAMPLE_MM = 0.02;
/** The mesh's edges within this distance of P give its mean edge length there (mm). */
export const POP_MESH_RADIUS_MM = 2;
/** Above this mean edge length round P (mm) the mesh is too coarse there to trust the proximal measures: the card warns (no measure changes). */
export const POP_MESH_WARN_MM = 0.5;
/**
 * The BSA's reference: the plane of the ventral face within this distance of P (mm; at most half the technological length), fitted robustly:
 * at most BSA_REF_ITERATIONS times, those more than BSA_REF_TRIM_UP robust deviations above the median (the bulb), or more than
 * BSA_REF_TRIM deviations off it either way, left out.
 */
export const BSA_REF_RADIUS_MM = 10;
export const BSA_REF_ITERATIONS = 3;
export const BSA_REF_TRIM_UP = 2;
export const BSA_REF_TRIM = 3;
/** A bulb whose top is lower than this many of the surface's robust deviations is no bulb. */
export const BSA_MIN_PROMINENCE = 3;
/** A bulb reaching the ventral face's border farther than this from P (mm) is not closed at the sides. */
export const BSA_OPEN_REACH_MM = 2;

/** Shading by height: its range (±) in mm with a stated unit, and without one a share of the model's diagonal; lines of equal height every this share of the range. */
export const HEIGHT_RANGE_MM = { default: 0.25, min: 0.05, max: 5, step: 0.05 } as const;
export const HEIGHT_RANGE_DIAGONAL = 0.005;
export const HEIGHT_CONTOUR_SHARE = 0.4;

export const defaultBsaSettings = (): BsaSettings => ({ level: BSA_LEVEL_DEFAULT_MM, ends: null });
/** A flake's settings of the BSA (the default while it has none). */
export const bsaSettingsOf = (flake: { bsa?: BsaSettings }): BsaSettings => flake.bsa ?? defaultBsaSettings();
/** A level as it may be set: in the range, to the step. */
export const clampBsaLevel = (v: number): number => {
  const [lo, hi] = BSA_LEVEL_RANGE_MM;
  return Math.round(Math.max(lo, Math.min(hi, v)) / BSA_LEVEL_STEP_MM) * BSA_LEVEL_STEP_MM;
};

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

/** The angle between two directions, degrees (null for a zero vector). */
function angleDeg(u: Vec3, v: Vec3): number | null {
  const l = len(u) * len(v);
  if (!(l > 0)) return null;
  return (Math.acos(Math.max(-1, Math.min(1, dot(u, v) / l))) * 180) / Math.PI;
}

/** A plane: a point on it, its unit normal, and two unit directions in it (`y`: the technological +Y laid on it; `x` = normal × y). */
export interface BulbPlane {
  point: Vec3;
  normal: Vec3;
  x: Vec3;
  y: Vec3;
}

/** Where a point lies over the plane: across (`u`, along `x`), along (`v`, along `y`) and above it (`h`, along the normal). */
export function planeCoords(plane: BulbPlane, p: Vec3): [number, number, number] {
  const d = sub(p, plane.point);
  return [dot(d, plane.x), dot(d, plane.y), dot(d, plane.normal)];
}

/** The point of the plane at (`u`, `v`), raised by `h`. */
export const planePoint = (plane: BulbPlane, u: number, v: number, h = 0): Vec3 => add(add(add(plane.point, plane.x, u), plane.y, v), plane.normal, h);

/** A point laid onto the plane. */
export const onPlane = (plane: BulbPlane, p: Vec3): Vec3 => add(p, plane.normal, -dot(sub(p, plane.point), plane.normal));

/**
 * The reference plane of a set of triangles: least squares over the surface itself (each triangle by its area, with its own second
 * moments), the normal on the side of `outward`; `y` is `along` laid onto the plane. Null for no area, or `along` square to the plane.
 */
export function* referencePlaneSteps(positions: ArrayLike<number>, index: ArrayLike<number>, faces: ArrayLike<number>, outward: Vec3, along: Vec3): Steps<BulbPlane | null> {
  if (!faces.length) return null;
  const v0 = index[3 * faces[0]];
  const o: Vec3 = [positions[3 * v0], positions[3 * v0 + 1], positions[3 * v0 + 2]];
  let total = 0;
  const m: Vec3 = [0, 0, 0];
  // Σ A (C + g gᵀ), C the triangle's own covariance: (1/12) Σᵢ (vᵢ − g)(vᵢ − g)ᵀ
  const s = new Float64Array(9);
  const at = (v: number): Vec3 => [positions[3 * v] - o[0], positions[3 * v + 1] - o[1], positions[3 * v + 2] - o[2]];
  for (let k = 0; k < faces.length; k++) {
    if (k % YIELD_EVERY === 0) yield;
    const t = faces[k];
    const a = at(index[3 * t]), b = at(index[3 * t + 1]), c = at(index[3 * t + 2]);
    const area = len(cross(sub(b, a), sub(c, a))) / 2;
    if (!(area > 0)) continue;
    const g: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    total += area;
    for (let i = 0; i < 3; i++) m[i] += area * g[i];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        let own = 0;
        for (const p of [a, b, c]) own += (p[i] - g[i]) * (p[j] - g[j]);
        s[3 * i + j] += area * (own / 12 + g[i] * g[j]);
      }
  }
  if (!(total > 0)) return null;
  const mean: Vec3 = [m[0] / total, m[1] / total, m[2] / total];
  const cov = new Array<number>(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[3 * i + j] = s[3 * i + j] / total - mean[i] * mean[j];
  let normal = symmetricEigen3(cov).vectors[2];
  if (dot(normal, outward) < 0) normal = [-normal[0], -normal[1], -normal[2]];
  const y = unit(add(along, normal, -dot(along, normal)));
  if (len(y) === 0) return null;
  return { point: add(o, mean), normal, x: cross(normal, y), y };
}

export const referencePlane = (positions: ArrayLike<number>, index: ArrayLike<number>, faces: ArrayLike<number>, outward: Vec3, along: Vec3): BulbPlane | null =>
  runSync(referencePlaneSteps(positions, index, faces, outward, along));

/** The proximal ventral plane: the plane, the surface's robust deviation from it (its noise), the triangles it was fitted to at last. */
export interface ProximalPlane {
  plane: BulbPlane;
  noise: number;
  fitted: Uint32Array;
}

/**
 * The ventral face's plane near P: the triangles of `faces` whose centroid lies within `radius` of P, but those `leftOut` (retouch,
 * damage), fitted by area (`referencePlaneSteps`); then, at most BSA_REF_ITERATIONS times, each centroid's signed distance r over the
 * plane (outward), their median m and robust deviation σ̂ (each triangle by its area, as in the fit, so a mesh finer in one place does not
 * weigh more there); the triangles with r − m > BSA_REF_TRIM_UP σ̂ (the bulb) or |r − m| > 3 σ̂ left out, and the rest fitted again, until
 * the rest stays the same. The noise is σ̂ as last taken. Null without triangles near P.
 */
export function* proximalPlaneSteps(positions: ArrayLike<number>, index: ArrayLike<number>, faces: ArrayLike<number>, leftOut: ArrayLike<number> | null, P: Vec3, radius: number, outward: Vec3, along: Vec3): Steps<ProximalPlane | null> {
  const left = new Set<number>();
  if (leftOut) for (let k = 0; k < leftOut.length; k++) left.add(leftOut[k]);
  const r2 = radius * radius;
  const near: number[] = [];
  const centre: number[] = [];
  const area: number[] = [];
  for (let k = 0; k < faces.length; k++) {
    if (k % YIELD_EVERY === 0) yield;
    const t = faces[k];
    if (left.has(t)) continue;
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < 3; j++) {
      const v = 3 * index[3 * t + j];
      cx += positions[v] / 3;
      cy += positions[v + 1] / 3;
      cz += positions[v + 2] / 3;
    }
    if ((cx - P[0]) ** 2 + (cy - P[1]) ** 2 + (cz - P[2]) ** 2 > r2) continue;
    near.push(t);
    centre.push(cx, cy, cz);
    const a = 3 * index[3 * t], b = 3 * index[3 * t + 1], c = 3 * index[3 * t + 2];
    const u: Vec3 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const w: Vec3 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    area.push(len(cross(u, w)) / 2);
  }
  const weights = Float64Array.from(area);
  if (!near.length) return null;
  const all = Uint32Array.from(near);
  let fitted = all;
  let plane = yield* referencePlaneSteps(positions, index, fitted, outward, along);
  if (!plane) return null;
  let noise = 0;
  const r = new Float64Array(near.length);
  for (let it = 0; it < BSA_REF_ITERATIONS; it++) {
    for (let k = 0; k < near.length; k++) {
      if (k % YIELD_EVERY === 0) yield;
      r[k] = (centre[3 * k] - plane.point[0]) * plane.normal[0] + (centre[3 * k + 1] - plane.point[1]) * plane.normal[1] + (centre[3 * k + 2] - plane.point[2]) * plane.normal[2];
    }
    // the median, then the deviation from it: each a pass of its own
    const m = weightedMedian(r, weights);
    yield;
    const sigma = MAD_TO_SIGMA * weightedMedian(Float64Array.from(r, (x) => Math.abs(x - m)), weights);
    noise = sigma;
    yield;
    const kept: number[] = [];
    for (let k = 0; k < near.length; k++) if (!(r[k] - m > BSA_REF_TRIM_UP * sigma) && !(Math.abs(r[k] - m) > BSA_REF_TRIM * sigma)) kept.push(near[k]);
    // the same as before: done
    if (kept.length === fitted.length && kept.every((t, i) => t === fitted[i])) break;
    if (!kept.length) break;
    const next = yield* referencePlaneSteps(positions, index, kept, outward, along);
    if (!next) break;
    fitted = Uint32Array.from(kept);
    plane = next;
  }
  return { plane, noise, fitted };
}

export const proximalPlane = (positions: ArrayLike<number>, index: ArrayLike<number>, faces: ArrayLike<number>, leftOut: ArrayLike<number> | null, P: Vec3, radius: number, outward: Vec3, along: Vec3): ProximalPlane | null =>
  runSync(proximalPlaneSteps(positions, index, faces, leftOut, P, radius, outward, along));

/** Every vertex's height above a plane (`point`, unit `normal`), as shading by height takes it. */
export function* heightsSteps(positions: ArrayLike<number>, point: Vec3, normal: Vec3): Steps<Float32Array> {
  const n = Math.floor(positions.length / 3);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (i % YIELD_EVERY === 0) yield;
    out[i] = (positions[3 * i] - point[0]) * normal[0] + (positions[3 * i + 1] - point[1]) * normal[1] + (positions[3 * i + 2] - point[2]) * normal[2];
  }
  return out;
}

/**
 * Where the heights of the vertices cross each level: one segment per triangle and level crossed (two points each, xyz flat). `faces`:
 * of these triangles only (null: all). Triangles a level only touches at a vertex give nothing.
 */
export function* isoSegmentsSteps(positions: ArrayLike<number>, index: ArrayLike<number>, heights: ArrayLike<number>, levels: readonly number[], faces: ArrayLike<number> | null = null): Steps<Float32Array[]> {
  const out = levels.map(() => [] as number[]);
  const count = faces ? faces.length : Math.floor(index.length / 3);
  const sorted = levels.map((l, i) => [l, i] as const).sort((a, b) => a[0] - b[0]);
  for (let k = 0; k < count; k++) {
    if (k % YIELD_EVERY === 0) yield;
    const t = faces ? faces[k] : k;
    const a = index[3 * t], b = index[3 * t + 1], c = index[3 * t + 2];
    const ha = heights[a], hb = heights[b], hc = heights[c];
    const lo = Math.min(ha, hb, hc), hi = Math.max(ha, hb, hc);
    if (!(hi > lo)) continue;
    for (const [level, li] of sorted) {
      if (level < lo || level > hi) continue;
      const pts: number[] = [];
      for (const [p, q, hp, hq] of [[a, b, ha, hb], [b, c, hb, hc], [c, a, hc, ha]] as const) {
        if ((hp < level) === (hq < level)) continue;
        const s = (level - hp) / (hq - hp);
        pts.push(positions[3 * p] + s * (positions[3 * q] - positions[3 * p]), positions[3 * p + 1] + s * (positions[3 * q + 1] - positions[3 * p + 1]), positions[3 * p + 2] + s * (positions[3 * q + 2] - positions[3 * p + 2]));
      }
      if (pts.length === 6) out[li].push(...pts);
    }
  }
  return out.map((x) => Float32Array.from(x));
}

/** The vertices the triangles use, once each. */
function usedVertices(index: ArrayLike<number>, faces: ArrayLike<number>, vertexCount: number): Uint32Array {
  const seen = new Uint8Array(vertexCount);
  const out: number[] = [];
  for (let k = 0; k < faces.length; k++) {
    const t = faces[k];
    for (let j = 0; j < 3; j++) {
      const v = index[3 * t + j];
      if (!seen[v]) {
        seen[v] = 1;
        out.push(v);
      }
    }
  }
  return Uint32Array.from(out);
}

export interface BulbInput {
  /** All in the same coordinates (the mesh's). */
  positions: ArrayLike<number>;
  index: ArrayLike<number>;
  /** Triangles of the ventral face. */
  faces: ArrayLike<number>;
  plane: BulbPlane;
  /** The point of percussion. */
  P: Vec3;
  /** Millimetres per coordinate unit. */
  mm: number;
  /** The level, in mm. */
  level: number;
  /** The two ends set by hand, or null: the outline's. */
  ends: readonly [Vec3, Vec3] | null;
  /** The surface's noise over the plane (its robust deviation, coordinate units): a top lower than BSA_MIN_PROMINENCE of it is no bulb. */
  noise: number;
}

/** A strip of the vertical interval: its corners on the plane, its value, and where its highest and lowest samples lie (on the surface). */
export interface ViStrip {
  width: number;
  corners: [Vec3, Vec3, Vec3, Vec3];
  value: number | null;
  high: Vec3 | null;
  low: Vec3 | null;
}

export type BulbEmpty = 'no_bulb' | 'bulb_one_side' | 'bulb_open';

export interface BulbResult {
  plane: BulbPlane;
  /** P laid onto the plane. */
  P0: Vec3;
  /** The main bulb's outline at the level, on the surface (none when there is no bulb). */
  contour: Array<{ points: Vec3[]; closed: boolean }>;
  /** The ends of the outline (the farthest round from the technological axis each way, left first), or null. */
  autoEnds: [Vec3, Vec3] | null;
  /** The ends the angle is taken at: those set by hand, else the outline's. */
  ends: [Vec3, Vec3] | null;
  bsa: number | null;
  /** Why the BSA is empty. */
  bsaEmpty: BulbEmpty | null;
  /** The bulb's top: its highest vertex. */
  apex: Vec3 | null;
  /** The strips, by `VI_WIDTHS_MM`. */
  vi: ViStrip[] | null;
  /** The bulb with P, on the plane: u (across, along `x`) and v (along `y`) ranges from P on the plane, coordinate units. */
  extent: { u0: number; u1: number; v0: number; v1: number } | null;
  /** The main bulb's vertices (where IPA's band starts from): only of a bulb that is one (above the noise, closed at the sides); else null. */
  region: Uint32Array | null;
}

/** The point of the ventral surface over (`u`, `v`) of the plane: the outermost where several lie over it (null: none). In steps. */
export function* surfaceOverSteps(positions: ArrayLike<number>, index: ArrayLike<number>, faces: ArrayLike<number>, plane: BulbPlane, u: number, v: number): Steps<Vec3 | null> {
  let best = -Infinity;
  const [o, x, y] = [plane.point, plane.x, plane.y];
  const corner = (w: number): Vec3 => planeCoords(plane, [positions[3 * w], positions[3 * w + 1], positions[3 * w + 2]]);
  for (let k = 0; k < faces.length; k++) {
    if (k % YIELD_EVERY === 0) yield;
    const t = faces[k];
    const a = index[3 * t], b = index[3 * t + 1], c = index[3 * t + 2];
    // across and along first: most triangles lie elsewhere
    const ua = (positions[3 * a] - o[0]) * x[0] + (positions[3 * a + 1] - o[1]) * x[1] + (positions[3 * a + 2] - o[2]) * x[2];
    const ub = (positions[3 * b] - o[0]) * x[0] + (positions[3 * b + 1] - o[1]) * x[1] + (positions[3 * b + 2] - o[2]) * x[2];
    const uc = (positions[3 * c] - o[0]) * x[0] + (positions[3 * c + 1] - o[1]) * x[1] + (positions[3 * c + 2] - o[2]) * x[2];
    if (u < Math.min(ua, ub, uc) || u > Math.max(ua, ub, uc)) continue;
    const va = (positions[3 * a] - o[0]) * y[0] + (positions[3 * a + 1] - o[1]) * y[1] + (positions[3 * a + 2] - o[2]) * y[2];
    const vb = (positions[3 * b] - o[0]) * y[0] + (positions[3 * b + 1] - o[1]) * y[1] + (positions[3 * b + 2] - o[2]) * y[2];
    const vc = (positions[3 * c] - o[0]) * y[0] + (positions[3 * c + 1] - o[1]) * y[1] + (positions[3 * c + 2] - o[2]) * y[2];
    if (v < Math.min(va, vb, vc) || v > Math.max(va, vb, vc)) continue;
    const h = barycentricHeight(corner(a), corner(b), corner(c), u, v);
    if (h !== null && h > best) best = h;
  }
  return best > -Infinity ? planePoint(plane, u, v, best) : null;
}

export const surfaceOver = (positions: ArrayLike<number>, index: ArrayLike<number>, faces: ArrayLike<number>, plane: BulbPlane, u: number, v: number): Vec3 | null =>
  runSync(surfaceOverSteps(positions, index, faces, plane, u, v));

/** The height over (`u`, `v`) of the triangle with corners (u, v, h), or null outside it. */
function barycentricHeight(a: readonly number[], b: readonly number[], c: readonly number[], u: number, v: number): number | null {
  const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(det) < 1e-300) return null;
  const l1 = ((b[1] - c[1]) * (u - c[0]) + (c[0] - b[0]) * (v - c[1])) / det;
  const l2 = ((c[1] - a[1]) * (u - c[0]) + (a[0] - c[0]) * (v - c[1])) / det;
  const l3 = 1 - l1 - l2;
  const eps = 1e-9;
  if (l1 < -eps || l2 < -eps || l3 < -eps) return null;
  return l1 * a[2] + l2 * b[2] + l3 * c[2];
}

/**
 * The main bulb and what is measured on it. The ventral vertices at or above the level (in mm, over the plane) are joined along the
 * triangles' edges into parts; the main bulb is the part that comes nearest P, within BSA_NEAR_POP_MM (of two as near, the larger). Its
 * outline is where the triangles round it cross the level (the iso-line alone, not the face's border). The ends are the outline's
 * points farthest round from the technological axis (+Y laid on the plane, as seen from P on the plane) each way; BSA is the angle at P
 * between the lines to them, on the plane. The vertical interval of a strip from P to the bulb's top (its highest vertex), `w` wide:
 * the range of the heights of the surface over it, sampled every VI_SAMPLE_MM.
 * No bulb (none near P, no outline, or a top below BSA_MIN_PROMINENCE × the noise): no BSA and no VI, whatever the ends. A bulb reaching
 * the ventral face's border farther than BSA_OPEN_REACH_MM from P is not closed at the sides: no BSA and no VI either, unless the ends
 * were set by hand.
 */
export function* bulbSteps(input: BulbInput): Steps<BulbResult> {
  const { positions, index, faces, plane, P, mm } = input;
  const n = Math.floor(positions.length / 3);
  const level = input.level / mm;
  const near = BSA_NEAR_POP_MM / mm;
  const P0 = onPlane(plane, P);
  const pos = (v: number): Vec3 => [positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]];
  const out: BulbResult = { plane, P0, contour: [], autoEnds: null, ends: input.ends ? [input.ends[0], input.ends[1]] : null, bsa: null, bsaEmpty: null, apex: null, vi: null, extent: null, region: null };
  const angleAt = (ends: readonly [Vec3, Vec3]) => angleDeg(sub(onPlane(plane, ends[0]), P0), sub(onPlane(plane, ends[1]), P0));
  /** The main bulb's vertices, kept for IPA when it proves a bulb. */
  let region: Uint32Array | null = null;
  const finish = (empty: BulbEmpty | null): BulbResult => {
    // no bulb: nothing, whatever the ends (the index is of a bulb)
    if (empty === 'no_bulb') {
      out.vi = null;
      out.bsaEmpty = empty;
      return out;
    }
    // ends set by hand stand whatever the outline does
    if (input.ends) out.bsa = angleAt(input.ends);
    else if (empty) {
      out.bsaEmpty = empty;
      if (empty === 'bulb_open') out.vi = null;
    } else if (out.ends) out.bsa = angleAt(out.ends);
    if (empty !== 'bulb_open') out.region = region;
    return out;
  };

  // heights of the ventral vertices
  const h = new Float64Array(n).fill(NaN);
  const verts = usedVertices(index, faces, n);
  for (let k = 0; k < verts.length; k++) {
    if (k % YIELD_EVERY === 0) yield;
    const v = verts[k];
    h[v] = dot(sub(pos(v), plane.point), plane.normal);
  }

  // the parts at or above the level, joined along the triangles' edges
  const parent = new Int32Array(n).fill(-1);
  for (let k = 0; k < verts.length; k++) if (h[verts[k]] >= level) parent[verts[k]] = verts[k];
  const find = (v: number): number => {
    while (parent[v] !== v) {
      parent[v] = parent[parent[v]];
      v = parent[v];
    }
    return v;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  for (let k = 0; k < faces.length; k++) {
    if (k % YIELD_EVERY === 0) yield;
    const t = faces[k];
    const a = index[3 * t], b = index[3 * t + 1], c = index[3 * t + 2];
    if (parent[a] >= 0 && parent[b] >= 0) union(a, b);
    if (parent[b] >= 0 && parent[c] >= 0) union(b, c);
    if (parent[c] >= 0 && parent[a] >= 0) union(c, a);
  }
  // each part: how near it comes to P, and its area (a triangle's third for each of its corners in it)
  const nearest = new Map<number, number>();
  const area = new Map<number, number>();
  for (let k = 0; k < verts.length; k++) {
    if (k % YIELD_EVERY === 0) yield;
    const v = verts[k];
    if (parent[v] < 0) continue;
    const r = find(v);
    const d = len(sub(pos(v), P));
    if (d < (nearest.get(r) ?? Infinity)) nearest.set(r, d);
  }
  for (let k = 0; k < faces.length; k++) {
    if (k % YIELD_EVERY === 0) yield;
    const t = faces[k];
    const a = index[3 * t], b = index[3 * t + 1], c = index[3 * t + 2];
    const third = len(cross(sub(pos(b), pos(a)), sub(pos(c), pos(a)))) / 6;
    for (const v of [a, b, c]) if (parent[v] >= 0) area.set(find(v), (area.get(find(v)) ?? 0) + third);
  }
  let main = -1;
  for (const [r, d] of nearest) {
    if (d > near) continue;
    const best = main >= 0 ? nearest.get(main)! : Infinity;
    if (d < best - 1e-12 || (Math.abs(d - best) <= 1e-12 && (area.get(r) ?? 0) > (area.get(main) ?? 0))) main = r;
  }
  if (main < 0) return finish('no_bulb');
  const inMain = (v: number) => parent[v] >= 0 && find(v) === main;

  // its top, and its extent with P on the plane
  let top = -1;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  const extend = (q: Vec3) => {
    const d = sub(q, P0);
    const u = dot(d, plane.x), v = dot(d, plane.y);
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  };
  extend(P);
  const inRegion: number[] = [];
  for (let k = 0; k < verts.length; k++) {
    if (k % YIELD_EVERY === 0) yield;
    const v = verts[k];
    if (!inMain(v)) continue;
    inRegion.push(v);
    if (top < 0 || h[v] > h[top]) top = v;
    extend(pos(v));
  }
  region = Uint32Array.from(inRegion);
  out.apex = pos(top);
  out.extent = { u0, u1, v0, v1 };
  // no higher than the surface's noise: no bulb
  if (h[top] < BSA_MIN_PROMINENCE * input.noise) return finish('no_bulb');

  // closed at the sides: none of it on the ventral face's border farther than BSA_OPEN_REACH_MM from P (its border: the edges of one triangle only)
  const reach = BSA_OPEN_REACH_MM / mm;
  const edgeUses = new Map<number, number>();
  for (let k = 0; k < faces.length; k++) {
    if (k % YIELD_EVERY === 0) yield;
    const t = faces[k];
    const a = index[3 * t], b = index[3 * t + 1], c = index[3 * t + 2];
    if (!inMain(a) && !inMain(b) && !inMain(c)) continue;
    for (const [u, w] of [[a, b], [b, c], [c, a]]) {
      const key = u < w ? u * n + w : w * n + u;
      edgeUses.set(key, (edgeUses.get(key) ?? 0) + 1);
    }
  }
  let open = false;
  for (const [key, uses] of edgeUses) {
    if (uses !== 1) continue;
    const u = Math.floor(key / n), w = key - u * n;
    if ((inMain(u) && len(sub(pos(u), P)) > reach) || (inMain(w) && len(sub(pos(w), P)) > reach)) open = true;
  }

  // the outline: where the triangles round the bulb cross the level, joined into lines
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const segs: Array<{ keys: [string, string]; points: [Vec3, Vec3] }> = [];
  for (let k = 0; k < faces.length; k++) {
    if (k % YIELD_EVERY === 0) yield;
    const t = faces[k];
    const tri = [index[3 * t], index[3 * t + 1], index[3 * t + 2]];
    const inside = tri.map(inMain);
    const count = inside.filter(Boolean).length;
    if (count === 0 || count === 3) continue;
    const keys: string[] = [];
    const points: Vec3[] = [];
    for (let j = 0; j < 3; j++) {
      const a = tri[j], b = tri[(j + 1) % 3];
      if (inside[j] === inside[(j + 1) % 3]) continue;
      const [hi, lo] = inside[j] ? [a, b] : [b, a];
      const s = (level - h[hi]) / (h[lo] - h[hi]);
      keys.push(key(a, b));
      points.push(add(pos(hi), sub(pos(lo), pos(hi)), Math.max(0, Math.min(1, s))));
    }
    if (points.length === 2) segs.push({ keys: [keys[0], keys[1]], points: [points[0], points[1]] });
  }
  const byKey = new Map<string, number[]>();
  segs.forEach((s, i) => s.keys.forEach((k) => byKey.set(k, [...(byKey.get(k) ?? []), i])));
  const used = new Uint8Array(segs.length);
  const pointOf = new Map<string, Vec3>();
  for (const s of segs) s.keys.forEach((k, j) => pointOf.set(k, s.points[j]));
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const chain = [...segs[i].keys];
    // on from one end, then from the other
    for (const forward of [true, false]) {
      for (;;) {
        const end = forward ? chain[chain.length - 1] : chain[0];
        const next = (byKey.get(end) ?? []).find((j) => !used[j]);
        if (next === undefined) break;
        used[next] = 1;
        const other = segs[next].keys[0] === end ? segs[next].keys[1] : segs[next].keys[0];
        if (forward) chain.push(other);
        else chain.unshift(other);
      }
    }
    const closed = chain.length > 2 && chain[0] === chain[chain.length - 1];
    if (closed) chain.pop();
    out.contour.push({ points: chain.map((k) => pointOf.get(k)!), closed });
  }
  // no outline: no bulb, unless it runs out at the sides (then it is open, and ends set by hand still give the angle)
  if (!out.contour.length && !open) return finish('no_bulb');

  // the ends: the outline's points farthest round from +Y each way, as seen from P on the plane
  let lo: Vec3 | null = null, hi: Vec3 | null = null, aLo = Infinity, aHi = -Infinity;
  for (const c of out.contour)
    for (const q of c.points) {
      const d = sub(q, P0);
      const az = Math.atan2(dot(d, plane.x), dot(d, plane.y));
      if (az < aLo) {
        aLo = az;
        lo = q;
      }
      if (az > aHi) {
        aHi = az;
        hi = q;
      }
    }
  const oneSide = !(aLo < 0 && aHi > 0);
  if (lo && hi && !oneSide) out.autoEnds = [lo, hi];
  if (!out.ends && out.autoEnds) out.ends = out.autoEnds;

  // the vertical interval: strips from P to the top, sampled over the surface
  const axisEnd = onPlane(plane, out.apex);
  const along = sub(axisEnd, P0);
  const length = len(along);
  if (length > 1e-12) {
    const dir = unit(along), across = cross(plane.normal, dir);
    const step = VI_SAMPLE_MM / mm;
    const widest = Math.max(...VI_WIDTHS_MM) / 2 / mm;
    const I = Math.floor(length / step + 1e-9), J = Math.floor(widest / step + 1e-9);
    const cols = 2 * J + 1;
    const grid = new Float64Array((I + 1) * cols).fill(-Infinity);
    // each triangle over the strip: the samples inside it take its height, the outermost of several
    for (let k = 0; k < faces.length; k++) {
      if (k % YIELD_EVERY === 0) yield;
      const t = faces[k];
      const c = [0, 1, 2].map((j) => {
        const w = index[3 * t + j];
        const d = sub(pos(w), P0);
        return [dot(d, dir), dot(d, across), h[w]];
      });
      const s0 = Math.min(c[0][0], c[1][0], c[2][0]), s1 = Math.max(c[0][0], c[1][0], c[2][0]);
      const t0 = Math.min(c[0][1], c[1][1], c[2][1]), t1 = Math.max(c[0][1], c[1][1], c[2][1]);
      if (s1 < -1e-9 || s0 > length + 1e-9 || t1 < -widest - 1e-9 || t0 > widest + 1e-9) continue;
      for (let i = Math.max(0, Math.ceil(s0 / step - 1e-9)); i <= Math.min(I, Math.floor(s1 / step + 1e-9)); i++)
        for (let j = Math.max(-J, Math.ceil(t0 / step - 1e-9)); j <= Math.min(J, Math.floor(t1 / step + 1e-9)); j++) {
          const z = barycentricHeight(c[0], c[1], c[2], i * step, j * step);
          if (z !== null && z > grid[i * cols + j + J]) grid[i * cols + j + J] = z;
        }
    }
    yield;
    out.vi = VI_WIDTHS_MM.map((w): ViStrip => {
      const half = w / 2 / mm;
      const hj = Math.floor(half / step + 1e-9);
      let maxV = -Infinity, minV = Infinity, maxAt: [number, number] = [0, 0], minAt: [number, number] = [0, 0];
      for (let i = 0; i <= I; i++)
        for (let j = -hj; j <= hj; j++) {
          const z = grid[i * cols + j + J];
          if (!Number.isFinite(z)) continue;
          if (z > maxV) {
            maxV = z;
            maxAt = [i, j];
          }
          if (z < minV) {
            minV = z;
            minAt = [i, j];
          }
        }
      const corner = (s: number, tt: number) => add(add(P0, dir, s), across, tt);
      const corners: [Vec3, Vec3, Vec3, Vec3] = [corner(0, -half), corner(length, -half), corner(length, half), corner(0, half)];
      if (!(maxV > -Infinity)) return { width: w, corners, value: null, high: null, low: null };
      const surface = ([i, j]: [number, number], z: number) => add(add(add(P0, dir, i * step), across, j * step), plane.normal, z);
      return { width: w, corners, value: maxV - minV, high: surface(maxAt, maxV), low: surface(minAt, minV) };
    });
  }
  return finish(open ? 'bulb_open' : !out.autoEnds ? 'bulb_one_side' : null);
}

export const bulb = (input: BulbInput): BulbResult => runSync(bulbSteps(input));

/**
 * The mean length of the mesh's edges with both ends within `radius` of P (null: none), and those edges (their ends by twos). `edges`:
 * each once, else every triangle's (as wound).
 */
export function* meshEdgeNearSteps(positions: ArrayLike<number>, index: ArrayLike<number>, P: Vec3, radius: number, edges: { v0: ArrayLike<number>; v1: ArrayLike<number> } | null): Steps<{ mean: number | null; segments: Vec3[] }> {
  const segments: Vec3[] = [];
  const vertex = (v: number): Vec3 => [positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]];
  const r2 = radius * radius;
  const inside = (v: number) => (positions[3 * v] - P[0]) ** 2 + (positions[3 * v + 1] - P[1]) ** 2 + (positions[3 * v + 2] - P[2]) ** 2 <= r2;
  const length = (a: number, b: number) => Math.hypot(positions[3 * a] - positions[3 * b], positions[3 * a + 1] - positions[3 * b + 1], positions[3 * a + 2] - positions[3 * b + 2]);
  let sum = 0, count = 0;
  if (edges) {
    for (let i = 0; i < edges.v0.length; i++) {
      if (i % YIELD_EVERY === 0) yield;
      const a = edges.v0[i], b = edges.v1[i];
      if (inside(a) && inside(b)) {
        sum += length(a, b);
        count++;
        segments.push(vertex(a), vertex(b));
      }
    }
  } else {
    // every edge once: the triangles on either side of it go round it opposite ways
    for (let k = 0; 3 * k + 2 < index.length; k++) {
      if (k % YIELD_EVERY === 0) yield;
      for (let j = 0; j < 3; j++) {
        const a = index[3 * k + j], b = index[3 * k + ((j + 1) % 3)];
        if (a < b && inside(a) && inside(b)) {
          sum += length(a, b);
          count++;
          segments.push(vertex(a), vertex(b));
        }
      }
    }
  }
  return { mean: count ? sum / count : null, segments };
}

/** At most this many lines of equal height over the bulb page's window (the interval is doubled until they fit). */
export const WINDOW_CONTOUR_MAX = 60;

/**
 * The lines of equal height over a window of the plane (u, v from `origin` laid on it; `origin` is P): every `interval`, at its
 * multiples within the heights there, and at `level` (null: none); of the triangles with a corner in the window. Segments by twos.
 */
export function* windowContoursSteps(positions: ArrayLike<number>, index: ArrayLike<number>, faces: ArrayLike<number>, plane: BulbPlane, origin: Vec3, window: { u0: number; u1: number; v0: number; v1: number }, interval: number, level: number | null): Steps<Array<{ level: number; segments: Vec3[] }>> {
  const n = Math.floor(positions.length / 3);
  const o = onPlane(plane, origin);
  const heights = new Float32Array(n);
  const kept: number[] = [];
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < faces.length; k++) {
    if (k % YIELD_EVERY === 0) yield;
    const t = faces[k];
    let inside = false;
    const hs: number[] = [];
    for (let j = 0; j < 3; j++) {
      const v = index[3 * t + j];
      const p: Vec3 = [positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]];
      const d = sub(p, o);
      const u = dot(d, plane.x), w = dot(d, plane.y);
      const h = dot(sub(p, plane.point), plane.normal);
      heights[v] = h;
      hs.push(h);
      if (u >= window.u0 && u <= window.u1 && w >= window.v0 && w <= window.v1) inside = true;
    }
    if (!inside) continue;
    kept.push(t);
    lo = Math.min(lo, ...hs);
    hi = Math.max(hi, ...hs);
  }
  if (!kept.length || !(interval > 0)) return [];
  let step = interval;
  while (Math.floor(hi / step) - Math.ceil(lo / step) + 1 > WINDOW_CONTOUR_MAX) step *= 2;
  const levels: number[] = [];
  for (let k = Math.ceil(lo / step); k <= Math.floor(hi / step); k++) levels.push(k * step);
  if (level !== null && !levels.some((l) => Math.abs(l - level) < 1e-12)) levels.push(level);
  const lines = yield* isoSegmentsSteps(positions, index, heights, levels, Uint32Array.from(kept));
  return levels.map((l, i) => {
    const s = lines[i];
    const segments: Vec3[] = [];
    for (let j = 0; j + 2 < s.length; j += 3) segments.push([s[j], s[j + 1], s[j + 2]]);
    return { level: l, segments };
  });
}

/** The bulb page's window round the bulb and P: a margin of this share of their extent each side, square, at least this many mm across. */
export const BULB_WINDOW = { MARGIN_SHARE: 0.3, MIN_MM: 3 } as const;

/** The square window (u, v from P on the plane) the bulb page shows. */
export function bulbWindow(extent: { u0: number; u1: number; v0: number; v1: number }, mm: number): { u0: number; u1: number; v0: number; v1: number } {
  const least = BULB_WINDOW.MIN_MM / mm;
  const wu = Math.max((extent.u1 - extent.u0) * (1 + 2 * BULB_WINDOW.MARGIN_SHARE), least);
  const wv = Math.max((extent.v1 - extent.v0) * (1 + 2 * BULB_WINDOW.MARGIN_SHARE), least);
  const side = Math.max(wu, wv);
  const cu = (extent.u0 + extent.u1) / 2, cv = (extent.v0 + extent.v1) / 2;
  return { u0: cu - side / 2, u1: cu + side / 2, v0: cv - side / 2, v1: cv + side / 2 };
}

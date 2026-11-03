import { frameAxes, frameMatrix, type FrameAxes } from '../core/frame';
import type { Vec3 } from '../core/types';
import { runSync, YIELD_EVERY, type Steps } from './steps';

/**
 * The flake's technical frame from its technical axis (arrow from the point of
 * percussion P toward the distal end A, on the ventral face): origin P, +Z toward
 * the dorsal face, +Y distal, +X = Y × Z. Stored as a matrix; nothing moves.
 */

/** Half the width of the strip along P→A whose triangles give the ventral normal, as a share of |PA|. */
export const STRIP_HALF_WIDTH_RATIO = 0.1;
/** Triangles this far (degrees) from the strip's mean normal are left out of the second pass. */
export const STRIP_NORMAL_OUTLIER_DEG = 60;
/** Fewer triangles left than this: no frame. */
export const MIN_STRIP_TRIANGLES = 10;
/** An arrow shorter than this many mean edge lengths: no frame. */
export const MIN_AXIS_EDGES = 5;

/** `short`: the arrow is too short; `few`: too few triangles along it. */
export type AxisFailure = 'short' | 'few';

export type TechnicalFrame = { ok: true; matrix: number[]; axes: FrameAxes; triangles: number } | { ok: false; reason: AxisFailure };

export interface TechnicalFrameInput {
  /** Positions relative to `offset` (P and A are in original coordinates). */
  positions: ArrayLike<number>;
  index: ArrayLike<number>;
  offset?: Vec3;
  /** +1 when triangles face outward, −1 when inward. */
  orientationSign?: number;
  /** Mean edge length of the mesh. */
  meanEdge: number;
}

export function* technicalFrameSteps(input: TechnicalFrameInput, P: Vec3, A: Vec3): Steps<TechnicalFrame> {
  const { positions: p, index, meanEdge } = input;
  const o = input.offset ?? [0, 0, 0];
  const sign = input.orientationSign ?? 1;
  const px = P[0] - o[0], py = P[1] - o[1], pz = P[2] - o[2];
  const dx = A[0] - P[0], dy = A[1] - P[1], dz = A[2] - P[2];
  const len2 = dx * dx + dy * dy + dz * dz;
  const len = Math.sqrt(len2);
  if (!(len >= MIN_AXIS_EDGES * meanEdge) || !(len > 0)) return { ok: false, reason: 'short' };
  const limit2 = (STRIP_HALF_WIDTH_RATIO * len) ** 2;
  // the strip's outward normals (area-weighted: the cross products)
  const normals: number[] = [];
  let mx = 0, my = 0, mz = 0;
  const tris = Math.floor(index.length / 3);
  for (let t = 0; t < tris; t++) {
    if (t % YIELD_EVERY === 0) yield;
    const a = 3 * index[3 * t], b = 3 * index[3 * t + 1], c = 3 * index[3 * t + 2];
    const cx = (p[a] + p[b] + p[c]) / 3 - px, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3 - py, cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3 - pz;
    const s = Math.max(0, Math.min(1, (cx * dx + cy * dy + cz * dz) / len2));
    const ex = cx - s * dx, ey = cy - s * dy, ez = cz - s * dz;
    if (ex * ex + ey * ey + ez * ez > limit2) continue;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = sign * (uy * vz - uz * vy), ny = sign * (uz * vx - ux * vz), nz = sign * (ux * vy - uy * vx);
    normals.push(nx, ny, nz);
    mx += nx;
    my += ny;
    mz += nz;
  }
  // second pass: without the triangles too far from that mean (the platform, the dorsal face of a thin flake)
  const mean = Math.hypot(mx, my, mz);
  let kept = 0, sx = 0, sy = 0, sz = 0;
  if (mean > 0) {
    const cosLimit = Math.cos((STRIP_NORMAL_OUTLIER_DEG * Math.PI) / 180);
    for (let i = 0; i < normals.length; i += 3) {
      const nx = normals[i], ny = normals[i + 1], nz = normals[i + 2];
      const l = Math.hypot(nx, ny, nz);
      if (!(l > 0) || (nx * mx + ny * my + nz * mz) / (l * mean) <= cosLimit) continue;
      kept++;
      sx += nx;
      sy += ny;
      sz += nz;
    }
  }
  const nl = Math.hypot(sx, sy, sz);
  if (kept < MIN_STRIP_TRIANGLES || !(nl > 0)) return { ok: false, reason: 'few' };
  const z: Vec3 = [-sx / nl, -sy / nl, -sz / nl];
  const along = dx * z[0] + dy * z[1] + dz * z[2];
  const yr: Vec3 = [dx - along * z[0], dy - along * z[1], dz - along * z[2]];
  const yl = Math.hypot(yr[0], yr[1], yr[2]);
  if (!(yl > 0)) return { ok: false, reason: 'few' };
  const y: Vec3 = [yr[0] / yl, yr[1] / yl, yr[2] / yl];
  const x: Vec3 = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
  const axes: FrameAxes = { x, y, z, origin: [P[0], P[1], P[2]] };
  return { ok: true, matrix: frameMatrix(axes), axes, triangles: kept };
}

export const technicalFrame = (input: TechnicalFrameInput, P: Vec3, A: Vec3): TechnicalFrame => runSync(technicalFrameSteps(input, P, A));

/**
 * A scar's direction in the technical frame: projected onto its XY plane, with +Y as 0° and
 * counter-clockwise as seen from the dorsal side positive, in (−180°, 180°]; null without a length there.
 */
export function techAngleDeg(matrix: readonly number[], start: Vec3, end: Vec3): number | null {
  const f = frameAxes(matrix);
  const d: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const x = d[0] * f.x[0] + d[1] * f.x[1] + d[2] * f.x[2];
  const y = d[0] * f.y[0] + d[1] * f.y[1] + d[2] * f.y[2];
  if (!(Math.hypot(x, y) > 1e-12)) return null;
  const a = (Math.atan2(-x, y) * 180) / Math.PI;
  return a <= -180 ? 180 : a;
}

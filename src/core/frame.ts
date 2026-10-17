import type { Vec3 } from './types';

/**
 * The specimen frame as a row-major 4×4 matrix from original to specimen
 * coordinates: rows are the X (right), Y (up on the page) and Z (toward the
 * viewer of the main face) axes, and the origin is the model's centre. Only
 * the matrix is stored; nothing moves the model or the annotations.
 */
export interface FrameAxes {
  x: Vec3;
  y: Vec3;
  z: Vec3;
  /** Origin of the specimen coordinates, in original coordinates. */
  origin: Vec3;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a: Vec3): Vec3 | null => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? scale(a, 1 / l) : null;
};

export function frameMatrix(f: FrameAxes): number[] {
  const { x, y, z, origin: o } = f;
  return [x[0], x[1], x[2], -dot(x, o), y[0], y[1], y[2], -dot(y, o), z[0], z[1], z[2], -dot(z, o), 0, 0, 0, 1];
}

export function frameAxes(m: readonly number[]): FrameAxes {
  const x: Vec3 = [m[0], m[1], m[2]];
  const y: Vec3 = [m[4], m[5], m[6]];
  const z: Vec3 = [m[8], m[9], m[10]];
  // origin = −Rᵀ t
  const t = [m[3], m[7], m[11]];
  const origin: Vec3 = [0, 1, 2].map((k) => -(x[k] * t[0] + y[k] * t[1] + z[k] * t[2])) as Vec3;
  return { x, y, z, origin };
}

/**
 * Frame looking along −`toward` (the main face is seen from `toward`) with
 * `up` as close to +Y as possible. Null when `up` is along `toward`.
 */
export function frameFromView(toward: Vec3, up: Vec3, origin: Vec3): number[] | null {
  const z = unit(toward);
  if (!z) return null;
  const y = unit(sub(up, scale(z, dot(up, z))));
  if (!y) return null;
  return frameMatrix({ x: cross(y, z), y, z, origin });
}

/** Turn the specimen on the page by `deg` degrees (positive = counter-clockwise as seen from +Z). */
export function rotateFrame(m: readonly number[], deg: number): number[] {
  const f = frameAxes(m);
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const x: Vec3 = [0, 1, 2].map((k) => c * f.x[k] - s * f.y[k]) as Vec3;
  const y: Vec3 = [0, 1, 2].map((k) => s * f.x[k] + c * f.y[k]) as Vec3;
  return frameMatrix({ ...f, x, y });
}

/** Keep the front view, and turn the page so that `direction` (e.g. an arrow, origin → termination) points up. */
export function frameWithVertical(m: readonly number[], direction: Vec3): number[] | null {
  const f = frameAxes(m);
  const y = unit(sub(direction, scale(f.z, dot(direction, f.z))));
  if (!y) return null;
  return frameMatrix({ ...f, x: cross(y, f.z), y });
}

import type { FrameAxes } from '../core/frame';
import type { Vec3 } from '../core/types';
import { referencePlaneSteps, type BulbPlane } from './bulb';
import { medianAndSigma } from './robust';
import { YIELD_EVERY, type Steps } from './steps';

/**
 * IPA (interior platform angle): the angle between the platform line and the ventral face, the face taken as a plane fitted to a band of
 * it. The band runs from the end of the bulb to IPA_BAND_END of the technological length (where no bulb is found, from
 * IPA_BAND_FALLBACK_START of it; the bulb is sought in mm, so without a stated unit there is no IPA: the caller leaves it empty,
 * `no_unit`); the bulb's own triangles and those of retouch and damage are left out; the triangles are weighted by area, fitted once,
 * those lying off the plane by more than IPA_TRIM_SIGMA robust standard deviations left out, and fitted again. The plane meets the
 * longitudinal section (through P, square to the technological X) in a line; IPA is the angle from the platform line (P→E) to that line's
 * direction toward the distal end. Pure: no DOM, no three.js; long loops yield.
 */

/** Where the band ends, as a share of the technological length. */
export const IPA_BAND_END = 0.75;
/** Where it starts when no bulb is found to start from, as a share of the technological length. */
export const IPA_BAND_FALLBACK_START = 0.25;
/** Triangles farther off the first plane than this many robust standard deviations (1.4826 × MAD) from the median are left out. */
export const IPA_TRIM_SIGMA = 3;
/** Less of the band than this share of the ventral face's area left to fit: no IPA. */
export const IPA_MIN_BAND_SHARE = 0.05;

/** The band as fitted (stored with the flake's results): technological Y from and to (coordinate units), the area fitted, whether it started at the fallback, the triangles trimmed. */
export interface IpaBand {
  from: number;
  to: number;
  area: number;
  fallback: boolean;
  trimmed: number;
}

export interface IpaInput {
  positions: ArrayLike<number>;
  index: ArrayLike<number>;
  /** Triangles of the ventral face. */
  ventral: ArrayLike<number>;
  /** Triangles of the retouch and damage regions (lower layer), wherever they are; null: none. */
  leftOut: ArrayLike<number> | null;
  /** Vertices of the main bulb (`BulbResult.region`); null: none was found. */
  bulb: ArrayLike<number> | null;
  /** The technological frame, its origin at P, in the mesh's coordinates. */
  frame: FrameAxes;
  techLength: number;
  /** The platform line's unit direction, P to E. */
  lineDir: Vec3;
}

export interface IpaResult {
  ipa: number | null;
  /** Why it is empty: too little of the band left. */
  empty: 'band_too_small' | null;
  band: IpaBand;
  /** The plane fitted, its normal away from the dorsal face; null when none could be. */
  plane: BulbPlane | null;
  /** Where the plane meets the longitudinal section: its direction toward the distal end, and the line over the band. */
  dir: Vec3 | null;
  line: [Vec3, Vec3] | null;
  /** The plane over the band: its corners, across the triangles fitted. */
  patch: [Vec3, Vec3, Vec3, Vec3] | null;
  /** The triangles fitted at last, and those left out: the bulb's, retouch and damage in the band, the trimmed. */
  fitted: Uint32Array;
  excluded: Uint32Array;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

function angleDeg(u: Vec3, v: Vec3): number | null {
  const l = len(u) * len(v);
  if (!(l > 0)) return null;
  return (Math.acos(Math.max(-1, Math.min(1, dot(u, v) / l))) * 180) / Math.PI;
}

export function* ipaSteps(input: IpaInput): Steps<IpaResult> {
  const { positions, index, ventral, leftOut, bulb, frame, techLength, lineDir } = input;
  const n = Math.floor(positions.length / 3);
  const pos = (v: number): Vec3 => [positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]];
  const along = (p: Vec3) => dot(sub(p, frame.origin), frame.y);

  // where the band starts: the end of the bulb, else the fallback
  let from = IPA_BAND_FALLBACK_START * techLength, fallback = true;
  const inBulb = new Uint8Array(n);
  if (bulb && bulb.length) {
    let far = -Infinity;
    for (let k = 0; k < bulb.length; k++) {
      if (k % YIELD_EVERY === 0) yield;
      inBulb[bulb[k]] = 1;
      far = Math.max(far, along(pos(bulb[k])));
    }
    from = far;
    fallback = false;
  }
  const to = IPA_BAND_END * techLength;
  const out: IpaResult = { ipa: null, empty: 'band_too_small', band: { from, to, area: 0, fallback, trimmed: 0 }, plane: null, dir: null, line: null, patch: null, fitted: new Uint32Array(0), excluded: new Uint32Array(0) };

  const left = new Uint8Array(Math.floor(index.length / 3));
  if (leftOut) for (let k = 0; k < leftOut.length; k++) left[leftOut[k]] = 1;

  // the ventral triangles: their area; those in the band, and those left out
  let ventralArea = 0;
  const band: number[] = [], areas: number[] = [], excluded: number[] = [];
  for (let k = 0; k < ventral.length; k++) {
    if (k % YIELD_EVERY === 0) yield;
    const t = ventral[k];
    const a = index[3 * t], b = index[3 * t + 1], c = index[3 * t + 2];
    const A = pos(a), B = pos(b), C = pos(c);
    const area = len(cross(sub(B, A), sub(C, A))) / 2;
    ventralArea += area;
    if (inBulb[a] || inBulb[b] || inBulb[c]) {
      excluded.push(t);
      continue;
    }
    const y = along([(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3]);
    if (y < from || y > to) continue;
    if (left[t]) {
      excluded.push(t);
      continue;
    }
    band.push(t);
    areas.push(area);
  }
  const enough = (area: number) => area > 0 && area >= IPA_MIN_BAND_SHARE * ventralArea;
  const finish = (): IpaResult => {
    out.excluded = Uint32Array.from(excluded);
    return out;
  };
  const outward: Vec3 = [-frame.z[0], -frame.z[1], -frame.z[2]];
  let total = 0;
  for (const a of areas) total += a;
  if (!enough(total)) {
    out.band.area = total;
    return finish();
  }
  const first = yield* referencePlaneSteps(positions, index, band, outward, frame.y);
  if (!first) return finish();

  // once: off the plane by more than IPA_TRIM_SIGMA robust deviations from the median, out
  const centroid = (t: number): Vec3 => {
    const A = pos(index[3 * t]), B = pos(index[3 * t + 1]), C = pos(index[3 * t + 2]);
    return [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
  };
  const residual = new Float64Array(band.length);
  for (let k = 0; k < band.length; k++) {
    if (k % YIELD_EVERY === 0) yield;
    residual[k] = dot(sub(centroid(band[k]), first.point), first.normal);
  }
  const { median: m, sigma } = medianAndSigma(residual);
  yield;
  const kept: number[] = [];
  let area = 0;
  for (let k = 0; k < band.length; k++) {
    if (Math.abs(residual[k] - m) > IPA_TRIM_SIGMA * sigma) {
      excluded.push(band[k]);
      out.band.trimmed++;
    } else {
      kept.push(band[k]);
      area += areas[k];
    }
  }
  out.band.area = area;
  out.fitted = Uint32Array.from(kept);
  if (!enough(area)) return finish();
  const plane = yield* referencePlaneSteps(positions, index, out.fitted, outward, frame.y);
  if (!plane) return finish();
  out.plane = plane;

  // where it meets the longitudinal section: its direction toward the distal end
  const meet = cross(plane.normal, frame.x);
  const l = len(meet);
  const nz = dot(frame.z, plane.normal);
  if (!(l > 1e-9) || Math.abs(nz) < 1e-9) return finish();
  const dir: Vec3 = dot(meet, frame.y) < 0 ? [-meet[0] / l, -meet[1] / l, -meet[2] / l] : [meet[0] / l, meet[1] / l, meet[2] / l];
  out.dir = dir;
  out.ipa = angleDeg(lineDir, dir);
  out.empty = out.ipa === null ? 'band_too_small' : null;

  // the plane at technological (x, y): its point there
  const off = dot(sub(frame.origin, plane.point), plane.normal);
  const at = (x: number, y: number): Vec3 => {
    const z = -(off + x * dot(frame.x, plane.normal) + y * dot(frame.y, plane.normal)) / nz;
    const o = frame.origin;
    return [o[0] + x * frame.x[0] + y * frame.y[0] + z * frame.z[0], o[1] + x * frame.x[1] + y * frame.y[1] + z * frame.z[1], o[2] + x * frame.x[2] + y * frame.y[2] + z * frame.z[2]];
  };
  out.line = [at(0, from), at(0, to)];
  // across the triangles fitted
  let x0 = Infinity, x1 = -Infinity;
  for (let k = 0; k < kept.length; k++) {
    if (k % YIELD_EVERY === 0) yield;
    const x = dot(sub(centroid(kept[k]), frame.origin), frame.x);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
  }
  out.patch = [at(x0, from), at(x1, from), at(x1, to), at(x0, to)];
  return finish();
}

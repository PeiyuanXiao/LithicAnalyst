import { frameAxes, type FrameAxes } from '../core/frame';
import { mmPerUnit } from '../core/format';
import type { Vec3 } from '../core/types';
import { convexHullSteps } from './convexHull';
import { BSA_LEVEL_DEFAULT_MM, BSA_LEVEL_RANGE_MM, BSA_MIN_PROMINENCE, BSA_NEAR_POP_MM, BSA_OPEN_REACH_MM, BSA_REF_ITERATIONS, BSA_REF_RADIUS_MM, BSA_REF_TRIM_UP, BULB_ANGLE_DISTANCE_MM, bulbSteps, meshEdgeNearSteps, POP_MESH_RADIUS_MM, proximalPlaneSteps, VI_SAMPLE_MM, VI_WIDTHS_MM, type BulbPlane, type ViStrip } from './bulb';
import { IPA_BAND_END, IPA_BAND_FALLBACK_START, IPA_MIN_BAND_SHARE, IPA_TRIM_SIGMA, ipaSteps, type IpaBand } from './ipa';
import { arcLengths, pointAtArc } from './landmarks';
import { symmetricEigen3 } from './linalg';
import { inFrame, lineNear, sectionByPlane, type PlaneCandidates, type SectionLine } from './meshSection';
import { closestOnTriangle, regionPathSteps } from './regionPath';
import { runSync, YIELD_EVERY, type Steps } from './steps';
import { STRIP_HALF_WIDTH_RATIO, STRIP_NORMAL_OUTLIER_DEG } from './technicalFrame';

/** Points each stretch is resampled to before a line is fitted. */
export const FIT_RESAMPLE_COUNT = 200;
/** How far from the outer platform edge EPA is taken along the section. */
export const EPA_DISTANCES_MM = [1, 2, 3] as const;
/** The chord taken as the tangent of the two-lines methods. */
export const TWO_LINES_LENGTH_MM = 0.5;
/** Fewer points than this before resampling: no line. */
export const MIN_FIT_POINTS = 2;
/**
 * How near P must lie to the platform region, and the platform's stretch of the section start (mm); without a stated unit, this many
 * mean edge lengths.
 */
export const PLATFORM_REACH_MM = 1.0;
export const PLATFORM_REACH_EDGES = 5;

/** The parameters of the flake measurements, as stored with the results and in the manifest. */
export const FLAKE_PARAMETERS = {
  STRIP_HALF_WIDTH_RATIO,
  STRIP_NORMAL_OUTLIER_DEG,
  FIT_RESAMPLE_COUNT,
  EPA_DISTANCES_MM: [...EPA_DISTANCES_MM],
  TWO_LINES_LENGTH_MM,
  IPA_BAND_END,
  IPA_BAND_FALLBACK_START,
  IPA_TRIM_SIGMA,
  IPA_MIN_BAND_SHARE,
  MIN_FIT_POINTS,
  PLATFORM_REACH_MM,
  PLATFORM_REACH_EDGES,
  BULB_ANGLE_DISTANCE_MM,
  BSA_LEVEL_DEFAULT_MM,
  BSA_LEVEL_RANGE_MM: [...BSA_LEVEL_RANGE_MM],
  BSA_NEAR_POP_MM,
  BSA_REF_RADIUS_MM,
  BSA_REF_ITERATIONS,
  BSA_REF_TRIM_UP,
  BSA_MIN_PROMINENCE,
  BSA_OPEN_REACH_MM,
  VI_WIDTHS_MM: [...VI_WIDTHS_MM],
  VI_SAMPLE_MM,
  POP_MESH_RADIUS_MM,
};

/** The measured columns of flakes.csv, in order (after frame_source). */
export const FLAKE_MEASURES = [
  'tech_length',
  'tech_width',
  'tech_thickness',
  'morph_length',
  'morph_width',
  'morph_thickness',
  'morph_tech_angle_deg',
  'platform_width_chord',
  'platform_width_path',
  'platform_depth_chord',
  'platform_depth_path',
  'platform_area',
  'epa_3pt_1mm',
  'epa_3pt_2mm',
  'epa_3pt_3mm',
  'epa_2ln_1mm',
  'epa_2ln_2mm',
  'epa_2ln_3mm',
  'ipa',
] as const;

/** The proximal measures: PSIA, the bulb angle, the BSA and the vertical intervals, and the mesh's resolution at P (after the retouch indices in flakes.csv). */
export const PROXIMAL_MEASURES = ['psia', 'bulb_angle_3pt_1mm', 'bulb_angle_2ln_1mm', 'bsa', 'vi_0_5mm', 'vi_1_0mm', 'vi_1_5mm', 'pop_mesh_edge'] as const;
/** Every measure of a flake, as `derived.flake.measures` holds them. */
export const ALL_FLAKE_MEASURES = [...FLAKE_MEASURES, ...PROXIMAL_MEASURES] as const;
export type FlakeMeasure = (typeof ALL_FLAKE_MEASURES)[number];
export type FlakeMeasures = Record<FlakeMeasure, number | null>;
/** The columns flakes.csv ends with, after the retouch indices (or after the measurements without them). */
export const FLAKE_PROXIMAL_COLUMNS = ['psia', 'bulb_angle_3pt_1mm', 'bulb_angle_2ln_1mm', 'bsa', 'bsa_level_mm', 'bsa_ends_moved', 'vi_0_5mm', 'vi_1_0mm', 'vi_1_5mm', 'pop_mesh_edge'] as const;
/** The measures of a flake compared between observers (agreement, ICC): all but the settings and the mesh's resolution. */
export const AGREEMENT_FLAKE_MEASURES: readonly FlakeMeasure[] = [...FLAKE_MEASURES, 'psia', 'bulb_angle_3pt_1mm', 'bulb_angle_2ln_1mm', 'bsa', 'vi_0_5mm', 'vi_1_0mm', 'vi_1_5mm'];
/** The vertical intervals, by `VI_WIDTHS_MM`. */
export const VI_MEASURES = ['vi_0_5mm', 'vi_1_0mm', 'vi_1_5mm'] as const;

/** Why a measure is empty, in the order they are looked for: for the screen, neither stored nor exported. */
export const FLAKE_EMPTY_REASONS = ['no_hull', 'no_axis', 'frame_failed', 'along_z', 'no_platform', 'section_misses_platform', 'no_ends', 'no_path', 'no_unit', 'section_ends', 'no_ventral', 'no_bulb', 'bulb_one_side', 'band_too_small', 'pop_off_platform', 'bulb_open'] as const;
export type FlakeEmptyReason = (typeof FLAKE_EMPTY_REASONS)[number];

const EPA_MEASURES = ['epa_3pt_1mm', 'epa_3pt_2mm', 'epa_3pt_3mm', 'epa_2ln_1mm', 'epa_2ln_2mm', 'epa_2ln_3mm'] as const;
const BULB_ANGLE_MEASURES = ['bulb_angle_3pt_1mm', 'bulb_angle_2ln_1mm'] as const;
const BSA_MEASURES: readonly FlakeMeasure[] = ['bsa', ...VI_MEASURES];
const PLATFORM_MEASURES: readonly FlakeMeasure[] = ['platform_width_chord', 'platform_width_path', 'platform_depth_chord', 'platform_depth_path', 'platform_area', ...EPA_MEASURES, 'ipa', ...BULB_ANGLE_MEASURES];
/** What is taken on the longitudinal section: from the platform's edge there (S). */
const SECTION_MEASURES: readonly FlakeMeasure[] = ['platform_depth_chord', 'platform_depth_path', ...EPA_MEASURES, 'ipa', ...BULB_ANGLE_MEASURES];
const AXIS_MEASURES: readonly FlakeMeasure[] = ['tech_length', 'tech_width', 'tech_thickness', 'morph_tech_angle_deg', ...PLATFORM_MEASURES, ...BSA_MEASURES, 'psia', 'pop_mesh_edge'];

export const emptyFlakeMeasures = (): FlakeMeasures => Object.fromEntries(ALL_FLAKE_MEASURES.map((k) => [k, null])) as FlakeMeasures;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];

/** The angle between two directions, degrees. */
export function angleDeg(u: Vec3, v: Vec3): number | null {
  const l = Math.hypot(u[0], u[1], u[2]) * Math.hypot(v[0], v[1], v[2]);
  if (!(l > 0)) return null;
  return (Math.acos(Math.max(-1, Math.min(1, dot(u, v) / l))) * 180) / Math.PI;
}

// ---------------------------------------------------------------- dimensions

/** How the morphological dimensions were taken: for drawing, in the coordinates of the positions. */
export interface MorphConstruction {
  /** The farthest pair of vertices. */
  length: [Vec3, Vec3];
  /** The width and the thickness as lines of their very lengths: in the plane across the middle of the length. */
  width: [Vec3, Vec3];
  thickness: [Vec3, Vec3];
  /** The vertices they were reached on. */
  widthVertices: [Vec3, Vec3];
  thicknessVertices: [Vec3, Vec3];
}

export interface MorphDimensions {
  length: number;
  width: number;
  thickness: number;
  /** Unit direction of the length (from one end of the longest pair to the other). */
  lengthDir: Vec3;
  construction: MorphConstruction;
}

/** The farthest of all the vertices from `p`, and that distance. */
function* farthestVertexSteps(positions: ArrayLike<number>, p: Vec3): Steps<{ at: Vec3; distance: number }> {
  let best = -1, at = 0;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    if (i % YIELD_EVERY === 0) yield;
    const dx = positions[i] - p[0], dy = positions[i + 1] - p[1], dz = positions[i + 2] - p[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d > best) {
      best = d;
      at = i;
    }
  }
  return { at: [positions[at], positions[at + 1], positions[at + 2]], distance: Math.sqrt(best) };
}

/** The farthest of `pts` (xyz in a flat list) from `p`. */
function farthest(pts: Float64Array, p: Vec3): number {
  let best = -1, at = 0;
  for (let i = 0; i < pts.length; i += 3) {
    const dx = pts[i] - p[0], dy = pts[i + 1] - p[1], dz = pts[i + 2] - p[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d > best) {
      best = d;
      at = i / 3;
    }
  }
  return at;
}

/**
 * Length, width and thickness whatever the orientation: the largest distance between
 * two vertices (on the convex hull's vertices); the largest distance across, with
 * every vertex projected onto the plane perpendicular to the length; and the range
 * perpendicular to both.
 */
export function* morphDimensionsSteps(positions: ArrayLike<number>): Steps<MorphDimensions | null> {
  const hull = yield* convexHullSteps(positions);
  const h = hull.length;
  if (h < 2) return null;
  const pts = new Float64Array(3 * h);
  for (let i = 0; i < h; i++) for (let k = 0; k < 3; k++) pts[3 * i + k] = positions[3 * hull[i] + k];
  const at = (i: number): Vec3 => [pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]];
  // a pair each the farthest from the other; any longer pair has an end outside the ball on this one
  let a = 0, b = farthest(pts, at(0));
  for (let guard = 0; guard < 32; guard++) {
    const c = farthest(pts, at(b));
    if (dist(at(c), at(b)) <= dist(at(a), at(b))) break;
    a = b;
    b = c;
    yield;
  }
  let best = dist(at(a), at(b));
  const centre: Vec3 = [(pts[3 * a] + pts[3 * b]) / 2, (pts[3 * a + 1] + pts[3 * b + 1]) / 2, (pts[3 * a + 2] + pts[3 * b + 2]) / 2];
  const r2 = (best * best) / 4;
  for (let i = 0; i < h; i++) {
    if (i % 256 === 0) yield;
    const dx = pts[3 * i] - centre[0], dy = pts[3 * i + 1] - centre[1], dz = pts[3 * i + 2] - centre[2];
    if (dx * dx + dy * dy + dz * dz <= r2) continue;
    const j = farthest(pts, at(i));
    const d = dist(at(i), at(j));
    if (d > best) {
      best = d;
      a = i;
      b = j;
    }
  }
  if (!(best > 0)) return null;
  // the hull leaves out what lies within a hair of it: settled on all the vertices
  let pa = at(a), pb = at(b);
  for (let guard = 0; guard < 8; guard++) {
    const f = yield* farthestVertexSteps(positions, pa);
    if (f.distance <= best && guard > 0) break;
    best = Math.max(best, f.distance);
    pb = pa;
    pa = f.at;
  }
  best = dist(pa, pb);
  const u: Vec3 = [(pb[0] - pa[0]) / best, (pb[1] - pa[1]) / best, (pb[2] - pa[2]) / best];
  // an orthonormal base of the plane across
  const ref: Vec3 = Math.abs(u[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  const v0: Vec3 = [u[1] * ref[2] - u[2] * ref[1], u[2] * ref[0] - u[0] * ref[2], u[0] * ref[1] - u[1] * ref[0]];
  const vl = Math.hypot(v0[0], v0[1], v0[2]);
  const v: Vec3 = [v0[0] / vl, v0[1] / vl, v0[2] / vl];
  const w: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  // the width is reached on the outline of the projection (convex hull in 2D, monotone chain); each point knows its vertex
  const flat: Array<[number, number, number]> = [];
  for (let i = 0; i < h; i++) flat.push([dot(at(i), v), dot(at(i), w), hull[i]]);
  flat.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  yield;
  const side = (o: readonly number[], p: readonly number[], q: readonly number[]) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const outline: Array<[number, number, number]> = [];
  for (const p of flat) {
    while (outline.length >= 2 && side(outline[outline.length - 2], outline[outline.length - 1], p) <= 0) outline.pop();
    outline.push(p);
  }
  const lower = outline.length + 1;
  for (let i = flat.length - 2; i >= 0; i--) {
    const p = flat[i];
    while (outline.length >= lower && side(outline[outline.length - 2], outline[outline.length - 1], p) <= 0) outline.pop();
    outline.push(p);
  }
  let width2 = 0, ax = 0, ay = 0, bx = 0, by = 0, aVertex = hull[a], bVertex = hull[b];
  for (let i = 0; i < outline.length; i++) {
    if (i % 256 === 0) yield;
    for (let j = i + 1; j < outline.length; j++) {
      const dx = outline[i][0] - outline[j][0], dy = outline[i][1] - outline[j][1];
      const d = dx * dx + dy * dy;
      if (d > width2) {
        width2 = d;
        ax = outline[i][0];
        ay = outline[i][1];
        aVertex = outline[i][2];
        bx = outline[j][0];
        by = outline[j][1];
        bVertex = outline[j][2];
      }
    }
  }
  // the same across, on all the vertices
  let width = Math.sqrt(width2);
  const n = Math.floor(positions.length / 3);
  for (let guard = 0; guard < 4; guard++) {
    let top = -1, tx = 0, ty = 0, tVertex = 0;
    for (let i = 0; i < n; i++) {
      if (i % YIELD_EVERY === 0) yield;
      const x = positions[3 * i] * v[0] + positions[3 * i + 1] * v[1] + positions[3 * i + 2] * v[2];
      const y = positions[3 * i] * w[0] + positions[3 * i + 1] * w[1] + positions[3 * i + 2] * w[2];
      const d = (x - ax) ** 2 + (y - ay) ** 2;
      if (d > top) {
        top = d;
        tx = x;
        ty = y;
        tVertex = i;
      }
    }
    if (Math.sqrt(top) <= width && guard > 0) break;
    width = Math.max(width, Math.sqrt(top));
    bx = ax;
    by = ay;
    bVertex = aVertex;
    ax = tx;
    ay = ty;
    aVertex = tVertex;
  }
  width = Math.hypot(ax - bx, ay - by);
  // perpendicular to the length and the width
  const across: [number, number] = width > 0 ? [-(by - ay) / width, (bx - ax) / width] : [1, 0];
  let lo = Infinity, hi = -Infinity, loVertex = 0, hiVertex = 0;
  for (let i = 0; i < n; i++) {
    if (i % YIELD_EVERY === 0) yield;
    const x = positions[3 * i] * v[0] + positions[3 * i + 1] * v[1] + positions[3 * i + 2] * v[2];
    const y = positions[3 * i] * w[0] + positions[3 * i + 1] * w[1] + positions[3 * i + 2] * w[2];
    const d = x * across[0] + y * across[1];
    if (d < lo) {
      lo = d;
      loVertex = i;
    }
    if (d > hi) {
      hi = d;
      hiVertex = i;
    }
  }
  // what was reached, as lines: across the middle of the length; the thickness through the middle of the width
  const middle = (dot(pa, u) + dot(pb, u)) / 2;
  const onPlane = (x: number, y: number): Vec3 => [middle * u[0] + x * v[0] + y * w[0], middle * u[1] + x * v[1] + y * w[1], middle * u[2] + x * v[2] + y * w[2]];
  const along: [number, number] = [across[1], -across[0]];
  const centre2 = ((ax + bx) / 2) * along[0] + ((ay + by) / 2) * along[1];
  const onThickness = (d: number): Vec3 => onPlane(along[0] * centre2 + across[0] * d, along[1] * centre2 + across[1] * d);
  const vertex = (i: number): Vec3 => [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
  return {
    length: best,
    width,
    thickness: hi >= lo ? hi - lo : 0,
    lengthDir: u,
    construction: {
      length: [pa, pb],
      width: [onPlane(ax, ay), onPlane(bx, by)],
      thickness: [onThickness(lo), onThickness(hi)],
      widthVertices: [vertex(aVertex), vertex(bVertex)],
      thicknessVertices: [vertex(loVertex), vertex(hiVertex)],
    },
  };
}

export const morphDimensions = (positions: ArrayLike<number>): MorphDimensions | null => runSync(morphDimensionsSteps(positions));

/** How the technical dimensions were taken: for drawing, in the coordinates of the positions. A point of the box is `origin` + X·axes[0] + Y·axes[1] + Z·axes[2]. */
export interface TechConstruction {
  origin: Vec3;
  axes: [Vec3, Vec3, Vec3];
  /** The box in the frame: X and Z ranges, Y from 0 (P) to the largest. */
  min: Vec3;
  max: Vec3;
  /** The vertices that reached each side of it. */
  extremes: { xMin: Vec3; xMax: Vec3; yMax: Vec3; zMin: Vec3; zMax: Vec3 };
}

export interface TechDimensions {
  tech_length: number;
  tech_width: number;
  tech_thickness: number;
  construction: TechConstruction;
}

/**
 * Length, width and thickness in the technical frame: the vertices' largest Y (P is at
 * 0), and the ranges of X and Z. `frame`: its origin in the coordinates of `positions`.
 */
export function* techDimensionsSteps(positions: ArrayLike<number>, frame: FrameAxes): Steps<TechDimensions> {
  const { x: ax, y: ay, z: az, origin: o } = frame;
  let x0 = Infinity, x1 = -Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  let xMin = 0, xMax = 0, yMax = 0, zMin = 0, zMax = 0;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    if (i % YIELD_EVERY === 0) yield;
    const dx = positions[i] - o[0], dy = positions[i + 1] - o[1], dz = positions[i + 2] - o[2];
    const x = dx * ax[0] + dy * ax[1] + dz * ax[2], y = dx * ay[0] + dy * ay[1] + dz * ay[2], z = dx * az[0] + dy * az[1] + dz * az[2];
    if (x < x0) {
      x0 = x;
      xMin = i;
    }
    if (x > x1) {
      x1 = x;
      xMax = i;
    }
    if (y > y1) {
      y1 = y;
      yMax = i;
    }
    if (z < z0) {
      z0 = z;
      zMin = i;
    }
    if (z > z1) {
      z1 = z;
      zMax = i;
    }
  }
  const vertex = (i: number): Vec3 => [positions[i], positions[i + 1], positions[i + 2]];
  return {
    tech_length: y1,
    tech_width: x1 - x0,
    tech_thickness: z1 - z0,
    construction: { origin: o, axes: [ax, ay, az], min: [x0, 0, z0], max: [x1, y1, z1], extremes: { xMin: vertex(xMin), xMax: vertex(xMax), yMax: vertex(yMax), zMin: vertex(zMin), zMax: vertex(zMax) } },
  };
}

/** The morphological length's direction, projected onto the technical frame's XY plane: its angle with the Y axis, 0–90°. */
export function morphTechAngle(lengthDir: Vec3, frame: FrameAxes): number | null {
  const x = dot(lengthDir, frame.x), y = dot(lengthDir, frame.y);
  if (!(Math.hypot(x, y) > 1e-12)) return null;
  return (Math.atan2(Math.abs(x), Math.abs(y)) * 180) / Math.PI;
}

/** What that angle was taken from: the projected direction as a unit vector, on the +Y side, so the angle between it and +Y is the angle. Null where there is none. */
export function morphAxisOnFrame(lengthDir: Vec3, frame: FrameAxes): Vec3 | null {
  const x = dot(lengthDir, frame.x), y = dot(lengthDir, frame.y);
  const l = Math.hypot(x, y);
  if (!(l > 1e-12)) return null;
  const s = (y < 0 ? -1 : 1) / l;
  return [s * (x * frame.x[0] + y * frame.y[0]), s * (x * frame.x[1] + y * frame.y[1]), s * (x * frame.x[2] + y * frame.y[2])];
}

// ---------------------------------------------------------------- platform

/** A polyline as equally spaced points. */
export function resampleEven(points: readonly Vec3[], count: number): Vec3[] {
  const cum = arcLengths(points, false);
  const L = cum[cum.length - 1];
  return Array.from({ length: count }, (_, k) => pointAtArc(points, false, cum, (L * k) / (count - 1)));
}

/** The total least-squares line of a set of points: their mean and main direction. */
export function fitLine(points: readonly Vec3[]): { point: Vec3; dir: Vec3 } | null {
  const n = points.length;
  if (n < 2) return null;
  const m: Vec3 = [0, 0, 0];
  for (const p of points) for (let k = 0; k < 3; k++) m[k] += p[k] / n;
  const c = new Array<number>(9).fill(0);
  for (const p of points) {
    const d = sub(p, m);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[3 * i + j] += d[i] * d[j];
  }
  const { vectors } = symmetricEigen3(c);
  return { point: m, dir: vectors[0] };
}

/** What the measurements found on the section, in the coordinates of the section (for the profile panel too). */
export interface PlatformProfile {
  /** The stretch of the section on the platform, from the end nearest P. */
  stretch: Vec3[];
  /** The outer end of that stretch. */
  E: Vec3;
  /** Platform line (null with too few points): unit direction P→E, and where it runs. */
  lineDir: Vec3 | null;
  line: [Vec3, Vec3] | null;
  /** EPA by distance, three points and two lines; null where the section ends or no unit is stated. */
  epa3: Array<number | null>;
  epa2: Array<number | null>;
  /** Where EPA was taken along the section, by distance. */
  q: Array<Vec3 | null>;
  /** The chord taken as the tangent there, by distance, its far end last (null where it runs past the section's end). */
  chords: Array<[Vec3, Vec3] | null>;
  /** The section's ventral side, from the stretch's start on (where IPA's band is marked). */
  ventralWalk: Vec3[];
  /**
   * The bulb angle at BULB_ANGLE_DISTANCE_MM: from the stretch's start (`bulbAt`, nearest P) along the ventral side, three points to Qv
   * (`bulbQ`) and two lines by the chord there (`bulbChord`); measured from the platform line's direction toward the distal end, as IPA.
   */
  bulbAt: Vec3;
  bulbQ: Vec3 | null;
  bulbChord: [Vec3, Vec3] | null;
  bulb3: number | null;
  bulb2: number | null;
}

/**
 * The platform's measurements on the longitudinal section `line`. `mm`: millimetres per
 * coordinate unit (null: not stated, so no EPA). Null when the section has no stretch on
 * the platform that starts within `reach` of P.
 */
export function platformProfile(line: SectionLine, P: Vec3, inPlatform: (face: number) => boolean, reach: number, mm: number | null): PlatformProfile | null {
  const { points: pts, faces, closed } = line;
  const n = pts.length;
  const segs = closed ? n : n - 1;
  const inside = Array.from({ length: segs }, (_, i) => inPlatform(faces[i]));
  const count = inside.filter(Boolean).length;
  if (!count || count === segs) return null;
  // the runs of stretches on the platform; a closed line is read from a stretch off it
  const from = closed ? inside.indexOf(false) : 0;
  const runs: Array<{ first: number; length: number }> = [];
  for (let k = 0; k < segs; k++) {
    const i = (from + k) % segs;
    if (!inside[i]) continue;
    const last = runs[runs.length - 1];
    if (last && (last.first + last.length) % segs === i) last.length++;
    else runs.push({ first: i, length: 1 });
  }
  const runPoints = (r: { first: number; length: number }) => Array.from({ length: r.length + 1 }, (_, k) => pts[(r.first + k) % n]);
  const gap = (r: { first: number; length: number }) => Math.min(...runPoints(r).map((p) => dist(p, P)));
  const run = runs.reduce((b, r) => (gap(r) < gap(b) ? r : b), runs[0]);
  // read from the end nearest P
  const a = run.first, b = (run.first + run.length) % n;
  const dir = dist(pts[b], P) < dist(pts[a], P) ? -1 : 1;
  const start = dir > 0 ? a : b, far = dir > 0 ? b : a;
  if (dist(pts[start], P) > reach) return null;
  const stretch = runPoints(run);
  if (dir < 0) stretch.reverse();
  const E = pts[far];
  /** Along the section away from the stretch: from `at` in steps of `step`, until the stretch or the end of the line. */
  const walk = (at: number, step: number, stop: number): Vec3[] => {
    const out = [pts[at]];
    for (let i = at, guard = 0; guard < n; guard++) {
      if (!closed && (i + step < 0 || i + step >= n)) break;
      i = (i + step + n) % n;
      out.push(pts[i]);
      if (i === stop) break;
    }
    return out;
  };
  const dorsal = walk(far, dir, start);
  const ventralWalk = walk(start, -dir, far);

  // the platform line
  const fit = stretch.length >= MIN_FIT_POINTS ? fitLine(resampleEven(stretch, FIT_RESAMPLE_COUNT)) : null;
  let lineDir: Vec3 | null = null;
  let segment: [Vec3, Vec3] | null = null;
  if (fit) {
    lineDir = dot(fit.dir, sub(E, stretch[0])) < 0 ? neg(fit.dir) : fit.dir;
    const on = (q: Vec3): Vec3 => {
      const s = dot(sub(q, fit.point), lineDir!);
      return [fit.point[0] + s * lineDir![0], fit.point[1] + s * lineDir![1], fit.point[2] + s * lineDir![2]];
    };
    segment = [on(stretch[0]), on(E)];
  }

  // EPA: from E along the section
  const epa3: Array<number | null> = [], epa2: Array<number | null> = [], q: Array<Vec3 | null> = [], chords: Array<[Vec3, Vec3] | null> = [];
  const cum = arcLengths(dorsal, false);
  const L = cum[cum.length - 1];
  for (const d of EPA_DISTANCES_MM) {
    if (mm === null || !lineDir) {
      epa3.push(null);
      epa2.push(null);
      q.push(null);
      chords.push(null);
      continue;
    }
    const dm = d / mm;
    const half = TWO_LINES_LENGTH_MM / 2 / mm;
    const Q = dm <= L ? pointAtArc(dorsal, false, cum, dm) : null;
    q.push(Q);
    epa3.push(Q ? angleDeg(neg(lineDir), sub(Q, E)) : null);
    const chord: [Vec3, Vec3] | null = Q && dm + half <= L ? [pointAtArc(dorsal, false, cum, dm - half), pointAtArc(dorsal, false, cum, dm + half)] : null;
    chords.push(chord);
    epa2.push(chord ? angleDeg(neg(lineDir), sub(chord[1], chord[0])) : null);
  }

  // the bulb angle: from the stretch's start along the ventral side, the same two ways
  const bulbAt = stretch[0];
  let bulbQ: Vec3 | null = null, bulbChord: [Vec3, Vec3] | null = null;
  if (mm !== null && lineDir) {
    const vc = arcLengths(ventralWalk, false);
    const VL = vc[vc.length - 1];
    const dm = BULB_ANGLE_DISTANCE_MM / mm, half = TWO_LINES_LENGTH_MM / 2 / mm;
    if (dm <= VL) bulbQ = pointAtArc(ventralWalk, false, vc, dm);
    if (dm + half <= VL && dm - half >= 0) bulbChord = [pointAtArc(ventralWalk, false, vc, dm - half), pointAtArc(ventralWalk, false, vc, dm + half)];
  }
  const bulb3 = bulbQ && lineDir ? angleDeg(lineDir, sub(bulbQ, bulbAt)) : null;
  const bulb2 = bulbChord && lineDir ? angleDeg(lineDir, sub(bulbChord[1], bulbChord[0])) : null;
  return { stretch, E, lineDir, line: segment, epa3, epa2, q, chords, ventralWalk, bulbAt, bulbQ, bulbChord, bulb3, bulb2 };
}

/** Where a walk along the section first reaches the technical Y `y` (null: it never does). */
function reachingY(walk: Vec3[], frame: FrameAxes, y: number): Vec3 | null {
  for (let i = 0; i + 1 < walk.length; i++) {
    const a = inFrame(frame, walk[i])[1], b = inFrame(frame, walk[i + 1])[1];
    if (a === b || (a - y) * (b - y) > 0) continue;
    const s = (y - a) / (b - a);
    const A = walk[i], B = walk[i + 1];
    return [A[0] + s * (B[0] - A[0]), A[1] + s * (B[1] - A[1]), A[2] + s * (B[2] - A[2])];
  }
  return null;
}

// ---------------------------------------------------------------- all together

export interface FlakeInput {
  /** Positions relative to `offset`; every other point is in original coordinates. */
  positions: ArrayLike<number>;
  index: ArrayLike<number>;
  offset?: Vec3;
  /** Row-major matrix of the technical frame (null: no technical axis, or no frame could be made). */
  matrix: readonly number[] | null;
  /** The point of percussion. */
  P: Vec3 | null;
  /** The platform ends placed (two are needed for the platform's width). */
  ends: readonly Vec3[];
  /** Triangles of the platform region (null: none). */
  platformFaces: ArrayLike<number> | null;
  /** Their total area. */
  platformArea: number | null;
  unit: string;
  meanEdge: number;
  /** Computed once per mesh (it takes the longest). */
  morph: MorphDimensions | null;
  /** The triangles a plane may cut (from the BVH), or null: all of them. */
  candidates?: PlaneCandidates | null;
  /** The longitudinal section when it is known (it changes only with the axis). */
  section?: SectionLine | null;
  /** Triangles of the ventral face (null: none). */
  ventralFaces?: ArrayLike<number> | null;
  /** Triangles of the retouch and damage regions (lower layer), left out of IPA's band (null: none). */
  leftOutFaces?: ArrayLike<number> | null;
  /** The level of the bulb's outline (mm) and its ends set by hand (original coordinates; null: the outline's). */
  bsa?: { level: number; ends: readonly [Vec3, Vec3] | null };
  /** The mesh's edges, each once (for its resolution at P); without them, every triangle's as wound. */
  edges?: { v0: ArrayLike<number>; v1: ArrayLike<number> } | null;
}

/** Points the profile panel draws, in original coordinates. */
export interface FlakeGeometry {
  P: Vec3 | null;
  E: Vec3 | null;
  platformLine: [Vec3, Vec3] | null;
  epaPoints: Array<Vec3 | null>;
  /** IPA: where its band starts and ends on the section's ventral side, and where its plane meets the section over the band. */
  ipaFrom?: Vec3 | null;
  ipaTo?: Vec3 | null;
  ipaLine?: [Vec3, Vec3] | null;
  /** The bulb angle: where it is taken from, Qv and the chord (absent in files from before it). */
  bulbAt?: Vec3 | null;
  bulbQ?: Vec3 | null;
  bulbChord?: [Vec3, Vec3] | null;
}

/** What the BSA and the vertical intervals were taken from, in original coordinates (the plane too). */
export interface BulbConstruction {
  plane: BulbPlane;
  P: Vec3;
  P0: Vec3;
  /** The level, mm and coordinate units. */
  level: number;
  levelUnits: number;
  contour: Array<{ points: Vec3[]; closed: boolean }>;
  autoEnds: [Vec3, Vec3] | null;
  ends: [Vec3, Vec3] | null;
  /** The ends were set by hand. */
  moved: boolean;
  /** The plane's reach round P (coordinate units) and the surface's robust deviation from it there. */
  radius: number;
  noise: number;
  apex: Vec3 | null;
  vi: ViStrip[] | null;
  extent: { u0: number; u1: number; v0: number; v1: number } | null;
}

/**
 * How a flake's measurements were taken, in original coordinates, for drawing them: exactly what the numbers came from (`compute/measureHint.ts`). Not stored.
 * Each part is null while what it needs is lacking.
 */
export interface FlakeConstruction {
  tech: TechConstruction | null;
  morph: MorphConstruction | null;
  /** The two axes of the angle, from one point; `reach`: how far to draw them. */
  angle: { origin: Vec3; tech: Vec3; morph: Vec3; reach: number } | null;
  /** The platform's width: its two ends, and the way between them over the platform. */
  width: { ends: [Vec3, Vec3]; path: Vec3[] | null } | null;
  /** The platform's depth: from S (where the section's platform stretch starts, at the platform's edge) to E, and the way between them over the platform. */
  depth: { S: Vec3; E: Vec3; path: Vec3[] | null } | null;
  /** The triangles of the platform. */
  platformFaces: ArrayLike<number> | null;
  /** What was taken on the longitudinal section. */
  profile: ProfileConstruction | null;
  /** PSIA: P and the two platform ends. */
  psia: { P: Vec3; ends: [Vec3, Vec3] } | null;
  /** The mesh's edges round P that its mean edge length there was taken over (ends by twos). */
  popEdges: { P: Vec3; segments: Vec3[] } | null;
  /** The ventral reference plane (from the ventral face and the frame, with or without a unit), and the bulb when it was measured. */
  plane: BulbPlane | null;
  bulb: BulbConstruction | null;
  ipa: IpaConstruction | null;
}

/** IPA: the platform line, the band's plane and the triangles it was fitted to and those left out, its line on the section, the direction of it. */
export interface IpaConstruction {
  P: Vec3;
  E: Vec3;
  platformLine: [Vec3, Vec3] | null;
  lineDir: Vec3;
  /** Where the plane meets the section over the band, and its direction toward the distal end. */
  line: [Vec3, Vec3];
  dir: Vec3;
  /** The plane over the band (its corners). */
  patch: [Vec3, Vec3, Vec3, Vec3];
  /** The band's ends on the section's ventral side. */
  from: Vec3 | null;
  to: Vec3 | null;
  fitted: Uint32Array;
  excluded: Uint32Array;
}

export interface ProfileConstruction {
  P: Vec3;
  E: Vec3;
  /** The section on the model. */
  section: Vec3[];
  closed: boolean;
  platformLine: [Vec3, Vec3] | null;
  /** The platform line's unit direction, P to E. */
  lineDir: Vec3 | null;
  /** By the distances of EPA. */
  q: Array<Vec3 | null>;
  chords: Array<[Vec3, Vec3] | null>;
  bulbAt: Vec3;
  bulbQ: Vec3 | null;
  bulbChord: [Vec3, Vec3] | null;
}

export interface FlakeResult {
  measures: FlakeMeasures;
  /** Why each empty measure is empty: the first of `FLAKE_EMPTY_REASONS` that holds; not stored. */
  reasons: Partial<Record<FlakeMeasure, FlakeEmptyReason>>;
  geometry: FlakeGeometry;
  /** The longitudinal section (coordinates relative to the mesh's offset); not stored. */
  section: SectionLine | null;
  construction: FlakeConstruction;
  /** IPA's band as fitted (stored with the results), or null when there was none to fit. */
  ipaBand: IpaBand | null;
  /** The BSA's reference as fitted (stored with the results): its reach round P and the surface's noise over it (coordinate units); null: none. */
  bsaReference: { radius: number; noise: number } | null;
}

/** How far a point lies from a set of triangles (Infinity: none). */
function* distanceToFacesSteps(positions: ArrayLike<number>, index: ArrayLike<number>, faces: ArrayLike<number>, q: Vec3): Steps<number> {
  const pos = (v: number): Vec3 => [positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]];
  let best = Infinity;
  for (let k = 0; k < faces.length; k++) {
    if (k % YIELD_EVERY === 0) yield;
    const t = faces[k];
    best = Math.min(best, dist(q, closestOnTriangle(q, pos(index[3 * t]), pos(index[3 * t + 1]), pos(index[3 * t + 2]))));
  }
  return best;
}

/** Every measurement of a flake from its annotations. */
export function* flakeMeasuresSteps(input: FlakeInput): Steps<FlakeResult> {
  const { positions, index, matrix, P, ends, platformFaces, platformArea, unit, meanEdge, morph } = input;
  const o: Vec3 = input.offset ?? [0, 0, 0];
  const m = emptyFlakeMeasures();
  const geometry: FlakeGeometry = { P, E: null, platformLine: null, epaPoints: [], ipaFrom: null, ipaTo: null, ipaLine: null };
  let ipaBand: IpaBand | null = null;
  let bsaReference: FlakeResult['bsaReference'] = null;
  const reasons: FlakeResult['reasons'] = {};
  const toLocal = (p: Vec3): Vec3 => [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
  const toOriginal = (p: Vec3): Vec3 => [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
  const pair = (x: [Vec3, Vec3] | null): [Vec3, Vec3] | null => (x ? [toOriginal(x[0]), toOriginal(x[1])] : null);
  const construction: FlakeConstruction = { tech: null, morph: null, angle: null, width: null, depth: null, platformFaces: platformFaces?.length ? platformFaces : null, profile: null, psia: null, popEdges: null, plane: null, bulb: null, ipa: null };
  /** Those of these measures still empty, for this reason. */
  const why = (reason: FlakeEmptyReason, keys: readonly FlakeMeasure[]) => {
    for (const k of keys) if (m[k] === null && !reasons[k]) reasons[k] = reason;
  };
  const mm = mmPerUnit(unit);
  // PSIA: at P between the lines to the platform ends (no frame needed)
  if (P && ends.length >= 2) {
    m.psia = angleDeg(sub(ends[0], P), sub(ends[1], P));
    construction.psia = { P, ends: [ends[0], ends[1]] };
  } else if (P) why('no_ends', ['psia']);
  // the mesh's resolution round P
  if (P && mm !== null) {
    const near = yield* meshEdgeNearSteps(positions, index, toLocal(P), POP_MESH_RADIUS_MM / mm, input.edges ?? null);
    m.pop_mesh_edge = near.mean;
    if (near.mean !== null) construction.popEdges = { P, segments: near.segments.map(toOriginal) };
  } else if (P) why('no_unit', ['pop_mesh_edge']);
  if (morph) {
    m.morph_length = morph.length;
    m.morph_width = morph.width;
    m.morph_thickness = morph.thickness;
    const c = morph.construction;
    construction.morph = { length: pair(c.length)!, width: pair(c.width)!, thickness: pair(c.thickness)!, widthVertices: pair(c.widthVertices)!, thicknessVertices: pair(c.thicknessVertices)! };
  } else why('no_hull', ['morph_length', 'morph_width', 'morph_thickness']);
  if (!matrix || !P) {
    why(P ? 'frame_failed' : 'no_axis', AXIS_MEASURES);
    return { measures: m, reasons, geometry, section: null, construction, ipaBand, bsaReference };
  }
  const axes = frameAxes(matrix);
  const frame: FrameAxes = { ...axes, origin: toLocal(axes.origin) };
  const tech = yield* techDimensionsSteps(positions, frame);
  m.tech_length = tech.tech_length;
  m.tech_width = tech.tech_width;
  m.tech_thickness = tech.tech_thickness;
  const e = tech.construction.extremes;
  construction.tech = { ...tech.construction, origin: axes.origin, extremes: { xMin: toOriginal(e.xMin), xMax: toOriginal(e.xMax), yMax: toOriginal(e.yMax), zMin: toOriginal(e.zMin), zMax: toOriginal(e.zMax) } };
  if (morph) {
    m.morph_tech_angle_deg = morphTechAngle(morph.lengthDir, frame);
    const on = morphAxisOnFrame(morph.lengthDir, frame);
    if (on) construction.angle = { origin: axes.origin, tech: frame.y, morph: on, reach: tech.tech_length };
    why('along_z', ['morph_tech_angle_deg']);
  } else why('no_hull', ['morph_tech_angle_deg']);
  const localP = toLocal(P);
  // the proximal ventral plane (robust, within R of P, retouch and damage left out), and the bulb on it
  const ventral = input.ventralFaces?.length ? input.ventralFaces : null;
  const leftOut = input.leftOutFaces ?? null;
  const radius = Math.min(mm !== null ? BSA_REF_RADIUS_MM / mm : Infinity, 0.5 * tech.tech_length);
  const near = ventral && radius > 0 ? yield* proximalPlaneSteps(positions, index, ventral, leftOut, localP, radius, [-frame.z[0], -frame.z[1], -frame.z[2]], frame.y) : null;
  const plane = near?.plane ?? null;
  const planeOriginal = (p: BulbPlane): BulbPlane => ({ ...p, point: toOriginal(p.point) });
  if (near) {
    construction.plane = planeOriginal(near.plane);
    bsaReference = { radius, noise: near.noise };
  }
  /** The main bulb's vertices, when it is a bulb (IPA's band starts at its far end). */
  let bulbRegion: Uint32Array | null = null;
  if (!plane) why('no_ventral', BSA_MEASURES);
  else if (mm === null) why('no_unit', BSA_MEASURES);
  else {
    const settings = input.bsa ?? { level: BSA_LEVEL_DEFAULT_MM, ends: null };
    const r = yield* bulbSteps({ positions, index, faces: ventral!, plane, P: localP, mm, level: settings.level, ends: settings.ends ? [toLocal(settings.ends[0]), toLocal(settings.ends[1])] : null, noise: near!.noise });
    m.bsa = r.bsa;
    bulbRegion = r.region;
    VI_MEASURES.forEach((k, i) => (m[k] = r.vi?.[i]?.value ?? null));
    why(r.bsaEmpty ?? 'no_bulb', ['bsa']);
    why(r.bsaEmpty === 'bulb_open' ? 'bulb_open' : 'no_bulb', VI_MEASURES);
    const pairOf = (x: [Vec3, Vec3] | null): [Vec3, Vec3] | null => (x ? [toOriginal(x[0]), toOriginal(x[1])] : null);
    construction.bulb = {
      plane: planeOriginal(plane),
      P,
      P0: toOriginal(r.P0),
      level: settings.level,
      levelUnits: settings.level / mm,
      contour: r.contour.map((c) => ({ points: c.points.map(toOriginal), closed: c.closed })),
      autoEnds: pairOf(r.autoEnds),
      ends: pairOf(r.ends),
      moved: !!settings.ends,
      radius,
      noise: near!.noise,
      apex: r.apex ? toOriginal(r.apex) : null,
      vi: r.vi ? r.vi.map((s) => ({ ...s, corners: s.corners.map(toOriginal) as ViStrip['corners'], high: s.high ? toOriginal(s.high) : null, low: s.low ? toOriginal(s.low) : null })) : null,
      extent: r.extent,
    };
  }
  const section = input.section !== undefined ? input.section : lineNear(sectionByPlane(positions, index, frame.origin, frame.x, input.candidates ?? null), localP);
  yield;
  const done = (): FlakeResult => ({ measures: m, reasons, geometry, section, construction, ipaBand, bsaReference });
  if (!platformFaces?.length) {
    why('no_platform', PLATFORM_MEASURES);
    return done();
  }
  // the platform's area and width: from the region and the ends, no section needed
  m.platform_area = platformArea;
  why('no_platform', ['platform_area']);
  if (ends.length >= 2) {
    const a = toLocal(ends[0]), b = toLocal(ends[1]);
    m.platform_width_chord = dist(a, b);
    const width = yield* regionPathSteps(positions, index, platformFaces, a, b);
    m.platform_width_path = width?.length ?? null;
    why('no_path', ['platform_width_path']);
    construction.width = { ends: [ends[0], ends[1]], path: width ? width.points.map(toOriginal) : null };
  } else why('no_ends', ['platform_width_chord', 'platform_width_path']);
  // what is taken on the section: P must lie near the platform, and the section's platform stretch start near P (at S)
  const reach = mm !== null ? PLATFORM_REACH_MM / mm : PLATFORM_REACH_EDGES * meanEdge;
  const off = yield* distanceToFacesSteps(positions, index, platformFaces, localP);
  if (off > reach) {
    why('pop_off_platform', SECTION_MEASURES);
    return done();
  }
  if (!section) {
    why('section_misses_platform', SECTION_MEASURES);
    return done();
  }
  const mask = new Uint8Array(Math.floor(index.length / 3));
  for (let i = 0; i < platformFaces.length; i++) mask[platformFaces[i]] = 1;
  const profile = platformProfile(section, localP, (f) => mask[f] === 1, reach, mm);
  if (!profile) {
    why('section_misses_platform', SECTION_MEASURES);
    return done();
  }
  // the depth: from S, where the platform's stretch starts at its edge (the vertex of EPA and the bulb angle too)
  const S = profile.stretch[0];
  m.platform_depth_chord = dist(S, profile.E);
  const depth = yield* regionPathSteps(positions, index, platformFaces, S, profile.E);
  m.platform_depth_path = depth?.length ?? null;
  why('no_path', ['platform_depth_path']);
  construction.depth = { S: toOriginal(S), E: toOriginal(profile.E), path: depth ? depth.points.map(toOriginal) : null };
  m.epa_3pt_1mm = profile.epa3[0];
  m.epa_3pt_2mm = profile.epa3[1];
  m.epa_3pt_3mm = profile.epa3[2];
  m.epa_2ln_1mm = profile.epa2[0];
  m.epa_2ln_2mm = profile.epa2[1];
  m.epa_2ln_3mm = profile.epa2[2];
  m.bulb_angle_3pt_1mm = profile.bulb3;
  m.bulb_angle_2ln_1mm = profile.bulb2;
  why(mm === null ? 'no_unit' : 'section_ends', [...EPA_MEASURES, ...BULB_ANGLE_MEASURES]);
  geometry.E = toOriginal(profile.E);
  geometry.platformLine = pair(profile.line);
  geometry.epaPoints = profile.q.map((x) => (x ? toOriginal(x) : null));
  // IPA: the platform line against the plane of a band of the ventral face, from the bulb's far end on
  if (!ventral) why('no_ventral', ['ipa']);
  else if (!profile.lineDir) why('section_misses_platform', ['ipa']);
  else {
    const r = yield* ipaSteps({ positions, index, ventral, leftOut: input.leftOutFaces ?? null, bulb: bulbRegion, frame, techLength: tech.tech_length, lineDir: profile.lineDir });
    m.ipa = r.ipa;
    ipaBand = r.band;
    why(r.empty ?? 'band_too_small', ['ipa']);
    const from = reachingY(profile.ventralWalk, frame, r.band.from), to = reachingY(profile.ventralWalk, frame, r.band.to);
    geometry.ipaFrom = from ? toOriginal(from) : null;
    geometry.ipaTo = to ? toOriginal(to) : null;
    if (r.ipa !== null && r.line && r.dir && r.patch) {
      geometry.ipaLine = pair(r.line);
      construction.ipa = {
        P,
        E: toOriginal(profile.E),
        platformLine: pair(profile.line),
        lineDir: profile.lineDir,
        line: pair(r.line)!,
        dir: r.dir,
        patch: r.patch.map(toOriginal) as IpaConstruction['patch'],
        from: geometry.ipaFrom,
        to: geometry.ipaTo,
        fitted: r.fitted,
        excluded: r.excluded,
      };
    }
  }
  geometry.bulbAt = toOriginal(profile.bulbAt);
  geometry.bulbQ = profile.bulbQ ? toOriginal(profile.bulbQ) : null;
  geometry.bulbChord = pair(profile.bulbChord);
  construction.profile = {
    P,
    E: geometry.E,
    section: section.points.map(toOriginal),
    closed: section.closed,
    platformLine: geometry.platformLine,
    lineDir: profile.lineDir,
    q: geometry.epaPoints,
    chords: profile.chords.map(pair),
    bulbAt: geometry.bulbAt,
    bulbQ: geometry.bulbQ,
    bulbChord: geometry.bulbChord,
  };
  return done();
}

export const flakeMeasures = (input: FlakeInput): FlakeResult => runSync(flakeMeasuresSteps(input));

/** A flake's measures as a project stored them (`derived.flake.measures`): each of them there, a number or null; null without any. */
export function storedFlakeMeasures(derived: unknown): Partial<FlakeMeasures> | null {
  const m = (derived as { flake?: { measures?: unknown } | null } | null | undefined)?.flake?.measures;
  if (!m || typeof m !== 'object') return null;
  const out: Partial<FlakeMeasures> = {};
  for (const k of ALL_FLAKE_MEASURES) {
    if (!(k in m)) continue;
    const v = (m as Record<string, unknown>)[k];
    out[k] = typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  return out;
}

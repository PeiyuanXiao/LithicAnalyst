import { frameAxes } from '../core/frame';
import { mmPerUnit } from '../core/format';
import type { RetouchSettings, Vec3 } from '../core/types';
import { EDGE_ANGLE_STEP_MM } from './edgeAngle';
import { FIT_RESAMPLE_COUNT, fitLine, resampleEven, type MorphDimensions } from './flake';
import { pointAtArc } from './landmarks';
import { SLIVER_EDGES, type RetouchPiece, type RetouchRun, type RetouchStation, type RetouchWay, type StationSection } from './retouchAngle';
import { runsOf, withGapsFilled } from './sharpEdge';
import { runSync, YIELD_EVERY, type Steps } from './steps';

/**
 * The retouch indices of a flake, from its retouch regions and its edge, with no further annotation: the estimated reduction
 * (Eren et al. 2005; in 3D after Morales et al. 2015), GIUR (Kuhn 1990), invasiveness (Clarkson 2002), the share of the
 * perimeter retouched (Barton 1988; Brumm & McLaren 2011) and the edge's curvature (R6/R3, Hiscock & Attenbrow 2003, 2005).
 */

/** The length of section each original surface line is fitted to, by default. */
export const ORIGINAL_FIT_MM = 5;
/** A stretch cut short to less than this share of that length gives no line. */
export const ORIGINAL_FIT_MIN_SHARE = 0.5;
/** Two lines at less than this angle do not meet. */
export const MIN_MEET_DEG = 1;
/** How far (mean edge lengths) behind its start, away from the edge, a line may meet the other. */
export const MEET_TOLERANCE_EDGES = 1;
/** The range of the fitted length a specimen may set. */
export const FIT_LENGTH_RANGE_MM = [1, 20] as const;
/** Its step. */
export const FIT_LENGTH_STEP_MM = 0.5;
/** More than this share of the retouched stations without a missing area: no reduction. */
export const ERP_MAX_FILLED_SHARE = 0.25;
/** Cells of the outline along each axis of the plan. */
export const OUTLINE_BINS = 200;
/** Up to this far in, retouch counts half (Clarkson's outer zone). */
export const INVASIVE_BOUNDARY = 0.5;
/** A gap this long or shorter between two retouched stretches of an edge is part of them. */
export const RETOUCH_MERGE_GAP_MM = 2;

/** The parameters of the retouch indices, as stored with the results and in the manifest. */
export const RETOUCH_INDEX_PARAMETERS = {
  FIT_RESAMPLE_COUNT,
  ORIGINAL_FIT_MM,
  ORIGINAL_FIT_MIN_SHARE,
  MIN_MEET_DEG,
  MEET_TOLERANCE_EDGES,
  FIT_LENGTH_RANGE_MM: [...FIT_LENGTH_RANGE_MM],
  ERP_MAX_FILLED_SHARE,
  OUTLINE_BINS,
  INVASIVE_BOUNDARY,
  RETOUCH_MERGE_GAP_MM,
};

/** Why a value is empty: for the screen, neither stored nor exported. */
export const RETOUCH_EMPTY_REASONS = ['no_unit', 'no_faces', 'no_retouch_on_edge', 'no_edge', 'mesh_open', 'too_many_gaps', 'no_unifacial_station', 'no_axis', 'frame_failed', 'whole_edge', 'section_misses_curve', 'no_original_surface', 'lines_do_not_meet', 'bifacial'] as const;
export type RetouchEmptyReason = (typeof RETOUCH_EMPTY_REASONS)[number];

/** The part of a flake a triangle lies in. */
export const FACE_NONE = 0;
export const FACE_DORSAL = 1;
export const FACE_VENTRAL = 2;
export const FACE_PLATFORM = 3;

/** A fitted length as a specimen may have it: within the range, in its steps. */
export const clampFitLength = (mm: number): number => Math.min(FIT_LENGTH_RANGE_MM[1], Math.max(FIT_LENGTH_RANGE_MM[0], Math.round(mm / FIT_LENGTH_STEP_MM) * FIT_LENGTH_STEP_MM));

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

// ---------------------------------------------------------------- pure pieces

/**
 * Values missing along a curve (null), by those on either side at their positions, linearly; round a closed curve the two
 * ends meet (`period`: its length). With a value on one side only, that one; with none at all, 0.
 */
export function fillGaps(values: ReadonlyArray<number | null>, closed = false, positions: readonly number[] = values.map((_, i) => i), period = values.length): number[] {
  const known: number[] = [];
  values.forEach((v, i) => {
    if (v !== null) known.push(i);
  });
  if (!known.length) return values.map(() => 0);
  let next = 0;
  return values.map((v, i) => {
    if (v !== null) {
      next++;
      return v;
    }
    let a = next > 0 ? known[next - 1] : -1, b = next < known.length ? known[next] : -1;
    let pa = a >= 0 ? positions[a] : 0, pb = b >= 0 ? positions[b] : 0;
    if (closed) {
      if (a < 0) {
        a = known[known.length - 1];
        pa = positions[a] - period;
      }
      if (b < 0) {
        b = known[0];
        pb = positions[b] + period;
      }
    }
    if (a < 0) return values[b]!;
    if (b < 0 || a === b) return values[a]!;
    return values[a]! + ((values[b]! - values[a]!) * (positions[i] - pa)) / (pb - pa);
  });
}

/**
 * The chord from the first of these points to the last, and the depth: the point furthest from the chord, with its sign;
 * positive away from `inside` (a convex edge), negative toward it. `inside` on the chord says nothing: positive.
 */
export function chordDepth(points: ReadonlyArray<readonly [number, number]>, inside: readonly [number, number]): { chord: number; depth: number; far: number } {
  const a = points[0], b = points[points.length - 1];
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(chord > 0)) return { chord: 0, depth: 0, far: 0 };
  const nx = -(b[1] - a[1]) / chord, ny = (b[0] - a[0]) / chord;
  const side = (p: readonly [number, number]) => (p[0] - a[0]) * nx + (p[1] - a[1]) * ny;
  let most = 0, at = 0;
  points.forEach((p, i) => {
    if (Math.abs(side(p)) > Math.abs(most)) {
      most = side(p);
      at = i;
    }
  });
  const within = side(inside);
  const tiny = 1e-9 * chord;
  return { chord, depth: within > tiny ? -most : within < -tiny ? most : Math.abs(most), far: at };
}

// ---------------------------------------------------------------- the frame of the plan

export type SegmentAxis = 'technical' | 'longest';

/** The plan the segments are laid on. `origin`: in the coordinates of the positions. */
export interface SegmentFrame {
  kind: SegmentAxis;
  origin: Vec3;
  x: Vec3;
  y: Vec3;
  z: Vec3;
  /** The range along Y: from the proximal end to the distal end. */
  y0: number;
  y1: number;
}

export type SegmentFrameResult = { frame: SegmentFrame; reason: null } | { frame: null; reason: 'no_axis' | 'frame_failed' };

export interface SegmentFrameInput {
  /** Relative to `offset`; the matrices are in original coordinates. */
  positions: ArrayLike<number>;
  index: ArrayLike<number>;
  offset?: Vec3;
  /** +1 when triangles face outward, −1 when inward. */
  orientationSign?: number;
  /** The part of the flake each triangle lies in (`FACE_…`). */
  faceOf: ArrayLike<number>;
  settings: RetouchSettings;
  /** The technical frame (null: none). */
  matrix: readonly number[] | null;
  /** The longest distance's direction (null: none). */
  morph: MorphDimensions | null;
  /** The specimen frame: which way the longest axis points (null: none). */
  specimenFrame: readonly number[] | null;
}

/** By the axis asked for; `auto`: the technical axis when there is one, else the longest. */
export function* segmentFrameSteps(input: SegmentFrameInput): Steps<SegmentFrameResult> {
  const { positions: p, index, faceOf, settings, matrix, morph } = input;
  const o: Vec3 = input.offset ?? [0, 0, 0];
  const kind: SegmentAxis = settings.axis === 'auto' ? (matrix ? 'technical' : 'longest') : settings.axis;
  const n = Math.floor(p.length / 3);
  if (kind === 'technical') {
    if (!matrix) return { frame: null, reason: 'no_axis' };
    const f = frameAxes(matrix);
    const origin = sub(f.origin, o);
    let y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      if (i % YIELD_EVERY === 0) yield;
      const y = (p[3 * i] - origin[0]) * f.y[0] + (p[3 * i + 1] - origin[1]) * f.y[1] + (p[3 * i + 2] - origin[2]) * f.y[2];
      if (y > y1) y1 = y;
    }
    if (!(y1 > 0)) return { frame: null, reason: 'frame_failed' };
    return { frame: { kind, origin, x: f.x, y: f.y, z: f.z, y0: 0, y1 }, reason: null };
  }
  if (!morph) return { frame: null, reason: 'frame_failed' };
  let y: Vec3 = [...morph.lengthDir];
  if (input.specimenFrame && dot(y, frameAxes(input.specimenFrame).y) < 0) y = [-y[0], -y[1], -y[2]];
  if (settings.flip) y = [-y[0], -y[1], -y[2]];
  // the dorsal face's normal (or the ventral one's, turned round), by the triangles' areas
  const sign = input.orientationSign ?? 1;
  const dorsal: Vec3 = [0, 0, 0], ventral: Vec3 = [0, 0, 0];
  let dorsalSeen = false;
  const tris = Math.floor(index.length / 3);
  for (let t = 0; t < tris; t++) {
    if (t % YIELD_EVERY === 0) yield;
    const face = faceOf[t];
    if (face !== FACE_DORSAL && face !== FACE_VENTRAL) continue;
    const a = 3 * index[3 * t], b = 3 * index[3 * t + 1], c = 3 * index[3 * t + 2];
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const to = face === FACE_DORSAL ? dorsal : ventral;
    to[0] += sign * (uy * vz - uz * vy);
    to[1] += sign * (uz * vx - ux * vz);
    to[2] += sign * (ux * vy - uy * vx);
    if (face === FACE_DORSAL) dorsalSeen = true;
  }
  const mean: Vec3 = dorsalSeen ? dorsal : [-ventral[0], -ventral[1], -ventral[2]];
  const length = Math.hypot(mean[0], mean[1], mean[2]);
  if (!(length > 0)) return { frame: null, reason: 'frame_failed' };
  const along = dot(mean, y) / length;
  const across: Vec3 = [mean[0] / length - along * y[0], mean[1] / length - along * y[1], mean[2] / length - along * y[2]];
  if (Math.hypot(across[0], across[1], across[2]) < 1e-6) return { frame: null, reason: 'frame_failed' };
  const z = unit(across);
  const origin: Vec3 = [-o[0], -o[1], -o[2]];
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    if (i % YIELD_EVERY === 0) yield;
    const h = (p[3 * i] - origin[0]) * y[0] + (p[3 * i + 1] - origin[1]) * y[1] + (p[3 * i + 2] - origin[2]) * y[2];
    if (h < y0) y0 = h;
    if (h > y1) y1 = h;
  }
  if (!(y1 > y0)) return { frame: null, reason: 'frame_failed' };
  return { frame: { kind, origin, x: cross(y, z), y, z, y0, y1 }, reason: null };
}

export const segmentFrame = (input: SegmentFrameInput): SegmentFrameResult => runSync(segmentFrameSteps(input));

/** A point on the plan. */
export const onPlan = (f: SegmentFrame, p: Vec3): [number, number] => {
  const d = sub(p, f.origin);
  return [dot(d, f.x), dot(d, f.y)];
};

/** The outline on the plan: per cell along Y, its leftmost and rightmost; per cell along X, its top and bottom. */
export interface SegmentOutline {
  y0: number;
  L: number;
  xL: Float64Array;
  xR: Float64Array;
  xMin: number;
  xMax: number;
  yTop: Float64Array;
  yBot: Float64Array;
  /** The mean of all the vertices. */
  centre: [number, number];
}

/** A cell of `count` over the range from `lo`, `span` long; what lies beyond goes to the last cell on that side. */
const cellOf = (v: number, lo: number, span: number, count: number): number => Math.max(0, Math.min(count - 1, span > 0 ? Math.floor(((v - lo) / span) * count) : 0));

/** Empty cells (NaN), linearly between the nearest with a value; past the last one, that one. */
function fillCells(a: Float64Array): void {
  let last = -1;
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(a[i])) continue;
    if (last < 0) a.fill(a[i], 0, i);
    else for (let k = last + 1; k < i; k++) a[k] = a[last] + ((a[i] - a[last]) * (k - last)) / (i - last);
    last = i;
  }
  if (last >= 0) a.fill(a[last], last + 1);
}

export function* segmentOutlineSteps(positions: ArrayLike<number>, frame: SegmentFrame): Steps<SegmentOutline> {
  const p = positions, { origin: o, x: X, y: Y } = frame;
  const n = Math.floor(p.length / 3);
  const L = frame.y1 - frame.y0;
  let xMin = Infinity, xMax = -Infinity, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) {
    if (i % YIELD_EVERY === 0) yield;
    const dx = p[3 * i] - o[0], dy = p[3 * i + 1] - o[1], dz = p[3 * i + 2] - o[2];
    const x = dx * X[0] + dy * X[1] + dz * X[2];
    sx += x;
    sy += dx * Y[0] + dy * Y[1] + dz * Y[2];
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
  }
  const blank = () => new Float64Array(OUTLINE_BINS).fill(NaN);
  const xL = blank(), xR = blank(), yTop = blank(), yBot = blank();
  const spanX = xMax - xMin;
  for (let i = 0; i < n; i++) {
    if (i % YIELD_EVERY === 0) yield;
    const dx = p[3 * i] - o[0], dy = p[3 * i + 1] - o[1], dz = p[3 * i + 2] - o[2];
    const x = dx * X[0] + dy * X[1] + dz * X[2], y = dx * Y[0] + dy * Y[1] + dz * Y[2];
    const cy = cellOf(y, frame.y0, L, OUTLINE_BINS), cx = cellOf(x, xMin, spanX, OUTLINE_BINS);
    if (!(x >= xL[cy])) xL[cy] = x;
    if (!(x <= xR[cy])) xR[cy] = x;
    if (!(y <= yTop[cx])) yTop[cx] = y;
    if (!(y >= yBot[cx])) yBot[cx] = y;
  }
  for (const a of [xL, xR, yTop, yBot]) fillCells(a);
  return { y0: frame.y0, L, xL, xR, xMin, xMax, yTop, yBot, centre: [n ? sx / n : 0, n ? sy / n : 0] };
}

/** The row of the plan a height lies in, 0 (proximal) to 4. */
export const rowOf = (o: SegmentOutline, y: number): number => Math.max(0, Math.min(4, Math.floor((5 * (y - o.y0)) / o.L)));

/** The middle and half width of the outline at a height. */
export function across(o: SegmentOutline, y: number): { mid: number; half: number } {
  const c = cellOf(y, o.y0, o.L, OUTLINE_BINS);
  return { mid: (o.xL[c] + o.xR[c]) / 2, half: (o.xR[c] - o.xL[c]) / 2 };
}

/** The segment (1–8) a point of the plan lies in: row 1 and row 5 whole, rows 2–4 left and right of the middle (X to the right). */
export function segmentAt(o: SegmentOutline, x: number, y: number): number {
  const row = rowOf(o, y);
  if (row === 0) return 1;
  if (row === 4) return 8;
  return 2 * row + (x < across(o, y).mid ? 0 : 1);
}

/**
 * How far in a point of the plan is, 0 at the edge: from the sides; in the two end rows also from the end, whichever is less. The end's share is 1
 * where its row begins, so the value runs on across the rows, and its level lines close round the plan.
 */
export function penetrationAt(o: SegmentOutline, x: number, y: number): number {
  const share = (top: number, bottom: number) => (bottom > 0 ? Math.max(0, Math.min(1, top / bottom)) : 1);
  const { mid, half } = across(o, y);
  const side = share(half - Math.abs(x - mid), half);
  const row = rowOf(o, y);
  if (row !== 0 && row !== 4) return side;
  const c = cellOf(x, o.xMin, o.xMax - o.xMin, OUTLINE_BINS);
  return Math.min(side, row === 4 ? share(o.yTop[c] - y, o.yTop[c] - (o.y0 + 0.8 * o.L)) : share(y - o.yBot[c], o.y0 + 0.2 * o.L - o.yBot[c]));
}

/** The sixteen segments (the ventral face's are 9–16): how far in the retouch reaches in each, and its score. */
function* penetrationSteps(input: Pick<RetouchIndexInput, 'positions' | 'index' | 'faceOf' | 'pieceOfFace' | 'pieces'>, frame: SegmentFrame, outline: SegmentOutline): Steps<PenetrationRow[]> {
  const { positions: p, index, faceOf, pieceOfFace, pieces } = input;
  const most = new Float64Array(16);
  const retouched = new Uint8Array(16);
  const tris = Math.floor(index.length / 3);
  const { origin: o, x: X, y: Y } = frame;
  for (let t = 0; t < tris; t++) {
    if (t % YIELD_EVERY === 0) yield;
    const face = faceOf[t];
    if ((face !== FACE_DORSAL && face !== FACE_VENTRAL) || !pieces.has(pieceOfFace[t])) continue;
    const a = 3 * index[3 * t], b = 3 * index[3 * t + 1], c = 3 * index[3 * t + 2];
    const dx = (p[a] + p[b] + p[c]) / 3 - o[0], dy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3 - o[1], dz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3 - o[2];
    const x = dx * X[0] + dy * X[1] + dz * X[2], y = dx * Y[0] + dy * Y[1] + dz * Y[2];
    const seg = segmentAt(outline, x, y) - 1 + (face === FACE_VENTRAL ? 8 : 0);
    most[seg] = Math.max(most[seg], penetrationAt(outline, x, y));
    retouched[seg] = 1;
  }
  return Array.from(most, (reach, i) => ({ face: faceOfSegment(i), segment: i + 1, penetration: reach, score: !retouched[i] ? 0 : reach <= INVASIVE_BOUNDARY ? 0.5 : 1 }));
}

const faceOfSegment = (i: number): 'dorsal' | 'ventral' => (i < 8 ? 'dorsal' : 'ventral');

// ---------------------------------------------------------------- the original surface at a station

/** A side of the edge at a station. */
interface Side {
  way: RetouchWay;
  runs: RetouchRun[];
  /** The part of the flake its first triangles lie in. */
  face: number;
  /** Where it leaves that part, along the way. */
  extent: number;
  /** From the edge to the outer end of the deepest layer (0: no retouch). */
  depth: number;
  /** How far a fitted stretch may go: within the part, before other retouch, and the way itself. */
  limit: number;
}

/**
 * The part a way runs through, from the edge. Region borders follow mesh edges and the curve need not, so the way may begin with a sliver of
 * another part, and pass one later: as with the layers, such stretches do not count.
 */
function faceAlong(way: RetouchWay, faceOf: ArrayLike<number>, sliver: number): { face: number; extent: number } {
  const runs: Array<{ face: number; from: number; to: number }> = [];
  way.faces.forEach((t, i) => {
    const face = faceOf[t], last = runs[runs.length - 1];
    if (last?.face === face) last.to = way.cum[i + 1];
    else runs.push({ face, from: way.cum[i], to: way.cum[i + 1] });
  });
  if (!runs.length) return { face: FACE_NONE, extent: 0 };
  const long = runs.filter((r) => r.to - r.from >= sliver);
  const kept = long.length ? long : [runs.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a))];
  let extent = kept[0].to;
  for (const r of kept.slice(1)) {
    if (r.face !== kept[0].face) break;
    extent = r.to;
  }
  return { face: kept[0].face, extent };
}

/** Where retouch begins again beyond `from` along a way (slivers do not count); the way's end when it does not. */
function nextRetouch(way: RetouchWay, pieceOfFace: ArrayLike<number>, pieces: ReadonlyMap<number, RetouchPiece>, from: number, sliver: number): number {
  let begun = -1;
  for (let i = 0; i < way.faces.length; i++) {
    if (way.cum[i + 1] <= from) continue;
    if (pieces.has(pieceOfFace[way.faces[i]])) {
      if (begun < 0) begun = Math.max(way.cum[i], from);
      if (way.cum[i + 1] - begun >= sliver) return begun;
    } else begun = -1;
  }
  return way.length;
}

/** The way from `a` to `b` along it. */
export function stretchOf(way: RetouchWay, a: number, b: number): Vec3[] {
  const out: Vec3[] = [pointAtArc(way.points, false, way.cum, a)];
  for (let i = 0; i < way.points.length; i++) if (way.cum[i] > a && way.cum[i] < b) out.push(way.points[i]);
  out.push(pointAtArc(way.points, false, way.cum, b));
  return out;
}

const fitStretch = (way: RetouchWay, a: number, b: number) => (b > a ? fitLine(resampleEven(stretchOf(way, a, b), FIT_RESAMPLE_COUNT)) : null);

const distanceToLine = (p: Vec3, line: { point: Vec3; dir: Vec3 }): number => {
  const d = sub(p, line.point), s = dot(d, line.dir);
  return Math.hypot(d[0] - s * line.dir[0], d[1] - s * line.dir[1], d[2] - s * line.dir[2]);
};

/**
 * The ridge on a side, as seen from the other side's line: along the way, within its part, the point furthest from that line. Peaks within
 * `tolerance` of the highest are as high, and the last of them is taken: a flat dorsal face ends at the end of the flat.
 */
function ridgeAlong(side: Side, line: { point: Vec3; dir: Vec3 }, tolerance: number): number {
  const { way, extent } = side;
  const arcs: number[] = [];
  const heights: number[] = [];
  for (let i = 0; i < way.points.length && way.cum[i] <= extent; i++) {
    arcs.push(way.cum[i]);
    heights.push(distanceToLine(way.points[i], line));
  }
  if (arcs[arcs.length - 1] < extent) {
    arcs.push(extent);
    heights.push(distanceToLine(pointAtArc(way.points, false, way.cum, extent), line));
  }
  const top = heights.reduce((a, b) => Math.max(a, b), 0);
  // the noise of the coordinates makes no peak
  const noise = 1e-3 * tolerance;
  let at = 0;
  heights.forEach((h, i) => {
    if (h >= top - tolerance && (i === 0 || h >= heights[i - 1] - noise) && (i === heights.length - 1 || h >= heights[i + 1] - noise)) at = i;
  });
  return arcs[at];
}

/** What was fitted on a side: the stretch along the way, and whether the ridge ended it. */
export interface OriginalFit {
  from: number;
  to: number;
  atRidge: boolean;
  line: { point: Vec3; dir: Vec3 };
}

export interface OriginalSurface {
  /** Between the two lines and the section. */
  area: number;
  /** Between the two lines where they meet. */
  angle: number;
  /** From the edge to where they meet. */
  recession: number;
  /** Where they meet. */
  A0: Vec3;
  fits: [OriginalFit, OriginalFit];
}

/** The two lines of the original surface and what lies between them and the section (`w`: the fitted length). */
function originalSurface(sec: StationSection, sides: [Side, Side], w: number, meanEdge: number): OriginalSurface | 'no_original_surface' | 'lines_do_not_meet' {
  const short = ORIGINAL_FIT_MIN_SHARE * w - 1e-9;
  const ends = sides.map((s) => Math.min(s.depth + w, s.limit));
  if (ends.some((e, i) => e - sides[i].depth < short)) return 'no_original_surface';
  const first = sides.map((s, i) => fitStretch(s.way, s.depth, ends[i]));
  if (!first[0] || !first[1]) return 'no_original_surface';
  // the second pass: up to the ridge, as seen from the other side's line
  const fits: OriginalFit[] = [];
  for (let i = 0; i < 2; i++) {
    const s = sides[i];
    const ridge = ridgeAlong(s, first[1 - i]!, meanEdge);
    const to = Math.min(ends[i], ridge);
    if (to - s.depth < short || to <= s.depth) return 'no_original_surface';
    const line = fitStretch(s.way, s.depth, to);
    if (!line) return 'no_original_surface';
    fits.push({ from: s.depth, to, atRidge: ridge < ends[i], line });
  }
  // in the section's plane, from A
  const A = sec.A;
  const ref: Vec3 = Math.abs(sec.normal[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  const e1 = unit(cross(sec.normal, ref));
  const e2 = cross(sec.normal, e1);
  const flat = (p: Vec3): [number, number] => {
    const d = sub(p, A);
    return [dot(d, e1), dot(d, e2)];
  };
  const lines = fits.map((f, i) => {
    const way = sides[i].way;
    const F = pointAtArc(way.points, false, way.cum, f.from), far = pointAtArc(way.points, false, way.cum, f.to);
    // from F toward the edge
    const along = dot(sub(F, far), f.line.dir) < 0 ? -1 : 1;
    const d3: Vec3 = [along * f.line.dir[0], along * f.line.dir[1], along * f.line.dir[2]];
    const s = dot(sub(F, f.line.point), f.line.dir);
    const start = flat([f.line.point[0] + s * f.line.dir[0], f.line.point[1] + s * f.line.dir[1], f.line.point[2] + s * f.line.dir[2]]);
    const d = [dot(d3, e1), dot(d3, e2)] as const;
    return { F, start, d };
  });
  const [a, b] = lines;
  const c = a.d[0] * b.d[1] - a.d[1] * b.d[0];
  const between = (Math.atan2(Math.abs(c), a.d[0] * b.d[0] + a.d[1] * b.d[1]) * 180) / Math.PI;
  if (Math.min(between, 180 - between) < MIN_MEET_DEG) return 'lines_do_not_meet';
  const gx = b.start[0] - a.start[0], gy = b.start[1] - a.start[1];
  const ta = (gx * b.d[1] - gy * b.d[0]) / c, tb = (gx * a.d[1] - gy * a.d[0]) / c;
  const behind = -MEET_TOLERANCE_EDGES * meanEdge;
  if (ta < behind || tb < behind) return 'lines_do_not_meet';
  const at: [number, number] = [a.start[0] + ta * a.d[0], a.start[1] + ta * a.d[1]];
  // A0, F₁, along the section to A, along the section to F₂
  const ring: Array<[number, number]> = [at];
  for (const p of stretchOf(sides[0].way, 0, sides[0].depth).reverse()) ring.push(flat(p));
  for (const p of stretchOf(sides[1].way, 0, sides[1].depth).slice(1)) ring.push(flat(p));
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    twice += p[0] * q[1] - q[0] * p[1];
  }
  const A0: Vec3 = [A[0] + at[0] * e1[0] + at[1] * e2[0], A[1] + at[0] * e1[1] + at[1] * e2[1], A[2] + at[0] * e1[2] + at[1] * e2[2]];
  return { area: Math.abs(twice) / 2, angle: between, recession: dist(A, A0), A0, fits: [fits[0], fits[1]] };
}

/** The two sides of a station's section, and which way is on the dorsal side (−1: not told). */
function sidesOf(sec: StationSection, faceOf: ArrayLike<number>, pieceOfFace: ArrayLike<number>, pieces: ReadonlyMap<number, RetouchPiece>, sliver: number): { sides: [Side, Side]; dorsal: number } {
  const sides = ([0, 1] as const).map((i): Side => {
    const way = sec.ways[i], runs = sec.runs[i];
    const { face, extent } = faceAlong(way, faceOf, sliver);
    const depth = runs.length ? runs[runs.length - 1].to : 0;
    return { way, runs, face, extent, depth, limit: Math.min(extent, nextRetouch(way, pieceOfFace, pieces, depth, sliver)) };
  }) as [Side, Side];
  return { sides, dorsal: sides[0].face === FACE_DORSAL && sides[1].face === FACE_VENTRAL ? 0 : sides[1].face === FACE_DORSAL && sides[0].face === FACE_VENTRAL ? 1 : -1 };
}

/** Which way of a station's section is on the dorsal side (−1: not told), and where each way leaves its part. */
export function stationFaces(sec: StationSection, faceOf: ArrayLike<number>, pieceOfFace: ArrayLike<number>, pieces: ReadonlyMap<number, RetouchPiece>, meanEdge: number): { dorsal: number; extents: [number, number]; depths: [number, number] } {
  const { sides, dorsal } = sidesOf(sec, faceOf, pieceOfFace, pieces, SLIVER_EDGES * meanEdge);
  return { dorsal, extents: [sides[0].extent, sides[1].extent], depths: [sides[0].depth, sides[1].depth] };
}

/** The first point of the dorsal side straight above a point, across a line. */
function dorsalOver(dorsal: Side, from: Vec3, line: { point: Vec3; dir: Vec3 }): Vec3 | null {
  const along = (p: Vec3) => dot(sub(p, from), line.dir);
  const points = stretchOf(dorsal.way, 0, dorsal.extent);
  for (let i = 0; i + 1 < points.length; i++) {
    const a = along(points[i]), b = along(points[i + 1]);
    if (a === b || a * b > 0) continue;
    const s = a / (a - b);
    return [points[i][0] + s * (points[i + 1][0] - points[i][0]), points[i][1] + s * (points[i + 1][1] - points[i][1]), points[i][2] + s * (points[i + 1][2] - points[i][2])];
  }
  return null;
}

/**
 * GIUR at a station with retouch on one side only, from the line of the ventral face beyond any retouch: how thick the flake is where the retouch
 * ends, and at its thickest. Retouch on the dorsal side ends at R itself; on the ventral side, the thickness is taken from the dorsal surface over R.
 */
function giurAt(dorsal: Side, ventral: Side): { t: number; T: number; H: Vec3; C: Vec3; ratio: number; line: { point: Vec3; dir: Vec3 } } | null {
  const line = fitStretch(ventral.way, ventral.depth, ventral.extent);
  if (!line) return null;
  const H = ventral.runs.length ? dorsalOver(dorsal, pointAtArc(ventral.way.points, false, ventral.way.cum, ventral.depth), line) : pointAtArc(dorsal.way.points, false, dorsal.way.cum, dorsal.depth);
  if (!H) return null;
  let T = 0;
  let C = H;
  for (const p of stretchOf(dorsal.way, 0, dorsal.extent)) {
    const h = distanceToLine(p, line);
    if (h > T) {
      T = h;
      C = p;
    }
  }
  const t = distanceToLine(H, line);
  return T > 0 ? { t, T, H, C, ratio: t / T, line } : null;
}

// ---------------------------------------------------------------- all together

/** A curve measured: its stations and their sections, from the retouch layers (none: no stations). */
export interface RetouchCurve {
  curveId: string;
  /** Of type `edge`: only these count for the perimeter and the curvature. */
  edge: boolean;
  closed: boolean;
  /** Of the reference curve. */
  length: number;
  stations: readonly RetouchStation[];
  sections: ReadonlyArray<StationSection | null>;
}

export interface RetouchIndexInput {
  /** Relative to `offset`; the stations' points are in original coordinates. */
  positions: ArrayLike<number>;
  index: ArrayLike<number>;
  offset?: Vec3;
  /** The part of the flake each triangle lies in (`FACE_…`). */
  faceOf: ArrayLike<number>;
  /** The piece of each triangle in the lower layer of regions. */
  pieceOfFace: ArrayLike<number>;
  /** The pieces in a retouch layer. */
  pieces: ReadonlyMap<number, RetouchPiece>;
  curves: readonly RetouchCurve[];
  unit: string;
  meanEdge: number;
  /** Of the model; null when the mesh is not closed. */
  volume: number | null;
  /** mm; null: the default. */
  fitLength: number | null;
  frame: SegmentFrameResult;
  /** On that frame, when it is known. */
  outline?: SegmentOutline | null;
}

/** One retouched station (as retouch_sections.csv has it). */
export interface RetouchStationRow {
  curveId: string;
  station: number;
  position: number;
  segment: number | null;
  x: number | null;
  y: number | null;
  depth_dorsal: number | null;
  depth_ventral: number | null;
  removed_area: number | null;
  filled: boolean;
  original_angle_deg: number | null;
  recession: number | null;
  retouch_height: number | null;
  thickness: number | null;
  giur: number | null;
}

/** One retouch region on a curve (as retouch_segments.csv has it). */
export interface RetouchSegmentRow {
  curveId: string;
  region: string;
  layer: number;
  face: 'dorsal' | 'ventral' | null;
  start_position: number;
  end_position: number;
  length: number;
  chord: number | null;
  depth: number | null;
}

/** One segment of the sixteen (as invasiveness.csv has it). */
export interface PenetrationRow {
  face: 'dorsal' | 'ventral';
  segment: number;
  penetration: number;
  score: number;
}

/** The summary values, each named as its column of flakes.csv. */
export const RETOUCH_SUMMARY = ['removed_volume', 'erp', 'erp_filled_share', 'giur', 'giur_stations', 'invasiveness', 'invasiveness_continuous', 'retouch_perimeter', 'retouch_perimeter_dorsal', 'retouch_perimeter_ventral', 'edge_curvature', 'edge_curvature_chord', 'edge_curvature_depth'] as const;
export type RetouchSummaryKey = (typeof RETOUCH_SUMMARY)[number];

/** What is stored: `derived.retouchIndices`. */
export type RetouchIndices = Record<RetouchSummaryKey, number | null> & {
  parameters: typeof RETOUCH_INDEX_PARAMETERS;
  /** The fitted length used, mm. */
  fitLength: number;
  /** The frame used (null: none). */
  axis: SegmentAxis | null;
  /** Its axes, in original coordinates. */
  frame: { origin: Vec3; x: Vec3; y: Vec3; z: Vec3; y0: number; y1: number } | null;
  stations: RetouchStationRow[];
  segments: RetouchSegmentRow[];
  /** The sixteen segments; none when they cannot be told. */
  penetration: PenetrationRow[];
};

/** What was worked out at a station, for the screen; not stored. */
export interface RetouchStationDetail {
  curveId: string;
  station: number;
  /** Why it has no missing area of its own. */
  reason: RetouchEmptyReason | null;
  /** Why it takes no part in GIUR. */
  giurReason: RetouchEmptyReason | null;
  surface: OriginalSurface | null;
  /** The point t was measured to. */
  H: Vec3 | null;
  /** The point T was measured to. */
  C: Vec3 | null;
  /** The line t and T are measured from. */
  reference: { point: Vec3; dir: Vec3 } | null;
}

/** The stretch the curvature is taken of: its chord and depth on the plan, for drawing; not stored. */
export interface LongestStretch {
  curveId: string;
  a: [number, number];
  b: [number, number];
  /** The point furthest from the chord, and its foot on the chord. */
  far: [number, number];
  foot: [number, number];
}

export interface RetouchIndexResult {
  indices: RetouchIndices;
  /** Why each empty value is empty; not stored. */
  reasons: Partial<Record<RetouchSummaryKey, RetouchEmptyReason>>;
  details: RetouchStationDetail[];
  /** The plan's outline, for the next run on the same frame. */
  outline: SegmentOutline | null;
  longest: LongestStretch | null;
  /** The stations of each row of `indices.segments`, in order along it. */
  segmentStations: number[][];
}

/** What the stations of all the curves give at one fitted length. */
interface StationPass {
  rows: RetouchStationRow[];
  details: RetouchStationDetail[];
  /** Which way is on the dorsal side, per station of each curve (−1: not told). */
  dorsalWay: Int8Array[];
  retouched: number;
  filled: number;
  removed: number;
  knownFaces: number;
  giurSum: number;
  giurCount: number;
}

const weightOf = (c: RetouchCurve, k: number, step: number): number => (c.closed || (k > 0 && k < c.stations.length - 1) ? step : step / 2);

function* stationPass(input: RetouchIndexInput, frame: SegmentFrame | null, outline: SegmentOutline | null, fitLength: number): Steps<StationPass> {
  const { faceOf, pieceOfFace, pieces, curves, meanEdge } = input;
  const o: Vec3 = input.offset ?? [0, 0, 0];
  const mm = mmPerUnit(input.unit);
  const w = mm === null ? 0 : fitLength / mm;
  const step = mm === null ? 0 : EDGE_ANGLE_STEP_MM / mm;
  const sliver = SLIVER_EDGES * meanEdge;
  const rows: RetouchStationRow[] = [];
  const details: RetouchStationDetail[] = [];
  let retouched = 0, filled = 0, removed = 0, knownFaces = 0, giurSum = 0, giurCount = 0;
  const dorsalWay = curves.map((c) => new Int8Array(c.stations.length).fill(-1));
  for (const [ci, c] of curves.entries()) {
    const own: Array<{ k: number; row: RetouchStationRow; area: number | null }> = [];
    for (let k = 0; k < c.stations.length; k++) {
      const s = c.stations[k], sec = c.sections[k];
      if (!s.point) {
        details.push({ curveId: c.curveId, station: k, reason: 'section_misses_curve', giurReason: null, surface: null, H: null, C: null, reference: null });
        continue;
      }
      if (!sec) continue;
      yield;
      const { sides, dorsal: d } = sidesOf(sec, faceOf, pieceOfFace, pieces, sliver);
      dorsalWay[ci][k] = d;
      const plan = frame && outline ? onPlan(frame, sub(s.point, o)) : null;
      const row: RetouchStationRow = {
        curveId: c.curveId,
        station: k,
        position: s.position,
        segment: plan && outline ? segmentAt(outline, plan[0], plan[1]) : null,
        x: plan ? plan[0] : null,
        y: plan ? plan[1] : null,
        depth_dorsal: d < 0 ? null : sides[d].depth,
        depth_ventral: d < 0 ? null : sides[1 - d].depth,
        removed_area: null,
        filled: false,
        original_angle_deg: null,
        recession: null,
        retouch_height: null,
        thickness: null,
        giur: null,
      };
      const detail: RetouchStationDetail = { curveId: c.curveId, station: k, reason: null, giurReason: null, surface: null, H: null, C: null, reference: null };
      let area: number | null = null;
      if (d < 0) {
        detail.reason = 'no_faces';
        detail.giurReason = 'no_faces';
      } else {
        knownFaces++;
        const surface = originalSurface(sec, sides, w, meanEdge);
        if (typeof surface === 'string') detail.reason = surface;
        else {
          detail.surface = surface;
          area = surface.area;
          row.original_angle_deg = surface.angle;
          row.recession = surface.recession;
        }
        const dorsal = sides[d], ventral = sides[1 - d];
        if (dorsal.runs.length && ventral.runs.length) detail.giurReason = 'bifacial';
        else {
          const g = giurAt(dorsal, ventral);
          if (g) {
            row.retouch_height = g.t;
            row.thickness = g.T;
            row.giur = g.ratio;
            detail.H = g.H;
            detail.C = g.C;
            detail.reference = g.line;
            giurSum += g.ratio;
            giurCount++;
          } else detail.giurReason = 'no_original_surface';
        }
      }
      details.push(detail);
      rows.push(row);
      own.push({ k, row, area });
    }
    // the gaps: by the stations on either side
    const areas = fillGaps(own.map((x) => x.area), c.closed, own.map((x) => c.stations[x.k].position), c.length);
    own.forEach((x, i) => {
      x.row.removed_area = areas[i];
      x.row.filled = x.area === null;
      removed += weightOf(c, x.k, step) * areas[i];
      retouched++;
      if (x.area === null) filled++;
    });
  }
  return { rows, details, dorsalWay, retouched, filled, removed, knownFaces, giurSum, giurCount };
}

/** The volume removed at each of these fitted lengths (mm); null where it would be empty. The rest of the indices do not depend on them. */
export function* removedVolumeCurveSteps(input: RetouchIndexInput, lengths: readonly number[]): Steps<Array<{ length: number; removed: number | null }>> {
  const out: Array<{ length: number; removed: number | null }> = [];
  for (const length of lengths) {
    const p = yield* stationPass(input, null, null, length);
    const told = input.pieces.size > 0 && p.retouched > 0 && p.knownFaces > 0 && p.filled / p.retouched <= ERP_MAX_FILLED_SHARE;
    out.push({ length, removed: told ? p.removed : null });
  }
  return out;
}

/** All the retouch indices of a flake. A flake without any retouch region counts as not retouched. */
export function* retouchIndexSteps(input: RetouchIndexInput): Steps<RetouchIndexResult> {
  const { positions, faceOf, pieces, curves, volume, frame: chosen } = input;
  const o: Vec3 = input.offset ?? [0, 0, 0];
  const mm = mmPerUnit(input.unit);
  const fitLength = input.fitLength ?? ORIGINAL_FIT_MM;
  const frame = chosen.frame;
  const outline = frame ? (input.outline ?? (yield* segmentOutlineSteps(positions, frame))) : null;
  const step = mm === null ? 0 : EDGE_ANGLE_STEP_MM / mm;
  const local = (p: Vec3): Vec3 => sub(p, o);
  const { rows, details, dorsalWay, retouched, filled, removed, knownFaces, giurSum, giurCount } = yield* stationPass(input, frame, outline, fitLength);

  const edges = curves.map((c, i) => ({ c, i })).filter((x) => x.c.edge);
  const reasons: RetouchIndexResult['reasons'] = {};
  /** These values are empty, for this reason. */
  const empty = (reason: RetouchEmptyReason, keys: readonly RetouchSummaryKey[]) => {
    for (const k of keys) if (!reasons[k]) reasons[k] = reason;
  };
  const values = Object.fromEntries(RETOUCH_SUMMARY.map((k) => [k, null])) as Record<RetouchSummaryKey, number | null>;
  let penetration: PenetrationRow[] = [];
  const segments: RetouchSegmentRow[] = [];
  const segmentStations: number[][] = [];
  let longest: LongestStretch | null = null;
  const CURVATURE = ['edge_curvature', 'edge_curvature_chord', 'edge_curvature_depth'] as const;

  if (!pieces.size) {
    // no retouch marked: not retouched
    for (const k of RETOUCH_SUMMARY) values[k] = 0;
    for (const k of CURVATURE) values[k] = null;
    empty('no_retouch_on_edge', CURVATURE);
    penetration = Array.from({ length: 16 }, (_, i) => ({ face: faceOfSegment(i), segment: i + 1, penetration: 0, score: 0 }));
  } else {
    // the missing volume
    const REDUCTION = ['removed_volume', 'erp', 'erp_filled_share'] as const;
    if (mm === null) empty('no_unit', REDUCTION);
    else if (!retouched) empty('no_retouch_on_edge', REDUCTION);
    else {
      values.erp_filled_share = filled / retouched;
      if (!knownFaces) empty('no_faces', ['removed_volume', 'erp']);
      else if (filled / retouched > ERP_MAX_FILLED_SHARE) empty('too_many_gaps', ['removed_volume', 'erp']);
      else {
        values.removed_volume = removed;
        if (volume === null) empty('mesh_open', ['erp']);
        else values.erp = removed + volume > 0 ? removed / (removed + volume) : null;
      }
    }

    // GIUR
    if (mm === null) empty('no_unit', ['giur', 'giur_stations']);
    else {
      values.giur_stations = giurCount;
      if (!retouched) empty('no_retouch_on_edge', ['giur']);
      else if (!knownFaces) empty('no_faces', ['giur']);
      else if (!giurCount) empty('no_unifacial_station', ['giur']);
      else values.giur = giurSum / giurCount;
    }

    // invasiveness
    let faces = false;
    for (let t = 0; t < faceOf.length && !faces; t++) {
      if (t % YIELD_EVERY === 0) yield;
      faces = faceOf[t] === FACE_DORSAL || faceOf[t] === FACE_VENTRAL;
    }
    const INVASIVE = ['invasiveness', 'invasiveness_continuous'] as const;
    if (!faces) empty('no_faces', INVASIVE);
    else if (!frame || !outline) empty(chosen.reason ?? 'frame_failed', INVASIVE);
    else {
      penetration = yield* penetrationSteps(input, frame, outline);
      values.invasiveness = penetration.reduce((s, r) => s + r.score, 0) / 16;
      values.invasiveness_continuous = penetration.reduce((s, r) => s + r.penetration, 0) / 16;
    }

    // the perimeter
    const PERIMETER = ['retouch_perimeter', 'retouch_perimeter_dorsal', 'retouch_perimeter_ventral'] as const;
    if (mm === null) empty('no_unit', PERIMETER);
    else if (!edges.length || !edges.some((x) => x.c.stations.length)) empty('no_edge', PERIMETER);
    else {
      let total = 0, all = 0, dorsal = 0, ventral = 0, told = false, anyRetouch = false;
      for (const { c, i } of edges) {
        for (let k = 0; k < c.stations.length; k++) {
          const weight = weightOf(c, k, step);
          total += weight;
          const sec = c.sections[k];
          if (!sec) continue;
          all += weight;
          anyRetouch = true;
          const d = dorsalWay[i][k];
          if (d < 0) continue;
          told = true;
          if (sec.runs[d].length) dorsal += weight;
          if (sec.runs[1 - d].length) ventral += weight;
        }
      }
      values.retouch_perimeter = all / total;
      if (anyRetouch && !told) empty('no_faces', ['retouch_perimeter_dorsal', 'retouch_perimeter_ventral']);
      else {
        values.retouch_perimeter_dorsal = dorsal / total;
        values.retouch_perimeter_ventral = ventral / total;
      }
    }

    // the curvature of the longest retouched stretch of an edge
    if (mm === null) empty('no_unit', CURVATURE);
    else {
      let best: { c: RetouchCurve; first: number; count: number; weight: number } | null = null;
      for (const { c } of edges) {
        const n = c.stations.length;
        const raw = c.stations.map((s) => s.stretches.length > 0);
        for (const [first, count] of runsOf(withGapsFilled(raw, c.closed, EDGE_ANGLE_STEP_MM, RETOUCH_MERGE_GAP_MM), c.closed)) {
          let weight = 0;
          for (let i = 0; i < count; i++) weight += weightOf(c, (first + i) % n, step);
          if (!best || weight > best.weight) best = { c, first, count, weight };
        }
      }
      if (!best) empty('no_retouch_on_edge', CURVATURE);
      else if (best.c.closed && best.count === best.c.stations.length) empty('whole_edge', CURVATURE);
      else if (!frame || !outline) empty(chosen.reason ?? 'frame_failed', CURVATURE);
      else {
        const points: Array<[number, number]> = [];
        for (let i = 0; i < best.count; i++) {
          const p = best.c.stations[(best.first + i) % best.c.stations.length].point;
          if (p) points.push(onPlan(frame, local(p)));
        }
        const { chord, depth, far } = chordDepth(points.length ? points : [[0, 0]], outline.centre);
        if (chord > 0) {
          values.edge_curvature = depth / chord;
          values.edge_curvature_chord = chord;
          values.edge_curvature_depth = depth;
          const a = points[0], b = points[points.length - 1], p = points[far];
          const along = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (chord * chord);
          longest = { curveId: best.c.curveId, a, b, far: p, foot: [a[0] + along * (b[0] - a[0]), a[1] + along * (b[1] - a[1])] };
        } else empty('no_retouch_on_edge', CURVATURE);
      }
    }

    // the retouch regions along the curves
    for (const [ci, c] of curves.entries()) {
      yield;
      const n = c.stations.length;
      const found = new Map<string, { layer: number; on: Set<number>; dorsal: number; ventral: number }>();
      for (let k = 0; k < n; k++) {
        const sec = c.sections[k];
        if (!sec) continue;
        const d = dorsalWay[ci][k];
        sec.runs.forEach((runs, way) => {
          for (const r of runs) {
            let f = found.get(r.region);
            if (!f) found.set(r.region, (f = { layer: r.layer, on: new Set(), dorsal: 0, ventral: 0 }));
            f.on.add(k);
            if (d >= 0) {
              if (way === d) f.dorsal++;
              else f.ventral++;
            }
          }
        });
      }
      for (const [region, f] of found) {
        const mask = Array.from({ length: n }, (_, k) => f.on.has(k));
        const whole = c.closed && withGapsFilled(mask, true, EDGE_ANGLE_STEP_MM, RETOUCH_MERGE_GAP_MM).every(Boolean);
        // in order along the curve; round a closed one, from behind its widest gap, so that a stretch over the start stays whole
        const on = [...f.on].sort((a, b) => a - b);
        let from = 0;
        if (c.closed) {
          let widest = -1;
          on.forEach((k, i) => {
            const gap = (on[(i + 1) % on.length] - k + n) % n || n;
            // (all the way round there is no gap: from the start)
            if (gap > widest && gap > 1) {
              widest = gap;
              from = (i + 1) % on.length;
            }
          });
        }
        const ordered = on.map((_, i) => on[(from + i) % on.length]);
        const placed = ordered.flatMap((k) => {
          const p = c.stations[k].point;
          return p && frame ? [onPlan(frame, local(p))] : [];
        });
        const shape = !whole && outline && placed.length ? chordDepth(placed, outline.centre) : null;
        segments.push({
          curveId: c.curveId,
          region,
          layer: f.layer,
          face: f.dorsal || f.ventral ? (f.dorsal >= f.ventral ? 'dorsal' : 'ventral') : null,
          start_position: c.stations[ordered[0]].position,
          end_position: c.stations[ordered[ordered.length - 1]].position,
          length: ordered.reduce((s, k) => s + weightOf(c, k, step), 0),
          chord: shape ? shape.chord : null,
          depth: shape ? shape.depth : null,
        });
        segmentStations.push(ordered);
      }
    }
  }

  return {
    indices: {
      parameters: RETOUCH_INDEX_PARAMETERS,
      fitLength,
      axis: frame?.kind ?? null,
      frame: frame ? { origin: [frame.origin[0] + o[0], frame.origin[1] + o[1], frame.origin[2] + o[2]], x: frame.x, y: frame.y, z: frame.z, y0: frame.y0, y1: frame.y1 } : null,
      ...values,
      stations: rows,
      segments,
      penetration,
    },
    reasons,
    details,
    outline,
    longest,
    segmentStations,
  };
}

export const retouchIndices = (input: RetouchIndexInput): RetouchIndexResult => runSync(retouchIndexSteps(input));

/** The part of the flake each triangle lies in, from the upper layer of regions: `faces` the part of each upper piece. */
export function* faceOfTrianglesSteps(upperOfFace: ArrayLike<number>, faces: ReadonlyMap<number, number>): Steps<Uint8Array> {
  const out = new Uint8Array(upperOfFace.length);
  if (faces.size) {
    for (let t = 0; t < upperOfFace.length; t++) {
      if (t % YIELD_EVERY === 0) yield;
      out[t] = faces.get(upperOfFace[t]) ?? FACE_NONE;
    }
  }
  return out;
}

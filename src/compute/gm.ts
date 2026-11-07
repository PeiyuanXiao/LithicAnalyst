import { PLATFORM_OUTLINE } from '../core/fields';
import { frameAxes, type FrameAxes } from '../core/frame';
import type { Curve, GmConfig, ProjectState, Vec3 } from '../core/types';
import { resampleEven } from './flake';
import { GM_TEMPLATE_PARAMETERS } from './gmTemplate';
import { arcLengths, landmarkTable, nearestArc, platformSides, pointAtArc, shownLandmarks, type LandmarkRow } from './landmarks';
import { regionPlaneSteps } from './planes';
import { runSync, type Steps } from './steps';
import { anchorWarpSteps } from './tps';
import type { TriangleBvh } from './triangleBvh';

/**
 * The points of a specimen for geometric morphometrics, by a configuration shared by every specimen. A flake: fixed landmarks,
 * curve semilandmarks along the edge and the platform outline, surface semilandmarks in grids over the ventral and
 * dorsal faces and the platform, or by a template. A core or a generic specimen: the lists of the configuration, and the template.
 * They follow from the annotations; none of them can be moved on its own. Sliding happens in R.
 */

/** The landmarks of a flake's own, which curves begin and end on. */
export const GM_ANCHORS = ['pop', 'platform_left', 'platform_right'] as const;
export type GmAnchor = (typeof GM_ANCHORS)[number];

/** Why a specimen cannot have all its points. These codes are written to the manifest; keep them. */
export const GM_MISSING = ['technical_axis', 'platform_ends', 'edge', 'platform_outline', 'platform_region', 'ventral_miss', 'dorsal_miss', 'platform_miss', 'point_count', 'landmark_missing', 'landmark_ambiguous', 'curve_missing', 'curve_ambiguous', 'curve_ends', 'region_missing', 'region_ambiguous', 'no_template', 'template_missing', 'template_stale', 'too_few_anchors', 'no_fit'] as const;
export type GmMissing = (typeof GM_MISSING)[number];

/** The three stretches of the platform outline, in their order. */
export const GM_OUTLINE_SETS = ['platform_left_pop', 'platform_pop_right', 'platform_right_left'] as const;

/** As in the landmark exports (`setId`: the curve or grid it belongs to). */
export type GmRow = LandmarkRow;

export interface GmResult {
  /** How the surface semilandmarks were made (`template`: rows may be missing, and the rows say more). Absent in results from before there was a choice: the grid. */
  method?: 'grid' | 'template';
  complete: boolean;
  missing: GmMissing[];
  /** What lacks, by name, for the codes that go with a thing of the specimen's. */
  details?: Array<{ code: GmMissing; name: string }>;
  rows: GmRow[];
  /** One row per sliding curve semilandmark, by point number: before, slide, after. */
  curves: Array<[number, number, number]>;
  /** The surface semilandmarks, by point number. */
  surfaces: number[];
  /** Surface semilandmarks the check put on the list, by point number. */
  flagged?: number[];
  /** What it was made from (`gmCacheKey`): while that is the same, what is stored can stand for it. */
  key?: string;
}

/** Where the points by a template go on a specimen: the one region of a type. */
export interface GmRegionSource {
  find(type: string): { reason: 'region_missing' | 'region_ambiguous' } | { faces: ArrayLike<number>; area: number; bvh: () => Steps<TriangleBvh> };
}

/** The points each item of a configuration asks for. A curve's count holds both its ends. */
export function gmCounts(c: GmConfig): { fixed: number; edge: number; platformOutline: number; ventral: number; dorsal: number; platform: number } {
  return {
    fixed: GM_ANCHORS.filter((a) => c.fixed[a]).length,
    edge: c.edge.on ? c.edge.points : 0,
    platformOutline: c.platformOutline.on ? 3 * c.platformOutline.points : 0,
    ventral: c.ventral.on ? c.ventral.rows * c.ventral.cols : 0,
    dorsal: c.dorsal.on ? c.dorsal.rows * c.dorsal.cols : 0,
    platform: c.platform.on ? c.platform.rows * c.platform.cols : 0,
  };
}

/**
 * How many points a specimen has by a configuration. A curve's ends are single points, which the fixed landmarks and
 * the other curves share: written once. `pointPlatform`: without platform ends, the edge begins and ends at the point of percussion.
 */
export function gmTotal(c: GmConfig, pointPlatform = false, own = 0): number {
  const n = gmCounts(c);
  const ends = new Set<GmAnchor>(GM_ANCHORS.filter((a) => c.fixed[a]));
  if (c.edge.on) for (const a of pointPlatform ? (['pop'] as const) : (['platform_left', 'platform_right'] as const)) ends.add(a);
  if (c.platformOutline.on) for (const a of GM_ANCHORS) ends.add(a);
  const between = (c.edge.on ? c.edge.points - 2 : 0) + (c.platformOutline.on ? 3 * (c.platformOutline.points - 2) : 0);
  const surfaces = c.surfaceMethod === 'template' ? patchPoints(c) : n.ventral + n.dorsal + n.platform;
  return ends.size + between + surfaces + own;
}

const patchPoints = (c: GmConfig): number => c.patches.reduce((s, p) => s + p.count, 0);

/** How many points a core or a generic specimen has by the lists. A curve's ends are single points, shared as above; a loop's two ends are one. */
export function gmListTotal(c: GmConfig): number {
  const ends = new Set(c.landmarks.map((l) => l.name));
  let between = 0;
  for (const q of c.curves) {
    ends.add(q.start);
    if (!q.closed) ends.add(q.end);
    between += q.count - 2;
  }
  return ends.size + between + patchPoints(c);
}

/** The triangles a line may cross (the app's come from the BVH); all of them when there is none. */
export type RayCandidates = (origin: Vec3, direction: Vec3, visit: (triangle: number) => void) => void;

export interface GmMesh {
  /** Positions relative to `offset`; the annotations are in original coordinates. */
  positions: ArrayLike<number>;
  index: ArrayLike<number>;
  offset?: Vec3;
  /** The platform region's triangles (null: none). */
  platformFaces: ArrayLike<number> | null;
  candidates?: RayCandidates | null;
  /** The middle of the flake, relative to `offset` (the vertices' mean when not given). */
  centroid?: Vec3;
  /** Where the points by a template go (none: no region can be found). */
  regions?: GmRegionSource | null;
  /** The template's model is in the folder (false: nothing is passed on from it). */
  templateAvailable?: boolean;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const along = (o: Vec3, d: Vec3, t: number): Vec3 => [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
/** Where a point stands that is not there. */
const NOWHERE = (): Vec3 => [NaN, NaN, NaN];

/** The stretch of a polyline from arc length `from` to `to`, going forward; on a closed one it may go past the start. */
function arcSlice(points: readonly Vec3[], closed: boolean, cum: readonly number[], from: number, to: number): Vec3[] {
  const L = cum[cum.length - 1];
  const end = closed && to <= from ? to + L : to;
  const out: Vec3[] = [pointAtArc(points, closed, cum, from)];
  for (let lap = 0; lap < (closed ? 2 : 1); lap++) {
    for (let i = 0; i < points.length; i++) {
      const s = cum[i] + lap * L;
      if (s > from && s < end) out.push(points[i]);
    }
  }
  out.push(pointAtArc(points, closed, cum, end));
  return out;
}

const techX = (f: FrameAxes, p: Vec3): number => dot(sub(p, f.origin), f.x);
const techY = (f: FrameAxes, p: Vec3): number => dot(sub(p, f.origin), f.y);

/** Twice the signed area in the frame's XY plane: negative is clockwise, seen with the dorsal face toward the viewer. */
function signedArea(line: readonly Vec3[], f: FrameAxes): number {
  let s = 0;
  for (let i = 0; i < line.length; i++) {
    const a = line[i], b = line[(i + 1) % line.length];
    s += techX(f, a) * techY(f, b) - techX(f, b) * techY(f, a);
  }
  return s;
}

/**
 * The edge from the platform's left end, by the distal end, to its right end; without ends, from the point of percussion round to it,
 * clockwise. A closed curve is cut at the points nearest the ends: of the two parts, the one away from the platform (reaching further distally).
 */
function edgeLine(edge: Pick<Curve, 'points' | 'closed'>, f: FrameAxes, pop: Vec3, left: Vec3 | null, right: Vec3 | null): Vec3[] {
  const pts = edge.points;
  const cum = arcLengths(pts, edge.closed);
  if (left && right) {
    const a = nearestArc(pts, edge.closed, cum, left), b = nearestArc(pts, edge.closed, cum, right);
    let middle: Vec3[];
    if (edge.closed) {
      const one = arcSlice(pts, true, cum, a, b), other = arcSlice(pts, true, cum, b, a).reverse();
      const reach = (l: Vec3[]) => Math.max(...l.map((p) => techY(f, p)));
      middle = reach(one) >= reach(other) ? one : other;
    } else middle = a <= b ? arcSlice(pts, false, cum, a, b) : arcSlice(pts, false, cum, b, a).reverse();
    return [left, ...middle, right];
  }
  const loop = edge.closed ? arcSlice(pts, true, cum, nearestArc(pts, true, cum, pop), nearestArc(pts, true, cum, pop)) : [...pts];
  const line = [pop, ...loop, pop];
  return signedArea(line, f) > 0 ? line.reverse() : line;
}

/** The platform outline as left end → point of percussion → right end (its inner rim) → left end (its outer rim); each stretch ends on its landmark. A landmark off the outline goes by the point of it nearest the landmark. */
function outlineStretches(outline: Pick<Curve, 'points'>, left: Vec3, pop: Vec3, right: Vec3): [Vec3[], Vec3[], Vec3[]] {
  let pts = [...outline.points];
  let cum = arcLengths(pts, true);
  const L = cum[cum.length - 1];
  const place = () => [left, pop, right].map((p) => nearestArc(pts, true, cum, p));
  let [a, b, c] = place();
  // going forward from the left end, the point of percussion must come before the right end
  if ((b - a + L) % L > (c - a + L) % L) {
    pts = pts.reverse();
    cum = arcLengths(pts, true);
    [a, b, c] = place();
  }
  return [[left, ...arcSlice(pts, true, cum, a, b), pop], [pop, ...arcSlice(pts, true, cum, b, c), right], [right, ...arcSlice(pts, true, cum, c, a), left]];
}

/** Where a line (`origin` + t `direction`) crosses a triangle: its t, or null. */
function crossing(pos: ArrayLike<number>, idx: ArrayLike<number>, t: number, o: Vec3, d: Vec3): number | null {
  const a = 3 * idx[3 * t], b = 3 * idx[3 * t + 1], c = 3 * idx[3 * t + 2];
  const e1: Vec3 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
  const e2: Vec3 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
  const p = cross(d, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-14) return null;
  const s: Vec3 = [o[0] - pos[a], o[1] - pos[a + 1], o[2] - pos[a + 2]];
  const u = dot(s, p) / det;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const q = cross(s, e1);
  const v = dot(d, q) / det;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  return dot(e2, q) / det;
}

/** The first and last places a line crosses the mesh, by t along it. */
function lineExtent(mesh: GmMesh, o: Vec3, d: Vec3): { min: number; max: number } | null {
  let min = Infinity, max = -Infinity;
  const visit = (t: number) => {
    const at = crossing(mesh.positions, mesh.index, t, o, d);
    if (at === null) return;
    if (at < min) min = at;
    if (at > max) max = at;
  };
  if (mesh.candidates) mesh.candidates(o, d, visit);
  else for (let t = 0; 3 * t < mesh.index.length; t++) visit(t);
  return min <= max ? { min, max } : null;
}

/** Where a polygon's or polyline's sides cross a line of constant `coord`: the other coordinate at each crossing. */
function crossings(line: ReadonlyArray<[number, number]>, closed: boolean, at: number): number[] {
  const out: number[] = [];
  const n = line.length - (closed ? 0 : 1);
  for (let i = 0; i < n; i++) {
    const [a0, a1] = line[i], [b0, b1] = line[(i + 1) % line.length];
    if (a1 === b1 ? a1 !== at : (a1 - at) * (b1 - at) > 0) continue;
    if (a1 === b1) out.push(a0, b0);
    else out.push(a0 + ((b0 - a0) * (at - a1)) / (b1 - a1));
  }
  return out;
}

type GmState = Pick<ProjectState, 'gm' | 'landmarks' | 'semilandmarks' | 'curves' | 'flake' | 'specimen'> & Partial<Pick<ProjectState, 'mesh'>>;

/** What of a specimen's annotations a configuration needs and it has not; the rest can only be told on the mesh. A core or a generic specimen: of the lists. */
export function gmMissingInputs(state: Pick<GmState, 'gm' | 'landmarks' | 'curves' | 'flake'> & Partial<Pick<GmState, 'specimen'>>): GmMissing[] {
  const c = state.gm;
  const out = new Set<GmMissing>();
  if (state.specimen && state.specimen.type !== 'flake') {
    const own = state.landmarks.filter((l) => !l.code);
    const count = (name: string) => own.filter((l) => l.name === name).length;
    for (const l of c.landmarks) if (count(l.name) !== 1) out.add(count(l.name) ? 'landmark_ambiguous' : 'landmark_missing');
    for (const q of c.curves) {
      const n = state.curves.filter((x) => x.attributes.type === q.curveType && (!q.closed || x.closed)).length;
      if (n !== 1) out.add(n ? 'curve_ambiguous' : 'curve_missing');
      for (const name of q.closed ? [q.start, q.via] : [q.start, q.end]) if (count(name) !== 1) out.add(name ? (count(name) ? 'landmark_ambiguous' : 'landmark_missing') : 'curve_ends');
    }
    return GM_MISSING.filter((m) => out.has(m));
  }
  const byTemplate = c.surfaceMethod === 'template';
  const wants = GM_ANCHORS.some((a) => c.fixed[a]) || c.edge.on || c.platformOutline.on || (!byTemplate && (c.ventral.on || c.dorsal.on || c.platform.on));
  if (wants && !state.flake.axis?.matrix) out.add('technical_axis');
  const ends = state.landmarks.filter((l) => l.code === 'platform_end').length;
  const grid = !byTemplate && (c.ventral.on || c.dorsal.on);
  const platform = !byTemplate && c.platform.on;
  const needEnds = c.fixed.platform_left || c.fixed.platform_right || c.platformOutline.on || platform;
  if ((needEnds && ends !== 2) || ((c.edge.on || grid) && ends === 1)) out.add('platform_ends');
  if ((c.edge.on || grid) && !state.curves.some((x) => x.attributes.type === 'edge')) out.add('edge');
  const outlined = state.curves.some((x) => x.attributes.type === PLATFORM_OUTLINE && x.closed);
  if ((c.platformOutline.on || platform || (grid && ends > 0)) && !outlined) out.add('platform_outline');
  return GM_MISSING.filter((m) => out.has(m));
}

/** What the rows being made need to go on with the points of the template. */
interface RowSink {
  rows: GmRow[];
  surfaces: number[];
  missing: Set<GmMissing>;
  details: Array<{ code: GmMissing; name: string }>;
}

/**
 * The points of the patches, by the template: on the template its points as laid, on another specimen carried by the anchors (the rows already written) and brought onto
 * the region of the patch's type. What cannot be had stays in the rows as missing, so every specimen has the same rows. A point is flagged that moved far onto the surface or came too near another.
 */
function* templatePointsSteps(state: GmState, mesh: GmMesh, sink: RowSink): Steps<number[]> {
  const c = state.gm;
  const t = c.template;
  const { rows, surfaces, missing, details } = sink;
  const flagged: number[] = [];
  const add = (name: string, k: number, p: Vec3 | null, flag = false) => {
    rows.push({ index: rows.length + 1, name, kind: 'surface', setId: name, point: p ? [p[0], p[1], p[2]] : NOWHERE(), ...(p ? {} : { missing: true }), setIndex: k + 1, ...(flag ? { flagged: true } : {}) });
    surfaces.push(rows.length);
    if (flag) flagged.push(rows.length);
  };
  const blank = (name: string, count: number) => {
    for (let k = 0; k < count; k++) add(name, k, null);
  };
  if (!c.patches.length) return flagged;
  const fails = (code: GmMissing) => {
    missing.add(code);
    for (const p of c.patches) blank(p.regionType, p.count);
    return flagged;
  };
  if (!t) return fails('no_template');
  const isTemplate = state.mesh?.sha256 === t.sha256;
  if (!isTemplate && mesh.templateAvailable === false) return fails('template_missing');
  const stale = c.patches.length !== t.patches.length || c.patches.some((p, i) => p.regionType !== t.patches[i].regionType || p.count !== t.patches[i].points.length);
  if (stale) return fails('template_stale');
  if (isTemplate) {
    c.patches.forEach((p, i) => t.patches[i].points.forEach((q, k) => add(p.regionType, k, q.point)));
    return flagged;
  }
  const own = rows.filter((r) => r.kind !== 'surface');
  if (own.length !== t.anchors.length) return fails('template_stale');
  const pairs = own.flatMap((r, i) => (r.missing ? [] : [i]));
  if (pairs.length < GM_TEMPLATE_PARAMETERS.MIN_ANCHORS) return fails('too_few_anchors');
  const warp = yield* anchorWarpSteps(pairs.map((i) => t.anchors[i]), pairs.map((i) => own[i].point));
  if (!warp) return fails('no_fit');
  const o: Vec3 = mesh.offset ?? [0, 0, 0];
  for (const [i, p] of c.patches.entries()) {
    const found = mesh.regions ? mesh.regions.find(p.regionType) : ({ reason: 'region_missing' } as const);
    if ('reason' in found) {
      missing.add(found.reason);
      details.push({ code: found.reason, name: p.regionType });
      blank(p.regionType, p.count);
      continue;
    }
    const bvh = yield* found.bvh();
    const spacing = Math.sqrt(found.area / p.count);
    const moves = new Float64Array(p.count);
    const placed: Vec3[] = [];
    for (let k = 0; k < p.count; k++) {
      if (k % 64 === 0) yield;
      const q = warp(t.patches[i].points[k].point);
      const hit = bvh.closest([q[0] - o[0], q[1] - o[1], q[2] - o[2]]);
      if (!hit) {
        placed.push(NOWHERE());
        moves[k] = Infinity;
        continue;
      }
      moves[k] = hit.distance;
      placed.push([hit.point[0] + o[0], hit.point[1] + o[1], hit.point[2] + o[2]]);
    }
    const near = (GM_TEMPLATE_PARAMETERS.CROWD_SHARE * spacing) ** 2;
    for (let k = 0; k < p.count; k++) {
      if (k % 64 === 0) yield;
      let crowded = false;
      const a = placed[k];
      for (let j = 0; j < p.count && !crowded; j++) {
        if (j === k) continue;
        const b = placed[j];
        crowded = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 < near;
      }
      add(p.regionType, k, Number.isNaN(a[0]) ? null : a, crowded || moves[k] > GM_TEMPLATE_PARAMETERS.MOVE_LIMIT_SHARE * spacing);
    }
  }
  return flagged;
}

/** The numbers within each curve; what a template's rows say of them. */
function numberWithinSets(rows: GmRow[]): void {
  const seen = new Map<string, number>();
  for (const r of rows) {
    if (r.kind !== 'curve') continue;
    const set = r.setId || r.name;
    const n = (seen.get(set) ?? 0) + 1;
    seen.set(set, n);
    r.name = set;
    r.setIndex = n;
  }
}

/** The points of a core or a generic specimen: the lists of the configuration, in their order, and the template's. */
function* gmOfListsSteps(state: GmState, mesh: GmMesh): Steps<GmResult> {
  const c = state.gm;
  const rows: GmRow[] = [];
  const curves: GmResult['curves'] = [];
  const surfaces: number[] = [];
  const missing = new Set<GmMissing>();
  const details: Array<{ code: GmMissing; name: string }> = [];
  const note = (code: GmMissing, name: string) => {
    missing.add(code);
    if (!details.some((d) => d.code === code && d.name === name)) details.push({ code, name });
  };
  const add = (name: string, kind: GmRow['kind'], setId: string, point: Vec3 | null): number => {
    rows.push({ index: rows.length + 1, name, kind, setId, point: point ?? NOWHERE(), ...(point ? {} : { missing: true }) });
    return rows.length;
  };
  const own = state.landmarks.filter((l) => !l.code);
  /** A landmark by its name: the one of that name, or nothing, and why. */
  const landmark = (name: string): Vec3 | null => {
    const found = own.filter((l) => l.name === name);
    if (found.length === 1) return found[0].point;
    note(found.length ? 'landmark_ambiguous' : 'landmark_missing', name);
    return null;
  };
  // a landmark is a single point, whatever is ending on it
  const numbered = new Map<string, number>();
  for (const l of c.landmarks) if (!numbered.has(l.name)) numbered.set(l.name, add(l.name, 'fixed', '', landmark(l.name)));
  const endAt = (name: string, set: string, p: Vec3 | null): number => {
    let i = numbered.get(name);
    if (i === undefined) {
      i = add(set, 'curve', set, p);
      numbered.set(name, i);
    }
    return i;
  };
  for (const q of c.curves) {
    yield;
    const found = state.curves.filter((x) => x.attributes.type === q.curveType && (!q.closed || x.closed) && x.points.length > 1);
    if (found.length !== 1) note(found.length ? 'curve_ambiguous' : 'curve_missing', q.curveType);
    if (!q.start || !(q.closed ? q.via : q.end)) note('curve_ends', q.curveType);
    const start = q.start ? landmark(q.start) : null;
    const other = q.closed ? (q.via ? landmark(q.via) : null) : q.end ? landmark(q.end) : null;
    const curve = found.length === 1 ? found[0] : null;
    const pts = curve && start && other ? resampleEven(curveStretch(curve, start, other, !!q.closed), q.count) : null;
    const first = endAt(q.start, q.curveType, start);
    const between = Array.from({ length: q.count - 2 }, (_, k) => add(q.curveType, 'curve', q.curveType, pts ? pts[k + 1] : null));
    const last = q.closed ? first : endAt(q.end, q.curveType, other);
    const chain = [first, ...between, last];
    for (let k = 1; k + 1 < chain.length; k++) curves.push([chain[k - 1], chain[k], chain[k + 1]]);
  }
  numberWithinSets(rows);
  const flagged = yield* templatePointsSteps(state, mesh, { rows, surfaces, missing, details });
  const list = GM_MISSING.filter((m) => missing.has(m));
  return { method: 'template', complete: list.length === 0, missing: list, details, rows, curves, surfaces, flagged };
}

/** The stretch of a curve between two landmarks, ending on them. A loop (`round`): from the first, the way that reaches the second sooner, back to the first. On a closed curve taken as an open one: the shorter way. */
function curveStretch(curve: Pick<Curve, 'points' | 'closed'>, a: Vec3, b: Vec3, round: boolean): Vec3[] {
  const pts = curve.points;
  const cum = arcLengths(pts, curve.closed);
  const L = cum[cum.length - 1];
  const s = nearestArc(pts, curve.closed, cum, a), e = nearestArc(pts, curve.closed, cum, b);
  if (round) {
    const loop = arcSlice(pts, true, cum, s, s);
    return [a, ...(((e - s + L) % L) <= ((s - e + L) % L) ? loop : loop.reverse()), a];
  }
  if (!curve.closed) return [a, ...(s <= e ? arcSlice(pts, false, cum, s, e) : arcSlice(pts, false, cum, e, s).reverse()), b];
  return [a, ...(((e - s + L) % L) <= ((s - e + L) % L) ? arcSlice(pts, true, cum, s, e) : arcSlice(pts, true, cum, e, s).reverse()), b];
}

/** The points of a flake (in slices). */
export function* gmSteps(state: GmState, mesh: GmMesh): Steps<GmResult> {
  if (state.specimen.type !== 'flake') return yield* gmOfListsSteps(state, mesh);
  const c = state.gm;
  const byTemplate = c.surfaceMethod === 'template';
  const o: Vec3 = mesh.offset ?? [0, 0, 0];
  const missing = new Set<GmMissing>(gmMissingInputs(state));
  const rows: GmRow[] = [];
  const curves: GmResult['curves'] = [];
  const surfaces: number[] = [];
  const add = (name: string, kind: GmRow['kind'], setId: string, point: Vec3): number => {
    rows.push({ index: rows.length + 1, name, kind, setId, point: [point[0], point[1], point[2]] });
    return rows.length;
  };

  const axis = state.flake.axis;
  const f = axis?.matrix ? frameAxes(axis.matrix) : null;
  const sides = platformSides(axis?.matrix, state.landmarks);
  const pointOf = (id: string | null) => state.landmarks.find((l) => l.id === id)?.point ?? null;
  const anchors: Record<GmAnchor, Vec3 | null> = { pop: axis?.matrix ? axis.start : null, platform_left: pointOf(sides.left), platform_right: pointOf(sides.right) };
  const numbered = new Map<GmAnchor, number>();
  // a curve's end is a single point: the fixed landmark, or else written where it is first needed
  const anchorAt = (a: GmAnchor, setId: string): number => {
    let i = numbered.get(a);
    if (i === undefined) {
      i = add(a, 'curve', setId, anchors[a] ?? NOWHERE());
      if (!anchors[a]) rows[i - 1].missing = true;
      numbered.set(a, i);
    }
    return i;
  };

  // fixed landmarks: the flake's own, then the user's
  for (const a of GM_ANCHORS) {
    if (c.fixed[a] && anchors[a]) numbered.set(a, add(a, 'fixed', '', anchors[a]!));
    // (by a template every specimen has the same rows, and what is not there says so)
    else if (c.fixed[a] && byTemplate) {
      numbered.set(a, add(a, 'fixed', '', NOWHERE()));
      rows[rows.length - 1].missing = true;
    }
  }
  const table = landmarkTable(state);
  const listed = shownLandmarks(state);
  const newIndex = new Map<number, number>();
  listed.forEach((l, i) => {
    if (!l.code) newIndex.set(i + 1, add(table.rows[i].name, 'fixed', '', l.point));
  });

  // curve semilandmarks
  const writeCurve = (line: readonly Vec3[], count: number, setId: string, start: GmAnchor, end: GmAnchor) => {
    const pts = resampleEven(line, count);
    const first = anchorAt(start, setId);
    const between = pts.slice(1, -1).map((p, k) => add(`${setId}_${k + 2}`, 'curve', setId, p));
    const last = anchorAt(end, setId);
    const chain = [first, ...between, last];
    for (let k = 1; k + 1 < chain.length; k++) curves.push([chain[k - 1], chain[k], chain[k + 1]]);
  };
  const left = anchors.platform_left, right = anchors.platform_right, pop = anchors.pop;
  const ends = state.landmarks.filter((l) => l.code === 'platform_end').length;
  const edge = state.curves.find((x) => x.attributes.type === 'edge');
  const outline = state.curves.find((x) => x.attributes.type === PLATFORM_OUTLINE && x.closed);
  const hasEnds = !!left && !!right;
  const line = f && pop && edge && edge.points.length > 1 && (hasEnds || ends === 0) ? edgeLine(edge, f, pop, left, right) : null;
  const stretches = pop && hasEnds && outline && outline.points.length > 2 ? outlineStretches(outline, left!, pop, right!) : null;
  /** By a template a curve that is not there still has its rows. */
  const blankCurve = (count: number, setId: string, start: GmAnchor, end: GmAnchor) => {
    const first = anchorAt(start, setId);
    const between = Array.from({ length: count - 2 }, (_, k) => {
      const i = add(`${setId}_${k + 2}`, 'curve', setId, NOWHERE());
      rows[i - 1].missing = true;
      return i;
    });
    const last = anchorAt(end, setId);
    const chain = [first, ...between, last];
    for (let k = 1; k + 1 < chain.length; k++) curves.push([chain[k - 1], chain[k], chain[k + 1]]);
  };
  if (c.edge.on && line) writeCurve(line, c.edge.points, 'edge', hasEnds ? 'platform_left' : 'pop', hasEnds ? 'platform_right' : 'pop');
  else if (c.edge.on && byTemplate) blankCurve(c.edge.points, 'edge', 'platform_left', 'platform_right');
  if (c.platformOutline.on && stretches) {
    writeCurve(stretches[0], c.platformOutline.points, GM_OUTLINE_SETS[0], 'platform_left', 'pop');
    writeCurve(stretches[1], c.platformOutline.points, GM_OUTLINE_SETS[1], 'pop', 'platform_right');
    writeCurve(stretches[2], c.platformOutline.points, GM_OUTLINE_SETS[2], 'platform_right', 'platform_left');
  } else if (c.platformOutline.on && byTemplate) {
    blankCurve(c.platformOutline.points, GM_OUTLINE_SETS[0], 'platform_left', 'pop');
    blankCurve(c.platformOutline.points, GM_OUTLINE_SETS[1], 'pop', 'platform_right');
    blankCurve(c.platformOutline.points, GM_OUTLINE_SETS[2], 'platform_right', 'platform_left');
  }
  // the user's own sets; their ends may be landmarks of the flake's own
  table.rows.forEach((r, i) => {
    if (r.kind === 'curve') newIndex.set(i + 1, add(r.name, 'curve', r.setId, r.point));
  });
  const renumber = (old: number): number => {
    const known = newIndex.get(old);
    if (known !== undefined) return known;
    const l = listed[old - 1];
    const name: GmAnchor = l.code === 'pop' ? 'pop' : l.id === sides.left ? 'platform_left' : 'platform_right';
    return anchorAt(name, '');
  };
  for (const [a, b, d] of table.sliders) curves.push([renumber(a), renumber(b), renumber(d)]);

  if (byTemplate) {
    numberWithinSets(rows);
    const details: NonNullable<GmResult['details']> = [];
    const flagged = yield* templatePointsSteps(state, mesh, { rows, surfaces, missing, details });
    const list = GM_MISSING.filter((m) => missing.has(m));
    return { method: 'template', complete: list.length === 0, missing: list, details, rows, curves, surfaces, flagged };
  }

  // surface semilandmarks: the faces, by lines along the frame's Z over the outline in its XY plane
  const grid = c.ventral.on || c.dorsal.on;
  if (f && line && grid && (ends === 0 || stretches)) {
    const ring = hasEnds ? [...line, ...[...stretches![1]].reverse(), ...[...stretches![0]].reverse()] : line;
    const flat = ring.map((p): [number, number] => [techX(f, p), techY(f, p)]);
    const ys = flat.map((p) => p[1]);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const origin = sub(f.origin, o);
    for (const face of ['ventral', 'dorsal'] as const) {
      const g = c[face];
      if (!g.on) continue;
      for (let i = 1; i <= g.rows; i++) {
        const y = yMin + (i / (g.rows + 1)) * (yMax - yMin);
        const xs = crossings(flat, true, y);
        const xl = Math.min(...xs), xr = Math.max(...xs);
        for (let j = 1; j <= g.cols; j++) {
          yield;
          const x = xl + (j / (g.cols + 1)) * (xr - xl);
          const from = along(along(origin, f.x, x), f.y, y);
          const hit = xs.length ? lineExtent(mesh, from, f.z) : null;
          if (!hit) {
            missing.add(`${face}_miss`);
            continue;
          }
          const at = along(from, f.z, face === 'ventral' ? hit.min : hit.max);
          surfaces.push(add(`${face}_${i}_${j}`, 'surface', face, [at[0] + o[0], at[1] + o[1], at[2] + o[2]]));
        }
      }
    }
  }

  // the platform: a grid in the plane fitted to its region, across from the inner rim to the outer
  if (c.platform.on && stretches) {
    const faces = mesh.platformFaces;
    const fit = faces && faces.length ? yield* regionPlaneSteps(mesh.positions, mesh.index, faces, [0, 0, 0]) : null;
    if (!faces || !fit) missing.add('platform_region');
    else {
      const centroid = mesh.centroid ?? meanVertex(mesh.positions);
      let n = fit.normal;
      // outward: away from the middle of the flake
      if (dot(sub(fit.centroid, centroid), n) < 0) n = [-n[0], -n[1], -n[2]];
      const local = (p: Vec3) => sub(p, o);
      const across = sub(local(right!), local(left!));
      const inPlane = sub(across, along([0, 0, 0], n, dot(across, n)));
      const len = Math.hypot(...inPlane);
      if (!(len > 0)) missing.add('platform_miss');
      else {
        const u: Vec3 = [inPlane[0] / len, inPlane[1] / len, inPlane[2] / len];
        let v = cross(n, u);
        const coords = (p: Vec3): [number, number] => {
          const d = sub(local(p), fit.centroid);
          return [dot(d, u), dot(d, v)];
        };
        const inner = [...stretches[0], ...stretches[1]];
        const outer = stretches[2];
        const mean = (l: readonly Vec3[]) => l.reduce((s, p) => s + coords(p)[1], 0) / l.length;
        // from the inner rim to the outer
        if (mean(outer) < mean(inner)) v = [-v[0], -v[1], -v[2]];
        const flatInner = inner.map((p): [number, number] => { const q = coords(p); return [q[1], q[0]]; });
        const flatOuter = outer.map((p): [number, number] => { const q = coords(p); return [q[1], q[0]]; });
        const uL = coords(left!)[0], uR = coords(right!)[0];
        const g = c.platform;
        const columns = Array.from({ length: g.cols }, (_, k) => {
          const at = uL + ((k + 1) / (g.cols + 1)) * (uR - uL);
          const a = crossings(flatInner, false, at), b = crossings(flatOuter, false, at);
          return a.length && b.length ? { at, from: Math.min(...a), to: Math.max(...b) } : null;
        });
        const height = Math.hypot(...sub(fit.centroid, centroid)) + 2 * Math.max(len, 1);
        for (let i = 1; i <= g.rows; i++) {
          for (const [j, col] of columns.entries()) {
            yield;
            if (!col) {
              missing.add('platform_miss');
              continue;
            }
            const w = col.from + (i / (g.rows + 1)) * (col.to - col.from);
            const q = along(along(fit.centroid, u, col.at), v, w);
            const start = along(q, n, height);
            const down: Vec3 = [-n[0], -n[1], -n[2]];
            let first = Infinity;
            for (let k = 0; k < faces.length; k++) {
              const t = crossing(mesh.positions, mesh.index, faces[k], start, down);
              if (t !== null && t < first) first = t;
            }
            if (first === Infinity) {
              missing.add('platform_miss');
              continue;
            }
            const at = along(start, down, first);
            surfaces.push(add(`platform_${i}_${j + 1}`, 'surface', 'platform', [at[0] + o[0], at[1] + o[1], at[2] + o[2]]));
          }
        }
      }
    }
  }
  const list = GM_MISSING.filter((m) => missing.has(m));
  return { method: 'grid', complete: list.length === 0, missing: list, rows, curves, surfaces };
}

function meanVertex(p: ArrayLike<number>): Vec3 {
  const m: Vec3 = [0, 0, 0];
  const n = Math.floor(p.length / 3);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) m[k] += p[3 * i + k];
  return [m[0] / n, m[1] / n, m[2] / n];
}

export const gmPoints = (state: GmState, mesh: GmMesh): GmResult => runSync(gmSteps(state, mesh));

/** The rows that are not on a surface, and what lacks of them: the anchors of the points by a template. They need no mesh, only the annotations. */
export const gmAnchorRows = (state: GmState): GmResult => gmPoints({ ...state, gm: { ...state.gm, surfaceMethod: 'template', patches: [] } }, { positions: [], index: [], platformFaces: null });

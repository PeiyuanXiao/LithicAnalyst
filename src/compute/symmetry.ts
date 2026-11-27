import { frameAxes } from '../core/frame';
import type { ProjectState, SymmetryRef, Vec3 } from '../core/types';
import { dot, normalize, scale } from '../core/vec';
import { buildEdgesSteps, fitPlane, type EdgeTable } from './meshGeometry';
import type { PlaneResult } from './planes';
import { weightedQuantile } from './robust';
import { splitByLoopSteps, splitByPlaneSteps, type SplitParts, type SplitResult } from './split';
import { YIELD_EVERY, type Steps } from './steps';
import { triangleBvhSteps, type TriangleBvh } from './triangleBvh';

/**
 * Symmetry about a plane the user chooses (a fitted plane, a closed curve, a frame's mid-plane): how alike the two sides are in
 * volume and in area, and how much of the specimen its mirror image covers (shape); and, as a supplement, how far the mirror
 * image of the surface lies from it.
 */

/** The parameters, stored with the results (project file, manifest). */
export const SYMMETRY_PARAMETERS = {
  /** Shape symmetry: about this many points inside the specimen, on a regular grid (once a model). */
  SYM_OVERLAP_SAMPLES: 50000,
  /** Mirror deviation: points on the surface, by area (once a model). */
  SYM_DEVIATION_SAMPLES: 50000,
  /** The quantile of the mirror deviation reported. */
  DEVIATION_QUANTILE: 0.95,
  /** A side with less than this share of the surface is empty: the plane does not cut the mesh. */
  EMPTY_SIDE_SHARE: 1e-9,
  /** Inside or not: the crossings of a ray along each (none along an axis), odd = inside, the majority of the three. Unit vectors. */
  SYM_RAY_DIRECTIONS: [
    [0.826439, 0.441721, 0.349116],
    [-0.312706, 0.855117, -0.413508],
    [0.227312, -0.384621, 0.894648],
  ],
} as const;

/** Why a value is empty: no plane from the source; the mesh is open (volume and shape); the plane leaves one side empty. */
export type SymmetryReason = 'no_source' | 'not_closed' | 'no_cut';

export interface SymmetryPlane {
  point: Vec3;
  /** Unit; points to side A. */
  normal: Vec3;
}

/** One reference's results (derived.symmetry; original coordinates). Side A is the side the plane's normal points to. */
export interface SymmetryValues {
  id: string;
  plane: SymmetryPlane | null;
  /** min / max of the sides' volumes, of their areas; the share of the specimen its mirror image covers. 0–1, 1 = symmetric. */
  volumeSymmetry: number | null;
  areaSymmetry: number | null;
  shapeSymmetry: number | null;
  volumeA: number | null;
  volumeB: number | null;
  areaA: number | null;
  areaB: number | null;
  /** How far the mirror image of the surface lies from it: mean, root mean square and DEVIATION_QUANTILE over the surface samples. */
  deviationMean: number | null;
  deviationRms: number | null;
  deviationP95: number | null;
  reasons: { volume: SymmetryReason | null; area: SymmetryReason | null; shape: SymmetryReason | null; deviation: SymmetryReason | null };
}

export interface SymmetryDerived {
  parameters: typeof SYMMETRY_PARAMETERS;
  refs: SymmetryValues[];
}

/** Told now and then while a computation runs: how much of it is done (0–1). */
export type Progress = (share: number) => void;

/** The surface's area, centroid (by area) and box, and the volume within it (closed or not: by the divergence theorem). */
export interface MeshMoments {
  area: number;
  volume: number;
  centroid: Vec3;
  min: Vec3;
  max: Vec3;
}

/** What every reference of a mesh needs, made once a model (positions' own coordinates). */
export interface SymmetryMesh extends MeshMoments {
  positions: ArrayLike<number>;
  index: ArrayLike<number>;
  closed: boolean;
  edges: EdgeTable;
  /** The whole surface: the nearest points, and the rays of the inside test. */
  bvh: TriangleBvh;
  /** Points on the surface by area, xyz (the mirror deviation). */
  surfaceSamples: Float64Array;
  /** The grid points inside the specimen, xyz (shape symmetry); none when the mesh is open. */
  interiorSamples: Float64Array;
  /** The grid's step (null: no grid). */
  gridStep: number | null;
}

const P = (pos: ArrayLike<number>, v: number): Vec3 => [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]];

/** Items between yields in the loops of queries (each a walk down the tree). */
const QUERIES = 1 << 9;

/** The area, centroid, box and volume, in slices. */
export function* meshMomentsSteps(positions: ArrayLike<number>, index: ArrayLike<number>): Steps<MeshMoments> {
  const nv = Math.floor(positions.length / 3);
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < nv; v++) {
    if (v % YIELD_EVERY === 0) yield;
    for (let k = 0; k < 3; k++) {
      const x = positions[3 * v + k];
      if (x < min[k]) min[k] = x;
      if (x > max[k]) max[k] = x;
    }
  }
  let area = 0, volume = 0;
  const c: Vec3 = [0, 0, 0];
  for (let t = 0; 3 * t + 2 < index.length; t++) {
    if (t % YIELD_EVERY === 0) yield;
    const a = 3 * index[3 * t], b = 3 * index[3 * t + 1], d = 3 * index[3 * t + 2];
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[d], cy = positions[d + 1], cz = positions[d + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az;
    const s = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
    area += s;
    c[0] += (s * (ax + bx + cx)) / 3;
    c[1] += (s * (ay + by + cy)) / 3;
    c[2] += (s * (az + bz + cz)) / 3;
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  const centroid: Vec3 = area > 0 ? [c[0] / area, c[1] / area, c[2] / area] : [0, 0, 0];
  return { area, volume: Math.abs(volume), centroid, min, max };
}

/** The low-discrepancy sequence (R2, after the plastic number) the samples' places within their triangles are taken from. */
const R2 = [0.7548776662466927, 0.5698402909980532];

/**
 * SYM_DEVIATION_SAMPLES points on the surface: systematic sampling along the running sum of the triangles' areas, each point's
 * place within its triangle from R2 (the same every time).
 */
function* surfaceSamplesSteps(positions: ArrayLike<number>, index: ArrayLike<number>, total: number, count: number, progress?: Progress): Steps<Float64Array> {
  const nt = Math.floor(index.length / 3);
  const out = new Float64Array(total > 0 && nt ? 3 * count : 0);
  const n = out.length / 3;
  let run = 0, t = 0;
  const areaOf = (t: number) => {
    const a = 3 * index[3 * t], b = 3 * index[3 * t + 1], d = 3 * index[3 * t + 2];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const wx = positions[d] - positions[a], wy = positions[d + 1] - positions[a + 1], wz = positions[d + 2] - positions[a + 2];
    return Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
  };
  let here = nt ? areaOf(0) : 0;
  let walked = 0;
  for (let i = 0; i < n; i++) {
    const at = ((i + 0.5) / n) * total;
    while (t < nt - 1 && run + here < at) {
      run += here;
      here = areaOf(++t);
      if (++walked % YIELD_EVERY === 0) {
        progress?.(t / nt);
        yield;
      }
    }
    let u = (0.5 + (i + 1) * R2[0]) % 1, v = (0.5 + (i + 1) * R2[1]) % 1;
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const a = 3 * index[3 * t], b = 3 * index[3 * t + 1], d = 3 * index[3 * t + 2];
    for (let k = 0; k < 3; k++) out[3 * i + k] = positions[a + k] + u * (positions[b + k] - positions[a + k]) + v * (positions[d + k] - positions[a + k]);
  }
  return out;
}

const RAYS: Vec3[] = SYMMETRY_PARAMETERS.SYM_RAY_DIRECTIONS.map((d) => normalize([d[0], d[1], d[2]]));

/** Whether `p` lies inside the closed surface: the parity of the crossings along the rays, the majority of the three. */
export function insideMesh(bvh: TriangleBvh, p: Vec3): boolean {
  if (!bvh.inBox(p)) return false;
  const a = bvh.crossings(p, RAYS[0]) & 1, b = bvh.crossings(p, RAYS[1]) & 1;
  if (a === b) return a === 1;
  return (bvh.crossings(p, RAYS[2]) & 1) === 1;
}

/**
 * The points of a regular grid inside the specimen: step h = (V / count)^(1/3), the first point half a step in from the box's
 * corner on each axis (the same every time), about `count` of them.
 */
function* interiorSamplesSteps(bvh: TriangleBvh, m: MeshMoments, count: number, progress?: Progress): Steps<{ samples: Float64Array; step: number | null }> {
  if (!(m.volume > 0) || count <= 0) return { samples: new Float64Array(0), step: null };
  const h = Math.cbrt(m.volume / count);
  const n = [0, 1, 2].map((k) => Math.max(1, Math.ceil((m.max[k] - m.min[k]) / h)));
  // (a mesh whose volume is next to nothing against its box: no grid of millions)
  if (n[0] * n[1] * n[2] > 64 * count) return { samples: new Float64Array(0), step: null };
  let out = new Float64Array(3 * Math.ceil(count * 1.2) + 3);
  let found = 0, tested = 0;
  const all = n[0] * n[1] * n[2];
  const p: Vec3 = [0, 0, 0];
  for (let k = 0; k < n[2]; k++)
    for (let j = 0; j < n[1]; j++) {
      p[1] = m.min[1] + (j + 0.5) * h;
      p[2] = m.min[2] + (k + 0.5) * h;
      for (let i = 0; i < n[0]; i++) {
        p[0] = m.min[0] + (i + 0.5) * h;
        if (++tested % QUERIES === 0) {
          progress?.(tested / all);
          yield;
        }
        if (!insideMesh(bvh, p)) continue;
        if (3 * found + 3 > out.length) {
          const grown = new Float64Array(2 * out.length);
          grown.set(out);
          out = grown;
        }
        out[3 * found] = p[0];
        out[3 * found + 1] = p[1];
        out[3 * found + 2] = p[2];
        found++;
      }
    }
  return { samples: out.slice(0, 3 * found), step: h };
}

/** How long each part of the preparation takes, roughly (for the progress told). */
const PREPARE_SHARES = { moments: 0.05, edges: 0.1, bvh: 0.35, surface: 0.05, interior: 0.45 };

/** Yields of a computation counted against how many there should be: its progress. */
function* counted<T>(steps: Steps<T>, expected: number, progress: Progress | undefined, from: number, span: number): Steps<T> {
  let n = 0;
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    progress?.(from + span * Math.min(0.99, ++n / Math.max(1, expected)));
    yield;
  }
}

/**
 * What every reference of a model needs: the edges, the tree, the surface samples and (closed) the interior samples. `moments`
 * when already made (the centroid is told before the rest).
 */
export function* symmetryMeshSteps(positions: ArrayLike<number>, index: ArrayLike<number>, closed: boolean, moments: MeshMoments | null = null, progress?: Progress): Steps<SymmetryMesh> {
  const nv = Math.floor(positions.length / 3), nt = Math.floor(index.length / 3);
  const S = PREPARE_SHARES;
  const m = moments ?? (yield* counted(meshMomentsSteps(positions, index), (nv + nt) / YIELD_EVERY, progress, 0, S.moments));
  let at = S.moments;
  const edges = yield* counted(buildEdgesSteps(index, nv), (6 * nt) / YIELD_EVERY + 4, progress, at, S.edges);
  at += S.edges;
  const bvh = yield* counted(triangleBvhSteps(positions, index), (3 * nt) / 65536 + 4, progress, at, S.bvh);
  at += S.bvh;
  const surfaceSamples = yield* surfaceSamplesSteps(positions, index, m.area, SYMMETRY_PARAMETERS.SYM_DEVIATION_SAMPLES, (s) => progress?.(at + S.surface * s));
  at += S.surface;
  const interior = closed ? yield* interiorSamplesSteps(bvh, m, SYMMETRY_PARAMETERS.SYM_OVERLAP_SAMPLES, (s) => progress?.(at + S.interior * s)) : { samples: new Float64Array(0), step: null };
  progress?.(1);
  return { ...m, positions, index, closed, edges, bvh, surfaceSamples, interiorSamples: interior.samples, gridStep: interior.step };
}

/** The mirror image of p in the plane. */
export const mirrorPoint = (p: Vec3, plane: SymmetryPlane): Vec3 => {
  const n = plane.normal;
  const d = 2 * ((p[0] - plane.point[0]) * n[0] + (p[1] - plane.point[1]) * n[1] + (p[2] - plane.point[2]) * n[2]);
  return [p[0] - d * n[0], p[1] - d * n[1], p[2] - d * n[2]];
};

/** What one reference needs besides the mesh (positions' coordinates). */
export interface SymmetryInput {
  /** The source's plane; its normal points to side A (before any swap). */
  plane: SymmetryPlane;
  /** A closed curve's chain of mesh vertices: the sides are the pieces it parts. */
  chain: number[] | null;
  closed: boolean;
}

/** ① The two sides: their volumes and areas, A first (null: see the reasons), and what parts them (for drawing; never stored). */
export interface SymmetrySides {
  volumes: [number, number] | null;
  areas: [number, number] | null;
  volumeReason: SymmetryReason | null;
  areaReason: SymmetryReason | null;
  parts: SplitParts | null;
}

/** ② The mirror deviation over the surface samples (each the same weight). */
export interface DeviationStats {
  mean: number;
  rms: number;
  p95: number;
}

/** ① The sides: along the curve, or by the plane. */
export function* symmetrySidesSteps(m: SymmetryMesh, input: SymmetryInput, progress?: Progress): Steps<SymmetrySides> {
  const plane: SymmetryPlane = { point: [...input.plane.point] as Vec3, normal: normalize(input.plane.normal) };
  const nv = m.positions.length / 3, nt = m.index.length / 3;
  let split: SplitResult | null;
  if (input.chain) split = input.chain.length >= 3 ? yield* counted(splitByLoopSteps(m.positions, m.index, m.edges, input.chain, plane.normal), (3 * nt) / YIELD_EVERY + 4, progress, 0, 1) : null;
  else split = yield* counted(splitByPlaneSteps(m.positions, m.index, plane.point, plane.normal), (nv + nt) / YIELD_EVERY, progress, 0, 1);
  const totalArea = split ? split.areas.upper + split.areas.lower : 0;
  const cut = !!split && Math.min(split.areas.upper, split.areas.lower) > SYMMETRY_PARAMETERS.EMPTY_SIDE_SHARE * totalArea;
  return {
    volumes: cut && input.closed ? [split!.upper, split!.lower] : null,
    areas: cut ? [split!.areas.upper, split!.areas.lower] : null,
    volumeReason: !cut ? 'no_cut' : input.closed ? null : 'not_closed',
    areaReason: cut ? null : 'no_cut',
    parts: split?.parts ?? null,
  };
}

/** ② How far the mirror image of each surface sample lies from the surface: mean, RMS and DEVIATION_QUANTILE. */
export function* deviationStatsSteps(m: SymmetryMesh, plane: SymmetryPlane, progress?: Progress): Steps<DeviationStats> {
  const s = m.surfaceSamples;
  const n = s.length / 3;
  const d = new Float64Array(n);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    if (i % QUERIES === 0) {
      progress?.(i / n);
      yield;
    }
    const c = m.bvh.closest(mirrorPoint([s[3 * i], s[3 * i + 1], s[3 * i + 2]], plane));
    const x = c ? c.distance : 0;
    d[i] = x;
    s1 += x;
    s2 += x * x;
  }
  yield;
  const p95 = n ? weightedQuantile(d, new Float64Array(n).fill(1), SYMMETRY_PARAMETERS.DEVIATION_QUANTILE) : NaN;
  return { mean: n ? s1 / n : NaN, rms: n ? Math.sqrt(s2 / n) : NaN, p95 };
}

/** ③ Shape symmetry: the share of the interior samples whose mirror image is inside too (null without them: an open mesh). */
export function* shapeSymmetrySteps(m: SymmetryMesh, plane: SymmetryPlane, progress?: Progress): Steps<number | null> {
  const s = m.interiorSamples;
  const n = s.length / 3;
  if (!n) return null;
  let inside = 0;
  for (let i = 0; i < n; i++) {
    if (i % QUERIES === 0) {
      progress?.(i / n);
      yield;
    }
    if (insideMesh(m.bvh, mirrorPoint([s[3 * i], s[3 * i + 1], s[3 * i + 2]], plane))) inside++;
  }
  return inside / n;
}

/** The mirror deviation at every vertex (for the shading; never stored). */
export function* vertexDeviationSteps(m: SymmetryMesh, plane: SymmetryPlane, progress?: Progress): Steps<Float32Array> {
  const nv = Math.floor(m.positions.length / 3);
  const out = new Float32Array(nv);
  for (let v = 0; v < nv; v++) {
    if (v % QUERIES === 0) {
      progress?.(v / nv);
      yield;
    }
    const c = m.bvh.closest(mirrorPoint(P(m.positions, v), plane));
    out[v] = c ? c.distance : 0;
  }
  return out;
}

/** One reference's results so far (positions' coordinates, before any swap); a part not there yet is undefined. */
export interface SymmetryComputed {
  plane: SymmetryPlane;
  sides?: SymmetrySides;
  deviation?: DeviationStats;
  /** null: no shape symmetry (see the sides' volume reason). */
  shape?: number | null;
}

/** Whether a shape symmetry is to be computed after these sides: the plane cuts a closed mesh. */
export const wantsShape = (sides: SymmetrySides): boolean => sides.volumes !== null;

/** ①, ② and ③ at once (tests, the bench). */
export function* symmetrySteps(m: SymmetryMesh, input: SymmetryInput): Steps<Required<SymmetryComputed>> {
  const plane: SymmetryPlane = { point: [...input.plane.point] as Vec3, normal: normalize(input.plane.normal) };
  const sides = yield* symmetrySidesSteps(m, input);
  const deviation = yield* deviationStatsSteps(m, plane);
  const shape = wantsShape(sides) ? yield* shapeSymmetrySteps(m, plane) : null;
  return { plane, sides, deviation, shape };
}

/** Whether every part of a reference is there. */
export const isComplete = (c: SymmetryComputed | null | undefined): boolean => !!c && c.sides !== undefined && c.deviation !== undefined && c.shape !== undefined;

const finite = (x: number | null | undefined): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** min / max of two (null when both are nothing). */
export const alike = (a: number, b: number): number | null => {
  const hi = Math.max(a, b);
  return hi > 0 ? Math.max(0, Math.min(a, b)) / hi : null;
};

/** A reference without a plane: every value empty. */
export const noSourceValues = (ref: Pick<SymmetryRef, 'id'>): SymmetryValues => ({
  id: ref.id,
  plane: null,
  volumeSymmetry: null,
  areaSymmetry: null,
  shapeSymmetry: null,
  volumeA: null,
  volumeB: null,
  areaA: null,
  areaB: null,
  deviationMean: null,
  deviationRms: null,
  deviationP95: null,
  reasons: { volume: 'no_source', area: 'no_source', shape: 'no_source', deviation: 'no_source' },
});

/**
 * The values as stored: A and B exchanged when `swap` is set (the normal then points the other way; the three symmetries are
 * the same), the plane in original coordinates. A part not computed yet gives empty values without a reason.
 */
export function symmetryValues(ref: Pick<SymmetryRef, 'id' | 'swap'>, c: SymmetryComputed, offset: Vec3): SymmetryValues {
  const s = ref.swap ? -1 : 1;
  const pair = (x: [number, number] | null | undefined): [number, number] | null => (x ? (ref.swap ? [x[1], x[0]] : [x[0], x[1]]) : null);
  const sd = c.sides;
  const v = pair(sd?.volumes), a = pair(sd?.areas);
  return {
    id: ref.id,
    plane: { point: [c.plane.point[0] + offset[0], c.plane.point[1] + offset[1], c.plane.point[2] + offset[2]], normal: scale(c.plane.normal, s) },
    volumeSymmetry: v ? alike(v[0], v[1]) : null,
    areaSymmetry: a ? alike(a[0], a[1]) : null,
    shapeSymmetry: finite(c.shape),
    volumeA: v ? v[0] : null,
    volumeB: v ? v[1] : null,
    areaA: a ? a[0] : null,
    areaB: a ? a[1] : null,
    deviationMean: finite(c.deviation?.mean),
    deviationRms: finite(c.deviation?.rms),
    deviationP95: finite(c.deviation?.p95),
    // (the shape needs what the volume needs: a cut, a closed mesh)
    reasons: { volume: sd?.volumeReason ?? null, area: sd?.areaReason ?? null, shape: sd?.volumeReason ?? null, deviation: null },
  };
}

/** The source's plane (original coordinates), and the curve whose chain parts the sides; null when the source gives none. */
export function symmetrySource(
  ref: Pick<SymmetryRef, 'source' | 'upHint'>,
  state: Pick<ProjectState, 'curves' | 'specimen' | 'flake'>,
  planes: readonly PlaneResult[],
  /** The surface centroid (original coordinates), for the specimen frame's mid-planes. */
  centroid: Vec3 | null,
): { plane: SymmetryPlane; curveId: string | null } | null {
  const src = ref.source;
  if (src.kind === 'plane') {
    const r = planes.find((p) => p.id === src.planeId);
    return r?.valid && r.center && r.normal ? { plane: { point: [...r.center] as Vec3, normal: normalize(r.normal) }, curveId: null } : null;
  }
  if (src.kind === 'curve') {
    const c = state.curves.find((x) => x.id === src.curveId);
    const fit = c?.closed ? fitPlane(c.points) : null;
    if (!c || !fit) return null;
    let normal = normalize(fit.normal);
    if (dot(normal, ref.upHint) < 0) normal = scale(normal, -1);
    return { plane: { point: [...fit.centroid] as Vec3, normal }, curveId: c.id };
  }
  const matrix = src.frame === 'technological' ? (state.specimen.type === 'flake' ? (state.flake.axis?.matrix ?? null) : null) : (state.specimen.frame?.matrix ?? null);
  if (!matrix) return null;
  const axes = frameAxes(matrix);
  const point = src.frame === 'technological' ? axes.origin : centroid;
  return point ? { plane: { point: [...point] as Vec3, normal: normalize(axes[src.axis]) }, curveId: null } : null;
}

/** Whether the source's plane goes through the surface centroid (a specimen frame's mid-plane): it waits for the model's moments. */
export const needsCentroid = (ref: Pick<SymmetryRef, 'source'>): boolean => ref.source.kind === 'frame' && ref.source.frame === 'specimen';

/** The source as a short code for symmetry.csv: the plane's or curve's label, or `technological_x`, `specimen_y`, …; and its kind. */
export function symmetrySourceCode(ref: Pick<SymmetryRef, 'source'>, state: Pick<ProjectState, 'planes' | 'curves'>): { kind: string; id: string } {
  const s = ref.source;
  if (s.kind === 'plane') return { kind: 'plane', id: state.planes.find((p) => p.id === s.planeId)?.label ?? '' };
  if (s.kind === 'curve') return { kind: 'curve', id: state.curves.find((c) => c.id === s.curveId)?.label ?? '' };
  return { kind: 'frame', id: `${s.frame}_${s.axis}` };
}

/**
 * Agreement between observers who annotated the same model: matching of
 * their annotations, agreement statistics (Cohen's and Fleiss' κ, ICC) and
 * the long table of differences. Pure functions; the app supplies what needs
 * the mesh (planes, per-triangle region labels, frame-dependent measurements).
 */

import { SCAR_FIELDS } from '../core/fields';
import { hasVector, type ProjectState, type Vec3 } from '../core/types';
import { arcLengths, landmarkTable, pointAtArc } from './landmarks';
import type { PlaneResult } from './planes';

/** An enumerated attribute as its code; '' when not filled in. */
const attrCode = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// ---------------------------------------------------------------- assignment

/**
 * Minimum-cost assignment (Hungarian method, O(n²m)). Returns, for each row,
 * its column or −1. Pairs costing more than `limit` are never made.
 */
export function assign(cost: number[][], limit = Infinity): number[] {
  const rows = cost.length;
  const cols = rows ? cost[0].length : 0;
  if (!rows || !cols) return new Array<number>(rows).fill(-1);
  const flip = rows > cols;
  const n = flip ? cols : rows, m = flip ? rows : cols;
  let top = 0;
  for (const r of cost) for (const c of r) if (Number.isFinite(c) && c <= limit) top = Math.max(top, Math.abs(c));
  const forbidden = (top + 1) * (n + m + 1) * 4;
  const a = (i: number, j: number): number => {
    const c = flip ? cost[j][i] : cost[i][j];
    return Number.isFinite(c) && c <= limit ? c : forbidden;
  };
  const u = new Float64Array(n + 1), v = new Float64Array(m + 1);
  const p = new Int32Array(m + 1), way = new Int32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(m + 1).fill(Infinity);
    const used = new Uint8Array(m + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = a(i0 - 1, j - 1) - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const out = new Array<number>(rows).fill(-1);
  for (let j = 1; j <= m; j++) {
    const i = p[j];
    if (!i || a(i - 1, j - 1) >= forbidden) continue;
    if (flip) out[j - 1] = i - 1;
    else out[i - 1] = j - 1;
  }
  return out;
}

// ---------------------------------------------------------------- agreement statistics

export interface Agreement {
  /** Number of items (or their total weight when weighted). */
  n: number;
  /** Observed agreement: the share of items rated alike (Fleiss: mean pairwise agreement). */
  agreement: number;
  /** NaN when chance agreement is 1 (a single category throughout). */
  kappa: number;
}

/** Cohen's κ for two raters; `weights` (e.g. areas) default to 1. */
export function cohenKappa(pairs: ReadonlyArray<readonly [string, string]>, weights?: ArrayLike<number>): Agreement {
  let total = 0, same = 0;
  const pa = new Map<string, number>(), pb = new Map<string, number>();
  pairs.forEach(([a, b], i) => {
    const w = weights ? weights[i] : 1;
    total += w;
    if (a === b) same += w;
    pa.set(a, (pa.get(a) ?? 0) + w);
    pb.set(b, (pb.get(b) ?? 0) + w);
  });
  if (!(total > 0)) return { n: 0, agreement: NaN, kappa: NaN };
  const po = same / total;
  let pe = 0;
  for (const [k, x] of pa) pe += (x / total) * ((pb.get(k) ?? 0) / total);
  return { n: total, agreement: po, kappa: pe < 1 - 1e-12 ? (po - pe) / (1 - pe) : NaN };
}

/** Fleiss' κ: every item rated by the same number of raters (≥ 2). */
export function fleissKappa(items: ReadonlyArray<readonly string[]>, weights?: ArrayLike<number>): Agreement {
  let total = 0, pBar = 0;
  const share = new Map<string, number>();
  items.forEach((ratings, i) => {
    const r = ratings.length;
    if (r < 2) return;
    const w = weights ? weights[i] : 1;
    const counts = new Map<string, number>();
    for (const c of ratings) counts.set(c, (counts.get(c) ?? 0) + 1);
    let sq = 0;
    for (const [c, k] of counts) {
      sq += k * k;
      share.set(c, (share.get(c) ?? 0) + (w * k) / r);
    }
    pBar += (w * (sq - r)) / (r * (r - 1));
    total += w;
  });
  if (!(total > 0)) return { n: 0, agreement: NaN, kappa: NaN };
  pBar /= total;
  let pe = 0;
  for (const x of share.values()) pe += (x / total) ** 2;
  return { n: total, agreement: pBar, kappa: pe < 1 - 1e-12 ? (pBar - pe) / (1 - pe) : NaN };
}

/**
 * ICC(2,1) of Shrout & Fleiss (two-way random effects, absolute agreement,
 * single rater): rows are subjects (specimens), columns raters. NaN when it
 * cannot be computed (fewer than two of either, or missing values).
 */
export function icc21(data: ReadonlyArray<readonly number[]>): number {
  const n = data.length, k = n ? data[0].length : 0;
  if (n < 2 || k < 2 || data.some((r) => r.length !== k || r.some((x) => !Number.isFinite(x)))) return NaN;
  const grand = data.flat().reduce((s, x) => s + x, 0) / (n * k);
  const rowMeans = data.map((r) => r.reduce((s, x) => s + x, 0) / k);
  const colMeans = Array.from({ length: k }, (_, j) => data.reduce((s, r) => s + r[j], 0) / n);
  const ssr = k * rowMeans.reduce((s, m) => s + (m - grand) ** 2, 0);
  const ssc = n * colMeans.reduce((s, m) => s + (m - grand) ** 2, 0);
  const sst = data.flat().reduce((s, x) => s + (x - grand) ** 2, 0);
  const msr = ssr / (n - 1), msc = ssc / (k - 1), mse = (sst - ssr - ssc) / ((n - 1) * (k - 1));
  const den = msr + (k - 1) * mse + (k * (msc - mse)) / n;
  return den !== 0 ? (msr - mse) / den : NaN;
}

// ---------------------------------------------------------------- geometry

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Angle between two directions in degrees (0–180). */
export function angleBetween(a: Vec3, b: Vec3): number {
  const l = Math.hypot(...a) * Math.hypot(...b);
  return l > 0 ? (Math.acos(Math.max(-1, Math.min(1, dot(a, b) / l))) * 180) / Math.PI : NaN;
}

function resample(points: readonly Vec3[], closed: boolean, count: number): Vec3[] {
  const cum = arcLengths(points, closed);
  const L = cum[cum.length - 1];
  const steps = closed ? count : count - 1;
  return Array.from({ length: count }, (_, k) => pointAtArc(points, closed, cum, (L * k) / Math.max(1, steps)));
}

function toPolyline(p: Vec3, line: readonly Vec3[], closed: boolean): number {
  let best = Infinity;
  const n = line.length + (closed ? 1 : 0);
  if (line.length === 1) return dist(p, line[0]);
  for (let i = 1; i < n; i++) {
    const a = line[i - 1], b = line[i % line.length];
    const d = sub(b, a);
    const l2 = dot(d, d);
    const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l2)) : 0;
    best = Math.min(best, dist(p, [a[0] + t * d[0], a[1] + t * d[1], a[2] + t * d[2]]));
  }
  return best;
}

/**
 * Distance between two curves, both resampled at equal arc length: the mean of
 * the two directed mean closest-point distances, and the Hausdorff distance.
 */
export function curveDistance(a: { points: readonly Vec3[]; closed: boolean }, b: { points: readonly Vec3[]; closed: boolean }, samples = 128): { mean: number; hausdorff: number } {
  const ra = resample(a.points, a.closed, samples), rb = resample(b.points, b.closed, samples);
  const directed = (from: Vec3[], to: Vec3[], closed: boolean) => {
    let sum = 0, max = 0;
    for (const p of from) {
      const d = toPolyline(p, to, closed);
      sum += d;
      max = Math.max(max, d);
    }
    return { mean: sum / from.length, max };
  };
  const ab = directed(ra, rb, b.closed), ba = directed(rb, ra, a.closed);
  return { mean: (ab.mean + ba.mean) / 2, hausdorff: Math.max(ab.max, ba.max) };
}

// ---------------------------------------------------------------- comparison

/** Region type codes of the triangles in FaceLabels. */
export const FACE_TYPES: readonly string[] = ['', 'scar', 'cortex', 'joint', 'damage', 'flaking_surface', 'platform', 'ventral', 'dorsal', 'retouch'];

export interface FaceLabels {
  /** Region type of each triangle (index into the comparison's `faceTypes`; 0 = none). */
  type: Uint8Array;
  /** The observer's region (index in its `regions`) each triangle belongs to, or −1. */
  region: Int32Array;
}

export interface ObserverData {
  label: string;
  state: Readonly<ProjectState>;
  /** The observer's fitted planes, computed from its inputs. */
  planes: PlaneResult[];
  /** Region of each triangle, lower layer (null without regions or before the mesh is partitioned). */
  faces: FaceLabels | null;
  /** The same for the upper layer; compared by type (null: none). */
  upper?: FaceLabels | null;
  /** Values that depend on the observer: length, width, thickness (its frame), region areas, cortex ratio. */
  measures: Record<string, number | null>;
}

export interface AgreementRow {
  itemType: string;
  itemKey: string;
  a: string;
  b: string;
  metric: string;
  value: number;
}

export interface CompareOptions {
  /** Pairs of arrows (mean endpoint distance) and curves (mean distance) farther apart than this are not matched. */
  gate: number;
  /** Area of each triangle (weights for the region statistics). */
  faceArea: ArrayLike<number> | null;
  /** What the numbers in FaceLabels stand for: FACE_TYPES, and after them the observers' own texts. */
  faceTypes?: readonly string[];
}

/** Scar matching between two observers: scar id of A → scar id of B. */
type ScarMap = Map<string, string>;

interface PairResult {
  rows: AgreementRow[];
  scars: ScarMap;
}

function matchArrows(a: Readonly<ProjectState>, b: Readonly<ProjectState>, gate: number): Array<[number, number]> {
  const A = a.scars.filter(hasVector), B = b.scars.filter(hasVector);
  const cost = A.map((x) => B.map((y) => (dist(x.vector.start, y.vector.start) + dist(x.vector.end, y.vector.end)) / 2));
  const m = assign(cost, gate);
  return m.flatMap((j, i) => (j >= 0 ? [[a.scars.indexOf(A[i]), b.scars.indexOf(B[j])] as [number, number]] : []));
}

/** Relation of x and y (in that order): x cuts y, y cuts x, cannot tell, or none recorded. */
function relationOf(s: Readonly<ProjectState>, x: string, y: string): string {
  const r = s.relations.find((q) => (q.a === x && q.b === y) || (q.a === y && q.b === x));
  if (!r) return 'none';
  if (r.kind === 'indeterminate') return 'indeterminate';
  return r.a === x ? 'x_cuts_y' : 'y_cuts_x';
}

function comparePair(A: ObserverData, B: ObserverData, opts: CompareOptions): PairResult {
  const rows: AgreementRow[] = [];
  const row = (itemType: string, itemKey: string, metric: string, value: number) => rows.push({ itemType, itemKey, a: A.label, b: B.label, metric, value });
  const sa = A.state, sb = B.state;

  // arrows
  const arrows = matchArrows(sa, sb, opts.gate);
  for (const [i, j] of arrows) {
    const x = sa.scars[i].vector!, y = sb.scars[j].vector!;
    const key = `${sa.scars[i].label}|${sb.scars[j].label}`;
    row('arrow', key, 'angle_deg', angleBetween(sub(x.end, x.start), sub(y.end, y.start)));
    row('arrow', key, 'start_distance', dist(x.start, y.start));
    row('arrow', key, 'end_distance', dist(x.end, y.end));
  }
  row('arrow', 'all', 'matched', arrows.length);
  row('arrow', 'all', 'unmatched_a', sa.scars.filter(hasVector).length - arrows.length);
  row('arrow', 'all', 'unmatched_b', sb.scars.filter(hasVector).length - arrows.length);
  const scars: ScarMap = new Map(arrows.map(([i, j]) => [sa.scars[i].id, sb.scars[j].id]));

  // regions (per triangle, weighted by area)
  const fa = A.faces, fb = B.faces, area = opts.faceArea;
  const faceTypes = opts.faceTypes ?? FACE_TYPES;
  // the upper layer by type: how far each part coincides
  if (A.upper && B.upper && area) {
    const k = faceTypes.length;
    const inter = new Float64Array(k), inA = new Float64Array(k), inB = new Float64Array(k);
    for (let f = 0; f < A.upper.type.length; f++) {
      const w = area[f], ta = A.upper.type[f], tb = B.upper.type[f];
      inA[ta] += w;
      inB[tb] += w;
      if (ta === tb) inter[ta] += w;
    }
    for (let t = 1; t < k; t++) {
      const union = inA[t] + inB[t] - inter[t];
      if (!(union > 0)) continue;
      row('region', faceTypes[t], 'iou', inter[t] / union);
      row('region', faceTypes[t], 'dice', (2 * inter[t]) / (inA[t] + inB[t]));
    }
  }
  if (fa && fb && area) {
    const k = faceTypes.length;
    const inter = new Float64Array(k), inA = new Float64Array(k), inB = new Float64Array(k);
    const confusion = new Float64Array(k * k);
    const overlap = new Map<number, number>();
    const scarAreaA = new Map<number, number>(), scarAreaB = new Map<number, number>();
    for (let f = 0; f < fa.type.length; f++) {
      const w = area[f], ta = fa.type[f], tb = fb.type[f];
      inA[ta] += w;
      inB[tb] += w;
      if (ta === tb) inter[ta] += w;
      confusion[ta * k + tb] += w;
      if (ta === 1) scarAreaA.set(fa.region[f], (scarAreaA.get(fa.region[f]) ?? 0) + w);
      if (tb === 1) scarAreaB.set(fb.region[f], (scarAreaB.get(fb.region[f]) ?? 0) + w);
      if (ta === 1 && tb === 1) {
        const key = fa.region[f] * 1048576 + fb.region[f];
        overlap.set(key, (overlap.get(key) ?? 0) + w);
      }
    }
    for (let t = 1; t < k; t++) {
      const union = inA[t] + inB[t] - inter[t];
      if (!(union > 0)) continue;
      row('region', faceTypes[t], 'iou', inter[t] / union);
      row('region', faceTypes[t], 'dice', (2 * inter[t]) / (inA[t] + inB[t]));
    }
    // type agreement where both typed the surface
    const pairs: Array<[string, string]> = [];
    const w: number[] = [];
    for (let ta = 1; ta < k; ta++)
      for (let tb = 1; tb < k; tb++)
        if (confusion[ta * k + tb] > 0) {
          pairs.push([faceTypes[ta], faceTypes[tb]]);
          w.push(confusion[ta * k + tb]);
        }
    const ag = cohenKappa(pairs, w);
    if (ag.n > 0) {
      row('region_type', 'all', 'agreement', ag.agreement);
      row('region_type', 'all', 'cohen_kappa', ag.kappa);
      row('region_type', 'all', 'area', ag.n);
    }
    // scar regions: largest overlaps first, each region used once
    const ordered = [...overlap].sort((x, y) => y[1] - x[1]);
    const usedA = new Set<number>(), usedB = new Set<number>();
    const usedScarB = new Set(scars.values());
    for (const [key, ov] of ordered) {
      const ra = Math.floor(key / 1048576), rb = key % 1048576;
      if (usedA.has(ra) || usedB.has(rb)) continue;
      usedA.add(ra);
      usedB.add(rb);
      const ga = sa.regions[ra], gb = sb.regions[rb];
      if (!ga || !gb) continue;
      const aa = scarAreaA.get(ra) ?? 0, ab = scarAreaB.get(rb) ?? 0;
      const rk = `${ga.label}|${gb.label}`;
      row('region', rk, 'iou', ov / (aa + ab - ov));
      row('region', rk, 'dice', (2 * ov) / (aa + ab));
      // scars known only by their regions are matched through them
      if (ga.scarId && gb.scarId && !scars.has(ga.scarId) && !usedScarB.has(gb.scarId)) {
        scars.set(ga.scarId, gb.scarId);
        usedScarB.add(gb.scarId);
      }
    }
  }

  // scar attributes over the matched scars
  const matched = [...scars].flatMap(([x, y]) => {
    const p = sa.scars.find((s) => s.id === x), q = sb.scars.find((s) => s.id === y);
    return p && q ? [[p, q] as const] : [];
  });
  // (a generic specimen's arrows have no attributes)
  for (const f of sa.specimen?.type === 'generic' ? [] : SCAR_FIELDS) {
    if (f.type !== 'enum') continue;
    // a scar either observer left unfilled (e.g. the termination not judged yet) does not count
    const pairs = matched.map(([p, q]) => [attrCode(p.attributes[f.key]), attrCode(q.attributes[f.key])] as [string, string]).filter(([x, y]) => x && y);
    if (!pairs.length) continue;
    const ag = cohenKappa(pairs);
    row('scar_attribute', f.key, 'agreement', ag.agreement);
    row('scar_attribute', f.key, 'cohen_kappa', ag.kappa);
    row('scar_attribute', f.key, 'n_items', ag.n);
  }

  // relations between matched scars
  const back = new Map([...scars].map(([x, y]) => [y, x]));
  const order = new Map(sa.scars.map((s, i) => [s.id, i]));
  const pairKeys = new Map<string, [string, string]>();
  const addPair = (x: string, y: string) => {
    if (!scars.has(x) || !scars.has(y) || x === y) return;
    const [p, q] = order.get(x)! < order.get(y)! ? [x, y] : [y, x];
    pairKeys.set(`${p}|${q}`, [p, q]);
  };
  for (const r of sa.relations) addPair(r.a, r.b);
  for (const r of sb.relations) if (back.has(r.a) && back.has(r.b)) addPair(back.get(r.a)!, back.get(r.b)!);
  if (pairKeys.size) {
    const ag = cohenKappa([...pairKeys.values()].map(([x, y]) => [relationOf(sa, x, y), relationOf(sb, scars.get(x)!, scars.get(y)!)] as [string, string]));
    row('relation', 'all', 'agreement', ag.agreement);
    row('relation', 'all', 'cohen_kappa', ag.kappa);
    row('relation', 'all', 'n_items', ag.n);
  }

  // curves of the same type
  const types = new Set([...sa.curves, ...sb.curves].map((c) => String(c.attributes.type ?? '')));
  let curvesMatched = 0;
  for (const type of types) {
    const ca = sa.curves.filter((c) => String(c.attributes.type ?? '') === type);
    const cb = sb.curves.filter((c) => String(c.attributes.type ?? '') === type);
    if (!ca.length || !cb.length) continue;
    const m = assign(ca.map((x) => cb.map((y) => curveDistance(x, y, 32).mean)), opts.gate);
    m.forEach((j, i) => {
      if (j < 0) return;
      curvesMatched++;
      const d = curveDistance(ca[i], cb[j]);
      const key = `${ca[i].label}|${cb[j].label}`;
      row('curve', key, 'mean_distance', d.mean);
      row('curve', key, 'hausdorff', d.hausdorff);
    });
  }
  row('curve', 'all', 'matched', curvesMatched);
  row('curve', 'all', 'unmatched_a', sa.curves.length - curvesMatched);
  row('curve', 'all', 'unmatched_b', sb.curves.length - curvesMatched);

  // planes of the same method
  const planeAngle = (x: PlaneResult, y: PlaneResult) => {
    const t = angleBetween(x.normal!, y.normal!);
    return Math.min(t, 180 - t);
  };
  for (const method of new Set(A.planes.map((p) => p.method))) {
    const pa = A.planes.filter((p) => p.method === method && p.valid);
    const pb = B.planes.filter((p) => p.method === method && p.valid);
    if (!pa.length || !pb.length) continue;
    assign(pa.map((x) => pb.map((y) => planeAngle(x, y)))).forEach((j, i) => {
      if (j < 0) return;
      const key = `${pa[i].label}|${pb[j].label}`;
      row('plane', key, 'normal_angle_deg', planeAngle(pa[i], pb[j]));
      row('plane', key, 'center_distance', dist(pa[i].center!, pb[j].center!));
    });
  }

  // landmarks by name, semilandmarks by set and number
  const firstByName = (s: Readonly<ProjectState>) => {
    const m = new Map<string, Vec3>();
    for (const l of s.landmarks) if (!m.has(l.name)) m.set(l.name, l.point);
    return m;
  };
  const la = firstByName(sa), lb = firstByName(sb);
  for (const [name, p] of la) if (lb.has(name)) row('landmark', name, 'distance', dist(p, lb.get(name)!));
  const ta = landmarkTable(sa), tb = landmarkTable(sb);
  for (const x of ta.sets) {
    const y = tb.sets.find((q) => q.label === x.label);
    if (!y || !x.valid || !y.valid || x.points.length !== y.points.length) continue;
    x.points.forEach((p, k) => row('semilandmark', `${x.label}_${k + 1}`, 'distance', dist(p, y.points[k])));
  }

  // measurements: differences (b − a)
  for (const [key, va] of Object.entries(A.measures)) {
    const vb = B.measures[key];
    if (va !== null && vb !== null && vb !== undefined) row('measurement', key, 'difference', vb - va);
  }
  for (const m of sa.measurements) {
    const n = sb.measurements.find((x) => x.label === m.label && x.type === m.type);
    if (n) row('measurement', m.label, 'difference', manualValue(n) - manualValue(m));
  }
  return { rows, scars };
}

function manualValue(m: ProjectState['measurements'][number]): number {
  if (m.type === 'angle') return angleBetween(sub(m.points[0], m.points[1]), sub(m.points[2], m.points[1]));
  const pts = m.type === 'geodesic' && m.path ? m.path : m.points;
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

/**
 * Compare every pair of observers (in the given order), then — with three or
 * more — all of them at once (Fleiss' κ) on what the first one's scars and the
 * surface have in common with every other.
 */
export function compareObservers(observers: readonly ObserverData[], opts: CompareOptions): AgreementRow[] {
  const rows: AgreementRow[] = [];
  const maps: ScarMap[] = [];
  for (let i = 0; i < observers.length; i++)
    for (let j = i + 1; j < observers.length; j++) {
      const r = comparePair(observers[i], observers[j], opts);
      rows.push(...r.rows);
      if (i === 0) maps[j] = r.scars;
    }
  if (observers.length < 3) return rows;
  const row = (itemType: string, itemKey: string, metric: string, value: number) => rows.push({ itemType, itemKey, a: 'all', b: '', metric, value });
  const ref = observers[0].state;
  const others = observers.slice(1);
  const mapped = (id: string) => others.every((_, k) => maps[k + 1].has(id));
  const scarOf = (k: number, id: string) => others[k].state.scars.find((s) => s.id === maps[k + 1].get(id));
  const items = ref.scars.filter((s) => mapped(s.id));
  for (const f of ref.specimen?.type === 'generic' ? [] : SCAR_FIELDS) {
    if (f.type !== 'enum') continue;
    const cats = items.map((s) => [attrCode(s.attributes[f.key]), ...others.map((_, k) => attrCode(scarOf(k, s.id)?.attributes[f.key]))]).filter((c) => c.every(Boolean));
    if (!cats.length) continue;
    const ag = fleissKappa(cats);
    row('scar_attribute', f.key, 'agreement', ag.agreement);
    row('scar_attribute', f.key, 'fleiss_kappa', ag.kappa);
    row('scar_attribute', f.key, 'n_items', ag.n);
  }
  const relItems: string[][] = [];
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const x = items[i].id, y = items[j].id;
      const cats = [relationOf(ref, x, y), ...others.map((o, k) => relationOf(o.state, maps[k + 1].get(x)!, maps[k + 1].get(y)!))];
      if (cats.some((c) => c !== 'none')) relItems.push(cats);
    }
  if (relItems.length) {
    const ag = fleissKappa(relItems);
    row('relation', 'all', 'agreement', ag.agreement);
    row('relation', 'all', 'fleiss_kappa', ag.kappa);
    row('relation', 'all', 'n_items', ag.n);
  }
  const area = opts.faceArea;
  if (area && observers.every((o) => o.faces)) {
    const faces = observers.map((o) => o.faces!);
    const ratings: string[][] = [];
    const w: number[] = [];
    // group identical rating patterns to keep this small on large meshes
    const groups = new Map<string, number>();
    for (let f = 0; f < faces[0].type.length; f++) {
      if (faces.some((x) => x.type[f] === 0)) continue;
      const key = faces.map((x) => x.type[f]).join(',');
      groups.set(key, (groups.get(key) ?? 0) + area[f]);
    }
    for (const [key, weight] of groups) {
      ratings.push(key.split(',').map((c) => (opts.faceTypes ?? FACE_TYPES)[Number(c)]));
      w.push(weight);
    }
    const ag = fleissKappa(ratings, w);
    if (ag.n > 0) {
      row('region_type', 'all', 'agreement', ag.agreement);
      row('region_type', 'all', 'fleiss_kappa', ag.kappa);
      row('region_type', 'all', 'area', ag.n);
    }
  }
  return rows;
}

export interface SummaryRow {
  itemType: string;
  metric: string;
  a: string;
  b: string;
  n: number;
  mean: number;
  sd: number;
  min: number;
  max: number;
}

/** The long table summarised by item type, metric and pair of observers (NaN values left out). */
export function summarize(rows: readonly AgreementRow[]): SummaryRow[] {
  const groups = new Map<string, { r: AgreementRow; values: number[] }>();
  for (const r of rows) {
    const key = [r.itemType, r.metric, r.a, r.b].join('\u0000');
    const g = groups.get(key) ?? groups.set(key, { r, values: [] }).get(key)!;
    if (Number.isFinite(r.value)) g.values.push(r.value);
  }
  return [...groups.values()].map(({ r, values }) => {
    const n = values.length;
    const mean = n ? values.reduce((s, x) => s + x, 0) / n : NaN;
    const sd = n > 1 ? Math.sqrt(values.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : NaN;
    return { itemType: r.itemType, metric: r.metric, a: r.a, b: r.b, n, mean, sd, min: n ? Math.min(...values) : NaN, max: n ? Math.max(...values) : NaN };
  });
}

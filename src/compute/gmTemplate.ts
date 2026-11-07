import type { SpecimenType } from '../core/fields';
import { defaultGmConfig, type GmConfig, type GmTemplate, type GmTemplatePoint, type ProjectState, type Vec3 } from '../core/types';
import { hashText } from './hash';
import type { EdgeTable } from './meshGeometry';
import { runSync, type Steps } from './steps';

/**
 * Surface semilandmarks by a template: the points are laid evenly on the regions of one specimen, and passed on from there (`compute/gm.ts`).
 * Everything that follows from them being laid is here: no mesh is needed but for laying them.
 */

export const GM_TEMPLATE_PARAMETERS = {
  /** The points of a patch: a new one's, and the least and most asked of one. */
  PATCH_DEFAULT: 100,
  PATCH_MIN: 10,
  PATCH_MAX: 2000,
  /** Candidates drawn per point asked for. */
  CANDIDATE_FACTOR: 20,
  /** Candidates this near the region's boundary, as a share of s = sqrt(area / count), are left out. */
  BOUNDARY_SHARE: 0.5,
  /** The first seed. */
  SEED_START: 1,
  /** A point goes on the check list when it moved further onto the surface than this share of s on its specimen, */
  MOVE_LIMIT_SHARE: 0.5,
  /** or came nearer another of its patch than this share of s. */
  CROWD_SHARE: 0.25,
  /** Fewer anchors than this tell too little to carry anything. */
  MIN_ANCHORS: 4,
};

/** What a flake's template lists at first: as many points as the grids have by default. */
export const FLAKE_TEMPLATE_PATCHES = (): GmConfig['patches'] => [
  { regionType: 'ventral', count: 150 },
  { regionType: 'dorsal', count: 150 },
  { regionType: 'platform', count: 32 },
];

/** A small seeded random generator (mulberry32): the same seed, the same points, wherever it runs. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LaidPatch {
  points: GmTemplatePoint[];
  /** s = sqrt(area / count). */
  spacing: number;
  area: number;
}

/** The mesh edges that bound these triangles, as two vertices each. */
function boundaryOf(edges: EdgeTable, faces: ArrayLike<number>): number[] {
  const uses = new Uint8Array(edges.v0.length);
  for (let i = 0; i < faces.length; i++) for (let k = 0; k < 3; k++) {
    const e = edges.ofSide[3 * faces[i] + k];
    if (uses[e] < 2) uses[e]++;
  }
  const out: number[] = [];
  for (let e = 0; e < uses.length; e++) if (uses[e] === 1) out.push(edges.v0[e], edges.v1[e]);
  return out;
}

/** Whether a point lies within `reach` of the segments (by a grid of cells of that size). */
function nearSegments(positions: ArrayLike<number>, segments: readonly number[], reach: number): (p: Vec3) => boolean {
  const cell = reach > 0 ? reach : 1;
  const cells = new Map<string, number[]>();
  const at = (v: number) => Math.floor(v / cell);
  for (let s = 0; s + 1 < segments.length; s += 2) {
    const a = 3 * segments[s], b = 3 * segments[s + 1];
    const lo = [0, 1, 2].map((k) => at(Math.min(positions[a + k], positions[b + k])));
    const hi = [0, 1, 2].map((k) => at(Math.max(positions[a + k], positions[b + k])));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const key = `${x},${y},${z}`;
      const list = cells.get(key);
      if (list) list.push(s);
      else cells.set(key, [s]);
    }
  }
  const limit = reach * reach;
  return (p) => {
    const [x, y, z] = [at(p[0]), at(p[1]), at(p[2])];
    for (let i = x - 1; i <= x + 1; i++) for (let j = y - 1; j <= y + 1; j++) for (let k = z - 1; k <= z + 1; k++) {
      const list = cells.get(`${i},${j},${k}`);
      if (!list) continue;
      for (const s of list) {
        const a = 3 * segments[s], b = 3 * segments[s + 1];
        const dx = positions[b] - positions[a], dy = positions[b + 1] - positions[a + 1], dz = positions[b + 2] - positions[a + 2];
        const len = dx * dx + dy * dy + dz * dz;
        const px = p[0] - positions[a], py = p[1] - positions[a + 1], pz = p[2] - positions[a + 2];
        const t = len > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / len)) : 0;
        if ((px - t * dx) ** 2 + (py - t * dy) ** 2 + (pz - t * dz) ** 2 < limit) return true;
      }
    }
    return false;
  };
}

/**
 * `count` points spread evenly over these triangles: candidates drawn by area with a seeded generator, those too near the boundary left out, then each next
 * point the candidate farthest from those taken (farthest-point sampling; the order they are taken in is their number). `positions` relative to `offset`, the points' `point` in
 * original coordinates. Null when the region is too small or narrow to hold that many (candidates are drawn again, more of them, a few times first).
 */
export function* layPatchSteps(positions: ArrayLike<number>, index: ArrayLike<number>, edges: EdgeTable, faces: ArrayLike<number>, count: number, seed: number, offset: Vec3 = [0, 0, 0]): Steps<LaidPatch | null> {
  if (!faces.length || count < 1) return null;
  const cumulative = new Float64Array(faces.length);
  let area = 0;
  const P = (v: number, k: number) => positions[3 * v + k];
  for (let i = 0; i < faces.length; i++) {
    if (i % 65536 === 0) yield;
    const [a, b, c] = [index[3 * faces[i]], index[3 * faces[i] + 1], index[3 * faces[i] + 2]];
    const u = [P(b, 0) - P(a, 0), P(b, 1) - P(a, 1), P(b, 2) - P(a, 2)], v = [P(c, 0) - P(a, 0), P(c, 1) - P(a, 1), P(c, 2) - P(a, 2)];
    area += 0.5 * Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
    cumulative[i] = area;
  }
  if (!(area > 0)) return null;
  const spacing = Math.sqrt(area / count);
  const tooNear = nearSegments(positions, boundaryOf(edges, faces), GM_TEMPLATE_PARAMETERS.BOUNDARY_SHARE * spacing);
  yield;
  const random = seeded(seed);
  const kept: Array<{ face: number; bary: [number, number, number]; at: Vec3 }> = [];
  for (let round = 0, wanted = GM_TEMPLATE_PARAMETERS.CANDIDATE_FACTOR * count; round < 6 && kept.length < Math.max(count, GM_TEMPLATE_PARAMETERS.CANDIDATE_FACTOR); round++, wanted *= 2) {
    for (let n = 0; n < wanted; n++) {
      if (n % 1024 === 0) yield;
      const pick = random() * area;
      let lo = 0, hi = faces.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid] < pick) lo = mid + 1;
        else hi = mid;
      }
      const f = faces[lo];
      const r = Math.sqrt(random()), s = random();
      const bary: [number, number, number] = [1 - r, r * (1 - s), r * s];
      const [a, b, c] = [index[3 * f], index[3 * f + 1], index[3 * f + 2]];
      const at: Vec3 = [0, 1, 2].map((k) => bary[0] * P(a, k) + bary[1] * P(b, k) + bary[2] * P(c, k)) as Vec3;
      if (!tooNear(at)) kept.push({ face: f, bary, at });
    }
  }
  if (kept.length < count) return null;
  // the farthest from those taken, again and again
  const m = kept.length;
  const nearest = new Float64Array(m).fill(Infinity);
  const out: GmTemplatePoint[] = [];
  let next = 0;
  for (let n = 0; n < count; n++) {
    yield;
    const c = kept[next];
    out.push({ face: c.face, bary: c.bary, point: [c.at[0] + offset[0], c.at[1] + offset[1], c.at[2] + offset[2]] });
    let far = -1, farAt = 0;
    for (let i = 0; i < m; i++) {
      const q = kept[i].at;
      const d = (q[0] - c.at[0]) ** 2 + (q[1] - c.at[1]) ** 2 + (q[2] - c.at[2]) ** 2;
      if (d < nearest[i]) nearest[i] = d;
      if (nearest[i] > far) {
        far = nearest[i];
        farAt = i;
      }
    }
    next = farAt;
  }
  return { points: out, spacing, area };
}

export const layPatch = (positions: ArrayLike<number>, index: ArrayLike<number>, edges: EdgeTable, faces: ArrayLike<number>, count: number, seed: number, offset: Vec3 = [0, 0, 0]): LaidPatch | null =>
  runSync(layPatchSteps(positions, index, edges, faces, count, seed, offset));

/** Which of a specimen's annotations its points go by: a change in these shows on the template, and starts them anew on the others. */
type GmInputs = Pick<ProjectState, 'curves' | 'regions' | 'flake'>;

export const anchorsHashOf = (anchors: readonly Vec3[]): string => hashText(JSON.stringify(anchors));

export const regionsHashOf = (st: GmInputs): string => hashText(JSON.stringify([st.curves.map((c) => [c.points, c.closed, c.attributes.type, c.retouchSide]), st.regions.map((r) => [r.seed, r.type, r.auto, r.curveId]), st.flake.axis?.end]));

/** Whether a specimen of this type is asked for any points: a core's or a generic one's by the lists, a flake's by anything but the untouched default. */
export function gmInUse(c: GmConfig, type: SpecimenType): boolean {
  if (type !== 'flake') return c.landmarks.length + c.curves.length + c.patches.length > 0;
  if (c.surfaceMethod === 'template') return true;
  const d = defaultGmConfig();
  return JSON.stringify([c.fixed, c.edge, c.platformOutline, c.ventral, c.dorsal, c.platform]) !== JSON.stringify([d.fixed, d.edge, d.platformOutline, d.ventral, d.dorsal, d.platform]);
}

/** The surface semilandmarks go by the template: always on a core or a generic specimen, on a flake when it is asked for. */
export const usesTemplate = (c: GmConfig, type: SpecimenType): boolean => type !== 'flake' || c.surfaceMethod === 'template';

/** The configuration as results and manifests keep it: the points laid live in the configuration itself, here how many, from where and by which seed. */
export function gmConfigSummary(c: GmConfig): Omit<GmConfig, 'template'> & { template: { file: string; sha256: string; seed: number; anchorsHash: string; regionsHash: string; points: number } | null } {
  const t = c.template;
  return { ...c, template: t ? { file: t.file, sha256: t.sha256, seed: t.seed, anchorsHash: t.anchorsHash, regionsHash: t.regionsHash, points: t.patches.reduce((s, p) => s + p.points.length, 0) } : null };
}

/** A configuration as a stored result holds it: one saved before the lists has the grid's fields alone. */
export type StoredGmConfig = Pick<GmConfig, 'fixed' | 'edge' | 'platformOutline' | 'ventral' | 'dorsal' | 'platform'> & Partial<Pick<GmConfig, 'surfaceMethod' | 'landmarks' | 'curves' | 'patches'>> & { template?: { sha256: string; seed: number } | null };

/** Whether two copies of a configuration ask for the same points, by the same laying (whichever way their fields happen to be written, and whenever). */
export function sameGmConfig(a: StoredGmConfig, b: StoredGmConfig): boolean {
  const grid = (g: GmConfig['ventral']) => [g.on, g.rows, g.cols];
  const mark = (c: StoredGmConfig) => JSON.stringify([c.surfaceMethod ?? 'grid', c.fixed.pop, c.fixed.platform_left, c.fixed.platform_right, c.edge.on, c.edge.points, c.platformOutline.on, c.platformOutline.points, grid(c.ventral), grid(c.dorsal), grid(c.platform), (c.landmarks ?? []).map((l) => l.name), (c.curves ?? []).map((q) => [q.curveType, q.count, !!q.closed, q.start, q.closed ? q.via : q.end]), (c.patches ?? []).map((p) => [p.regionType, p.count]), c.template?.sha256 ?? null, c.template?.seed ?? null]);
  return mark(a) === mark(b);
}

/** How a specimen's points stand, as the status and the folder's list say it: done when whole and with nothing to check. */
export const gmStanding = (r: { complete: boolean; flagged?: readonly number[] } | null | undefined): { done: boolean; flagged: number } => ({ done: !!r?.complete && !r.flagged?.length, flagged: r?.flagged?.length ?? 0 });

/** What an export's manifest says of how the surface semilandmarks were made (`byTemplate`: of its specimens; a core's or a generic one's always are). */
export const gmManifest = (c: GmConfig, byTemplate: boolean): { surfaceMethod: GmConfig['surfaceMethod']; configVersion: number; template: string | null; seed: number | null } => ({ surfaceMethod: byTemplate ? 'template' : 'grid', configVersion: c.version, template: c.template?.file ?? null, seed: c.template?.seed ?? null });

/**
 * What a specimen's points are the result of (the template's points and anchors, the specimen's anchors and regions, its mesh, the version of the configuration):
 * while this is the same, the points stored with the project can stand for them.
 */
export function gmCacheKey(st: Pick<ProjectState, 'gm' | 'curves' | 'regions' | 'flake' | 'landmarks' | 'semilandmarks' | 'mesh' | 'specimen'>): string {
  const c = st.gm;
  return hashText(JSON.stringify([c.version, c.fixed, c.edge, c.platformOutline, c.landmarks, c.curves, c.patches, c.surfaceMethod, st.specimen.type, templateMark(c.template), st.mesh?.sha256 ?? '', regionsHashOf(st), st.flake.axis?.matrix, st.flake.axis?.start, st.landmarks.map((l) => [l.id, l.code, l.name, l.point]), st.semilandmarks]));
}

const templateMark = (t: GmTemplate | null): string => (t ? hashText(JSON.stringify([t.sha256, t.anchors, t.patches.map((p) => [p.regionType, p.points.map((q) => q.point)])])) : '');

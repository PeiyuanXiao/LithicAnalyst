import { CONFIG_FACES, type ConfigFace, type ConfigRole, type ExploitationAxis, type FaceRelation, type FacialCharacter, type PlatformRelation, type Polarity, type SurfaceType } from '../core/fields';
import { hasVector, type ConfigCorrections, type Scar, type ScarVector, type Vec3 } from '../core/types';

/**
 * Volumetric configuration of a core, after the Logical Analytical System
 * (Carbonell et al. 1999; Lombao et al. 2023): the scars are put on the faces of
 * the model's box, each face gets a role (flaking surface, platform, both,
 * unexploited), and seven basic traits follow. Nothing here is a threshold for
 * counting a face: one scar makes a flaking surface. Every result can be
 * corrected by hand (`ConfigCorrections`).
 */

/** Centripetal: share of a surface's scars that point to the centre of its face. */
export const CENTRIPETAL_SHARE = 0.75;
/** Centripetal: a scar points to the centre when cos(direction, start → centre) exceeds this. */
export const CENTRIPETAL_COS = 0.5;
/** Orthogonal multipolar: largest angle between a scar (in its face) and a box axis, degrees. */
export const ORTHOGONAL_TOLERANCE_DEG = 25;
/** Orthogonal multipolar: share of the scars within that angle. */
export const ORTHOGONAL_SHARE = 0.75;
/** Wide / narrow: the shorter of the two other sides over the thickness must reach this, else unclear. */
export const WIDE_RATIO = 1.25;
/** Placing a scar: the normal across the arrow shorter than this falls back to the end's normal. */
export const MIN_NORMAL_ACROSS = 0.2;

export const CONFIG_THRESHOLDS = {
  centripetalShare: CENTRIPETAL_SHARE,
  centripetalCos: CENTRIPETAL_COS,
  orthogonalToleranceDeg: ORTHOGONAL_TOLERANCE_DEG,
  orthogonalShare: ORTHOGONAL_SHARE,
  wideRatio: WIDE_RATIO,
  minNormalAcross: MIN_NORMAL_ACROSS,
};

/**
 * The box of the model: three axes (the specimen frame's X, Y, Z, or the
 * principal axes: Y the first, Z the third, X = Y × Z) and the range of the
 * vertices along each (dot products with original coordinates).
 */
export interface ConfigBox {
  frame: 'specimen' | 'principal';
  axes: [Vec3, Vec3, Vec3];
  min: Vec3;
  max: Vec3;
}

/** Each face: the box axis across it (0 X, 1 Y, 2 Z) and its side (+1 at the maximum, −1 at the minimum). */
export const FACE_AXIS: Readonly<Record<ConfigFace, readonly [number, 1 | -1]>> = {
  front: [2, 1],
  back: [2, -1],
  left: [0, -1],
  right: [0, 1],
  top: [1, 1],
  bottom: [1, -1],
};

export const sameAxis = (f: ConfigFace, g: ConfigFace): boolean => FACE_AXIS[f][0] === FACE_AXIS[g][0];

/** The four faces next to `f`, in face order. */
export const adjacentFaces = (f: ConfigFace): ConfigFace[] => CONFIG_FACES.filter((g) => !sameAxis(f, g));

/** The key of a pair of faces in `ConfigCorrections.joins`: in face order, joined by "|". */
export const joinKey = (f: ConfigFace, g: ConfigFace): string => (CONFIG_FACES.indexOf(f) <= CONFIG_FACES.indexOf(g) ? `${f}|${g}` : `${g}|${f}`);

const inFaceOrder = (faces: Iterable<ConfigFace>): ConfigFace[] => {
  const set = new Set(faces);
  return CONFIG_FACES.filter((f) => set.has(f));
};

export const emptyCorrections = (): ConfigCorrections => ({ roles: {}, joins: {}, surfaceType: {}, axis: {}, polarity: null, model: 'box', bicone: { roles: {} } });

/** Corrections stored by face (all but the polarity), which a change of orientation clears. */
export const hasFaceCorrections = (c: Readonly<ConfigCorrections>): boolean =>
  [c.roles, c.joins, c.surfaceType, c.axis].some((o) => Object.keys(o).length > 0);

/** A scar's face and platform, and the flaking surface it is on (null when its face is not one). */
export interface ScarPlacement {
  id: string;
  face: ConfigFace;
  platform: ConfigFace;
  surface: string | null;
}

export interface FaceResult {
  face: ConfigFace;
  autoRole: ConfigRole;
  role: ConfigRole;
  /** Scars on this face. */
  scars: number;
}

/** Two adjacent faces with the flaking role, and whether they are one flaking surface. */
export interface FaceJoin {
  faces: [ConfigFace, ConfigFace];
  auto: boolean;
  joined: boolean;
}

export interface FlakingSurface {
  /** "F1", "F2", … by the first face in face order. */
  id: string;
  faces: ConfigFace[];
  /** The face with most scars (the first in face order when tied). */
  mainFace: ConfigFace;
  /** Platforms its scars were struck from (faces with the platform role), in face order. */
  platforms: ConfigFace[];
  /** One of its faces is a platform of another flaking surface's scars. */
  alsoPlatform: boolean;
  scarIds: string[];
  centripetal: boolean;
  autoType: SurfaceType;
  type: SurfaceType;
  autoAxis: ExploitationAxis;
  axis: ExploitationAxis;
}

export interface ConfigurationResult {
  model: 'box';
  frame: 'specimen' | 'principal';
  axes: [Vec3, Vec3, Vec3];
  min: Vec3;
  max: Vec3;
  thresholds: typeof CONFIG_THRESHOLDS;
  scars: ScarPlacement[];
  faces: FaceResult[];
  joins: FaceJoin[];
  surfaces: FlakingSurface[];
  /** Null (as are the three below) without a flaking surface. */
  facialCharacter: FacialCharacter | null;
  flakingSurfaceRelation: FaceRelation | null;
  platformRelation: PlatformRelation | null;
  autoPolarity: Polarity | null;
  polarity: Polarity | null;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A point or direction in box coordinates. */
const local = (box: ConfigBox, p: Vec3): Vec3 => [dot(p, box.axes[0]), dot(p, box.axes[1]), dot(p, box.axes[2])];

/** The two box axes in face `f`. */
const inPlane = (f: ConfigFace): [number, number] => {
  const a = FACE_AXIS[f][0];
  return [(a + 1) % 3, (a + 2) % 3];
};

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0];
};

/** `n` without its component along the unit direction `d`. */
const across = (n: Vec3, d: Vec3): Vec3 => {
  const k = dot(n, d);
  return [n[0] - k * d[0], n[1] - k * d[1], n[2] - k * d[2]];
};

/**
 * The face a scar is on and its platform. The face: the two normals averaged,
 * without their component along the arrow (a scar runs in its own face, so that
 * component says nothing about the face, and the start's normal, tilted toward
 * the platform at the edge, no longer pulls the scar onto it), nearest a face's
 * outward direction; when little is left, the end's normal across the arrow, else
 * the end's normal. The platform: of the four faces next to it, the one whose
 * outward direction is nearest the arrow's reverse (wherever its start is).
 * Ties go to the first in face order.
 */
export function placeScar(v: ScarVector, box: ConfigBox): { face: ConfigFace; platform: ConfigFace } {
  const d = local(box, unit([v.end[0] - v.start[0], v.end[1] - v.start[1], v.end[2] - v.start[2]]));
  const sum = [v.startNormal[0] + v.endNormal[0], v.startNormal[1] + v.endNormal[1], v.startNormal[2] + v.endNormal[2]] as Vec3;
  const end = local(box, unit(v.endNormal));
  let n = across(local(box, unit(Math.hypot(...sum) > 1e-12 ? sum : v.startNormal)), d);
  if (Math.hypot(...n) < MIN_NORMAL_ACROSS) n = across(end, d);
  if (Math.hypot(...n) < MIN_NORMAL_ACROSS) n = end;
  let face: ConfigFace = CONFIG_FACES[0];
  let best = -Infinity;
  for (const f of CONFIG_FACES) {
    const [a, side] = FACE_AXIS[f];
    if (side * n[a] > best) [face, best] = [f, side * n[a]];
  }
  let platform: ConfigFace = adjacentFaces(face)[0];
  best = -Infinity;
  for (const g of adjacentFaces(face)) {
    const [a, side] = FACE_AXIS[g];
    if (-side * d[a] > best) [platform, best] = [g, -side * d[a]];
  }
  return { face, platform };
}

/** Opposite when every pair of faces is on one axis, adjacent when none is, else mixed; null for fewer than two. */
export function faceRelation(faces: readonly ConfigFace[]): FaceRelation | null {
  if (faces.length < 2) return null;
  let opposite = 0, adjacent = 0;
  for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) sameAxis(faces[i], faces[j]) ? opposite++ : adjacent++;
  return adjacent === 0 ? 'opposite' : opposite === 0 ? 'adjacent' : 'mixed';
}

/** A scar's direction in its face (the two in-face components). */
const direction2 = (box: ConfigBox, v: ScarVector, f: ConfigFace): [number, number] => {
  const d = local(box, [v.end[0] - v.start[0], v.end[1] - v.start[1], v.end[2] - v.start[2]]);
  const [u, w] = inPlane(f);
  return [d[u], d[w]];
};

/** The scar points to the centre of its face (in the face, within the cosine threshold). */
function towardCentre(box: ConfigBox, v: ScarVector, f: ConfigFace): boolean {
  const [u, w] = inPlane(f);
  const p = local(box, v.start);
  const c = [(box.min[u] + box.max[u]) / 2 - p[u], (box.min[w] + box.max[w]) / 2 - p[w]];
  const d = direction2(box, v, f);
  const len = Math.hypot(d[0], d[1]) * Math.hypot(c[0], c[1]);
  return len > 0 && (d[0] * c[0] + d[1] * c[1]) / len > CENTRIPETAL_COS;
}

/** The scar runs (in its face) within the tolerance of a box axis. */
function alongAxis(box: ConfigBox, v: ScarVector, f: ConfigFace): boolean {
  const [a, b] = direction2(box, v, f).map(Math.abs);
  if (a === 0 && b === 0) return false;
  return (Math.atan2(Math.min(a, b), Math.max(a, b)) * 180) / Math.PI <= ORTHOGONAL_TOLERANCE_DEG;
}

const isPlatformRole = (r: ConfigRole) => r === 'platform' || r === 'both';
const isFlakingRole = (r: ConfigRole) => r === 'flaking' || r === 'both';

/**
 * The volumetric configuration from the scars with an arrow, the manual
 * corrections and the box; null without a box or without arrows.
 */
export function computeConfiguration(scars: readonly Scar[], corrections: Readonly<ConfigCorrections>, box: ConfigBox | null): ConfigurationResult | null {
  const arrows = scars.filter(hasVector);
  if (!box || !arrows.length) return null;
  const placed = arrows.map((s) => ({ scar: s, ...placeScar(s.vector, box) }));

  // roles: a face with scars is a flaking surface, a face the scars of flaking
  // surfaces were struck from a platform. Which faces are flaking surfaces comes
  // first, with the corrections, so that the scars of a face set as a platform by
  // hand make no platforms
  const count = new Map<ConfigFace, number>(CONFIG_FACES.map((f) => [f, 0]));
  for (const p of placed) count.set(p.face, count.get(p.face)! + 1);
  const flaking = (f: ConfigFace) => {
    const fix = corrections.roles[f];
    return fix ? isFlakingRole(fix) : count.get(f)! > 0;
  };
  const struckFrom = new Set(placed.filter((p) => flaking(p.face)).map((p) => p.platform));
  const faces: FaceResult[] = CONFIG_FACES.map((f) => {
    const scarred = count.get(f)! > 0, platform = struckFrom.has(f);
    const autoRole: ConfigRole = scarred && platform ? 'both' : scarred ? 'flaking' : platform ? 'platform' : 'none';
    return { face: f, autoRole, role: corrections.roles[f] ?? autoRole, scars: count.get(f)! };
  });
  const role = new Map(faces.map((r) => [r.face, r.role]));
  const platformFaces = CONFIG_FACES.filter((f) => isPlatformRole(role.get(f)!));
  const flakingFaces = CONFIG_FACES.filter((f) => isFlakingRole(role.get(f)!));
  /** Platforms (with the platform role) of the scars on a face. */
  const platformsOf = (f: ConfigFace) => new Set(placed.filter((p) => p.face === f && isPlatformRole(role.get(p.platform)!)).map((p) => p.platform));

  // adjacent flaking faces worked from one platform are one surface (flaking around the core)
  const joins: FaceJoin[] = [];
  for (let i = 0; i < flakingFaces.length; i++)
    for (let j = i + 1; j < flakingFaces.length; j++) {
      const [f, g] = [flakingFaces[i], flakingFaces[j]];
      if (sameAxis(f, g)) continue;
      const pg = platformsOf(g);
      const auto = [...platformsOf(f)].some((p) => pg.has(p));
      joins.push({ faces: [f, g], auto, joined: corrections.joins[joinKey(f, g)] ?? auto });
    }
  const parent = new Map<ConfigFace, ConfigFace>(flakingFaces.map((f) => [f, f]));
  const root = (f: ConfigFace): ConfigFace => (parent.get(f) === f ? f : root(parent.get(f)!));
  for (const j of joins) if (j.joined) parent.set(root(j.faces[1]), root(j.faces[0]));
  const groups = new Map<ConfigFace, ConfigFace[]>();
  for (const f of flakingFaces) groups.set(root(f), [...(groups.get(root(f)) ?? []), f]);

  const thick = [0, 1, 2].reduce((a, k) => (box.max[k] - box.min[k] < box.max[a] - box.min[a] ? k : a), 0);
  const size = (k: number) => box.max[k] - box.min[k];
  const others = [0, 1, 2].filter((k) => k !== thick);
  const even = Math.min(...others.map(size)) / size(thick) < WIDE_RATIO;

  const surfaces: FlakingSurface[] = [...groups.values()]
    .sort((a, b) => CONFIG_FACES.indexOf(a[0]) - CONFIG_FACES.indexOf(b[0]))
    .map((fs, i) => {
      const on = placed.filter((p) => fs.includes(p.face));
      const mainFace = fs.reduce((m, f) => (count.get(f)! > count.get(m)! ? f : m), fs[0]);
      const platforms = inFaceOrder(on.map((p) => p.platform).filter((p) => isPlatformRole(role.get(p)!)));
      const centripetal =
        fs.length === 1 && platforms.length >= 3 && on.length > 0 && on.filter((p) => towardCentre(box, p.scar.vector, p.face)).length / on.length >= CENTRIPETAL_SHARE;
      const autoType: SurfaceType = even ? 'unclear' : FACE_AXIS[mainFace][0] === thick ? 'wide' : 'narrow';
      let autoAxis: ExploitationAxis = 'na';
      const a = platforms.length ? FACE_AXIS[platforms[0]][0] : -1;
      if (!centripetal && a >= 0 && platforms.every((p) => FACE_AXIS[p][0] === a) && a !== FACE_AXIS[mainFace][0]) {
        const b = 3 - a - FACE_AXIS[mainFace][0];
        autoAxis = size(a) >= size(b) ? 'long' : 'short';
      }
      const typeFix = fs.map((f) => corrections.surfaceType[f]).find((x) => x !== undefined);
      const axisFix = fs.map((f) => corrections.axis[f]).find((x) => x !== undefined);
      return { id: `F${i + 1}`, faces: fs, mainFace, platforms, alsoPlatform: false, scarIds: on.map((p) => p.scar.id), centripetal, autoType, type: typeFix ?? autoType, autoAxis, axis: axisFix ?? autoAxis };
    });
  for (const s of surfaces) s.alsoPlatform = surfaces.some((o) => o !== s && o.platforms.some((p) => s.faces.includes(p)));

  const surfaceOf = new Map(surfaces.flatMap((s) => s.faces.map((f) => [f, s.id] as const)));
  const n = surfaces.length;
  let facialCharacter: FacialCharacter | null = null;
  let flakingSurfaceRelation: FaceRelation | null = null;
  let platformRelation: PlatformRelation | null = null;
  let autoPolarity: Polarity | null = null;
  if (n) {
    facialCharacter = n === 1 ? 'unifacial' : n === 2 ? 'bifacial' : 'multifacial';
    flakingSurfaceRelation = faceRelation(surfaces.map((s) => s.mainFace));
    platformRelation = surfaces.some((s) => s.platforms.length >= 3) ? 'peripheral' : platformFaces.length === 1 ? 'single' : faceRelation(platformFaces);
    const used = inFaceOrder(surfaces.flatMap((s) => s.platforms));
    if (used.length === 1) autoPolarity = 'unipolar_longitudinal';
    else if (used.length === 2) autoPolarity = sameAxis(used[0], used[1]) ? 'bipolar_opposed' : 'bipolar_orthogonal';
    else if (used.length >= 3) {
      const worked = placed.filter((p) => surfaceOf.has(p.face));
      const aligned = worked.filter((p) => alongAxis(box, p.scar.vector, p.face)).length;
      autoPolarity = surfaces.some((s) => s.centripetal)
        ? 'multipolar_centripetal'
        : worked.length && aligned / worked.length >= ORTHOGONAL_SHARE
          ? 'multipolar_orthogonal'
          : 'multipolar_multidirectional';
    }
  }
  return {
    model: 'box',
    frame: box.frame,
    axes: box.axes.map((a) => [...a]) as [Vec3, Vec3, Vec3],
    min: [...box.min],
    max: [...box.max],
    thresholds: { ...CONFIG_THRESHOLDS },
    scars: placed.map((p) => ({ id: p.scar.id, face: p.face, platform: p.platform, surface: surfaceOf.get(p.face) ?? null })),
    faces,
    joins,
    surfaces,
    facialCharacter,
    flakingSurfaceRelation,
    platformRelation,
    autoPolarity,
    polarity: n ? corrections.polarity ?? autoPolarity : null,
  };
}

/** The box stored with a configuration result (e.g. in a project file), or null. */
export function storedBox(v: unknown): ConfigBox | null {
  const c = v as Partial<ConfigurationResult> | null | undefined;
  const isVec = (x: unknown) => Array.isArray(x) && x.length === 3 && x.every((y) => typeof y === 'number' && Number.isFinite(y));
  if (!c || (c.frame !== 'specimen' && c.frame !== 'principal') || !Array.isArray(c.axes) || c.axes.length !== 3 || !c.axes.every(isVec) || !isVec(c.min) || !isVec(c.max)) return null;
  return { frame: c.frame, axes: c.axes as ConfigBox['axes'], min: c.min as Vec3, max: c.max as Vec3 };
}

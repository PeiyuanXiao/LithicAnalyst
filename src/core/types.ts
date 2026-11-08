/**
 * Core data model. Nothing in src/core depends on the DOM or on three.js, so
 * the model can be tested headless and reused by other front ends later.
 *
 * Coordinate rule: every coordinate stored here is in the ORIGINAL coordinate
 * system of the imported mesh file. Display offsets and camera transforms never
 * touch stored coordinates.
 */

import type { BiconeRole, BiconeSide, ConfigFace, ConfigModel, ConfigRole, Polarity, SpecimenType } from './fields';

export type Vec3 = [number, number, number];

/** Interface text: English and Chinese always; further languages (ui/i18n.ts LANGS) where translated, English standing in. */
export interface LocalizedText {
  en: string;
  zh: string;
  [lang: string]: string | undefined;
}

export type MeshFormat = 'ply' | 'stl' | 'obj';

export interface MeshInfo {
  fileName: string;
  format: MeshFormat;
  /** Size of the source file in bytes. */
  fileSize: number;
  /** SHA-256 of the source file bytes, hex. Binds annotations to one exact mesh. */
  sha256: string;
  vertexCount: number;
  triangleCount: number;
  bboxMin: Vec3;
  bboxMax: Vec3;
}

/**
 * Orientation of the specimen for display and length/width/thickness: a
 * row-major 4×4 matrix taking original coordinates to specimen coordinates
 * (+Z toward the viewer of the main face, +Y up on the page, +X right).
 * Metadata only: stored coordinates are never transformed.
 */
export interface SpecimenFrame {
  matrix: number[];
  /** How the frame was set, e.g. "plane:P1" or "view". */
  source: string;
}

export interface SpecimenInfo {
  id: string;
  /** The observer. One project file = one annotator's annotation of one mesh. */
  annotator: string;
  /** Unit of the mesh coordinates as stated by the user. Coordinates are never rescaled. */
  unit: string;
  notes: string;
  frame: SpecimenFrame | null;
  /** What the specimen is: decides which tools, panels and exports it has. */
  type: SpecimenType;
}

export type AttributeValue = string | number | boolean | null;

/** A flake scar direction: an ordered pair of surface points, origin → termination. */
export interface ScarVector {
  /** Origin of the removal (point-of-percussion side), on the mesh surface. */
  start: Vec3;
  /** Termination of the removal, on the mesh surface. */
  end: Vec3;
  /** Unit surface normal at start (display aid; also useful for later analysis). */
  startNormal: Vec3;
  /** Unit surface normal at end. */
  endNormal: Vec3;
}

/**
 * A flake scar. It may carry a direction arrow (`vector`); a scar known only
 * by its surface area, whose direction cannot be read, has `vector = null`.
 */
export interface Scar {
  /** Stable unique id (UUID). Never reused. */
  id: string;
  /** Human-readable label such as "S1". Editable; not required to be unique. */
  label: string;
  vector: ScarVector | null;
  /** Values for the fields in SCAR_FIELDS (src/core/fields.ts). */
  attributes: Record<string, AttributeValue>;
  createdAt: string;
  modifiedAt: string;
}

/** A scar that has a direction arrow. */
export type ScarWithVector = Scar & { vector: ScarVector };

export const hasVector = (s: Scar): s is ScarWithVector => s.vector !== null;

/**
 * A curve traced on the surface (an edge, a ridge, a scar outline …). Every
 * point lies on the surface; between two anchors the line follows the ridge
 * or valley it was snapped to, or the shortest way.
 */
export interface Curve {
  /** Stable unique id (UUID). Never reused. */
  id: string;
  /** Human-readable label such as "C1". Editable; not required to be unique. */
  label: string;
  /** Points placed by the user (after snapping), in drawing order. */
  anchors: Vec3[];
  /** The traced polyline through all anchors, in order. */
  points: Vec3[];
  /** For each anchor, its index in `points`. */
  anchorIndex: number[];
  /** The last point connects back to the first (which is not repeated). */
  closed: boolean;
  /** The part of the loop filled in automatically ("Complete loop"); absent when there is none. */
  completion?: CurveCompletion;
  /** Measure its edge angles; absent: as its type says (edgeAngleByDefault). */
  edgeAngle?: boolean;
  /** A retouch curve with both ends on an edge: which side of it its region is on. Absent: the smaller; `off`: it has none. */
  retouchSide?: 'larger' | 'off';
  /** Values for the fields in CURVE_FIELDS (src/core/fields.ts). */
  attributes: Record<string, AttributeValue>;
  createdAt: string;
  modifiedAt: string;
}

/**
 * How an open curve was completed into a loop along the edge of the model: the
 * anchors from `firstAutoAnchor` on were placed automatically: the outline seen
 * along the normal of the curve's plane was sampled every `stepDeg` degrees, and
 * about one sample per `anchorStepDeg` degrees kept as an anchor (more where the
 * line would otherwise leave the outline). An automatic anchor the user moves is
 * listed in `userAnchors`; once every one of them is, the completion is dropped.
 */
export interface CurveCompletion {
  method: 'outline';
  firstAutoAnchor: number;
  stepDeg: number;
  /** Absent in curves completed before anchors were thinned (an anchor per sample). */
  anchorStepDeg?: number;
  /** Automatic anchors since moved by the user (indices into `anchors`, ascending). */
  userAnchors?: number[];
}

export type MeasureType = 'distance' | 'geodesic' | 'angle';

/** A manual measurement: a straight distance, a distance along the surface, or an angle. */
export interface Measurement {
  /** Stable unique id (UUID). Never reused. */
  id: string;
  /** Human-readable label such as "M1". */
  label: string;
  type: MeasureType;
  /** Picked surface points: two (distance, geodesic) or three (angle; the vertex is the middle one). */
  points: Vec3[];
  /** Geodesic only: the traced path from the first point to the second, on the surface. */
  path: Vec3[] | null;
  createdAt: string;
  modifiedAt: string;
}

export type PlaneMethod = 'all_vertices' | 'scar_directions' | 'scar_starts' | 'curves' | 'region';

/**
 * A fitted plane. Only its inputs are stored here; the plane itself is
 * derived from them (core/planes.ts) and recomputed whenever they change.
 */
export interface Plane {
  /** Stable unique id (UUID). Never reused. */
  id: string;
  /** "P1", "P2", … */
  label: string;
  method: PlaneMethod;
  /** scar_starts: completeness codes left out (none by default). */
  excludeCompleteness: string[];
  /** curves: the curves used. */
  curveIds: string[];
  /** region: the surface regions used. */
  regionIds: string[];
  /** The normal is taken on the side of this direction (toward the viewer when created; flipping negates it). */
  upHint: Vec3;
  visible: boolean;
  createdAt: string;
  modifiedAt: string;
}

/**
 * A section for display (no measurements come from it): the plane through a
 * line drawn on screen and the view direction.
 */
export interface Section {
  id: string;
  /** "X1", "X2", … */
  label: string;
  /** A point on the plane (original coordinates) and its unit normal. */
  point: Vec3;
  normal: Vec3;
  /** In-plane direction of the drawn line: the horizontal of the section drawing. */
  across: Vec3;
  /** Which part of the model stays in the 3D view: all of it, the side the normal points to, or the other. */
  keep: 'both' | 'front' | 'back';
  fill: 'solid' | 'hatch';
  /** Add the section drawing to the figure (to the right of the views). */
  inFigure: boolean;
  createdAt: string;
  modifiedAt: string;
}

export type RegionCode = 'scar' | 'cortex' | 'joint' | 'damage' | 'flaking_surface' | 'platform' | 'ventral' | 'dorsal' | 'retouch';
/** One of the codes, or the user's own text. */
export type RegionType = RegionCode | (string & {});

/**
 * A surface region, stored as a seed: the clicked surface point and its type.
 * The region itself is the piece of surface, bounded by curves, that contains
 * the seed; it is found again whenever the curves change.
 */
export interface Region {
  id: string;
  /** "R1", "R2", … */
  label: string;
  seed: Vec3;
  type: RegionType;
  /** The scar this region belongs to (type scar), or null. */
  scarId: string | null;
  /** The retouch layer (type retouch): 1 is the nearest the edge. */
  retouchLayer?: number;
  /**
   * A part of a flake that follows from other annotations (the seed is not used): the platform is the smaller of the two pieces
   * the platform outline makes, the ventral face the piece under the technical axis, the dorsal face the largest other one, and a
   * retouch region what lies between its curve and the edge. Gone once the user gives it a type.
   */
  auto?: boolean;
  /** The retouch curve a region with `auto` follows. */
  curveId?: string;
  createdAt: string;
  modifiedAt: string;
}

/** "A cuts B" (A is later than B), or "cannot tell", which is kept apart from "not judged yet". */
export type RelationKind = 'a_cuts_b' | 'indeterminate';

/** A stratigraphic relation between two scars (ids). At most one per pair of scars. */
export interface Relation {
  id: string;
  /** The later scar for `a_cuts_b`. */
  a: string;
  b: string;
  kind: RelationKind;
  createdAt: string;
  modifiedAt: string;
}

/** A removal sequence: a group of scars. Sequences are listed earliest first. */
export interface Sequence {
  id: string;
  /** "Q1", "Q2", … Editable. */
  label: string;
  /** Members (a scar is in one sequence at most); earliest first when `ordered`. */
  scarIds: string[];
  /** The order of the members counts. */
  ordered: boolean;
  createdAt: string;
  modifiedAt: string;
}

/**
 * A working edge: a stretch of a curve whose edge angles are measured. Its ends are kept as points and placed on the
 * curve's reference line when used (compute/workingEdge.ts), so they follow the curve when it is changed. Round a closed
 * curve it runs from `start` along the curve to `end`; on an open one it lies between them, in either order.
 */
export interface WorkingEdge {
  /** Stable unique id (UUID). Never reused. */
  id: string;
  /** "E1", "E2", … */
  label: string;
  /** The user's own name; may be empty. */
  name: string;
  curveId: string;
  start: Vec3;
  end: Vec3;
  createdAt: string;
  modifiedAt: string;
}

export type LandmarkCode = 'pop' | 'platform_end';

/** A fixed landmark: a surface point with a free name. The list order is the export order. */
export interface Landmark {
  id: string;
  /** Name or meaning, e.g. "LM1" or "apex". */
  name: string;
  point: Vec3;
  /** A landmark of the flake's own: `pop` (the technical axis's start, locked), `platform_end`. Only flakes show them. */
  code?: LandmarkCode;
  /** A platform end that follows the curves: where the edge meets the platform outline. Moved by hand, it stays where it was put. */
  auto?: true;
  createdAt: string;
  modifiedAt: string;
}

/**
 * Curve semilandmarks: `count` points at equal arc length along a curve,
 * between two fixed landmarks when given (their nearest points on the curve).
 * Only the inputs are stored; the points are derived and follow the curve.
 */
export interface SemilandmarkSet {
  id: string;
  /** "SL1", "SL2", … */
  label: string;
  curveId: string;
  count: number;
  startLandmarkId: string | null;
  endLandmarkId: string | null;
  createdAt: string;
  modifiedAt: string;
}

/**
 * Manual corrections to the volumetric configuration (compute/configuration.ts);
 * the configuration itself is derived. Keys are face codes; a join's key is two
 * face codes in face order joined by "|" (e.g. "front|right"). The faces follow
 * the box's orientation, so a change of the specimen frame clears all but the polarity.
 */
export interface ConfigCorrections {
  roles: Partial<Record<ConfigFace, ConfigRole>>;
  joins: Record<string, boolean>;
  surfaceType: Partial<Record<ConfigFace, 'wide' | 'narrow'>>;
  axis: Partial<Record<ConfigFace, 'long' | 'short'>>;
  polarity: Polarity | null;
  /** The model: the box (default) or the bicone on the split curve. */
  model: ConfigModel;
  /** The bicone's corrections by physical side (they stay with their side when upper and lower are swapped). */
  bicone: { roles: Partial<Record<BiconeSide, BiconeRole>> };
}

/**
 * The technical axis of a flake: an arrow on the ventral face from the point of percussion
 * toward the distal end. Its frame (matrix, see compute/technicalFrame.ts) is kept with it,
 * since the mesh does not change; `failure` says why there is none.
 */
export interface TechnicalAxis {
  id: string;
  start: Vec3;
  end: Vec3;
  startNormal: Vec3;
  endNormal: Vec3;
  matrix: number[] | null;
  failure: 'short' | 'few' | null;
  createdAt: string;
  modifiedAt: string;
}

/** Which frame the retouch indices are laid out on: the technical axis when there is one (`auto`), or as chosen. */
export const RETOUCH_AXES = ['auto', 'technical', 'longest'] as const;
export type RetouchAxisChoice = (typeof RETOUCH_AXES)[number];

/** A specimen's settings of the retouch indices. */
export interface RetouchSettings {
  /** The length of section the original surface lines are fitted to, in mm; null: the default. */
  fitLength: number | null;
  axis: RetouchAxisChoice;
  /** The longest axis the other way round: the two ends exchanged. */
  flip: boolean;
}

export const defaultRetouchSettings = (): RetouchSettings => ({ fitLength: null, axis: 'auto', flip: false });

/** A flake's own data; kept when the specimen is switched to a core, and shown again when it is switched back. */
export interface FlakeData {
  axis: TechnicalAxis | null;
  /** The specimen frame of the type not in use (each type keeps its own orientation). */
  otherFrame: SpecimenFrame | null;
  /** The settings of the retouch indices; absent while they are the default (a file always has them). */
  retouch?: RetouchSettings;
}

/** A flake's settings of the retouch indices. */
export const retouchSettingsOf = (flake: Pick<FlakeData, 'retouch'>): RetouchSettings => flake.retouch ?? defaultRetouchSettings();

/** What counts as the sharp part of an edge: the stations at most `threshold` degrees in one series of the edge angles (`distance` in mm). The threshold is the user's: null until set. */
export interface SharpEdgeRule {
  method: 'three_points' | 'two_lines';
  distance: number;
  threshold: number | null;
}

export const DEFAULT_SHARP_EDGE: SharpEdgeRule = { method: 'three_points', distance: 2, threshold: null };

/** A curve of semilandmarks: how many points, both its ends among them. */
export interface GmCurveItem {
  on: boolean;
  points: number;
}

/** A grid of surface semilandmarks. */
export interface GmGridItem {
  on: boolean;
  rows: number;
  cols: number;
}

/** The version of the configuration's own layout, kept in it. */
export const GM_CONFIG_VERSION = 2;

/** A fixed landmark of a list: by its name on each specimen. */
export interface GmLandmarkItem {
  name: string;
}

/**
 * Curve semilandmarks of a list: the one curve of this type, `count` points at equal arc length, both ends among them. Open: between the points nearest
 * the landmarks `start` and `end`. Closed: from the point nearest `start`, the way that reaches `via` first, once round (`count` holds the start twice, as a single point).
 */
export type GmCurveListItem = { curveType: string; count: number; start: string; end: string; closed?: false } | { curveType: string; count: number; closed: true; start: string; via: string };

/** Surface semilandmarks of a list: `count` points on the one region of this type. */
export interface GmPatchItem {
  regionType: string;
  count: number;
}

/** A point laid on the template: its triangle (in the app's order of the model) and place in it, and where that is. */
export interface GmTemplatePoint {
  face: number;
  bary: [number, number, number];
  point: Vec3;
}

/** The points laid on the template, per patch, and what they were laid from; what they are passed on with. */
export interface GmTemplate {
  /** Its model: the path in the folder, else the file's name. */
  file: string;
  /** The model's checksum, which tells the template when it is open. */
  sha256: string;
  seed: number;
  /** In the order of the patches. */
  patches: Array<{ regionType: string; points: GmTemplatePoint[] }>;
  /** The anchors the points go with, in the order of the configuration. */
  anchors: Vec3[];
  /** Of the template's own annotations when it was laid: a change shows against these. */
  anchorsHash: string;
  regionsHash: string;
}

/**
 * Which points a specimen has for geometric morphometrics. In a folder, the folder's own: every model has the same. A flake goes by its items, a core or a generic
 * specimen by the lists; a flake's surfaces by the grid or, as they do, by the patches and the template.
 */
export interface GmConfig {
  version: number;
  fixed: { pop: boolean; platform_left: boolean; platform_right: boolean };
  edge: GmCurveItem;
  /** Each of its three stretches. */
  platformOutline: GmCurveItem;
  ventral: GmGridItem;
  dorsal: GmGridItem;
  platform: GmGridItem;
  surfaceMethod: 'grid' | 'template';
  landmarks: GmLandmarkItem[];
  curves: GmCurveListItem[];
  patches: GmPatchItem[];
  template: GmTemplate | null;
}

export const defaultGmConfig = (): GmConfig => ({
  version: GM_CONFIG_VERSION,
  fixed: { pop: true, platform_left: true, platform_right: true },
  edge: { on: true, points: 50 },
  platformOutline: { on: true, points: 10 },
  ventral: { on: true, rows: 15, cols: 10 },
  dorsal: { on: true, rows: 15, cols: 10 },
  platform: { on: true, rows: 4, cols: 8 },
  surfaceMethod: 'grid',
  landmarks: [],
  curves: [],
  patches: [],
  template: null,
});

export interface ProjectState {
  specimen: SpecimenInfo;
  mesh: MeshInfo | null;
  scars: Scar[];
  curves: Curve[];
  /** Working edges, on the curves whose edge angles are measured. */
  workingEdges: WorkingEdge[];
  measurements: Measurement[];
  planes: Plane[];
  sections: Section[];
  regions: Region[];
  relations: Relation[];
  /** Earliest first. */
  sequences: Sequence[];
  /** In export order. */
  landmarks: Landmark[];
  semilandmarks: SemilandmarkSet[];
  /** Sphere fitted to the cortex: cortex regions left out, and whether the sphere is drawn. */
  nodule: { exclude: string[]; show: boolean };
  /**
   * Upper / lower volume split: by a fitted plane (upper = its normal's side)
   * or a closed curve (upper = the side its fitted plane's normal points to,
   * oriented by `upHint`). `swap` exchanges upper and lower. Null when not used.
   */
  split: { source: 'plane' | 'curve'; id: string; upHint: Vec3; swap: boolean } | null;
  /** Manual corrections to the volumetric configuration (none by default). */
  configuration: ConfigCorrections;
  flake: FlakeData;
  /** In a folder, the folder's own: every model of it is judged alike. */
  sharpEdge: SharpEdgeRule;
  gm: GmConfig;
  /** Next number used for automatic scar labels (S1, S2, …). Never decreases except by undo. */
  nextLabelNumber: number;
  /** Next number used for automatic curve labels (C1, C2, …). */
  nextCurveNumber: number;
  /** Next number used for working edge labels (E1, E2, …). */
  nextWorkingEdgeNumber: number;
  /** Next number used for measurement labels (M1, M2, …). */
  nextMeasureNumber: number;
  /** Next number used for plane labels (P1, P2, …). */
  nextPlaneNumber: number;
  /** Next number used for section labels (X1, X2, …). */
  nextSectionNumber: number;
  /** Next number used for region labels (R1, R2, …). */
  nextRegionNumber: number;
  /** Next number used for sequence labels (Q1, Q2, …). */
  nextSequenceNumber: number;
  /** Next number used for default landmark names (LM1, LM2, …). */
  nextLandmarkNumber: number;
  /** Next number used for semilandmark set labels (SL1, SL2, …). */
  nextSemilandmarkNumber: number;
  createdAt: string;
  modifiedAt: string;
}

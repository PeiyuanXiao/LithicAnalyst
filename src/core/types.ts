/**
 * Core data model. Nothing in src/core depends on the DOM or on three.js, so
 * the model can be tested headless and reused by other front ends later.
 *
 * Coordinate rule: every coordinate stored here is in the ORIGINAL coordinate
 * system of the imported mesh file. Display offsets and camera transforms never
 * touch stored coordinates.
 */

export type Vec3 = [number, number, number];

export interface LocalizedText {
  en: string;
  zh: string;
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
  /** Values for the fields in CURVE_FIELDS (src/core/fields.ts). */
  attributes: Record<string, AttributeValue>;
  createdAt: string;
  modifiedAt: string;
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

export type PlaneMethod = 'all_vertices' | 'scar_directions' | 'scar_starts' | 'curves';

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

export interface ProjectState {
  specimen: SpecimenInfo;
  mesh: MeshInfo | null;
  scars: Scar[];
  curves: Curve[];
  measurements: Measurement[];
  planes: Plane[];
  sections: Section[];
  /** Next number used for automatic scar labels (S1, S2, …). Never decreases except by undo. */
  nextLabelNumber: number;
  /** Next number used for automatic curve labels (C1, C2, …). */
  nextCurveNumber: number;
  /** Next number used for measurement labels (M1, M2, …). */
  nextMeasureNumber: number;
  /** Next number used for plane labels (P1, P2, …). */
  nextPlaneNumber: number;
  /** Next number used for section labels (X1, X2, …). */
  nextSectionNumber: number;
  createdAt: string;
  modifiedAt: string;
}

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

export interface ProjectState {
  specimen: SpecimenInfo;
  mesh: MeshInfo | null;
  scars: Scar[];
  curves: Curve[];
  /** Next number used for automatic scar labels (S1, S2, …). Never decreases except by undo. */
  nextLabelNumber: number;
  /** Next number used for automatic curve labels (C1, C2, …). */
  nextCurveNumber: number;
  createdAt: string;
  modifiedAt: string;
}

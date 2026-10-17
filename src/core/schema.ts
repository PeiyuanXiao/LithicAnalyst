import { isValidShape } from './curveGeometry';
import { computeDerived, type DerivedResults } from './derived';
import { defaultAttributes, defaultCurveAttributes } from './fields';
import { nowIso, uuid } from './ids';
import type { AttributeValue, Curve, MeshInfo, ProjectState, Scar, ScarVector, SpecimenFrame, SpecimenInfo, Vec3 } from './types';
import { isFiniteVec, normalize } from './vec';

export const PROJECT_FORMAT = 'lithicanalyst-project';
export const PROJECT_FORMAT_VERSION = 2;

/**
 * Project file, format version 2. The format is the long-lived contract of the
 * tool: keep it documented (docs/project-format.md) and add a migration in
 * migrate() whenever PROJECT_FORMAT_VERSION changes. New annotation layers are
 * added next to scars; files without them stay valid.
 */
export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  formatVersion: 2;
  app: { name: string; version: string };
  savedAt: string;
  specimen: SpecimenInfo;
  mesh: MeshInfo | null;
  annotations: { scars: Scar[]; curves: Curve[] };
  /** Latest results computed from the annotations, for external readers; recomputed on reading. */
  derived: DerivedResults;
  nextLabelNumber: number;
  nextCurveNumber: number;
  createdAt: string;
  modifiedAt: string;
}

export function serializeProject(state: Readonly<ProjectState>, appVersion: string): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    formatVersion: PROJECT_FORMAT_VERSION,
    app: { name: 'LithicAnalyst', version: appVersion },
    savedAt: nowIso(),
    specimen: structuredClone(state.specimen),
    mesh: state.mesh ? structuredClone(state.mesh) : null,
    annotations: { scars: structuredClone(state.scars), curves: structuredClone(state.curves) },
    derived: computeDerived(state),
    nextLabelNumber: state.nextLabelNumber,
    nextCurveNumber: state.nextCurveNumber,
    createdAt: state.createdAt,
    modifiedAt: state.modifiedAt,
  };
}

export class ProjectFileError extends Error {}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

/** v1 (0.1.0): annotations.scarVectors held arrows with start/end at the top level. */
function migrateV1(raw: Record<string, unknown>): Record<string, unknown> {
  const ann = (raw.annotations ?? {}) as Record<string, unknown>;
  const list = Array.isArray(ann.scarVectors) ? (ann.scarVectors as unknown[]) : [];
  const scars = list.map((v) => {
    if (!v || typeof v !== 'object') return v;
    const { start, end, startNormal, endNormal, ...rest } = v as Record<string, unknown>;
    return { ...rest, vector: { start, end, startNormal, endNormal } };
  });
  const { scarVectors: _old, ...annotations } = ann;
  return { ...raw, formatVersion: 2, annotations: { ...annotations, scars } };
}

function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  const v = raw.formatVersion;
  if (v === PROJECT_FORMAT_VERSION) return raw;
  if (v === 1) return migrateV1(raw);
  if (typeof v === 'number' && v > PROJECT_FORMAT_VERSION)
    throw new ProjectFileError(
      `This project file was written by a newer version of LithicAnalyst (format ${v}). Please update the app.`,
    );
  throw new ProjectFileError(`Unknown project format version: ${String(v)}.`);
}

function readAttributes(raw: unknown, defaults: Record<string, AttributeValue>): Record<string, AttributeValue> {
  const attrs = { ...defaults };
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) attrs[k] = v as AttributeValue;
    }
  }
  return attrs;
}

function parseVector(raw: unknown, i: number): ScarVector | null {
  if (raw === null || raw === undefined) return null;
  const r = raw as Record<string, unknown>;
  if (typeof raw !== 'object' || !isFiniteVec(r.start) || !isFiniteVec(r.end))
    throw new ProjectFileError(`Scar ${i + 1}: "vector" needs numeric "start" and "end" [x, y, z].`);
  const normalOr = (v: unknown): Vec3 => (isFiniteVec(v) ? normalize(v) : [0, 0, 1]);
  return {
    start: [...(r.start as Vec3)] as Vec3,
    end: [...(r.end as Vec3)] as Vec3,
    startNormal: normalOr(r.startNormal),
    endNormal: normalOr(r.endNormal),
  };
}

function parseScar(raw: unknown, i: number): Scar {
  if (!raw || typeof raw !== 'object') throw new ProjectFileError(`Scar ${i + 1} is not an object.`);
  const r = raw as Record<string, unknown>;
  const t = nowIso();
  return {
    id: str(r.id) || uuid(),
    label: str(r.label, `S${i + 1}`),
    vector: parseVector(r.vector, i),
    attributes: readAttributes(r.attributes, defaultAttributes()),
    createdAt: str(r.createdAt, t),
    modifiedAt: str(r.modifiedAt, t),
  };
}

function parseFrame(raw: unknown): SpecimenFrame | null {
  if (raw === null || raw === undefined) return null;
  const r = raw as Record<string, unknown>;
  const m = r && typeof r === 'object' ? r.matrix : undefined;
  if (!Array.isArray(m) || m.length !== 16 || !m.every((x) => typeof x === 'number' && Number.isFinite(x)))
    throw new ProjectFileError('"specimen.frame.matrix" needs 16 numbers (a row-major 4×4 matrix).');
  return { matrix: [...(m as number[])], source: str(r.source) };
}

function parseCurve(raw: unknown, i: number): Curve {
  if (!raw || typeof raw !== 'object') throw new ProjectFileError(`Curve ${i + 1} is not an object.`);
  const r = raw as Record<string, unknown>;
  const points = Array.isArray(r.points) ? r.points : [];
  if (points.length < 2 || !points.every(isFiniteVec))
    throw new ProjectFileError(`Curve ${i + 1} needs at least two numeric "points" [x, y, z].`);
  const pts = (points as Vec3[]).map((p) => [p[0], p[1], p[2]] as Vec3);
  const closed = r.closed === true;
  let anchors = Array.isArray(r.anchors) && r.anchors.every(isFiniteVec) ? (r.anchors as Vec3[]).map((p) => [p[0], p[1], p[2]] as Vec3) : [];
  let anchorIndex = Array.isArray(r.anchorIndex) ? (r.anchorIndex as unknown[]).map((v) => (typeof v === 'number' ? v : -1)) : [];
  let isClosed = closed;
  if (!isValidShape({ anchors, points: pts, anchorIndex, closed })) {
    // keep the traced line; fall back to its two ends as anchors
    anchors = [pts[0], pts[pts.length - 1]];
    anchorIndex = [0, pts.length - 1];
    isClosed = false;
  }
  const t = nowIso();
  return {
    id: str(r.id) || uuid(),
    label: str(r.label, `C${i + 1}`),
    anchors,
    points: pts,
    anchorIndex,
    closed: isClosed,
    attributes: readAttributes(r.attributes, defaultCurveAttributes()),
    createdAt: str(r.createdAt, t),
    modifiedAt: str(r.modifiedAt, t),
  };
}

const maxLabelNumber = (labels: string[], prefix: string): number =>
  labels.reduce((m, l) => {
    const n = new RegExp(`^${prefix}(\\d+)$`).exec(l);
    return n ? Math.max(m, Number(n[1])) : m;
  }, 0);

const positiveInt = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 1);

/** Parse and validate a project file (already JSON-decoded). */
export function parseProjectFile(input: unknown): ProjectState {
  if (!input || typeof input !== 'object') throw new ProjectFileError('Not a LithicAnalyst project file.');
  const raw0 = input as Record<string, unknown>;
  if (raw0.format !== PROJECT_FORMAT) throw new ProjectFileError('Not a LithicAnalyst project file.');
  const raw = migrate(raw0);
  const ann = raw.annotations as Record<string, unknown> | undefined;
  const list = Array.isArray(ann?.scars) ? (ann!.scars as unknown[]) : [];
  const scars = list.map((v, i) => parseScar(v, i));
  const curveList = Array.isArray(ann?.curves) ? (ann!.curves as unknown[]) : [];
  const curves = curveList.map((c, i) => parseCurve(c, i));
  const sp = (raw.specimen ?? {}) as Record<string, unknown>;
  const specimen: SpecimenInfo = {
    id: str(sp.id),
    annotator: str(sp.annotator),
    unit: str(sp.unit, 'mm'),
    notes: str(sp.notes),
    frame: parseFrame(sp.frame),
  };
  return {
    specimen,
    mesh: (raw.mesh as MeshInfo | null) ?? null,
    scars,
    curves,
    nextLabelNumber: Math.max(positiveInt(raw.nextLabelNumber), maxLabelNumber(scars.map((a) => a.label), 'S') + 1),
    nextCurveNumber: Math.max(positiveInt(raw.nextCurveNumber), maxLabelNumber(curves.map((c) => c.label), 'C') + 1),
    createdAt: str(raw.createdAt, nowIso()),
    modifiedAt: str(raw.modifiedAt, nowIso()),
  };
}

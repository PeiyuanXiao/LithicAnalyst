import { defaultAttributes } from './fields';
import { nowIso, uuid } from './ids';
import type { AttributeValue, MeshInfo, ProjectState, ScarVector, SpecimenInfo, Vec3 } from './types';
import { isFiniteVec, normalize } from './vec';

export const PROJECT_FORMAT = 'lithicanalyst-project';
export const PROJECT_FORMAT_VERSION = 1;

/**
 * Project file, format version 1. The format is the long-lived contract of the
 * tool: keep it documented (docs/project-format.md) and add a migration in
 * migrate() whenever PROJECT_FORMAT_VERSION changes.
 */
export interface ProjectFileV1 {
  format: typeof PROJECT_FORMAT;
  formatVersion: 1;
  app: { name: string; version: string };
  savedAt: string;
  specimen: SpecimenInfo;
  mesh: MeshInfo | null;
  annotations: { scarVectors: ScarVector[] };
  nextLabelNumber: number;
  createdAt: string;
  modifiedAt: string;
}

export function serializeProject(state: Readonly<ProjectState>, appVersion: string): ProjectFileV1 {
  return {
    format: PROJECT_FORMAT,
    formatVersion: PROJECT_FORMAT_VERSION,
    app: { name: 'LithicAnalyst', version: appVersion },
    savedAt: nowIso(),
    specimen: { ...state.specimen },
    mesh: state.mesh ? structuredClone(state.mesh) : null,
    annotations: { scarVectors: structuredClone(state.scarVectors) },
    nextLabelNumber: state.nextLabelNumber,
    createdAt: state.createdAt,
    modifiedAt: state.modifiedAt,
  };
}

export class ProjectFileError extends Error {}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  const v = raw.formatVersion;
  if (v === PROJECT_FORMAT_VERSION) return raw;
  if (typeof v === 'number' && v > PROJECT_FORMAT_VERSION)
    throw new ProjectFileError(
      `This project file was written by a newer version of LithicAnalyst (format ${v}). Please update the app.`,
    );
  throw new ProjectFileError(`Unknown project format version: ${String(v)}.`);
}

function parseVector(raw: unknown, i: number): ScarVector {
  if (!raw || typeof raw !== 'object') throw new ProjectFileError(`Scar vector ${i + 1} is not an object.`);
  const r = raw as Record<string, unknown>;
  if (!isFiniteVec(r.start) || !isFiniteVec(r.end))
    throw new ProjectFileError(`Scar vector ${i + 1} needs numeric "start" and "end" [x, y, z].`);
  const normalOr = (v: unknown): Vec3 => (isFiniteVec(v) ? normalize(v) : [0, 0, 1]);
  const attrs = defaultAttributes();
  if (r.attributes && typeof r.attributes === 'object') {
    for (const [k, v] of Object.entries(r.attributes as Record<string, unknown>)) {
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) attrs[k] = v as AttributeValue;
    }
  }
  const t = nowIso();
  return {
    id: str(r.id) || uuid(),
    label: str(r.label, `S${i + 1}`),
    start: [...(r.start as Vec3)] as Vec3,
    end: [...(r.end as Vec3)] as Vec3,
    startNormal: normalOr(r.startNormal),
    endNormal: normalOr(r.endNormal),
    attributes: attrs,
    createdAt: str(r.createdAt, t),
    modifiedAt: str(r.modifiedAt, t),
  };
}

/** Parse and validate a project file (already JSON-decoded). */
export function parseProjectFile(input: unknown): ProjectState {
  if (!input || typeof input !== 'object') throw new ProjectFileError('Not a LithicAnalyst project file.');
  const raw0 = input as Record<string, unknown>;
  if (raw0.format !== PROJECT_FORMAT) throw new ProjectFileError('Not a LithicAnalyst project file.');
  const raw = migrate(raw0);
  const ann = raw.annotations as Record<string, unknown> | undefined;
  const list = Array.isArray(ann?.scarVectors) ? (ann!.scarVectors as unknown[]) : [];
  const scarVectors = list.map((v, i) => parseVector(v, i));
  const sp = (raw.specimen ?? {}) as Record<string, unknown>;
  const specimen: SpecimenInfo = {
    id: str(sp.id),
    annotator: str(sp.annotator),
    unit: str(sp.unit, 'mm'),
    notes: str(sp.notes),
  };
  const maxNum = scarVectors.reduce((m, a) => {
    const n = /^S(\d+)$/.exec(a.label);
    return n ? Math.max(m, Number(n[1])) : m;
  }, 0);
  const next = typeof raw.nextLabelNumber === 'number' && raw.nextLabelNumber > 0 ? raw.nextLabelNumber : 1;
  return {
    specimen,
    mesh: (raw.mesh as MeshInfo | null) ?? null,
    scarVectors,
    nextLabelNumber: Math.max(next, maxNum + 1),
    createdAt: str(raw.createdAt, nowIso()),
    modifiedAt: str(raw.modifiedAt, nowIso()),
  };
}

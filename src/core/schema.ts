import { EDGE_ANGLE_DISTANCES_MM } from '../compute/edgeAngle';
import { joinKey, sameAxis } from '../compute/configuration';
import { isValidShape } from './curveGeometry';
import { computeDerived, type DerivedResults, type MeshResults } from './derived';
import { BICONE_ROLES, BICONE_SIDES, CONFIG_FACES, CONFIG_MODELS, CONFIG_ROLES, defaultAttributes, defaultCurveAttributes, POLARITIES, SPECIMEN_TYPES, type BiconeRole, type BiconeSide, type ConfigFace } from './fields';
import { MEASURE_POINTS } from './measurements';
import { nowIso, uuid } from './ids';
import { clampFitLength } from '../compute/retouchIndex';
import { GM_TEMPLATE_PARAMETERS } from '../compute/gmTemplate';
import { defaultGmConfig, DEFAULT_SHARP_EDGE, GM_CONFIG_VERSION, RETOUCH_AXES, retouchSettingsOf, type GmConfig, type ImportRecord, type GmCurveListItem, type GmTemplate, type GmTemplatePoint, type AttributeValue, type ConfigCorrections, type Curve, type CurveCompletion, type FlakeData, type Landmark, type Measurement, type MeasureType, type MeshInfo, type Plane, type PlaneMethod, type ProjectState, type Region, type RegionType, type Relation, type RetouchSettings, type Scar, type ScarVector, type Section, type SemilandmarkSet, type Sequence, type SpecimenFrame, type SpecimenInfo, type Vec3, type SharpEdgeRule, type WorkingEdge } from './types';
import { isFiniteVec, normalize } from './vec';

export const PROJECT_FORMAT = 'lithicanalyst-project';
export const PROJECT_FORMAT_VERSION = 3;

/**
 * Project file, format version 3 (3 added `imports`; a file of version 2 reads as one with none). The format is the long-lived contract of the
 * tool: keep it documented (docs/project-format.md) and add a migration in
 * migrate() whenever PROJECT_FORMAT_VERSION changes. New annotation layers are
 * added next to scars; files without them stay valid.
 */
export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  formatVersion: 3;
  app: { name: string; version: string };
  savedAt: string;
  specimen: SpecimenInfo;
  mesh: MeshInfo | null;
  annotations: { scars: Scar[]; curves: Curve[]; measurements: Measurement[]; planes: Plane[]; sections: Section[]; regions: Region[]; relations: Relation[]; sequences: Sequence[]; landmarks: Landmark[]; semilandmarks: SemilandmarkSet[] };
  nodule: ProjectState['nodule'];
  split: ProjectState['split'];
  configuration: ConfigCorrections;
  flake: FlakeData;
  sharpEdge: SharpEdgeRule;
  gm: GmConfig;
  workingEdges: WorkingEdge[];
  /** Annotations imported from other programs' files: one record per import. */
  imports: ImportRecord[];
  /** Latest results computed from the annotations, for external readers; recomputed on reading. */
  derived: DerivedResults;
  nextLabelNumber: number;
  nextCurveNumber: number;
  nextWorkingEdgeNumber: number;
  nextMeasureNumber: number;
  nextPlaneNumber: number;
  nextSectionNumber: number;
  nextRegionNumber: number;
  nextSequenceNumber: number;
  nextLandmarkNumber: number;
  nextSemilandmarkNumber: number;
  createdAt: string;
  modifiedAt: string;
}

/** `mesh`: what the derived results need from the mesh, once it has been measured. */
export function serializeProject(state: Readonly<ProjectState>, appVersion: string, mesh: MeshResults | null = null): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    formatVersion: PROJECT_FORMAT_VERSION,
    app: { name: 'LithicAnalyst', version: appVersion },
    savedAt: nowIso(),
    specimen: structuredClone(state.specimen),
    mesh: state.mesh ? structuredClone(state.mesh) : null,
    annotations: { scars: structuredClone(state.scars), curves: structuredClone(state.curves), measurements: structuredClone(state.measurements), planes: structuredClone(state.planes), sections: structuredClone(state.sections), regions: structuredClone(state.regions), relations: structuredClone(state.relations), sequences: structuredClone(state.sequences), landmarks: structuredClone(state.landmarks), semilandmarks: structuredClone(state.semilandmarks) },
    nodule: structuredClone(state.nodule),
    split: structuredClone(state.split),
    configuration: structuredClone(state.configuration),
    flake: { ...structuredClone(state.flake), retouch: { ...retouchSettingsOf(state.flake) } },
    sharpEdge: { ...state.sharpEdge },
    gm: structuredClone(state.gm),
    workingEdges: structuredClone(state.workingEdges),
    imports: structuredClone(state.imports),
    derived: computeDerived(state, mesh),
    nextLabelNumber: state.nextLabelNumber,
    nextCurveNumber: state.nextCurveNumber,
    nextWorkingEdgeNumber: state.nextWorkingEdgeNumber,
    nextMeasureNumber: state.nextMeasureNumber,
    nextPlaneNumber: state.nextPlaneNumber,
    nextSectionNumber: state.nextSectionNumber,
    nextRegionNumber: state.nextRegionNumber,
    nextSequenceNumber: state.nextSequenceNumber,
    nextLandmarkNumber: state.nextLandmarkNumber,
    nextSemilandmarkNumber: state.nextSemilandmarkNumber,
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

/** v2 → v3: `imports` was added; a file without it has none. */
const migrateV2 = (raw: Record<string, unknown>): Record<string, unknown> => ({ ...raw, formatVersion: 3 });

function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  const v = raw.formatVersion;
  if (v === PROJECT_FORMAT_VERSION) return raw;
  if (v === 2) return migrateV2(raw);
  if (v === 1) return migrateV2(migrateV1(raw));
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
  const completion = isClosed ? parseCompletion(r.completion, anchors.length) : undefined;
  return {
    id: str(r.id) || uuid(),
    label: str(r.label, `C${i + 1}`),
    anchors,
    points: pts,
    anchorIndex,
    closed: isClosed,
    ...(completion ? { completion } : {}),
    ...(typeof r.edgeAngle === 'boolean' ? { edgeAngle: r.edgeAngle } : {}),
    ...(r.retouchSide === 'larger' || r.retouchSide === 'off' ? { retouchSide: r.retouchSide } : {}),
    attributes: readAttributes(r.attributes, defaultCurveAttributes()),
    createdAt: str(r.createdAt, t),
    modifiedAt: str(r.modifiedAt, t),
  };
}

/** The automatic part of a completed loop; dropped when it does not fit the curve's anchors. */
function parseCompletion(raw: unknown, anchorCount: number): CurveCompletion | undefined {
  const k = raw as Record<string, unknown> | null | undefined;
  if (!k || k.method !== 'outline' || typeof k.firstAutoAnchor !== 'number' || !Number.isInteger(k.firstAutoAnchor)) return undefined;
  const first = k.firstAutoAnchor;
  if (first < 1 || first >= anchorCount) return undefined;
  const user = Array.isArray(k.userAnchors) ? [...new Set(k.userAnchors.filter((i): i is number => Number.isInteger(i) && i >= first && i < anchorCount))].sort((a, b) => a - b) : [];
  if (user.length >= anchorCount - first) return undefined;
  const out: CurveCompletion = { method: 'outline', firstAutoAnchor: first, stepDeg: typeof k.stepDeg === 'number' && k.stepDeg > 0 ? k.stepDeg : 2 };
  if (typeof k.anchorStepDeg === 'number' && k.anchorStepDeg > 0) out.anchorStepDeg = k.anchorStepDeg;
  if (user.length) out.userAnchors = user;
  return out;
}

function parseMeasurement(raw: unknown, i: number): Measurement {
  if (!raw || typeof raw !== 'object') throw new ProjectFileError(`Measurement ${i + 1} is not an object.`);
  const r = raw as Record<string, unknown>;
  const type = r.type as MeasureType;
  if (!(typeof type === 'string' && type in MEASURE_POINTS)) throw new ProjectFileError(`Measurement ${i + 1}: unknown type "${String(r.type)}".`);
  const points = Array.isArray(r.points) ? r.points : [];
  if (points.length !== MEASURE_POINTS[type] || !points.every(isFiniteVec))
    throw new ProjectFileError(`Measurement ${i + 1} needs ${MEASURE_POINTS[type]} numeric "points" [x, y, z].`);
  const path = type === 'geodesic' && Array.isArray(r.path) && r.path.length >= 2 && r.path.every(isFiniteVec) ? (r.path as Vec3[]) : null;
  const t = nowIso();
  return {
    id: str(r.id) || uuid(),
    label: str(r.label, `M${i + 1}`),
    type,
    points: (points as Vec3[]).map((p) => [p[0], p[1], p[2]] as Vec3),
    path: path ? path.map((p) => [p[0], p[1], p[2]] as Vec3) : null,
    createdAt: str(r.createdAt, t),
    modifiedAt: str(r.modifiedAt, t),
  };
}

const PLANE_METHODS: PlaneMethod[] = ['all_vertices', 'scar_directions', 'scar_starts', 'curves', 'region'];

function parsePlane(raw: unknown, i: number): Plane {
  if (!raw || typeof raw !== 'object') throw new ProjectFileError(`Plane ${i + 1} is not an object.`);
  const r = raw as Record<string, unknown>;
  const method = r.method as PlaneMethod;
  if (!PLANE_METHODS.includes(method)) throw new ProjectFileError(`Plane ${i + 1}: unknown method "${String(r.method)}".`);
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const t = nowIso();
  return {
    id: str(r.id) || uuid(),
    label: str(r.label, `P${i + 1}`),
    method,
    excludeCompleteness: strings(r.excludeCompleteness),
    curveIds: strings(r.curveIds),
    regionIds: strings(r.regionIds),
    upHint: isFiniteVec(r.upHint) ? [r.upHint[0], r.upHint[1], r.upHint[2]] : [0, 0, 1],
    visible: r.visible !== false,
    createdAt: str(r.createdAt, t),
    modifiedAt: str(r.modifiedAt, t),
  };
}

function parseSection(raw: unknown, i: number): Section {
  if (!raw || typeof raw !== 'object') throw new ProjectFileError(`Section ${i + 1} is not an object.`);
  const r = raw as Record<string, unknown>;
  if (!isFiniteVec(r.point) || !isFiniteVec(r.normal) || !isFiniteVec(r.across))
    throw new ProjectFileError(`Section ${i + 1} needs numeric "point", "normal" and "across" [x, y, z].`);
  const t = nowIso();
  return {
    id: str(r.id) || uuid(),
    label: str(r.label, `X${i + 1}`),
    point: [r.point[0], r.point[1], r.point[2]],
    normal: normalize(r.normal as Vec3),
    across: normalize(r.across as Vec3),
    keep: r.keep === 'front' || r.keep === 'back' ? r.keep : 'both',
    fill: r.fill === 'solid' ? 'solid' : 'hatch',
    inFigure: r.inFigure !== false,
    createdAt: str(r.createdAt, t),
    modifiedAt: str(r.modifiedAt, t),
  };
}

function parseRegion(raw: unknown, i: number): Region {
  if (!raw || typeof raw !== 'object') throw new ProjectFileError(`Region ${i + 1} is not an object.`);
  const r = raw as Record<string, unknown>;
  if (!isFiniteVec(r.seed)) throw new ProjectFileError(`Region ${i + 1} needs a numeric "seed" [x, y, z].`);
  // a value that is no code is the annotator's own text
  const type = r.type as RegionType;
  if (typeof type !== 'string' || !type.trim()) throw new ProjectFileError(`Region ${i + 1} needs a type.`);
  const t = nowIso();
  return {
    id: str(r.id) || uuid(),
    label: str(r.label, `R${i + 1}`),
    seed: [r.seed[0], r.seed[1], r.seed[2]],
    type,
    scarId: typeof r.scarId === 'string' ? r.scarId : null,
    ...(type === 'retouch' ? { retouchLayer: Number.isInteger(r.retouchLayer) && (r.retouchLayer as number) >= 1 ? (r.retouchLayer as number) : 1 } : {}),
    ...(r.auto === true ? { auto: true, ...(typeof r.curveId === 'string' ? { curveId: r.curveId } : {}) } : {}),
    createdAt: str(r.createdAt, t),
    modifiedAt: str(r.modifiedAt, t),
  };
}

/** The rule for a sharp edge (of a project file, or of a folder's file); what is not understood takes its default. */
export function parseSharpEdge(raw: unknown): SharpEdgeRule {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const distance = r.distance as (typeof EDGE_ANGLE_DISTANCES_MM)[number];
  return {
    method: r.method === 'two_lines' ? 'two_lines' : DEFAULT_SHARP_EDGE.method,
    distance: EDGE_ANGLE_DISTANCES_MM.includes(distance) ? distance : DEFAULT_SHARP_EDGE.distance,
    threshold: typeof r.threshold === 'number' && Number.isFinite(r.threshold) ? r.threshold : null,
  };
}

/** The most points asked of one curve or side of a grid. */
const GM_MAX_POINTS = 500;

const parseVec = (v: unknown): Vec3 | null => (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? [v[0], v[1], v[2]] : null);

/** The points laid on a template; null when something in them is not as it should be (they would not go with the anchors). */
function parseGmTemplate(raw: unknown): GmTemplate | null {
  const r = raw as Record<string, unknown> | null | undefined;
  if (!r || typeof r !== 'object' || !Array.isArray(r.patches) || !Array.isArray(r.anchors)) return null;
  const anchors = r.anchors.map(parseVec);
  if (anchors.some((a) => !a)) return null;
  const patches: GmTemplate['patches'] = [];
  for (const p of r.patches as Array<Record<string, unknown>>) {
    if (typeof p?.regionType !== 'string' || !Array.isArray(p.points)) return null;
    const points: GmTemplatePoint[] = [];
    for (const q of p.points as Array<Record<string, unknown>>) {
      const point = parseVec(q?.point), bary = parseVec(q?.bary);
      if (!point || !bary || !Number.isInteger(q.face)) return null;
      points.push({ face: q.face as number, bary, point });
    }
    patches.push({ regionType: p.regionType, points });
  }
  return { file: str(r.file), sha256: str(r.sha256), seed: Number.isInteger(r.seed) ? (r.seed as number) : 1, patches, anchors: anchors as Vec3[], anchorsHash: str(r.anchorsHash), regionsHash: str(r.regionsHash) };
}

/** Which points a specimen has (of a project file, or of a folder's file); what is not understood takes its default. A file from before the lists has none of them, and goes by the grid. */
export function parseGmConfig(raw: unknown): GmConfig {
  const d = defaultGmConfig();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Record<string, unknown> | undefined>;
  const whole = (v: unknown, least: number, fallback: number) => (Number.isInteger(v) && (v as number) >= least && (v as number) <= GM_MAX_POINTS ? (v as number) : fallback);
  const on = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const curve = (key: 'edge' | 'platformOutline') => ({ on: on(r[key]?.on, d[key].on), points: whole(r[key]?.points, 2, d[key].points) });
  const grid = (key: 'ventral' | 'dorsal' | 'platform') => ({ on: on(r[key]?.on, d[key].on), rows: whole(r[key]?.rows, 1, d[key].rows), cols: whole(r[key]?.cols, 1, d[key].cols) });
  const list = (key: string): Array<Record<string, unknown>> => {
    const v = (raw as Record<string, unknown> | null | undefined)?.[key];
    return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [];
  };
  return {
    version: GM_CONFIG_VERSION,
    fixed: { pop: on(r.fixed?.pop, true), platform_left: on(r.fixed?.platform_left, true), platform_right: on(r.fixed?.platform_right, true) },
    edge: curve('edge'),
    platformOutline: curve('platformOutline'),
    ventral: grid('ventral'),
    dorsal: grid('dorsal'),
    platform: grid('platform'),
    surfaceMethod: (raw as Record<string, unknown> | null | undefined)?.surfaceMethod === 'template' ? 'template' : 'grid',
    landmarks: list('landmarks').map((x) => ({ name: str(x.name) })),
    curves: list('curves').map((x): GmCurveListItem => (x.closed === true ? { curveType: str(x.curveType), count: whole(x.count, 3, 20), closed: true, start: str(x.start), via: str(x.via) } : { curveType: str(x.curveType), count: whole(x.count, 2, 20), start: str(x.start), end: str(x.end) })),
    patches: list('patches').map((x) => {
      const n = x.count as number;
      return { regionType: str(x.regionType), count: Number.isInteger(n) && n >= GM_TEMPLATE_PARAMETERS.PATCH_MIN && n <= GM_TEMPLATE_PARAMETERS.PATCH_MAX ? n : GM_TEMPLATE_PARAMETERS.PATCH_DEFAULT };
    }),
    template: parseGmTemplate((raw as Record<string, unknown> | null | undefined)?.template),
  };
}

/** Relations between known scars only; one per pair of scars (the first one is kept). */
function parseRelations(raw: unknown, scarIds: Set<string>): Relation[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: Relation[] = [];
  const pairs = new Set<string>();
  list.forEach((v, i) => {
    if (!v || typeof v !== 'object') throw new ProjectFileError(`Relation ${i + 1} is not an object.`);
    const r = v as Record<string, unknown>;
    if (r.kind !== 'a_cuts_b' && r.kind !== 'indeterminate') throw new ProjectFileError(`Relation ${i + 1}: unknown kind "${String(r.kind)}".`);
    const a = str(r.a), b = str(r.b);
    const pair = [a, b].sort().join('|');
    if (a === b || !scarIds.has(a) || !scarIds.has(b) || pairs.has(pair)) return;
    pairs.add(pair);
    const t = nowIso();
    out.push({ id: str(r.id) || uuid(), a, b, kind: r.kind, createdAt: str(r.createdAt, t), modifiedAt: str(r.modifiedAt, t) });
  });
  return out;
}

/** Sequences with known scars only; a scar in one sequence at most (the first). */
function parseSequences(raw: unknown, scarIds: Set<string>): Sequence[] {
  const list = Array.isArray(raw) ? raw : [];
  const used = new Set<string>();
  return list.map((v, i) => {
    if (!v || typeof v !== 'object') throw new ProjectFileError(`Sequence ${i + 1} is not an object.`);
    const r = v as Record<string, unknown>;
    const ids = (Array.isArray(r.scarIds) ? r.scarIds : []).filter((x): x is string => typeof x === 'string' && scarIds.has(x) && !used.has(x) && !!used.add(x));
    const t = nowIso();
    return { id: str(r.id) || uuid(), label: str(r.label, `Q${i + 1}`), scarIds: ids, ordered: r.ordered === true, createdAt: str(r.createdAt, t), modifiedAt: str(r.modifiedAt, t) };
  });
}

function parseLandmark(raw: unknown, i: number): Landmark {
  if (!raw || typeof raw !== 'object') throw new ProjectFileError(`Landmark ${i + 1} is not an object.`);
  const r = raw as Record<string, unknown>;
  if (!isFiniteVec(r.point)) throw new ProjectFileError(`Landmark ${i + 1} needs a numeric "point" [x, y, z].`);
  const t = nowIso();
  const code: Pick<Landmark, 'code' | 'auto'> = r.code === 'pop' || r.code === 'platform_end' ? { code: r.code, ...(r.code === 'platform_end' && r.auto === true ? { auto: true as const } : {}) } : {};
  return { id: str(r.id) || uuid(), name: str(r.name, `LM${i + 1}`), point: [r.point[0], r.point[1], r.point[2]], ...code, createdAt: str(r.createdAt, t), modifiedAt: str(r.modifiedAt, t) };
}

/** A set whose curve is missing stays (it has no points); references to unknown landmarks are dropped. */
function parseSemilandmarkSet(raw: unknown, i: number, landmarkIds: Set<string>): SemilandmarkSet {
  if (!raw || typeof raw !== 'object') throw new ProjectFileError(`Semilandmark set ${i + 1} is not an object.`);
  const r = raw as Record<string, unknown>;
  if (typeof r.curveId !== 'string') throw new ProjectFileError(`Semilandmark set ${i + 1} needs a "curveId".`);
  const count = typeof r.count === 'number' && Number.isInteger(r.count) && r.count >= 1 ? r.count : 10;
  const lm = (v: unknown) => (typeof v === 'string' && landmarkIds.has(v) ? v : null);
  const t = nowIso();
  return {
    id: str(r.id) || uuid(),
    label: str(r.label, `SL${i + 1}`),
    curveId: r.curveId,
    count,
    startLandmarkId: lm(r.startLandmarkId),
    endLandmarkId: lm(r.endLandmarkId),
    createdAt: str(r.createdAt, t),
    modifiedAt: str(r.modifiedAt, t),
  };
}

/** Corrections of the volumetric configuration; unknown faces and codes are dropped (a file without them has none). */
function parseConfiguration(raw: unknown): ConfigCorrections {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const byFace = <T extends string>(v: unknown, codes: readonly T[]): Partial<Record<ConfigFace, T>> => {
    const out: Partial<Record<ConfigFace, T>> = {};
    if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) if ((CONFIG_FACES as readonly string[]).includes(k) && codes.includes(x as T)) out[k as ConfigFace] = x as T;
    return out;
  };
  const joins: Record<string, boolean> = {};
  if (r.joins && typeof r.joins === 'object')
    for (const [k, x] of Object.entries(r.joins as Record<string, unknown>)) {
      const [a, b] = k.split('|') as ConfigFace[];
      if (typeof x === 'boolean' && CONFIG_FACES.includes(a) && CONFIG_FACES.includes(b) && !sameAxis(a, b) && joinKey(a, b) === k) joins[k] = x;
    }
  return {
    roles: byFace(r.roles, CONFIG_ROLES),
    joins,
    surfaceType: byFace(r.surfaceType, ['wide', 'narrow'] as const),
    axis: byFace(r.axis, ['long', 'short'] as const),
    polarity: POLARITIES.find((p) => p === r.polarity) ?? null,
    model: CONFIG_MODELS.find((m) => m === r.model) ?? 'box',
    bicone: (() => {
      const roles: ConfigCorrections['bicone']['roles'] = {};
      const b = (r.bicone && typeof r.bicone === 'object' ? r.bicone : {}) as Record<string, unknown>;
      if (b.roles && typeof b.roles === 'object')
        for (const [k, x] of Object.entries(b.roles as Record<string, unknown>)) if ((BICONE_SIDES as readonly string[]).includes(k) && (BICONE_ROLES as readonly string[]).includes(x as string)) roles[k as BiconeSide] = x as BiconeRole;
      return { roles };
    })(),
  };
}

/** The settings of the retouch indices, when they are not the default: what is not understood takes its default, a length out of range the nearest in it. */
function parseRetouchSettings(raw: unknown): RetouchSettings | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fitLength = typeof r.fitLength === 'number' && Number.isFinite(r.fitLength) ? clampFitLength(r.fitLength) : null;
  const axis = RETOUCH_AXES.find((x) => x === r.axis) ?? 'auto';
  const flip = r.flip === true;
  return fitLength === null && axis === 'auto' && !flip ? null : { fitLength, axis, flip };
}

/** A flake's own data (files without it: none). An axis without numeric ends is dropped. */
function parseFlake(raw: unknown): FlakeData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const a = (r.axis && typeof r.axis === 'object' ? r.axis : null) as Record<string, unknown> | null;
  const t = nowIso();
  const normal = (v: unknown): Vec3 => (isFiniteVec(v) ? normalize(v) : [0, 0, 1]);
  const m = a?.matrix;
  const retouch = parseRetouchSettings(r.retouch);
  return {
    ...(retouch ? { retouch } : {}),
    axis: a && isFiniteVec(a.start) && isFiniteVec(a.end)
      ? {
          id: str(a.id) || uuid(),
          start: [a.start[0], a.start[1], a.start[2]],
          end: [a.end[0], a.end[1], a.end[2]],
          startNormal: normal(a.startNormal),
          endNormal: normal(a.endNormal),
          matrix: Array.isArray(m) && m.length === 16 && m.every((x) => typeof x === 'number' && Number.isFinite(x)) ? [...(m as number[])] : null,
          failure: a.failure === 'short' || a.failure === 'few' ? a.failure : null,
          createdAt: str(a.createdAt, t),
          modifiedAt: str(a.modifiedAt, t),
        }
      : null,
    otherFrame: parseFrame(r.otherFrame),
  };
}

/** The working edges (files without them: none); one without numeric ends, or on a curve the file does not have, is dropped. */
function parseWorkingEdges(raw: unknown, curves: readonly Curve[]): WorkingEdge[] {
  const t = nowIso();
  return (Array.isArray(raw) ? raw : []).flatMap((v, i): WorkingEdge[] => {
    const e = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    if (!isFiniteVec(e.start) || !isFiniteVec(e.end) || !curves.some((c) => c.id === e.curveId)) return [];
    return [{ id: str(e.id) || uuid(), label: str(e.label) || `E${i + 1}`, name: str(e.name), curveId: e.curveId as string, start: [e.start[0], e.start[1], e.start[2]], end: [e.end[0], e.end[1], e.end[2]], createdAt: str(e.createdAt, t), modifiedAt: str(e.modifiedAt, t) }];
  });
}

/** The records of imports (files without them: none); one not understood is dropped, its references to scars the file does not have are dropped. */
function parseImports(raw: unknown, scarIds: Set<string>): ImportRecord[] {
  const num = (v: unknown, fallback = NaN) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && scarIds.has(x)) : []);
  return (Array.isArray(raw) ? raw : []).flatMap((v): ImportRecord[] => {
    const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    const m = r.transform;
    if (r.kind !== 'iges-scars' || !Array.isArray(m) || m.length !== 16 || !m.every((x) => typeof x === 'number' && Number.isFinite(x))) return [];
    const res = (r.residual && typeof r.residual === 'object' ? r.residual : {}) as Record<string, unknown>;
    const pairs = (Array.isArray(r.pairs) ? r.pairs : []).flatMap((p) => {
      const q = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
      const from = parseVec(q.from), to = parseVec(q.to);
      return from && to ? [{ from, to }] : [];
    });
    return [{
      kind: 'iges-scars',
      file: str(r.file),
      sha256: str(r.sha256),
      date: str(r.date),
      unitsFlag: typeof r.unitsFlag === 'number' && Number.isFinite(r.unitsFlag) ? r.unitsFlag : null,
      unitsName: str(r.unitsName),
      scale: num(r.scale, 1),
      transform: [...(m as number[])],
      pairs,
      residual: { median: num(res.median), p90: num(res.p90), max: num(res.max) },
      arrows: ids(r.arrows),
      review: ids(r.review),
    }];
  });
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
  const workingEdges = parseWorkingEdges(raw.workingEdges, curves);
  const measureList = Array.isArray(ann?.measurements) ? (ann!.measurements as unknown[]) : [];
  const measurements = measureList.map((m, i) => parseMeasurement(m, i));
  const planeList = Array.isArray(ann?.planes) ? (ann!.planes as unknown[]) : [];
  const planes = planeList.map((p, i) => parsePlane(p, i));
  const sectionList = Array.isArray(ann?.sections) ? (ann!.sections as unknown[]) : [];
  const sections = sectionList.map((s, i) => parseSection(s, i));
  const regionList = Array.isArray(ann?.regions) ? (ann!.regions as unknown[]) : [];
  const regions = regionList.map((r, i) => parseRegion(r, i));
  const scarIds = new Set(scars.map((s) => s.id));
  const relations = parseRelations(ann?.relations, scarIds);
  const sequences = parseSequences(ann?.sequences, scarIds);
  const landmarks = (Array.isArray(ann?.landmarks) ? (ann!.landmarks as unknown[]) : []).map((l, i) => parseLandmark(l, i));
  const landmarkIds = new Set(landmarks.map((l) => l.id));
  const semilandmarks = (Array.isArray(ann?.semilandmarks) ? (ann!.semilandmarks as unknown[]) : []).map((q, i) => parseSemilandmarkSet(q, i, landmarkIds));
  const sp = (raw.specimen ?? {}) as Record<string, unknown>;
  const specimen: SpecimenInfo = {
    id: str(sp.id),
    annotator: str(sp.annotator),
    unit: str(sp.unit, 'mm'),
    notes: str(sp.notes),
    frame: parseFrame(sp.frame),
    type: SPECIMEN_TYPES.find((x) => x === sp.type) ?? 'core',
  };
  return {
    specimen,
    mesh: (raw.mesh as MeshInfo | null) ?? null,
    scars,
    curves,
    workingEdges,
    measurements,
    planes,
    sections,
    regions,
    relations,
    sequences,
    landmarks,
    semilandmarks,
    nodule: (() => {
      const nd = (raw.nodule ?? {}) as Record<string, unknown>;
      return { exclude: Array.isArray(nd.exclude) ? nd.exclude.filter((x): x is string => typeof x === 'string') : [], show: nd.show === true };
    })(),
    split: (() => {
      const sp = raw.split as Record<string, unknown> | null | undefined;
      if (!sp || (sp.source !== 'plane' && sp.source !== 'curve') || typeof sp.id !== 'string') return null;
      return { source: sp.source, id: sp.id, upHint: isFiniteVec(sp.upHint) ? [sp.upHint[0], sp.upHint[1], sp.upHint[2]] : [0, 0, 1], swap: sp.swap === true };
    })(),
    configuration: parseConfiguration(raw.configuration),
    flake: parseFlake(raw.flake),
    sharpEdge: parseSharpEdge(raw.sharpEdge),
    gm: parseGmConfig(raw.gm),
    imports: parseImports(raw.imports, new Set(scars.map((x) => x.id))),
    nextLabelNumber: Math.max(positiveInt(raw.nextLabelNumber), maxLabelNumber(scars.map((a) => a.label), 'S') + 1),
    nextCurveNumber: Math.max(positiveInt(raw.nextCurveNumber), maxLabelNumber(curves.map((c) => c.label), 'C') + 1),
    nextWorkingEdgeNumber: Math.max(positiveInt(raw.nextWorkingEdgeNumber), maxLabelNumber(workingEdges.map((e) => e.label), 'E') + 1),
    nextMeasureNumber: Math.max(positiveInt(raw.nextMeasureNumber), maxLabelNumber(measurements.map((m) => m.label), 'M') + 1),
    nextPlaneNumber: Math.max(positiveInt(raw.nextPlaneNumber), maxLabelNumber(planes.map((p) => p.label), 'P') + 1),
    nextSectionNumber: Math.max(positiveInt(raw.nextSectionNumber), maxLabelNumber(sections.map((s) => s.label), 'X') + 1),
    nextRegionNumber: Math.max(positiveInt(raw.nextRegionNumber), maxLabelNumber(regions.map((r) => r.label), 'R') + 1),
    nextSequenceNumber: Math.max(positiveInt(raw.nextSequenceNumber), maxLabelNumber(sequences.map((q) => q.label), 'Q') + 1),
    nextLandmarkNumber: Math.max(positiveInt(raw.nextLandmarkNumber), maxLabelNumber(landmarks.map((l) => l.name), 'LM') + 1),
    nextSemilandmarkNumber: Math.max(positiveInt(raw.nextSemilandmarkNumber), maxLabelNumber(semilandmarks.map((q) => q.label), 'SL') + 1),
    createdAt: str(raw.createdAt, nowIso()),
    modifiedAt: str(raw.modifiedAt, nowIso()),
  };
}

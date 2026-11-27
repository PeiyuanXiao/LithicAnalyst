import { icc21 } from '../compute/agreement';
import { biconeVolumes, coreConfiguration, type CoreConfiguration } from '../compute/bicone';
import { alike, type SymmetryValues } from '../compute/symmetry';
import { storedBox, type ConfigBox } from '../compute/configuration';
import { landmarkTable } from '../compute/landmarks';
import type { PrincipalAxes } from '../compute/meshGeometry';
import { computePlane, type PlaneResult } from '../compute/planes';
import type { RegionResult, RegionTotals } from '../compute/regions';
import type { FlakeMeasures, FlakeResult } from '../compute/flake';
import type { RetouchIndices } from '../compute/retouchIndex';
import type { WorkingEdgesDerived, WorkingEdgeRow } from '../compute/workingEdge';
import { gmLandPairs, gmMissingInputs, type GmMissing } from '../compute/gm';
import type { gmManifest } from '../compute/gmTemplate';
import type { AutoMeasurements, EdgeAngleCurve, FlakeDerived, GmDerived, MeshResults, RetouchAngleCurve } from '../core/derived';
import { hasEdgeAngles } from '../core/fields';
import { measurementValue } from '../core/measurements';
import { hasVector, type ProjectState, type Vec3 } from '../core/types';
import { configurationCsv, csvCell, curveCsv, edgeAnglesCsv, edgeSharpCsv, invasivenessCsv, retouchAnglesCsv, retouchSectionsCsv, retouchSegmentsCsv, flakesCsv, flakingSurfacesCsv, fmt, manualMeasurementsCsv, measurementsCsv, planesCsv, regionsCsv, relationsCsv, scarVectorCsv, seriesCsv, symmetryCsv, workingEdgesCsv, type CsvOptions } from './csv';
import { gmCurvesCsv, gmLandmarksCsv, gmLandPairsCsv, gmModelsCsv, gmOutlinesCsv, gmSmvectorCsv, gmSurfacesCsv, gmSurpCsv, landmarksCsv, landmarksTps } from './landmarks';

/** One specimen of a batch: its project (or a fresh one), measured on its model. */
export interface BatchSpecimen {
  /** The model's path in the folder. */
  file: string;
  state: ProjectState;
  auto: AutoMeasurements;
  /** Recomputed from the project's inputs. */
  planes: PlaneResult[];
  /** Recomputed from the project's inputs and the model's box (the bicone: and the stored volumes of its symmetry reference). */
  configuration: CoreConfiguration | null;
  /** From the project file's derived results (the values the app last computed). */
  regions: RegionResult[];
  regionTotals: RegionTotals | null;
  nodule: { radius: number; rms: number } | null;
  /** The symmetry references' results, from the project file's derived results. */
  symmetry: SymmetryValues[];
  /** A flake's measurements, from the project file's derived results (null for a core). */
  flake: FlakeMeasures | null;
  /** The curves' edge angles, from the project file's derived results. */
  edgeAngles: readonly EdgeAngleCurve[];
  /** The retouch layers along them, from the project file's derived results. */
  retouchAngles: readonly RetouchAngleCurve[];
  /** A flake's retouch indices, from the project file's derived results (null: none stored). */
  retouchIndices?: RetouchIndices | null;
  /** The working edges' rows, from the project file's derived results. */
  workingEdges?: readonly WorkingEdgeRow[];
  /** The points for geometric morphometrics, from the project file's derived results; those of another configuration are made anew before the tables. */
  gm: GmDerived | null;
  /** Each observer's manual measurements (annotator → label → value), from every project file of the model, for the ICC; empty but on the model's first. */
  observers: Map<string, Record<string, number>>;
  /**
   * Whether this is the model's first project file (its own, else the first found; or a fresh project): a model has one set of rows per
   * project file, but only the first gives the points of geometric morphometrics and the ICC's observers. Absent: the first.
   */
  primary?: boolean;
}

/** A project of a model in a batch: its annotations and the results it stored. */
export interface BatchProject {
  /** Its file in the folder (null for a fresh project of a model without one). */
  path: string | null;
  state: ProjectState;
  derived: Record<string, unknown>;
  /** Version of the app that wrote it. */
  appVersion: string;
}

/** What a batch row needs from the mesh for one project: the automatic measurements and the box along its frame, and the vertices' principal axes. */
export interface ModelMeasures {
  auto: AutoMeasurements;
  vertices: PrincipalAxes | null;
  box: ConfigBox | null;
}

const isVec = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/** The vertices' principal axes as stored in a project file, or null. */
function storedAxes(v: unknown): PrincipalAxes | null {
  const a = v as PrincipalAxes | null | undefined;
  return a && isVec(a.mean) && Array.isArray(a.axes) && a.axes.length === 3 && a.axes.every(isVec) && Array.isArray(a.variances) ? a : null;
}

const REASONS = ['no_source', 'not_closed', 'no_cut'] as const;

/**
 * A reference's results as a project file stores them; one of stage 34 (before the three symmetries) has the sides' values only:
 * the volume and area symmetries follow from them, the shape symmetry is empty.
 */
export function storedSymmetryValues(raw: unknown): SymmetryValues | null {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!r || typeof r.id !== 'string') return null;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const why = (v: unknown) => REASONS.find((x) => x === v) ?? null;
  const rs = (r.reasons && typeof r.reasons === 'object' ? r.reasons : {}) as Record<string, unknown>;
  const pl = r.plane as { point?: unknown; normal?: unknown } | null | undefined;
  const vec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
  const v: Omit<SymmetryValues, 'volumeSymmetry' | 'areaSymmetry'> = {
    id: r.id,
    plane: pl && vec(pl.point) && vec(pl.normal) ? { point: [...pl.point] as Vec3, normal: [...pl.normal] as Vec3 } : null,
    shapeSymmetry: num(r.shapeSymmetry),
    volumeA: num(r.volumeA),
    volumeB: num(r.volumeB),
    areaA: num(r.areaA),
    areaB: num(r.areaB),
    deviationMean: num(r.deviationMean),
    deviationRms: num(r.deviationRms),
    deviationP95: num(r.deviationP95),
    reasons: { volume: why(rs.volume), area: why(rs.area), shape: why(rs.shape ?? rs.volume), deviation: why(rs.deviation) },
  };
  const of = (a: number | null, b: number | null) => (a !== null && b !== null ? alike(a, b) : null);
  return { ...v, volumeSymmetry: num(r.volumeSymmetry) ?? of(v.volumeA, v.volumeB), areaSymmetry: num(r.areaSymmetry) ?? of(v.areaA, v.areaB) };
}

/**
 * The symmetry references' results as stored in a project file. A file of before stage 34 stored an upper / lower `split` instead:
 * its volumes stand for those of S1, the reference it became (parseProject).
 */
export function storedSymmetry(derived: Record<string, unknown>, state: Pick<ProjectState, 'symmetry'>): SymmetryValues[] {
  const d = derived.symmetry as { refs?: unknown } | null | undefined;
  if (Array.isArray(d?.refs)) return d.refs.flatMap((r) => storedSymmetryValues(r) ?? []);
  const s = derived.split as { upper?: unknown; lower?: unknown } | null | undefined;
  const ref = state.symmetry.length === 1 ? state.symmetry[0] : null;
  if (!ref || !s || typeof s.upper !== 'number' || typeof s.lower !== 'number' || !Number.isFinite(s.upper) || !Number.isFinite(s.lower)) return [];
  const v = storedSymmetryValues({ id: ref.id, volumeA: s.upper, volumeB: s.lower });
  return v ? [v] : [];
}

/** A region plane's fit as stored with the results (it needs the mesh and the regions to compute again). */
function storedRegionFit(planes: unknown, id: string): { centroid: Vec3; normal: Vec3; count: number } | null {
  const p = Array.isArray(planes) ? (planes as PlaneResult[]).find((x) => x.id === id && x.method === 'region' && x.valid) : undefined;
  return p?.center && p.normal ? { centroid: p.center, normal: p.normal, count: p.inputCount } : null;
}

/** The automatic measurements as stored in a project file, or null (also when taken along a frame, as before: measured again). */
function storedAuto(v: unknown): AutoMeasurements | null {
  const m = v as (AutoMeasurements & { frame?: unknown }) | null | undefined;
  return m && m.frame === undefined && [m.length, m.width, m.thickness, m.surfaceArea].every((x) => typeof x === 'number' && Number.isFinite(x)) ? m : null;
}

/**
 * What a project file stored of its model's results, as `computeDerived` takes them: to write the project again without opening the
 * model (an import of the folder's IGES files changes only scars, which none of these depend on; what does is computed anew).
 */
export function storedMeshResults(derived: Record<string, unknown>): MeshResults {
  const d = derived as Record<string, unknown> & { regions?: unknown; flake?: { measures?: unknown; geometry?: unknown } | null; edgeAngles?: { curves?: unknown } | null; retouchAngles?: { curves?: unknown } | null; workingEdges?: { edges?: unknown } | null };
  const fits = new Map<string, { centroid: Vec3; normal: Vec3; count: number }>();
  for (const p of Array.isArray(d.planes) ? (d.planes as PlaneResult[]) : []) {
    const fit = storedRegionFit(d.planes, p.id);
    if (fit) fits.set(p.id, fit);
  }
  return {
    measurements: storedAuto(d.measurements),
    vertices: storedAxes(d.vertices),
    regions: Array.isArray(d.regions) && d.regionTotals ? { results: d.regions as RegionResult[], totals: d.regionTotals as RegionTotals } : null,
    nodule: (d.nodule as MeshResults['nodule']) ?? null,
    symmetry: Array.isArray((d.symmetry as { refs?: unknown } | null | undefined)?.refs) ? (d.symmetry as { refs: unknown[] }).refs.flatMap((r) => storedSymmetryValues(r) ?? []) : null,
    box: storedBox(d.configuration),
    flake: d.flake?.measures && d.flake.geometry ? ({ measures: d.flake.measures, geometry: d.flake.geometry } as FlakeResult) : null,
    regionFits: fits,
    edgeAngles: Array.isArray(d.edgeAngles?.curves) ? (d.edgeAngles!.curves as EdgeAngleCurve[]) : null,
    retouchAngles: Array.isArray(d.retouchAngles?.curves) ? (d.retouchAngles!.curves as RetouchAngleCurve[]) : null,
    retouchIndices: (d.retouchIndices as RetouchIndices | undefined) ?? null,
    gm: (d.gm as MeshResults['gm']) ?? null,
    workingEdges: Array.isArray(d.workingEdges?.edges) ? (d.workingEdges!.edges as WorkingEdgeRow[]) : null,
  };
}

/**
 * The results a project stored can stand for its model's (no need to read the
 * mesh): written by this version of the app, with the automatic measurements,
 * — when it has planes — the vertices' axes and — when it has arrows — the box of
 * its volumetric configuration (not needed by the bicone, which uses the stored volumes of its symmetry reference). (The checksum is checked by the caller: the
 * project is the model's by its `mesh.sha256`.)
 */
export function savedResultsUsable(p: BatchProject, appVersion: string): boolean {
  return (
    p.appVersion === appVersion &&
    !!storedAuto(p.derived.measurements) &&
    (!p.state.planes.length || !!storedAxes(p.derived.vertices)) &&
    (!p.state.scars.some(hasVector) || p.state.specimen.type !== 'core' || p.state.configuration.model === 'bicone' || !!storedBox(p.derived.configuration))
  );
}

/** The stored results of a project that passes savedResultsUsable. */
export const savedMeasures = (p: BatchProject): ModelMeasures => ({ auto: storedAuto(p.derived.measurements)!, vertices: storedAxes(p.derived.vertices), box: storedBox(p.derived.configuration) });

/**
 * The specimens of one model in a batch export, one per project file (each with the results it stored, or those measured for it): the
 * model's own project (or a fresh one) first, the others by annotator. Every project of the model is an observer for the ICC (told apart
 * by annotator, else by file), with its manual measurements: what is computed from the annotations is not compared (34d), and can be
 * from the rows of each project. The same for stored and recomputed measures, so both give the same tables.
 */
export function batchSpecimens(file: string, primary: { project: BatchProject; measures: ModelMeasures }, projects: ReadonlyArray<{ project: BatchProject; measures: ModelMeasures }>): BatchSpecimen[] {
  const observers = new Map<string, Record<string, number>>();
  for (const { project: p } of projects) {
    const st = p.state;
    const who = st.specimen.annotator || p.path || '';
    if (observers.has(who)) continue;
    const values: Record<string, number> = {};
    for (const m of st.measurements) values[m.label] = measurementValue(m);
    observers.set(who, values);
  }
  const others = projects
    .filter((x) => x.project !== primary.project)
    .sort((x, y) => compareText(x.project.state.specimen.annotator, y.project.state.specimen.annotator) || compareText(x.project.path ?? '', y.project.path ?? ''));
  return [{ ...specimenOf(file, primary.project, primary.measures), observers, primary: true }, ...others.map((x) => ({ ...specimenOf(file, x.project, x.measures), observers: new Map(), primary: false }))];
}

/** The model's first specimen of a batch export (`batchSpecimens`). */
export const batchSpecimen = (file: string, primary: { project: BatchProject; measures: ModelMeasures }, projects: ReadonlyArray<{ project: BatchProject; measures: ModelMeasures }>): BatchSpecimen => batchSpecimens(file, primary, projects)[0];

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** One project file's rows of a batch export: its annotations, the results it stored, and its model's measures. */
function specimenOf(file: string, project: BatchProject, measures: ModelMeasures): Omit<BatchSpecimen, 'observers' | 'primary'> {
  const { state, derived } = project;
  // what a file stored under another type is not exported under this one
  const symmetry = storedSymmetry(derived, state);
  const edges = hasEdgeAngles(state.specimen.type);
  return {
    file,
    state,
    auto: measures.auto,
    planes: state.planes.map((p) => computePlane(p, state, measures.vertices, storedRegionFit(derived.planes, p.id))),
    configuration: state.specimen.type === 'core' ? coreConfiguration(state, measures.box, biconeVolumes(state, symmetry)) : null,
    regions: (derived.regions as BatchSpecimen['regions']) ?? [],
    regionTotals: (derived.regionTotals as BatchSpecimen['regionTotals']) ?? null,
    nodule: (derived.nodule as BatchSpecimen['nodule']) ?? null,
    symmetry,
    flake: state.specimen.type === 'flake' ? ((derived.flake as FlakeDerived | null | undefined)?.measures ?? null) : null,
    edgeAngles: edges ? ((derived.edgeAngles as { curves?: EdgeAngleCurve[] } | null | undefined)?.curves ?? []) : [],
    retouchAngles: edges ? ((derived.retouchAngles as { curves?: RetouchAngleCurve[] } | null | undefined)?.curves ?? []) : [],
    retouchIndices: state.specimen.type === 'flake' ? ((derived.retouchIndices as RetouchIndices | null | undefined) ?? null) : null,
    workingEdges: edges ? ((derived.workingEdges as WorkingEdgesDerived | null | undefined)?.edges ?? []) : [],
    gm: (derived.gm as GmDerived | null | undefined) ?? null,
  };
}

/** Whether a specimen of a batch is its model's first (`BatchSpecimen.primary`). */
export const isPrimary = (s: BatchSpecimen): boolean => s.primary !== false;

/**
 * A table of the summary export with `annotator` (the project's `specimen.annotator`, empty when not filled in) put in after its
 * `specimen_id` column; a table that does not start with `specimen_id` stays as it is.
 */
export function withAnnotator(text: string, annotator: string): string {
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = bom ? text.slice(1) : text;
  if (!/^specimen_id(,|\r?\n|$)/.test(body)) return text;
  const cell = csvCell(annotator);
  let out = '', i = 0, header = true;
  while (i < body.length) {
    if (body[i] === '\n') {
      out += '\n';
      i++;
      continue;
    }
    // the record's first field (quoted or not), then the column, then the rest of the record up to a line end outside quotes
    let j = i;
    if (body[j] === '"') {
      j++;
      while (j < body.length && !(body[j] === '"' && body[j + 1] !== '"')) j += body[j] === '"' ? 2 : 1;
      j++;
    } else while (j < body.length && body[j] !== ',' && body[j] !== '\r' && body[j] !== '\n') j++;
    out += body.slice(i, j) + ',' + (header ? 'annotator' : cell);
    header = false;
    let k = j, quoted = false;
    while (k < body.length && (quoted || body[k] !== '\n')) {
      if (body[k] === '"') quoted = !quoted;
      k++;
    }
    out += body.slice(j, k + 1);
    i = k + 1;
  }
  return bom + out;
}

/** A model a batch could not read or measure. */
export interface BatchFailure {
  file: string;
  reason: string;
}

/** The failures of a batch, one row each. */
export function failuresCsv(failures: readonly BatchFailure[], bom: boolean): string {
  return (bom ? '﻿' : '') + ['file,reason', ...failures.map((f) => [csvCell(f.file), csvCell(f.reason)].join(','))].join('\n') + '\n';
}

/** What an export folder holds and how it was made (`manifest.json`). */
export interface Manifest {
  /** The program: its version, author, licence and repository, and how to cite this version (APA). */
  app: { name: string; version: string; author: string; license: string; repository: string; citation: string };
  createdAt: string;
  /** One specimen, or every model of the folder. */
  scope: 'specimen' | 'folder';
  folder: string | null;
  kind: 'tables' | 'figures';
  options: Record<string, unknown>;
  /** The named parameters of the angle and flake measurements. */
  parameters?: Record<string, unknown>;
  specimens: Array<{ id: string; file: string; sha256: string | null; project: string | null; annotator: string }>;
  /** Models sharing a file name, whose IDs were made from their paths. */
  duplicateNames: Array<{ name: string; files: string[] }>;
  failures: BatchFailure[];
  /** Specimens left out of the coordinates of geometric morphometrics, and why. */
  gmSkipped?: GmSkipped[];
  /** Specimens in them with some points written as NA, and why. */
  gmIncomplete?: GmSkipped[];
  /** How the surface semilandmarks were made: by the grid or a template, which, by which seed, and the configuration's version. */
  gm?: ReturnType<typeof gmManifest>;
  files: string[];
}

/** A specimen left out of the coordinates of geometric morphometrics, or in them with what it lacks as NA: what it lacks (codes). */
export interface GmSkipped {
  file: string;
  id: string;
  missing: GmMissing[];
}

/**
 * The points of the specimens of a batch: the coordinates and, once, their sliding definition. All must have the same points, or their numbers would mean different
 * points; those with another number (the user's own landmarks) are skipped. By the grid only complete specimens are written, the rest listed; by a template every specimen
 * has the same rows, and what one lacks is written as NA and listed apart, unless it has nothing at all to give.
 */
export function gmOutputs(all: readonly BatchSpecimen[], opts: CsvOptions): { files: Array<{ suffix: string; text: string }>; skipped: GmSkipped[]; incomplete: GmSkipped[] } {
  const plain = { excelBom: false };
  // one set of points per model: its first project file's
  const specimens = all.filter(isPrimary);
  const skipped: GmSkipped[] = [];
  const incomplete: GmSkipped[] = [];
  const kept: Array<BatchSpecimen & { gm: GmDerived }> = [];
  for (const s of specimens) {
    const skip = (list: GmSkipped[], missing: GmMissing[]) => list.push({ file: s.file, id: s.state.specimen.id, missing });
    // one table: as many points in each, and by one way of making them (their columns differ)
    const unlike = (g: GmDerived) => kept.length > 0 && (kept[0].gm.rows.length !== g.rows.length || (kept[0].gm.method === 'template') !== (g.method === 'template'));
    if (s.gm?.method === 'template') {
      if (s.gm.rows.every((r) => r.missing)) skip(skipped, s.gm.missing);
      else if (unlike(s.gm)) skip(skipped, ['point_count']);
      else {
        kept.push(s as BatchSpecimen & { gm: GmDerived });
        if (!s.gm.complete) skip(incomplete, s.gm.missing);
      }
      continue;
    }
    if (s.state.specimen.type !== 'flake') continue;
    if (!s.gm?.complete) skip(skipped, s.gm?.missing ?? gmMissingInputs(s.state));
    else if (unlike(s.gm)) skip(skipped, ['point_count']);
    else kept.push(s as BatchSpecimen & { gm: GmDerived });
  }
  if (!kept.length) return { files: [], skipped, incomplete };
  const first = kept[0].gm;
  const files = [
    { suffix: 'gm_landmarks.csv', text: mergeCsv(kept.map((s) => withAnnotator(gmLandmarksCsv(s.state, s.gm, plain), s.state.specimen.annotator)), opts.excelBom) },
    { suffix: 'gm_landmarks.tps', text: kept.map((s) => landmarksTps(s.state, s.gm)).join('') },
  ];
  // by the grid the files stay those it always had; by a template Morpho's definitions as well
  const morpho = first.method === 'template';
  if (first.curves.length) files.push({ suffix: 'gm_curves.csv', text: gmCurvesCsv(first) });
  if (first.curves.length && morpho) files.push({ suffix: 'gm_smvector.csv', text: gmSmvectorCsv(first) }, { suffix: 'gm_outlines.csv', text: gmOutlinesCsv(first) });
  if (first.surfaces.length) files.push({ suffix: 'gm_surfaces.csv', text: gmSurfacesCsv(first) });
  // a flake's points by the grid: left and right in pairs
  if (!morpho && kept[0].state.specimen.type === 'flake' && gmLandPairs(first).length) files.push({ suffix: 'gm_land_pairs.csv', text: gmLandPairsCsv(first) });
  if (first.surfaces.length && morpho) files.push({ suffix: 'gm_surp.csv', text: gmSurpCsv(first) });
  if (morpho) files.push({ suffix: 'gm_models.csv', text: mergeCsv(kept.map((s) => withAnnotator(gmModelsCsv([{ id: s.state.specimen.id, file: s.file }]), s.state.specimen.annotator)), false) });
  return { files, skipped, incomplete };
}

export const manifestJson = (m: Manifest): string => JSON.stringify(m, null, 2) + '\n';

/** CSV texts of one kind as one file: the first header, then every row. */
export function mergeCsv(texts: readonly string[], bom: boolean): string {
  const lines = texts.map((t) => t.replace(/^﻿/, '').split('\n').filter((l) => l.length));
  return (bom ? '﻿' : '') + [lines[0]?.[0] ?? '', ...lines.flatMap((l) => l.slice(1))].join('\n') + '\n';
}

const hasRows = (csv: string) => csv.replace(/^﻿/, '').trim().split('\n').length > 1;

/**
 * ICC(2,1) of each manual measurement (by label) over the models that every observer measured (observers by annotator name; each
 * model once, by its first specimen). Null with fewer than two observers or nothing measured by all of them on two models or more.
 */
export function iccCsv(all: readonly BatchSpecimen[]): string | null {
  const specimens = all.filter(isPrimary);
  const raters = [...new Set(specimens.flatMap((s) => [...s.observers.keys()]))].sort();
  if (raters.length < 2) return null;
  const measures = [...new Set(specimens.flatMap((s) => [...s.observers.values()].flatMap((o) => Object.keys(o))))];
  const rows: string[] = [];
  for (const m of measures) {
    const data = specimens
      .filter((s) => raters.every((r) => Number.isFinite(s.observers.get(r)?.[m])))
      .map((s) => raters.map((r) => s.observers.get(r)![m]));
    if (data.length >= 2) rows.push([csvCell(m), String(data.length), String(raters.length), fmt(icc21(data))].join(','));
  }
  return rows.length ? ['measure,n_specimens,n_raters,icc', ...rows].join('\n') + '\n' : null;
}

/** Every CSV kind merged over the specimens (kinds without rows are left out), and one TPS file. */
export function batchOutputs(specimens: readonly BatchSpecimen[], opts: CsvOptions): Array<{ suffix: string; text: string }> {
  const plain = { excelBom: false };
  // one set of rows per project file, told apart by annotator
  const merged = (make: (s: BatchSpecimen) => string, among: readonly BatchSpecimen[] = specimens) => mergeCsv(among.map((s) => withAnnotator(make(s), s.state.specimen.annotator)), opts.excelBom);
  // what a generic specimen does not have, whatever it held on another type
  const typed = specimens.filter((s) => s.state.specimen.type !== 'generic');
  const out: Array<{ suffix: string; text: string }> = [
    { suffix: 'measurements.csv', text: merged((s) => measurementsCsv(s.state, s.auto, plain, s.regionTotals, s.nodule, s.file)) },
  ];
  const kinds: Array<[string, (s: BatchSpecimen) => string, (readonly BatchSpecimen[])?]> = [
    ['scar_vectors.csv', (s) => scarVectorCsv(s.state, plain, s.configuration)],
    ['curves.csv', (s) => curveCsv(s.state, plain)],
    ['manual_measurements.csv', (s) => manualMeasurementsCsv(s.state, plain)],
    ['planes.csv', (s) => planesCsv(s.state, s.planes, plain)],
    ['symmetry.csv', (s) => symmetryCsv(s.state, s.symmetry, plain)],
    ['regions.csv', (s) => regionsCsv(s.state, s.regions, plain)],
    ['edge_angles.csv', (s) => edgeAnglesCsv(s.state, s.edgeAngles, plain)],
    ['retouch_angles.csv', (s) => retouchAnglesCsv(s.state, s.retouchAngles, plain)],
    ['retouch_sections.csv', (s) => retouchSectionsCsv(s.state, s.retouchIndices ?? null, plain)],
    ['retouch_segments.csv', (s) => retouchSegmentsCsv(s.state, s.retouchIndices ?? null, plain)],
    ['invasiveness.csv', (s) => invasivenessCsv(s.state, s.retouchIndices ?? null, plain)],
    ['edge_sharp.csv', (s) => edgeSharpCsv(s.state, s.edgeAngles, plain)],
    ['working_edges.csv', (s) => workingEdgesCsv(s.state, s.workingEdges ?? [], s.edgeAngles, plain)],
    ['relations.csv', (s) => relationsCsv(s.state, plain), typed],
    ['series.csv', (s) => seriesCsv(s.state, plain), typed],
    ['landmarks.csv', (s) => landmarksCsv(s.state, landmarkTable(s.state), plain)],
  ];
  for (const [suffix, make, among] of kinds) {
    const text = merged(make, among);
    if (hasRows(text)) out.push({ suffix, text });
  }
  // flakes only here, and the volumetric configuration only of cores
  const flakes = specimens.filter((s) => s.state.specimen.type === 'flake');
  if (flakes.length) out.push({ suffix: 'flakes.csv', text: merged((s) => flakesCsv(s.state, s.flake, plain, s.retouchIndices ?? null), flakes) });
  // the volumetric configuration: specimens that have one (arrows on a measured model)
  const configured = specimens.filter((s) => s.configuration);
  if (configured.length) {
    out.push({ suffix: 'configuration.csv', text: merged((s) => configurationCsv(s.state, s.configuration, plain, s.file), configured) });
    const surfaces = merged((s) => flakingSurfacesCsv(s.state, s.configuration, plain, s.file), configured);
    if (hasRows(surfaces)) out.push({ suffix: 'flaking_surfaces.csv', text: surfaces });
  }
  // the points once per model: its first project file's (observers differ in the agreement, not here)
  const tps = specimens.filter((s) => isPrimary(s) && (s.state.landmarks.length || s.state.semilandmarks.length)).map((s) => landmarksTps(s.state, landmarkTable(s.state)));
  if (tps.length) out.push({ suffix: 'landmarks.tps', text: tps.join('') });
  const icc = iccCsv(specimens);
  if (icc) out.push({ suffix: 'icc.csv', text: (opts.excelBom ? '﻿' : '') + icc });
  return out;
}

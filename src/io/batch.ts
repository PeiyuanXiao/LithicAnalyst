import { icc21 } from '../compute/agreement';
import { coreConfiguration, type CoreConfiguration } from '../compute/bicone';
import { storedBox, type ConfigBox } from '../compute/configuration';
import { landmarkTable } from '../compute/landmarks';
import type { PrincipalAxes } from '../compute/meshGeometry';
import { computePlane, type PlaneResult } from '../compute/planes';
import type { RegionResult, RegionTotals } from '../compute/regions';
import type { FlakeMeasures } from '../compute/flake';
import type { RetouchIndices } from '../compute/retouchIndex';
import type { WorkingEdgesDerived, WorkingEdgeRow } from '../compute/workingEdge';
import { gmMissingInputs, type GmMissing } from '../compute/gm';
import type { gmManifest } from '../compute/gmTemplate';
import type { AutoMeasurements, EdgeAngleCurve, FlakeDerived, GmDerived, RetouchAngleCurve } from '../core/derived';
import { hasEdgeAngles, hasVolumeSplit } from '../core/fields';
import { measurementValue } from '../core/measurements';
import { hasVector, type ProjectState, type Vec3 } from '../core/types';
import { configurationCsv, csvCell, curveCsv, edgeAnglesCsv, edgeSharpCsv, invasivenessCsv, retouchAnglesCsv, retouchSectionsCsv, retouchSegmentsCsv, flakesCsv, flakingSurfacesCsv, fmt, manualMeasurementsCsv, measurementsCsv, planesCsv, regionsCsv, relationsCsv, scarVectorCsv, seriesCsv, workingEdgesCsv, type CsvOptions } from './csv';
import { gmCurvesCsv, gmLandmarksCsv, gmModelsCsv, gmOutlinesCsv, gmSmvectorCsv, gmSurfacesCsv, gmSurpCsv, landmarksCsv, landmarksTps } from './landmarks';

/** One specimen of a batch: its project (or a fresh one), measured on its model. */
export interface BatchSpecimen {
  /** The model's path in the folder. */
  file: string;
  state: ProjectState;
  auto: AutoMeasurements;
  /** Recomputed from the project's inputs. */
  planes: PlaneResult[];
  /** Recomputed from the project's inputs and the model's box (the bicone: and the stored volume split). */
  configuration: CoreConfiguration | null;
  /** From the project file's derived results (the values the app last computed). */
  regions: RegionResult[];
  regionTotals: RegionTotals | null;
  nodule: { radius: number; rms: number } | null;
  split: { upper: number; lower: number; ratio: number | null } | null;
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
  /** Each observer's values (annotator → measure → value), from every project file of the model, for the ICC. */
  observers: Map<string, Record<string, number>>;
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

/** The volume split as stored in a project file, or null. */
function storedSplit(v: unknown): BatchSpecimen['split'] {
  const s = v as BatchSpecimen['split'] | undefined;
  return s && Number.isFinite(s.upper) && Number.isFinite(s.lower) ? { upper: s.upper, lower: s.lower, ratio: typeof s.ratio === 'number' ? s.ratio : null } : null;
}

/** A region plane's fit as stored with the results (it needs the mesh and the regions to compute again). */
function storedRegionFit(planes: unknown, id: string): { centroid: Vec3; normal: Vec3; count: number } | null {
  const p = Array.isArray(planes) ? (planes as PlaneResult[]).find((x) => x.id === id && x.method === 'region' && x.valid) : undefined;
  return p?.center && p.normal ? { centroid: p.center, normal: p.normal, count: p.inputCount } : null;
}

/** The automatic measurements as stored in a project file, or null. */
function storedAuto(v: unknown): AutoMeasurements | null {
  const m = v as AutoMeasurements | null | undefined;
  return m && (m.frame === 'specimen' || m.frame === 'principal') && [m.length, m.width, m.thickness, m.surfaceArea].every((x) => typeof x === 'number' && Number.isFinite(x)) ? m : null;
}

/**
 * The results a project stored can stand for its model's (no need to read the
 * mesh): written by this version of the app, with the automatic measurements,
 * — when it has planes — the vertices' axes and — when it has arrows — the box of
 * its volumetric configuration (not needed by the bicone, which uses the stored split). (The checksum is checked by the caller: the
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
 * One specimen of a batch export: the row comes from `primary` (the model's own
 * project, or a fresh one) and its measures; every project of the model is an
 * observer for the ICC (told apart by annotator, else by file). The same for
 * stored and recomputed measures, so both give the same tables.
 */
export function batchSpecimen(file: string, primary: { project: BatchProject; measures: ModelMeasures }, projects: ReadonlyArray<{ project: BatchProject; measures: ModelMeasures }>): BatchSpecimen {
  const observers = new Map<string, Record<string, number>>();
  for (const { project: p, measures } of projects) {
    const st = p.state;
    const who = st.specimen.annotator || p.path || '';
    if (observers.has(who)) continue;
    const a = measures.auto;
    const values: Record<string, number> = { length: a.length, width: a.width, thickness: a.thickness };
    const totals = p.derived.regionTotals as { cortexRatio?: number } | null | undefined;
    if (typeof totals?.cortexRatio === 'number') values.cortex_ratio = totals.cortexRatio;
    const nod = p.derived.nodule as { radius?: number } | null | undefined;
    if (typeof nod?.radius === 'number') values.nodule_radius = nod.radius;
    const sp = p.derived.split as { ratio?: number | null } | null | undefined;
    if (hasVolumeSplit(st.specimen.type) && typeof sp?.ratio === 'number') values.volume_ratio = sp.ratio;
    for (const m of st.measurements) values[m.label] = measurementValue(m);
    observers.set(who, values);
  }
  const { state, derived } = primary.project;
  // what a file stored under another type is not exported under this one
  const split = hasVolumeSplit(state.specimen.type) ? storedSplit(derived.split) : null;
  const edges = hasEdgeAngles(state.specimen.type);
  return {
    file,
    state,
    auto: primary.measures.auto,
    planes: state.planes.map((p) => computePlane(p, state, primary.measures.vertices, storedRegionFit(derived.planes, p.id))),
    configuration: state.specimen.type === 'core' ? coreConfiguration(state, primary.measures.box, split) : null,
    regions: (derived.regions as BatchSpecimen['regions']) ?? [],
    regionTotals: (derived.regionTotals as BatchSpecimen['regionTotals']) ?? null,
    nodule: (derived.nodule as BatchSpecimen['nodule']) ?? null,
    split,
    flake: state.specimen.type === 'flake' ? ((derived.flake as FlakeDerived | null | undefined)?.measures ?? null) : null,
    edgeAngles: edges ? ((derived.edgeAngles as { curves?: EdgeAngleCurve[] } | null | undefined)?.curves ?? []) : [],
    retouchAngles: edges ? ((derived.retouchAngles as { curves?: RetouchAngleCurve[] } | null | undefined)?.curves ?? []) : [],
    retouchIndices: state.specimen.type === 'flake' ? ((derived.retouchIndices as RetouchIndices | null | undefined) ?? null) : null,
    workingEdges: edges ? ((derived.workingEdges as WorkingEdgesDerived | null | undefined)?.edges ?? []) : [],
    gm: (derived.gm as GmDerived | null | undefined) ?? null,
    observers,
  };
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
export function gmOutputs(specimens: readonly BatchSpecimen[], opts: CsvOptions): { files: Array<{ suffix: string; text: string }>; skipped: GmSkipped[]; incomplete: GmSkipped[] } {
  const plain = { excelBom: false };
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
    { suffix: 'gm_landmarks.csv', text: mergeCsv(kept.map((s) => gmLandmarksCsv(s.state, s.gm, plain)), opts.excelBom) },
    { suffix: 'gm_landmarks.tps', text: kept.map((s) => landmarksTps(s.state, s.gm)).join('') },
  ];
  // by the grid the files stay those it always had; by a template Morpho's definitions as well
  const morpho = first.method === 'template';
  if (first.curves.length) files.push({ suffix: 'gm_curves.csv', text: gmCurvesCsv(first) });
  if (first.curves.length && morpho) files.push({ suffix: 'gm_smvector.csv', text: gmSmvectorCsv(first) }, { suffix: 'gm_outlines.csv', text: gmOutlinesCsv(first) });
  if (first.surfaces.length) files.push({ suffix: 'gm_surfaces.csv', text: gmSurfacesCsv(first) });
  if (first.surfaces.length && morpho) files.push({ suffix: 'gm_surp.csv', text: gmSurpCsv(first) });
  if (morpho) files.push({ suffix: 'gm_models.csv', text: gmModelsCsv(kept.map((s) => ({ id: s.state.specimen.id, file: s.file }))) });
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
 * ICC(2,1) of each measure over the specimens that every observer measured
 * (observers by annotator name). Null with fewer than two observers or
 * nothing measured by all of them on two specimens or more.
 */
export function iccCsv(specimens: readonly BatchSpecimen[]): string | null {
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
  const merged = (make: (s: BatchSpecimen) => string, among: readonly BatchSpecimen[] = specimens) => mergeCsv(among.map(make), opts.excelBom);
  // what a generic specimen does not have, whatever it held on another type
  const typed = specimens.filter((s) => s.state.specimen.type !== 'generic');
  const out: Array<{ suffix: string; text: string }> = [
    { suffix: 'measurements.csv', text: merged((s) => measurementsCsv(s.state, s.auto, plain, s.regionTotals, s.nodule, s.split, s.file)) },
  ];
  const kinds: Array<[string, (s: BatchSpecimen) => string, (readonly BatchSpecimen[])?]> = [
    ['scar_vectors.csv', (s) => scarVectorCsv(s.state, plain, s.configuration)],
    ['curves.csv', (s) => curveCsv(s.state, plain)],
    ['manual_measurements.csv', (s) => manualMeasurementsCsv(s.state, plain)],
    ['planes.csv', (s) => planesCsv(s.state, s.planes, plain)],
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
  if (flakes.length) out.push({ suffix: 'flakes.csv', text: mergeCsv(flakes.map((s) => flakesCsv(s.state, s.flake, plain, s.retouchIndices ?? null)), opts.excelBom) });
  // the volumetric configuration: specimens that have one (arrows on a measured model)
  const configured = specimens.filter((s) => s.configuration);
  if (configured.length) {
    out.push({ suffix: 'configuration.csv', text: mergeCsv(configured.map((s) => configurationCsv(s.state, s.configuration, plain, s.file)), opts.excelBom) });
    const surfaces = mergeCsv(configured.map((s) => flakingSurfacesCsv(s.state, s.configuration, plain, s.file)), opts.excelBom);
    if (hasRows(surfaces)) out.push({ suffix: 'flaking_surfaces.csv', text: surfaces });
  }
  const tps = specimens.filter((s) => s.state.landmarks.length || s.state.semilandmarks.length).map((s) => landmarksTps(s.state, landmarkTable(s.state)));
  if (tps.length) out.push({ suffix: 'landmarks.tps', text: tps.join('') });
  const icc = iccCsv(specimens);
  if (icc) out.push({ suffix: 'icc.csv', text: (opts.excelBom ? '﻿' : '') + icc });
  return out;
}

import { icc21 } from '../compute/agreement';
import { landmarkTable } from '../compute/landmarks';
import type { PlaneResult } from '../compute/planes';
import type { RegionResult, RegionTotals } from '../compute/regions';
import type { AutoMeasurements } from '../core/derived';
import type { ProjectState } from '../core/types';
import { csvCell, curveCsv, fmt, manualMeasurementsCsv, measurementsCsv, planesCsv, regionsCsv, relationsCsv, scarVectorCsv, seriesCsv, type CsvOptions } from './csv';
import { landmarksCsv, landmarksTps } from './landmarks';

/** One specimen of a batch: its project (or a fresh one), measured on its model. */
export interface BatchSpecimen {
  state: ProjectState;
  auto: AutoMeasurements;
  /** Recomputed from the project's inputs. */
  planes: PlaneResult[];
  /** From the project file's derived results (the values the app last computed). */
  regions: RegionResult[];
  regionTotals: RegionTotals | null;
  nodule: { radius: number; rms: number } | null;
  split: { upper: number; lower: number; ratio: number | null } | null;
  /** Each observer's values (annotator → measure → value), from every project file of the model, for the ICC. */
  observers: Map<string, Record<string, number>>;
}

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
  const merged = (make: (s: BatchSpecimen) => string) => mergeCsv(specimens.map(make), opts.excelBom);
  const out: Array<{ suffix: string; text: string }> = [
    { suffix: 'measurements.csv', text: merged((s) => measurementsCsv(s.state, s.auto, plain, s.regionTotals, s.nodule, s.split)) },
  ];
  const kinds: Array<[string, (s: BatchSpecimen) => string]> = [
    ['scar_vectors.csv', (s) => scarVectorCsv(s.state, plain)],
    ['curves.csv', (s) => curveCsv(s.state, plain)],
    ['manual_measurements.csv', (s) => manualMeasurementsCsv(s.state, plain)],
    ['planes.csv', (s) => planesCsv(s.state, s.planes, plain)],
    ['regions.csv', (s) => regionsCsv(s.state, s.regions, plain)],
    ['relations.csv', (s) => relationsCsv(s.state, plain)],
    ['series.csv', (s) => seriesCsv(s.state, plain)],
    ['landmarks.csv', (s) => landmarksCsv(s.state, landmarkTable(s.state), plain)],
  ];
  for (const [suffix, make] of kinds) {
    const text = merged(make);
    if (hasRows(text)) out.push({ suffix, text });
  }
  const tps = specimens.filter((s) => s.state.landmarks.length || s.state.semilandmarks.length).map((s) => landmarksTps(s.state, landmarkTable(s.state)));
  if (tps.length) out.push({ suffix: 'landmarks.tps', text: tps.join('') });
  const icc = iccCsv(specimens);
  if (icc) out.push({ suffix: 'icc.csv', text: (opts.excelBom ? '﻿' : '') + icc });
  return out;
}

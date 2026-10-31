import type { ConfigurationResult } from '../compute/configuration';
import type { PlaneResult } from '../compute/planes';
import { curveLength } from '../core/curveGeometry';
import type { RegionResult, RegionTotals } from '../compute/regions';
import type { AgreementRow, SummaryRow } from '../compute/agreement';
import type { AutoMeasurements } from '../core/derived';
import { CURVE_FIELDS, SCAR_FIELDS } from '../core/fields';
import { measurementUnit, measurementValue } from '../core/measurements';
import { vectorLength } from '../core/store';
import { hasVector, type ProjectState } from '../core/types';
import { distance } from '../core/vec';

export interface CsvOptions {
  /** Prefix a UTF-8 byte-order mark so Excel shows non-ASCII notes correctly. */
  excelBom: boolean;
}

export const fmt = (n: number): string => {
  if (!Number.isFinite(n)) return '';
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
};

export const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * One row per scar with a direction arrow, coordinates in the original mesh
 * coordinate system (scars without an arrow are left out).
 * Enumerated fields are written as their codes (e.g. "bulb_truncated"), which
 * stay the same in every interface language. `platform_face` and
 * `flaking_surface` come from the volumetric configuration (empty without it,
 * or for a scar on a face that is no flaking surface).
 */
export function scarVectorCsv(state: Readonly<ProjectState>, opts: CsvOptions, config: ConfigurationResult | null = null): string {
  const header = [
    'specimen_id',
    'scar_id',
    'start_x',
    'start_y',
    'start_z',
    'end_x',
    'end_y',
    'end_z',
    'length',
    ...SCAR_FIELDS.map((f) => f.key),
    'platform_face',
    'flaking_surface',
    'unit',
  ];
  const placed = new Map((config?.scars ?? []).map((p) => [p.id, p]));
  const rows = state.scars.filter(hasVector).map((a) =>
    [
      csvCell(state.specimen.id),
      csvCell(a.label),
      fmt(a.vector.start[0]),
      fmt(a.vector.start[1]),
      fmt(a.vector.start[2]),
      fmt(a.vector.end[0]),
      fmt(a.vector.end[1]),
      fmt(a.vector.end[2]),
      fmt(vectorLength(a.vector)),
      ...SCAR_FIELDS.map((f) => csvCell(a.attributes[f.key])),
      placed.get(a.id)?.platform ?? '',
      placed.get(a.id)?.surface ?? '',
      csvCell(state.specimen.unit),
    ].join(','),
  );
  const body = [header.join(','), ...rows].join('\n') + '\n';
  return (opts.excelBom ? '﻿' : '') + body;
}

/**
 * One row per curve point, in order along each curve (long format).
 * `arc_length` is the distance along the curve from its first point; `anchor`
 * marks points placed by the user; a closed curve's last point connects back
 * to its first, and `length` (the whole curve) includes that closing segment.
 */
export function curveCsv(state: Readonly<ProjectState>, opts: CsvOptions): string {
  const header = [
    'specimen_id',
    'curve_id',
    'point_index',
    'x',
    'y',
    'z',
    'arc_length',
    'anchor',
    'closed',
    'length',
    ...CURVE_FIELDS.map((f) => f.key),
    'unit',
  ];
  const rows: string[] = [];
  for (const c of state.curves) {
    const anchors = new Set(c.anchorIndex);
    const total = fmt(curveLength(c));
    const tail = [...CURVE_FIELDS.map((f) => csvCell(c.attributes[f.key])), csvCell(state.specimen.unit)].join(',');
    let arc = 0;
    c.points.forEach((p, i) => {
      if (i > 0) arc += distance(c.points[i - 1], p);
      rows.push(
        [
          csvCell(state.specimen.id),
          csvCell(c.label),
          String(i),
          fmt(p[0]),
          fmt(p[1]),
          fmt(p[2]),
          fmt(arc),
          anchors.has(i) ? 'true' : 'false',
          c.closed ? 'true' : 'false',
          total,
          tail,
        ].join(','),
      );
    });
  }
  const body = [header.join(','), ...rows].join('\n') + '\n';
  return (opts.excelBom ? '\uFEFF' : '') + body;
}

const cell = (n: number | null): string => (n === null ? '' : fmt(n));

/**
 * One row per specimen: the automatic measurements. Lengths are in the
 * specimen unit, the area in unit², the volume in unit³; volume-based values
 * are empty when the mesh is not closed (or not yet measured). `file` is the
 * model (its path in a folder; by default its file name).
 */
export function measurementsCsv(
  state: Readonly<ProjectState>,
  auto: AutoMeasurements | null,
  opts: CsvOptions,
  regions: RegionTotals | null = null,
  nodule: { radius: number; rms: number } | null = null,
  split: { upper: number; lower: number; ratio: number | null } | null = null,
  file: string = state.mesh?.fileName ?? '',
): string {
  const header = [
    'specimen_id',
    'unit',
    'frame',
    'length',
    'width',
    'thickness',
    'surface_area',
    'volume',
    'surface_to_volume_ratio',
    'wadell_sphericity',
    'closed',
    'area_scar',
    'area_cortex',
    'area_joint',
    'area_damage',
    'cortex_ratio',
    'nodule_radius',
    'nodule_fit_rms',
    'volume_upper',
    'volume_lower',
    'volume_ratio',
    'file',
  ];
  const row = [
    csvCell(state.specimen.id),
    csvCell(state.specimen.unit),
    auto?.frame ?? '',
    cell(auto?.length ?? null),
    cell(auto?.width ?? null),
    cell(auto?.thickness ?? null),
    cell(auto?.surfaceArea ?? null),
    cell(auto?.volume ?? null),
    cell(auto?.surfaceToVolumeRatio ?? null),
    cell(auto?.wadellSphericity ?? null),
    auto ? String(auto.closed) : '',
    cell(regions?.scar ?? null),
    cell(regions?.cortex ?? null),
    cell(regions?.joint ?? null),
    cell(regions?.damage ?? null),
    cell(regions?.cortexRatio ?? null),
    cell(nodule?.radius ?? null),
    cell(nodule?.rms ?? null),
    cell(split?.upper ?? null),
    cell(split?.lower ?? null),
    cell(split?.ratio ?? null),
    csvCell(file),
  ];
  return (opts.excelBom ? '﻿' : '') + [header.join(','), row.join(',')].join('\n') + '\n';
}

/** One row per manual measurement; points it does not use are left empty; angles are in degrees. */
export function manualMeasurementsCsv(state: Readonly<ProjectState>, opts: CsvOptions): string {
  const header = ['specimen_id', 'measure_id', 'type', 'value', 'unit'];
  for (let i = 1; i <= 3; i++) header.push(`p${i}_x`, `p${i}_y`, `p${i}_z`);
  const rows = state.measurements.map((m) => {
    const pts: string[] = [];
    for (let i = 0; i < 3; i++) {
      const p = m.points[i];
      pts.push(...(p ? [fmt(p[0]), fmt(p[1]), fmt(p[2])] : ['', '', '']));
    }
    return [csvCell(state.specimen.id), csvCell(m.label), m.type, fmt(measurementValue(m)), csvCell(measurementUnit(m, state.specimen.unit)), ...pts].join(',');
  });
  return (opts.excelBom ? '﻿' : '') + [header.join(','), ...rows].join('\n') + '\n';
}

/** One row per fitted plane; `m00 … m33` is the row-major matrix from original to plane coordinates. Invalid planes have empty numbers. */
export function planesCsv(state: Readonly<ProjectState>, planes: PlaneResult[], opts: CsvOptions): string {
  const header = ['specimen_id', 'plane_id', 'method', 'center_x', 'center_y', 'center_z', 'normal_x', 'normal_y', 'normal_z'];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) header.push(`m${r}${c}`);
  const rows = planes.map((p) => {
    const nums = p.valid && p.center && p.normal && p.matrix ? [...p.center, ...p.normal, ...p.matrix].map(fmt) : new Array<string>(22).fill('');
    return [csvCell(state.specimen.id), csvCell(p.label), p.method, ...nums].join(',');
  });
  return (opts.excelBom ? '﻿' : '') + [header.join(','), ...rows].join('\n') + '\n';
}

/** One row per surface region; `scar_id` is the label of the scar it belongs to; area in unit². */
export function regionsCsv(state: Readonly<ProjectState>, regions: RegionResult[], opts: CsvOptions): string {
  const header = ['specimen_id', 'region_id', 'type', 'scar_id', 'area', 'unit'];
  const rows = regions.map((r) => {
    const scar = r.scarId ? state.scars.find((s) => s.id === r.scarId)?.label ?? '' : '';
    return [csvCell(state.specimen.id), csvCell(r.label), r.type, csvCell(scar), cell(r.area), csvCell(state.specimen.unit)].join(',');
  });
  return (opts.excelBom ? '\uFEFF' : '') + [header.join(','), ...rows].join('\n') + '\n';
}

/** One row per recorded relation: `a_cuts_b` (scar_a is later than scar_b) or `indeterminate`; scars by label. */
export function relationsCsv(state: Readonly<ProjectState>, opts: CsvOptions): string {
  const label = new Map(state.scars.map((s) => [s.id, s.label]));
  const rows = state.relations
    .filter((r) => label.has(r.a) && label.has(r.b))
    .map((r) => [csvCell(state.specimen.id), csvCell(label.get(r.a)), csvCell(label.get(r.b)), r.kind].join(','));
  return (opts.excelBom ? '﻿' : '') + [['specimen_id', 'scar_a', 'scar_b', 'relation'].join(','), ...rows].join('\n') + '\n';
}

/**
 * One row per scar in a sequence: `series_order` counts the sequences from the
 * earliest (1); `order_in_series` counts the scars from the earliest, and is
 * empty when the order within the sequence is not set.
 */
export function seriesCsv(state: Readonly<ProjectState>, opts: CsvOptions): string {
  const label = new Map(state.scars.map((s) => [s.id, s.label]));
  const rows: string[] = [];
  state.sequences.forEach((q, i) => {
    q.scarIds
      .filter((id) => label.has(id))
      .forEach((id, k) => rows.push([csvCell(state.specimen.id), csvCell(q.label), String(i + 1), csvCell(label.get(id)), q.ordered ? String(k + 1) : ''].join(',')));
  });
  return (opts.excelBom ? '﻿' : '') + [['specimen_id', 'series_id', 'series_order', 'scar_id', 'order_in_series'].join(','), ...rows].join('\n') + '\n';
}

/**
 * Volumetric configuration, one row per specimen (codes; empty without a flaking surface,
 * or without arrows). `file`: the model's path, in a summary export only.
 */
export function configurationCsv(state: Readonly<ProjectState>, config: ConfigurationResult | null, opts: CsvOptions, file?: string): string {
  const header = ['specimen_id', 'frame', 'facial_character', 'flaking_surface_relation', 'platform_relation', 'polarity'];
  const row = [csvCell(state.specimen.id), config?.frame ?? '', config?.facialCharacter ?? '', config?.flakingSurfaceRelation ?? '', config?.platformRelation ?? '', config?.polarity ?? ''];
  if (file !== undefined) {
    header.push('file');
    row.push(csvCell(file));
  }
  return (opts.excelBom ? '﻿' : '') + [header.join(','), row.join(',')].join('\n') + '\n';
}

/** One row per flaking surface: its faces and platforms (face codes joined by ";"), scars, type and exploitation axis. */
export function flakingSurfacesCsv(state: Readonly<ProjectState>, config: ConfigurationResult | null, opts: CsvOptions, file?: string): string {
  const header = ['specimen_id', 'surface_id', 'faces', 'platforms', 'also_platform', 'n_scars', 'surface_type', 'exploitation_axis'];
  if (file !== undefined) header.push('file');
  const rows = (config?.surfaces ?? []).map((s) => {
    const row = [csvCell(state.specimen.id), s.id, s.faces.join(';'), s.platforms.join(';'), String(s.alsoPlatform), String(s.scarIds.length), s.type, s.axis];
    if (file !== undefined) row.push(csvCell(file));
    return row.join(',');
  });
  return (opts.excelBom ? '﻿' : '') + [header.join(','), ...rows].join('\n') + '\n';
}

/** Observer agreement, one row per value (long format); `value` is empty when undefined (e.g. κ with one category). */
export function agreementCsv(specimenId: string, rows: readonly AgreementRow[], opts: CsvOptions): string {
  const header = 'specimen_id,item_type,item_key,annotator_a,annotator_b,metric,value';
  const body = rows.map((r) => [csvCell(specimenId), r.itemType, csvCell(r.itemKey), csvCell(r.a), csvCell(r.b), r.metric, fmt(r.value)].join(','));
  return (opts.excelBom ? '\uFEFF' : '') + [header, ...body].join('\n') + '\n';
}

/** The agreement table summarised by item type, metric and pair of observers. */
export function agreementSummaryCsv(specimenId: string, rows: readonly SummaryRow[], opts: CsvOptions): string {
  const header = 'specimen_id,item_type,metric,annotator_a,annotator_b,n,mean,sd,min,max';
  const body = rows.map((r) => [csvCell(specimenId), r.itemType, r.metric, csvCell(r.a), csvCell(r.b), String(r.n), fmt(r.mean), fmt(r.sd), fmt(r.min), fmt(r.max)].join(','));
  return (opts.excelBom ? '\uFEFF' : '') + [header, ...body].join('\n') + '\n';
}

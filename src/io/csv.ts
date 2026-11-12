import type { RetouchAngleCurve } from '../core/derived';
import { isBicone, type CoreConfiguration } from '../compute/bicone';
import { FLAKE_MEASURES, type FlakeMeasures } from '../compute/flake';
import { techAngleDeg } from '../compute/technicalFrame';
import type { PlaneResult } from '../compute/planes';
import { curveLength } from '../core/curveGeometry';
import type { RegionResult, RegionTotals } from '../compute/regions';
import type { AgreementRow, SummaryRow } from '../compute/agreement';
import { EDGE_ANGLE_DISTANCES_MM, EDGE_ANGLE_METHODS } from '../compute/edgeAngle';
import { RETOUCH_ANGLE_METHODS } from '../compute/retouchAngle';
import { RETOUCH_SUMMARY, type RetouchIndices } from '../compute/retouchIndex';
import { sharpOfCurve } from '../compute/sharpEdge';
import { measuredLine } from '../compute/measuredLine';
import { edgeAxis, edgeLabels, placedEdges, sharpPieces, type WorkingEdgeRow } from '../compute/workingEdge';
import { frameSource, type AutoMeasurements, type EdgeAngleCurve } from '../core/derived';
import { CURVE_FIELDS, SCAR_FIELDS } from '../core/fields';
import { measurementUnit, measurementValue } from '../core/measurements';
import { vectorLength } from '../core/store';
import { hasVector, scarSources, type ProjectState } from '../core/types';
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
 * or for a scar on a face or cone that is no flaking surface; the bicone has no
 * platforms). `source` says where an imported arrow came from (`iges:<file name>`), empty for one drawn here.
 */
export function scarVectorCsv(state: Readonly<ProjectState>, opts: CsvOptions, config: CoreConfiguration | null = null): string {
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
    'tech_angle_deg',
    'source',
  ];
  const sources = scarSources(state);
  const placed = new Map<string, { platform?: string; surface: string | null }>((config?.scars ?? []).map((p) => [p.id, p]));
  const flakeFrame = state.specimen.type === 'flake' ? state.flake.axis?.matrix ?? null : null;
  // a generic specimen's arrows have no scar attributes, whatever they held on another type
  const attribute = (a: { attributes: Record<string, unknown> }, key: string) => (state.specimen.type === 'generic' ? '' : csvCell(a.attributes[key]));
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
      ...SCAR_FIELDS.map((f) => attribute(a, f.key)),
      placed.get(a.id)?.platform ?? '',
      placed.get(a.id)?.surface ?? '',
      csvCell(state.specimen.unit),
      // a flake's scars, in its technical frame
      flakeFrame ? cell(techAngleDeg(flakeFrame, a.vector.start, a.vector.end)) : '',
      csvCell(sources.get(a.id) ?? ''),
    ].join(','),
  );
  const body = [header.join(','), ...rows].join('\n') + '\n';
  return (opts.excelBom ? '﻿' : '') + body;
}

/** Long format: one row per station, distance and method of each curve measured (`angle_deg` empty where the section ends before the distance). */
export function edgeAnglesCsv(state: Readonly<ProjectState>, curves: readonly EdgeAngleCurve[], opts: CsvOptions): string {
  const header = 'specimen_id,curve_id,curve_type,station,position,distance,method,angle_deg,working_edge';
  const rows: string[] = [];
  const edgeAt = edgeLabels(state);
  for (const r of curves) {
    const c = state.curves.find((x) => x.id === r.curveId);
    if (!c) continue;
    r.stations.forEach((s, k) => {
      const edge = csvCell(edgeAt(c.id, s.position));
      r.distances.forEach((d, i) => {
        for (const m of EDGE_ANGLE_METHODS) rows.push([csvCell(state.specimen.id), csvCell(c.label), csvCell(c.attributes.type), String(k), fmt(s.position), fmt(d), m, cell(s[m][i]), edge].join(','));
      });
    });
  }
  return (opts.excelBom ? '﻿' : '') + [header, ...rows].join('\n') + '\n';
}

/**
 * Long format: one row per station, retouch layer and method of each curve measured. `distance`: from the edge to the layer's
 * outer end, along the section; `retouch_region`: the region where the layer begins; `angle_deg` empty where the other side ends first.
 */
export function retouchAnglesCsv(state: Readonly<ProjectState>, curves: readonly RetouchAngleCurve[], opts: CsvOptions): string {
  const header = 'specimen_id,curve_id,station,position,retouch_region,retouch_layer,distance,method,angle_deg,working_edge';
  const rows: string[] = [];
  const edgeAt = edgeLabels(state);
  for (const r of curves) {
    const c = state.curves.find((x) => x.id === r.curveId);
    if (!c) continue;
    r.stations.forEach((s, k) => {
      const edge = csvCell(edgeAt(c.id, s.position));
      for (const x of s.stretches) {
        const region = state.regions.find((g) => g.id === x.region)?.label ?? '';
        for (const m of RETOUCH_ANGLE_METHODS) rows.push([csvCell(state.specimen.id), csvCell(c.label), String(k), fmt(s.position), csvCell(region), String(x.layer), fmt(x.distance), m, cell(x[m]), edge].join(','));
      }
    });
  }
  return (opts.excelBom ? '﻿' : '') + [header, ...rows].join('\n') + '\n';
}

/** One row per retouched station of each curve measured (`filled`: its missing area comes from the stations on either side). */
export function retouchSectionsCsv(state: Readonly<ProjectState>, r: RetouchIndices | null, opts: CsvOptions): string {
  const header = 'specimen_id,curve_id,station,position,segment,x,y,depth_dorsal,depth_ventral,removed_area,filled,original_angle_deg,recession,retouch_height,thickness,giur,working_edge';
  const label = new Map(state.curves.map((c) => [c.id, c.label]));
  const edgeAt = edgeLabels(state);
  const rows = (r?.stations ?? []).filter((s) => label.has(s.curveId)).map((s) =>
    [csvCell(state.specimen.id), csvCell(label.get(s.curveId)), String(s.station), fmt(s.position), cell(s.segment), cell(s.x), cell(s.y), cell(s.depth_dorsal), cell(s.depth_ventral), cell(s.removed_area), String(s.filled), cell(s.original_angle_deg), cell(s.recession), cell(s.retouch_height), cell(s.thickness), cell(s.giur), csvCell(edgeAt(s.curveId, s.position))].join(','),
  );
  return (opts.excelBom ? '\uFEFF' : '') + [header, ...rows].join('\n') + '\n';
}

/** One row per retouch region on each curve measured; regions by label; `chord` and `depth` empty where it goes all round the curve. */
export function retouchSegmentsCsv(state: Readonly<ProjectState>, r: RetouchIndices | null, opts: CsvOptions): string {
  const header = 'specimen_id,curve_id,retouch_region,retouch_layer,face,start_position,end_position,length,chord,depth,working_edge';
  const label = new Map(state.curves.map((c) => [c.id, c.label]));
  const edgeAt = edgeLabels(state);
  const rows = (r?.segments ?? []).filter((s) => label.has(s.curveId)).map((s) =>
    [csvCell(state.specimen.id), csvCell(label.get(s.curveId)), csvCell(state.regions.find((g) => g.id === s.region)?.label ?? ''), String(s.layer), s.face ?? '', fmt(s.start_position), fmt(s.end_position), fmt(s.length), cell(s.chord), cell(s.depth), csvCell(edgeAt(s.curveId, s.middle ?? (s.start_position + s.end_position) / 2))].join(','),
  );
  return (opts.excelBom ? '\uFEFF' : '') + [header, ...rows].join('\n') + '\n';
}

/** The sixteen segments of a flake: how far in the retouch reaches (`penetration`, 0–1) and the score. */
export function invasivenessCsv(state: Readonly<ProjectState>, r: RetouchIndices | null, opts: CsvOptions): string {
  const rows = (r?.penetration ?? []).map((s) => [csvCell(state.specimen.id), s.face, String(s.segment), fmt(s.penetration), fmt(s.score)].join(','));
  return (opts.excelBom ? '\uFEFF' : '') + ['specimen_id,face,segment,penetration,score', ...rows].join('\n') + '\n';
}

/** One row per sharp stretch of each curve measured, under the project's rule (none without a threshold); lengths in the coordinate unit. */
export function edgeSharpCsv(state: Readonly<ProjectState>, curves: readonly EdgeAngleCurve[], opts: CsvOptions): string {
  const header = 'specimen_id,curve_id,method,distance,threshold_deg,segment,start_position,end_position,length,working_edge';
  const rows: string[] = [];
  const rule = state.sharpEdge;
  for (const r of curves) {
    const c = state.curves.find((x) => x.id === r.curveId);
    const line = c ? measuredLine(c, state) : null;
    const sharp = line ? sharpOfCurve(r, line.closed, rule, state.specimen.unit) : null;
    if (!c || !line || !sharp) continue;
    const distance = r.distances[EDGE_ANGLE_DISTANCES_MM.indexOf(rule.distance as (typeof EDGE_ANGLE_DISTANCES_MM)[number])] ?? null;
    // cut where a working edge begins or ends
    const axis = edgeAxis(line, state.specimen.unit);
    const placed = placedEdges(axis, state.workingEdges.filter((e) => e.curveId === c.id));
    for (const s of sharpPieces(sharp.segments, placed, r.length, line.closed)) rows.push([csvCell(state.specimen.id), csvCell(c.label), rule.method, cell(distance), cell(rule.threshold), String(s.segment), fmt(s.start), fmt(s.end), fmt(s.length), csvCell(s.edge)].join(','));
  }
  return (opts.excelBom ? '﻿' : '') + [header, ...rows].join('\n') + '\n';
}

/** The columns of working_edges.csv after `specimen_id`. */
export const WORKING_EDGE_COLUMNS = ['working_edge', 'name', 'curve_id', 'start_position', 'end_position', 'length', 'sharp_length', 'retouched_length', 'retouch_perimeter', 'retouch_perimeter_dorsal', 'retouch_perimeter_ventral', 'removed_volume', 'erp', 'erp_filled_share', 'giur', 'giur_stations', 'edge_curvature', 'edge_curvature_chord', 'edge_curvature_depth'] as const;

/**
 * One row per working edge of the curves measured, and one per such curve without any (`working_edge` empty): lengths in the coordinate
 * unit, ratios as 0–1. The columns from the retouch indices are empty but for a flake. The sharp length is judged anew by the
 * state's rule (in a folder, the folder's), from the curves' edge angles.
 */
export function workingEdgesCsv(state: Readonly<ProjectState>, edges: readonly WorkingEdgeRow[], curves: readonly EdgeAngleCurve[], opts: CsvOptions): string {
  const label = new Map(state.curves.map((c) => [c.id, c.label]));
  const rule = state.sharpEdge;
  const sharpLength = (e: WorkingEdgeRow): number | null => {
    const c = state.curves.find((x) => x.id === e.curveId), r = curves.find((x) => x.curveId === e.curveId);
    const line = c ? measuredLine(c, state) : null;
    const sharp = line && r && state.specimen.type !== 'generic' ? sharpOfCurve(r, line.closed, rule, state.specimen.unit) : null;
    if (!c || !line || !r || !sharp) return null;
    if (!e.label) return sharp.length;
    const placed = placedEdges(edgeAxis(line, state.specimen.unit), state.workingEdges.filter((x) => x.curveId === c.id));
    return sharpPieces(sharp.segments, placed, r.length, line.closed).filter((p) => p.edge === e.label).reduce((s, p) => s + p.length, 0);
  };
  const rows = edges.filter((e) => label.has(e.curveId)).map((e) =>
    [
      csvCell(state.specimen.id),
      csvCell(e.label),
      csvCell(e.name),
      csvCell(label.get(e.curveId)),
      fmt(e.start_position),
      fmt(e.end_position),
      fmt(e.length),
      cell(sharpLength(e)),
      cell(e.retouched_length),
      cell(e.retouch_perimeter),
      cell(e.retouch_perimeter_dorsal),
      cell(e.retouch_perimeter_ventral),
      cell(e.removed_volume),
      cell(e.erp),
      cell(e.erp_filled_share),
      cell(e.giur),
      cell(e.giur_stations),
      cell(e.edge_curvature),
      cell(e.edge_curvature_chord),
      cell(e.edge_curvature_depth),
    ].join(','),
  );
  return (opts.excelBom ? '\uFEFF' : '') + [['specimen_id', ...WORKING_EDGE_COLUMNS].join(','), ...rows].join('\n') + '\n';
}

/** What flakes.csv has of the retouch indices, after the measurements. */
export const RETOUCH_FLAKE_COLUMNS = ['retouch_axis', 'retouch_fit_length', ...RETOUCH_SUMMARY] as const;

/**
 * One row per flake: where its frame came from, and its measurements (empty where there is no value; lengths in the specimen's unit), then
 * its retouch indices (`retouch`: null when they have not been computed; left out: the measurements alone).
 */
export function flakesCsv(state: Readonly<ProjectState>, measures: FlakeMeasures | null, opts: CsvOptions, retouch?: RetouchIndices | null): string {
  const header: string[] = ['specimen_id', 'unit', 'frame_source', ...FLAKE_MEASURES];
  const row = [csvCell(state.specimen.id), csvCell(state.specimen.unit), csvCell(frameSource(state)), ...FLAKE_MEASURES.map((k) => cell(measures?.[k] ?? null))];
  if (retouch !== undefined) {
    header.push(...RETOUCH_FLAKE_COLUMNS);
    row.push(retouch?.axis ?? '', cell(retouch?.fitLength ?? null), ...RETOUCH_SUMMARY.map((k) => cell(retouch?.[k] ?? null)));
  }
  return (opts.excelBom ? '﻿' : '') + [header.join(','), row.join(',')].join('\n') + '\n';
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
  const header = ['specimen_id', 'region_id', 'type', 'scar_id', 'area', 'unit', 'parent_region', 'retouch_layer'];
  // those that follow a flake's annotations belong to the flake
  const hidden = state.specimen.type === 'flake' ? [] : state.regions.filter((r) => r.auto).map((r) => r.id);
  const rows = regions.filter((r) => !hidden.includes(r.id)).map((r) => {
    const scar = r.scarId ? state.scars.find((s) => s.id === r.scarId)?.label ?? '' : '';
    const parent = r.parent ? regions.find((x) => x.id === r.parent)?.label ?? '' : '';
    return [csvCell(state.specimen.id), csvCell(r.label), csvCell(r.type), csvCell(scar), cell(r.area), csvCell(state.specimen.unit), csvCell(parent), cell(r.retouchLayer ?? null)].join(',');
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
 * or without arrows). The bicone gives no relations and no polarity. `file`: the
 * model's path, in a summary export only.
 */
export function configurationCsv(state: Readonly<ProjectState>, config: CoreConfiguration | null, opts: CsvOptions, file?: string): string {
  const header = ['specimen_id', 'model', 'frame', 'facial_character', 'flaking_surface_relation', 'platform_relation', 'polarity'];
  const box = config && !isBicone(config) ? config : null;
  const row = [csvCell(state.specimen.id), config?.model ?? state.configuration.model, config?.frame ?? '', config?.facialCharacter ?? '', box?.flakingSurfaceRelation ?? '', box?.platformRelation ?? '', box?.polarity ?? ''];
  if (file !== undefined) {
    header.push('file');
    row.push(csvCell(file));
  }
  return (opts.excelBom ? '﻿' : '') + [header.join(','), row.join(',')].join('\n') + '\n';
}

/**
 * One row per flaking surface: its faces and platforms (face codes joined by ";"), scars,
 * type and exploitation axis; for the bicone, its cone (`upper` / `lower`) and scars only.
 */
export function flakingSurfacesCsv(state: Readonly<ProjectState>, config: CoreConfiguration | null, opts: CsvOptions, file?: string): string {
  const header = ['specimen_id', 'surface_id', 'faces', 'platforms', 'also_platform', 'n_scars', 'surface_type', 'exploitation_axis'];
  if (file !== undefined) header.push('file');
  const surfaces = !config ? [] : isBicone(config)
    ? config.surfaces.map((s) => [s.id, s.cone, '', '', String(s.scarIds.length), '', ''])
    : config.surfaces.map((s) => [s.id, s.faces.join(';'), s.platforms.join(';'), String(s.alsoPlatform), String(s.scarIds.length), s.type, s.axis]);
  const rows = surfaces.map((cells) => {
    const row = [csvCell(state.specimen.id), ...cells];
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

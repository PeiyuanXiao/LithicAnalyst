import type { GmResult } from '../compute/gm';
import type { LandmarkTable } from '../compute/landmarks';
import type { ProjectState } from '../core/types';
import { csvCell, fmt, type CsvOptions } from './csv';

/**
 * Landmark exports. Every file lists the same points in the same order:
 * the fixed landmarks (list order), then each set's semilandmarks; row k of
 * one file is point k of the others, and the sliders refer to these numbers.
 */

/** TPS with 3D coordinates (LM3), for geomorph::readland.tps and Morpho. */
export function landmarksTps(state: Readonly<ProjectState>, table: Pick<LandmarkTable, 'rows'>): string {
  const lines = [`LM3=${table.rows.length}`, ...table.rows.map((r) => r.point.map(fmt).join(' ')), `ID=${state.specimen.id.replace(/[\r\n]/g, ' ')}`];
  return lines.join('\n') + '\n';
}

/**
 * 3D Slicer markups (.fcsv). The coordinates are the mesh file's own; Slicer
 * reads model files as LPS by default, so the points land on the model.
 */
export function landmarksFcsv(table: Pick<LandmarkTable, 'rows'>): string {
  const head = ['# Markups fiducial file version = 4.11', '# CoordinateSystem = LPS', '# columns = id,x,y,z,ow,ox,oy,oz,vis,sel,lock,label,desc,associatedNodeID'];
  const rows = table.rows.map((r) => [String(r.index), ...r.point.map(fmt), '0', '0', '0', '1', '1', '1', '0', csvCell(r.name), csvCell(r.setId), ''].join(','));
  return [...head, ...rows].join('\n') + '\n';
}

/** One row per point: `kind` is `fixed`, `curve` or `surface`; `set_id` names the semilandmark set. */
export function landmarksCsv(state: Readonly<ProjectState>, table: Pick<LandmarkTable, 'rows'>, opts: CsvOptions): string {
  const header = 'specimen_id,index,name,kind,set_id,x,y,z';
  const rows = table.rows.map((r) => [csvCell(state.specimen.id), String(r.index), csvCell(r.name), r.kind, csvCell(r.setId), ...r.point.map(fmt)].join(','));
  return (opts.excelBom ? '﻿' : '') + [header, ...rows].join('\n') + '\n';
}

/** The sliding definition as geomorph's `curves` matrix: one row per sliding semilandmark, by point number. */
export function slidersCsv(table: LandmarkTable): string {
  return ['before,slider,after', ...table.sliders.map((s) => s.join(','))].join('\n') + '\n';
}

/** The sliding curve semilandmarks of a flake, for geomorph's `curves`: by point number, the ends of a curve not among them. */
export function gmCurvesCsv(gm: Pick<GmResult, 'curves'>): string {
  return ['before,slide,after', ...gm.curves.map((s) => s.join(','))].join('\n') + '\n';
}

/** The surface semilandmarks of a flake, for geomorph's `surfaces`: by point number. */
export function gmSurfacesCsv(gm: Pick<GmResult, 'surfaces'>): string {
  return ['index', ...gm.surfaces.map(String)].join('\n') + '\n';
}

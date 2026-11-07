import type { GmResult } from '../compute/gm';
import type { LandmarkRow, LandmarkTable } from '../compute/landmarks';
import type { ProjectState } from '../core/types';
import { csvCell, fmt, type CsvOptions } from './csv';

/**
 * Landmark exports. Every file lists the same points in the same order:
 * the fixed landmarks (list order), then each set's semilandmarks; row k of
 * one file is point k of the others, and the sliders refer to these numbers.
 */

/** A point's coordinates as text: NA where a specimen has no such point (for `geomorph::estimate.missing`). */
const coordinates = (r: LandmarkRow): string[] => (r.missing ? ['NA', 'NA', 'NA'] : r.point.map(fmt));

/** TPS with 3D coordinates (LM3), for geomorph::readland.tps and Morpho. */
export function landmarksTps(state: Readonly<ProjectState>, table: Pick<LandmarkTable, 'rows'>): string {
  const lines = [`LM3=${table.rows.length}`, ...table.rows.map((r) => coordinates(r).join(' ')), `ID=${state.specimen.id.replace(/[\r\n]/g, ' ')}`];
  return lines.join('\n') + '\n';
}

/**
 * 3D Slicer markups (.fcsv). The coordinates are the mesh file's own; Slicer
 * reads model files as LPS by default, so the points land on the model.
 */
export function landmarksFcsv(table: Pick<LandmarkTable, 'rows'>): string {
  const head = ['# Markups fiducial file version = 4.11', '# CoordinateSystem = LPS', '# columns = id,x,y,z,ow,ox,oy,oz,vis,sel,lock,label,desc,associatedNodeID'];
  const rows = table.rows.map((r) => [String(r.index), ...coordinates(r), '0', '0', '0', '1', '1', '1', '0', csvCell(r.name), csvCell(r.setId), ''].join(','));
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

/**
 * The points by a configuration, as the landmarks' table. By the grid it is that table, to the byte. By a template each row also says its number within its curve or
 * patch (`set_index`; `index` stays the point's number in the file, which the sliding definitions go by) and whether the check flagged it; `name` is the landmark's name, the curve's or the region's type, to take a part in R.
 */
export function gmLandmarksCsv(state: Readonly<ProjectState>, gm: Pick<GmResult, 'rows' | 'method'>, opts: CsvOptions): string {
  if (gm.method !== 'template') return landmarksCsv(state, gm, opts);
  const header = 'specimen_id,index,name,kind,set_id,x,y,z,set_index,flagged';
  const rows = gm.rows.map((r) => [csvCell(state.specimen.id), String(r.index), csvCell(r.name), r.kind, csvCell(r.setId), ...coordinates(r), r.setIndex === undefined ? '' : String(r.setIndex), r.flagged ? '1' : '0'].join(','));
  return (opts.excelBom ? '﻿' : '') + [header, ...rows].join('\n') + '\n';
}

/** The curves of a sliding definition as lists of point numbers in their order, both ends among them (Morpho's `outlines`). */
export function gmOutlines(curves: GmResult['curves']): number[][] {
  const out: number[][] = [];
  let last: [number, number, number] | null = null;
  for (const c of curves) {
    if (last && c[0] === last[1] && c[1] === last[2]) out[out.length - 1].push(c[2]);
    else out.push([c[0], c[1], c[2]]);
    last = c;
  }
  return out;
}

/** Morpho `slider3d`, `SMvector`: the points that slide along curves, by point number. */
export const gmSmvectorCsv = (gm: Pick<GmResult, 'curves'>): string => ['index', ...gm.curves.map((c) => String(c[1]))].join('\n') + '\n';

/** Morpho `slider3d`, `outlines`: which curve, and its points in their order; in R, `split(index, outline)`. */
export function gmOutlinesCsv(gm: Pick<GmResult, 'curves'>): string {
  return ['outline,index', ...gmOutlines(gm.curves).flatMap((line, k) => line.map((p) => `${k + 1},${p}`))].join('\n') + '\n';
}

/** Morpho `slider3d`, `surp`: the points that slide on surfaces, by point number. */
export const gmSurpCsv = (gm: Pick<GmResult, 'surfaces'>): string => ['index', ...gm.surfaces.map(String)].join('\n') + '\n';

/** Each specimen's model, by its path relative to the folder (Morpho `slider3d`, `sur.path` and `sur.name`). */
export function gmModelsCsv(rows: ReadonlyArray<{ id: string; file: string }>): string {
  return ['specimen_id,model', ...rows.map((r) => `${csvCell(r.id)},${csvCell(r.file)}`)].join('\n') + '\n';
}

import { curveLength } from '../core/curveGeometry';
import { CURVE_FIELDS, SCAR_FIELDS } from '../core/fields';
import { arrowLength } from '../core/store';
import type { ProjectState } from '../core/types';
import { distance } from '../core/vec';

export interface CsvOptions {
  /** Prefix a UTF-8 byte-order mark so Excel shows non-ASCII notes correctly. */
  excelBom: boolean;
}

const fmt = (n: number): string => {
  if (!Number.isFinite(n)) return '';
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
};

export const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * One row per scar vector, coordinates in the original mesh coordinate system.
 * Enumerated fields are written as their codes (e.g. "bulb_truncated"), which
 * stay the same in every interface language.
 */
export function scarVectorCsv(state: Readonly<ProjectState>, opts: CsvOptions): string {
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
    'unit',
  ];
  const rows = state.scarVectors.map((a) =>
    [
      csvCell(state.specimen.id),
      csvCell(a.label),
      fmt(a.start[0]),
      fmt(a.start[1]),
      fmt(a.start[2]),
      fmt(a.end[0]),
      fmt(a.end[1]),
      fmt(a.end[2]),
      fmt(arrowLength(a)),
      ...SCAR_FIELDS.map((f) => csvCell(a.attributes[f.key])),
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

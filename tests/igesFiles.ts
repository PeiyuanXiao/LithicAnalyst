/**
 * Synthetic IGES files for the tests, written as the PTC files scar vectors came in: fixed 80 columns, a global section whose
 * header says centimetres and a largest coordinate that does not fit the data, every line written twice, Fortran's D exponents,
 * parameters running on to a second line, Hollerith strings holding a comma and backslashes. No user's file is committed.
 */

export type Vec3 = [number, number, number];

export interface IgesEntity {
  type: number;
  form?: number;
  /** The parameters after the entity type. */
  params: number[];
  /** How many of the first parameters are integers (counts, flags); the rest are written with a D exponent. */
  ints?: number;
  /** Status 01……: blanked (hidden). */
  hidden?: boolean;
  /** The 124 entity (its index in the list) whose matrix applies. */
  matrix?: number;
  label?: string;
}

export interface IgesHeader {
  flag: number;
  name: string;
  scale: number;
  /** What the header says is the largest coordinate. */
  maxCoord: number;
}

export const PTC_HEADER: IgesHeader = { flag: 10, name: 'CM', scale: 1, maxCoord: 0.386401 };

/** A real number as Fortran writes it: `-3.114144833307D1`. */
export function dNumber(x: number): string {
  if (x === 0) return '0.D0';
  return x.toExponential(12).replace(/e\+?/, 'D');
}

const holl = (s: string) => `${s.length}H${s}`;
const pad = (n: number) => String(n).padStart(7, ' ');
const field = (v: string | number) => String(v).padStart(8, ' ');

/** The file name in the header: a comma and backslashes inside a Hollerith string. */
export const HEADER_FILE_NAME = 'C:\\scans\\stone,01\\vectors.igs';

export function igesText(entities: readonly IgesEntity[], header: IgesHeader = PTC_HEADER): string {
  const lines: string[] = [];
  lines.push('PTC IGES file'.padEnd(72) + 'S' + pad(1));
  const g = [
    '1H,',
    '1H;',
    holl('PTC-1'),
    holl(HEADER_FILE_NAME),
    holl('PTC Creo Parametric, 9.0'),
    holl('PTC IGES 9.0'),
    '32',
    '38',
    '7',
    '308',
    '15',
    holl('PTC-1'),
    `${header.scale}.`,
    String(header.flag),
    holl(header.name),
    '32768',
    '0.5',
    holl('20261110.120000'),
    dNumber(1e-6),
    String(header.maxCoord),
    holl('Unknown'),
    holl('Unknown'),
    '11',
    '0',
    holl('20261110.120000'),
  ].join(',') + ';';
  let gCount = 0;
  for (let i = 0; i < g.length; i += 72) lines.push(g.slice(i, i + 72).padEnd(72) + 'G' + pad(++gCount));
  // parameters first, to know their pointers
  const pLines: string[] = [];
  const pointers: Array<{ at: number; count: number }> = [];
  entities.forEach((e, i) => {
    const de = 2 * i + 1;
    const ints = e.ints ?? 0;
    const tokens = [String(e.type), ...e.params.map((v, k) => (k < ints ? String(Math.round(v)) : dNumber(v)))];
    const text = tokens.join(',') + ';';
    // lines of at most 64 characters, broken after a delimiter
    const chunks: string[] = [];
    let cur = '';
    for (const tok of text.split(/(?<=[,;])/)) {
      if ((cur + tok).length > 64) {
        chunks.push(cur);
        cur = '';
      }
      cur += tok;
    }
    if (cur) chunks.push(cur);
    pointers.push({ at: pLines.length + 1, count: chunks.length });
    for (const c of chunks) pLines.push(c.padEnd(64) + ' ' + pad(de) + 'P' + pad(pLines.length + 1));
  });
  entities.forEach((e, i) => {
    const de = 2 * i + 1;
    const status = e.hidden ? '01000000' : '00000000';
    const matrix = e.matrix === undefined ? 0 : 2 * e.matrix + 1;
    lines.push([e.type, pointers[i].at, 0, 0, 0, 0, matrix, 0, status].map(field).join('') + 'D' + pad(de));
    lines.push([e.type, 0, 0, pointers[i].count, e.form ?? 0, '', '', e.label ?? (e.type === 110 ? 'LINE' : ''), 0].map(field).join('') + 'D' + pad(de + 1));
  });
  lines.push(...pLines);
  lines.push(`S${pad(1)}G${pad(gCount)}D${pad(2 * entities.length)}P${pad(pLines.length)}`.padEnd(72) + 'T' + pad(1));
  return lines.join('\r\n') + '\r\n';
}

export const line = (a: Vec3, b: Vec3, extra: Partial<IgesEntity> = {}): IgesEntity => ({ type: 110, params: [...a, ...b], ...extra });

/** Like the user's sample: each segment a line (110, form 0) written twice over, no matrices, centimetres in the header. */
export const sampleIges = (segments: ReadonlyArray<[Vec3, Vec3]>, header: IgesHeader = PTC_HEADER): string => igesText(segments.flatMap(([a, b]) => [line(a, b), line(a, b)]), header);

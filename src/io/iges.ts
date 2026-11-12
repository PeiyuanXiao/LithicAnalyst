import { IGES_IMPORT } from '../compute/igesAlign';
import type { Vec3 } from '../core/types';

/**
 * Reading line segments out of a fixed-format IGES file (80 columns, the section in column 73), for
 * scar vectors drawn in another program. No DOM, no three.js.
 *
 * What is read: lines (110, form 0), polylines (106: the first and the last point), rational B-spline
 * curves (126: their two ends) and the transformation matrices (124) these refer to. Rays and unbounded
 * lines, hidden entities, segments of no length and any other entity are counted and left out; a segment
 * written again (both ends the same, within `IGES_IMPORT.SAME_SHARE` of the segments' size) is kept once, and one
 * written again the other way round is kept as it first came, as a conflict of direction.
 */

export interface IgesSegment {
  start: Vec3;
  end: Vec3;
  /** The entity's directory pointer (the sequence number of its first D line). */
  de: number;
  /** The entity's label (DE field 18), trimmed. */
  label: string;
}

/** What the global section says of the units: the flag (field 14), its name (field 15), the model space scale (field 13). */
export interface IgesUnits {
  flag: number | null;
  name: string;
  scale: number;
}

export interface IgesRead {
  segments: IgesSegment[];
  units: IgesUnits;
  /** Left out, by why: `110.1`, `110.2` (ray, line), `106.<form>`, `hidden`, `zero` (no length), else the entity type. */
  skipped: Record<string, number>;
  /** Segments written again and left out. */
  duplicates: number;
  /** Segments written again the other way round (`de`), left out for the one kept (`kept`). */
  conflicts: Array<{ de: number; kept: number }>;
}

export class IgesError extends Error {}

/** The forms of 106 that are paths (2D, 3D, 3D with vectors, closed planar). */
const PATH_FORMS = new Set([11, 12, 13, 63]);

/** The 80-column records of the file, by section. */
function records(text: string): Record<'S' | 'G' | 'D' | 'P' | 'T', string[]> {
  let lines = text.split(/\r\n|\r|\n/);
  // some writers put no line breaks between the records
  if (lines.length <= 2 && lines[0].length > 80) {
    const all = lines.join('');
    lines = [];
    for (let i = 0; i < all.length; i += 80) lines.push(all.slice(i, i + 80));
  }
  const out = { S: [] as string[], G: [] as string[], D: [] as string[], P: [] as string[], T: [] as string[] };
  for (const raw of lines) {
    if (raw.length < 73) continue;
    const kind = raw[72] as keyof typeof out;
    if (kind in out) out[kind].push(raw.padEnd(80, ' '));
  }
  return out;
}

/** A number as IGES writes it (Fortran's D exponent too); NaN when it is none. */
export function igesNumber(s: string): number {
  const v = s.trim().replace(/[dD]/, 'E');
  return v === '' ? NaN : Number(v);
}

/**
 * The fields of a free-format record (the global section, or one entity's parameters) up to the record delimiter:
 * Hollerith strings (`nH…`, which may hold the delimiters) as their text, everything else trimmed.
 */
export function splitFields(s: string, pd: string, rd: string): string[] {
  const out: string[] = [];
  let i = 0;
  for (;;) {
    while (i < s.length && s[i] === ' ') i++;
    const holl = /^(\d+)H/.exec(s.slice(i, i + 12));
    let field: string;
    if (holl) {
      const n = Number(holl[1]);
      const from = i + holl[0].length;
      field = s.slice(from, from + n);
      i = from + n;
      while (i < s.length && s[i] === ' ') i++;
    } else {
      let j = i;
      while (j < s.length && s[j] !== pd && s[j] !== rd) j++;
      field = s.slice(i, j).trim();
      i = j;
    }
    out.push(field);
    if (i >= s.length || s[i] === rd) return out;
    // the parameter delimiter
    i++;
  }
}

/** The global section's delimiters and fields (1-based: `fields[13]` is the units flag). */
export function globalFields(g: string): { pd: string; rd: string; fields: string[] } {
  let pd = ',', rd = ';';
  let i = 0;
  const holl1 = /^\s*1H(.)/.exec(g);
  if (holl1) {
    pd = holl1[1];
    i = holl1[0].length;
  }
  // past the first delimiter
  while (i < g.length && g[i] === ' ') i++;
  if (g[i] === pd) i++;
  const rest = g.slice(i);
  const holl2 = /^\s*1H(.)/.exec(rest);
  if (holl2) rd = holl2[1];
  const fields = ['', pd, ...splitFields(rest, pd, rd)];
  fields[2] = rd;
  return { pd, rd, fields };
}

interface Entry {
  de: number;
  type: number;
  pointer: number;
  matrix: number;
  status: string;
  lineCount: number;
  form: number;
  label: string;
}

const field = (line: string, k: number): string => line.slice(8 * k, 8 * k + 8);
const int = (s: string): number => {
  const v = parseInt(s.trim(), 10);
  return Number.isFinite(v) ? v : 0;
};

function directory(lines: string[]): Entry[] {
  const out: Entry[] = [];
  for (let k = 0; k + 1 < lines.length; k += 2) {
    const a = lines[k], b = lines[k + 1];
    out.push({
      de: int(a.slice(73, 80)) || k + 1,
      type: int(field(a, 0)),
      pointer: int(field(a, 1)),
      matrix: int(field(a, 6)),
      status: field(a, 8).trim().padStart(8, '0'),
      lineCount: int(field(b, 3)),
      form: int(field(b, 4)),
      label: field(b, 7).trim(),
    });
  }
  return out;
}

/** Each entity's parameters: its P lines' columns 1–64 joined, split by the delimiters (the entity type first). */
function parameters(lines: string[], entries: Entry[], pd: string, rd: string): Map<number, string[]> {
  const bySeq = new Map<number, string>();
  const byBack = new Map<number, string[]>();
  lines.forEach((l, i) => {
    const seq = int(l.slice(73, 80)) || i + 1;
    bySeq.set(seq, l);
    const back = int(l.slice(64, 72));
    (byBack.get(back) ?? byBack.set(back, []).get(back)!).push(l.slice(0, 64));
  });
  const out = new Map<number, string[]>();
  for (const e of entries) {
    let text = '';
    if (e.pointer > 0 && e.lineCount > 0 && bySeq.has(e.pointer)) for (let s = e.pointer; s < e.pointer + e.lineCount; s++) text += (bySeq.get(s) ?? '').slice(0, 64);
    else text = (byBack.get(e.de) ?? []).join('');
    if (text.trim()) out.set(e.de, splitFields(text, pd, rd));
  }
  return out;
}

/** A transformation (rotation by rows, then translation): x' = R x + T. */
type Affine = { r: number[]; t: Vec3 };

const applyAffine = (m: Affine, p: Vec3): Vec3 => [
  m.r[0] * p[0] + m.r[1] * p[1] + m.r[2] * p[2] + m.t[0],
  m.r[3] * p[0] + m.r[4] * p[1] + m.r[5] * p[2] + m.t[1],
  m.r[6] * p[0] + m.r[7] * p[1] + m.r[8] * p[2] + m.t[2],
];

/** One point of a rational B-spline (de Boor on homogeneous points). */
function bsplinePoint(degree: number, knots: number[], weights: number[], points: Vec3[], u: number): Vec3 {
  const n = points.length - 1;
  const lo = knots[degree], hi = knots[n + 1];
  const t = Math.min(hi, Math.max(lo, u));
  let span = degree;
  while (span < n && t >= knots[span + 1]) span++;
  const d: Array<[number, number, number, number]> = [];
  for (let j = 0; j <= degree; j++) {
    const i = span - degree + j;
    const w = weights[i];
    d.push([points[i][0] * w, points[i][1] * w, points[i][2] * w, w]);
  }
  for (let r = 1; r <= degree; r++)
    for (let j = degree; j >= r; j--) {
      const i = span - degree + j;
      const den = knots[i + degree - r + 1] - knots[i];
      const a = den === 0 ? 0 : (t - knots[i]) / den;
      for (let k = 0; k < 4; k++) d[j][k] = (1 - a) * d[j - 1][k] + a * d[j][k];
    }
  const h = d[degree];
  return [h[0] / h[3], h[1] / h[3], h[2] / h[3]];
}

/** The two ends of entity 126: a clamped curve's first and last control points, else the curve at its two parameter limits. */
function bsplineEnds(p: number[]): [Vec3, Vec3] | null {
  const K = p[0], M = p[1];
  if (!Number.isInteger(K) || !Number.isInteger(M) || K < 1 || M < 1) return null;
  const nKnots = K + M + 2;
  let o = 6;
  const knots = p.slice(o, (o += nKnots));
  const weights = p.slice(o, (o += K + 1));
  const points: Vec3[] = [];
  for (let i = 0; i <= K; i++, o += 3) points.push([p[o], p[o + 1], p[o + 2]]);
  const v0 = p[o], v1 = p[o + 1];
  if (knots.length !== nKnots || weights.length !== K + 1 || !points.every((q) => q.every(Number.isFinite))) return null;
  const clamped = knots.slice(0, M + 1).every((k) => k === knots[0]) && knots.slice(-(M + 1)).every((k) => k === knots[nKnots - 1]);
  if (clamped) return [points[0], points[K]];
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 1));
  return [bsplinePoint(M, knots, w, points, Number.isFinite(v0) ? v0 : knots[M]), bsplinePoint(M, knots, w, points, Number.isFinite(v1) ? v1 : knots[K + 1])];
}

/** Read the segments of an IGES file. Throws IgesError when it is no fixed-format IGES. */
export function readIges(text: string): IgesRead {
  const rec = records(text);
  if (!rec.D.length || !rec.G.length) throw new IgesError('This is not a fixed-format IGES file.');
  const g = globalFields(rec.G.map((l) => l.slice(0, 72)).join(''));
  const { pd, rd, fields } = g;
  const flag = parseInt(fields[14] ?? '', 10);
  const scale = igesNumber(fields[13] ?? '');
  const units: IgesUnits = { flag: Number.isFinite(flag) ? flag : null, name: (fields[15] ?? '').trim(), scale: Number.isFinite(scale) && scale > 0 ? scale : 1 };
  const entries = directory(rec.D);
  const byDe = new Map(entries.map((e) => [e.de, e]));
  const params = parameters(rec.P, entries, pd, rd);
  const nums = (de: number): number[] => (params.get(de) ?? []).slice(1).map(igesNumber);
  const skipped: Record<string, number> = {};
  const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1);

  // a matrix, with the matrix it refers to in turn
  const matrixOf = (de: number, seen = new Set<number>()): Affine | null => {
    const e = byDe.get(de);
    if (!e || e.type !== 124 || seen.has(de)) return null;
    seen.add(de);
    const v = nums(de);
    if (v.length < 12 || !v.slice(0, 12).every(Number.isFinite)) return null;
    const own: Affine = { r: [v[0], v[1], v[2], v[4], v[5], v[6], v[8], v[9], v[10]], t: [v[3], v[7], v[11]] };
    const outer = e.matrix > 0 ? matrixOf(e.matrix, seen) : null;
    if (!outer) return own;
    const r = own.r, o = outer.r;
    const prod = [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => o[3 * i] * r[j] + o[3 * i + 1] * r[3 + j] + o[3 * i + 2] * r[6 + j]));
    return { r: prod, t: applyAffine(outer, own.t) };
  };

  const raw: IgesSegment[] = [];
  for (const e of entries) {
    if (e.type === 124 || e.type === 0) continue;
    if (e.status.slice(0, 2) === '01') {
      skip('hidden');
      continue;
    }
    let ends: [Vec3, Vec3] | null = null;
    const v = nums(e.de);
    if (e.type === 110) {
      if (e.form !== 0) {
        skip(`110.${e.form}`);
        continue;
      }
      if (v.length >= 6) ends = [[v[0], v[1], v[2]], [v[3], v[4], v[5]]];
    } else if (e.type === 106) {
      if (!PATH_FORMS.has(e.form)) {
        skip(`106.${e.form}`);
        continue;
      }
      const ip = v[0], n = v[1];
      if (Number.isInteger(n) && n >= 2) {
        if (ip === 1) {
          const z = v[2];
          ends = [[v[3], v[4], z], [v[3 + 2 * (n - 1)], v[4 + 2 * (n - 1)], z]];
        } else if (ip === 2 || ip === 3) {
          const k = ip === 2 ? 3 : 6;
          ends = [[v[2], v[3], v[4]], [v[2 + k * (n - 1)], v[3 + k * (n - 1)], v[4 + k * (n - 1)]]];
        }
      }
    } else if (e.type === 126) {
      ends = bsplineEnds(v);
    } else {
      skip(String(e.type));
      continue;
    }
    if (!ends || !ends.every((p) => p.every(Number.isFinite))) {
      skip(String(e.type));
      continue;
    }
    const m = e.matrix > 0 ? matrixOf(e.matrix) : null;
    const [a, b] = m ? [applyAffine(m, ends[0]), applyAffine(m, ends[1])] : ends;
    raw.push({ start: a, end: b, de: e.de, label: e.label });
  }

  // the same segment once; the size of "the same" from all of them
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const s of raw)
    for (const p of [s.start, s.end])
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
  const tol = raw.length ? IGES_IMPORT.SAME_SHARE * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) : 0;
  const near = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= tol;
  const segments: IgesSegment[] = [];
  const conflicts: IgesRead['conflicts'] = [];
  let duplicates = 0;
  for (const s of raw) {
    if (near(s.start, s.end)) {
      skip('zero');
      continue;
    }
    const same = segments.find((x) => near(x.start, s.start) && near(x.end, s.end));
    if (same) {
      duplicates++;
      continue;
    }
    const reversed = segments.find((x) => near(x.start, s.end) && near(x.end, s.start));
    if (reversed) {
      conflicts.push({ de: s.de, kept: reversed.de });
      continue;
    }
    segments.push(s);
  }
  return { segments, units, skipped, duplicates, conflicts };
}

/** Millimetres per IGES unit, by the flag (1–11), or by the name when the flag is 3 or not known; null when neither says. */
export function igesUnitMm(units: Pick<IgesUnits, 'flag' | 'name'>): number | null {
  const byFlag: Record<number, number> = { 1: 25.4, 2: 1, 4: 304.8, 5: 1609344, 6: 1000, 7: 1e6, 8: 0.0254, 9: 0.001, 10: 10, 11: 0.0000254 };
  if (units.flag !== null && units.flag !== 3 && byFlag[units.flag]) return byFlag[units.flag];
  const byName: Record<string, number> = { IN: 25.4, INCH: 25.4, MM: 1, FT: 304.8, MI: 1609344, M: 1000, KM: 1e6, MIL: 0.0254, UM: 0.001, MICRON: 0.001, CM: 10, UIN: 0.0000254 };
  return byName[units.name.trim().toUpperCase()] ?? null;
}

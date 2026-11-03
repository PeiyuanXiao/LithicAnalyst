/**
 * How numbers are written in the interface (exports keep their own formats). Pure, no DOM.
 * Each kind of quantity has one number of decimals wherever it is shown; counts get
 * thousands separators, nothing else does.
 */

/** Shown for a value that is missing (null, NaN, ±∞). */
export const MISSING = '—';

/** Decimals per kind of quantity. */
export const DIGITS = {
  length: 3,
  coord: 3,
  area: 2,
  volume: 2,
  angle: 1,
  ratio: 3,
} as const;

export type Quantity = keyof typeof DIGITS;

const missing = (v: number | null | undefined): v is null | undefined => v === null || v === undefined || !Number.isFinite(v);

/** Fixed decimals without thousands separators; a negative zero is written without its sign. */
export function fmtNum(v: number | null | undefined, digits = 3): string {
  if (missing(v)) return MISSING;
  const s = v.toFixed(digits);
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}

/** A quantity with the decimals of its kind. */
export const fmtQuantity = (kind: Quantity, v: number | null | undefined): string => fmtNum(v, DIGITS[kind]);

/** A whole count with thousands separators: "1,234,567". */
export function fmtCount(v: number | null | undefined): string {
  if (missing(v)) return MISSING;
  const n = Math.round(v);
  const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return n < 0 ? `-${s}` : s;
}

/** The unit a quantity is shown with: the stated length unit (squared, cubed), ° for angles, none for ratios or without a stated unit. */
export function quantityUnit(kind: Quantity, unit: string): string {
  if (kind === 'angle') return '°';
  if (kind === 'ratio' || !unit) return '';
  if (kind === 'area') return `${unit}²`;
  if (kind === 'volume') return `${unit}³`;
  return unit;
}

/** Millimetres per unit; null when the unit is not stated. */
export function mmPerUnit(unit: string): number | null {
  return ({ mm: 1, cm: 10, m: 1000, in: 25.4 } as Record<string, number>)[unit] ?? null;
}

/** A time left, rounded to what is worth saying: "45 s", "3 min", "1 h 05 min" (under 10 s: "< 10 s"). */
export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return MISSING;
  if (seconds < 10) return '< 10 s';
  if (seconds < 60) return `${Math.round(seconds / 5) * 5} s`;
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

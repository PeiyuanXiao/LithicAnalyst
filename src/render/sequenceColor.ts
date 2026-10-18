import type { Sequence } from '../core/types';

/** Hue of each sequence, in sequence order. */
const SEQUENCE_HUES = [212, 8, 142, 272, 42, 322, 182, 24];
export const UNASSIGNED_COLOR = '#8a8f98';

function hslHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Sequence `i`'s hue; in an ordered sequence of `n`, member `k` runs from light (earliest) to dark (latest). */
export function sequenceColor(i: number, k: number, n: number, ordered: boolean): string {
  const l = ordered && n > 1 ? 0.74 - (0.42 * k) / (n - 1) : 0.52;
  return hslHex(SEQUENCE_HUES[i % SEQUENCE_HUES.length], 0.7, l);
}

/** Colour of every scar that is in a sequence (scar id → colour). */
export function sequenceColors(sequences: readonly Sequence[]): Map<string, string> {
  const out = new Map<string, string>();
  sequences.forEach((q, i) => q.scarIds.forEach((id, k) => out.set(id, sequenceColor(i, k, q.scarIds.length, q.ordered))));
  return out;
}

/** The colour a whole sequence is shown with (its middle tone). */
export const sequenceSwatch = (i: number): string => sequenceColor(i, 0, 1, false);

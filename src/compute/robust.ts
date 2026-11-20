/** Robust statistics for the fits that leave out what lies off them: the median by selection (no sort), and the MAD's σ. */

/** The median absolute deviation of a normal distribution, times this, is its standard deviation. */
export const MAD_TO_SIGMA = 1.4826;

/** The k-th smallest of `a` (0-based), moving its values about. */
function select(a: Float64Array, k: number): number {
  let lo = 0, hi = a.length - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo, j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return a[k];
  }
  return a[k];
}

/** The median (of an even count, the mean of the middle two); `a` is reordered. */
export function median(a: Float64Array): number {
  const n = a.length;
  if (!n) return NaN;
  const k = (n - 1) >> 1;
  const lower = select(a, k);
  if (n % 2) return lower;
  // the next one up: the least of what select left above k
  let upper = Infinity;
  for (let i = k + 1; i < n; i++) if (a[i] < upper) upper = a[i];
  return (lower + upper) / 2;
}

/** The median of some values and their robust standard deviation, MAD_TO_SIGMA × the median absolute deviation from it (values kept). */
export function medianAndSigma(values: Float64Array): { median: number; sigma: number } {
  const m = median(Float64Array.from(values));
  const sigma = MAD_TO_SIGMA * median(Float64Array.from(values, (r) => Math.abs(r - m)));
  return { median: m, sigma };
}

/** The weighted median: the value at which the weights below and above it each come to half (by selection, no sort). */
export function weightedMedian(values: Float64Array, weights: Float64Array): number {
  const n = values.length;
  if (!n) return NaN;
  const v = Float64Array.from(values), w = Float64Array.from(weights);
  let target = 0;
  for (let i = 0; i < n; i++) target += w[i];
  target /= 2;
  const swap = (a: number, b: number) => {
    const tv = v[a], tw = w[a];
    v[a] = v[b];
    w[a] = w[b];
    v[b] = tv;
    w[b] = tw;
  };
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const pivot = v[(lo + hi) >> 1];
    // three ways: below, at and above the pivot
    let lt = lo, i = lo, gt = hi;
    while (i <= gt) {
      if (v[i] < pivot) swap(lt++, i++);
      else if (v[i] > pivot) swap(i, gt--);
      else i++;
    }
    let below = 0, at = 0;
    for (let k = lo; k < lt; k++) below += w[k];
    for (let k = lt; k <= gt; k++) at += w[k];
    if (target < below) hi = lt - 1;
    else if (target <= below + at) return pivot;
    else {
      target -= below + at;
      lo = gt + 1;
    }
  }
  return v[lo];
}

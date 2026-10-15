/**
 * Colour ramps for curvature shading. Values are sRGB in [0, 1]; the renderer
 * converts them to linear space before uploading.
 * Concave (scar beds) → cool slate, flat → stone grey, convex (ridges) → warm ochre.
 */
const STOPS: Array<[number, [number, number, number]]> = [
  [-1.0, [0.19, 0.33, 0.52]],
  [-0.45, [0.47, 0.6, 0.72]],
  [0.0, [0.86, 0.85, 0.82]],
  [0.45, [0.87, 0.66, 0.42]],
  [1.0, [0.66, 0.36, 0.13]],
];

/** t in [−1, 1]. */
export function divergingColor(t: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const x = Math.max(-1, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    if (x <= t1) {
      const [t0, c0] = STOPS[i - 1];
      const f = (x - t0) / (t1 - t0);
      out[0] = c0[0] + (c1[0] - c0[0]) * f;
      out[1] = c0[1] + (c1[1] - c0[1]) * f;
      out[2] = c0[2] + (c1[2] - c0[2]) * f;
      return out;
    }
  }
  const last = STOPS[STOPS.length - 1][1];
  out[0] = last[0];
  out[1] = last[1];
  out[2] = last[2];
  return out;
}

export const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

/** Map curvature values to a linear-space RGB Float32Array (3 per vertex). */
export function curvatureColors(values: Float32Array, range: number, contrast: number): Float32Array {
  const out = new Float32Array(values.length * 3);
  const c: [number, number, number] = [0, 0, 0];
  const lut = new Float32Array(1024 * 3);
  for (let i = 0; i < 1024; i++) {
    divergingColor((i / 1023) * 2 - 1, c);
    lut[3 * i] = srgbToLinear(c[0]);
    lut[3 * i + 1] = srgbToLinear(c[1]);
    lut[3 * i + 2] = srgbToLinear(c[2]);
  }
  const s = contrast / (range || 1);
  for (let i = 0; i < values.length; i++) {
    let t = values[i] * s;
    // soft clip keeps detail near the extremes
    t = t / (1 + Math.abs(t) * 0.35);
    const u = Math.max(0, Math.min(1023, Math.round((Math.max(-1, Math.min(1, t)) + 1) * 511.5)));
    out[3 * i] = lut[3 * u];
    out[3 * i + 1] = lut[3 * u + 1];
    out[3 * i + 2] = lut[3 * u + 2];
  }
  return out;
}

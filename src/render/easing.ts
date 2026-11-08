/**
 * Easings of the animations drawn in the 3D view, as CSS writes them (no three.js, no DOM: tested in Node).
 * The interface's own come from the style sheet; these are the same curves for what the view draws.
 */

/** CSS `cubic-bezier(x1, y1, x2, y2)`: the curve from (0, 0) to (1, 1); the result for a share of the time. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (k: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const x = (t: number) => ((ax * t + bx) * t + cx) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const y = (t: number) => ((ay * t + by) * t + cy) * t;
  return (k: number) => {
    if (k <= 0) return 0;
    if (k >= 1) return 1;
    // Newton's method on x(t) = k, with bisection where the slope is too flat
    let t = k;
    for (let i = 0; i < 8; i++) {
      const err = x(t) - k;
      if (Math.abs(err) < 1e-7) return y(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0, hi = 1;
    t = k;
    for (let i = 0; i < 40; i++) {
      const v = x(t);
      if (Math.abs(v - k) < 1e-7) break;
      if (v < k) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return y(t);
  };
}

/** The interface's easing (`cubic-bezier(.2,.7,.2,1)`), and the one a landmark pops in with, which overshoots a little. */
export const EASE = cubicBezier(0.2, 0.7, 0.2, 1);
export const EASE_POP = cubicBezier(0.3, 1.6, 0.5, 1);

/** How long the view's animations take, in ms. */
export const VIEW_MOTION = {
  /** A landmark just placed grows from nothing. */
  LANDMARK_POP_MS: 220,
  /** A measure's drawing fades in. */
  HINT_FADE_MS: 150,
} as const;

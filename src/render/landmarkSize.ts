/**
 * How large the landmarks are drawn in the view: a share of the model, held within limits on the screen so
 * they can be seen from afar and do not cover what is around them close up. No three.js, so it can be tested in Node.
 * Pixels are CSS pixels: a screen at twice the density draws the same size with twice the device pixels.
 */

/** A fixed landmark's radius as a share of the model's diagonal. */
export const LANDMARK_WORLD_SHARE = 0.005;
/** The limits of a fixed landmark's diameter on the screen. */
export const LANDMARK_PX_MIN = 6;
export const LANDMARK_PX_MAX = 16;
/** A semilandmark (of a curve or of a surface) is this much of a fixed landmark, its limits with it (4–11 px). */
export const SEMILANDMARK_SCALE = 2 / 3;

/** The parameters of the landmarks' size, together. */
export const LANDMARK_SIZE_PARAMETERS = { LANDMARK_WORLD_SHARE, LANDMARK_PX_MIN, LANDMARK_PX_MAX, SEMILANDMARK_SCALE };

export type DotKind = 'fixed' | 'semi';

/** The limits of a kind of dot on the screen, in whole pixels. */
export const dotLimitsPx = (kind: DotKind): [number, number] => {
  const k = kind === 'semi' ? SEMILANDMARK_SCALE : 1;
  return [Math.round(LANDMARK_PX_MIN * k), Math.round(LANDMARK_PX_MAX * k)];
};

/** A dot's diameter on the model, when the limits on the screen do not come into it. */
export const dotWorldDiameter = (kind: DotKind, diagonal: number): number => 2 * LANDMARK_WORLD_SHARE * diagonal * (kind === 'semi' ? SEMILANDMARK_SCALE : 1);

/** A dot's diameter on the screen, in CSS pixels; `worldPerPx`: the model's units per CSS pixel at its depth. */
export function dotDiameterPx(kind: DotKind, diagonal: number, worldPerPx: number): number {
  const [min, max] = dotLimitsPx(kind);
  return Math.min(max, Math.max(min, dotWorldDiameter(kind, diagonal) / worldPerPx));
}

/** The same in the device pixels a point sprite is sized in. */
export const dotDevicePx = (kind: DotKind, diagonal: number, worldPerPx: number, pixelRatio: number): number => dotDiameterPx(kind, diagonal, worldPerPx) * pixelRatio;

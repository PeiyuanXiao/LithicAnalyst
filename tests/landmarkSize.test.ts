import { describe, expect, it } from 'vitest';
import { dotDevicePx, dotDiameterPx, dotLimitsPx, dotWorldDiameter, LANDMARK_PX_MAX, LANDMARK_PX_MIN, LANDMARK_SIZE_PARAMETERS, LANDMARK_WORLD_SHARE, SEMILANDMARK_SCALE } from '../src/render/landmarkSize';

/** The model's units per CSS pixel in a view this tall, at this distance (the camera's opening is 28°, as the viewer's). */
const worldPerPx = (distance: number, height: number) => (2 * distance * Math.tan((28 / 2) * (Math.PI / 180))) / height;

describe('the size of the landmarks', () => {
  const diagonal = 100;
  const height = 800;
  // the whole model in view, as far as the wheel lets it go, and right up to it
  const far = worldPerPx(diagonal * 8, height);
  const middle = worldPerPx(diagonal * 1.6, height);
  const near = worldPerPx(diagonal * 0.05, height);

  it('has the agreed defaults', () => {
    expect(LANDMARK_SIZE_PARAMETERS).toEqual({ LANDMARK_WORLD_SHARE: 0.005, LANDMARK_PX_MIN: 6, LANDMARK_PX_MAX: 16, SEMILANDMARK_SCALE: 2 / 3 });
    expect(dotLimitsPx('fixed')).toEqual([6, 16]);
    expect(dotLimitsPx('semi')).toEqual([4, 11]);
  });

  it('the share of the model is its radius', () => {
    expect(dotWorldDiameter('fixed', diagonal)).toBeCloseTo(2 * LANDMARK_WORLD_SHARE * diagonal, 12);
    expect(dotWorldDiameter('semi', diagonal)).toBeCloseTo(2 * LANDMARK_WORLD_SHARE * diagonal * SEMILANDMARK_SCALE, 12);
  });

  it('far away it stays at the lower limit, in the middle it goes by the model, close up it stays at the upper limit', () => {
    expect(dotDiameterPx('fixed', diagonal, far)).toBe(LANDMARK_PX_MIN);
    const between = dotDiameterPx('fixed', diagonal, middle);
    expect(between).toBeCloseTo(dotWorldDiameter('fixed', diagonal) / middle, 12);
    expect(between).toBeGreaterThan(LANDMARK_PX_MIN);
    expect(between).toBeLessThan(LANDMARK_PX_MAX);
    expect(dotDiameterPx('fixed', diagonal, near)).toBe(LANDMARK_PX_MAX);
  });

  it('a semilandmark is two thirds of that, within its own limits', () => {
    expect(dotDiameterPx('semi', diagonal, far)).toBe(4);
    expect(dotDiameterPx('semi', diagonal, middle)).toBeCloseTo((2 / 3) * dotDiameterPx('fixed', diagonal, middle), 12);
    expect(dotDiameterPx('semi', diagonal, near)).toBe(11);
  });

  it('a screen of twice the density draws the same CSS pixels, with twice the device pixels', () => {
    // the view is measured in CSS pixels, whatever the density
    for (const perPx of [far, middle, near]) {
      for (const kind of ['fixed', 'semi'] as const) {
        const one = dotDevicePx(kind, diagonal, perPx, 1), two = dotDevicePx(kind, diagonal, perPx, 2);
        expect(one).toBe(dotDiameterPx(kind, diagonal, perPx));
        expect(two / 2).toBe(one);
      }
    }
  });
});

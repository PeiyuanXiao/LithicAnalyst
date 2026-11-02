import { describe, expect, it } from 'vitest';
import { DEFAULT_LIGHT, discFromLight, lightFromDisc } from '../src/render/lighting';

describe('the light from a point of the disc', () => {
  it('comes from the viewer at the centre and rakes at the rim, from the direction of the point', () => {
    expect(lightFromDisc(0, 0).elevationDeg).toBe(90);
    expect(lightFromDisc(1, 0)).toEqual({ azimuthDeg: 0, elevationDeg: 5 });
    expect(lightFromDisc(0, 1)).toEqual({ azimuthDeg: 90, elevationDeg: 5 });
    expect(lightFromDisc(-1, 0)).toEqual({ azimuthDeg: 180, elevationDeg: 5 });
    expect(lightFromDisc(0, -1)).toEqual({ azimuthDeg: 270, elevationDeg: 5 });
    // halfway out to the upper left
    const half = 0.5 * Math.SQRT1_2;
    const upperLeft = lightFromDisc(-half, half);
    expect(upperLeft.azimuthDeg).toBeCloseTo(135, 9);
    expect(upperLeft.elevationDeg).toBeCloseTo(47.5, 9);
  });

  it('stays at the rim beyond it', () => {
    expect(lightFromDisc(3, 0)).toEqual({ azimuthDeg: 0, elevationDeg: 5 });
  });

  it('has an inverse', () => {
    for (const [az, el] of [[DEFAULT_LIGHT.azimuthDeg, DEFAULT_LIGHT.elevationDeg], [0, 5], [200, 60], [359, 89]]) {
      const p = discFromLight(az, el);
      const back = lightFromDisc(p.x, p.y);
      expect(back.azimuthDeg).toBeCloseTo(az, 9);
      expect(back.elevationDeg).toBeCloseTo(el, 9);
    }
  });
});

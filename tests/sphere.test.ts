import { describe, expect, it } from 'vitest';
import { fitSphere } from '../src/compute/sphere';

/** Points on a cap of a sphere (half-angle `cap` radians around +Z), with ± `noise` along the radius. */
function cap(center: number[], radius: number, capAngle: number, noise: number): number[] {
  const pts: number[] = [];
  let k = 0;
  for (let i = 1; i <= 20; i++)
    for (let j = 0; j < 36; j++) {
      const th = (i / 20) * capAngle;
      const ph = (j / 36) * 2 * Math.PI;
      const r = radius + (k++ % 2 ? noise : -noise);
      pts.push(center[0] + r * Math.sin(th) * Math.cos(ph), center[1] + r * Math.sin(th) * Math.sin(ph), center[2] + r * Math.cos(th));
    }
  return pts;
}

describe('sphere fit', () => {
  it('recovers a sphere exactly from points on it', () => {
    const f = fitSphere(cap([1000, -200, 50], 30, Math.PI / 2, 0))!;
    expect(f.radius).toBeCloseTo(30, 8);
    f.center.forEach((x, k) => expect(x).toBeCloseTo([1000, -200, 50][k], 6));
    expect(f.rms).toBeLessThan(1e-8);
  });

  it('recovers the radius from a small noisy patch (a piece of cortex)', () => {
    // a 25° cap of a 30 mm nodule, ±0.05 mm scan noise
    const f = fitSphere(cap([12, 34, -5], 30, (25 * Math.PI) / 180, 0.05))!;
    expect(Math.abs(f.radius - 30) / 30).toBeLessThan(0.01);
    expect(f.rms).toBeCloseTo(0.05, 2);
    expect(f.count).toBe(720);
  });

  it('refuses too few or flat points', () => {
    expect(fitSphere([0, 0, 0, 1, 0, 0, 0, 1, 0])).toBeNull();
    const flat: number[] = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) flat.push(i, j, 0);
    expect(fitSphere(flat)).toBeNull();
  });
});

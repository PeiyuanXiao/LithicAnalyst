import type { Measurement, MeasureType } from './types';
import { distance } from './vec';

/** Points each kind of manual measurement needs. */
export const MEASURE_POINTS: Record<MeasureType, number> = { distance: 2, geodesic: 2, angle: 3 };

const polylineLength = (pts: ReadonlyArray<readonly [number, number, number]>): number => {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += distance(pts[i - 1] as [number, number, number], pts[i] as [number, number, number]);
  return l;
};

/** Angle at b between the rays toward a and c, in degrees (0 when a ray has no length). */
export function angleDeg(a: readonly number[], b: readonly number[], c: readonly number[]): number {
  const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const lu = Math.hypot(u[0], u[1], u[2]);
  const lv = Math.hypot(v[0], v[1], v[2]);
  if (!(lu > 0 && lv > 0)) return 0;
  const cos = Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** The measured value: a length in the specimen unit, or an angle in degrees. */
export function measurementValue(m: Measurement): number {
  switch (m.type) {
    case 'distance':
      return distance(m.points[0], m.points[1]);
    case 'geodesic':
      return polylineLength(m.path && m.path.length >= 2 ? m.path : m.points);
    case 'angle':
      return angleDeg(m.points[0], m.points[1], m.points[2]);
  }
}

/** Unit of the value: the specimen unit for lengths, "deg" for angles. */
export const measurementUnit = (m: Measurement, unit: string): string => (m.type === 'angle' ? 'deg' : unit);

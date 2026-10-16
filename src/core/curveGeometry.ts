import type { Curve, Vec3 } from './types';
import { distance } from './vec';

/**
 * A curve is stored as one polyline plus the position of each anchor in it.
 * Editing works on segments: segment i runs from anchor i to anchor i + 1
 * (both ends included); a closed curve has one more segment, back to anchor 0.
 */

export interface CurveShape {
  anchors: Vec3[];
  points: Vec3[];
  anchorIndex: number[];
  closed: boolean;
}

/** Join segments (each from one anchor to the next, both ends included) into a polyline. */
export function assembleCurve(segments: Vec3[][], closed: boolean): { points: Vec3[]; anchorIndex: number[] } {
  if (segments.length === 0) return { points: [], anchorIndex: [] };
  const points: Vec3[] = segments[0].map((p) => [p[0], p[1], p[2]] as Vec3);
  const anchorIndex = [0];
  for (let i = 1; i < segments.length; i++) {
    anchorIndex.push(points.length - 1);
    for (let k = 1; k < segments[i].length; k++) {
      const p = segments[i][k];
      points.push([p[0], p[1], p[2]]);
    }
  }
  if (closed) points.pop();
  else anchorIndex.push(points.length - 1);
  return { points, anchorIndex };
}

/** Split a curve back into its segments (inverse of assembleCurve). */
export function curveSegments(c: Pick<CurveShape, 'points' | 'anchorIndex' | 'closed'>): Vec3[][] {
  const { points, anchorIndex, closed } = c;
  const out: Vec3[][] = [];
  for (let i = 0; i + 1 < anchorIndex.length; i++) out.push(points.slice(anchorIndex[i], anchorIndex[i + 1] + 1));
  if (closed && anchorIndex.length > 0) out.push([...points.slice(anchorIndex[anchorIndex.length - 1]), points[0]]);
  return out;
}

/** Length along the polyline, including the closing segment of a closed curve. */
export function polylineLength(points: Vec3[], closed: boolean): number {
  let L = 0;
  for (let i = 1; i < points.length; i++) L += distance(points[i - 1], points[i]);
  if (closed && points.length > 2) L += distance(points[points.length - 1], points[0]);
  return L;
}

export const curveLength = (c: Pick<Curve, 'points' | 'closed'>): number => polylineLength(c.points, c.closed);

/** Index of the point halfway along the curve (for placing a label). */
export function midPointIndex(points: Vec3[]): number {
  if (points.length < 3) return 0;
  const half = polylineLength(points, false) / 2;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    acc += distance(points[i - 1], points[i]);
    if (acc >= half) return i;
  }
  return points.length - 1;
}

/** True if the anchors and their indices describe a usable curve. */
export function isValidShape(c: CurveShape): boolean {
  const n = c.points.length;
  if (n < 2 || c.anchors.length < 2 || c.anchors.length !== c.anchorIndex.length) return false;
  if (c.closed && (c.anchors.length < 3 || n < 3)) return false;
  let prev = -1;
  for (const i of c.anchorIndex) {
    if (!Number.isInteger(i) || i < 0 || i >= n || i < prev) return false;
    prev = i;
  }
  return c.anchorIndex[0] === 0 && (c.closed || c.anchorIndex[c.anchorIndex.length - 1] === n - 1);
}

import type { Curve, Vec3 } from '../core/types';
import { meanSegment, nearestOnLine } from './measuredLine';
import { JOIN_REACH_EDGES, overPiecesSteps, piecesAlongSteps, regionsSteps, type Partition } from './regions';
import type { Steps } from './steps';
import type { EdgeTable } from './meshGeometry';

/**
 * Retouch regions that follow their curves: a retouch curve with both ends on an edge cuts off a stretch of the face, and what lies
 * between it and the edge is retouched. Of the two sides the smaller, as with the platform outline; `retouchSide` on the curve says otherwise.
 * The band is one region however many curves cross it, or the retouch would be undercounted where a scar's outline happens to reach the edge.
 */

type CurveOf = Pick<Curve, 'points' | 'closed' | 'attributes' | 'retouchSide'>;

/** A retouch curve, open, with both ends on an edge (within the reach at which curves are joined). */
export function reachesEdge(c: CurveOf, curves: readonly CurveOf[]): boolean {
  if (c.attributes.type !== 'retouch' || c.closed || c.points.length < 2) return false;
  const edges = curves.filter((x) => x.attributes.type === 'edge' && x.points.length > 1);
  if (!edges.length) return false;
  const reach = JOIN_REACH_EDGES * meanSegment([c.points, ...edges.map((e) => e.points)]);
  return [c.points[0], c.points[c.points.length - 1]].every((end: Vec3) => edges.some((e) => nearestOnLine(end, e.points, e.closed).distance <= reach));
}

/** The curves that have a region following them: those reaching an edge, unless the user has done without (`off`). */
export const autoRetouchCurves = <T extends CurveOf>(curves: readonly T[]): T[] => curves.filter((c) => c.retouchSide !== 'off' && reachesEdge(c, curves));

/** One side of a curve: `cut` is the surface along the boundary curves and this one, `piece` that side in it. */
export interface RetouchSide {
  cut: Partition;
  piece: number;
}

/** Which side of a curve is retouched; null when it parts nothing (its ends do not close it off). `chain`: its mesh edges, as vertex pairs, its joins among them. */
export function* retouchSideSteps(positions: ArrayLike<number>, index: ArrayLike<number>, edges: EdgeTable, boundary: readonly number[], chain: readonly number[], side: 'smaller' | 'larger'): Steps<RetouchSide | null> {
  const cut = yield* regionsSteps(positions, index, edges, [...boundary, ...chain]);
  const sides = yield* piecesAlongSteps(index, edges, chain, cut);
  if (sides.length < 2) return null;
  const byArea = [...sides].sort((a, b) => cut.areas[a] - cut.areas[b]);
  return { cut, piece: side === 'larger' ? byArea[byArea.length - 1] : byArea[0] };
}

/** The pieces of the lower layer on that side; each lies wholly on one side, since the lower layer is cut along all that `cut` is. */
export function* bandPiecesSteps(lower: Partition, side: RetouchSide): Steps<number[]> {
  const over = yield* overPiecesSteps(lower, side.cut);
  const out: number[] = [];
  over.forEach((u, p) => {
    if (u === side.piece) out.push(p);
  });
  return out;
}

/**
 * Each piece to the smallest band it lies in, the band nearest the edge when one lies inside another; a piece a region of its own holds (`taken`) stays that region's.
 * By region id; a region left with nothing is not there.
 */
export function assignBands(bands: ReadonlyArray<{ regionId: string; pieces: readonly number[]; area: number }>, taken: ReadonlySet<number>): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const used = new Set(taken);
  for (const b of [...bands].sort((x, y) => x.area - y.area)) {
    const own = b.pieces.filter((p) => !used.has(p));
    for (const p of own) used.add(p);
    if (own.length) out.set(b.regionId, own);
  }
  return out;
}

/** The partition with each group of pieces made one; `map`: the piece each old one is now. The same partition when nothing is merged. */
export function mergePieces(part: Partition, groups: ReadonlyArray<readonly number[]>): { partition: Partition; map: Int32Array } {
  const into = Int32Array.from({ length: part.count }, (_, i) => i);
  let merged = false;
  for (const g of groups) {
    if (g.length < 2) continue;
    merged = true;
    for (const p of g) into[p] = g[0];
  }
  if (!merged) return { partition: part, map: into };
  const numbered = new Int32Array(part.count).fill(-1);
  let count = 0;
  for (let i = 0; i < part.count; i++) if (into[i] === i) numbered[i] = count++;
  const map = Int32Array.from(into, (t) => numbered[t]);
  const areas = new Float64Array(count);
  for (let i = 0; i < part.count; i++) areas[map[i]] += part.areas[i];
  const region = Uint32Array.from(part.region, (r) => map[r]);
  return { partition: { region, count, areas }, map };
}

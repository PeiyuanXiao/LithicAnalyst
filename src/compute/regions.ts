import type { Region, RegionType, Vec3 } from '../core/types';
import { edgeId, partitionFacesSteps, type EdgeTable } from './meshGeometry';
import { runSync, YIELD_EVERY, type Steps } from './steps';

/**
 * Mesh edges along a traced line, as vertex pairs (a0, b0, a1, b1, …): each
 * point goes to its nearest vertex, and consecutive vertices that are not
 * neighbours are joined by the shortest path over mesh edges (`path`).
 */
export function* polylineEdgesSteps(
  points: Vec3[],
  closed: boolean,
  nearestVertex: (p: Vec3) => number,
  edges: EdgeTable,
  path: (from: number, to: number) => ArrayLike<number> | null,
): Steps<number[]> {
  const verts: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i % 64 === 0) yield;
    verts.push(nearestVertex(points[i]));
  }
  if (closed && verts.length > 2) verts.push(verts[0]);
  const out: number[] = [];
  for (let i = 1; i < verts.length; i++) {
    if (i % 64 === 0) yield;
    const a = verts[i - 1], b = verts[i];
    if (a === b) continue;
    if (edgeId(edges, a, b) >= 0) {
      out.push(a, b);
      continue;
    }
    const chain = path(a, b);
    yield;
    if (!chain) continue;
    for (let k = 1; k < chain.length; k++) out.push(chain[k - 1], chain[k]);
  }
  return out;
}

/** The same at once (tests, small meshes). */
export const polylineEdges = (points: Vec3[], closed: boolean, nearestVertex: (p: Vec3) => number, edges: EdgeTable, path: (from: number, to: number) => ArrayLike<number> | null): number[] =>
  runSync(polylineEdgesSteps(points, closed, nearestVertex, edges, path));

export interface Partition {
  /** Region of each triangle. */
  region: Uint32Array;
  count: number;
  /** Surface area of each region. */
  areas: Float64Array;
}

/** Regions of the surface separated by the `barrier` edges, with their areas. */
export function* regionsSteps(positions: ArrayLike<number>, index: ArrayLike<number>, edges: EdgeTable, barrier: ArrayLike<number>): Steps<Partition> {
  const { region, count } = yield* partitionFacesSteps(index, barrier, edges);
  const areas = new Float64Array(count);
  const p = positions;
  for (let t = 0; 3 * t + 2 < index.length; t++) {
    if (t % YIELD_EVERY === 0) yield;
    const a = 3 * index[3 * t], b = 3 * index[3 * t + 1], c = 3 * index[3 * t + 2];
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    areas[region[t]] += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return { region, count, areas };
}

export interface RegionResult {
  id: string;
  label: string;
  type: RegionType;
  scarId: string | null;
  /** Area of the piece of surface holding the seed (null when the seed is off the mesh). */
  area: number | null;
  /** Another region's seed lies in the same piece. */
  conflict: boolean;
}

export interface RegionTotals {
  scar: number;
  cortex: number;
  joint: number;
  damage: number;
  /** Cortex area / total surface area. */
  cortexRatio: number;
}

/**
 * Regions from their seeds: `component[i]` is the piece of surface holding the
 * seed of `regions[i]` (−1 when none). A piece counts once in the totals, for
 * the first region in it.
 */
export function resolveRegions(regions: readonly Region[], component: number[], partition: Partition, totalArea: number): { results: RegionResult[]; totals: RegionTotals } {
  const owner = new Map<number, number>();
  component.forEach((c, i) => {
    if (c >= 0 && !owner.has(c)) owner.set(c, i);
  });
  const results = regions.map((r, i) => {
    const c = component[i];
    return {
      id: r.id,
      label: r.label,
      type: r.type,
      scarId: r.scarId,
      area: c >= 0 ? partition.areas[c] : null,
      conflict: c >= 0 && component.some((d, j) => j !== i && d === c),
    };
  });
  const totals: RegionTotals = { scar: 0, cortex: 0, joint: 0, damage: 0, cortexRatio: 0 };
  for (const [c, i] of owner) totals[regions[i].type] += partition.areas[c];
  totals.cortexRatio = totalArea > 0 ? totals.cortex / totalArea : 0;
  return { results, totals };
}

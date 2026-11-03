import { isUpperRegion } from '../core/fields';
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

/** An open curve's end this near another curve (in mean edge lengths) meets it. */
export const JOIN_REACH_EDGES = 4;

/**
 * Open curves that stop a little short of another curve are joined to it, or the two sides of them would run into
 * each other through the gap: `chains` the curves' mesh edges (vertex pairs), `positions` the mesh's.
 */
export function* joinOpenEndsSteps(chains: readonly number[][], open: readonly boolean[], positions: ArrayLike<number>, reach: number, path: (from: number, to: number) => ArrayLike<number> | null): Steps<number[][]> {
  const out = chains.map((c) => [...c]);
  for (let i = 0; i < chains.length; i++) {
    yield;
    const chain = chains[i];
    if (!open[i] || chain.length < 2) continue;
    for (const end of [chain[0], chain[chain.length - 1]]) {
      let best = -1, least = reach * reach, there = false;
      for (let j = 0; j < chains.length && !there; j++) {
        if (j === i) continue;
        for (const v of chains[j]) {
          if (v === end) there = true;
          const d = (positions[3 * v] - positions[3 * end]) ** 2 + (positions[3 * v + 1] - positions[3 * end + 1]) ** 2 + (positions[3 * v + 2] - positions[3 * end + 2]) ** 2;
          if (d <= least) {
            least = d;
            best = v;
          }
        }
      }
      if (there || best < 0) continue;
      const link = path(end, best);
      yield;
      if (link) for (let k = 1; k < link.length; k++) out[i].push(link[k - 1], link[k]);
    }
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

/**
 * Where the smaller of the pieces along a closed line lies (a point of the triangle nearest
 * the piece's centre), for the platform outline: `barrier` the line's mesh edges, as
 * vertex pairs, `partition` the pieces it makes. Null when it does not part the surface.
 */
export function* smallerPieceSteps(positions: ArrayLike<number>, index: ArrayLike<number>, edges: EdgeTable, barrier: ArrayLike<number>, partition: Partition): Steps<{ seed: Vec3; area: number } | null> {
  const onLine = new Uint8Array(edges.v0.length);
  for (let i = 0; i + 1 < barrier.length; i += 2) {
    const e = edgeId(edges, barrier[i], barrier[i + 1]);
    if (e >= 0) onLine[e] = 1;
  }
  // only the pieces the line touches: a mesh may have others apart from it
  const touching = new Uint8Array(partition.count);
  const n = Math.floor(index.length / 3);
  for (let t = 0; t < n; t++) {
    if (t % YIELD_EVERY === 0) yield;
    if (onLine[edges.ofSide[3 * t]] || onLine[edges.ofSide[3 * t + 1]] || onLine[edges.ofSide[3 * t + 2]]) touching[partition.region[t]] = 1;
  }
  let piece = -1, sides = 0;
  for (let c = 0; c < partition.count; c++) {
    if (!touching[c]) continue;
    sides++;
    if (piece < 0 || partition.areas[c] < partition.areas[piece]) piece = c;
  }
  if (sides < 2 || piece < 0) return null;
  const seed = yield* pieceSeedSteps(positions, index, partition, piece);
  return { seed, area: partition.areas[piece] };
}

/** A point in a piece of surface: the middle of the triangle nearest the piece's centre. */
export function* pieceSeedSteps(positions: ArrayLike<number>, index: ArrayLike<number>, partition: Partition, piece: number): Steps<Vec3> {
  const n = Math.floor(index.length / 3);
  const sum = [0, 0, 0];
  let weight = 0;
  const p = positions;
  const centre = (t: number): Vec3 => {
    const a = 3 * index[3 * t], b = 3 * index[3 * t + 1], c = 3 * index[3 * t + 2];
    return [(p[a] + p[b] + p[c]) / 3, (p[a + 1] + p[b + 1] + p[c + 1]) / 3, (p[a + 2] + p[b + 2] + p[c + 2]) / 3];
  };
  for (let t = 0; t < n; t++) {
    if (t % YIELD_EVERY === 0) yield;
    if (partition.region[t] !== piece) continue;
    const m = centre(t);
    for (let k = 0; k < 3; k++) sum[k] += m[k];
    weight++;
  }
  const at: Vec3 = [sum[0] / weight, sum[1] / weight, sum[2] / weight];
  let best = Infinity, seed = at;
  for (let t = 0; t < n; t++) {
    if (t % YIELD_EVERY === 0) yield;
    if (partition.region[t] !== piece) continue;
    const m = centre(t);
    const d = (m[0] - at[0]) ** 2 + (m[1] - at[1]) ** 2 + (m[2] - at[2]) ** 2;
    if (d < best) {
      best = d;
      seed = m;
    }
  }
  return seed;
}

/**
 * The upper piece each lower piece lies in. The lower layer is cut along every curve and the upper along
 * some of them, so a lower piece always lies wholly in one upper piece.
 */
export function* overPiecesSteps(lower: Partition, upper: Partition): Steps<Int32Array> {
  const over = new Int32Array(lower.count).fill(-1);
  for (let t = 0; t < lower.region.length; t++) {
    if (t % YIELD_EVERY === 0) yield;
    over[lower.region[t]] = upper.region[t];
  }
  return over;
}

/**
 * A flake's faces among the pieces of the upper layer: the ventral face is the piece under the technical axis
 * (`ventral`), the dorsal face the largest other than it and the platform. None when the two are not apart: the
 * edge does not close (nothing else of a size is left, at least 5 % of the surface).
 */
export function flakeFacePieces(part: Partition, platform: number, ventral: number): { ventral: number; dorsal: number } {
  const none = { ventral: -1, dorsal: -1 };
  if (ventral < 0 || ventral === platform) return none;
  let dorsal = -1, total = 0;
  for (let c = 0; c < part.count; c++) {
    total += part.areas[c];
    if (c !== platform && c !== ventral && (dorsal < 0 || part.areas[c] > part.areas[dorsal])) dorsal = c;
  }
  return dorsal >= 0 && part.areas[dorsal] >= 0.05 * total ? { ventral, dorsal } : none;
}

/** The triangles of these pieces. */
export function* facesOfPiecesSteps(partition: Partition, pieces: ReadonlySet<number>): Steps<Uint32Array> {
  const out: number[] = [];
  for (let t = 0; t < partition.region.length; t++) {
    if (t % YIELD_EVERY === 0) yield;
    if (pieces.has(partition.region[t])) out.push(t);
  }
  return Uint32Array.from(out);
}

export interface RegionResult {
  id: string;
  label: string;
  type: RegionType;
  scarId: string | null;
  /** Area of the piece of surface holding the seed (null when the seed is off the mesh). */
  area: number | null;
  /** Another region's seed lies in the same piece (of the same layer). */
  conflict: boolean;
  /** The upper region this one lies in (its id); null in the upper layer, or where there is none. */
  parent: string | null;
  /** The retouch layer (null for other types). */
  retouchLayer: number | null;
}

export interface RegionTotals {
  scar: number;
  cortex: number;
  joint: number;
  damage: number;
  flaking_surface: number;
  platform: number;
  ventral: number;
  dorsal: number;
  retouch: number;
  /** Cortex area / total surface area. */
  cortexRatio: number;
}

/** The upper layer of regions: the piece of each upper region (−1 for the others), its partition, and the upper piece of each lower piece. */
export interface UpperLayer {
  component: readonly number[];
  partition: Partition;
  over: ArrayLike<number>;
}

/**
 * Regions from their seeds: `component[i]` is the piece of surface holding the seed of `regions[i]` (−1
 * when none), in the layer the region belongs to. Upper regions go by `upper`, when given; a lower region
 * then knows the upper region it lies in. Within a layer a piece counts once in the totals, for the first
 * region in it; the layers overlap, so an area may count in both. The user's own types have no total.
 */
export function resolveRegions(regions: readonly Region[], component: readonly number[], partition: Partition, totalArea: number, upper: UpperLayer | null = null): { results: RegionResult[]; totals: RegionTotals } {
  const isUp = (r: Region) => !!upper && isUpperRegion(r.type);
  const piece = (i: number) => (isUp(regions[i]) ? upper!.component[i] : component[i]);
  const owner = new Map<number, number>();
  const ownerUp = new Map<number, number>();
  regions.forEach((r, i) => {
    const c = piece(i);
    const map = isUp(r) ? ownerUp : owner;
    if (c >= 0 && !map.has(c)) map.set(c, i);
  });
  const results = regions.map((r, i) => {
    const c = piece(i);
    const up = isUp(r);
    const area = c < 0 ? null : (up ? upper!.partition : partition).areas[c];
    const above = !up && upper && c >= 0 ? ownerUp.get(upper.over[c]) : undefined;
    return {
      id: r.id,
      label: r.label,
      type: r.type,
      scarId: r.scarId,
      area,
      conflict: c >= 0 && regions.some((o, j) => j !== i && isUp(o) === up && piece(j) === c),
      parent: above === undefined ? null : regions[above].id,
      retouchLayer: r.type === 'retouch' ? r.retouchLayer ?? 1 : null,
    };
  });
  const totals: RegionTotals = { scar: 0, cortex: 0, joint: 0, damage: 0, flaking_surface: 0, platform: 0, ventral: 0, dorsal: 0, retouch: 0, cortexRatio: 0 };
  const add = (type: string, area: number) => {
    if (type in totals && type !== 'cortexRatio') totals[type as Exclude<keyof RegionTotals, 'cortexRatio'>] += area;
  };
  for (const [c, i] of owner) add(regions[i].type, partition.areas[c]);
  if (upper) for (const [c, i] of ownerUp) add(regions[i].type, upper.partition.areas[c]);
  totals.cortexRatio = totalArea > 0 ? totals.cortex / totalArea : 0;
  return { results, totals };
}

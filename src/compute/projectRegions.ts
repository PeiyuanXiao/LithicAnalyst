import { isBoundaryCurve, isUpperRegion, layerCurves, PLATFORM_OUTLINE } from '../core/fields';
import type { Curve, ProjectState, Vec3 } from '../core/types';
import { buildAdjacency } from './curvature';
import { gmSteps, type GmRegionSource, type GmResult } from './gm';
import { buildEdgesSteps } from './meshGeometry';
import { assignBands, bandPiecesSteps, mergePieces, retouchSideSteps } from './retouchBand';
import { facesOfPiecesSteps, flakeFacePieces, joinOpenEndsSteps, JOIN_REACH_EDGES, overPiecesSteps, polylineEdgesSteps, regionsSteps, smallerPieceSteps, type Partition } from './regions';
import { runSync, type Steps } from './steps';
import { PathSearch } from './surfacePath';
import { triangleBvhSteps, type TriangleBvh } from './triangleBvh';

/**
 * Where a project's regions lie on a mesh, from its curves and seeds alone. The app works it out as the annotations change; a summary export has to for every model of
 * the folder, in the batch worker, with neither view nor three.js. What decides which piece a region is stands here for both.
 */

type RegionInput = Pick<ProjectState, 'specimen' | 'regions' | 'curves' | 'flake'>;

/** Whether a region lies in the lower layer of a project: not the upper layer's, nor on another type of specimen one left over that followed a flake's annotations. */
export const inLowerLayer = (st: Pick<ProjectState, 'specimen'>, r: ProjectState['regions'][number]): boolean => !isUpperRegion(r.type, st.specimen.type) && !(st.specimen.type !== 'flake' && r.auto);

/** The piece of each upper region of a project (−1: none, or a lower region): by its seed, or, one that follows other annotations, as they say, unless a region the user typed is there. */
export function upperComponentsOf(st: RegionInput, part: Partition, platformSeed: Vec3 | null, pieceAt: (part: Partition, p: Vec3) => number): number[] {
  const out = st.regions.map((r) => (isUpperRegion(r.type, st.specimen.type) && !r.auto ? pieceAt(part, r.seed) : -1));
  if (st.specimen.type !== 'flake') return out;
  const platform = platformSeed ? pieceAt(part, platformSeed) : -1;
  const hint = st.flake.axis?.matrix ? pieceAt(part, st.flake.axis.end) : -1;
  const faces = flakeFacePieces(part, platform, hint);
  st.regions.forEach((r, i) => {
    if (!r.auto) return;
    const c = r.type === 'platform' ? platform : r.type === 'ventral' ? faces.ventral : r.type === 'dorsal' ? faces.dorsal : -1;
    if (c >= 0 && !out.includes(c)) out[i] = c;
  });
  return out;
}

/** Each retouch band's pieces (those a region of its own holds stay that region's), by the id of the region following its curve. */
export function bandGroupsOf(st: Pick<ProjectState, 'specimen' | 'regions'>, part: Partition, bands: ReadonlyMap<string, { pieces: number[]; area: number }>, pieceAt: (part: Partition, p: Vec3) => number): Map<string, number[]> {
  const taken = new Set(st.regions.filter((r) => inLowerLayer(st, r) && !r.curveId).map((r) => pieceAt(part, r.seed)));
  return assignBands(st.regions.flatMap((r) => {
    const b = r.auto && r.curveId ? bands.get(r.curveId) : undefined;
    return b ? [{ regionId: r.id, pieces: b.pieces, area: b.area }] : [];
  }), taken);
}

/** Where the regions lie: the two layers, and the piece of each region in its own. */
export interface RegionLayers {
  lower: Partition;
  upper: Partition | null;
  lowerComponent: readonly number[];
  upperComponent: readonly number[];
}

/** The one region of a type, on these layers; a tree of its own for each, kept in `trees` (the caller says how long). */
export function regionSourceOf(st: Pick<ProjectState, 'regions' | 'specimen'>, layers: RegionLayers, positions: ArrayLike<number>, index: ArrayLike<number>, trees: Map<string, TriangleBvh>): GmRegionSource {
  return {
    find(type) {
      const up = isUpperRegion(type, st.specimen.type);
      const part = up ? layers.upper : layers.lower;
      const pieces = new Set<number>();
      st.regions.forEach((r, i) => {
        if (r.type !== type) return;
        const c = up ? layers.upperComponent[i] : layers.lowerComponent[i];
        if (c >= 0) pieces.add(c);
      });
      if (!part || !pieces.size) return { reason: 'region_missing' };
      if (pieces.size > 1) return { reason: 'region_ambiguous' };
      const piece = [...pieces][0];
      const faces = runSync(facesOfPiecesSteps(part, pieces));
      const key = `${up ? 'u' : 'l'}${piece}`;
      return {
        faces,
        area: part.areas[piece],
        bvh: function* () {
          let tree = trees.get(key);
          if (!tree) {
            tree = yield* triangleBvhSteps(positions, index, faces);
            trees.set(key, tree);
          }
          return tree;
        },
      };
    },
  };
}

export interface RegionMesh {
  /** Relative to `offset`; the annotations are in original coordinates. */
  positions: ArrayLike<number>;
  index: ArrayLike<number>;
  offset: Vec3;
}

/** A project's regions on a mesh, as the app finds them: its curves as mesh edges, cut into two layers, its retouch bands one piece each, and each region's piece. */
export function* projectLayersSteps(st: RegionInput, mesh: RegionMesh): Steps<RegionLayers> {
  const { positions: pos, index: idx, offset: o } = mesh;
  const n = Math.floor(pos.length / 3);
  const edges = yield* buildEdgesSteps(idx, n);
  let sum = 0;
  for (let e = 0; e < edges.v0.length; e++) {
    const a = 3 * edges.v0[e], b = 3 * edges.v1[e];
    sum += Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]);
  }
  const meanEdge = edges.v0.length ? sum / edges.v0.length : 0;
  yield;
  const whole = yield* triangleBvhSteps(pos, idx);
  const local = (p: Vec3): Vec3 => [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
  const faceAt = (p: Vec3): number => whole.closest(local(p))?.face ?? -1;
  const nearestVertex = (p: Vec3): number => {
    const f = faceAt(p);
    if (f < 0) return 0;
    const q = local(p);
    let best = idx[3 * f], least = Infinity;
    for (let k = 0; k < 3; k++) {
      const v = idx[3 * f + k];
      const d = (pos[3 * v] - q[0]) ** 2 + (pos[3 * v + 1] - q[1]) ** 2 + (pos[3 * v + 2] - q[2]) ** 2;
      if (d < least) {
        least = d;
        best = v;
      }
    }
    return best;
  };
  const search = new PathSearch(pos, buildAdjacency(idx, n));
  yield;
  const path = (a: number, b: number) => {
    search.start(a, null);
    return search.reach(b) ? search.path(b) : null;
  };
  const type = st.specimen.type;
  const chainsOf = function* (curves: readonly Curve[]): Steps<number[][]> {
    const chains: number[][] = [];
    for (const c of curves) chains.push(yield* polylineEdgesSteps(c.points, c.closed, nearestVertex, edges, path));
    return yield* joinOpenEndsSteps(chains, curves.map((c) => !c.closed), pos, JOIN_REACH_EDGES * meanEdge, path, curves.map((c) => isBoundaryCurve(c.attributes.type, type)), curves.map((c) => isBoundaryCurve(c.attributes.type, type) || (type === 'flake' && c.attributes.type === 'retouch')));
  };
  const chains = yield* chainsOf(st.curves);
  const cuts = layerCurves(st.curves.map((c, i) => ({ attributes: c.attributes, chain: chains[i] })), type);
  const raw = yield* regionsSteps(pos, idx, edges, cuts.lower.flatMap((c) => c.chain));
  const boundary = cuts.upper.flatMap((c) => c.chain);
  const upper = yield* regionsSteps(pos, idx, edges, boundary);
  yield* overPiecesSteps(raw, upper);
  const pieceAt = (part: Partition, p: Vec3): number => {
    const f = faceAt(p);
    return f >= 0 ? part.region[f] : -1;
  };
  // the retouch bands, one piece each
  const bands = new Map<string, { pieces: number[]; area: number }>();
  if (type === 'flake') {
    for (const r of st.regions) {
      const i = r.auto && r.curveId ? st.curves.findIndex((c) => c.id === r.curveId) : -1;
      if (i < 0) continue;
      const c = st.curves[i];
      const side = yield* retouchSideSteps(pos, idx, edges, boundary, chains[i], c.retouchSide === 'larger' ? 'larger' : 'smaller');
      if (side) bands.set(c.id, { pieces: yield* bandPiecesSteps(raw, side), area: side.cut.areas[side.piece] });
    }
  }
  const groups = bandGroupsOf(st, raw, bands, pieceAt);
  const { partition: lower, map } = mergePieces(raw, [...groups.values()]);
  const bandPiece = new Map([...groups].map(([id, pieces]) => [id, map[pieces[0]]]));
  // the platform: the smaller of what the outline parts
  let platformSeed: Vec3 | null = null;
  const outline = type === 'flake' ? st.curves.find((c) => c.attributes.type === PLATFORM_OUTLINE && c.closed) : undefined;
  if (outline) {
    const barrier = (yield* chainsOf([outline])).flat();
    const part = yield* regionsSteps(pos, idx, edges, barrier);
    const found = yield* smallerPieceSteps(pos, idx, edges, barrier, part);
    if (found) platformSeed = [found.seed[0] + o[0], found.seed[1] + o[1], found.seed[2] + o[2]];
  }
  return {
    lower,
    upper,
    lowerComponent: st.regions.map((r) => (!inLowerLayer(st, r) ? -1 : r.curveId ? (bandPiece.get(r.id) ?? -1) : pieceAt(lower, r.seed))),
    upperComponent: upperComponentsOf(st, upper, platformSeed, pieceAt),
  };
}

/** A specimen's points on its mesh, from the project alone, by the template (no surface semilandmarks by a grid: those look for the mesh along lines, with the view's tree). */
export function* gmOfProjectSteps(st: ProjectState, mesh: RegionMesh, templateAvailable: boolean): Steps<GmResult> {
  const t = st.gm.template;
  // only what is carried needs the regions
  const carried = st.gm.patches.length > 0 && !!t && st.mesh?.sha256 !== t.sha256;
  const layers = carried ? yield* projectLayersSteps(st, mesh) : null;
  return yield* gmSteps(st, { positions: mesh.positions, index: mesh.index, offset: mesh.offset, platformFaces: null, templateAvailable, regions: layers ? regionSourceOf(st, layers, mesh.positions, mesh.index, new Map()) : null });
}

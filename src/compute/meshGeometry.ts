import type { Vec3 } from '../core/types';
import { signedVolume } from './curvature';
import { symmetricEigen3 } from './linalg';
import { runSync, YIELD_EVERY, type Steps } from './steps';

/**
 * Whole-mesh geometry on typed arrays (positions xyz…, triangle index abc…):
 * area, volume, topology checks, principal axes, plane sections, partitions
 * and plane fitting. Pure functions, no DOM or three.js.
 */

export { signedVolume };

export function surfaceArea(positions: ArrayLike<number>, index: ArrayLike<number>): number {
  let area = 0;
  for (let t = 0; t + 2 < index.length; t += 3) area += triangleArea(positions, index[t], index[t + 1], index[t + 2]);
  return area;
}

function triangleArea(p: ArrayLike<number>, a: number, b: number, c: number): number {
  const ux = p[3 * b] - p[3 * a], uy = p[3 * b + 1] - p[3 * a + 1], uz = p[3 * b + 2] - p[3 * a + 2];
  const vx = p[3 * c] - p[3 * a], vy = p[3 * c + 1] - p[3 * a + 1], vz = p[3 * c + 2] - p[3 * a + 2];
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

// ---------------------------------------------------------------- edges

/** The undirected edges of a triangle mesh. */
export interface EdgeTable {
  /** Endpoints of edge e, v0[e] < v1[e]; edges are sorted by v0. */
  v0: Uint32Array;
  v1: Uint32Array;
  /** Number of triangles that use each edge (1 = boundary, 2 = interior, more = non-manifold). */
  faces: Uint32Array;
  /** Edge of each triangle side: side k of triangle t (corner k to corner k+1) is ofSide[3t + k]. */
  ofSide: Uint32Array;
  /** Edges starting at vertex v (as v0) are firstEdge[v] … firstEdge[v + 1] − 1. */
  firstEdge: Uint32Array;
}

export function buildEdges(index: ArrayLike<number>, vertexCount: number): EdgeTable {
  return runSync(buildEdgesSteps(index, vertexCount));
}

export function* buildEdgesSteps(index: ArrayLike<number>, vertexCount: number): Steps<EdgeTable> {
  const sides = index.length - (index.length % 3);
  // bucket every triangle side under its smaller vertex
  const offsets = new Uint32Array(vertexCount + 1);
  for (let s = 0; s < sides; s++) {
    const a = index[s], b = index[s % 3 === 2 ? s - 2 : s + 1];
    offsets[Math.min(a, b) + 1]++;
    if (s % YIELD_EVERY === 0) yield;
  }
  for (let v = 0; v < vertexCount; v++) offsets[v + 1] += offsets[v];
  const fill = offsets.slice(0, vertexCount);
  const other = new Uint32Array(sides);
  const sideOf = new Uint32Array(sides);
  for (let s = 0; s < sides; s++) {
    const a = index[s], b = index[s % 3 === 2 ? s - 2 : s + 1];
    const lo = Math.min(a, b);
    const i = fill[lo]++;
    other[i] = Math.max(a, b);
    sideOf[i] = s;
    if (s % YIELD_EVERY === 0) yield;
  }
  // merge equal (v0, v1) pairs within each bucket into one edge
  const v0: number[] = [];
  const v1: number[] = [];
  const faces: number[] = [];
  const ofSide = new Uint32Array(sides);
  const firstEdge = new Uint32Array(vertexCount + 1);
  for (let v = 0; v < vertexCount; v++) {
    firstEdge[v] = v0.length;
    const begin = v0.length;
    for (let i = offsets[v]; i < offsets[v + 1]; i++) {
      let e = begin;
      while (e < v0.length && v1[e] !== other[i]) e++;
      if (e === v0.length) {
        v0.push(v);
        v1.push(other[i]);
        faces.push(0);
      }
      faces[e]++;
      ofSide[sideOf[i]] = e;
    }
    if (v % YIELD_EVERY === 0) yield;
  }
  firstEdge[vertexCount] = v0.length;
  return { v0: Uint32Array.from(v0), v1: Uint32Array.from(v1), faces: Uint32Array.from(faces), ofSide, firstEdge };
}

/** Edge id joining vertices a and b, or −1 when they are not joined by an edge. */
export function edgeId(edges: EdgeTable, a: number, b: number): number {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (lo + 1 >= edges.firstEdge.length) return -1;
  for (let e = edges.firstEdge[lo]; e < edges.firstEdge[lo + 1]; e++) if (edges.v1[e] === hi) return e;
  return -1;
}

class UnionFind {
  private parent: Uint32Array;
  constructor(n: number) {
    this.parent = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(i: number): number {
    const p = this.parent;
    while (p[i] !== i) {
      p[i] = p[p[i]];
      i = p[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

// ---------------------------------------------------------------- topology

export interface MeshTopology {
  /** Edges used by exactly one triangle. */
  boundaryEdges: number;
  /** Connected chains of boundary edges (holes and open borders). */
  boundaryLoops: number;
  /** Edges used by more than two triangles. */
  nonManifoldEdges: number;
  /** Pieces connected through shared vertices. */
  components: number;
  /** No boundary and no non-manifold edge: the mesh encloses a volume. */
  closed: boolean;
}

export function meshTopology(index: ArrayLike<number>, vertexCount: number, edges = buildEdges(index, vertexCount)): MeshTopology {
  const parts = new UnionFind(vertexCount);
  const rims = new UnionFind(vertexCount);
  const onRim = new Uint8Array(vertexCount);
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (let e = 0; e < edges.v0.length; e++) {
    const a = edges.v0[e], b = edges.v1[e];
    parts.union(a, b);
    if (edges.faces[e] === 1) {
      boundaryEdges++;
      rims.union(a, b);
      onRim[a] = onRim[b] = 1;
    } else if (edges.faces[e] > 2) nonManifoldEdges++;
  }
  const used = new Uint8Array(vertexCount);
  for (let i = 0; i < index.length - (index.length % 3); i++) used[index[i]] = 1;
  let components = 0;
  let boundaryLoops = 0;
  for (let v = 0; v < vertexCount; v++) {
    if (used[v] && parts.find(v) === v) components++;
    if (onRim[v] && rims.find(v) === v) boundaryLoops++;
  }
  return { boundaryEdges, boundaryLoops, nonManifoldEdges, components, closed: boundaryEdges === 0 && nonManifoldEdges === 0 };
}

// ---------------------------------------------------------------- principal axes

export interface PrincipalAxes {
  /** Mean (centre of the vertices, or of the surface for the area-weighted version). */
  mean: Vec3;
  /** Unit axes, largest variance first. */
  axes: [Vec3, Vec3, Vec3];
  /** Variance along each axis. */
  variances: [number, number, number];
}

function axesFromMoments(n: number, sum: number[], m: number[], ref: Vec3): PrincipalAxes {
  const mean = [sum[0] / n, sum[1] / n, sum[2] / n];
  const cov = new Array<number>(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[3 * i + j] = m[3 * i + j] / n - mean[i] * mean[j];
  const { values, vectors } = symmetricEigen3(cov);
  return {
    mean: [mean[0] + ref[0], mean[1] + ref[1], mean[2] + ref[2]],
    axes: vectors,
    variances: values.map((x) => Math.max(0, x)) as [number, number, number],
  };
}

/** PCA of the vertices, every vertex counted once. */
export function vertexPca(positions: ArrayLike<number>): PrincipalAxes {
  return runSync(vertexPcaSteps(positions));
}

export function* vertexPcaSteps(positions: ArrayLike<number>): Steps<PrincipalAxes> {
  const n = Math.floor(positions.length / 3);
  // accumulate relative to the first vertex: scans can sit far from the origin
  const ref: Vec3 = n ? [positions[0], positions[1], positions[2]] : [0, 0, 0];
  const sum = [0, 0, 0];
  const m = new Array<number>(9).fill(0);
  const p = [0, 0, 0];
  for (let v = 0; v < n; v++) {
    if (v % YIELD_EVERY === 0) yield;
    p[0] = positions[3 * v] - ref[0];
    p[1] = positions[3 * v + 1] - ref[1];
    p[2] = positions[3 * v + 2] - ref[2];
    for (let i = 0; i < 3; i++) {
      sum[i] += p[i];
      for (let j = 0; j < 3; j++) m[3 * i + j] += p[i] * p[j];
    }
  }
  return axesFromMoments(Math.max(n, 1), sum, m, ref);
}

/** Area, signed volume and area-weighted moments of the surface, in one pass. */
export interface SurfaceIntegrals {
  area: number;
  /** Signed volume (divergence theorem); meaningful for closed meshes, negative if triangles face inward. */
  volume: number;
  /** Moments relative to `ref` (the first vertex), for precision far from the origin. */
  ref: Vec3;
  sum: number[];
  m: number[];
}

/**
 * Uses the exact second moment of a uniform triangle,
 * E[x xᵀ] = (a aᵀ + b bᵀ + c cᵀ + s sᵀ) / 12 with s = a + b + c.
 */
export function* surfaceIntegralsSteps(positions: ArrayLike<number>, index: ArrayLike<number>): Steps<SurfaceIntegrals> {
  const ref: Vec3 = positions.length >= 3 ? [positions[0], positions[1], positions[2]] : [0, 0, 0];
  const sum = [0, 0, 0];
  const m = new Array<number>(9).fill(0);
  let area = 0;
  let volume = 0;
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], s = [0, 0, 0];
  const load = (out: number[], v: number) => {
    out[0] = positions[3 * v] - ref[0];
    out[1] = positions[3 * v + 1] - ref[1];
    out[2] = positions[3 * v + 2] - ref[2];
  };
  for (let t = 0; t + 2 < index.length; t += 3) {
    if (t % YIELD_EVERY === 0) yield;
    load(a, index[t]);
    load(b, index[t + 1]);
    load(c, index[t + 2]);
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const ar = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (ar === 0) continue;
    area += ar;
    for (let i = 0; i < 3; i++) s[i] = a[i] + b[i] + c[i];
    for (let i = 0; i < 3; i++) {
      sum[i] += (ar * s[i]) / 3;
      for (let j = 0; j < 3; j++) m[3 * i + j] += (ar * (a[i] * a[j] + b[i] * b[j] + c[i] * c[j] + s[i] * s[j])) / 12;
    }
  }
  return { area, volume, ref, sum, m };
}

/** Principal axes of the surface from its integrals. */
export const surfacePca = (s: SurfaceIntegrals): PrincipalAxes => axesFromMoments(s.area || 1, s.sum, s.m, s.ref);

/**
 * PCA of the surface itself (every point of every triangle, i.e. vertices
 * weighted by the area around them): independent of how densely the scanner
 * sampled each part.
 */
export function areaWeightedPca(positions: ArrayLike<number>, index: ArrayLike<number>): PrincipalAxes {
  return surfacePca(runSync(surfaceIntegralsSteps(positions, index)));
}

// ---------------------------------------------------------------- planes

export interface FittedPlane {
  /** Mean of the points (a point on the plane). */
  centroid: Vec3;
  /** Unit normal (sign arbitrary). */
  normal: Vec3;
  /** Root-mean-square distance of the points from the plane. */
  rms: number;
  /** Variances along the in-plane axes and the normal, largest first; the last is rms². */
  variances: [number, number, number];
}

/**
 * Total least-squares plane: the normal is the direction of least variance
 * (the last right singular vector of the centred points, here taken from the
 * eigenvectors of their covariance). Null for fewer than three points.
 */
export function fitPlane(points: ArrayLike<number> | Vec3[]): FittedPlane | null {
  const flat: ArrayLike<number> = Array.isArray(points) && Array.isArray(points[0]) ? (points as Vec3[]).flat() : (points as ArrayLike<number>);
  if (flat.length < 9) return null;
  const pca = vertexPca(flat);
  return { centroid: pca.mean, normal: pca.axes[2], rms: Math.sqrt(pca.variances[2]), variances: pca.variances };
}

export interface Polyline {
  points: Vec3[];
  /** The last point connects back to the first (not repeated). */
  closed: boolean;
}

/**
 * Where the plane through `point` with normal `normal` cuts the mesh, as
 * polylines (one per connected piece of the section). Vertices lying exactly
 * on the plane count as being on its positive side, so every crossing is a
 * proper edge crossing.
 */
export function intersectPlane(
  positions: ArrayLike<number>,
  index: ArrayLike<number>,
  point: Vec3,
  normal: Vec3,
  edges = buildEdges(index, Math.floor(positions.length / 3)),
): Polyline[] {
  return runSync(intersectPlaneSteps(positions, index, point, normal, edges));
}

export function* intersectPlaneSteps(
  positions: ArrayLike<number>,
  index: ArrayLike<number>,
  point: Vec3,
  normal: Vec3,
  edges: EdgeTable,
): Steps<Polyline[]> {
  const n = Math.floor(positions.length / 3);
  const d = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    if (v % YIELD_EVERY === 0) yield;
    d[v] = (positions[3 * v] - point[0]) * normal[0] + (positions[3 * v + 1] - point[1]) * normal[1] + (positions[3 * v + 2] - point[2]) * normal[2];
  }
  const side = (v: number) => d[v] >= 0;
  const edgeCount = edges.v0.length;
  // each crossed edge links to at most two others (the other crossed side of its triangles)
  const link = new Int32Array(edgeCount * 2).fill(-1);
  const crossed = new Uint8Array(edgeCount);
  const tris = Math.floor(index.length / 3);
  for (let t = 0; t < tris; t++) {
    if (t % YIELD_EVERY === 0) yield;
    const hits: number[] = [];
    for (let k = 0; k < 3; k++) {
      const a = index[3 * t + k], b = index[3 * t + ((k + 1) % 3)];
      if (side(a) !== side(b)) hits.push(edges.ofSide[3 * t + k]);
    }
    if (hits.length !== 2) continue;
    const [e, f] = hits;
    crossed[e] = crossed[f] = 1;
    for (const [x, y] of [
      [e, f],
      [f, e],
    ]) {
      if (link[2 * x] < 0) link[2 * x] = y;
      else if (link[2 * x + 1] < 0) link[2 * x + 1] = y;
    }
  }
  const crossing = (e: number): Vec3 => {
    const a = edges.v0[e], b = edges.v1[e];
    const t = d[a] / (d[a] - d[b]);
    return [
      positions[3 * a] + t * (positions[3 * b] - positions[3 * a]),
      positions[3 * a + 1] + t * (positions[3 * b + 1] - positions[3 * a + 1]),
      positions[3 * a + 2] + t * (positions[3 * b + 2] - positions[3 * a + 2]),
    ];
  };
  const done = new Uint8Array(edgeCount);
  const walk = (from: number): number[] => {
    const chain: number[] = [];
    let cur = from;
    while (cur >= 0 && !done[cur]) {
      done[cur] = 1;
      chain.push(cur);
      const a = link[2 * cur], b = link[2 * cur + 1];
      cur = a >= 0 && !done[a] ? a : b >= 0 && !done[b] ? b : -1;
    }
    return chain;
  };
  // a vertex on the plane is where several crossed edges meet: drop the repeats
  const points = (chain: number[], closed: boolean): Vec3[] => {
    const pts: Vec3[] = [];
    for (const e of chain) {
      const p = crossing(e);
      const q = pts[pts.length - 1];
      if (!q || q[0] !== p[0] || q[1] !== p[1] || q[2] !== p[2]) pts.push(p);
    }
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (closed && pts.length > 1 && first[0] === last[0] && first[1] === last[1] && first[2] === last[2]) pts.pop();
    return pts;
  };
  const out: Polyline[] = [];
  // open pieces first, starting from their ends
  for (let e = 0; e < edgeCount; e++) {
    if (!crossed[e] || done[e] || link[2 * e + 1] >= 0) continue;
    out.push({ points: points(walk(e), false), closed: false });
  }
  for (let e = 0; e < edgeCount; e++) {
    if (!crossed[e] || done[e]) continue;
    const chain = walk(e);
    const last = chain[chain.length - 1];
    const closed = chain.length > 2 && (link[2 * last] === e || link[2 * last + 1] === e);
    out.push({ points: points(chain, closed), closed });
  }
  return out.filter((p) => p.points.length > 1);
}

// ---------------------------------------------------------------- partitions

export interface FacePartition {
  /** Region of each triangle, 0 … count − 1 (numbered in order of their first triangle). */
  region: Uint32Array;
  count: number;
}

/**
 * Split the triangles into connected regions: two triangles are in the same
 * region when they share an edge that is not one of the `barrier` edges
 * (given as vertex pairs a0, b0, a1, b1, …; pairs that are not mesh edges are ignored).
 */
export function partitionFaces(
  index: ArrayLike<number>,
  vertexCount: number,
  barrier: ArrayLike<number>,
  edges = buildEdges(index, vertexCount),
): FacePartition {
  return runSync(partitionFacesSteps(index, barrier, edges));
}

export function* partitionFacesSteps(index: ArrayLike<number>, barrier: ArrayLike<number>, edges: EdgeTable): Steps<FacePartition> {
  const blocked = new Uint8Array(edges.v0.length);
  for (let i = 0; i + 1 < barrier.length; i += 2) {
    const e = edgeId(edges, barrier[i], barrier[i + 1]);
    if (e >= 0) blocked[e] = 1;
  }
  const tris = Math.floor(index.length / 3);
  const uf = new UnionFind(tris);
  const firstFace = new Int32Array(edges.v0.length).fill(-1);
  for (let s = 0; s < 3 * tris; s++) {
    if (s % YIELD_EVERY === 0) yield;
    const e = edges.ofSide[s];
    if (blocked[e]) continue;
    const t = Math.floor(s / 3);
    if (firstFace[e] < 0) firstFace[e] = t;
    else uf.union(t, firstFace[e]);
  }
  const region = new Uint32Array(tris);
  const label = new Int32Array(tris).fill(-1);
  let count = 0;
  for (let t = 0; t < tris; t++) {
    if (t % YIELD_EVERY === 0) yield;
    const r = uf.find(t);
    if (label[r] < 0) label[r] = count++;
    region[t] = label[r];
  }
  return { region, count };
}

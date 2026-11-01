import * as THREE from 'three';
import type { HitPointInfo, MeshBVH } from 'three-mesh-bvh';
import type { Adjacency } from '../compute/curvature';
import type { CurvatureService } from '../compute/curvatureService';
import { featureCost, featureStrength, PathSearch, pathMobility, relaxPath, snapToFeature, type SnapMode, type SurfaceProjector } from '../compute/surfacePath';
import type { Vec3 } from '../core/types';
import type { LoadedMesh } from '../io/loadMesh';
import type { SurfaceHit } from '../render/viewer';

/** Coordinates are stored to 6 decimals (as in the CSV): far below scan resolution, and keeps files small. */
const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;

interface FeatureField {
  level: number;
  strength: Float32Array;
  cost: Float32Array;
}

/**
 * Connects the path engine to one loaded mesh: vertices from picks, ridge and
 * valley fields at the current curvature scale (the one used for shading, so
 * what you see is what snaps), and reusable path searches.
 */
export class SurfaceSnap {
  private adj: Adjacency | null = null;
  private readonly fields = new Map<SnapMode, FeatureField>();
  private readonly pending = new Map<string, Promise<boolean>>();
  private readonly searches: PathSearch[] = [];
  private readonly pos: Float32Array;
  private readonly nor: Float32Array;
  private readonly index: ArrayLike<number>;
  private readonly offset: Vec3;
  private disposed = false;

  constructor(
    private readonly loaded: LoadedMesh,
    private readonly curvature: CurvatureService,
    private readonly level: () => number,
  ) {
    const g = loaded.geometry;
    this.pos = g.getAttribute('position').array as Float32Array;
    this.nor = g.getAttribute('normal').array as Float32Array;
    this.index = g.index!.array as ArrayLike<number>;
    this.offset = loaded.offset;
  }

  dispose(): void {
    this.disposed = true;
    this.fields.clear();
    this.searches.length = 0;
  }

  private get currentLevel(): number {
    return Math.max(0, Math.round(this.level()));
  }

  /** True when `mode` can be used right now at the current curvature scale. */
  ready(mode: SnapMode): boolean {
    if (!this.adj || this.disposed) return false;
    if (mode === 'off') return true;
    return this.fields.get(mode)?.level === this.currentLevel;
  }

  /** Compute what `mode` needs (adjacency; curvature at the current scale). */
  prepare(mode: SnapMode): Promise<boolean> {
    if (this.ready(mode)) return Promise.resolve(true);
    const level = this.currentLevel;
    const key = `${mode}:${level}`;
    let p = this.pending.get(key);
    if (!p) {
      p = (async () => {
        const adj = this.adj ?? (await this.curvature.adjacency());
        if (!adj || this.disposed) return false;
        this.adj = adj;
        if (mode === 'off') return true;
        const f = await this.curvature.field(level);
        if (!f || this.disposed) return false;
        const strength = featureStrength(f.field, f.range, mode);
        this.fields.set(mode, { level, strength, cost: featureCost(strength) });
        return true;
      })().finally(() => this.pending.delete(key));
      this.pending.set(key, p);
    }
    return p;
  }

  /** Cost field for path search in `mode` (null = plain surface distance). Call when ready(mode). */
  cost(mode: SnapMode): Float32Array | null {
    return mode === 'off' ? null : (this.fields.get(mode)?.cost ?? null);
  }

  /** Feature strength per vertex in `mode` (null for 'off' or before it is prepared). */
  strength(mode: SnapMode): Float32Array | null {
    return mode === 'off' ? null : (this.fields.get(mode)?.strength ?? null);
  }

  /** The mesh's one-ring neighbours (null until prepared). */
  adjacency(): Adjacency | null {
    return this.disposed ? null : this.adj;
  }

  /** A reusable path search: slot 0 for drawing, 1 and 2 for editing. */
  search(slot: number): PathSearch | null {
    if (!this.adj || this.disposed) return null;
    return (this.searches[slot] ??= new PathSearch(this.pos, this.adj));
  }

  /** Feature strength at the vertex nearest `p` (null until `mode` is prepared). */
  strengthAt(mode: SnapMode, p: Vec3): number | null {
    const f = mode === 'off' ? undefined : this.fields.get(mode);
    return f ? f.strength[this.nearestVertex(p)] : null;
  }

  /** The `count` most pronounced feature vertices, strongest first (for tests and diagnostics). */
  strongest(mode: SnapMode, count: number): Array<{ p: Vec3; strength: number }> {
    const f = mode === 'off' ? undefined : this.fields.get(mode);
    if (!f) return [];
    const order = Array.from(f.strength.keys()).sort((a, b) => f.strength[b] - f.strength[a]);
    return order.slice(0, Math.max(0, count)).map((v) => ({ p: this.point(v), strength: f.strength[v] }));
  }

  /** Move vertex `v` onto a ridge or valley within `radius` (original units). */
  snap(v: number, radius: number, mode: SnapMode): number {
    const f = mode === 'off' ? undefined : this.fields.get(mode);
    if (!f || !this.adj) return v;
    return snapToFeature(v, radius, f.strength, this.pos, this.adj);
  }

  /** The hit triangle's corner closest to the picked point. */
  vertexOfHit(hit: SurfaceHit): number {
    const f = hit.faceIndex;
    const x = hit.point.x - this.offset[0], y = hit.point.y - this.offset[1], z = hit.point.z - this.offset[2];
    let best = this.index[3 * f];
    let bd = Infinity;
    for (let k = 0; k < 3; k++) {
      const v = this.index[3 * f + k];
      const d = (this.pos[3 * v] - x) ** 2 + (this.pos[3 * v + 1] - y) ** 2 + (this.pos[3 * v + 2] - z) ** 2;
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  /** Mesh vertex closest to a point given in original coordinates. */
  nearestVertex(p: Vec3): number {
    const bvh = this.loaded.geometry.boundsTree as unknown as MeshBVH | undefined;
    const q = new THREE.Vector3(p[0] - this.offset[0], p[1] - this.offset[1], p[2] - this.offset[2]);
    const hit = bvh?.closestPointToPoint(q, {} as HitPointInfo);
    if (!hit || hit.faceIndex < 0) return 0;
    return this.vertexOfHit({ point: new THREE.Vector3(p[0], p[1], p[2]), normal: new THREE.Vector3(), faceIndex: hit.faceIndex, distance: 0 });
  }

  /** Vertex position in original coordinates. */
  point(v: number): Vec3 {
    return [r6(this.pos[3 * v] + this.offset[0]), r6(this.pos[3 * v + 1] + this.offset[1]), r6(this.pos[3 * v + 2] + this.offset[2])];
  }

  normal(v: number): Vec3 {
    const s = this.loaded.orientationSign;
    return [s * this.nor[3 * v], s * this.nor[3 * v + 1], s * this.nor[3 * v + 2]];
  }

  points(chain: ArrayLike<number>): Vec3[] {
    const out: Vec3[] = new Array(chain.length);
    for (let i = 0; i < chain.length; i++) out[i] = this.point(chain[i]);
    return out;
  }

  /**
   * A traced vertex chain pulled taut along the surface (relaxPath): the
   * zig-zag along mesh edges goes, points on the ridge or valley that `mode`
   * traced stay on it, and the two ends stay where they are. Original coordinates.
   */
  refine(chain: ArrayLike<number>, mode: SnapMode, iterations?: number): Vec3[] {
    const n = chain.length;
    if (n < 3) return this.points(chain);
    const pts = new Float64Array(3 * n);
    const nor = new Float64Array(3 * n);
    const sign = this.loaded.orientationSign;
    let step = 0;
    for (let i = 0; i < n; i++) {
      const v = chain[i];
      for (let k = 0; k < 3; k++) {
        pts[3 * i + k] = this.pos[3 * v + k];
        nor[3 * i + k] = sign * this.nor[3 * v + k];
      }
      if (i > 0) step = Math.max(step, Math.hypot(pts[3 * i] - pts[3 * i - 3], pts[3 * i + 1] - pts[3 * i - 2], pts[3 * i + 2] - pts[3 * i - 1]));
    }
    const strength = mode === 'off' ? null : (this.fields.get(mode)?.strength ?? null);
    relaxPath(pts, nor, pathMobility(chain, strength), this.projector(2 * step), iterations);
    const out: Vec3[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = [r6(pts[3 * i] + this.offset[0]), r6(pts[3 * i + 1] + this.offset[1]), r6(pts[3 * i + 2] + this.offset[2])];
    return out;
  }

  /**
   * Make a polyline lie on the surface: where the midpoint of a segment is off
   * the surface (a chord across a convex edge cuts through the solid), the
   * closest surface point is inserted, up to `depth` times per segment.
   * Original coordinates in and out.
   */
  hug(points: Vec3[], depth = 8): Vec3[] {
    if (points.length < 2) return points;
    const o = this.offset;
    const tol = this.loaded.diagonal * 1e-5;
    const q = new Float64Array(3);
    const out = new Float64Array(3);
    const nrm = new Float64Array(3);
    const result: Vec3[] = [points[0]];
    const split = (a: Vec3, b: Vec3, level: number) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (level > 0 && len > tol) {
        for (let k = 0; k < 3; k++) q[k] = 0.5 * (a[k] + b[k]) - o[k];
        if (this.projector(len).closest(q, out, nrm) && Math.hypot(out[0] - q[0], out[1] - q[1], out[2] - q[2]) > tol) {
          const m: Vec3 = [r6(out[0] + o[0]), r6(out[1] + o[1]), r6(out[2] + o[2])];
          split(a, m, level - 1);
          split(m, b, level - 1);
          return;
        }
      }
      result.push(b);
    };
    for (let i = 1; i < points.length; i++) split(points[i - 1], points[i], depth);
    return result;
  }

  /** Closest surface point (local coordinates) within `reach`, with the outward normal of its triangle. */
  private projector(reach: number): SurfaceProjector {
    const bvh = this.loaded.geometry.boundsTree as unknown as MeshBVH | undefined;
    const q = new THREE.Vector3();
    const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: -1 } as HitPointInfo;
    const pos = this.pos;
    const idx = this.index;
    const sign = this.loaded.orientationSign;
    return {
      closest: (p, out, normal) => {
        if (!bvh) return false;
        q.set(p[0], p[1], p[2]);
        const h = bvh.closestPointToPoint(q, hit, 0, reach);
        if (!h || h.faceIndex < 0) return false;
        out[0] = h.point.x;
        out[1] = h.point.y;
        out[2] = h.point.z;
        const a = 3 * idx[3 * h.faceIndex], b = 3 * idx[3 * h.faceIndex + 1], c = 3 * idx[3 * h.faceIndex + 2];
        const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
        const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
        let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        const len = Math.hypot(nx, ny, nz);
        if (!(len > 0)) return false;
        nx *= sign / len;
        ny *= sign / len;
        nz *= sign / len;
        normal[0] = nx;
        normal[1] = ny;
        normal[2] = nz;
        return true;
      },
    };
  }
}

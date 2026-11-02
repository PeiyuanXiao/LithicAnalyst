import * as THREE from 'three';
import { BICONE_MIN_HEIGHT, biconePolar, type BiconeResult } from '../compute/bicone';
import type { BiconeCone } from '../core/fields';
import type { Vec3 } from '../core/types';

/**
 * What the configuration sketch and the view cube draw for the bicone model:
 * two cones on one round base, upper cone up (+Y), the base in the X–Z plane
 * laid out as the base's own coordinates (compute/bicone.ts: x along
 * reference × normal, the other along −reference), the larger of the diameter
 * and the whole height 1. Corners slightly rounded; arrows follow the cones.
 */

export interface BiconeSize {
  radius: number;
  upper: number;
  lower: number;
}

/** The drawn sizes: each cone at least `minShare` of the radius high (a drawing, not a measurement). */
export function biconeSize(r: Pick<BiconeResult, 'radius' | 'upperHeight' | 'lowerHeight'>, minShare = BICONE_MIN_HEIGHT): BiconeSize {
  const R = r.radius > 0 ? r.radius : 1;
  const upper = Math.max(r.upperHeight, minShare * R), lower = Math.max(r.lowerHeight, minShare * R);
  const s = 1 / Math.max(2 * R, upper + lower);
  return { radius: R * s, upper: upper * s, lower: lower * s };
}

/** The axes of the drawing in original coordinates: X, Y (the base's normal, toward the upper cone), Z (columns of a rotation). */
export function biconeAxes(r: Pick<BiconeResult, 'plane' | 'reference'>): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  const n = new THREE.Vector3(...r.plane.normal);
  const ref = new THREE.Vector3(...r.reference);
  return [new THREE.Vector3().crossVectors(ref, n), n, ref.clone().negate()];
}

/** A quadratic Bézier from `a` over `c` to `b`, from `s0` to `s1`. */
function bezier(a: THREE.Vector2, c: THREE.Vector2, b: THREE.Vector2, s0: number, s1: number, steps: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const s = s0 + ((s1 - s0) * i) / steps;
    out.push(new THREE.Vector2((1 - s) * (1 - s) * a.x + 2 * (1 - s) * s * c.x + s * s * b.x, (1 - s) * (1 - s) * a.y + 2 * (1 - s) * s * c.y + s * s * b.y));
  }
  return out;
}

/** The cone's slope from `p` toward `q`, `t` along it (at most 45 % of the way). */
const along = (p: THREE.Vector2, q: THREE.Vector2, t: number) => p.clone().add(q.clone().sub(p).setLength(Math.min(t, 0.45 * p.distanceTo(q))));

/**
 * The outline of the drawing's right half (x ≥ 0, y up), from the lower apex
 * round the rim to the upper apex, split at the base (y = 0): the lower cone's
 * part and the upper cone's (each ordered upward, so a lathe of it faces out).
 */
export function biconeProfile(s: BiconeSize, rimRound: number, apexRound: number, steps = 6): { lower: THREE.Vector2[]; upper: THREE.Vector2[]; rim: number } {
  const top = new THREE.Vector2(0, s.upper), rim = new THREE.Vector2(s.radius, 0), bottom = new THREE.Vector2(0, -s.lower);
  const mirror = new THREE.Vector2(-s.radius, 0);
  const pts = [
    ...bezier(along(bottom, mirror, apexRound), bottom, along(bottom, rim, apexRound), 0.5, 1, steps),
    ...bezier(along(rim, bottom, rimRound), rim, along(rim, top, rimRound), 0, 1, steps),
    ...bezier(along(top, rim, apexRound), top, along(top, mirror, apexRound), 0, 0.5, steps),
  ];
  // split where the outline crosses the base
  const k = pts.findIndex((p) => p.y >= 0);
  const a = pts[k - 1], b = pts[k];
  const cross = a.clone().lerp(b, b.y === a.y ? 0 : -a.y / (b.y - a.y));
  const lower = [...pts.slice(0, k), cross];
  const upper = [cross, ...pts.slice(k).filter((p) => p.y > 0)];
  return { lower, upper, rim: cross.x };
}

/** The two cones as lathes of the profile (lower, upper). */
export function biconeGeometries(s: BiconeSize, rimRound: number, apexRound: number, segments = 64): { lower: THREE.BufferGeometry; upper: THREE.BufferGeometry; rim: number } {
  const p = biconeProfile(s, rimRound, apexRound);
  return { lower: new THREE.LatheGeometry(p.lower, segments), upper: new THREE.LatheGeometry(p.upper, segments), rim: p.rim };
}

/** The base's rim: a circle of radius `r` in the X–Z plane (`count` points, the first repeated at the end), within angles a0…a1. */
export function rimPoints(r: number, a0 = 0, a1 = 2 * Math.PI, count = 72): THREE.Vector3[] {
  return Array.from({ length: count + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / count;
    return new THREE.Vector3(r * Math.cos(a), 0, r * Math.sin(a));
  });
}

/** The points a bicone's outline on the page comes from: it is the hull of its rim and apexes. */
export function biconeOutline(s: BiconeSize, rim: number): THREE.Vector3[] {
  return [...rimPoints(rim, 0, 2 * Math.PI, 48), new THREE.Vector3(0, s.upper, 0), new THREE.Vector3(0, -s.lower, 0)];
}

/** A perspective camera's axes (`dir` from the scene toward it) and field of view. */
export interface OutlineView {
  right: THREE.Vector3;
  up: THREE.Vector3;
  dir: THREE.Vector3;
  /** Tangent of half the vertical field of view. */
  tanV: number;
  aspect: number;
}

/**
 * Where the camera stands to frame `points`: `x` and `y` along its right and up,
 * `distance` along its `dir`. As projected they are centred and take `width` of the
 * canvas's width or `height` of its height, whichever comes first; a `minDistance`
 * keeps the camera that far off, and then they are only centred.
 */
export function fitOutline(points: readonly THREE.Vector3[], view: OutlineView, width: number, height: number, minDistance = 0): { x: number; y: number; distance: number } {
  const tanH = view.tanV * view.aspect;
  const reach = Math.max(...points.map((p) => p.length()));
  let x = 0, y = 0;
  // from where all of it is in front of the camera; the near side looks larger, so it takes a few passes
  let distance = Math.max(minDistance, reach / Math.min(width * tanH, height * view.tanV));
  for (let pass = 0; pass < 8; pass++) {
    let left = Infinity, right = -Infinity, top = -Infinity, bottom = Infinity;
    for (const p of points) {
      const depth = distance - p.dot(view.dir);
      const sx = (p.dot(view.right) - x) / (depth * tanH), sy = (p.dot(view.up) - y) / (depth * view.tanV);
      left = Math.min(left, sx);
      right = Math.max(right, sx);
      top = Math.max(top, sy);
      bottom = Math.min(bottom, sy);
    }
    x += ((left + right) / 2) * distance * tanH;
    y += ((top + bottom) / 2) * distance * view.tanV;
    distance = Math.max(minDistance, distance * Math.max((right - left) / (2 * width), (top - bottom) / (2 * height)));
  }
  return { x, y, distance };
}

/** On a cone of the drawing: the point over (x, z) of the base and the cone's outward normal there. */
export function onCone(s: BiconeSize, cone: BiconeCone, x: number, z: number): { point: THREE.Vector3; normal: THREE.Vector3 } {
  const h = cone === 'upper' ? s.upper : s.lower;
  const sign = cone === 'upper' ? 1 : -1;
  const r = Math.min(Math.hypot(x, z), s.radius);
  const k = h / s.radius;
  const normal = r > 1e-9 ? new THREE.Vector3((k * x) / Math.hypot(x, z), sign, (k * z) / Math.hypot(x, z)).normalize() : new THREE.Vector3(0, sign, 0);
  return { point: new THREE.Vector3(x, sign * h * (1 - r / s.radius), z), normal };
}

/** One scar's arrow on the bicone: its cone, whether it counts, and its ends over the base (x, z of the drawing). */
export interface BiconeArrow {
  id: string;
  cone: BiconeCone;
  counted: boolean;
  start: THREE.Vector2;
  end: THREE.Vector2;
}

/** Shortest arrow drawn, as a share of the base's diameter. */
const ARROW_MIN = 0.08;

/**
 * Every scar with an arrow over the base: its ends projected onto the base, at
 * angle θ and ρ̂ of the way from the centre to the rim (biconePolar), laid on
 * the drawing's base of radius `s.radius`; one too short drawn at the shortest
 * length, kept on the base.
 */
export function biconeArrows(r: BiconeResult, curve: readonly Vec3[], scars: ReadonlyArray<{ id: string; vector?: { start: Vec3; end: Vec3 } | null }>, s: BiconeSize): BiconeArrow[] {
  const placed = new Map(r.scars.map((x) => [x.id, x]));
  const polar = biconePolar(r, curve);
  const at = (p: Vec3) => {
    const q = polar(p);
    return new THREE.Vector2(q.rho * s.radius * Math.cos(q.theta), q.rho * s.radius * Math.sin(q.theta));
  };
  const out: BiconeArrow[] = [];
  for (const sc of scars) {
    const p = placed.get(sc.id);
    if (!p || !sc.vector) continue;
    const start = at(sc.vector.start), end = at(sc.vector.end);
    const shortest = ARROW_MIN * 2 * s.radius;
    if (start.distanceTo(end) < shortest) {
      const dir = end.clone().sub(start);
      // inward along the radius when the ends coincide
      if (dir.lengthSq() < 1e-12) dir.copy(start).negate();
      if (dir.lengthSq() < 1e-12) dir.set(1, 0);
      dir.setLength(shortest / 2);
      const mid = start.clone().add(end).multiplyScalar(0.5);
      start.copy(mid).sub(dir);
      end.copy(mid).add(dir);
      for (const q of [start, end]) if (q.length() > s.radius) q.setLength(s.radius);
    }
    out.push({ id: sc.id, cone: p.cone, counted: p.surface !== null, start, end });
  }
  return out;
}

/**
 * An arrow's path on its cone: the straight line between its ends over the
 * base, evenly sampled, each point raised onto the cone and `hover` off it
 * along the cone's normal (so it bends with the cone instead of cutting into
 * it); with the normals and the points on the surface itself.
 */
export function arrowPath(s: BiconeSize, a: BiconeArrow, hover: number, samples = 24): { points: THREE.Vector3[]; surface: THREE.Vector3[]; normals: THREE.Vector3[] } {
  const points: THREE.Vector3[] = [], surface: THREE.Vector3[] = [], normals: THREE.Vector3[] = [];
  for (let i = 0; i <= samples; i++) {
    const q = a.start.clone().lerp(a.end, i / samples);
    const c = onCone(s, a.cone, q.x, q.y);
    surface.push(c.point);
    normals.push(c.normal);
    points.push(c.point.clone().addScaledVector(c.normal, hover));
  }
  return { points, surface, normals };
}

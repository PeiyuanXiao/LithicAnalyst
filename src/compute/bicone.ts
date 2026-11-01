import { BICONE_CONES, type BiconeCone, type BiconeRole, type BiconeSide } from '../core/fields';
import { frameAxes } from '../core/frame';
import { hasVector, type ProjectState, type Scar, type Vec3 } from '../core/types';
import { computeConfiguration, type ConfigBox, type ConfigurationResult } from './configuration';
import { vertexPca } from './meshGeometry';
import type { VolumeSplit } from './split';

/**
 * The bicone model of the volumetric configuration, for cores made of two
 * surfaces round one plane of intersection (Levallois, discoid, prepared and
 * centripetal cores): two cones on the closed curve that splits the volume,
 * sharing a round base of the area the curve encloses, each as high as a cone
 * on that base with the volume of its side. A conceptual aid only: it gives the
 * facial character and the flaking surfaces, nothing about polarity (taken as
 * centripetal) or platforms, and does not tell discoid from Levallois.
 */

/** A cone is drawn at least this high, as a share of the base radius (a drawing; the result keeps the true heights). */
export const BICONE_MIN_HEIGHT = 0.1;

export interface BiconeConeResult {
  cone: BiconeCone;
  /** Its physical side: `positive` is the side of the split curve's plane normal oriented by `split.upHint`. */
  side: BiconeSide;
  autoRole: BiconeRole;
  role: BiconeRole;
  /** Scars with an arrow on this cone. */
  scars: number;
}

export interface BiconeResult {
  model: 'bicone';
  frame: 'specimen' | 'principal';
  /** The plane fitted to the split curve's points (through their mean); its normal points to the upper cone. */
  plane: { point: Vec3; normal: Vec3 };
  /** The base's centre O: the area centroid of the curve projected onto the plane. */
  centre: Vec3;
  /** The area A the projected curve encloses, and the radius of a circle of that area, R = √(A / π). */
  area: number;
  radius: number;
  /** Heights of cones on that base with the upper and the lower volume, 3V / A (true values). */
  upperHeight: number;
  lowerHeight: number;
  /** "Up" in the plane (unit): the specimen frame's Y projected onto it, without a frame the curve's first principal axis. */
  reference: Vec3;
  /** Each scar with an arrow: its cone (by the side of the plane its end is on) and its flaking surface (null when the cone is none). */
  scars: Array<{ id: string; cone: BiconeCone; surface: string | null }>;
  /** Upper, then lower. */
  cones: BiconeConeResult[];
  /** The cones with the flaking role, upper first: F1, F2. */
  surfaces: Array<{ id: string; cone: BiconeCone; scarIds: string[] }>;
  /** Null without a flaking cone. */
  facialCharacter: 'unifacial' | 'bifacial' | null;
}

/** The configuration by either model. */
export type CoreConfiguration = ConfigurationResult | BiconeResult;

export const isBicone = (r: CoreConfiguration | null | undefined): r is BiconeResult => r?.model === 'bicone';

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
/** `v` without its component along the unit `n`. */
const inPlane = (v: Vec3, n: Vec3): Vec3 => {
  const k = dot(v, n);
  return [v[0] - k * n[0], v[1] - k * n[1], v[2] - k * n[2]];
};

/**
 * The plane's own coordinates: x along reference × normal, y along −reference
 * (seen from the upper side with the reference up, x runs to the right). The
 * bicone sketch lays its base out the same way (x, and z toward the viewer).
 */
function planeAxes(normal: Vec3, reference: Vec3): [Vec3, Vec3] {
  return [cross(reference, normal), neg(reference)];
}

/** The base of the bicone from the split curve's points; null when they enclose no area. */
export function biconeBase(points: readonly Vec3[], upHint: Vec3, swap: boolean, frameY: Vec3 | null): Pick<BiconeResult, 'plane' | 'centre' | 'area' | 'radius' | 'reference'> | null {
  if (points.length < 3) return null;
  const pca = vertexPca(points.flat());
  // the split's orientation: toward `upHint`, the other way when swapped
  let normal = unit(pca.axes[2]);
  if (dot(normal, upHint) < 0) normal = neg(normal);
  if (swap) normal = neg(normal);
  let reference = frameY ? inPlane(frameY, normal) : null;
  if (!reference || Math.hypot(...reference) < 0.1) reference = inPlane(pca.axes[0], normal);
  reference = unit(reference);
  const [ex, ey] = planeAxes(normal, reference);
  const c = pca.mean;
  const q = points.map((p) => [dot(sub(p, c), ex), dot(sub(p, c), ey)]);
  // shoelace: twice the signed area, and the area centroid
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0; i < q.length; i++) {
    const [x0, y0] = q[i], [x1, y1] = q[(i + 1) % q.length];
    const k = x0 * y1 - x1 * y0;
    a2 += k;
    cx += (x0 + x1) * k;
    cy += (y0 + y1) * k;
  }
  if (!(Math.abs(a2) > 1e-12)) return null;
  cx /= 3 * a2;
  cy /= 3 * a2;
  const area = Math.abs(a2) / 2;
  const centre: Vec3 = [0, 1, 2].map((k) => c[k] + cx * ex[k] + cy * ey[k]) as Vec3;
  return { plane: { point: [...c] as Vec3, normal }, centre, area, radius: Math.sqrt(area / Math.PI), reference };
}

/**
 * The bicone from the scars with an arrow, the split curve and the volumes of
 * the split (upper and lower as `split.swap` has them); null without arrows,
 * without a split by a closed curve, or without its volumes (an open mesh, a
 * curve that does not split it).
 */
export function computeBicone(state: Readonly<ProjectState>, volumes: VolumeSplit | null): BiconeResult | null {
  const arrows = state.scars.filter(hasVector);
  const sp = state.split;
  const curve = sp?.source === 'curve' ? state.curves.find((c) => c.id === sp.id) : undefined;
  if (!arrows.length || !sp || !volumes || !curve?.closed) return null;
  const frame = state.specimen.frame;
  const base = biconeBase(curve.points, sp.upHint, sp.swap, frame ? frameAxes(frame.matrix).y : null);
  if (!base) return null;
  // the end of a scar is on its cone; its start is on the rim
  const scars = arrows.map((s) => ({ id: s.id, cone: (dot(sub(s.vector.end, base.centre), base.plane.normal) >= 0 ? 'upper' : 'lower') as BiconeCone }));
  const sideOf = (cone: BiconeCone): BiconeSide => ((cone === 'upper') !== sp.swap ? 'positive' : 'negative');
  const roles = state.configuration.bicone.roles;
  const cones = BICONE_CONES.map((cone): BiconeConeResult => {
    const n = scars.filter((s) => s.cone === cone).length;
    const side = sideOf(cone);
    const autoRole: BiconeRole = n > 0 ? 'flaking' : 'none';
    return { cone, side, autoRole, role: roles[side] ?? autoRole, scars: n };
  });
  const surfaces = cones.filter((c) => c.role === 'flaking').map((c, i) => ({ id: `F${i + 1}`, cone: c.cone, scarIds: scars.filter((s) => s.cone === c.cone).map((s) => s.id) }));
  const surfaceOf = new Map(surfaces.map((s) => [s.cone, s.id]));
  return {
    model: 'bicone',
    frame: frame ? 'specimen' : 'principal',
    ...base,
    upperHeight: (3 * volumes.upper) / base.area,
    lowerHeight: (3 * volumes.lower) / base.area,
    scars: scars.map((s) => ({ ...s, surface: surfaceOf.get(s.cone) ?? null })),
    cones,
    surfaces,
    facialCharacter: surfaces.length === 1 ? 'unifacial' : surfaces.length === 2 ? 'bifacial' : null,
  };
}

/**
 * Where points lie over the bicone's base, for drawing them on its cones: the
 * angle θ about O in the plane's coordinates (x, y as in `planeAxes`) and ρ̂, the
 * distance from O over the distance from O to the projected curve along θ, at
 * most 1 (a point on the curve is on the rim, the centre at the apex).
 */
export function biconePolar(r: Pick<BiconeResult, 'centre' | 'plane' | 'reference' | 'radius'>, curve: readonly Vec3[]): (p: Vec3) => { rho: number; theta: number } {
  const [ex, ey] = planeAxes(r.plane.normal, r.reference);
  const flat = (p: Vec3): [number, number] => {
    const d = sub(p, r.centre);
    return [dot(d, ex), dot(d, ey)];
  };
  const ring = curve.map(flat);
  /** From O along θ to the outermost crossing of the projected curve. */
  const reach = (cx: number, cy: number): number => {
    let best = 0;
    for (let i = 0; i < ring.length; i++) {
      const [px, py] = ring[i], [qx, qy] = ring[(i + 1) % ring.length];
      const ex2 = qx - px, ey2 = qy - py;
      const den = cx * ey2 - cy * ex2;
      if (Math.abs(den) < 1e-12) continue;
      const t = (px * ey2 - py * ex2) / den;
      const s = (px * cy - py * cx) / den;
      if (t > 0 && s >= -1e-9 && s <= 1 + 1e-9) best = Math.max(best, t);
    }
    return best > 0 ? best : r.radius;
  };
  return (p) => {
    const [x, y] = flat(p);
    const d = Math.hypot(x, y);
    if (d < 1e-12) return { rho: 0, theta: 0 };
    return { rho: Math.min(1, d / reach(x / d, y / d)), theta: Math.atan2(y, x) };
  };
}

/** The configuration by the model the project uses: the box (from the model's box) or the bicone (from the volume split). */
export function coreConfiguration(state: Readonly<ProjectState>, box: ConfigBox | null, volumes: VolumeSplit | null): CoreConfiguration | null {
  return state.configuration.model === 'bicone' ? computeBicone(state, volumes) : computeConfiguration(state.scars, state.configuration, box);
}

const isCoreEdge = (c: { attributes: Record<string, unknown> }) => c.attributes.type === 'core_edge';

/** The closed curves a bicone can stand on: core edges first. */
export function edgeCurves<T extends { closed: boolean; attributes: Record<string, unknown> }>(curves: readonly T[]): T[] {
  const loops = curves.filter((c) => c.closed);
  return [...loops.filter(isCoreEdge), ...loops.filter((c) => !isCoreEdge(c))];
}

/** The curve that goes without saying: the only closed curve, or the only closed core edge; else null. */
export function soleEdgeCurve<T extends { closed: boolean; attributes: Record<string, unknown> }>(curves: readonly T[]): T | null {
  const loops = curves.filter((c) => c.closed);
  if (loops.length === 1) return loops[0];
  const edges = loops.filter(isCoreEdge);
  return edges.length === 1 ? edges[0] : null;
}

/**
 * Which way "up" a new split along this curve points: to the side of its plane
 * with more scars (by their ends, as the cones take them); when even, `view`
 * (the direction toward the viewer).
 */
export function defaultUpHint(points: readonly Vec3[], scars: readonly Scar[], view: Vec3): Vec3 {
  const base = biconeBase(points, view, false, null);
  if (!base) return view;
  let toward = 0, away = 0;
  for (const s of scars.filter(hasVector)) {
    if (dot(sub(s.vector.end, base.centre), base.plane.normal) >= 0) toward++;
    else away++;
  }
  return toward === away ? view : toward > away ? base.plane.normal : neg(base.plane.normal);
}

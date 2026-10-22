import * as THREE from 'three';
import type { Polyline } from '../compute/meshGeometry';
import type { PlaneResult } from '../compute/planes';
import type { Plane, Vec3 } from '../core/types';
import { CurveVisual } from './curveLayer';
import type { Viewer } from './viewer';

/** One colour per plane, by its number (P1, P2, …); no yellow (it means selected). */
export const PLANE_COLORS = ['#ff8a3d', '#2ec4b6', '#3a86ff', '#9b8cff', '#ff6fa8', '#7bd389'];

/** Where a plane cuts the model: thinner than curves, with a thinner dark outline. */
const SECTION_WIDTH = 1.6;
const SECTION_WIDTH_SELECTED = 2.4;
const SECTION_HALO = 1.2;

export function planeColor(label: string): string {
  const n = Number(/(\d+)$/.exec(label)?.[1] ?? 1);
  return PLANE_COLORS[(Math.max(1, n) - 1) % PLANE_COLORS.length];
}

const Z = new THREE.Vector3(0, 0, 1);
/** The disc is barely there unless its plane is selected. */
const DISC_OPACITY = 0.032;
const DISC_OPACITY_SELECTED = 0.26;

/** A plane on screen: translucent disc, the section of the model, and the normal as an arrow. */
class PlaneVisual {
  readonly root = new THREE.Group();
  private readonly disc: THREE.Mesh;
  private readonly arrow: THREE.ArrowHelper;
  private sections: CurveVisual[] = [];
  private sectionKey: Polyline[] | null = null;

  constructor() {
    this.disc = new THREE.Mesh(
      new THREE.CircleGeometry(1, 96),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: DISC_OPACITY, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.disc.renderOrder = 5;
    this.arrow = new THREE.ArrowHelper(Z, new THREE.Vector3(), 1);
    this.root.add(this.disc, this.arrow);
  }

  update(r: PlaneResult, color: string, radius: number, arrowLength: number, selected: boolean, origin: Vec3): void {
    const c = new THREE.Vector3(r.center![0] - origin[0], r.center![1] - origin[1], r.center![2] - origin[2]);
    const n = new THREE.Vector3(...r.normal!);
    this.disc.position.copy(c);
    this.disc.quaternion.setFromUnitVectors(Z, n);
    this.disc.scale.setScalar(radius);
    const mat = this.disc.material as THREE.MeshBasicMaterial;
    mat.color.set(color);
    mat.opacity = selected ? DISC_OPACITY_SELECTED : DISC_OPACITY;
    this.arrow.position.copy(c);
    this.arrow.setDirection(n);
    this.arrow.setLength(arrowLength, arrowLength * 0.18, arrowLength * 0.09);
    this.arrow.setColor(color);
    for (const s of this.sections) s.style(color, selected ? SECTION_WIDTH_SELECTED : SECTION_WIDTH, false, 1, SECTION_HALO);
  }

  setSections(lines: Polyline[] | null, color: string, selected: boolean, origin: Vec3): void {
    if (lines === this.sectionKey) return;
    this.sectionKey = lines;
    for (const s of this.sections) {
      s.dispose();
      this.root.remove(s.root);
    }
    this.sections = (lines ?? []).map((l) => {
      const v = new CurveVisual(false);
      v.setPoints(l.points, l.closed, origin);
      v.style(color, selected ? SECTION_WIDTH_SELECTED : SECTION_WIDTH, false, 1, SECTION_HALO);
      this.root.add(v.root);
      return v;
    });
  }

  dispose(): void {
    this.disc.geometry.dispose();
    (this.disc.material as THREE.Material).dispose();
    this.arrow.dispose();
    for (const s of this.sections) s.dispose();
  }
}

/** Draws fitted planes (measure and present modes). */
export class PlaneLayer {
  readonly group = new THREE.Group();
  private visuals = new Map<string, PlaneVisual>();
  private origin: Vec3 = [0, 0, 0];

  constructor(private readonly viewer: Viewer) {
    this.group.name = 'planes';
    viewer.overlay.add(this.group);
  }

  setOrigin(origin: Vec3): void {
    this.origin = [origin[0], origin[1], origin[2]];
    this.group.position.set(origin[0], origin[1], origin[2]);
    this.group.updateMatrixWorld(true);
  }

  /**
   * `bbox`: the model's bounding box (original coordinates), so each disc covers
   * the model's projection; `sections`: the section of the model by each plane (when computed).
   */
  sync(
    planes: readonly Plane[],
    results: PlaneResult[],
    selected: string | null,
    shown: boolean,
    bbox: { min: Vec3; max: Vec3 } | null,
    sections: (id: string) => Polyline[] | null,
  ): void {
    this.group.visible = shown;
    const seen = new Set<string>();
    for (const r of results) {
      const plane = planes.find((p) => p.id === r.id);
      if (!plane || !plane.visible || !r.valid || !bbox) continue;
      seen.add(r.id);
      let v = this.visuals.get(r.id);
      if (!v) {
        v = new PlaneVisual();
        this.visuals.set(r.id, v);
        this.group.add(v.root);
      }
      const isSel = r.id === selected;
      const color = planeColor(r.label);
      v.update(r, color, discRadius(r, bbox), this.viewer.diagonal * 0.18, isSel, this.origin);
      v.setSections(sections(r.id), color, isSel, this.origin);
    }
    for (const [id, v] of this.visuals) {
      if (!seen.has(id)) {
        v.dispose();
        this.group.remove(v.root);
        this.visuals.delete(id);
      }
    }
    this.viewer.requestRender();
  }

  clearAll(): void {
    for (const v of this.visuals.values()) {
      v.dispose();
      this.group.remove(v.root);
    }
    this.visuals.clear();
  }
}

/** Radius around the plane's centre that covers the projection of the bounding box onto the plane. */
function discRadius(r: PlaneResult, bbox: { min: Vec3; max: Vec3 }): number {
  const c = r.center!, n = r.normal!;
  let best = 0;
  for (let i = 0; i < 8; i++) {
    const p = [i & 1 ? bbox.max[0] : bbox.min[0], i & 2 ? bbox.max[1] : bbox.min[1], i & 4 ? bbox.max[2] : bbox.min[2]];
    const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    const h = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
    best = Math.max(best, Math.hypot(d[0] - h * n[0], d[1] - h * n[1], d[2] - h * n[2]));
  }
  return best * 1.05;
}

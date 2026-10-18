import * as THREE from 'three';
import { nestLoops } from '../compute/contour';
import type { Polyline } from '../compute/meshGeometry';
import type { Section, Vec3 } from '../core/types';
import { CurveVisual, WIDTH, WIDTH_SELECTED } from './curveLayer';
import type { Viewer } from './viewer';

export const SECTION_COLORS = { line: '#1d2421', selected: '#ffc61a', fill: '#8d9690' };

/** 2D coordinates in the section plane: x along the drawn line, y = normal × x. */
export function sectionBasis(s: Section): { x: Vec3; y: Vec3 } {
  const x = s.across;
  const n = s.normal;
  return { x, y: [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]] };
}

/** Closed loops of a section in plane coordinates (open pieces are left out). */
export function sectionLoops2D(s: Section, lines: Polyline[]): Array<Array<[number, number]>> {
  const { x, y } = sectionBasis(s);
  const p0 = s.point;
  return lines
    .filter((l) => l.closed && l.points.length >= 3)
    .map((l) =>
      l.points.map((p) => {
        const d = [p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]];
        return [d[0] * x[0] + d[1] * x[1] + d[2] * x[2], d[0] * y[0] + d[1] * y[1] + d[2] * y[2]] as [number, number];
      }),
    );
}

let hatchTexture: THREE.CanvasTexture | null = null;
function hatch(): THREE.CanvasTexture {
  if (hatchTexture) return hatchTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8ebe7';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#3a423e';
  g.lineWidth = 5;
  for (const o of [-64, 0, 64]) {
    g.beginPath();
    g.moveTo(o, 64);
    g.lineTo(o + 64, 0);
    g.stroke();
  }
  hatchTexture = new THREE.CanvasTexture(c);
  hatchTexture.wrapS = hatchTexture.wrapT = THREE.RepeatWrapping;
  hatchTexture.colorSpace = THREE.SRGBColorSpace;
  return hatchTexture;
}

/** One section on screen: its outline, and (when the model is cut open) the cut face. */
class SectionVisual {
  readonly root = new THREE.Group();
  private outlines: CurveVisual[] = [];
  private cap: THREE.Mesh | null = null;
  private key: unknown = null;

  update(s: Section, lines: Polyline[] | null, selected: boolean, origin: Vec3, hatchSize: number, clip: THREE.Plane[]): void {
    const key = [lines, s.fill, s.keep, hatchSize];
    if (JSON.stringify(key.slice(1)) !== JSON.stringify((this.key as unknown[] | null)?.slice(1)) || (this.key as unknown[] | null)?.[0] !== lines) {
      this.key = key;
      this.rebuild(s, lines ?? [], origin, hatchSize);
    }
    const color = selected ? SECTION_COLORS.selected : SECTION_COLORS.line;
    for (const o of this.outlines) o.style(color, selected ? WIDTH_SELECTED : WIDTH, false);
    if (this.cap) (this.cap.material as THREE.MeshBasicMaterial).clippingPlanes = clip;
  }

  private rebuild(s: Section, lines: Polyline[], origin: Vec3, hatchSize: number): void {
    this.dispose();
    this.outlines = lines.map((l) => {
      const v = new CurveVisual(false);
      v.setPoints(l.points, l.closed, origin);
      this.root.add(v.root);
      return v;
    });
    if (s.keep === 'both') return;
    // the cut face: the closed loops, triangulated in the plane
    const { x, y } = sectionBasis(s);
    const pos: number[] = [];
    const uv: number[] = [];
    for (const shape of nestLoops(sectionLoops2D(s, lines))) {
      const contour = shape.outer.map(([u, v]) => new THREE.Vector2(u, v));
      const holes = shape.holes.map((h) => h.map(([u, v]) => new THREE.Vector2(u, v)));
      const all = [contour, ...holes].flat();
      for (const tri of THREE.ShapeUtils.triangulateShape(contour, holes))
        for (const k of tri) {
          const p = all[k];
          pos.push(
            s.point[0] - origin[0] + p.x * x[0] + p.y * y[0],
            s.point[1] - origin[1] + p.x * x[1] + p.y * y[1],
            s.point[2] - origin[2] + p.x * x[2] + p.y * y[2],
          );
          uv.push(p.x / hatchSize, p.y / hatchSize);
        }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const m = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    if (s.fill === 'hatch') m.map = hatch();
    else m.color.set(SECTION_COLORS.fill);
    this.cap = new THREE.Mesh(g, m);
    this.cap.renderOrder = 4;
    this.root.add(this.cap);
  }

  dispose(): void {
    for (const o of this.outlines) {
      o.dispose();
      this.root.remove(o.root);
    }
    this.outlines = [];
    if (this.cap) {
      this.cap.geometry.dispose();
      (this.cap.material as THREE.Material).dispose();
      this.root.remove(this.cap);
      this.cap = null;
    }
  }
}

/** Draws sections in the present mode and cuts the model open where asked. */
export class SectionLayer {
  readonly group = new THREE.Group();
  private visuals = new Map<string, SectionVisual>();
  private origin: Vec3 = [0, 0, 0];

  constructor(private readonly viewer: Viewer) {
    this.group.name = 'sections';
    viewer.overlay.add(this.group);
    viewer.renderer.localClippingEnabled = true;
  }

  setOrigin(origin: Vec3): void {
    this.origin = [origin[0], origin[1], origin[2]];
    this.group.position.set(origin[0], origin[1], origin[2]);
    this.group.updateMatrixWorld(true);
  }

  /** Clipping planes (world coordinates) that keep the chosen side of each cutting section. */
  static clipPlanes(sections: readonly Section[]): Array<{ id: string; plane: THREE.Plane }> {
    return sections
      .filter((s) => s.keep !== 'both')
      .map((s) => {
        // three.js keeps the side where normal · p + constant ≥ 0
        const n = new THREE.Vector3(...s.normal).multiplyScalar(s.keep === 'front' ? 1 : -1);
        return { id: s.id, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(...s.point)) };
      });
  }

  sync(sections: readonly Section[], lines: (id: string) => Polyline[] | null, selected: string | null, shown: boolean): void {
    this.group.visible = shown;
    const clips = SectionLayer.clipPlanes(sections);
    const seen = new Set<string>();
    for (const s of sections) {
      seen.add(s.id);
      let v = this.visuals.get(s.id);
      if (!v) {
        v = new SectionVisual();
        this.visuals.set(s.id, v);
        this.group.add(v.root);
      }
      const others = clips.filter((c) => c.id !== s.id).map((c) => c.plane);
      v.update(s, lines(s.id), s.id === selected, this.origin, this.viewer.diagonal * 0.012, others);
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

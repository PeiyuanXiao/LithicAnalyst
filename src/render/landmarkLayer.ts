import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { SemilandmarkResult } from '../compute/landmarks';
import type { Landmark, Vec3 } from '../core/types';
import type { Viewer } from './viewer';

export const LANDMARK_COLORS = { fixed: '#00a6a6', semi: '#8c5cf0', selected: '#ffc61a', draft: '#ffc61a' };

const BALL = new THREE.SphereGeometry(1, 16, 12);
const materials = new Map<string, THREE.Material>();

function material(color: string, kind: 'solid' | 'ghost' | 'dim'): THREE.Material {
  const key = `${color}:${kind}`;
  let m = materials.get(key);
  if (!m) {
    m =
      kind === 'ghost'
        ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthTest: false, depthWrite: false })
        : kind === 'dim'
          ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false })
          : new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0, emissive: new THREE.Color(color), emissiveIntensity: 0.3 });
    materials.set(key, m);
  }
  return m;
}

/** A ball with a faint copy that shows through the surface. */
class Dot {
  readonly root = new THREE.Group();
  private readonly solid = new THREE.Mesh(BALL);
  private readonly ghost = new THREE.Mesh(BALL);

  constructor() {
    this.ghost.renderOrder = 900;
    this.root.add(this.solid, this.ghost);
  }

  set(p: Vec3, radius: number, color: string, ghost: boolean, dim = false): void {
    this.root.position.set(p[0], p[1], p[2]);
    this.root.scale.setScalar(radius);
    this.solid.material = material(color, dim ? 'dim' : 'solid');
    this.ghost.material = material(color, 'ghost');
    this.ghost.visible = ghost && !dim;
  }
}

interface LandmarkVisual {
  dot: Dot;
  label: CSS2DObject;
  point: Vec3;
}

/** Draws the fixed landmarks (with their names) and the curve semilandmarks. */
export class LandmarkLayer {
  readonly group = new THREE.Group();
  private fixed = new Map<string, LandmarkVisual>();
  private semi: Dot[] = [];
  private readonly preview = new Dot();
  onLabelClick: (id: string) => void = () => {};
  /** Draw every point in this colour (another observer's annotations). */
  fixedColor: string | null = null;
  /** Draw the points faded (they are not what the current work mode is about). */
  dimmed = false;

  constructor(private readonly viewer: Viewer) {
    this.group.name = 'landmarks';
    this.preview.root.visible = false;
    this.group.add(this.preview.root);
    viewer.overlay.add(this.group);
  }

  get radius(): number {
    return this.viewer.diagonal * 0.007;
  }

  /** `selected`: a landmark id, or a set id (its points are highlighted). */
  sync(landmarks: readonly Landmark[], sets: readonly SemilandmarkResult[], selected: string | null, labels: boolean, ghost: boolean): void {
    const r = this.radius;
    const seen = new Set<string>();
    landmarks.forEach((l) => {
      seen.add(l.id);
      let v = this.fixed.get(l.id);
      if (!v) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'arrow-label landmark-label';
        const id = l.id;
        el.addEventListener('pointerdown', (e) => e.stopPropagation());
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onLabelClick(id);
        });
        const label = new CSS2DObject(el);
        label.center.set(-0.25, 1.2);
        v = { dot: new Dot(), label, point: l.point };
        v.dot.root.add(label);
        this.group.add(v.dot.root);
        this.fixed.set(l.id, v);
      }
      const isSel = l.id === selected;
      const color = isSel ? LANDMARK_COLORS.selected : this.fixedColor ?? LANDMARK_COLORS.fixed;
      v.point = l.point;
      v.dot.set(l.point, isSel ? r * 1.25 : r, color, ghost, this.dimmed && !isSel);
      v.label.visible = labels;
      const el = v.label.element;
      if (el.textContent !== l.name) el.textContent = l.name;
      el.classList.toggle('is-selected', isSel);
      el.style.setProperty('--chip', color);
    });
    for (const [id, v] of this.fixed) {
      if (seen.has(id)) continue;
      v.label.element.remove();
      this.group.remove(v.dot.root);
      this.fixed.delete(id);
    }
    const pts = sets.flatMap((q) => q.points.map((p) => ({ p, sel: q.id === selected })));
    while (this.semi.length < pts.length) {
      const d = new Dot();
      this.semi.push(d);
      this.group.add(d.root);
    }
    this.semi.forEach((d, i) => {
      d.root.visible = i < pts.length;
      if (i < pts.length) d.set(pts[i].p, r * 0.75, pts[i].sel ? LANDMARK_COLORS.selected : this.fixedColor ?? LANDMARK_COLORS.semi, ghost, this.dimmed && !pts[i].sel);
    });
    this.viewer.requestRender();
  }

  /** Where a landmark being dragged would go (null hides it). */
  setPreview(p: Vec3 | null): void {
    this.preview.root.visible = !!p;
    if (p) this.preview.set(p, this.radius * 1.25, LANDMARK_COLORS.draft, true);
    this.viewer.requestRender();
  }

  /** The fixed landmark nearest the cursor, within `maxPx`. */
  pickNearest(clientX: number, clientY: number, maxPx = 10): { id: string; dist: number } | null {
    let best: { id: string; dist: number } | null = null;
    for (const [id, v] of this.fixed) {
      if (!v.dot.root.visible) continue;
      const q = new THREE.Vector3(...v.point);
      const s = this.viewer.project(q);
      const d = Math.hypot(s.x - clientX, s.y - clientY);
      if (!s.visible || d > (best?.dist ?? maxPx) || this.viewer.isOccluded(q, this.radius * 3)) continue;
      best = { id, dist: d };
    }
    return best;
  }

  updateOcclusion(): void {
    for (const v of this.fixed.values()) {
      if (!v.label.visible) continue;
      v.label.element.classList.toggle('is-occluded', this.viewer.isOccluded(new THREE.Vector3(...v.point), this.radius * 3));
    }
  }

  clearAll(): void {
    for (const v of this.fixed.values()) {
      v.label.element.remove();
      this.group.remove(v.dot.root);
    }
    this.fixed.clear();
    for (const d of this.semi) this.group.remove(d.root);
    this.semi = [];
    this.setPreview(null);
  }
}

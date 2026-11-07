import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { SemilandmarkResult } from '../compute/landmarks';
import type { Landmark, Vec3 } from '../core/types';
import { EASE_POP, VIEW_MOTION } from './easing';
import { dotDiameterPx, type DotKind } from './landmarkSize';
import type { Viewer } from './viewer';

/** A landmark being moved keeps the fixed landmarks' colour; yellow only marks the selected one. */
export const LANDMARK_COLORS = { fixed: '#00a6a6', semi: '#8c5cf0', selected: '#ffc61a', draft: '#00a6a6' };

/** How far from a landmark, in screen pixels, the cursor still counts as on it. */
export const LANDMARK_PICK_PX = 8;
const SELECTED_SCALE = 1.3;
const HOVER_SCALE = 1.12;
const PREVIEW_SCALE = 1.25;
/** A landmark counts as hidden when the surface in front of it is further off than this, in CSS pixels at its depth. */
const HIDDEN_BEYOND_PX = 13.5;

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

/**
 * A ball with a faint copy that shows through the surface; `fit` keeps its size within the limits on the screen, and
 * rests it on the surface it marks, one radius toward the camera along the line of sight, so that surface hides none of it and its place on the screen stays.
 */
class Dot {
  readonly root = new THREE.Group();
  private readonly solid = new THREE.Mesh(BALL);
  private readonly ghost = new THREE.Mesh(BALL);
  private readonly at = new THREE.Vector3();
  private kind: DotKind = 'fixed';
  private emphasis = 1;
  /** Its size as it pops in (1: as drawn). */
  grow = 1;

  constructor() {
    this.ghost.renderOrder = 900;
    this.root.add(this.solid, this.ghost);
  }

  /** `emphasis`: larger than its kind (selected, under the cursor, being placed). */
  set(viewer: Viewer, p: Vec3, kind: DotKind, emphasis: number, color: string, ghost: boolean, dim = false): void {
    this.at.set(p[0], p[1], p[2]);
    this.kind = kind;
    this.emphasis = emphasis;
    this.fit(viewer);
    this.solid.material = material(color, dim ? 'dim' : 'solid');
    this.ghost.material = material(color, 'ghost');
    this.ghost.visible = ghost && !dim;
  }

  fit(viewer: Viewer): void {
    const radiusAt = (q: THREE.Vector3) => {
      const perPx = viewer.worldPerPixel(q);
      return (perPx * dotDiameterPx(this.kind, viewer.diagonal, perPx) * this.emphasis) / 2;
    };
    const toward = viewer.camera.position.clone().sub(this.at).normalize();
    this.root.position.copy(this.at).addScaledVector(toward, radiusAt(this.at));
    // (three.js leaves a zero scale out of its matrices' inverse: a trace of size instead)
    this.root.scale.setScalar(radiusAt(this.root.position) * Math.max(1e-4, this.grow));
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
  /** The landmark under the select tool's cursor. */
  private hovered: string | null = null;
  private last: Parameters<LandmarkLayer['sync']> | null = null;
  private readonly stopFitting: () => void;

  constructor(private readonly viewer: Viewer) {
    this.group.name = 'landmarks';
    this.preview.root.visible = false;
    this.group.add(this.preview.root);
    viewer.overlay.add(this.group);
    this.stopFitting = viewer.onCameraChange(() => this.fitDots());
  }

  /** The layer is done with (another observer's, when the comparison ends). */
  dispose(): void {
    this.stopFitting();
  }

  /** Every dot at its size on the screen, wherever the camera went. */
  private fitDots(): void {
    for (const v of this.fixed.values()) v.dot.fit(this.viewer);
    for (const d of this.semi) if (d.root.visible) d.fit(this.viewer);
    if (this.preview.root.visible) this.preview.fit(this.viewer);
  }

  /** How far in front of a point the surface must be to hide it. */
  private hiddenBeyond(q: THREE.Vector3): number {
    return this.viewer.worldPerPixel(q) * HIDDEN_BEYOND_PX;
  }

  /** `selected`: a landmark id, a set id (its points are highlighted) or `<set id>#<point index>` (one point). */
  sync(landmarks: readonly Landmark[], sets: readonly SemilandmarkResult[], selected: string | null, labels: boolean, ghost: boolean): void {
    this.last = [landmarks, sets, selected, labels, ghost];
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
      const isHov = !isSel && l.id === this.hovered;
      const color = isSel ? LANDMARK_COLORS.selected : this.fixedColor ?? LANDMARK_COLORS.fixed;
      v.point = l.point;
      v.dot.set(this.viewer, l.point, 'fixed', isSel ? SELECTED_SCALE : isHov ? HOVER_SCALE : 1, color, ghost, this.dimmed && !isSel);
      v.label.visible = labels;
      const el = v.label.element;
      if (el.textContent !== l.name) el.textContent = l.name;
      el.classList.toggle('is-selected', isSel);
      el.classList.toggle('is-hover', isHov);
      el.style.setProperty('--chip', color);
    });
    for (const [id, v] of this.fixed) {
      if (seen.has(id)) continue;
      v.label.element.remove();
      this.group.remove(v.dot.root);
      this.fixed.delete(id);
    }
    const pts = sets.flatMap((q) => q.points.map((p, i) => ({ p, sel: q.id === selected || `${q.id}#${i}` === selected })));
    while (this.semi.length < pts.length) {
      const d = new Dot();
      this.semi.push(d);
      this.group.add(d.root);
    }
    this.semi.forEach((d, i) => {
      d.root.visible = i < pts.length;
      if (i < pts.length) d.set(this.viewer, pts[i].p, 'semi', 1, pts[i].sel ? LANDMARK_COLORS.selected : this.fixedColor ?? LANDMARK_COLORS.semi, ghost, this.dimmed && !pts[i].sel);
    });
    this.viewer.requestRender();
  }

  /** The landmark under the select tool's cursor (an id of another layer, or null: none). */
  setHoverItem(id: string | null): void {
    const own = id !== null && this.fixed.has(id) ? id : null;
    if (own === this.hovered) return;
    this.hovered = own;
    if (this.last) this.sync(...this.last);
  }

  /** Where a landmark being dragged would go (null hides it). */
  setPreview(p: Vec3 | null): void {
    this.preview.root.visible = !!p;
    if (p) this.preview.set(this.viewer, p, 'fixed', PREVIEW_SCALE, LANDMARK_COLORS.draft, true);
    this.viewer.requestRender();
  }

  /** The fixed landmark nearest the cursor, within `maxPx`. */
  pickNearest(clientX: number, clientY: number, maxPx = LANDMARK_PICK_PX): { id: string; dist: number } | null {
    if (!this.group.visible) return null;
    let best: { id: string; dist: number } | null = null;
    for (const [id, v] of this.fixed) {
      if (!v.dot.root.visible) continue;
      const q = new THREE.Vector3(...v.point);
      const s = this.viewer.project(q);
      const d = Math.hypot(s.x - clientX, s.y - clientY);
      if (!s.visible || d > (best?.dist ?? maxPx) || this.viewer.isOccluded(q, this.hiddenBeyond(q))) continue;
      best = { id, dist: d };
    }
    return best;
  }

  updateOcclusion(): void {
    for (const v of this.fixed.values()) {
      if (!v.label.visible) continue;
      const q = new THREE.Vector3(...v.point);
      v.label.element.classList.toggle('is-occluded', this.viewer.isOccluded(q, this.hiddenBeyond(q)));
    }
  }

  /** A landmark the user just placed grows from nothing to its size (not one loaded, undone or made by the app). */
  pop(id: string): void {
    const dot = this.fixed.get(id)?.dot;
    if (!dot) return;
    this.viewer.tween(VIEW_MOTION.LANDMARK_POP_MS, (k) => {
      dot.grow = k >= 1 ? 1 : EASE_POP(k);
      dot.fit(this.viewer);
    });
  }

  /** A landmark's diameter on the screen as drawn, in CSS pixels. */
  screenDiameter(id: string): number | null {
    const dot = this.fixed.get(id)?.dot.root;
    if (!dot) return null;
    const across = new THREE.Vector3().setFromMatrixColumn(this.viewer.camera.matrixWorld, 0).multiplyScalar(dot.scale.x);
    const a = this.viewer.project(dot.position.clone().add(across));
    const b = this.viewer.project(dot.position.clone().sub(across));
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  clearAll(): void {
    for (const v of this.fixed.values()) {
      v.label.element.remove();
      this.group.remove(v.dot.root);
    }
    this.fixed.clear();
    for (const d of this.semi) this.group.remove(d.root);
    this.semi = [];
    this.hovered = null;
    this.last = null;
    this.setPreview(null);
  }
}

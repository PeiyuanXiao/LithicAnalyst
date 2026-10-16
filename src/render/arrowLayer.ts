import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { fieldByKey } from '../core/fields';
import type { ProjectState, ScarVector, Vec3 } from '../core/types';
import type { Viewer } from './viewer';

export type ArrowColorMode = 'uniform' | 'completeness' | 'certainty' | 'direction';

export interface ArrowDisplay {
  /** Multiplier on the default shaft radius. */
  thickness: number;
  /** Display-only lift of the endpoints along the surface normal, as a fraction of the model diagonal. */
  lift: number;
  /** Draw arrows hidden behind the surface as faint ghosts. */
  showHidden: boolean;
  labels: boolean;
  colorMode: ArrowColorMode;
}

export const DEFAULT_ARROW_DISPLAY: ArrowDisplay = {
  thickness: 1,
  lift: 0.004,
  showHidden: true,
  labels: true,
  colorMode: 'uniform',
};

export const ARROW_COLORS = {
  uniform: '#e0287d',
  selected: '#ffc61a',
  draft: '#ffc61a',
  palette: ['#1f9e89', '#3a7fd5', '#7b5cd6', '#c8611f', '#d6336c', '#8a8f98'],
};

const UP = new THREE.Vector3(0, 1, 0);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 14, 1, false).translate(0, 0.5, 0);
const CONE = new THREE.ConeGeometry(1, 1, 20).translate(0, 0.5, 0);
const SPHERE = new THREE.SphereGeometry(1, 18, 12);
const RING = new THREE.RingGeometry(0.55, 1, 40);
const DOT = new THREE.CircleGeometry(0.18, 20);

const solidCache = new Map<string, THREE.MeshStandardMaterial>();
const ghostCache = new Map<string, THREE.MeshBasicMaterial>();

function solidMaterial(color: string): THREE.MeshStandardMaterial {
  let m = solidCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.42,
      metalness: 0,
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.28,
    });
    solidCache.set(color, m);
  }
  return m;
}

function ghostMaterial(color: string): THREE.MeshBasicMaterial {
  let m = ghostCache.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthTest: false, depthWrite: false });
    ghostCache.set(color, m);
  }
  return m;
}

/** One arrow: shaft + head + tail bead, a ghost copy, and a label. */
class ArrowVisual {
  readonly root = new THREE.Group();
  private readonly solid = new THREE.Group();
  private readonly ghost = new THREE.Group();
  private readonly parts: THREE.Mesh[];
  private readonly ghostParts: THREE.Mesh[];
  label: CSS2DObject | null = null;
  shownStart = new THREE.Vector3();
  shownEnd = new THREE.Vector3();
  radius = 1;

  constructor(withLabel: boolean, onLabelClick?: () => void) {
    this.parts = [new THREE.Mesh(CYL), new THREE.Mesh(CONE), new THREE.Mesh(SPHERE)];
    this.ghostParts = [new THREE.Mesh(CYL), new THREE.Mesh(CONE), new THREE.Mesh(SPHERE)];
    for (const g of this.ghostParts) g.renderOrder = 900;
    this.solid.add(...this.parts);
    this.ghost.add(...this.ghostParts);
    this.root.add(this.solid, this.ghost);
    if (withLabel) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'arrow-label';
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onLabelClick?.();
      });
      this.label = new CSS2DObject(el);
      this.label.center.set(1.15, 1.25);
    }
  }

  update(
    start: THREE.Vector3,
    end: THREE.Vector3,
    startNormal: THREE.Vector3,
    radius: number,
    color: string,
    ghostOn: boolean,
    labelText: string | null,
    selected: boolean,
  ): void {
    this.shownStart.copy(start);
    this.shownEnd.copy(end);
    this.radius = radius;
    const dir = end.clone().sub(start);
    const L = dir.length();
    this.root.visible = L > 0;
    if (L === 0) return;
    this.root.position.copy(start);
    this.root.quaternion.setFromUnitVectors(UP, dir.divideScalar(L));
    const headLen = Math.min(0.42 * L, 8.5 * radius);
    const headR = 2.6 * radius;
    const set = (meshes: THREE.Mesh[]) => {
      meshes[0].scale.set(radius, Math.max(L - headLen, 1e-6), radius);
      meshes[1].position.set(0, L - headLen, 0);
      meshes[1].scale.set(headR, headLen, headR);
      meshes[2].scale.setScalar(1.6 * radius);
    };
    set(this.parts);
    set(this.ghostParts);
    const sm = solidMaterial(color);
    const gm = ghostMaterial(color);
    for (const p of this.parts) p.material = sm;
    for (const p of this.ghostParts) p.material = gm;
    this.ghost.visible = ghostOn;
    if (this.label) {
      this.label.visible = labelText !== null;
      if (labelText !== null) {
        const el = this.label.element;
        if (el.textContent !== labelText) el.textContent = labelText;
        el.classList.toggle('is-selected', selected);
        el.style.setProperty('--chip', color);
        // anchor slightly above the tail, in world space (root is rotated, so place it on the scene)
        const anchor = start.clone().addScaledVector(startNormal, radius * 3);
        this.label.position.copy(anchor).sub(this.root.position).applyQuaternion(this.root.quaternion.clone().invert());
      }
    }
  }

  setLabelOccluded(occluded: boolean): void {
    this.label?.element.classList.toggle('is-occluded', occluded);
  }

  attachLabel(): void {
    if (this.label && this.label.parent !== this.root) this.root.add(this.label);
  }

  dispose(): void {
    if (this.label) {
      this.label.element.remove();
      this.root.remove(this.label);
    }
  }
}

export interface EndpointOverride {
  id: string;
  which: 'start' | 'end';
  point: Vec3;
  normal: Vec3;
}

const toV = (v: Vec3) => new THREE.Vector3(v[0], v[1], v[2]);

function hsl(h: number, s: number, l: number): string {
  return `#${new THREE.Color().setHSL(h, s, l, THREE.SRGBColorSpace).getHexString(THREE.SRGBColorSpace)}`;
}

export function arrowColor(a: ScarVector, mode: ArrowColorMode): string {
  if (mode === 'completeness' || mode === 'certainty') {
    const field = fieldByKey(mode);
    const i = field?.options?.findIndex((o) => o.value === a.attributes[mode]) ?? -1;
    return i >= 0 ? ARROW_COLORS.palette[i % ARROW_COLORS.palette.length] : ARROW_COLORS.palette[5];
  }
  if (mode === 'direction') {
    // hue from the azimuth in the file's XY plane, lightness from the Z component
    const d: Vec3 = [a.end[0] - a.start[0], a.end[1] - a.start[1], a.end[2] - a.start[2]];
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    const az = (Math.atan2(d[1], d[0]) / (2 * Math.PI) + 1) % 1;
    return hsl(az, 0.78, 0.5 + 0.18 * (d[2] / len));
  }
  return ARROW_COLORS.uniform;
}

/** Draws all scar vectors, the drawing preview, the hover marker and endpoint handles. */
export class ArrowLayer {
  readonly group = new THREE.Group();
  private visuals = new Map<string, ArrowVisual>();
  private preview = new ArrowVisual(false);
  private hover = new THREE.Group();
  private handles: [THREE.Mesh, THREE.Mesh];
  private handleMat = new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: 0.95 });
  private handleHotMat = new THREE.MeshBasicMaterial({ color: ARROW_COLORS.selected, depthTest: false, transparent: true, opacity: 1 });
  private override: EndpointOverride | null = null;
  private last: { state: Readonly<ProjectState>; selected: string | null; display: ArrowDisplay; handles: boolean } | null = null;
  onLabelClick: (id: string) => void = () => {};

  constructor(private readonly viewer: Viewer) {
    this.group.name = 'arrows';
    this.preview.root.visible = false;
    this.group.add(this.preview.root);

    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const dotMat = new THREE.MeshBasicMaterial({ color: ARROW_COLORS.selected, depthTest: false, transparent: true, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(RING, ringMat);
    const dot = new THREE.Mesh(DOT, dotMat);
    ring.renderOrder = dot.renderOrder = 950;
    this.hover.add(ring, dot);
    this.hover.visible = false;
    this.group.add(this.hover);

    this.handles = [new THREE.Mesh(SPHERE, this.handleMat), new THREE.Mesh(SPHERE, this.handleMat)];
    for (const h of this.handles) {
      h.renderOrder = 960;
      h.visible = false;
      this.group.add(h);
    }
    viewer.overlay.add(this.group);
  }

  get radius(): number {
    return this.viewer.diagonal * 0.0028 * (this.last?.display.thickness ?? 1);
  }

  private liftDistance(display: ArrowDisplay): number {
    return this.viewer.diagonal * display.lift;
  }

  /** Re-draw from project state. Cheap enough to call on every change. */
  sync(state: Readonly<ProjectState>, selected: string | null, display: ArrowDisplay, showHandles: boolean): void {
    this.last = { state, selected, display, handles: showHandles };
    const seen = new Set<string>();
    const radius = this.viewer.diagonal * 0.0028 * display.thickness;
    const lift = this.liftDistance(display);
    for (const a of state.scarVectors) {
      seen.add(a.id);
      let v = this.visuals.get(a.id);
      if (!v) {
        const id = a.id;
        v = new ArrowVisual(true, () => this.onLabelClick(id));
        v.attachLabel();
        this.visuals.set(a.id, v);
        this.group.add(v.root);
      }
      let start = a.start, end = a.end, sn = a.startNormal, en = a.endNormal;
      if (this.override && this.override.id === a.id) {
        if (this.override.which === 'start') {
          start = this.override.point;
          sn = this.override.normal;
        } else {
          end = this.override.point;
          en = this.override.normal;
        }
      }
      const s = toV(start).addScaledVector(toV(sn), lift);
      const e = toV(end).addScaledVector(toV(en), lift);
      const isSel = a.id === selected;
      const color = isSel ? ARROW_COLORS.selected : arrowColor(a, display.colorMode);
      v.update(s, e, toV(sn), isSel ? radius * 1.15 : radius, color, display.showHidden, display.labels ? a.label : null, isSel);
    }
    for (const [id, v] of this.visuals) {
      if (!seen.has(id)) {
        v.dispose();
        this.group.remove(v.root);
        this.visuals.delete(id);
      }
    }
    this.updateHandles();
    this.viewer.requestRender();
  }

  resync(): void {
    if (this.last) this.sync(this.last.state, this.last.selected, this.last.display, this.last.handles);
  }

  setEndpointOverride(o: EndpointOverride | null): void {
    this.override = o;
    this.resync();
  }

  private updateHandles(hot: 'start' | 'end' | null = null): void {
    const last = this.last;
    const v = last && last.selected && last.handles ? this.visuals.get(last.selected) : undefined;
    const r = (last ? this.viewer.diagonal * 0.0028 * last.display.thickness : 1) * 2.4;
    this.handles.forEach((h, i) => {
      h.visible = !!v;
      if (!v) return;
      h.position.copy(i === 0 ? v.shownStart : v.shownEnd);
      h.scale.setScalar(r);
      h.material = (hot === 'start' && i === 0) || (hot === 'end' && i === 1) ? this.handleHotMat : this.handleMat;
    });
  }

  highlightHandle(which: 'start' | 'end' | null): void {
    this.updateHandles(which);
    this.viewer.requestRender();
  }

  setPreview(start: Vec3, end: Vec3, startNormal: Vec3, endNormal: Vec3): void {
    const display = this.last?.display ?? DEFAULT_ARROW_DISPLAY;
    const lift = this.liftDistance(display);
    const s = toV(start).addScaledVector(toV(startNormal), lift);
    const e = toV(end).addScaledVector(toV(endNormal), lift);
    this.preview.update(s, e, toV(startNormal), this.radius * 1.1, ARROW_COLORS.draft, true, null, false);
    this.preview.root.visible = s.distanceTo(e) > 0;
    this.viewer.requestRender();
  }

  clearPreview(): void {
    if (this.preview.root.visible) {
      this.preview.root.visible = false;
      this.viewer.requestRender();
    }
  }

  setHover(point: THREE.Vector3 | null, normal?: THREE.Vector3): void {
    if (!point || !normal) {
      if (this.hover.visible) {
        this.hover.visible = false;
        this.viewer.requestRender();
      }
      return;
    }
    const size = this.viewer.diagonal * 0.0065 * (this.last?.display.thickness ?? 1);
    this.hover.position.copy(point).addScaledVector(normal, this.viewer.diagonal * 0.0008);
    this.hover.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    this.hover.scale.setScalar(size);
    this.hover.visible = true;
    this.viewer.requestRender();
  }

  /** Arrow under the cursor, in screen space (forgiving for thin shafts). */
  pickAt(clientX: number, clientY: number, maxPx = 9): string | null {
    return this.pickNearest(clientX, clientY, maxPx)?.id ?? null;
  }

  /** Arrow under the cursor with its distance in pixels. */
  pickNearest(clientX: number, clientY: number, maxPx = 9): { id: string; dist: number } | null {
    let best: string | null = null;
    let bestD = maxPx;
    for (const [id, v] of this.visuals) {
      if (!v.root.visible) continue;
      const s = this.viewer.project(v.shownStart);
      const e = this.viewer.project(v.shownEnd);
      if (!s.visible && !e.visible) continue;
      const { dist, t } = pointSegment2D(clientX, clientY, s.x, s.y, e.x, e.y);
      if (dist >= bestD) continue;
      const p = v.shownStart.clone().lerp(v.shownEnd, t);
      if (this.viewer.isOccluded(p, v.radius * 6)) continue;
      best = id;
      bestD = dist;
    }
    return best ? { id: best, dist: bestD } : null;
  }

  /** Endpoint handle of the selected arrow under the cursor. */
  handleAt(clientX: number, clientY: number, maxPx = 13): 'start' | 'end' | null {
    const last = this.last;
    if (!last?.selected || !last.handles) return null;
    const v = this.visuals.get(last.selected);
    if (!v) return null;
    const s = this.viewer.project(v.shownStart);
    const e = this.viewer.project(v.shownEnd);
    const ds = Math.hypot(clientX - s.x, clientY - s.y);
    const de = Math.hypot(clientX - e.x, clientY - e.y);
    if (Math.min(ds, de) > maxPx) return null;
    return ds <= de ? 'start' : 'end';
  }

  /** Fade labels whose anchor is hidden behind the surface. */
  updateOcclusion(): void {
    for (const v of this.visuals.values()) {
      if (!v.label || !v.label.visible) continue;
      const p = v.label.getWorldPosition(new THREE.Vector3());
      v.setLabelOccluded(this.viewer.isOccluded(p, v.radius * 4));
    }
  }

  clearAll(): void {
    for (const v of this.visuals.values()) {
      v.dispose();
      this.group.remove(v.root);
    }
    this.visuals.clear();
    this.override = null;
    this.clearPreview();
    this.setHover(null);
    this.last = null;
    this.updateHandles();
  }
}

export function pointSegment2D(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { dist: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { dist: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t };
}

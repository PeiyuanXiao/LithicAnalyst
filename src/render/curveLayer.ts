import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { midPointIndex } from '../core/curveGeometry';
import type { Curve, ProjectState, Vec3 } from '../core/types';
import { pointSegment2D, type ArrowDisplay } from './arrowLayer';
import type { Viewer } from './viewer';

/** Curve colours by type; chosen to stay apart from the curvature ramp (ochre/slate) and the arrow colours. */
export const CURVE_COLORS = {
  types: {
    edge: '#ff5b4f',
    ridge: '#36c26a',
    scar_boundary: '#b867f2',
    other: '#f2f5f3',
  } as Record<string, string>,
  selected: '#ffc61a',
  draft: '#ffc61a',
  halo: '#141a18',
};

export const curveColor = (c: Curve): string => CURVE_COLORS.types[String(c.attributes.type)] ?? CURVE_COLORS.types.other;

export const WIDTH = 2.6;
export const WIDTH_SELECTED = 3.4;
const HALO = 2.6;

/**
 * Lines lie exactly on the surface. Moving every vertex a little toward the
 * camera along its view ray keeps it at the same screen position but in front
 * of the triangles it lies on (a scale-free depth offset).
 */
const PULL = 0.996;

function lineMaterial(color: string, width: number, opts: { ghost?: boolean; opacity?: number; halo?: boolean } = {}): LineMaterial {
  const m = new LineMaterial({
    color: new THREE.Color(color),
    linewidth: width,
    transparent: !!opts.ghost || (opts.opacity ?? 1) < 1,
    opacity: opts.ghost ? 0.2 : (opts.opacity ?? 1),
    depthTest: !opts.ghost,
    // the halo must not write depth: its caps would hide the core at every joint
    depthWrite: !opts.ghost && !opts.halo,
  });
  if (!opts.ghost) {
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );',
        `vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );\n\t\t\tstart.xyz *= ${PULL};\n\t\t\tend.xyz *= ${PULL};`,
      );
    };
    m.customProgramCacheKey = () => 'lithicanalyst-pulled-line';
  }
  return m;
}

/** One curve on screen: dark halo + coloured core (+ faint copy through the surface) and a label. */
export class CurveVisual {
  readonly root = new THREE.Group();
  readonly label: CSS2DObject | null = null;
  private geometry: LineGeometry | null = null;
  private readonly halo: Line2;
  private readonly core: Line2;
  private readonly ghost: Line2;
  /** Points currently drawn (original coordinates). */
  points: Vec3[] = [];
  closed = false;

  constructor(withLabel: boolean, onLabelClick?: () => void) {
    this.halo = new Line2(undefined, lineMaterial(CURVE_COLORS.halo, WIDTH + HALO, { halo: true }));
    this.core = new Line2(undefined, lineMaterial(CURVE_COLORS.types.other, WIDTH));
    this.ghost = new Line2(undefined, lineMaterial(CURVE_COLORS.types.other, WIDTH, { ghost: true }));
    this.halo.renderOrder = 10;
    this.core.renderOrder = 11;
    this.ghost.renderOrder = 900;
    for (const l of [this.halo, this.core, this.ghost]) l.frustumCulled = false;
    this.root.add(this.halo, this.core, this.ghost);
    if (withLabel) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'arrow-label curve-label';
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onLabelClick?.();
      });
      this.label = new CSS2DObject(el);
      this.label.center.set(-0.15, 1.3);
      this.root.add(this.label);
    }
  }

  /** Points in original coordinates; `origin` is subtracted for float precision on the GPU. */
  setPoints(points: Vec3[], closed: boolean, origin: Vec3): void {
    if (points === this.points && closed === this.closed && this.geometry) return;
    this.points = points;
    this.closed = closed;
    this.geometry?.dispose();
    this.geometry = null;
    const n = points.length + (closed && points.length > 2 ? 1 : 0);
    this.root.visible = points.length >= 2;
    if (points.length < 2) return;
    const flat = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const p = points[i % points.length];
      flat[3 * i] = p[0] - origin[0];
      flat[3 * i + 1] = p[1] - origin[1];
      flat[3 * i + 2] = p[2] - origin[2];
    }
    const g = new LineGeometry();
    g.setPositions(flat);
    this.geometry = g;
    this.halo.geometry = g;
    this.core.geometry = g;
    this.ghost.geometry = g;
    if (this.label) {
      const m = points[midPointIndex(points)];
      this.label.position.set(m[0] - origin[0], m[1] - origin[1], m[2] - origin[2]);
    }
  }

  style(color: string, width: number, ghostOn: boolean, opacity = 1): void {
    const core = this.core.material as LineMaterial;
    core.color.set(color);
    core.linewidth = width;
    if (core.opacity !== opacity) {
      core.opacity = opacity;
      core.transparent = opacity < 1;
      core.needsUpdate = true;
    }
    (this.halo.material as LineMaterial).linewidth = width + HALO;
    const ghost = this.ghost.material as LineMaterial;
    ghost.color.set(color);
    ghost.linewidth = width;
    this.ghost.visible = ghostOn;
  }

  setLabel(text: string | null, color: string, selected: boolean): void {
    if (!this.label) return;
    this.label.visible = text !== null && this.root.visible;
    if (text === null) return;
    const el = this.label.element;
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle('is-selected', selected);
    el.style.setProperty('--chip', color);
  }

  labelWorld(origin: Vec3): THREE.Vector3 | null {
    if (!this.label || !this.label.visible) return null;
    return this.label.position.clone().add(new THREE.Vector3(origin[0], origin[1], origin[2]));
  }

  dispose(): void {
    this.geometry?.dispose();
    for (const l of [this.halo, this.core, this.ghost]) (l.material as LineMaterial).dispose();
    if (this.label) {
      this.label.element.remove();
      this.root.remove(this.label);
    }
  }
}

/** Screen-size round handles for curve anchors, always drawn on top; hidden ones are left out. */
export class AnchorDots {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private world: Vec3[] = [];
  private colors: string[] = [];

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: { size: { value: 10 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        uniform float size;
        varying vec3 vColor;
        void main() {
          vColor = aColor;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord * 2.0 - 1.0;
          float r = length(c);
          if (r > 1.0) discard;
          gl_FragColor = vec4(r > 0.6 ? vec3(0.08, 0.1, 0.1) : vColor, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.points.renderOrder = 970;
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  set(world: Vec3[], colors: string[]): void {
    this.world = world;
    this.colors = colors;
  }

  get anchors(): Vec3[] {
    return this.world;
  }

  /** Rebuild the drawn dots, leaving out those hidden behind the surface. */
  rebuild(viewer: Viewer, origin: Vec3, pixelRatio: number): boolean[] {
    const visible = this.world.map((p) => !viewer.isOccluded(new THREE.Vector3(p[0], p[1], p[2]), viewer.diagonal * 0.003));
    const n = visible.filter(Boolean).length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color();
    let k = 0;
    this.world.forEach((p, i) => {
      if (!visible[i]) return;
      pos[3 * k] = p[0] - origin[0];
      pos[3 * k + 1] = p[1] - origin[1];
      pos[3 * k + 2] = p[2] - origin[2];
      c.set(this.colors[i] ?? '#ffffff');
      col[3 * k] = c.r;
      col[3 * k + 1] = c.g;
      col[3 * k + 2] = c.b;
      k++;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    this.points.geometry.dispose();
    this.points.geometry = g;
    this.points.visible = n > 0;
    this.material.uniforms.size.value = 10 * pixelRatio;
    return visible;
  }
}

export interface CurveOverride {
  id: string;
  points: Vec3[];
  anchors: Vec3[];
}

/**
 * Draws traced curves, the curve being drawn (committed part + live segment to
 * the cursor) and anchor handles for the selected curve or the drawing.
 */
export class CurveLayer {
  readonly group = new THREE.Group();
  private visuals = new Map<string, CurveVisual>();
  private readonly draft = new CurveVisual(false);
  private readonly live = new CurveVisual(false);
  private readonly dots = new AnchorDots();
  private origin: Vec3 = [0, 0, 0];
  private override: CurveOverride | null = null;
  private draftAnchors: Vec3[] | null = null;
  private hotAnchor: number | null = null;
  private dotsVisible: boolean[] = [];
  private last: { state: Readonly<ProjectState>; selected: string | null; display: ArrowDisplay; handles: boolean } | null = null;
  onLabelClick: (id: string) => void = () => {};

  constructor(private readonly viewer: Viewer) {
    this.group.name = 'curves';
    this.draft.root.visible = false;
    this.live.root.visible = false;
    this.group.add(this.draft.root, this.live.root, this.dots.points);
    viewer.overlay.add(this.group);
  }

  /** Mesh offset (original coordinates of the scene origin used for geometry). */
  setOrigin(origin: Vec3): void {
    this.origin = [origin[0], origin[1], origin[2]];
    this.group.position.set(origin[0], origin[1], origin[2]);
    this.group.updateMatrixWorld(true);
  }

  /** Draw every curve in this colour (another observer's annotations), instead of by type. */
  fixedColor: string | null = null;

  sync(state: Readonly<ProjectState>, selected: string | null, display: ArrowDisplay, showHandles: boolean): void {
    this.last = { state, selected, display, handles: showHandles };
    const seen = new Set<string>();
    for (const c of state.curves) {
      seen.add(c.id);
      let v = this.visuals.get(c.id);
      if (!v) {
        const id = c.id;
        v = new CurveVisual(true, () => this.onLabelClick(id));
        this.visuals.set(c.id, v);
        this.group.add(v.root);
      }
      const isSel = c.id === selected;
      const pts = this.override?.id === c.id ? this.override.points : c.points;
      v.setPoints(pts, c.closed, this.origin);
      const color = isSel ? CURVE_COLORS.selected : this.fixedColor ?? curveColor(c);
      v.style(color, isSel ? WIDTH_SELECTED : WIDTH, display.showHidden);
      v.setLabel(display.labels ? c.label : null, color, isSel);
    }
    for (const [id, v] of this.visuals) {
      if (!seen.has(id)) {
        v.dispose();
        this.group.remove(v.root);
        this.visuals.delete(id);
      }
    }
    this.updateDots();
    this.viewer.requestRender();
  }

  resync(): void {
    if (this.last) this.sync(this.last.state, this.last.selected, this.last.display, this.last.handles);
  }

  /** Temporary geometry for a curve while one of its anchors is dragged. */
  setOverride(o: CurveOverride | null): void {
    this.override = o;
    this.resync();
  }

  /** The curve being drawn: committed part and its anchors (null clears). */
  setDraft(points: Vec3[] | null, anchors: Vec3[] | null): void {
    this.draftAnchors = anchors && anchors.length ? anchors : null;
    if (points && points.length >= 2) {
      this.draft.setPoints(points, false, this.origin);
      this.draft.style(CURVE_COLORS.draft, WIDTH_SELECTED, true);
    } else this.draft.root.visible = false;
    this.updateDots();
    this.viewer.requestRender();
  }

  /** Live segment from the last anchor to the cursor (null hides it). */
  setLive(points: Vec3[] | null): void {
    if (points && points.length >= 2) {
      this.live.setPoints(points, false, this.origin);
      this.live.style(CURVE_COLORS.draft, WIDTH, true, 0.75);
    } else this.live.root.visible = false;
    this.viewer.requestRender();
  }

  /** Highlight one anchor handle (index into the shown anchors), or none. */
  highlightAnchor(i: number | null): void {
    if (i === this.hotAnchor) return;
    this.hotAnchor = i;
    this.updateDots();
    this.viewer.requestRender();
  }

  private handleAnchors(): Vec3[] {
    if (this.draftAnchors) return this.draftAnchors;
    const last = this.last;
    if (!last?.selected || !last.handles) return [];
    const c = last.state.curves.find((x) => x.id === last.selected);
    if (!c) return [];
    return this.override?.id === c.id ? this.override.anchors : c.anchors;
  }

  private updateDots(): void {
    const anchors = this.handleAnchors();
    const colors = anchors.map((_, i) => (i === this.hotAnchor ? CURVE_COLORS.selected : '#ffffff'));
    this.dots.set(anchors, colors);
    this.dotsVisible = this.dots.rebuild(this.viewer, this.origin, this.viewer.renderer.getPixelRatio());
  }

  /** Re-check which handles and labels are hidden behind the surface (after camera moves). */
  updateOcclusion(): void {
    if (this.dots.anchors.length) {
      this.dotsVisible = this.dots.rebuild(this.viewer, this.origin, this.viewer.renderer.getPixelRatio());
    }
    for (const v of this.visuals.values()) {
      const p = v.labelWorld(this.origin);
      if (p) v.label?.element.classList.toggle('is-occluded', this.viewer.isOccluded(p, this.viewer.diagonal * 0.004));
    }
  }

  /** Index of the anchor handle under the cursor. */
  anchorAt(clientX: number, clientY: number, maxPx = 11): number | null {
    const anchors = this.dots.anchors;
    let best: number | null = null;
    let bestD = maxPx;
    anchors.forEach((p, i) => {
      if (!this.dotsVisible[i]) return;
      const s = this.viewer.project(new THREE.Vector3(p[0], p[1], p[2]));
      const d = Math.hypot(s.x - clientX, s.y - clientY);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  /** Curve under the cursor, in screen space, with its distance in pixels. */
  pickNearest(clientX: number, clientY: number, maxPx = 8): { id: string; dist: number } | null {
    const rect = this.viewer.renderer.domElement.getBoundingClientRect();
    const cam = this.viewer.camera;
    const v = new THREE.Vector3();
    const toScreen = (p: Vec3): [number, number, boolean] => {
      v.set(p[0], p[1], p[2]).project(cam);
      return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height, v.z > -1 && v.z < 1];
    };
    let best: { id: string; dist: number } | null = null;
    for (const [id, vis] of this.visuals) {
      if (!vis.root.visible) continue;
      const pts = vis.points;
      const n = pts.length + (vis.closed ? 1 : 0);
      let prev = toScreen(pts[0]);
      let local: { dist: number; i: number; t: number } | null = null;
      for (let i = 1; i < n; i++) {
        const cur = toScreen(pts[i % pts.length]);
        if (prev[2] && cur[2]) {
          const { dist, t } = pointSegment2D(clientX, clientY, prev[0], prev[1], cur[0], cur[1]);
          if (dist < (local?.dist ?? maxPx)) local = { dist, i, t };
        }
        prev = cur;
      }
      if (!local || (best && local.dist >= best.dist)) continue;
      const a = pts[local.i - 1];
      const b = pts[local.i % pts.length];
      const p = new THREE.Vector3(a[0] + (b[0] - a[0]) * local.t, a[1] + (b[1] - a[1]) * local.t, a[2] + (b[2] - a[2]) * local.t);
      if (this.viewer.isOccluded(p, this.viewer.diagonal * 0.004)) continue;
      best = { id, dist: local.dist };
    }
    return best;
  }

  clearAll(): void {
    for (const v of this.visuals.values()) {
      v.dispose();
      this.group.remove(v.root);
    }
    this.visuals.clear();
    this.override = null;
    this.draftAnchors = null;
    this.hotAnchor = null;
    this.draft.root.visible = false;
    this.live.root.visible = false;
    this.last = null;
    this.updateDots();
  }
}

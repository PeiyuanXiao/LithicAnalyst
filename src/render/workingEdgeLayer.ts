import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Vec3 } from '../core/types';
import { HOT_HANDLE } from './arrowLayer';
import { AnchorDots, lineMaterial } from './curveLayer';
import type { Viewer } from './viewer';

/** One hue per working edge, in turn; apart from the retouch layers (magenta), the edge angles (blue) and the types of curve. */
export const WORKING_EDGE_COLORS = ['#14a3b8', '#8c6be0', '#7ea82b', '#c9812b', '#3f9e7d', '#b0639b'];

/** A working edge's colour, by the number in its label, so that it keeps it when another goes. */
export const workingEdgeColor = (label: string): string => {
  const n = Number(/\d+/.exec(label)?.[0] ?? 1);
  return WORKING_EDGE_COLORS[(n - 1) % WORKING_EDGE_COLORS.length];
};

const BAND_WIDTH = 8;
const BAND_WIDTH_SELECTED = 10;
const BAND_OPACITY = 0.5;
const TICK_WIDTH = 2.4;
/** Half a tick across the edge, as a share of the model's diagonal. */
const TICK_REACH = 0.018;
const HANDLE_PX = 11;

export interface DrawnEdge {
  id: string;
  label: string;
  /** Changes when its curve does. */
  version: string;
  /** Along the curve, from one end to the other. */
  stretch: Vec3[];
  start: Vec3;
  end: Vec3;
  selected: boolean;
}

interface Visual {
  lines: Line2[];
  geometries: LineGeometry[];
  label: CSS2DObject;
}

const flat = (chain: readonly Vec3[], o: Vec3): Float32Array => {
  const out = new Float32Array(chain.length * 3);
  chain.forEach((p, i) => out.set([p[0] - o[0], p[1] - o[1], p[2] - o[2]], 3 * i));
  return out;
};

/**
 * The working edges on the model: where they are being worked on, a wide faint band along the curve; where the curve is coloured
 * by what is measured on it, only a tick at each end. Each has its label; ends can be taken hold of under the select tool.
 */
export class WorkingEdgeLayer {
  readonly group = new THREE.Group();
  private visuals: Visual[] = [];
  private readonly dots = new AnchorDots();
  private readonly marks = new AnchorDots();
  private draft: { line: Line2; geometry: LineGeometry } | null = null;
  private drawnKey = '';
  private origin: Vec3 = [0, 0, 0];
  private ends: Array<{ id: string; which: 'start' | 'end'; point: Vec3 }> = [];
  private endsVisible: boolean[] = [];
  private hot: { id: string; which: 'start' | 'end' } | null = null;
  onLabelClick: (id: string) => void = () => {};

  constructor(private readonly viewer: Viewer) {
    this.group.name = 'working-edges';
    this.group.add(this.dots.points, this.marks.points);
    viewer.overlay.add(this.group);
  }

  /** `bands`: the wide band, else ticks. `handles`: their ends can be dragged. `centre`: the model's, for which way a tick stands across the edge. */
  sync(edges: readonly DrawnEdge[], bands: boolean, handles: boolean, labels: boolean, origin: Vec3, centre: Vec3): void {
    const key = JSON.stringify([edges.map((e) => [e.id, e.label, e.version, e.selected, e.start, e.end]), bands, labels, origin]);
    if (key !== this.drawnKey) {
      this.drawnKey = key;
      this.clearVisuals();
      this.origin = [origin[0], origin[1], origin[2]];
      this.group.position.set(origin[0], origin[1], origin[2]);
      for (const e of edges) this.visuals.push(this.build(e, bands, labels, centre));
    }
    this.ends = handles ? edges.flatMap((e) => [{ id: e.id, which: 'start' as const, point: e.start }, { id: e.id, which: 'end' as const, point: e.end }]) : [];
    this.updateHandles();
    this.viewer.requestRender();
  }

  private build(e: DrawnEdge, bands: boolean, labels: boolean, centre: Vec3): Visual {
    const color = workingEdgeColor(e.label);
    const o = this.origin;
    const lines: Line2[] = [];
    const geometries: LineGeometry[] = [];
    const add = (chain: Vec3[], width: number, opacity: number, order: number) => {
      if (chain.length < 2) return;
      const g = new LineGeometry();
      g.setPositions(flat(chain, o));
      geometries.push(g);
      const l = new Line2(g, lineMaterial(color, width, { opacity }));
      l.renderOrder = order;
      l.frustumCulled = false;
      lines.push(l);
      this.group.add(l);
    };
    if (bands) add(e.stretch, e.selected ? BAND_WIDTH_SELECTED : BAND_WIDTH, e.selected ? 0.8 : BAND_OPACITY, 12);
    else {
      add(this.tick(e.start, e.stretch[1] ?? e.end, centre), TICK_WIDTH, 1, 18);
      add(this.tick(e.end, e.stretch[e.stretch.length - 2] ?? e.start, centre), TICK_WIDTH, 1, 18);
    }
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `arrow-label curve-label edge-label${e.selected ? ' is-selected' : ''}`;
    el.dataset.edge = e.label;
    el.textContent = e.label;
    el.style.setProperty('--chip', color);
    el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.onLabelClick(e.id);
    });
    const label = new CSS2DObject(el);
    label.center.set(0.5, -0.4);
    const m = e.stretch[Math.floor(e.stretch.length / 2)] ?? e.start;
    label.position.set(m[0] - o[0], m[1] - o[1], m[2] - o[2]);
    label.visible = labels;
    this.group.add(label);
    return { lines, geometries, label };
  }

  /**
   * Two short lines through an end, square to the edge: one out of the plane the edge runs in, one toward and away from the model's
   * centre. Seen face on the second shows, from the side the first; one polyline, so that an end is one line to draw.
   */
  private tick(at: Vec3, along: Vec3, centre: Vec3): Vec3[] {
    const t = new THREE.Vector3(along[0] - at[0], along[1] - at[1], along[2] - at[2]);
    const inward = new THREE.Vector3(centre[0] - at[0], centre[1] - at[1], centre[2] - at[2]);
    const out = t.clone().cross(inward);
    if (out.lengthSq() === 0) return [];
    const reach = this.viewer.diagonal * TICK_REACH;
    out.normalize().multiplyScalar(reach);
    const radial = out.clone().cross(t).normalize().multiplyScalar(reach);
    const off = (v: THREE.Vector3, k: number): Vec3 => [at[0] + k * v.x, at[1] + k * v.y, at[2] + k * v.z];
    return [off(out, -1), [...at], off(out, 1), [...at], off(radial, 1), [...at], off(radial, -1)];
  }

  private updateHandles(): void {
    const colors = this.ends.map((e) => (e.id === this.hot?.id && e.which === this.hot.which ? HOT_HANDLE : '#ffffff'));
    this.dots.set(this.ends.map((e) => e.point), colors);
    this.endsVisible = this.dots.rebuild(this.viewer, this.origin, this.viewer.renderer.getPixelRatio());
  }

  /** The end under the cursor; of `first` when it has one there. */
  handleAt(x: number, y: number, first: string | null): { id: string; which: 'start' | 'end' } | null {
    let best: { id: string; which: 'start' | 'end' } | null = null, least = HANDLE_PX;
    this.ends.forEach((e, i) => {
      if (!this.endsVisible[i]) return;
      const s = this.viewer.project(new THREE.Vector3(e.point[0], e.point[1], e.point[2]));
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < least || (d <= HANDLE_PX && e.id === first && best?.id !== first)) {
        least = d;
        best = { id: e.id, which: e.which };
      }
    });
    return best;
  }

  highlight(h: { id: string; which: 'start' | 'end' } | null): void {
    if (h?.id === this.hot?.id && h?.which === this.hot?.which) return;
    this.hot = h;
    this.updateHandles();
    this.viewer.requestRender();
  }

  /** What the tool is about to do: the stretch and the points so far (null: nothing). */
  setDraft(stretch: readonly Vec3[] | null, color: string, points: readonly Vec3[]): void {
    if (this.draft) {
      (this.draft.line.material as LineMaterial).dispose();
      this.draft.geometry.dispose();
      this.group.remove(this.draft.line);
      this.draft = null;
    }
    if (stretch && stretch.length >= 2) {
      const geometry = new LineGeometry();
      geometry.setPositions(flat(stretch, this.origin));
      const line = new Line2(geometry, lineMaterial(color, BAND_WIDTH, { opacity: BAND_OPACITY }));
      line.renderOrder = 12;
      line.frustumCulled = false;
      this.group.add(line);
      this.draft = { line, geometry };
    }
    this.marks.set([...points], points.map(() => color));
    this.marks.rebuild(this.viewer, this.origin, this.viewer.renderer.getPixelRatio());
    this.viewer.requestRender();
  }

  /** Re-check which handles and labels are hidden behind the surface (after camera moves). */
  updateOcclusion(): void {
    if (this.ends.length) this.updateHandles();
    const o = this.origin;
    for (const v of this.visuals) {
      const p = v.label.position;
      v.label.element.classList.toggle('is-occluded', this.viewer.isOccluded(new THREE.Vector3(p.x + o[0], p.y + o[1], p.z + o[2]), this.viewer.diagonal * 0.004));
    }
  }

  /** How many are drawn, and how (for tests). */
  counts(): { edges: number; lines: number; handles: number } {
    return { edges: this.visuals.length, lines: this.visuals.reduce((s, v) => s + v.lines.length, 0), handles: this.ends.length };
  }

  private clearVisuals(): void {
    for (const v of this.visuals) {
      for (const l of v.lines) {
        (l.material as LineMaterial).dispose();
        this.group.remove(l);
      }
      for (const g of v.geometries) g.dispose();
      v.label.element.remove();
      this.group.remove(v.label);
    }
    this.visuals = [];
  }

  clear(): void {
    this.clearVisuals();
    this.drawnKey = '';
    this.ends = [];
    this.hot = null;
    this.setDraft(null, '#ffffff', []);
    this.updateHandles();
  }
}

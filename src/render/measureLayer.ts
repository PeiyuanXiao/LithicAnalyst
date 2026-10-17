import * as THREE from 'three';
import type { Measurement, ProjectState, Vec3 } from '../core/types';
import { AnchorDots, CurveVisual, WIDTH, WIDTH_SELECTED } from './curveLayer';
import type { Viewer } from './viewer';

export const MEASURE_COLORS = {
  line: '#4cc9f0',
  selected: '#ffc61a',
  draft: '#ffc61a',
};

/** The line a measurement is drawn as: straight, the traced path, or the two legs of an angle. */
const shownPoints = (m: Measurement): Vec3[] => (m.type === 'geodesic' && m.path && m.path.length >= 2 ? m.path : m.points);

/** Draws manual measurements (lines, points, value labels) and the one being taken. */
export class MeasureLayer {
  readonly group = new THREE.Group();
  private visuals = new Map<string, CurveVisual>();
  private readonly draft = new CurveVisual(false);
  private readonly dots = new AnchorDots();
  private origin: Vec3 = [0, 0, 0];
  private draftPoints: Vec3[] = [];
  private stored: { points: Vec3[]; colors: string[] } = { points: [], colors: [] };
  onLabelClick: (id: string) => void = () => {};

  constructor(private readonly viewer: Viewer) {
    this.group.name = 'measurements';
    this.draft.root.visible = false;
    this.group.add(this.draft.root, this.dots.points);
    viewer.overlay.add(this.group);
  }

  setOrigin(origin: Vec3): void {
    this.origin = [origin[0], origin[1], origin[2]];
    this.group.position.set(origin[0], origin[1], origin[2]);
    this.group.updateMatrixWorld(true);
  }

  /** `visible` false hides everything (other work modes); `label` gives the text shown next to each. */
  sync(state: Readonly<ProjectState>, selected: string | null, visible: boolean, label: (m: Measurement) => string): void {
    this.group.visible = visible;
    const seen = new Set<string>();
    const dots: Vec3[] = [];
    const colors: string[] = [];
    for (const m of state.measurements) {
      seen.add(m.id);
      let v = this.visuals.get(m.id);
      if (!v) {
        const id = m.id;
        v = new CurveVisual(true, () => this.onLabelClick(id));
        v.label?.element.classList.add('measure-label');
        this.visuals.set(m.id, v);
        this.group.add(v.root);
      }
      const isSel = m.id === selected;
      const color = isSel ? MEASURE_COLORS.selected : MEASURE_COLORS.line;
      v.setPoints(shownPoints(m), false, this.origin);
      v.style(color, isSel ? WIDTH_SELECTED : WIDTH, true);
      v.setLabel(label(m), color, isSel);
      for (const p of m.points) {
        dots.push(p);
        colors.push(color);
      }
    }
    for (const [id, v] of this.visuals) {
      if (!seen.has(id)) {
        v.dispose();
        this.group.remove(v.root);
        this.visuals.delete(id);
      }
    }
    this.stored = { points: dots, colors };
    this.rebuildDots();
  }

  private rebuildDots(): void {
    const points = [...this.stored.points, ...this.draftPoints];
    const colors = [...this.stored.colors, ...this.draftPoints.map(() => MEASURE_COLORS.draft)];
    this.dots.set(points, colors);
    this.dots.rebuild(this.viewer, this.origin, this.viewer.renderer.getPixelRatio());
    this.viewer.requestRender();
  }

  /** The measurement being taken: placed points, then a rubber band to the cursor (null clears). */
  setDraft(points: Vec3[], cursor: Vec3 | null): void {
    const placedChanged = points.length !== this.draftPoints.length || points.some((p, i) => p !== this.draftPoints[i]);
    this.draftPoints = points;
    const line = cursor ? [...points, cursor] : points;
    if (line.length >= 2) {
      this.draft.setPoints(line, false, this.origin);
      this.draft.style(MEASURE_COLORS.draft, WIDTH, true, 0.85);
    } else this.draft.root.visible = false;
    if (placedChanged) this.rebuildDots();
    else this.viewer.requestRender();
  }

  /** Re-check which points and labels are hidden behind the surface (after camera moves). */
  updateOcclusion(): void {
    if (!this.group.visible) return;
    if (this.dots.anchors.length) this.dots.rebuild(this.viewer, this.origin, this.viewer.renderer.getPixelRatio());
    for (const v of this.visuals.values()) {
      const p = v.labelWorld(this.origin);
      if (p) v.label?.element.classList.toggle('is-occluded', this.viewer.isOccluded(p, this.viewer.diagonal * 0.004));
    }
  }

  clearAll(): void {
    for (const v of this.visuals.values()) {
      v.dispose();
      this.group.remove(v.root);
    }
    this.visuals.clear();
    this.draftPoints = [];
    this.stored = { points: [], colors: [] };
    this.draft.root.visible = false;
    this.dots.set([], []);
    this.dots.points.visible = false;
  }
}

import * as THREE from 'three';
import type { SnapMode } from '../compute/surfacePath';
import { addCurve } from '../core/actions';
import { assembleCurve } from '../core/curveGeometry';
import type { Vec3 } from '../core/types';
import type { SurfaceHit } from '../render/viewer';
import type { HitProvider, Tool, ToolContext } from './tool';

const CLICK_PX = 4;
/** Clicks snap to a ridge or valley within this many screen pixels. */
export const SNAP_PX = 12;
/** A click this close to the first point closes the curve. */
const CLOSE_PX = 11;
/** Vertices settled per pointer move while the live segment is computed. */
const FRAME_BUDGET = 150_000;

interface Anchor {
  v: number;
  p: Vec3;
}

interface Target extends Anchor {
  closing: boolean;
}

const vec = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);

/**
 * Trace a curve on the surface: each click adds a point (snapped onto the
 * nearest ridge or valley), and the stretch between points follows that
 * feature. Double-click, Enter or Esc finishes (a single point is dropped);
 * clicking the first point closes the curve; Backspace removes the last
 * point; holding Shift places points without snapping. Dragging still turns
 * the view.
 */
export class DrawCurveTool implements Tool {
  readonly id = 'curve';
  private anchors: Anchor[] = [];
  private segments: Vec3[][] = [];
  private down: { x: number; y: number } | null = null;
  private pointer: { x: number; y: number; shift: boolean } | null = null;
  private target: Target | null = null;
  private busy = false;
  private searchMode: SnapMode | null = null;
  private searchCost: Float32Array | null | undefined = undefined;
  private raf = 0;

  constructor(private readonly ctx: ToolContext) {}

  get drawing(): boolean {
    return this.anchors.length > 0;
  }

  /** Points placed so far on the curve being drawn (original coordinates). */
  draftPoints(): Vec3[] {
    return this.anchors.map((a) => a.p);
  }

  activate(): void {
    this.reset();
    void this.ctx.snap()?.prepare(this.ctx.snapMode());
  }

  deactivate(): void {
    if (this.anchors.length >= 2) this.finish(false);
    else this.reset();
    this.ctx.arrows.setHover(null);
  }

  private reset(): void {
    this.anchors = [];
    this.segments = [];
    this.target = null;
    this.searchMode = null;
    this.searchCost = undefined;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ctx.curves.setDraft(null, null);
    this.ctx.curves.setLive(null);
    this.ctx.curves.highlightAnchor(null);
  }

  private mode(shift: boolean): SnapMode {
    return shift ? 'off' : this.ctx.snapMode();
  }

  pointerDown(e: PointerEvent): boolean {
    this.down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    return false; // dragging keeps turning the view
  }

  pointerMove(e: PointerEvent, hit: HitProvider): void {
    this.pointer = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
    if (e.buttons !== 0) {
      // the view is being turned
      this.ctx.arrows.setHover(null);
      this.ctx.curves.setLive(null);
      return;
    }
    this.updateTarget(hit());
  }

  pointerUp(e: PointerEvent, hit: HitProvider): void {
    const d = this.down;
    this.down = null;
    if (e.button !== 0 || !d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_PX) {
      this.pointer = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
      this.updateTarget(hit());
      return;
    }
    void this.click(hit(), e.shiftKey, e.clientX, e.clientY);
  }

  doubleClick(_e: MouseEvent, hit: HitProvider): void {
    if (this.anchors.length >= 2) {
      this.finish(false);
      return;
    }
    // Not drawing: as in select mode, set the rotation centre (and drop the point the first click made).
    this.reset();
    this.ctx.changed();
    const h = hit();
    if (h) this.ctx.viewer.setRotationCenter(h.point);
  }

  /** Re-evaluate the point under the cursor (snap mode, modifier or curvature scale changed). */
  refresh(): void {
    const p = this.pointer;
    if (!p) return;
    this.updateTarget(this.ctx.viewer.pickSurface(p.x, p.y));
  }

  modifiersChanged(e: KeyboardEvent): void {
    if (!this.pointer || this.pointer.shift === e.shiftKey) return;
    this.pointer.shift = e.shiftKey;
    this.refresh();
  }

  private viewNormal(n: Vec3, p: Vec3): THREE.Vector3 {
    const nv = vec(n);
    if (nv.dot(this.ctx.viewer.camera.position.clone().sub(vec(p))) < 0) nv.negate();
    return nv;
  }

  private resolveTarget(h: SurfaceHit, mode: SnapMode, x: number, y: number): Target | null {
    const snap = this.ctx.snap();
    if (!snap) return null;
    if (this.anchors.length >= 3) {
      const first = this.anchors[0];
      const s = this.ctx.viewer.project(vec(first.p));
      if (Math.hypot(s.x - x, s.y - y) <= CLOSE_PX) return { ...first, closing: true };
    }
    const v0 = snap.vertexOfHit(h);
    const v = mode === 'off' ? v0 : snap.snap(v0, this.ctx.viewer.worldPerPixel(h.point) * SNAP_PX, mode);
    return { v, p: snap.point(v), closing: false };
  }

  private updateTarget(h: SurfaceHit | null): void {
    const snap = this.ctx.snap();
    const ptr = this.pointer;
    if (!h || !snap || !ptr) {
      this.target = null;
      this.ctx.arrows.setHover(null);
      this.ctx.curves.setLive(null);
      this.ctx.curves.highlightAnchor(null);
      return;
    }
    const mode = this.mode(ptr.shift);
    if (!snap.ready(mode)) {
      this.ctx.arrows.setHover(h.point, h.normal);
      void snap.prepare(mode).then((ok) => {
        if (ok) this.refresh();
      });
      return;
    }
    this.target = this.resolveTarget(h, mode, ptr.x, ptr.y);
    if (!this.target) return;
    // a click here would close the curve: light up its first point
    this.ctx.curves.highlightAnchor(this.target.closing ? 0 : null);
    this.ctx.arrows.setHover(vec(this.target.p), this.viewNormal(snap.normal(this.target.v), this.target.p));
    this.updateLive();
  }

  /** The search from the last point, restarted when the point or the snap mode changes. */
  private ensureSearch() {
    const snap = this.ctx.snap();
    const last = this.anchors[this.anchors.length - 1];
    if (!snap || !last) return null;
    const mode = this.mode(this.pointer?.shift ?? false);
    if (!snap.ready(mode)) return null;
    const search = snap.search(0);
    if (!search) return null;
    const cost = snap.cost(mode);
    if (search.seed !== last.v || this.searchMode !== mode || this.searchCost !== cost) {
      search.start(last.v, cost);
      this.searchMode = mode;
      this.searchCost = cost;
    }
    return search;
  }

  private updateLive(): void {
    const last = this.anchors[this.anchors.length - 1];
    const t = this.target;
    const search = last && t ? this.ensureSearch() : null;
    if (!last || !t || !search) {
      this.ctx.curves.setLive(null);
      return;
    }
    if (search.reach(t.v, FRAME_BUDGET)) {
      this.ctx.curves.setLive(this.ctx.snap()!.points(search.path(t.v)!));
    } else if (search.unreachable(t.v)) {
      this.ctx.curves.setLive(null);
    } else {
      // far away on a big mesh: keep expanding over the next frames
      this.ctx.curves.setLive([last.p, t.p]);
      if (!this.raf)
        this.raf = requestAnimationFrame(() => {
          this.raf = 0;
          this.updateLive();
        });
    }
  }

  private async click(h: SurfaceHit | null, shift: boolean, x: number, y: number): Promise<void> {
    const snap = this.ctx.snap();
    if (!h || !snap || this.busy) return;
    this.busy = true;
    try {
      this.pointer = { x, y, shift };
      const mode = this.mode(shift);
      if (!(await snap.prepare(mode)) || snap !== this.ctx.snap()) return;
      const t = this.resolveTarget(h, mode, x, y);
      if (!t) return;
      if (this.anchors.length === 0) {
        this.ctx.selection.set(null);
        this.anchors.push({ v: t.v, p: t.p });
        this.ctx.changed();
      } else {
        const last = this.anchors[this.anchors.length - 1];
        if (t.v === last.v) return;
        const search = this.ensureSearch();
        if (!search) return;
        if (!search.reach(t.v)) {
          this.ctx.notify('toast.curveUnreachable', 'warn');
          return;
        }
        this.segments.push(snap.refine(search.path(t.v)!, this.searchMode ?? mode));
        if (t.closing) {
          this.finish(true);
          return;
        }
        this.anchors.push({ v: t.v, p: t.p });
      }
      this.showDraft();
      this.target = t;
      this.updateLive();
    } finally {
      this.busy = false;
    }
  }

  private showDraft(): void {
    const pts = this.segments.length ? assembleCurve(this.segments, false).points : null;
    this.ctx.curves.setDraft(pts, this.anchors.map((a) => a.p));
  }

  private finish(closed: boolean): boolean {
    if (this.anchors.length < 2) {
      this.reset();
      this.ctx.changed();
      return false;
    }
    const { points, anchorIndex } = assembleCurve(this.segments, closed);
    const anchors = this.anchors.map((a) => a.p);
    this.reset();
    const curve = addCurve(this.ctx.store, { anchors, points, anchorIndex, closed });
    this.ctx.selection.set(curve.id);
    this.ctx.changed();
    return true;
  }

  undoStep(): boolean {
    if (!this.anchors.length) return false;
    this.anchors.pop();
    this.segments.length = Math.max(0, this.anchors.length - 1);
    if (!this.anchors.length) {
      this.reset();
    } else {
      this.showDraft();
      this.searchMode = null;
      this.refresh();
    }
    this.ctx.changed();
    return true;
  }

  commit(): boolean {
    if (!this.anchors.length) return false;
    this.finish(false);
    return true;
  }

  /** Esc: keep what has been traced (two points or more), drop a lone first point. */
  cancel(): boolean {
    if (!this.anchors.length) return false;
    this.finish(false);
    return true;
  }

  hintKey(): string {
    return '';
  }

  cursor(): string {
    return 'crosshair';
  }
}

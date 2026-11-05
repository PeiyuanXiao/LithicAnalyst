import type { SnapMode } from '../compute/surfacePath';
import { moveEndpoint, setCurveShape } from '../core/actions';
import { assembleCurve, curveSegments, type CurveShape } from '../core/curveGeometry';
import type { Vec3 } from '../core/types';
import { copy } from '../core/vec';
import type { SurfaceHit } from '../render/viewer';
import { pointVertex } from './drawArrowTool';
import { SNAP_PX } from './drawCurveTool';
import type { HitProvider, Tool, ToolContext } from './tool';

const CLICK_PX = 4;
const DRAG_BUDGET = 400_000;

interface CurveDrag {
  id: string;
  k: number;
  closed: boolean;
  anchors: Vec3[];
  segments: Vec3[][];
  prevK: number;
  nextK: number;
  prevV: number;
  nextV: number;
  mode: SnapMode;
  seeded: boolean;
  shape: CurveShape | null;
  /** Vertex chains of the two retraced stretches (toward the previous / next point), for the final refinement. */
  chains: { prev: Uint32Array | null; next: Uint32Array | null; v: number } | null;
}

/**
 * Select arrows, curves, landmarks and measurements, drag arrow endpoints and curve
 * points (the neighbouring stretches are traced again), double-click to set the
 * rotation centre. What a click would select is shown under the cursor (hover).
 */
export class SelectTool implements Tool {
  readonly id = 'select';
  private down: { x: number; y: number } | null = null;
  private drag: { id: string; which: 'start' | 'end'; point: Vec3; normal: Vec3; last?: SurfaceHit; exact?: boolean } | null = null;
  private curveDrag: CurveDrag | null = null;
  private overHandle: 'start' | 'end' | null = null;
  private overAnchor: number | null = null;
  /** The item a click would select now, and the pick waiting for the next frame. */
  private hovered: string | null = null;
  private hoverAt: { x: number; y: number } | null = null;
  private hoverFrame = 0;

  constructor(private readonly ctx: ToolContext) {}

  activate(): void {
    this.ctx.arrows.setHover(null);
  }

  deactivate(): void {
    this.clearHover();
    this.endDrag(false);
    this.endCurveDrag(false);
    this.down = null;
    this.overHandle = null;
    this.overAnchor = null;
    this.ctx.arrows.highlightHandle(null);
    this.ctx.curves.highlightAnchor(null);
  }

  pointerDown(e: PointerEvent): boolean {
    this.clearHover();
    if (e.button !== 0) return false;
    if (!this.ctx.editable()) {
      this.down = { x: e.clientX, y: e.clientY };
      return false;
    }
    const id = this.ctx.selection.id;
    const curve = id ? this.ctx.store.curve(id) : undefined;
    if (curve) {
      const k = this.ctx.curves.anchorAt(e.clientX, e.clientY);
      if (k !== null && k < curve.anchors.length) {
        this.startCurveDrag(curve.id, k, e.shiftKey);
        return true;
      }
    }
    const which = this.ctx.arrows.handleAt(e.clientX, e.clientY);
    if (which && id) {
      const axis = this.ctx.store.state.flake.axis;
      const a = this.ctx.store.scar(id)?.vector ?? (axis?.id === id ? axis : null);
      if (a) {
        this.drag = {
          id,
          which,
          point: which === 'start' ? a.start : a.end,
          normal: which === 'start' ? a.startNormal : a.endNormal,
        };
        // the point of percussion goes where it goes when the axis is drawn
        if (which === 'start' && axis?.id === id) {
          const mode = this.ctx.snapMode();
          if (mode !== 'off') void this.ctx.snap()?.prepare(mode);
        }
        this.ctx.arrows.highlightHandle(which);
        this.ctx.changed();
        return true;
      }
    }
    this.down = { x: e.clientX, y: e.clientY };
    return false;
  }

  pointerMove(e: PointerEvent, hit: HitProvider): void {
    if (this.curveDrag) {
      this.moveCurveDrag(hit);
      return;
    }
    if (this.drag) {
      const h = hit();
      if (h) {
        if (this.isAxisStart(this.drag)) {
          const at = pointVertex(this.ctx, h, e.shiftKey);
          this.drag.point = at.p;
          this.drag.normal = at.n;
          this.drag.last = h;
          this.drag.exact = e.shiftKey;
        } else {
          this.drag.point = [h.point.x, h.point.y, h.point.z];
          this.drag.normal = [h.normal.x, h.normal.y, h.normal.z];
        }
        this.ctx.arrows.setEndpointOverride({ id: this.drag.id, which: this.drag.which, point: this.drag.point, normal: this.drag.normal });
      }
      return;
    }
    if (e.buttons === 0) {
      const anchor = this.ctx.curves.anchorAt(e.clientX, e.clientY);
      const over = anchor === null ? this.ctx.arrows.handleAt(e.clientX, e.clientY) : null;
      if (over !== this.overHandle || anchor !== this.overAnchor) {
        this.overHandle = over;
        this.overAnchor = anchor;
        this.ctx.arrows.highlightHandle(over);
        this.ctx.curves.highlightAnchor(anchor);
        this.ctx.changed();
      }
      if (over || anchor !== null) this.setHovered(null);
      else this.queueHover(e.clientX, e.clientY);
    }
  }

  pointerLeave(): void {
    this.clearHover();
  }

  /** The item nearest the cursor that a click would select (the same pick as a click). */
  private pick(x: number, y: number): { id: string; dist: number } | null {
    const picks = [this.ctx.arrows.pickNearest(x, y), this.ctx.curves.pickNearest(x, y), this.ctx.landmarks.pickNearest(x, y), this.ctx.measures.pickNearest(x, y)];
    return picks.reduce<{ id: string; dist: number } | null>((best, p) => (p && (!best || p.dist < best.dist) ? p : best), null);
  }

  /** Pick at most once a frame (the BVH answers each ray; nothing runs over the whole mesh). */
  private queueHover(x: number, y: number): void {
    this.hoverAt = { x, y };
    if (this.hoverFrame) return;
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = 0;
      const at = this.hoverAt;
      if (!at) return;
      const id = this.pick(at.x, at.y)?.id ?? null;
      this.setHovered(id);
      if (id) this.ctx.hovered({ id, x: at.x, y: at.y });
    });
  }

  private setHovered(id: string | null): void {
    if (id === this.hovered) return;
    this.hovered = id;
    this.ctx.arrows.setHoverItem(id);
    this.ctx.curves.setHoverItem(id);
    this.ctx.landmarks.setHoverItem(id);
    this.ctx.measures.setHoverItem(id);
    if (!id) this.ctx.hovered(null);
    this.ctx.changed();
  }

  clearHover(): void {
    cancelAnimationFrame(this.hoverFrame);
    this.hoverFrame = 0;
    this.hoverAt = null;
    this.setHovered(null);
  }

  pointerUp(e: PointerEvent): void {
    if (this.curveDrag) {
      this.endCurveDrag(true);
      return;
    }
    if (this.drag) {
      this.endDrag(true);
      return;
    }
    if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) <= CLICK_PX && e.button === 0) {
      this.ctx.selection.set(this.pick(e.clientX, e.clientY)?.id ?? null);
    }
    this.down = null;
  }

  doubleClick(_e: MouseEvent, hit: HitProvider): void {
    const h = hit();
    if (h) this.ctx.viewer.setRotationCenter(h.point);
  }

  // ---- arrow endpoints

  private isAxisStart(d: { id: string; which: 'start' | 'end' }): boolean {
    return d.which === 'start' && this.ctx.store.state.flake.axis?.id === d.id;
  }

  private endDrag(commit: boolean): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.ctx.arrows.setEndpointOverride(null);
    if (commit) {
      const snap = this.ctx.snap();
      const mode = this.ctx.snapMode();
      if (this.isAxisStart(d) && d.last && !d.exact && snap && mode !== 'off' && !snap.ready(mode)) {
        // what it snaps to was not ready while dragging
        const last = d.last;
        void snap.prepare(mode).then(() => {
          const at = pointVertex(this.ctx, last, false);
          this.ctx.moveAxisEnd('start', at.p, at.n);
        });
      } else if (this.ctx.store.state.flake.axis?.id === d.id) this.ctx.moveAxisEnd(d.which, d.point, d.normal);
      else moveEndpoint(this.ctx.store, d.id, d.which, d.point, d.normal);
    }
    this.ctx.arrows.highlightHandle(null);
    this.ctx.changed();
  }

  // ---- curve points

  private startCurveDrag(id: string, k: number, shift: boolean): void {
    const c = this.ctx.store.curve(id);
    if (!c) return;
    const A = c.anchors.length;
    const mode: SnapMode = shift ? 'off' : this.ctx.snapMode();
    this.curveDrag = {
      id,
      k,
      closed: c.closed,
      anchors: c.anchors.map(copy),
      segments: curveSegments(c),
      prevK: k > 0 ? k - 1 : c.closed ? A - 1 : -1,
      nextK: k < A - 1 ? k + 1 : c.closed ? 0 : -1,
      prevV: -1,
      nextV: -1,
      mode,
      seeded: false,
      shape: null,
      chains: null,
    };
    void this.ctx.snap()?.prepare(mode);
    this.ctx.curves.highlightAnchor(k);
    this.ctx.changed();
  }

  private moveCurveDrag(hit: HitProvider): void {
    const d = this.curveDrag!;
    const snap = this.ctx.snap();
    const h = hit();
    if (!snap || !h || !snap.ready(d.mode)) return;
    if (!d.seeded) {
      const cost = snap.cost(d.mode);
      if (d.prevK >= 0) {
        d.prevV = snap.nearestVertex(d.anchors[d.prevK]);
        snap.search(1)!.start(d.prevV, cost);
      }
      if (d.nextK >= 0) {
        d.nextV = snap.nearestVertex(d.anchors[d.nextK]);
        snap.search(2)!.start(d.nextV, cost);
      }
      d.seeded = true;
    }
    const v0 = snap.vertexOfHit(h);
    const v = d.mode === 'off' ? v0 : snap.snap(v0, this.ctx.viewer.worldPerPixel(h.point) * SNAP_PX, d.mode);
    if (v === d.prevV || v === d.nextV) return;
    const segments = d.segments.slice();
    let prev: Uint32Array | null = null;
    let next: Uint32Array | null = null;
    if (d.prevK >= 0) {
      const s = snap.search(1)!;
      if (!s.reach(v, DRAG_BUDGET)) return;
      prev = s.path(v)!;
      segments[d.prevK] = snap.points(prev);
    }
    if (d.nextK >= 0) {
      const s = snap.search(2)!;
      if (!s.reach(v, DRAG_BUDGET)) return;
      next = s.path(v)!.reverse();
      segments[d.k] = snap.points(next);
    }
    const anchors = d.anchors.slice();
    anchors[d.k] = snap.point(v);
    const { points, anchorIndex } = assembleCurve(segments, d.closed);
    d.shape = { anchors, points, anchorIndex, closed: d.closed };
    d.chains = { prev, next, v };
    this.ctx.curves.setOverride({ id: d.id, points, anchors });
  }

  private endCurveDrag(commit: boolean): void {
    const d = this.curveDrag;
    if (!d) return;
    this.curveDrag = null;
    if (commit && d.shape && d.chains) {
      // the stretches were shown as traced; store them pulled taut
      const snap = this.ctx.snap();
      const segments = curveSegments(d.shape);
      if (snap) {
        if (d.chains.prev && d.prevK >= 0) segments[d.prevK] = snap.refine(d.chains.prev, d.mode);
        if (d.chains.next && d.nextK >= 0) segments[d.k] = snap.refine(d.chains.next, d.mode);
      }
      const { points, anchorIndex } = assembleCurve(segments, d.closed);
      setCurveShape(this.ctx.store, d.id, { anchors: d.shape.anchors, points, anchorIndex, closed: d.closed });
    }
    this.ctx.curves.setOverride(null);
    this.ctx.curves.highlightAnchor(null);
    this.ctx.changed();
  }

  cancel(): boolean {
    if (this.curveDrag) {
      this.endCurveDrag(false);
      return true;
    }
    if (this.drag) {
      this.endDrag(false);
      return true;
    }
    if (this.ctx.selection.id) {
      this.ctx.selection.set(null);
      return true;
    }
    return false;
  }

  hintKey(): string {
    if (this.drag) return 'hint.dragEndpoint';
    return this.ctx.selection.id ? 'hint.selectWithSelection' : 'hint.select';
  }

  cursor(): string {
    if (this.drag || this.curveDrag) return 'grabbing';
    if (this.overHandle || this.overAnchor !== null) return 'grab';
    return this.hovered ? 'pointer' : 'default';
  }
}

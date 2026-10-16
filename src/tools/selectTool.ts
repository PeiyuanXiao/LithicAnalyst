import type { SnapMode } from '../compute/surfacePath';
import { moveEndpoint, setCurveShape } from '../core/actions';
import { assembleCurve, curveSegments, type CurveShape } from '../core/curveGeometry';
import type { Vec3 } from '../core/types';
import { copy } from '../core/vec';
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
 * Select arrows and curves, drag arrow endpoints and curve points (the
 * neighbouring stretches are traced again), double-click to set the rotation centre.
 */
export class SelectTool implements Tool {
  readonly id = 'select';
  private down: { x: number; y: number } | null = null;
  private drag: { id: string; which: 'start' | 'end'; point: Vec3; normal: Vec3 } | null = null;
  private curveDrag: CurveDrag | null = null;
  private overHandle: 'start' | 'end' | null = null;
  private overAnchor: number | null = null;

  constructor(private readonly ctx: ToolContext) {}

  activate(): void {
    this.ctx.arrows.setHover(null);
  }

  deactivate(): void {
    this.endDrag(false);
    this.endCurveDrag(false);
    this.down = null;
    this.overHandle = null;
    this.overAnchor = null;
    this.ctx.arrows.highlightHandle(null);
    this.ctx.curves.highlightAnchor(null);
  }

  pointerDown(e: PointerEvent): boolean {
    if (e.button !== 0) return false;
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
      const a = this.ctx.store.arrow(id);
      if (a) {
        this.drag = {
          id,
          which,
          point: which === 'start' ? a.start : a.end,
          normal: which === 'start' ? a.startNormal : a.endNormal,
        };
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
        this.drag.point = [h.point.x, h.point.y, h.point.z];
        this.drag.normal = [h.normal.x, h.normal.y, h.normal.z];
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
    }
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
      const a = this.ctx.arrows.pickNearest(e.clientX, e.clientY);
      const c = this.ctx.curves.pickNearest(e.clientX, e.clientY);
      const pick = !a ? c : !c ? a : c.dist < a.dist ? c : a;
      this.ctx.selection.set(pick?.id ?? null);
    }
    this.down = null;
  }

  doubleClick(_e: MouseEvent, hit: HitProvider): void {
    const h = hit();
    if (h) this.ctx.viewer.setRotationCenter(h.point);
  }

  // ---- arrow endpoints

  private endDrag(commit: boolean): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.ctx.arrows.setEndpointOverride(null);
    if (commit) moveEndpoint(this.ctx.store, d.id, d.which, d.point, d.normal);
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
    return this.overHandle || this.overAnchor !== null ? 'grab' : 'default';
  }
}

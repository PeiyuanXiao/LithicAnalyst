import { addScarVector } from '../core/actions';
import type { Vec3 } from '../core/types';
import { distance } from '../core/vec';
import type { SurfaceHit } from '../render/viewer';
import { SNAP_PX } from './drawCurveTool';
import type { HitProvider, Tool, ToolContext } from './tool';

const DRAG_PX = 5;
/** Arrows shorter than this fraction of the model diagonal are treated as mistakes. */
const MIN_LENGTH_FRACTION = 0.002;

type State = 'idle' | 'pressing' | 'dragging' | 'awaitingEnd' | 'secondPress';

interface Point {
  p: Vec3;
  n: Vec3;
}

const fromHit = (h: SurfaceHit): Point => ({ p: [h.point.x, h.point.y, h.point.z], n: [h.normal.x, h.normal.y, h.normal.z] });

/** Where a thing that is a point goes: a mesh vertex, on the nearest place of a ridge or valley as the snap setting says (`exact`: the one under the press). */
export function pointVertex(ctx: ToolContext, h: SurfaceHit, exact: boolean): Point {
  const snap = ctx.snap();
  if (!snap) return fromHit(h);
  const mode = exact ? 'off' : ctx.snapMode();
  if (mode !== 'off' && !snap.ready(mode)) void snap.prepare(mode);
  const v0 = snap.vertexOfHit(h);
  const v = mode !== 'off' && snap.ready(mode) ? snap.snapPoint(v0, ctx.viewer.worldPerPixel(h.point) * SNAP_PX, mode) : v0;
  return { p: snap.point(v), n: snap.normal(v) };
}

/** Another arrow than a scar's: its tool's id, the start snapped as a point is, what happens with it. */
export interface ArrowToolOptions {
  id: string;
  snapStart?: boolean;
  onFinish: (start: Point, end: Point) => void;
}

/**
 * Draw scar vectors: press at the origin, drag to the termination, release.
 * A click without dragging starts two-click mode: the next click sets the end.
 */
export class DrawArrowTool implements Tool {
  readonly id: string;
  private state: State = 'idle';
  private start: Point | null = null;
  private end: Point | null = null;
  private downXY = { x: 0, y: 0 };

  constructor(
    private readonly ctx: ToolContext,
    private readonly options: ArrowToolOptions | null = null,
  ) {
    this.id = options?.id ?? 'draw';
  }

  activate(): void {
    this.reset();
    if (this.options?.snapStart) {
      const mode = this.ctx.snapMode();
      if (mode !== 'off') void this.ctx.snap()?.prepare(mode);
    }
  }

  deactivate(): void {
    this.reset();
    this.ctx.arrows.setHover(null);
  }

  private reset(): void {
    this.state = 'idle';
    this.start = null;
    this.end = null;
    this.ctx.arrows.clearPreview();
  }

  pointerDown(e: PointerEvent, hit: HitProvider): boolean {
    if (e.button !== 0) return false;
    const h = hit();
    if (this.state === 'idle') {
      if (!h) return false; // background: let the camera rotate
      this.start = this.options?.snapStart ? pointVertex(this.ctx, h, e.shiftKey) : fromHit(h);
      this.end = null;
      this.state = 'pressing';
      this.downXY = { x: e.clientX, y: e.clientY };
      this.ctx.changed();
      return true;
    }
    if (this.state === 'awaitingEnd') {
      if (!h) return false;
      this.end = fromHit(h);
      this.state = 'secondPress';
      this.downXY = { x: e.clientX, y: e.clientY };
      this.showPreview();
      return true;
    }
    return true;
  }

  pointerMove(e: PointerEvent, hit: HitProvider): void {
    if (this.state === 'idle') {
      if (e.buttons === 0) {
        const h = hit();
        this.ctx.arrows.setHover(h?.point ?? null, h?.normal);
      }
      return;
    }
    const h = hit();
    if (this.state === 'pressing') {
      if (h) this.end = fromHit(h);
      if (Math.hypot(e.clientX - this.downXY.x, e.clientY - this.downXY.y) > DRAG_PX) {
        this.state = 'dragging';
        this.ctx.changed();
      }
    } else if (h && (this.state === 'dragging' || this.state === 'awaitingEnd' || this.state === 'secondPress')) {
      this.end = fromHit(h);
    }
    this.ctx.arrows.setHover(h?.point ?? null, h?.normal);
    if (this.state !== 'pressing') this.showPreview();
  }

  pointerUp(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (this.state === 'pressing') {
      this.state = 'awaitingEnd';
      this.end = null;
      this.ctx.changed();
      return;
    }
    if (this.state === 'dragging' || this.state === 'secondPress') this.finish();
  }

  private showPreview(): void {
    if (this.start && this.end) this.ctx.arrows.setPreview(this.start.p, this.end.p, this.start.n, this.end.n);
    else this.ctx.arrows.clearPreview();
  }

  private finish(): void {
    const s = this.start;
    const t = this.end;
    this.reset();
    this.ctx.changed();
    if (!s || !t) return;
    if (distance(s.p, t.p) < this.ctx.viewer.diagonal * MIN_LENGTH_FRACTION) {
      this.ctx.notify('toast.arrowTooShort', 'warn');
      return;
    }
    if (this.options) return this.options.onFinish(s, t);
    const arrow = addScarVector(this.ctx.store, { start: s.p, end: t.p, startNormal: s.n, endNormal: t.n });
    this.ctx.selection.set(arrow.id);
    // drawn by hand: it grows in from its tail
    this.ctx.arrows.grow(arrow.id);
  }

  cancel(): boolean {
    if (this.state === 'idle') return false;
    this.reset();
    this.ctx.changed();
    return true;
  }

  hintKey(): string {
    switch (this.state) {
      case 'pressing':
      case 'dragging':
        return 'hint.drawDragging';
      case 'awaitingEnd':
      case 'secondPress':
        return 'hint.drawAwaitEnd';
      default:
        return 'hint.draw';
    }
  }

  cursor(): string {
    return 'crosshair';
  }
}

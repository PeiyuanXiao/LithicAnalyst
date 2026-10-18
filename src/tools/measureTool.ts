import { addMeasurement } from '../core/actions';
import { MEASURE_POINTS } from '../core/measurements';
import type { MeasureType, Vec3 } from '../core/types';
import type { SurfaceHit } from '../render/viewer';
import type { HitProvider, Tool, ToolContext } from './tool';

const CLICK_PX = 4;
/** Passes of relaxPath for a distance along the surface: enough to straighten long stretches, not just the zig-zag. */
const GEODESIC_PASSES = 400;

interface Placed {
  p: Vec3;
  /** Mesh vertex (geodesic only: the path runs between vertices). */
  v: number;
}

/**
 * Take a manual measurement by clicking its points on the surface: two for a
 * distance or a distance along the surface, three for an angle (the vertex is
 * the second click). Dragging still turns the view; Backspace removes the
 * last point; Esc drops the measurement being taken.
 */
export class MeasureTool implements Tool {
  readonly id: string;
  private placed: Placed[] = [];
  private cursorPoint: Vec3 | null = null;
  private down: { x: number; y: number } | null = null;
  private busy = false;

  constructor(private readonly ctx: ToolContext, readonly type: MeasureType) {
    this.id = `measure-${type}`;
  }

  activate(): void {
    this.reset();
    if (this.type === 'geodesic') void this.ctx.snap()?.prepare('off');
  }

  deactivate(): void {
    this.reset();
    this.ctx.arrows.setHover(null);
  }

  private reset(): void {
    this.placed = [];
    this.cursorPoint = null;
    this.ctx.measures.setDraft([], null);
  }

  private showDraft(): void {
    this.ctx.measures.setDraft(
      this.placed.map((x) => x.p),
      this.placed.length ? this.cursorPoint : null,
    );
  }

  pointerDown(e: PointerEvent): boolean {
    this.down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    return false; // dragging keeps turning the view
  }

  pointerMove(e: PointerEvent, hit: HitProvider): void {
    if (e.buttons !== 0) {
      this.ctx.arrows.setHover(null);
      return;
    }
    const h = hit();
    this.ctx.arrows.setHover(h?.point ?? null, h?.normal);
    this.cursorPoint = h ? [h.point.x, h.point.y, h.point.z] : null;
    this.showDraft();
  }

  pointerUp(e: PointerEvent, hit: HitProvider): void {
    const d = this.down;
    this.down = null;
    if (e.button !== 0 || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_PX) return;
    void this.click(hit());
  }

  private async click(h: SurfaceHit | null): Promise<void> {
    if (!h || this.busy) return;
    this.busy = true;
    try {
      let placed: Placed = { p: [h.point.x, h.point.y, h.point.z], v: -1 };
      if (this.type === 'geodesic') {
        const snap = this.ctx.snap();
        if (!snap || !(await snap.prepare('off')) || snap !== this.ctx.snap()) return;
        const v = snap.vertexOfHit(h);
        placed = { p: snap.point(v), v };
      }
      if (this.placed.length === 0) this.ctx.selection.set(null);
      this.placed.push(placed);
      if (this.placed.length === MEASURE_POINTS[this.type]) this.finish();
      else this.showDraft();
      this.ctx.changed();
    } finally {
      this.busy = false;
    }
  }

  private finish(): void {
    const placed = this.placed;
    this.reset();
    let points = placed.map((x) => x.p);
    let path: Vec3[] | null = null;
    if (this.type === 'geodesic') {
      const snap = this.ctx.snap();
      const search = snap?.search(0);
      if (!snap || !search) return;
      search.start(placed[0].v, snap.cost('off'));
      if (!search.reach(placed[1].v)) {
        this.ctx.notify('toast.curveUnreachable', 'warn');
        return;
      }
      path = snap.hug(snap.refine(search.path(placed[1].v)!, 'off', GEODESIC_PASSES));
      points = [path[0], path[path.length - 1]];
    }
    const m = addMeasurement(this.ctx.store, { type: this.type, points, path });
    this.ctx.selection.set(m.id);
  }

  undoStep(): boolean {
    if (!this.placed.length) return false;
    this.placed.pop();
    this.showDraft();
    this.ctx.changed();
    return true;
  }

  cancel(): boolean {
    if (!this.placed.length) return false;
    this.reset();
    this.ctx.changed();
    return true;
  }

  /** Points placed so far (original coordinates). */
  draftPoints(): Vec3[] {
    return this.placed.map((x) => x.p);
  }

  hintKey(): string {
    return '';
  }

  cursor(): string {
    return 'crosshair';
  }
}

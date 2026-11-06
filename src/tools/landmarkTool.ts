import { moveLandmark } from '../core/actions';
import type { Landmark, Vec3 } from '../core/types';
import type { LandmarkLayer } from '../render/landmarkLayer';
import type { SurfaceHit } from '../render/viewer';
import { SNAP_PX } from './drawCurveTool';
import type { HitProvider, Tool, ToolContext } from './tool';

const CLICK_PX = 4;

/** Where a press on the surface puts a landmark: the point, or the ridge / valley vertex it snaps to (`point`: as a point does, not along the feature). */
export function landmarkTarget(ctx: ToolContext, h: SurfaceHit, exact: boolean, point: boolean): Vec3 {
  const at: Vec3 = [h.point.x, h.point.y, h.point.z];
  const snap = ctx.snap();
  const mode = exact ? 'off' : ctx.snapMode();
  if (!snap || mode === 'off') return at;
  if (!snap.ready(mode)) {
    void snap.prepare(mode);
    return at;
  }
  const v0 = snap.vertexOfHit(h);
  const radius = ctx.viewer.worldPerPixel(h.point) * SNAP_PX;
  const v = point ? snap.snapPoint(v0, radius, mode) : snap.snap(v0, radius, mode);
  return v === v0 ? at : snap.point(v);
}

/**
 * Fixed landmarks: click the surface to place one (snapped onto the nearest place of a
 * ridge or valley as the snap setting says; Shift places it exactly), drag one to
 * move it. Dragging elsewhere turns the view.
 */
export class LandmarkTool implements Tool {
  readonly id = 'landmark';
  private down: { x: number; y: number; shift: boolean } | null = null;
  private drag: { id: string; point: Vec3 | null } | null = null;

  constructor(
    private readonly ctx: ToolContext,
    private readonly layer: LandmarkLayer,
    private readonly onPlace: (point: Vec3) => void,
    /** Where a landmark of the flake's own may go (a platform end stays on the platform outline). */
    private readonly constrain: (l: Landmark, point: Vec3) => Vec3 = (_l, p) => p,
  ) {}

  activate(): void {
    const mode = this.ctx.snapMode();
    if (mode !== 'off') void this.ctx.snap()?.prepare(mode);
  }

  deactivate(): void {
    this.endDrag(false);
    this.down = null;
  }

  pointerDown(e: PointerEvent): boolean {
    if (e.button !== 0 || !this.ctx.editable()) return false;
    const near = this.layer.pickNearest(e.clientX, e.clientY);
    if (near) {
      // the point of percussion follows the technical axis
      if (this.ctx.store.landmark(near.id)?.code !== 'pop') this.drag = { id: near.id, point: null };
      this.ctx.selection.set(near.id);
      return true;
    }
    this.down = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
    return false;
  }

  pointerMove(e: PointerEvent, hit: HitProvider): void {
    if (!this.drag) return;
    const h = hit();
    if (!h) return;
    const l = this.ctx.store.landmark(this.drag.id);
    // a platform end goes on to the platform outline: from wherever the curve tool would take it
    this.drag.point = l ? this.constrain(l, landmarkTarget(this.ctx, h, e.shiftKey, l.code !== 'platform_end')) : null;
    this.layer.setPreview(this.drag.point);
  }

  pointerUp(e: PointerEvent, hit: HitProvider): void {
    if (this.drag) {
      this.endDrag(true);
      return;
    }
    const d = this.down;
    this.down = null;
    if (e.button !== 0 || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_PX) return;
    const h = hit();
    if (h) this.onPlace(landmarkTarget(this.ctx, h, e.shiftKey || d.shift, true));
  }

  private endDrag(commit: boolean): void {
    const d = this.drag;
    this.drag = null;
    this.layer.setPreview(null);
    if (commit && d?.point) moveLandmark(this.ctx.store, d.id, d.point);
  }

  cancel(): boolean {
    if (!this.drag) return false;
    this.endDrag(false);
    return true;
  }

  hintKey(): string {
    return '';
  }

  cursor(): string {
    return this.drag ? 'grabbing' : 'crosshair';
  }
}

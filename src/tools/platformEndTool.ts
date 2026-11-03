import { moveLandmark } from '../core/actions';
import type { Vec3 } from '../core/types';
import type { LandmarkLayer } from '../render/landmarkLayer';
import type { HitProvider, Tool, ToolContext } from './tool';

const CLICK_PX = 4;

/**
 * The platform's two ends: a click places one on the platform outline (where the outline is
 * nearest the click); a drag moves one along it. Dragging elsewhere turns the view.
 */
export class PlatformEndTool implements Tool {
  readonly id = 'platform-end';
  private down: { x: number; y: number } | null = null;
  private drag: { id: string; point: Vec3 | null } | null = null;

  constructor(
    private readonly ctx: ToolContext,
    private readonly layer: LandmarkLayer,
    /** The point of the platform outline nearest to a point; null without an outline. */
    private readonly onOutline: (point: Vec3) => Vec3 | null,
    private readonly onPlace: (point: Vec3) => void,
  ) {}

  activate(): void {}

  deactivate(): void {
    this.endDrag(false);
    this.down = null;
  }

  pointerDown(e: PointerEvent): boolean {
    if (e.button !== 0 || !this.ctx.editable()) return false;
    const near = this.layer.pickNearest(e.clientX, e.clientY);
    if (near && this.ctx.store.landmark(near.id)?.code === 'platform_end') {
      this.drag = { id: near.id, point: null };
      this.ctx.selection.set(near.id);
      return true;
    }
    this.down = { x: e.clientX, y: e.clientY };
    return false;
  }

  pointerMove(_e: PointerEvent, hit: HitProvider): void {
    if (!this.drag) return;
    const h = hit();
    const p = h ? this.onOutline([h.point.x, h.point.y, h.point.z]) : null;
    if (!p) return;
    this.drag.point = p;
    this.layer.setPreview(p);
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
    if (!h) return;
    const p = this.onOutline([h.point.x, h.point.y, h.point.z]);
    if (p) this.onPlace(p);
    else this.ctx.notify('toast.needOutline', 'warn');
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

import { moveEndpoint } from '../core/actions';
import type { Vec3 } from '../core/types';
import type { HitProvider, Tool, ToolContext } from './tool';

const CLICK_PX = 4;

/** Select scar vectors, drag their endpoints, double-click to set the rotation centre. */
export class SelectTool implements Tool {
  readonly id = 'select';
  private down: { x: number; y: number } | null = null;
  private drag: { id: string; which: 'start' | 'end'; point: Vec3; normal: Vec3 } | null = null;
  private overHandle: 'start' | 'end' | null = null;

  constructor(private readonly ctx: ToolContext) {}

  activate(): void {
    this.ctx.arrows.setHover(null);
  }

  deactivate(): void {
    this.endDrag(false);
    this.down = null;
    this.overHandle = null;
    this.ctx.arrows.highlightHandle(null);
  }

  pointerDown(e: PointerEvent): boolean {
    if (e.button !== 0) return false;
    const which = this.ctx.arrows.handleAt(e.clientX, e.clientY);
    const id = this.ctx.selection.id;
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
      const over = this.ctx.arrows.handleAt(e.clientX, e.clientY);
      if (over !== this.overHandle) {
        this.overHandle = over;
        this.ctx.arrows.highlightHandle(over);
        this.ctx.changed();
      }
    }
  }

  pointerUp(e: PointerEvent): void {
    if (this.drag) {
      this.endDrag(true);
      return;
    }
    if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) <= CLICK_PX && e.button === 0) {
      this.ctx.selection.set(this.ctx.arrows.pickAt(e.clientX, e.clientY));
    }
    this.down = null;
  }

  doubleClick(_e: MouseEvent, hit: HitProvider): void {
    const h = hit();
    if (h) this.ctx.viewer.setRotationCenter(h.point);
  }

  private endDrag(commit: boolean): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.ctx.arrows.setEndpointOverride(null);
    if (commit) moveEndpoint(this.ctx.store, d.id, d.which, d.point, d.normal);
    this.ctx.arrows.highlightHandle(null);
    this.ctx.changed();
  }

  cancel(): boolean {
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
    if (this.drag) return 'grabbing';
    return this.overHandle ? 'grab' : 'default';
  }
}

import type { Vec3 } from '../core/types';
import type { HitProvider, Tool } from './tool';

const CLICK_PX = 4;

/** A point on a curve whose edge angles are measured. */
export interface EdgePlace {
  curveId: string;
  point: Vec3;
}

export interface WorkingEdgeHost {
  /** The curve measured nearest a client position and the point on it; `curveId`: only on this one. */
  locate(x: number, y: number, curveId: string | null): EdgePlace | null;
  /** Show what is under the cursor, and the stretch from the first point to it. */
  preview(first: EdgePlace | null, over: EdgePlace | null): void;
  /** The two ends are set. */
  place(curveId: string, start: Vec3, end: Vec3): void;
}

/**
 * The working edge tool: a click on a curve whose edge angles are measured sets the start, a second click on the same curve the end;
 * both lie on the curve. Dragging turns the view as usual.
 */
export class WorkingEdgeTool implements Tool {
  readonly id = 'working-edge';
  private down: { x: number; y: number } | null = null;
  private first: EdgePlace | null = null;
  private over: EdgePlace | null = null;

  constructor(private readonly host: WorkingEdgeHost, private readonly changed: () => void) {}

  activate(): void {}

  deactivate(): void {
    this.reset();
    this.down = null;
  }

  private reset(): void {
    this.first = null;
    this.over = null;
    this.host.preview(null, null);
    this.changed();
  }

  pointerDown(e: PointerEvent, _hit: HitProvider): boolean {
    if (e.button === 0) this.down = { x: e.clientX, y: e.clientY };
    return false;
  }

  pointerMove(e: PointerEvent): void {
    if (e.buttons !== 0) return;
    const over = this.host.locate(e.clientX, e.clientY, this.first?.curveId ?? null);
    if (over?.curveId !== this.over?.curveId || over?.point !== this.over?.point) {
      this.over = over;
      this.host.preview(this.first, over);
      this.changed();
    }
  }

  pointerLeave(): void {
    if (!this.over) return;
    this.over = null;
    this.host.preview(this.first, null);
    this.changed();
  }

  clearHover(): void {
    this.pointerLeave();
  }

  pointerUp(e: PointerEvent): void {
    const d = this.down;
    this.down = null;
    if (e.button !== 0 || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_PX) return;
    const at = this.host.locate(e.clientX, e.clientY, this.first?.curveId ?? null);
    if (!at) return;
    if (!this.first) {
      this.first = at;
      this.host.preview(at, null);
      this.changed();
      return;
    }
    const { curveId, point } = this.first;
    this.reset();
    this.host.place(curveId, point, at.point);
  }

  cancel(): boolean {
    if (!this.first) return false;
    this.reset();
    return true;
  }

  undoStep(): boolean {
    return this.cancel();
  }

  /** The first point set (null: none). */
  pending(): Vec3 | null {
    return this.first?.point ?? null;
  }

  hintKey(): string {
    return '';
  }

  cursor(): string {
    return this.over ? 'crosshair' : 'default';
  }
}

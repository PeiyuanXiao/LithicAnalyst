import type { SurfaceHit } from '../render/viewer';
import type { HitProvider, Tool } from './tool';

const CLICK_PX = 4;

/** A tool that acts on clicks on the surface (dragging still turns the view). */
export class ClickTool implements Tool {
  private down: { x: number; y: number } | null = null;

  constructor(
    readonly id: string,
    private readonly onClick: (hit: SurfaceHit) => void,
  ) {}

  activate(): void {}

  deactivate(): void {
    this.down = null;
  }

  pointerDown(e: PointerEvent): boolean {
    this.down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    return false;
  }

  pointerMove(): void {}

  pointerUp(e: PointerEvent, hit: HitProvider): void {
    const d = this.down;
    this.down = null;
    if (e.button !== 0 || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_PX) return;
    const h = hit();
    if (h) this.onClick(h);
  }

  cancel(): boolean {
    return false;
  }

  hintKey(): string {
    return '';
  }

  cursor(): string {
    return 'pointer';
  }
}

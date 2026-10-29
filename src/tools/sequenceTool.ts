import type { HitProvider, Tool } from './tool';
import type { ScarPick } from './relationTool';

const CLICK_PX = 4;

/**
 * Removal sequences: a click on a scar (its arrow or its region) puts it into
 * the current sequence, or takes it out when it is already there (`onScar`).
 * Dragging still turns the view.
 */
export class SequenceTool implements Tool {
  readonly id = 'sequence';
  private down: { x: number; y: number } | null = null;

  constructor(
    private readonly scarAt: (clientX: number, clientY: number, hit: HitProvider) => ScarPick | null,
    private readonly onScar: (scarId: string) => void,
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
    const p = this.scarAt(e.clientX, e.clientY, hit);
    if (p) this.onScar(p.scarId);
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

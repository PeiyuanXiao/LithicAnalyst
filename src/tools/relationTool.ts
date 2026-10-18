import type { HitProvider, Tool, ToolContext } from './tool';

const CLICK_PX = 4;

/** A clicked scar, and what to select to show it (its arrow, or its region). */
export interface ScarPick {
  scarId: string;
  selectId: string;
}

/**
 * Record a relation: click one scar (its arrow or its region), then another;
 * `onPair` then asks how the two relate. Dragging still turns the view.
 */
export class RelationTool implements Tool {
  readonly id = 'relation';
  private down: { x: number; y: number } | null = null;
  private first: string | null = null;

  constructor(
    private readonly ctx: ToolContext,
    private readonly scarAt: (clientX: number, clientY: number, hit: HitProvider) => ScarPick | null,
    private readonly onPair: (a: string, b: string) => void,
  ) {}

  activate(): void {
    this.first = null;
  }

  deactivate(): void {
    this.first = null;
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
    if (!p) return;
    if (!this.first || this.first === p.scarId) {
      this.first = p.scarId;
      this.ctx.selection.set(p.selectId);
      this.ctx.changed();
      return;
    }
    const a = this.first;
    this.first = null;
    this.ctx.changed();
    this.onPair(a, p.scarId);
  }

  cancel(): boolean {
    if (!this.first) return false;
    this.first = null;
    this.ctx.selection.set(null);
    this.ctx.changed();
    return true;
  }

  /** The scar clicked first, waiting for the second (null when none). */
  pending(): string | null {
    return this.first;
  }

  hintKey(): string {
    return '';
  }

  cursor(): string {
    return 'pointer';
  }
}

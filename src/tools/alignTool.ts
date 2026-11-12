import type { Tool } from './tool';

/** What the tool asks of the vectors being aligned (client positions). */
export interface AlignHandles {
  /** The end within reach of this position (its number), or null. */
  at(x: number, y: number): number | null;
  /** The end under the pointer (null: none), to show it can be taken. */
  hover(end: number | null): void;
  /** The end in hand follows the pointer onto the model. */
  drag(end: number, x: number, y: number): void;
  /** Let go here: the end is placed where it lies on the model (no model under the pointer: put back). */
  drop(end: number, x: number, y: number): void;
}

/**
 * The tool of the "Align vectors" mode: a press near an end of a vector being imported takes it, and it follows the pointer on the
 * model until let go; anywhere else the view turns as usual.
 */
export class AlignTool implements Tool {
  readonly id = 'align';
  private held: number | null = null;
  private over: number | null = null;

  constructor(private readonly handles: AlignHandles, private readonly changed: () => void) {}

  activate(): void {}

  deactivate(): void {
    this.held = null;
    this.over = null;
  }

  pointerDown(e: PointerEvent): boolean {
    if (e.button !== 0) return false;
    const end = this.handles.at(e.clientX, e.clientY);
    if (end === null) return false;
    this.held = end;
    this.handles.hover(end);
    this.changed();
    return true;
  }

  pointerMove(e: PointerEvent): void {
    if (this.held !== null) {
      this.handles.drag(this.held, e.clientX, e.clientY);
      return;
    }
    if (e.buttons !== 0) return;
    const end = this.handles.at(e.clientX, e.clientY);
    if (end === this.over) return;
    this.over = end;
    this.handles.hover(end);
    this.changed();
  }

  pointerUp(e: PointerEvent): void {
    const end = this.held;
    if (end === null) return;
    this.held = null;
    this.handles.drop(end, e.clientX, e.clientY);
    this.changed();
  }

  pointerLeave(): void {
    if (this.held !== null || this.over === null) return;
    this.over = null;
    this.handles.hover(null);
    this.changed();
  }

  cancel(): boolean {
    return false;
  }

  hintKey(): string {
    return '';
  }

  cursor(): string {
    return this.held !== null ? 'grabbing' : this.over !== null ? 'grab' : '';
  }
}

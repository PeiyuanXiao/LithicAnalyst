import type { Tool } from './tool';

/**
 * The retouch mode's tool: a press near the edge moves the current station there, and it follows the pointer along the edge
 * while held. Anywhere else the view turns as usual.
 */
export class StationTool implements Tool {
  readonly id = 'station';
  private held = false;

  /** `place`: to the station nearest this client position; `following` while held. False: no station is near enough to take the press. */
  constructor(private readonly place: (x: number, y: number, following: boolean) => boolean) {}

  activate(): void {}

  deactivate(): void {
    this.held = false;
  }

  pointerDown(e: PointerEvent): boolean {
    if (e.button !== 0 || !this.place(e.clientX, e.clientY, false)) return false;
    this.held = true;
    return true;
  }

  pointerMove(e: PointerEvent): void {
    if (this.held) this.place(e.clientX, e.clientY, true);
  }

  pointerUp(): void {
    this.held = false;
  }

  cancel(): boolean {
    return false;
  }

  hintKey(): string {
    return '';
  }

  cursor(): string {
    return this.held ? 'grabbing' : 'pointer';
  }
}

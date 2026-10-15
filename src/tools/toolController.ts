import type { SurfaceHit } from '../render/viewer';
import type { HitProvider, Tool, ToolContext } from './tool';

/**
 * Routes viewport pointer events to the active tool. Listeners sit on the
 * viewport container in the capture phase, so a tool can claim a press before
 * the camera controls (attached to the canvas) see it.
 */
export class ToolController {
  private tools = new Map<string, Tool>();
  private active: Tool | null = null;
  private spaceHeld = false;
  private lightHeld = false;
  private activePointer: number | null = null;
  onHover: (hit: SurfaceHit | null) => void = () => {};
  onLightAdjust: (azimuthDeg: number, elevationDeg: number) => void = () => {};

  constructor(private readonly ctx: ToolContext, private readonly container: HTMLElement) {
    const opts = { capture: true } as const;
    container.addEventListener('pointerdown', (e) => this.down(e), opts);
    container.addEventListener('pointermove', (e) => this.move(e), opts);
    container.addEventListener('pointerup', (e) => this.up(e), opts);
    container.addEventListener('pointercancel', (e) => this.up(e), opts);
    container.addEventListener('dblclick', (e) => this.dbl(e), opts);
    container.addEventListener('pointerleave', () => {
      this.onHover(null);
      if (!this.activePointer) this.ctx.arrows.setHover(null);
    });
  }

  register(tool: Tool): void {
    this.tools.set(tool.id, tool);
  }

  get activeId(): string | null {
    return this.active?.id ?? null;
  }

  get activeTool(): Tool | null {
    return this.active;
  }

  setActive(id: string): void {
    const next = this.tools.get(id);
    if (!next || next === this.active) return;
    this.active?.deactivate();
    this.active = next;
    next.activate();
    this.ctx.viewer.setNavMode(id === 'draw' ? 'draw' : 'select');
    this.ctx.changed();
  }

  setSpaceHeld(on: boolean): void {
    if (this.spaceHeld === on) return;
    this.spaceHeld = on;
    this.ctx.viewer.setNavOverride(on);
    this.ctx.changed();
  }

  setLightHeld(on: boolean): void {
    this.lightHeld = on;
    this.ctx.changed();
  }

  get navigating(): boolean {
    return this.spaceHeld;
  }

  get adjustingLight(): boolean {
    return this.lightHeld;
  }

  cancel(): boolean {
    return this.active?.cancel() ?? false;
  }

  private provider(e: MouseEvent): HitProvider {
    let done = false;
    let value: SurfaceHit | null = null;
    return () => {
      if (!done) {
        value = this.ctx.viewer.pickSurface(e.clientX, e.clientY);
        done = true;
      }
      return value;
    };
  }

  private isOnLabel(e: Event): boolean {
    const t = e.target as Element | null;
    return !!t?.closest?.('.arrow-label, .viewport-ui');
  }

  private down(e: PointerEvent): void {
    if (!this.active || this.isOnLabel(e)) return;
    if (this.spaceHeld) return; // navigation override
    const consumed = this.active.pointerDown(e, this.provider(e));
    if (consumed) {
      e.stopPropagation();
      e.preventDefault();
      // preventDefault keeps focus where it was; release text fields so shortcuts work again
      const focused = document.activeElement as HTMLElement | null;
      if (focused && focused !== document.body) focused.blur?.();
      this.activePointer = e.pointerId;
      try {
        this.ctx.viewer.renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }

  private move(e: PointerEvent): void {
    if (!this.active) return;
    if (this.isOnLabel(e) && this.activePointer === null) return;
    const hit = this.provider(e);
    if (this.lightHeld) {
      const r = this.container.getBoundingClientRect();
      const half = 0.5 * Math.min(r.width, r.height);
      const dx = (e.clientX - (r.left + r.width / 2)) / half;
      const dy = -(e.clientY - (r.top + r.height / 2)) / half;
      const az = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      const el = 90 - 85 * Math.min(1, Math.hypot(dx, dy));
      this.onLightAdjust(az, el);
      return;
    }
    this.active.pointerMove(e, hit);
    if (e.buttons === 0 || this.activePointer !== null) this.onHover(hit());
  }

  private up(e: PointerEvent): void {
    if (!this.active) return;
    if (this.activePointer === e.pointerId) {
      this.activePointer = null;
      e.stopPropagation();
    }
    this.active.pointerUp(e, this.provider(e));
  }

  private dbl(e: MouseEvent): void {
    if (!this.active || this.isOnLabel(e)) return;
    this.active.doubleClick?.(e, this.provider(e));
  }
}

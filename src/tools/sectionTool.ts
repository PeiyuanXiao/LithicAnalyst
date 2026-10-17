import { addSection } from '../core/actions';
import type { Vec3 } from '../core/types';
import type { HitProvider, Tool, ToolContext } from './tool';

const MIN_PX = 8;

/**
 * Draw a section: press, drag a line across the model, release. The section
 * is the plane through that line and the view direction.
 */
export class SectionTool implements Tool {
  readonly id = 'section';
  private start: { x: number; y: number } | null = null;
  private readonly svg: SVGSVGElement;
  private readonly line: SVGLineElement;

  constructor(
    private readonly ctx: ToolContext,
    container: HTMLElement,
    /** Centre of the model (original coordinates), to place the plane's reference point. */
    private readonly centre: () => Vec3 | null,
  ) {
    const ns = 'http://www.w3.org/2000/svg';
    this.svg = document.createElementNS(ns, 'svg');
    this.svg.setAttribute('class', 'viewport-ui vp-section-line');
    this.line = document.createElementNS(ns, 'line');
    this.svg.append(this.line);
    this.svg.style.display = 'none';
    container.append(this.svg);
  }

  activate(): void {
    this.start = null;
  }

  deactivate(): void {
    this.start = null;
    this.svg.style.display = 'none';
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const r = (this.svg.parentElement as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  pointerDown(e: PointerEvent): boolean {
    if (e.button !== 0) return false;
    this.start = { x: e.clientX, y: e.clientY };
    const p = this.local(e);
    for (const [k, v] of [['x1', p.x], ['y1', p.y], ['x2', p.x], ['y2', p.y]] as const) this.line.setAttribute(k, String(v));
    this.svg.style.display = '';
    return true;
  }

  pointerMove(e: PointerEvent, _hit: HitProvider): void {
    if (!this.start) return;
    const p = this.local(e);
    this.line.setAttribute('x2', String(p.x));
    this.line.setAttribute('y2', String(p.y));
  }

  pointerUp(e: PointerEvent): void {
    const s = this.start;
    this.start = null;
    this.svg.style.display = 'none';
    if (!s || e.button !== 0 || Math.hypot(e.clientX - s.x, e.clientY - s.y) < MIN_PX) return;
    const v = this.ctx.viewer;
    const r0 = v.setRayFromClient(s.x, s.y).ray.clone();
    const r1 = v.setRayFromClient(e.clientX, e.clientY).ray.clone();
    // the plane through the eye and both rays: its points project onto the drawn line
    const across = r1.direction.clone().sub(r0.direction).normalize();
    const forward = r0.direction.clone().add(r1.direction).normalize();
    const normal = across.clone().cross(forward).normalize();
    if (!(normal.lengthSq() > 0.5)) return;
    const c = this.centre();
    const ref = c ? { x: c[0], y: c[1], z: c[2] } : r0.origin;
    // reference point: the model's centre moved onto the plane
    const d = normal.x * (ref.x - r0.origin.x) + normal.y * (ref.y - r0.origin.y) + normal.z * (ref.z - r0.origin.z);
    const point: Vec3 = [ref.x - d * normal.x, ref.y - d * normal.y, ref.z - d * normal.z];
    const sec = addSection(this.ctx.store, { point, normal: [normal.x, normal.y, normal.z], across: [across.x, across.y, across.z] });
    this.ctx.selection.set(sec.id);
  }

  cancel(): boolean {
    if (!this.start) return false;
    this.start = null;
    this.svg.style.display = 'none';
    return true;
  }

  hintKey(): string {
    return '';
  }

  cursor(): string {
    return 'crosshair';
  }
}

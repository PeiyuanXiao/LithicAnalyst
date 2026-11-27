import { BSA_LEVEL_RANGE_MM, BSA_LEVEL_STEP_MM, bulbWindow, onPlane, VI_WIDTHS_MM, type BulbPlane } from '../compute/bulb';
import { divergingColor } from '../compute/colormap';
import type { BulbConstruction } from '../compute/flake';
import { fmtNum, fmtQuantity, quantityUnit } from '../core/format';
import type { Vec3 } from '../core/types';
import { scaleBarLength } from '../render/figure';
import { numRow } from './controls';
import { clear, h } from './dom';
import { t } from './i18n';

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** The drawing's room (pixels), its margin, and how far round the bulb and P it reaches: a share of their extent each side, at least so many mm across. */
const SIZE = 300;
const MARGIN = 10;
const HANDLE_PX = 6;

/** What the bulb page shows: the bulb as measured, the lines of equal height over its window (each level's segments, by twos), the range their colours go to, the readings. */
export interface BulbPageContent {
  bulb: BulbConstruction | null;
  /** Why there is nothing to draw (null: there is). */
  reason: string | null;
  contours: Array<{ level: number; segments: Vec3[] }>;
  /** The colours' range (±) and the level of the outline, coordinate units. */
  range: number;
  levelUnits: number;
  /** The level in mm, as set. */
  levelMm: number;
  /** Millimetres per unit (the window is at least 3 mm across). */
  mm: number;
  unit: string;
  bsa: number | null;
  vi: Array<number | null>;
}

/** Where an end was let go: on the outline (its point on the surface) or, with Shift, anywhere over the plane (u, v from P on it). */
export interface BulbEndDrop {
  index: 0 | 1;
  u: number;
  v: number;
  onOutline: Vec3 | null;
}

const css = (c: [number, number, number]) => `rgb(${c.map((x) => Math.round(x * 255)).join(',')})`;

/**
 * The bulb seen square on the ventral reference plane (P at the origin, the technological axis up): lines of equal height coloured by
 * height, the level's line thicker, P, the two ends and the lines to them with the angle, the bulb's top, the three strips of the
 * vertical interval, a scale bar. The ends can be dragged: onto the outline, or with Shift anywhere.
 */
export class BulbPage {
  readonly el: HTMLElement;
  private readonly drawing: SVGSVGElement;
  private readonly level: HTMLInputElement;
  private readonly reset: HTMLButtonElement;
  private readonly readings: HTMLElement;
  private readonly reason: HTMLElement;
  private content: BulbPageContent | null = null;
  /** From the plane (u, v from P) to the drawing and back. */
  private view: { s: number; u0: number; v1: number } | null = null;
  private drag: { index: 0 | 1; handle: SVGElement; line: SVGElement } | null = null;
  onLevel: (mm: number) => void = () => {};
  onEnds: (drop: BulbEndDrop) => void = () => {};
  onReset: () => void = () => {};

  constructor() {
    this.drawing = svg('svg', { id: 'bulb-drawing', class: 'profile-svg bulb-drawing', role: 'img', 'aria-label': t('profile.page.bulb'), width: SIZE, height: SIZE, viewBox: `0 0 ${SIZE} ${SIZE}` }) as SVGSVGElement;
    this.level = h('input', { id: 'bulb-level', class: 'ctl-input mono', type: 'number', min: BSA_LEVEL_RANGE_MM[0], max: BSA_LEVEL_RANGE_MM[1], step: BSA_LEVEL_STEP_MM, 'aria-label': t('bulb.level') }) as HTMLInputElement;
    this.level.addEventListener('change', () => {
      const v = Number(this.level.value);
      if (this.level.value.trim() !== '' && Number.isFinite(v)) this.onLevel(v);
    });
    this.reset = h('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'bulb-reset', hidden: true, onclick: () => this.onReset() }, t('bulb.reset')) as HTMLButtonElement;
    this.readings = h('dl', { class: 'num-grid profile-readings', id: 'bulb-readings' });
    this.reason = h('span', { class: 'pill pill-warn', id: 'bulb-reason', hidden: true });
    const controls = h('div', { class: 'bulb-controls' }, h('label', { class: 'ctl-label', for: 'bulb-level' }, t('bulb.level')), this.level, h('span', { class: 'mono' }, 'mm'), this.reset);
    this.el = h('div', { class: 'profile-content bulb-page', id: 'bulb-page' }, this.reason, h('div', { class: 'profile-drawings' }, this.drawing), controls, this.readings);
    this.drawing.addEventListener('pointermove', (e) => this.moveDrag(e));
    this.drawing.addEventListener('pointerup', (e) => this.endDrag(e));
    this.drawing.addEventListener('pointercancel', () => this.cancelDrag());
  }

  set(c: BulbPageContent | null): void {
    if (this.drag) return;
    this.content = c;
    this.draw();
  }

  /** The plane's (u, v) from P, of a point. */
  private uv(p: Vec3): [number, number] {
    const b = this.content!.bulb!;
    const q = onPlane(b.plane, p);
    const d: Vec3 = [q[0] - b.P0[0], q[1] - b.P0[1], q[2] - b.P0[2]];
    const pl: BulbPlane = b.plane;
    return [d[0] * pl.x[0] + d[1] * pl.x[1] + d[2] * pl.x[2], d[0] * pl.y[0] + d[1] * pl.y[1] + d[2] * pl.y[2]];
  }

  private px(u: number, v: number): [number, number] {
    const w = this.view!;
    return [MARGIN + (u - w.u0) * w.s, MARGIN + (w.v1 - v) * w.s];
  }

  private fromPx(x: number, y: number): [number, number] {
    const w = this.view!;
    return [w.u0 + (x - MARGIN) / w.s, w.v1 - (y - MARGIN) / w.s];
  }

  private draw(): void {
    const s = this.drawing;
    clear(s);
    clear(this.readings);
    const c = this.content;
    this.reason.hidden = !c?.reason;
    this.reason.textContent = c?.reason ?? '';
    const shown = !!c?.bulb;
    s.style.display = shown ? '' : 'none';
    (this.level.parentElement as HTMLElement).hidden = !c || (!!c.reason && !c.bulb);
    if (document.activeElement !== this.level && c) this.level.value = fmtNum(c.levelMm, 2);
    this.reset.hidden = !c?.bulb?.moved;
    if (!c) return;
    const u = quantityUnit('length', c.unit);
    this.readings.append(
      numRow(t('flake.bsa'), fmtQuantity('angle', c.bsa), '°', 'bulb-bsa'),
      ...VI_WIDTHS_MM.map((w, i) => numRow(`VI ${fmtNum(w, 1)} mm`, fmtQuantity('length', c.vi[i]), u, `bulb-vi-${i}`)),
    );
    if (!shown) return;
    const b = c.bulb!;
    // the window: the bulb and P, a margin round them, at least 3 mm across
    const win = bulbWindow(b.extent ?? { u0: 0, u1: 0, v0: 0, v1: 0 }, c.mm);
    const side = win.u1 - win.u0;
    this.view = { s: (SIZE - 2 * MARGIN) / side, u0: win.u0, v1: win.v1 };
    // where the plane was fitted: within R of P (beyond the window, cut off by it)
    const [px0, py0] = this.px(0, 0);
    s.append(svg('circle', { cx: px0, cy: py0, r: b.radius * this.view.s, class: 'bulb-reference', id: 'bulb-reference' }));
    // the lines of equal height, coloured by height; the level's thicker
    for (const l of c.contours) {
      if (!l.segments.length) continue;
      let d = '';
      for (let i = 0; i + 1 < l.segments.length; i += 2) {
        const [x0, y0] = this.px(...this.uv(l.segments[i])), [x1, y1] = this.px(...this.uv(l.segments[i + 1]));
        d += `M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`;
      }
      const isLevel = Math.abs(l.level - c.levelUnits) < 1e-9;
      s.append(svg('path', { d, class: `bulb-contour${isLevel ? ' is-level' : ''}`, style: `stroke:${css(divergingColor(l.level / (c.range || 1)))}`, 'data-level': l.level }));
    }
    // the strips of the vertical interval
    for (const strip of b.vi ?? []) {
      const pts = strip.corners.map((p) => this.px(...this.uv(p)).map((x) => x.toFixed(1)).join(',')).join(' ');
      s.append(svg('polygon', { points: pts, class: 'bulb-strip', 'data-width': strip.width }));
    }
    const P = this.px(0, 0);
    // the lines to the ends, and the angle
    if (b.ends) {
      const ends = b.ends.map((p) => this.px(...this.uv(p)));
      const lines = ends.map((q, i) => {
        const line = svg('line', { x1: P[0], y1: P[1], x2: q[0], y2: q[1], class: 'bulb-line', id: `bulb-line-${i}` });
        s.append(line);
        return line;
      });
      const a0 = Math.atan2(ends[0][1] - P[1], ends[0][0] - P[0]), a1 = Math.atan2(ends[1][1] - P[1], ends[1][0] - P[0]);
      let sweep = a1 - a0;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      const r = 0.3 * Math.min(Math.hypot(ends[0][0] - P[0], ends[0][1] - P[1]), Math.hypot(ends[1][0] - P[0], ends[1][1] - P[1]));
      const arcEnd = [P[0] + r * Math.cos(a0 + sweep), P[1] + r * Math.sin(a0 + sweep)];
      s.append(svg('path', { d: `M${P[0] + r * Math.cos(a0)} ${P[1] + r * Math.sin(a0)}A${r} ${r} 0 0 ${sweep > 0 ? 1 : 0} ${arcEnd[0]} ${arcEnd[1]}`, class: 'bulb-arc', id: 'bulb-arc' }));
      ends.forEach((q, i) => {
        const handle = svg('circle', { cx: q[0], cy: q[1], r: HANDLE_PX, class: 'bulb-end', id: `bulb-end-${i}` });
        handle.addEventListener('pointerdown', (ev) => this.startDrag(ev as PointerEvent, i as 0 | 1, handle, lines[i]));
        s.append(handle);
      });
    }
    if (b.apex) {
      const q = this.px(...this.uv(b.apex));
      s.append(svg('circle', { cx: q[0], cy: q[1], r: 3.5, class: 'bulb-apex', id: 'bulb-apex' }));
    }
    s.append(svg('circle', { cx: P[0], cy: P[1], r: 3.5, class: 'profile-point', id: 'bulb-p' }));
    const label = svg('text', { x: P[0] + 6, y: P[1] + 12, class: 'profile-label' });
    label.textContent = 'P';
    s.append(label);
    // the scale bar, at the foot on the left
    const len = scaleBarLength(side).length;
    if (len > 0) {
      const bar = len * this.view.s;
      s.append(svg('line', { x1: MARGIN, x2: MARGIN + bar, y1: SIZE - MARGIN, y2: SIZE - MARGIN, class: 'profile-scale', id: 'bulb-scale' }));
      const text = svg('text', { x: MARGIN, y: SIZE - MARGIN - 4, class: 'profile-label', id: 'bulb-scale-text' });
      text.textContent = `${fmtNum(len, len < 1 ? 2 : 0)}${c.unit ? ` ${c.unit}` : ''}`;
      s.append(text);
    }
  }

  private startDrag(e: PointerEvent, index: 0 | 1, handle: SVGElement, line: SVGElement): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.drawing.setPointerCapture(e.pointerId);
    this.drag = { index, handle, line };
  }

  /** The pointer on the drawing: in the drawing's pixels. */
  private at(e: PointerEvent): [number, number] {
    const r = this.drawing.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * SIZE, ((e.clientY - r.top) / r.height) * SIZE];
  }

  /** The point of the outline nearest (x, y) on the drawing: its pixels and its point on the surface (null: no outline). */
  private snap(x: number, y: number): { at: [number, number]; point: Vec3 } | null {
    const b = this.content?.bulb;
    if (!b) return null;
    let best: { at: [number, number]; point: Vec3; d: number } | null = null;
    for (const c of b.contour) {
      const n = c.points.length;
      for (let i = 0; i < (c.closed ? n : n - 1); i++) {
        const A = c.points[i], B = c.points[(i + 1) % n];
        const a = this.px(...this.uv(A)), q = this.px(...this.uv(B));
        const dx = q[0] - a[0], dy = q[1] - a[1];
        const l2 = dx * dx + dy * dy;
        const f = l2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
        const p: [number, number] = [a[0] + f * dx, a[1] + f * dy];
        const d = Math.hypot(x - p[0], y - p[1]);
        if (!best || d < best.d) best = { at: p, point: [A[0] + f * (B[0] - A[0]), A[1] + f * (B[1] - A[1]), A[2] + f * (B[2] - A[2])], d };
      }
    }
    return best;
  }

  private moveDrag(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    let [x, y] = this.at(e);
    if (!e.shiftKey) {
      const s = this.snap(x, y);
      if (s) [x, y] = s.at;
    }
    d.handle.setAttribute('cx', String(x));
    d.handle.setAttribute('cy', String(y));
    d.line.setAttribute('x2', String(x));
    d.line.setAttribute('y2', String(y));
  }

  private endDrag(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const [x, y] = this.at(e);
    const s = e.shiftKey ? null : this.snap(x, y);
    const [px, py] = s ? s.at : [x, y];
    const [u, v] = this.fromPx(px, py);
    this.onEnds({ index: d.index, u, v, onOutline: s ? s.point : null });
    this.draw();
  }

  private cancelDrag(): void {
    this.drag = null;
    this.draw();
  }
}

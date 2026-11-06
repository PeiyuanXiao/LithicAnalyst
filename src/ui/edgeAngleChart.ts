import type { SharpSegment } from '../compute/sharpEdge';
import { fmtNum, fmtQuantity, quantityUnit } from '../core/format';
import { clear, h } from './dom';
import { t } from './i18n';
import { tips } from './tooltip';

const SVG = 'http://www.w3.org/2000/svg';

function svg(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

const WIDTH = 320;
const HEIGHT = 170;
const LEFT = 34;
const RIGHT = 10;
const TOP = 8;
const BOTTOM = 20;
/** The working edges' strip, over the axis. */
const STRIP = 11;

/** Round steps for the axis of angles. */
const STEPS = [1, 2, 5, 10, 20, 30, 45];

/** One line: its value at each station (null breaks it). `key`: in the legend, once for the lines that share it. */
export interface ChartSeries {
  id: string;
  key: string;
  label: string;
  /** A CSS colour (the same in the legend and the plot). */
  color: string;
  dash?: string;
  /** The same series on the edge's other side. */
  faint?: boolean;
  values: ReadonlyArray<number | null>;
}

export interface ChartInput {
  positions: readonly number[];
  length: number;
  unit: string;
  series: readonly ChartSeries[];
  /** The line of the threshold, which can be dragged; and the stretches at or under it. */
  threshold: { value: number; color: string; onSet: (value: number) => void } | null;
  bands: readonly SharpSegment[];
  /** The working edges along the curve: a pale strip over the axis, with its label. */
  edges?: ReadonlyArray<{ label: string; from: number; to: number; color: string }>;
  /** Only this stretch of the curve, which may run on past its start. */
  view?: { from: number; to: number } | null;
}

/**
 * Edge angle along a curve: position across, one line for each series. The lines break where a station has
 * no value. Hovering shows every line's value at the nearest station.
 */
export class EdgeAngleChart {
  readonly el: HTMLElement;
  private readonly legend: HTMLElement;
  private readonly plot: SVGSVGElement;
  private cross: SVGElement | null = null;
  private dots: SVGElement[] = [];
  private current: (ChartInput & { x: (p: number) => number; y: (a: number) => number; angleAt: (py: number) => number; order: number[]; shows: (p: number) => boolean }) | null = null;
  private dragging = false;
  private cursorAt: number | null = null;
  private cursorEl: SVGElement | null = null;
  /** A press on the plot: the position of the station nearest it. */
  onPick: ((position: number) => void) | null = null;

  /** `prefix`: of its ids, to tell it from another chart on the page. */
  constructor(private readonly prefix = 'edge') {
    this.legend = h('div', { class: 'edge-chart-legend', id: `${prefix}-chart-legend` });
    this.plot = svg('svg', { id: `${prefix}-chart`, class: 'edge-chart-plot', viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img', 'aria-label': t('sec.edgeAngle') }) as SVGSVGElement;
    this.el = h('div', { class: 'edge-chart', id: `${prefix}-angle-chart` }, this.legend, this.plot);
    this.plot.addEventListener('pointermove', (e) => this.hover(e));
    this.plot.addEventListener('pointerleave', () => this.leave());
    this.plot.addEventListener('pointerdown', (e) => {
      const c = this.current;
      if (!c || !this.onPick || e.button !== 0) return;
      this.onPick(c.positions[this.nearest(e)]);
    });
  }

  /** The vertical line of a position along the curve (null: none). */
  setCursor(position: number | null): void {
    this.cursorAt = position;
    this.placeCursor();
  }

  private placeCursor(): void {
    const c = this.current, p = this.cursorAt;
    if (!c || p === null) {
      this.cursorEl?.remove();
      this.cursorEl = null;
      return;
    }
    if (!this.cursorEl) {
      this.cursorEl = svg('line', { y1: TOP, y2: HEIGHT - BOTTOM, id: `${this.prefix}-chart-cursor`, class: 'edge-chart-cursor' });
      this.plot.append(this.cursorEl);
    }
    this.cursorEl.setAttribute('x1', String(c.x(p)));
    this.cursorEl.setAttribute('x2', String(c.x(p)));
    this.cursorEl.setAttribute('data-position', String(p));
    this.cursorEl.setAttribute('visibility', c.shows(p) ? 'visible' : 'hidden');
  }

  /** The station nearest the pointer. */
  private nearest(e: PointerEvent): number {
    const c = this.current!;
    const r = this.plot.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * WIDTH;
    let k = c.order[0];
    for (const i of c.order) if (Math.abs(c.x(c.positions[i]) - px) < Math.abs(c.x(c.positions[k]) - px)) k = i;
    return k;
  }

  set(input: ChartInput | null): void {
    // the line under the pointer stays until it is let go
    if (this.dragging) return;
    clear(this.plot);
    clear(this.legend);
    this.cross = null;
    this.cursorEl = null;
    this.dots = [];
    this.current = null;
    this.el.hidden = !input?.positions.length;
    this.plot.removeAttribute('data-stations');
    if (!input?.positions.length) return;
    // the stretch shown: along it from where it begins, all of the curve when none is asked for
    const whole = input.length;
    const view = input.view ?? null;
    const along = (p: number) => (view ? (((p - view.from) % whole) + whole) % whole : p);
    const span = view ? (view.to >= view.from ? view.to - view.from : whole - view.from + view.to) : input.positions[input.positions.length - 1] || 1;
    const shows = (p: number) => along(p) <= span + 1e-9;
    const order = input.positions.flatMap((p, k) => (shows(p) ? [k] : [])).sort((a, b) => along(input.positions[a]) - along(input.positions[b]));
    if (!order.length) return;
    this.plot.setAttribute('data-stations', String(order.length));
    const values = input.series.flatMap((s) => order.flatMap((k) => (s.values[k] === null || s.values[k] === undefined ? [] : [s.values[k] as number])));
    if (input.threshold) values.push(input.threshold.value);
    if (!values.length) return;
    const lo = Math.min(...values), hi = Math.max(...values);
    const want = Math.max(hi - lo, 1) / 4;
    const step = STEPS.find((s) => s >= want) ?? 60;
    const y0 = Math.floor(lo / step) * step, y1 = Math.max(Math.ceil(hi / step) * step, y0 + step);
    const length = span;
    const atU = (u: number) => LEFT + (u / length) * (WIDTH - LEFT - RIGHT);
    const x = (p: number) => atU(along(p));
    const y = (a: number) => HEIGHT - BOTTOM - ((a - y0) / (y1 - y0)) * (HEIGHT - BOTTOM - TOP);
    const angleAt = (py: number) => y0 + ((HEIGHT - BOTTOM - py) / (HEIGHT - BOTTOM - TOP)) * (y1 - y0);
    /** A stretch from `a` to `b` along the curve, as what of it is shown: from where to where along the axis. */
    const onAxis = (a: number, b: number): Array<[number, number]> => {
      if (!view) return a <= b ? [[a, b]] : [[a, length], [0, b]];
      const u = along(a), long = b >= a ? b - a : whole - a + b;
      return ([[u, u + long], [u - whole, u + long - whole]] as Array<[number, number]>).flatMap(([p, q]): Array<[number, number]> => (Math.min(q, span) > Math.max(p, 0) ? [[Math.max(p, 0), Math.min(q, span)]] : []));
    };
    // the sharp stretches behind everything; one that goes on past the end comes back at the start
    for (const b of input.bands) {
      for (const [from, to] of onAxis(b.start, b.end)) {
        this.plot.append(svg('rect', { x: atU(from), y: TOP, width: Math.max(1, atU(to) - atU(from)), height: HEIGHT - BOTTOM - TOP, class: 'edge-chart-band' }));
      }
    }
    // the working edges: a pale strip along the axis, each with its label on the longer of its parts
    for (const e of input.edges ?? []) {
      const parts = onAxis(e.from, e.to);
      for (const [from, to] of parts) this.plot.append(svg('rect', { x: atU(from), y: HEIGHT - BOTTOM - STRIP, width: Math.max(1, atU(to) - atU(from) - 1), height: STRIP, class: 'edge-chart-edge', style: `fill:${e.color}`, 'data-edge': e.label }));
      if (!parts.length) continue;
      const main = parts.reduce((m, q) => (q[1] - q[0] > m[1] - m[0] ? q : m));
      const label = svg('text', { x: (atU(main[0]) + atU(main[1])) / 2, y: HEIGHT - BOTTOM - 3, id: `${this.prefix}-chart-edge-${e.label}`, class: 'edge-chart-edge-label', 'text-anchor': 'middle' });
      label.textContent = e.label;
      this.plot.append(label);
    }
    // recessive grid, one axis of angles
    for (let a = y0; a <= y1 + 1e-9; a += step) {
      this.plot.append(svg('line', { x1: LEFT, x2: WIDTH - RIGHT, y1: y(a), y2: y(a), class: 'edge-chart-grid' }));
      const label = svg('text', { x: LEFT - 5, y: y(a) + 3.5, class: 'edge-chart-tick', 'text-anchor': 'end' });
      label.textContent = `${fmtNum(a, 0)}°`;
      this.plot.append(label);
    }
    const u = quantityUnit('length', input.unit);
    for (const [p, at, anchor] of [[view?.from ?? 0, 0, 'start'], [view?.to ?? length, length, 'end']] as const) {
      const label = svg('text', { x: atU(at), y: HEIGHT - 6, class: 'edge-chart-tick', 'text-anchor': anchor });
      label.textContent = `${fmtNum(p, 0)}${at && u ? ` ${u}` : ''}`;
      this.plot.append(label);
    }
    const keys = new Set<string>();
    for (const s of input.series) {
      let path = '';
      let pen = false;
      for (const k of order) {
        const a = s.values[k];
        if (a === null) {
          pen = false;
          continue;
        }
        path += `${pen ? 'L' : 'M'}${x(input.positions[k]).toFixed(1)} ${y(a).toFixed(1)}`;
        pen = true;
      }
      this.plot.append(svg('path', { d: path, class: `edge-chart-line${s.faint ? ' is-faint' : ''}`, 'data-series': s.id, style: `stroke:${s.color}${s.dash ? `;stroke-dasharray:${s.dash}` : ''}` }));
      if (keys.has(s.key)) continue;
      keys.add(s.key);
      this.legend.append(h('span', { class: 'edge-chart-key' }, h('span', { class: 'edge-chart-swatch', style: `background:${s.color}` }), s.key));
    }
    if (input.threshold) this.thresholdLine(input.threshold, y, angleAt);
    this.cross = svg('line', { x1: 0, x2: 0, y1: TOP, y2: HEIGHT - BOTTOM, class: 'edge-chart-cross' });
    this.cross.setAttribute('visibility', 'hidden');
    this.plot.append(this.cross);
    this.dots = input.series.map((s) => {
      const dot = svg('circle', { r: 4, class: 'edge-chart-dot', visibility: 'hidden', style: `fill:${s.color}` });
      this.plot.append(dot);
      return dot;
    });
    this.current = { ...input, x, y, angleAt, order, shows };
    this.placeCursor();
  }

  /** The threshold: a dashed line in the colour of its series, with a wider line to take hold of. */
  private thresholdLine(th: NonNullable<ChartInput['threshold']>, y: (a: number) => number, angleAt: (py: number) => number): void {
    const line = svg('line', { x1: LEFT, x2: WIDTH - RIGHT, y1: y(th.value), y2: y(th.value), id: 'edge-chart-threshold', class: 'edge-chart-threshold', style: `stroke:${th.color}` });
    const grip = svg('line', { x1: LEFT, x2: WIDTH - RIGHT, y1: y(th.value), y2: y(th.value), id: 'edge-chart-threshold-grip', class: 'edge-chart-threshold-grip' });
    this.plot.append(line, grip);
    const place = (py: number) => {
      const yy = Math.max(TOP, Math.min(HEIGHT - BOTTOM, py));
      for (const l of [line, grip]) {
        l.setAttribute('y1', String(yy));
        l.setAttribute('y2', String(yy));
      }
      return yy;
    };
    const plotY = (e: PointerEvent) => {
      const r = this.plot.getBoundingClientRect();
      return ((e.clientY - r.top) / r.height) * HEIGHT;
    };
    const rounded = (py: number) => Math.round(angleAt(place(py)) * 10) / 10;
    grip.addEventListener('pointerdown', (e) => {
      const ev = e as PointerEvent;
      ev.preventDefault();
      (grip as SVGElement).setPointerCapture(ev.pointerId);
      this.dragging = true;
      this.leave();
    });
    grip.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const ev = e as PointerEvent;
      tips.showAt(ev.clientX, ev.clientY, { label: `${fmtNum(rounded(plotY(ev)), 1)}°` });
    });
    grip.addEventListener('pointerup', (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      tips.hideAt();
      th.onSet(rounded(plotY(e as PointerEvent)));
    });
  }

  private hover(e: PointerEvent): void {
    const c = this.current;
    if (!c || this.dragging) return;
    if (!(this.plot.getBoundingClientRect().width > 0)) return;
    const k = this.nearest(e);
    const at = c.x(c.positions[k]);
    this.cross?.setAttribute('x1', String(at));
    this.cross?.setAttribute('x2', String(at));
    this.cross?.setAttribute('visibility', 'visible');
    const u = quantityUnit('length', c.unit);
    const parts = c.series.map((s, i) => {
      const a = s.values[k];
      const dot = this.dots[i];
      if (a === null) dot.setAttribute('visibility', 'hidden');
      else {
        dot.setAttribute('cx', String(at));
        dot.setAttribute('cy', String(c.y(a)));
        dot.setAttribute('visibility', 'visible');
      }
      return `${s.label}: ${a === null ? '—' : `${fmtQuantity('angle', a)}°`}`;
    });
    tips.showAt(e.clientX, e.clientY, { label: `${t('edge.position')} ${fmtQuantity('length', c.positions[k])}${u ? ` ${u}` : ''}`, lines: parts });
  }

  private leave(): void {
    this.cross?.setAttribute('visibility', 'hidden');
    for (const d of this.dots) d.setAttribute('visibility', 'hidden');
    tips.hideAt();
  }
}

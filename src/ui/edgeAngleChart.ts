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
  private current: (ChartInput & { x: (p: number) => number; y: (a: number) => number; angleAt: (py: number) => number }) | null = null;
  private dragging = false;

  constructor() {
    this.legend = h('div', { class: 'edge-chart-legend', id: 'edge-chart-legend' });
    this.plot = svg('svg', { id: 'edge-chart', class: 'edge-chart-plot', viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img', 'aria-label': t('sec.edgeAngle') }) as SVGSVGElement;
    this.el = h('div', { class: 'edge-chart', id: 'edge-angle-chart' }, this.legend, this.plot);
    this.plot.addEventListener('pointermove', (e) => this.hover(e));
    this.plot.addEventListener('pointerleave', () => this.leave());
  }

  set(input: ChartInput | null): void {
    // the line under the pointer stays until it is let go
    if (this.dragging) return;
    clear(this.plot);
    clear(this.legend);
    this.cross = null;
    this.dots = [];
    this.current = null;
    this.el.hidden = !input?.positions.length;
    if (!input?.positions.length) return;
    const values = input.series.flatMap((s) => s.values.filter((a): a is number => a !== null));
    if (input.threshold) values.push(input.threshold.value);
    if (!values.length) return;
    const lo = Math.min(...values), hi = Math.max(...values);
    const want = Math.max(hi - lo, 1) / 4;
    const step = STEPS.find((s) => s >= want) ?? 60;
    const y0 = Math.floor(lo / step) * step, y1 = Math.max(Math.ceil(hi / step) * step, y0 + step);
    const length = input.positions[input.positions.length - 1] || 1;
    const x = (p: number) => LEFT + (p / length) * (WIDTH - LEFT - RIGHT);
    const y = (a: number) => HEIGHT - BOTTOM - ((a - y0) / (y1 - y0)) * (HEIGHT - BOTTOM - TOP);
    const angleAt = (py: number) => y0 + ((HEIGHT - BOTTOM - py) / (HEIGHT - BOTTOM - TOP)) * (y1 - y0);
    // the sharp stretches behind everything; one that goes on past the end comes back at the start
    for (const b of input.bands) {
      for (const [from, to] of b.start <= b.end ? [[b.start, b.end]] : [[b.start, length], [0, b.end]]) {
        this.plot.append(svg('rect', { x: x(from), y: TOP, width: Math.max(1, x(to) - x(from)), height: HEIGHT - BOTTOM - TOP, class: 'edge-chart-band' }));
      }
    }
    // recessive grid, one axis of angles
    for (let a = y0; a <= y1 + 1e-9; a += step) {
      this.plot.append(svg('line', { x1: LEFT, x2: WIDTH - RIGHT, y1: y(a), y2: y(a), class: 'edge-chart-grid' }));
      const label = svg('text', { x: LEFT - 5, y: y(a) + 3.5, class: 'edge-chart-tick', 'text-anchor': 'end' });
      label.textContent = `${fmtNum(a, 0)}°`;
      this.plot.append(label);
    }
    const u = quantityUnit('length', input.unit);
    for (const [p, anchor] of [[0, 'start'], [length, 'end']] as const) {
      const label = svg('text', { x: x(p), y: HEIGHT - 6, class: 'edge-chart-tick', 'text-anchor': anchor });
      label.textContent = `${fmtNum(p, 0)}${p && u ? ` ${u}` : ''}`;
      this.plot.append(label);
    }
    const keys = new Set<string>();
    for (const s of input.series) {
      let path = '';
      let pen = false;
      s.values.forEach((a, k) => {
        if (a === null) {
          pen = false;
          return;
        }
        path += `${pen ? 'L' : 'M'}${x(input.positions[k]).toFixed(1)} ${y(a).toFixed(1)}`;
        pen = true;
      });
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
    this.current = { ...input, x, y, angleAt };
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
    const r = this.plot.getBoundingClientRect();
    if (!(r.width > 0)) return;
    const px = ((e.clientX - r.left) / r.width) * WIDTH;
    // the nearest station
    let k = 0;
    c.positions.forEach((p, i) => {
      if (Math.abs(c.x(p) - px) < Math.abs(c.x(c.positions[k]) - px)) k = i;
    });
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

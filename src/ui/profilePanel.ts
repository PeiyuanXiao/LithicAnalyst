import type { FlakeGeometry } from '../compute/flake';
import type { CrossSection, SectionLine } from '../compute/meshSection';
import { inFrame } from '../compute/meshSection';
import type { FrameAxes } from '../core/frame';
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

/** What the longitudinal drawing needs. */
export interface ProfileContent {
  /** The technical frame, its origin in the coordinates of `section`. */
  frame: FrameAxes;
  section: SectionLine | null;
  /** The measurements' points, in original coordinates; `offset` takes them to the section's. */
  geometry: FlakeGeometry | null;
  offset: Vec3;
  techLength: number;
  techWidth: number;
  techThickness: number;
  unit: string;
}

/** Room for the two drawings, pixels. */
const WIDTH = 440;
const HEIGHT = 230;
const MARGIN = 10;
const GAP = 16;

/**
 * The two sections of a flake, to one scale: on the left the longitudinal one (X = 0 of the
 * technical frame, platform down, drawn as the figure's left view), on the right the one across
 * (dorsal face up, X to the right, as the front view), a slider and readings for where it is.
 */
export class ProfilePanel {
  readonly el: HTMLElement;
  private readonly longEl: SVGSVGElement;
  private readonly crossEl: SVGSVGElement;
  private readonly slider: HTMLInputElement;
  private readonly readings: HTMLElement;
  private content: ProfileContent | null = null;
  private cross: CrossSection | null = null;
  private fraction = 0.5;
  private scale = 1;
  /** Page position of Y = 0 and the marker on the longitudinal drawing. */
  private y0 = 0;
  private marker: SVGElement | null = null;
  /** The slider, the marker or a click on the drawing moved the section (fraction of the technical length). */
  onMove: (fraction: number) => void = () => {};

  constructor() {
    this.longEl = svg('svg', { id: 'profile-long', class: 'profile-svg profile-long', role: 'img', 'aria-label': t('profile.long') }) as SVGSVGElement;
    this.crossEl = svg('svg', { id: 'profile-cross', class: 'profile-svg', role: 'img', 'aria-label': t('profile.cross') }) as SVGSVGElement;
    this.slider = h('input', { type: 'range', id: 'profile-slider', class: 'profile-slider', min: 0, max: 100, step: 0.1, value: 50, 'aria-label': t('profile.position') }) as HTMLInputElement;
    this.slider.addEventListener('input', () => this.onMove(Number(this.slider.value) / 100));
    this.readings = h('dl', { class: 'num-grid profile-readings', id: 'profile-readings' });
    this.el = h('div', { class: 'profile-content' }, h('div', { class: 'profile-drawings' }, this.longEl, this.crossEl), this.slider, this.readings);
    // press on the drawing (or the marker) and drag: the section follows
    const toFraction = (e: PointerEvent): number => {
      const c = this.content;
      const r = this.longEl.getBoundingClientRect();
      if (!c || !(c.techLength > 0)) return this.fraction;
      return Math.max(0, Math.min(1, (this.y0 - (e.clientY - r.top)) / this.scale / c.techLength));
    };
    this.longEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.longEl.setPointerCapture(e.pointerId);
      this.onMove(toFraction(e));
    });
    this.longEl.addEventListener('pointermove', (e) => {
      if (this.longEl.hasPointerCapture(e.pointerId)) this.onMove(toFraction(e));
    });
  }

  /** New sections or measurements. */
  setContent(c: ProfileContent | null): void {
    this.content = c;
    this.drawLong();
    this.drawCross();
  }

  /** The section across at `fraction` of the technical length. */
  setCross(fraction: number, cross: CrossSection | null): void {
    this.fraction = fraction;
    this.cross = cross;
    if (Number(this.slider.value) !== Math.round(fraction * 1000) / 10) this.slider.value = String(Math.round(fraction * 1000) / 10);
    this.placeMarker();
    this.drawCross();
  }

  private placeMarker(): void {
    const c = this.content;
    if (!this.marker || !c) return;
    const y = this.y0 - this.fraction * c.techLength * this.scale;
    this.marker.setAttribute('y1', String(y));
    this.marker.setAttribute('y2', String(y));
  }

  private drawLong(): void {
    const s = this.longEl;
    clear(s);
    this.marker = null;
    const c = this.content;
    if (!c) return;
    // one scale for both drawings: the longitudinal one is thickness × length, the other width × thickness
    const across = Math.max(c.techThickness, 1e-9), along = Math.max(c.techLength, 1e-9), wide = Math.max(c.techWidth, 1e-9);
    // (a little more than the length: the platform goes below the point of percussion)
    const lows = c.section ? c.section.points.map((p) => inFrame(c.frame, p)) : [];
    const yMin = lows.reduce((m, p) => Math.min(m, p[1]), 0);
    const zMin = lows.reduce((m, p) => Math.min(m, p[2]), 0);
    const zMax = lows.reduce((m, p) => Math.max(m, p[2]), across);
    const span = zMax - zMin;
    const tall = along - yMin;
    this.scale = Math.min((WIDTH - GAP - 4 * MARGIN) / (span + wide), (HEIGHT - 2 * MARGIN) / tall);
    const w = span * this.scale + 2 * MARGIN;
    s.setAttribute('width', String(w));
    s.setAttribute('height', String(HEIGHT));
    s.setAttribute('viewBox', `0 0 ${w} ${HEIGHT}`);
    this.y0 = HEIGHT - MARGIN + yMin * this.scale;
    const x = (z: number) => MARGIN + (z - zMin) * this.scale;
    const y = (v: number) => this.y0 - v * this.scale;
    const local = (p: Vec3): Vec3 => inFrame(c.frame, [p[0] - c.offset[0], p[1] - c.offset[1], p[2] - c.offset[2]]);
    if (lows.length) {
      const d = lows.map((p, i) => `${i ? 'L' : 'M'}${x(p[2]).toFixed(2)} ${y(p[1]).toFixed(2)}`).join('') + (c.section?.closed ? 'Z' : '');
      s.append(svg('path', { d, class: 'profile-line', id: 'profile-long-line' }));
    }
    const g = c.geometry;
    const line = (pair: [Vec3, Vec3] | null, cls: string, id: string) => {
      if (!pair) return;
      const [a, b] = pair.map(local);
      s.append(svg('line', { x1: x(a[2]), y1: y(a[1]), x2: x(b[2]), y2: y(b[1]), class: cls, id }));
    };
    const dot = (p: Vec3 | null, cls: string, label: string | null, id: string) => {
      if (!p) return;
      const q = local(p);
      s.append(svg('circle', { cx: x(q[2]), cy: y(q[1]), r: 3, class: cls, id }));
      if (label) {
        const text = svg('text', { x: x(q[2]) + 5, y: y(q[1]) + 3, class: 'profile-label' });
        text.textContent = label;
        s.append(text);
      }
    };
    if (g) {
      line(g.ventral, 'profile-ventral', 'profile-ventral');
      line(g.ventralLine, 'profile-fit', 'profile-ventral-fit');
      line(g.platformLine, 'profile-fit', 'profile-platform-line');
      g.epaPoints.forEach((q, i) => dot(q, 'profile-epa', null, `profile-epa-${i + 1}`));
      dot(g.P, 'profile-point', 'P', 'profile-p');
      dot(g.E, 'profile-point', 'E', 'profile-e');
    }
    // where the section across is
    this.marker = svg('line', { x1: 0, x2: w, y1: 0, y2: 0, class: 'profile-marker', id: 'profile-marker' });
    s.append(this.marker);
    this.placeMarker();
  }

  private drawCross(): void {
    const s = this.crossEl;
    clear(s);
    clear(this.readings);
    const c = this.content;
    if (!c) return;
    const wide = Math.max(c.techWidth, 1e-9);
    const w = wide * this.scale + 2 * MARGIN;
    s.setAttribute('width', String(w));
    s.setAttribute('height', String(HEIGHT));
    s.setAttribute('viewBox', `0 0 ${w} ${HEIGHT}`);
    const cx = this.cross;
    if (cx?.loops.length) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const l of cx.loops)
        for (const [x, z] of l.points) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          z0 = Math.min(z0, z);
          z1 = Math.max(z1, z);
        }
      // kept in the middle of its room; dorsal face up
      const mx = w / 2 - ((x0 + x1) / 2) * this.scale, my = HEIGHT / 2 + ((z0 + z1) / 2) * this.scale;
      const d = cx.loops.map((l) => l.points.map(([x, z], i) => `${i ? 'L' : 'M'}${(mx + x * this.scale).toFixed(2)} ${(my - z * this.scale).toFixed(2)}`).join('') + (l.closed ? 'Z' : '')).join('');
      s.append(svg('path', { d, class: 'profile-line profile-fill', id: 'profile-cross-line' }));
    }
    // the scale bar, at this drawing's foot
    const room = (w - 2 * MARGIN) / this.scale;
    const len = scaleBarLength(room).length;
    if (len > 0) {
      const bar = len * this.scale;
      s.append(svg('line', { x1: MARGIN, x2: MARGIN + bar, y1: HEIGHT - MARGIN, y2: HEIGHT - MARGIN, class: 'profile-scale', id: 'profile-scale' }));
      const text = svg('text', { x: MARGIN, y: HEIGHT - MARGIN - 4, class: 'profile-label', id: 'profile-scale-text' });
      text.textContent = `${fmtNum(len, len < 1 ? 2 : 0)}${c.unit ? ` ${c.unit}` : ''}`;
      s.append(text);
    }
    const u = quantityUnit('length', c.unit);
    this.readings.append(
      ...numRow(t('profile.position'), fmtQuantity('length', this.fraction * c.techLength), u, 'profile-y'),
      ...numRow(t('profile.width'), fmtQuantity('length', cx?.width), u, 'profile-width'),
      ...numRow(t('profile.thickness'), fmtQuantity('length', cx?.thickness), u, 'profile-thickness'),
    );
  }
}

import type { LongestStretch } from '../compute/retouchIndex';
import type { P2, PlanLoops, PlanShape } from '../compute/retouchPlan';
import { pngWithDpi } from '../io/png';
import { drawPrims, planDrawing, primsMarkup, sectionDrawing, SCREEN_PALETTE, svgFile, type Drawing, type SectionModel } from '../render/retouchDrawing';
import { numRow } from './controls';
import { clear, h } from './dom';
import { t } from './i18n';
import { tip } from './tooltip';

const canvasBytes = async (canvas: HTMLCanvasElement): Promise<Uint8Array> => {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG');
  return new Uint8Array(await blob.arrayBuffer());
};

/**
 * A drawing as a PNG, from its SVG; where the browser will not hand back a canvas an SVG was drawn on, from the same primitives.
 * To scale, at `dpi`, which goes into the file; else in the drawing's pixels.
 */
export async function drawingPng(d: Drawing, prefix: string, dpi: number): Promise<Uint8Array> {
  const toScale = d.widthMm !== null;
  const k = toScale ? dpi / 96 : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(d.width * k));
  canvas.height = Math.max(1, Math.round(d.height * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('PNG');
  let bytes: Uint8Array;
  try {
    const url = URL.createObjectURL(new Blob([svgFile(d, prefix)], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('SVG'));
        image.src = url;
      });
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    } finally {
      URL.revokeObjectURL(url);
    }
    bytes = await canvasBytes(canvas);
  } catch {
    ctx.reset?.();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    drawPrims(ctx, d.prims);
    bytes = await canvasBytes(canvas);
  }
  return toScale ? pngWithDpi(bytes, dpi) : bytes;
}

/** One reading under the section: empty readings say why when the pointer rests on them. */
export interface SectionReading {
  id: string;
  label: string;
  value: string;
  unit: string;
  why: string | null;
  /** After the value (a filled station's missing area). */
  note?: string;
}

/** What the section panel shows. */
export interface SectionContent {
  curves: Array<{ id: string; label: string }>;
  curveId: string;
  station: number;
  count: number;
  /** "12.0 / 58.3 mm". */
  position: string;
  model: SectionModel | null;
  /** For the scale bar; null: none. */
  unit: string | null;
  /** The narrowest the framing goes, in the coordinate unit. */
  minWidth: number;
  readings: SectionReading[];
}

const exportButtons = (id: string, onExport: (format: 'svg' | 'png') => void): HTMLElement[] =>
  (['svg', 'png'] as const).map((f) => h('button', { type: 'button', class: 'btn btn-quiet btn-tiny', id: `${id}-${f}`, onclick: () => onExport(f) }, f.toUpperCase()));

/** A drawing in a box that follows the panel's size. */
function stage(id: string, label: string, draw: () => void): { el: HTMLElement; svg: SVGSVGElement } {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', id);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.classList.add('retouch-svg');
  const el = h('div', { class: 'retouch-stage' }, svg);
  new ResizeObserver(() => el.isConnected && draw()).observe(el);
  return { el, svg };
}

/**
 * A station's section: the section, the layers, the fitted stretches and their lines, what is missing between them; a slider
 * along the curve and the readings below.
 */
export class RetouchSectionPanel {
  readonly el: HTMLElement;
  readonly extras: HTMLElement[];
  /** The whole section instead of what the measurement takes in. */
  whole = false;
  onStation: (k: number) => void = () => {};
  onCurve: (id: string) => void = () => {};
  onExport: (format: 'svg' | 'png') => void = () => {};
  private readonly curve: HTMLSelectElement;
  private readonly position: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly readings: HTMLElement;
  private readonly drawing: { el: HTMLElement; svg: SVGSVGElement };
  private content: SectionContent | null = null;

  constructor() {
    this.curve = h('select', { class: 'ctl-select retouch-curve', id: 'retouch-section-curve', 'aria-label': t('retouch.curve') }) as HTMLSelectElement;
    this.curve.addEventListener('change', () => this.onCurve(this.curve.value));
    this.position = h('span', { class: 'mono retouch-position', id: 'retouch-section-position' });
    const wholeBox = h('input', { type: 'checkbox', id: 'retouch-section-whole' }) as HTMLInputElement;
    wholeBox.addEventListener('change', () => {
      this.whole = wholeBox.checked;
      this.draw();
    });
    this.extras = [this.curve, this.position, h('label', { class: 'ctl-check retouch-whole', for: 'retouch-section-whole' }, wholeBox, h('span', {}, t('retouch.whole'))), ...exportButtons('retouch-section', (f) => this.onExport(f))];
    this.drawing = stage('retouch-section-drawing', t('retouch.section'), () => this.draw());
    this.slider = h('input', { type: 'range', id: 'retouch-section-slider', class: 'profile-slider', min: 0, max: 0, step: 1, value: 0, 'aria-label': t('retouch.station') }) as HTMLInputElement;
    this.slider.addEventListener('input', () => this.onStation(Number(this.slider.value)));
    this.readings = h('dl', { class: 'num-grid retouch-readings', id: 'retouch-section-readings' });
    this.el = h('div', { class: 'retouch-content' }, this.drawing.el, this.slider, this.readings);
  }

  set(c: SectionContent | null): void {
    this.content = c;
    clear(this.curve);
    for (const x of c?.curves ?? []) this.curve.append(h('option', { value: x.id }, x.label));
    this.curve.hidden = (c?.curves.length ?? 0) < 2;
    if (c) this.curve.value = c.curveId;
    this.position.textContent = c?.position ?? '';
    this.slider.max = String(Math.max(0, (c?.count ?? 1) - 1));
    this.slider.value = String(c?.station ?? 0);
    this.slider.disabled = !c;
    clear(this.readings);
    for (const r of c?.readings ?? []) {
      const row = numRow(r.label, r.value, r.unit, r.id);
      if (r.why) tip(row[1], r.why);
      if (r.note) row[2].append(h('span', { class: 'pill retouch-filled', id: `${r.id}-note` }, r.note));
      this.readings.append(...row);
    }
    this.draw();
  }

  private draw(): void {
    const { el, svg } = this.drawing;
    const c = this.content;
    if (!c?.model) {
      svg.innerHTML = '';
      svg.removeAttribute('data-station');
      return;
    }
    const width = el.clientWidth || 420, height = el.clientHeight || 240;
    const d = sectionDrawing(c.model, { palette: SCREEN_PALETTE, whole: this.whole, minWidth: c.minWidth, unit: c.unit, width, height });
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('data-station', String(c.station));
    svg.innerHTML = primsMarkup(d.prims, 'retouch-section');
  }
}

/** What the plan panel shows. */
export interface PlanContent {
  shape: PlanShape;
  loops: readonly PlanLoops[];
  station: { at: P2; index: number } | null;
  longest: LongestStretch | null;
  highlight: number | null;
  /** Which frame it is on. */
  tag: string;
  unit: string | null;
}

export type PlanFace = 'dorsal' | 'ventral';

/** The plan: the outline, the segments, the retouch on the face shown, the current station. */
export class RetouchPlanPanel {
  readonly el: HTMLElement;
  readonly extras: HTMLElement[];
  onFace: (face: PlanFace) => void = () => {};
  onAxis: (axis: string) => void = () => {};
  onFlip: () => void = () => {};
  onExport: (format: 'svg' | 'png') => void = () => {};
  /** A press on the drawing, on the plan, and how far on the plan a few pixels reach. */
  onPick: (at: P2, reach: number) => void = () => {};
  private readonly faces: HTMLElement;
  private readonly axis: HTMLSelectElement;
  private readonly flip: HTMLButtonElement;
  private readonly drawing: { el: HTMLElement; svg: SVGSVGElement };
  private readonly empty: HTMLElement;
  private content: PlanContent | null = null;
  private face: PlanFace = 'dorsal';
  private toPlan: ((x: number, y: number) => P2) | null = null;
  private toPage: ((p: P2) => P2) | null = null;
  private drawnWidth = 0;

  constructor() {
    const faceButton = (f: PlanFace) => h('button', { type: 'button', class: 'seg-btn', role: 'radio', id: `retouch-plan-face-${f}`, 'data-value': f, 'aria-checked': 'false', onclick: () => this.onFace(f) }, t(`retouch.face.${f}`));
    this.faces = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': t('retouch.face') }, faceButton('dorsal'), faceButton('ventral'));
    this.axis = h(
      'select',
      { class: 'ctl-select retouch-axis', id: 'retouch-plan-axis', 'aria-label': t('retouch.axis') },
      ...(['auto', 'technical', 'longest'] as const).map((a) => h('option', { value: a }, t(`retouch.axis.${a}`))),
    ) as HTMLSelectElement;
    this.axis.addEventListener('change', () => this.onAxis(this.axis.value));
    this.flip = h('button', { type: 'button', class: 'btn btn-quiet btn-tiny', id: 'retouch-plan-flip', onclick: () => this.onFlip() }, t('retouch.flip')) as HTMLButtonElement;
    this.extras = [this.faces, this.axis, this.flip, ...exportButtons('retouch-plan', (f) => this.onExport(f))];
    this.drawing = stage('retouch-plan-drawing', t('retouch.plan'), () => this.draw());
    this.empty = h('p', { class: 'retouch-empty', id: 'retouch-plan-empty', hidden: true });
    this.el = h('div', { class: 'retouch-content' }, this.drawing.el, this.empty);
    this.drawing.svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.toPlan || !this.toPage) return;
      const r = this.drawing.svg.getBoundingClientRect();
      const at = this.toPlan(e.clientX - r.left, e.clientY - r.top);
      const far = this.toPlan(e.clientX - r.left + 18, e.clientY - r.top);
      this.onPick(at, Math.abs(far[0] - at[0]));
    });
  }

  /** The controls of the title bar: the frame chosen, whether its direction can be turned. */
  setControls(axis: string, canFlip: boolean): void {
    this.axis.value = axis;
    this.flip.hidden = !canFlip;
  }

  set(c: PlanContent | null, face: PlanFace, why: string | null): void {
    this.content = c;
    this.face = face;
    for (const b of this.faces.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === face));
    this.empty.hidden = !!c || !why;
    this.empty.textContent = why ?? '';
    this.drawing.el.hidden = !c;
    this.draw();
  }

  /** Only the current station moved: its marks go, nothing else is drawn again. */
  moveStation(at: P2 | null, index: number): void {
    const svg = this.drawing.svg;
    if (!this.content) return;
    this.content = { ...this.content, station: at ? { at, index } : null };
    const dot = svg.querySelector<SVGCircleElement>('#retouch-plan-station');
    if (!dot || !at || !this.toPage) {
      this.draw();
      return;
    }
    const q = this.toPage(at);
    for (const c of [dot, dot.previousElementSibling as SVGCircleElement | null]) {
      c?.setAttribute('cx', String(q[0]));
      c?.setAttribute('cy', String(q[1]));
    }
    dot.setAttribute('data-station', String(index));
  }

  private draw(): void {
    const { el, svg } = this.drawing;
    const c = this.content;
    if (!c) {
      svg.innerHTML = '';
      this.toPlan = this.toPage = null;
      return;
    }
    const width = el.clientWidth || 320, height = el.clientHeight || 360;
    const d = planDrawing({ ...c, face: this.face, palette: SCREEN_PALETTE, width, height });
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.innerHTML = primsMarkup(d.prims, 'retouch-plan');
    this.toPlan = d.toPlan;
    this.toPage = d.toPage;
    this.drawnWidth = width;
  }

  /** The drawing's width when it was last drawn (0: not drawn). */
  get width(): number {
    return this.drawnWidth;
  }
}

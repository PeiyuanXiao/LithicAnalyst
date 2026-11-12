import * as THREE from 'three';
import { applyPlacement, endDistances, fitPairs, icpSteps, IGES_IMPORT, isAligned, residualOf, startPlacement, toleranceOf, type AlignPair, type Placement, type Residual, type Segment, type SurfaceQuery } from '../compute/igesAlign';
import { runSliced } from '../compute/steps';
import { fmtQuantity, quantityUnit } from '../core/format';
import type { Vec3 } from '../core/types';
import type { IgesRead } from '../io/iges';
import { EASE } from '../render/easing';
import { IgesLayer, type PreviewArrow } from '../render/igesLayer';
import type { Viewer } from '../render/viewer';
import { checkbox, iconButton, numRow } from './controls';
import { clear, h, ICONS } from './dom';
import { floatingPanel, type FloatingPanel } from './floatingPanel';
import { t } from './i18n';

/** An IGES file read for import. */
export interface IgesFile {
  name: string;
  sha256: string;
  read: IgesRead;
}

/** What the user confirmed: the segments as they are to become arrows (reversed or not), where they go, and how well they lie. */
export interface AlignOutcome {
  file: IgesFile;
  factor: number;
  segments: Segment[];
  placement: Placement;
  pairs: AlignPair[];
  residual: Residual;
}

export interface AlignHost {
  viewer: Viewer;
  /** The view the panel floats over. */
  area: HTMLElement;
  layer: IgesLayer;
  surface: SurfaceQuery;
  /** Where the mesh's coordinates start (drawing). */
  origin: Vec3;
  /** The model's unit, as stated. */
  unit: string;
  /** The model point under a client position. */
  pick(x: number, y: number): Vec3 | null;
  /** The placement confirmed last in this session (another specimen's), if any. */
  previous: Placement | null;
  confirm(outcome: AlignOutcome): void;
  cancel(): void;
}

/** A factor of the unit menu as it reads. */
function factorLabel(f: number): string {
  if (Math.abs(f - 1) < 1e-12) return t('align.unit.asIs');
  if (f < 1) {
    const d = 1 / f;
    return `÷ ${Math.abs(d - Math.round(d)) < 1e-9 ? Math.round(d) : +d.toPrecision(6)}`;
  }
  return `× ${+f.toPrecision(6)}`;
}

const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * The "Align vectors" mode: the vectors of an IGES file drawn over the model, a panel to choose their unit, reverse them, see the
 * pairs placed by hand and how far they lie from the surface, fit them automatically, and confirm or cancel. Ends taken by the
 * align tool (`at`, `drag`, `drop`) become pairs; the whole set follows each change of them. Only the vectors move.
 */
export class IgesAlign {
  readonly panel: FloatingPanel;
  private factor: number;
  private placement: Placement;
  private flip = false;
  /** By end: 2 × segment + 0 for the file's first point, 1 for its second. */
  private pairs = new Map<number, AlignPair>();
  private beforeFit: Placement | null = null;
  private fitting = false;
  /** The ends as drawn now (they move to the placement in MOVE_MS). */
  private drawn: Vec3[];
  private hot: number | null = null;
  private dragging: { end: number; point: Vec3 } | null = null;
  private distances: number[] = [];
  private moveToken = 0;
  private redrawQueued = false;
  private readonly offCamera: () => void;
  private readonly refs: {
    unit: HTMLSelectElement;
    flip: HTMLInputElement;
    pairs: HTMLElement;
    residual: HTMLElement;
    ok: HTMLElement;
    fit: HTMLButtonElement;
    unfit: HTMLButtonElement;
    previous: HTMLButtonElement;
    confirm: HTMLButtonElement;
  };

  constructor(private readonly host: AlignHost, readonly file: IgesFile, start: { factor: number; placement: Placement }, private readonly fileFactor: number | null) {
    this.factor = start.factor;
    this.placement = start.placement;
    this.drawn = this.target();
    this.panel = floatingPanel({ id: 'align', title: t('align.title'), pref: 'alignPanel', area: host.area, onClose: () => host.cancel() });
    const unit = h('select', { id: 'align-unit', class: 'ctl-select' }) as HTMLSelectElement;
    unit.addEventListener('change', () => {
      this.setFactor(Number(unit.value));
      // Enter and Esc are the mode's again
      unit.blur();
    });
    const flipBox = checkbox('align-flip', t('align.flip'), false, (on) => this.setFlip(on));
    const read = file.read;
    const skipped = Object.values(read.skipped).reduce((a, b) => a + b, 0);
    const summary = [t('align.summary', { n: read.segments.length, dup: read.duplicates, skip: skipped }), read.conflicts.length ? t('align.conflicts', { n: read.conflicts.length }) : ''].filter(Boolean).join(' · ');
    const pairs = h('ol', { class: 'arrow-list align-pairs', id: 'align-pairs', 'aria-label': t('align.pairs') });
    const residual = h('dl', { class: 'num-grid', id: 'align-residual' });
    const ok = h('span', { class: 'pill', id: 'align-ok', hidden: true }, t('align.ok'));
    const btn = (id: string, label: string, run: () => void, kind = 'btn-quiet') => h('button', { type: 'button', class: `btn ${kind} btn-sm`, id, onclick: run }, label) as HTMLButtonElement;
    const fit = btn('align-fit', t('align.fit'), () => void this.fit());
    const unfit = btn('align-unfit', t('align.unfit'), () => this.unfit());
    const previous = btn('align-previous', t('align.previous'), () => this.usePrevious());
    const confirm = btn('align-confirm', t('align.confirm'), () => this.confirm(), 'btn-primary');
    const cancel = btn('align-cancel', t('dlg.cancel'), () => host.cancel());
    this.panel.body.append(
      h(
        'div',
        { class: 'align-content' },
        h('div', { class: 'align-summary mono', id: 'align-summary' }, file.name, h('br'), summary),
        h('div', { class: 'ctl' }, h('label', { class: 'ctl-label', for: 'align-unit' }, t('align.unit')), unit),
        flipBox,
        h('div', { class: 'align-head' }, h('span', { class: 'ctl-label' }, t('align.pairs')), h('span', { class: 'badge mono', id: 'align-pair-count' }, '0')),
        pairs,
        h('div', { class: 'align-head' }, h('span', { class: 'ctl-label' }, t('align.residual')), ok),
        residual,
        h('div', { class: 'btn-row align-tools' }, fit, unfit, previous),
        h('div', { class: 'btn-row align-actions' }, cancel, confirm),
      ),
    );
    this.refs = { unit, flip: flipBox.querySelector('input')!, pairs, residual, ok, fit, unfit, previous, confirm };
    host.area.append(this.panel.el);
    this.panel.el.hidden = false;
    this.panel.fit();
    this.offCamera = host.viewer.onCameraChange(() => this.queueRedraw());
    this.measure();
    this.paint();
    this.draw();
  }

  // ---------------------------------------------------------------- geometry

  private get segments(): readonly Segment[] {
    return this.file.read.segments;
  }

  /** The file's point of end `e`. */
  private fileEnd(e: number): Vec3 {
    const s = this.segments[e >> 1];
    return e & 1 ? s.end : s.start;
  }

  /** Each end where the placement puts it. */
  private target(): Vec3[] {
    return this.segments.flatMap((s) => [applyPlacement(this.placement, s.start), applyPlacement(this.placement, s.end)]);
  }

  private measure(): void {
    this.distances = endDistances(this.segments, this.placement, this.host.surface);
  }

  residual(): Residual {
    return residualOf(this.distances);
  }

  private tol(): number {
    return toleranceOf(this.host.surface);
  }

  /** The arrows as drawn: a reversed set from its second points. */
  private arrows(): PreviewArrow[] {
    const warnAt = IGES_IMPORT.REVIEW_TOLS * this.tol();
    return this.segments.map((_, i) => {
      const a = this.dragging?.end === 2 * i ? this.dragging.point : this.drawn[2 * i];
      const b = this.dragging?.end === 2 * i + 1 ? this.dragging.point : this.drawn[2 * i + 1];
      const warn = Math.max(this.distances[2 * i] ?? 0, this.distances[2 * i + 1] ?? 0) > warnAt;
      return this.flip ? { start: b, end: a, warn } : { start: a, end: b, warn };
    });
  }

  /** The layer's number of end `e` (it counts each arrow's start first). */
  private shownEnd(e: number): number {
    return this.flip ? e ^ 1 : e;
  }

  private draw(): void {
    const paired = new Set([...this.pairs.keys()].map((e) => this.shownEnd(e)));
    this.host.layer.show(this.arrows(), this.host.origin, this.hot === null ? null : this.shownEnd(this.hot), paired);
  }

  private queueRedraw(): void {
    if (this.redrawQueued) return;
    this.redrawQueued = true;
    requestAnimationFrame(() => {
      this.redrawQueued = false;
      this.draw();
    });
  }

  /** To the placement as it is now: the preview moves there in MOVE_MS (at once with reduced motion). */
  private moveTo(placement: Placement): void {
    this.placement = placement;
    this.measure();
    this.paint();
    const from = this.drawn.map((p) => [...p] as Vec3);
    const to = this.target();
    const mine = ++this.moveToken;
    this.host.viewer.tween(IGES_IMPORT.MOVE_MS, (k) => {
      if (mine !== this.moveToken) return;
      const f = k >= 1 ? 1 : EASE(k);
      this.drawn = from.map((p, i) => [p[0] + (to[i][0] - p[0]) * f, p[1] + (to[i][1] - p[1]) * f, p[2] + (to[i][2] - p[2]) * f]);
      this.draw();
    });
  }

  // ---------------------------------------------------------------- the align tool

  /** The end drawn within reach of a client position (the nearest), or null. */
  at(x: number, y: number): number | null {
    let best: number | null = null, near: number = IGES_IMPORT.GRAB_PX;
    const v = new THREE.Vector3();
    this.drawn.forEach((p, e) => {
      const s = this.host.viewer.project(v.set(p[0], p[1], p[2]));
      if (!s.visible) return;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= near) [near, best] = [d, e];
    });
    return best;
  }

  hover(end: number | null): void {
    if (this.hot === end) return;
    this.hot = end;
    this.draw();
  }

  drag(end: number, x: number, y: number): void {
    const p = this.host.pick(x, y);
    if (!p) return;
    this.dragging = { end, point: p };
    this.hot = end;
    this.draw();
  }

  drop(end: number, x: number, y: number): void {
    const p = this.host.pick(x, y) ?? (this.dragging?.end === end ? this.dragging.point : null);
    this.dragging = null;
    this.hot = null;
    if (!p) {
      this.draw();
      return;
    }
    this.pairs.set(end, { from: this.fileEnd(end), to: p });
    // where the end was let go is where it is drawn from
    this.drawn[end] = p;
    this.beforeFit = null;
    this.moveTo(fitPairs([...this.pairs.values()], this.placement));
  }

  /** Place end `e` at `to` as a drag would (tests). */
  placeEnd(e: number, to: Vec3): void {
    this.pairs.set(e, { from: this.fileEnd(e), to });
    this.beforeFit = null;
    this.moveTo(fitPairs([...this.pairs.values()], this.placement));
  }

  private removePair(e: number): void {
    if (!this.pairs.delete(e)) return;
    this.beforeFit = null;
    this.moveTo(this.pairs.size ? fitPairs([...this.pairs.values()], this.placement) : this.placement);
  }

  // ---------------------------------------------------------------- the panel

  private setFactor(f: number): void {
    if (!Number.isFinite(f) || f <= 0) return;
    this.factor = f;
    this.beforeFit = null;
    const scaled = { ...this.placement, scale: f };
    this.moveTo(this.pairs.size ? fitPairs([...this.pairs.values()], scaled) : startPlacement(this.segments, f, this.host.surface));
  }

  private setFlip(on: boolean): void {
    this.flip = on;
    this.paint();
    this.draw();
  }

  async fit(): Promise<void> {
    if (this.fitting) return;
    this.fitting = true;
    this.paint();
    const before = this.placement;
    const points = this.segments.flatMap((s) => [s.start, s.end]);
    try {
      const r = await runSliced(icpSteps(points, before, this.host.surface));
      this.beforeFit = before;
      this.fitting = false;
      this.moveTo(r.placement);
    } finally {
      this.fitting = false;
      this.paint();
    }
  }

  private unfit(): void {
    if (!this.beforeFit) return;
    const p = this.beforeFit;
    this.beforeFit = null;
    this.moveTo(p);
  }

  private usePrevious(): void {
    const p = this.host.previous;
    if (!p) return;
    this.factor = p.scale;
    this.beforeFit = null;
    this.moveTo({ scale: p.scale, rotation: [...p.rotation], translation: [...p.translation] as Vec3 });
  }

  confirm(): void {
    if (this.fitting) return;
    const segments = this.flip ? this.segments.map((s) => ({ start: s.end, end: s.start })) : this.segments.map((s) => ({ start: s.start, end: s.end }));
    this.host.confirm({ file: this.file, factor: this.factor, segments, placement: this.placement, pairs: [...this.pairs.values()], residual: this.residual() });
  }

  /** The panel as the state is. */
  private paint(): void {
    const r = this.refs;
    // the units: those offered, the file's own, the one in use
    const factors = [...IGES_IMPORT.UNIT_FACTORS];
    for (const f of [this.fileFactor, this.factor]) if (f && !factors.some((x) => same(x, f))) factors.push(f);
    clear(r.unit);
    for (const f of factors) r.unit.append(h('option', { value: String(f), selected: same(f, this.factor) }, factorLabel(f)));
    r.flip.checked = this.flip;
    clear(r.pairs);
    for (const [e, p] of this.pairs) {
      const arrowEnd = this.shownEnd(e) & 1 ? 'align.pair.end' : 'align.pair.start';
      r.pairs.append(
        h(
          'li',
          { class: 'arrow-row align-pair', 'data-end': String(e) },
          h('span', { class: 'arrow-id mono' }, String((e >> 1) + 1)),
          h('span', { class: 'arrow-meta' }, t(arrowEnd)),
          h('span', { class: 'arrow-len mono' }, fmtQuantity('length', Math.hypot(...([0, 1, 2].map((k) => applyPlacement(this.placement, p.from)[k] - p.to[k]) as [number, number, number])))),
          iconButton(ICONS.close, t('align.pair.remove'), () => this.removePair(e), { id: `align-pair-del-${e}` }),
        ),
      );
    }
    r.pairs.hidden = !this.pairs.size;
    const count = this.panel.el.querySelector('#align-pair-count');
    if (count) count.textContent = String(this.pairs.size);
    const res = this.residual();
    const unit = quantityUnit('length', this.host.unit);
    clear(r.residual);
    r.residual.append(...numRow(t('align.median'), fmtQuantity('length', res.median), unit, 'align-median'), ...numRow(t('align.p90'), fmtQuantity('length', res.p90), unit, 'align-p90'), ...numRow(t('align.max'), fmtQuantity('length', res.max), unit, 'align-max'));
    r.ok.hidden = !isAligned(res, this.tol());
    r.fit.disabled = this.fitting;
    r.unfit.disabled = this.fitting || !this.beforeFit;
    r.previous.disabled = this.fitting || !this.host.previous;
    r.confirm.disabled = this.fitting;
  }

  /** What the mode shows, for the tests: each end where it is drawn (`end`: 2 × segment + 0 or 1) and on the screen. */
  info(): { file: string; factor: number; flip: boolean; pairs: number; residual: Residual; tol: number; aligned: boolean; fitted: boolean; placement: Placement; ends: Array<{ end: number; point: Vec3; x: number; y: number; visible: boolean }> } {
    const v = new THREE.Vector3();
    const res = this.residual();
    return {
      file: this.file.name,
      factor: this.factor,
      flip: this.flip,
      pairs: this.pairs.size,
      residual: res,
      tol: this.tol(),
      aligned: isAligned(res, this.tol()),
      fitted: !!this.beforeFit,
      placement: structuredClone(this.placement),
      ends: this.drawn.map((p, end) => {
        const s = this.host.viewer.project(v.set(p[0], p[1], p[2]));
        return { end, point: [...p] as Vec3, x: s.x, y: s.y, visible: s.visible };
      }),
    };
  }

  dispose(): void {
    this.moveToken++;
    this.offCamera();
    this.host.layer.clear();
    this.panel.el.remove();
  }
}

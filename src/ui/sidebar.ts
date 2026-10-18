import {
  addSemilandmarkSet,
  deleteLandmark,
  deleteSemilandmarkSet,
  renameLandmark,
  reorderLandmark,
  updateSemilandmarkSet,
  addSequence,
  deleteRelation,
  deleteSequence,
  moveInSequence,
  moveSequence,
  setRelation,
  setScarSequence,
  updateSequence,
  deleteCurve,
  deleteMeasurement,
  deletePlane,
  deleteSection,
  deleteRegion,
  setNoduleRegion,
  setNoduleShown,
  setSplit,
  deleteScar,
  flipPlane,
  setPlaneCurve,
  setPlaneExclusion,
  setPlaneMethod,
  setPlaneVisible,
  updateSection,
  setCurveAttribute,
  setCurveLabel,
  setScarAttribute,
  setScarLabel,
  updateSpecimen,
} from '../core/actions';
import { curveLength } from '../core/curveGeometry';
import { CURVE_FIELDS, REGION_FIELDS, SCAR_FIELDS, type FieldDef } from '../core/fields';
import { vectorLength } from '../core/store';
import type { AttributeValue, Curve, PlaneMethod, Scar } from '../core/types';
import { readPref, writePref } from '../io/autosave';
import { ARROW_COLORS, arrowColor, type ArrowColorMode } from '../render/arrowLayer';
import { CURVE_COLORS, curveColor } from '../render/curveLayer';
import { MEASURE_COLORS } from '../render/measureLayer';
import { planeColor } from '../render/planeLayer';
import { FIGURE_VIEWS } from '../render/figure';
import { SECTION_COLORS } from '../render/sectionLayer';
import { regionColorOf } from '../render/regionLayer';
import { relationProblems, type RelationProblem } from '../compute/relations';
import { sequenceColors, sequenceSwatch } from '../render/sequenceColor';
import { LANDMARK_COLORS } from '../render/landmarkLayer';
import type { ShadingMode } from '../render/meshView';
import type { AppApi, AppMode, ViewportBackground } from './appApi';
import { checkbox, optionList, segmented, selectRow, slider, softSet, textRow } from './controls';
import { clear, h, icon, ICONS } from './dom';
import { t, tl } from './i18n';

export type RefreshKind = 'all' | 'arrows' | 'curves' | 'measurements' | 'measure' | 'planes' | 'sections' | 'regions' | 'relations' | 'sequences' | 'landmarks' | 'compare' | 'nodule' | 'split' | 'figure' | 'selection' | 'specimen' | 'display' | 'mesh' | 'mode';

interface Section {
  el: HTMLElement;
  refresh: (kind: RefreshKind) => void;
}

export const fmtNum = (n: number, digits = 3): string => {
  const s = n.toFixed(digits);
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
};
const fmtInt = (n: number): string => n.toLocaleString('en-US');

function section(id: string, title: string, badge?: HTMLElement): { el: HTMLDetailsElement; body: HTMLElement } {
  const el = h('details', { class: 'panel', id: `sec-${id}` }) as HTMLDetailsElement;
  el.open = readPref(`sec:${id}`, true);
  el.addEventListener('toggle', () => writePref(`sec:${id}`, el.open));
  const summary = h('summary', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, title), badge ?? null);
  const body = h('div', { class: 'panel-body' });
  el.append(summary, body);
  return { el, body };
}

const metaRow = (term: string, value: Node | string, title?: string) => [h('dt', {}, term), h('dd', { title }, value)];

// ---------------------------------------------------------------- specimen

function specimenSection(api: AppApi): Section {
  const { el, body } = section('specimen', t('sec.specimen'));
  const s = api.store.state.specimen;
  const idRow = textRow('specimen-id', t('field.specimenId'), s.id, (v) => updateSpecimen(api.store, { id: v }), { mono: true });
  const annRow = textRow('specimen-annotator', t('field.annotator'), s.annotator, (v) => {
    updateSpecimen(api.store, { annotator: v });
    writePref('annotator', v);
  });
  const units = ['mm', 'cm', 'm', 'in'].map((u) => ({ value: u, label: u }));
  units.push({ value: '', label: t('unit.unknown') });
  const unitRow = selectRow('specimen-unit', t('field.unit'), units, s.unit, (v) => {
    updateSpecimen(api.store, { unit: v });
    writePref('unit', v);
  });
  const meta = h('dl', { class: 'meta' });
  body.append(h('div', { class: 'ctl-grid' }, idRow.el, annRow.el), unitRow.el, meta);

  const refresh = (kind: RefreshKind) => {
    if (kind !== 'all' && kind !== 'specimen' && kind !== 'mesh') return;
    const st = api.store.state;
    softSet(idRow.input, st.specimen.id);
    softSet(annRow.input, st.specimen.annotator);
    unitRow.set(st.specimen.unit);
    clear(meta);
    const m = st.mesh;
    if (m) {
      meta.append(
        ...metaRow(t('mesh.file'), m.fileName, `SHA-256 ${m.sha256}`),
        ...metaRow(t('mesh.size'), t('status.mesh', { v: fmtInt(m.vertexCount), t: fmtInt(m.triangleCount) })),
      );
    }
    meta.hidden = !m;
  };
  refresh('all');
  return { el, refresh };
}

// ---------------------------------------------------------------- arrows

function listSummary(attributes: Record<string, AttributeValue>, fields: FieldDef[] = SCAR_FIELDS): string {
  const parts: string[] = [];
  for (const f of fields) {
    if (f.type !== 'enum' || !f.listSummary) continue;
    const opt = f.options?.find((o) => o.value === attributes[f.key]);
    if (!opt) continue;
    if (f.listSummary === 'nonDefault' && opt.value === f.default) continue;
    parts.push(tl(opt.short ?? opt.label));
  }
  return parts.join(' · ');
}

function arrowsSection(api: AppApi): Section {
  const badge = h('span', { class: 'badge mono' }, '0');
  const { el, body } = section('arrows', t('sec.arrows'), badge);
  const list = h('ol', { class: 'arrow-list', id: 'scar-list', role: 'listbox', 'aria-label': t('sec.arrows') });
  const inspector = h('div', { class: 'inspector', id: 'arrow-inspector' });
  body.append(list, inspector);

  let builtFor: string | null = null;
  let refs: { label: HTMLInputElement; setters: Array<(a: Scar) => void>; coords: HTMLElement } | null = null;

  /** Which sequence the scar is in (options follow the sequences). */
  const sequenceField = (): { el: HTMLElement; set: (a: Scar) => void } => {
    const select = h('select', { id: 'scar-sequence', class: 'ctl-select' }) as HTMLSelectElement;
    select.addEventListener('change', () => api.selection.id && setScarSequence(api.store, api.selection.id, select.value || null));
    return {
      el: h('div', { class: 'ctl' }, h('label', { class: 'ctl-label', for: 'scar-sequence' }, t('arrows.sequence')), select),
      set: (a) => {
        const st = api.store.state;
        clear(select);
        select.append(h('option', { value: '' }, t('sequence.none')), ...st.sequences.map((q) => h('option', { value: q.id }, q.label)));
        select.value = st.sequences.find((q) => q.scarIds.includes(a.id))?.id ?? '';
      },
    };
  };

  const renderList = () => {
    const st = api.store.state;
    badge.textContent = String(st.scars.length);
    list.hidden = st.scars.length === 0;
    clear(list);
    const sel = api.selection.id;
    const unit = st.specimen.unit;
    const seq = api.display.arrows.colorMode === 'sequence' ? sequenceColors(st.sequences) : null;
    for (const a of st.scars) {
      const isSel = a.id === sel;
      const color = isSel ? ARROW_COLORS.selected : arrowColor(a, api.display.arrows.colorMode, seq);
      const li = h(
        'li',
        {
          class: 'arrow-row',
          role: 'option',
          'aria-selected': String(isSel),
          'data-id': a.id,
          onclick: () => api.selection.set(a.id),
          ondblclick: () => api.focusArrow(a.id),
        },
        h('span', { class: 'chip', style: `--chip:${color}` }),
        h('span', { class: 'arrow-id mono' }, a.label),
        h('span', { class: 'arrow-meta' }, listSummary(a.attributes)),
        h('span', { class: 'arrow-len mono' }, a.vector ? `${fmtNum(vectorLength(a.vector), 1)}${unit ? ` ${unit}` : ''}` : '–'),
      );
      list.append(li);
      if (isSel) requestAnimationFrame(() => li.scrollIntoView({ block: 'nearest' }));
    }
  };

  const buildField = (f: FieldDef, a: Scar): { el: HTMLElement; set: (a: Scar) => void } => {
    const id = `field-${f.key}`;
    const current = a.attributes[f.key];
    const onPick = (v: string) => {
      if (api.selection.id) setScarAttribute(api.store, api.selection.id, f.key, v);
    };
    if (f.type === 'enum' && f.options) {
      const ctl = f.numberKeys
        ? optionList(id, tl(f.label), f.options.map((o, i) => ({ value: o.value, label: tl(o.label), key: i < 9 ? String(i + 1) : undefined })), String(current), onPick)
        : segmented(id, tl(f.label), f.options.map((o) => ({ value: o.value, label: tl(o.label) })), String(current), onPick);
      return { el: h('div', { class: 'field' }, ctl.el), set: (x) => ctl.set(String(x.attributes[f.key])) };
    }
    const row = textRow(id, tl(f.label), current === null || current === undefined ? '' : String(current), (v) => {
      if (api.selection.id) setScarAttribute(api.store, api.selection.id, f.key, v);
    }, { multiline: true });
    return {
      el: h('div', { class: 'field' }, row.el),
      set: (x) => {
        const v = x.attributes[f.key];
        softSet(row.input, v === null || v === undefined ? '' : String(v));
      },
    };
  };

  const renderInspector = (force: boolean) => {
    const st = api.store.state;
    const id = api.selection.id;
    const a = id ? api.store.scar(id) : undefined;
    if (!a) {
      clear(inspector);
      builtFor = null;
      refs = null;
      return;
    }
    if (force || builtFor !== a.id || !refs) {
      clear(inspector);
      const label = h('input', {
        id: 'insp-label',
        class: 'ctl-text mono insp-label',
        type: 'text',
        'aria-label': t('arrows.label'),
        autocomplete: 'off',
        spellcheck: 'false',
      }) as HTMLInputElement;
      label.value = a.label;
      label.addEventListener('input', () => {
        if (api.selection.id) setScarLabel(api.store, api.selection.id, label.value);
      });
      const head = h(
        'div',
        { class: 'insp-head' },
        label,
        h('button', { type: 'button', class: 'icon-btn', id: 'insp-focus', title: t('arrows.focus'), 'aria-label': t('arrows.focus'), onclick: () => api.selection.id && api.focusArrow(api.selection.id) }, icon(ICONS.target)),
        h('button', { type: 'button', class: 'btn btn-danger btn-sm', id: 'insp-delete', title: `${t('arrows.delete')} (Delete)`, onclick: () => api.selection.id && deleteScar(api.store, api.selection.id) }, icon(ICONS.trash), t('arrows.delete')),
      );
      const fields = [...SCAR_FIELDS.map((f) => buildField(f, a)), sequenceField()];
      const coords = h('dl', { class: 'meta coords' });
      inspector.append(head, ...fields.map((f) => f.el), coords);
      refs = { label, setters: fields.map((f) => f.set), coords };
      builtFor = a.id;
    }
    softSet(refs.label, a.label);
    for (const set of refs.setters) set(a);
    clear(refs.coords);
    const u = st.specimen.unit;
    const p = (v: [number, number, number]) => `${fmtNum(v[0])}, ${fmtNum(v[1])}, ${fmtNum(v[2])}`;
    const v = a.vector;
    if (v)
      refs.coords.append(
        ...metaRow(t('arrows.start'), h('span', { class: 'mono' }, p(v.start))),
        ...metaRow(t('arrows.end'), h('span', { class: 'mono' }, p(v.end))),
        ...metaRow(t('arrows.length'), h('span', { class: 'mono' }, `${fmtNum(vectorLength(v))}${u ? ` ${u}` : ''}`)),
      );
  };

  const refresh = (kind: RefreshKind) => {
    if (kind === 'mesh' || kind === 'curves') return;
    renderList();
    if (kind !== 'display') renderInspector(kind === 'all');
  };
  refresh('all');
  return { el, refresh };
}

// ---------------------------------------------------------------- curves

function curvesSection(api: AppApi): Section {
  const badge = h('span', { class: 'badge mono' }, '0');
  const { el, body } = section('curves', t('sec.curves'), badge);
  const list = h('ol', { class: 'arrow-list', id: 'curve-list', role: 'listbox', 'aria-label': t('sec.curves') });
  const inspector = h('div', { class: 'inspector', id: 'curve-inspector' });
  body.append(list, inspector);

  let builtFor: string | null = null;
  let refs: { label: HTMLInputElement; setters: Array<(c: Curve) => void>; meta: HTMLElement } | null = null;

  const renderList = () => {
    const st = api.store.state;
    badge.textContent = String(st.curves.length);
    list.hidden = st.curves.length === 0;
    clear(list);
    const sel = api.selection.id;
    const unit = st.specimen.unit;
    for (const c of st.curves) {
      const isSel = c.id === sel;
      const color = isSel ? CURVE_COLORS.selected : curveColor(c);
      const li = h(
        'li',
        {
          class: 'arrow-row curve-row',
          role: 'option',
          'aria-selected': String(isSel),
          'data-id': c.id,
          onclick: () => api.selection.set(c.id),
          ondblclick: () => api.focusCurve(c.id),
        },
        h('span', { class: 'chip chip-line', style: `--chip:${color}` }),
        h('span', { class: 'arrow-id mono' }, c.label),
        h('span', { class: 'arrow-meta' }, listSummary(c.attributes, CURVE_FIELDS)),
        h('span', { class: 'arrow-len mono' }, `${fmtNum(curveLength(c), 1)}${unit ? ` ${unit}` : ''}`),
      );
      list.append(li);
      if (isSel) requestAnimationFrame(() => li.scrollIntoView({ block: 'nearest' }));
    }
  };

  const buildField = (f: FieldDef, c: Curve): { el: HTMLElement; set: (c: Curve) => void } => {
    const id = `curve-field-${f.key}`;
    const current = c.attributes[f.key];
    const onPick = (v: string) => {
      if (api.selection.id) setCurveAttribute(api.store, api.selection.id, f.key, v);
    };
    if (f.type === 'enum' && f.options) {
      const ctl = f.numberKeys
        ? optionList(id, tl(f.label), f.options.map((o, i) => ({ value: o.value, label: tl(o.label), key: i < 9 ? String(i + 1) : undefined })), String(current), onPick)
        : segmented(id, tl(f.label), f.options.map((o) => ({ value: o.value, label: tl(o.label) })), String(current), onPick);
      return { el: h('div', { class: 'field' }, ctl.el), set: (x) => ctl.set(String(x.attributes[f.key])) };
    }
    const row = textRow(id, tl(f.label), current === null || current === undefined ? '' : String(current), (v) => {
      if (api.selection.id) setCurveAttribute(api.store, api.selection.id, f.key, v);
    }, { multiline: true });
    return {
      el: h('div', { class: 'field' }, row.el),
      set: (x) => {
        const v = x.attributes[f.key];
        softSet(row.input, v === null || v === undefined ? '' : String(v));
      },
    };
  };

  const renderInspector = (force: boolean) => {
    const st = api.store.state;
    const id = api.selection.id;
    const c = id ? api.store.curve(id) : undefined;
    if (!c) {
      clear(inspector);
      builtFor = null;
      refs = null;
      return;
    }
    if (force || builtFor !== c.id || !refs) {
      clear(inspector);
      const label = h('input', {
        id: 'curve-insp-label',
        class: 'ctl-text mono insp-label',
        type: 'text',
        'aria-label': t('arrows.label'),
        autocomplete: 'off',
        spellcheck: 'false',
      }) as HTMLInputElement;
      label.value = c.label;
      label.addEventListener('input', () => {
        if (api.selection.id) setCurveLabel(api.store, api.selection.id, label.value);
      });
      const head = h(
        'div',
        { class: 'insp-head' },
        label,
        h('button', { type: 'button', class: 'icon-btn', id: 'curve-insp-focus', title: t('arrows.focus'), 'aria-label': t('arrows.focus'), onclick: () => api.selection.id && api.focusCurve(api.selection.id) }, icon(ICONS.target)),
        h('button', { type: 'button', class: 'btn btn-danger btn-sm', id: 'curve-insp-delete', title: `${t('arrows.delete')} (Delete)`, onclick: () => api.selection.id && deleteCurve(api.store, api.selection.id) }, icon(ICONS.trash), t('arrows.delete')),
      );
      const fields = CURVE_FIELDS.map((f) => buildField(f, c));
      const meta = h('dl', { class: 'meta coords' });
      inspector.append(head, ...fields.map((f) => f.el), meta);
      refs = { label, setters: fields.map((f) => f.set), meta };
      builtFor = c.id;
    }
    softSet(refs.label, c.label);
    for (const set of refs.setters) set(c);
    clear(refs.meta);
    const u = st.specimen.unit;
    refs.meta.append(
      ...metaRow(t('arrows.length'), h('span', { class: 'mono' }, `${fmtNum(curveLength(c))}${u ? ` ${u}` : ''}`)),
      ...metaRow(t('curves.closed'), t(c.closed ? 'curves.yes' : 'curves.no')),
    );
  };

  const refresh = (kind: RefreshKind) => {
    if (kind === 'mesh' || kind === 'arrows') return;
    renderList();
    if (kind !== 'display') renderInspector(kind === 'all');
  };
  refresh('all');
  return { el, refresh };
}

// ---------------------------------------------------------------- display

function displaySection(api: AppApi): Section {
  const { el, body } = section('display', t('sec.display'));
  const d = api.display;
  const shading = segmented('shading', t('display.shading'), [
    { value: 'plain', label: t('shading.plain') },
    { value: 'scan', label: t('shading.scan'), disabled: !api.hasScanColors() },
    { value: 'curvature', label: t('shading.curvature') },
  ], d.shading, (v) => api.setDisplay((x) => (x.shading = v as ShadingMode), 'shading'));
  const curvBusy = h('span', { class: 'busy-inline', hidden: true }, t('display.curvComputing'));
  const curvLegend = h('p', { class: 'field-hint legend' }, h('span', { class: 'legend-ramp', 'aria-hidden': 'true' }), t('display.curvLegend'), curvBusy);
  const curvScale = slider({
    id: 'curv-scale', label: t('display.curvScale'), min: 0, max: 100, step: 1, value: d.curvScale,
    format: (v) => String(v), onInput: (v) => api.setDisplay((x) => (x.curvScale = v), 'curvature'),
  });
  const curvContrast = slider({
    id: 'curv-contrast', label: t('display.curvContrast'), min: 0.3, max: 3, step: 0.1, value: d.curvContrast,
    format: (v) => `×${v.toFixed(1)}`, onInput: (v) => api.setDisplay((x) => (x.curvContrast = v), 'curvature'),
  });
  const curvGroup = h('div', { class: 'subgroup' }, curvLegend, curvScale.el, curvContrast.el);

  const az = slider({
    id: 'light-az', label: t('display.lightAz'), min: 0, max: 360, step: 1, value: d.light.azimuthDeg,
    format: (v) => `${Math.round(v)}°`, onInput: (v) => api.setDisplay((x) => (x.light.azimuthDeg = v), 'light'),
  });
  const elv = slider({
    id: 'light-el', label: t('display.lightEl'), min: 5, max: 90, step: 1, value: d.light.elevationDeg,
    format: (v) => `${Math.round(v)}°`, onInput: (v) => api.setDisplay((x) => (x.light.elevationDeg = v), 'light'),
  });
  const fill = slider({
    id: 'light-fill', label: t('display.fill'), min: 0, max: 1.5, step: 0.05, value: d.light.fillIntensity,
    format: (v) => v.toFixed(2), onInput: (v) => api.setDisplay((x) => (x.light.fillIntensity = v), 'light'),
  });
  const gloss = slider({
    id: 'gloss', label: t('display.gloss'), min: 0, max: 1, step: 0.05, value: d.gloss,
    format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => api.setDisplay((x) => (x.gloss = v), 'light'),
  });
  const background = segmented('background', t('display.background'), [
    { value: 'light', label: t('bg.light') },
    { value: 'dark', label: t('bg.dark') },
  ], d.background, (v) => api.setDisplay((x) => (x.background = v as ViewportBackground), 'background'));

  const thickness = slider({
    id: 'arrow-thickness', label: t('display.arrowSize'), min: 0.4, max: 3, step: 0.1, value: d.arrows.thickness,
    format: (v) => `×${v.toFixed(1)}`, onInput: (v) => api.setDisplay((x) => (x.arrows.thickness = v), 'arrows'),
  });
  const colorMode = selectRow('arrow-color', t('display.arrowColor'), [
    { value: 'uniform', label: t('color.uniform') },
    { value: 'completeness', label: t('color.completeness') },
    { value: 'certainty', label: t('color.certainty') },
    { value: 'direction', label: t('color.direction') },
    { value: 'sequence', label: t('color.sequence') },
  ], d.arrows.colorMode, (v) => api.setDisplay((x) => (x.arrows.colorMode = v as ArrowColorMode), 'arrows'));
  const labels = checkbox('arrow-labels', t('display.labels'), d.arrows.labels, (v) => api.setDisplay((x) => (x.arrows.labels = v), 'arrows'));
  const hidden = checkbox('arrow-hidden', t('display.hidden'), d.arrows.showHidden, (v) => api.setDisplay((x) => (x.arrows.showHidden = v), 'arrows'));
  const regions = checkbox('display-regions', t('display.regions'), d.regions, (v) => api.setDisplay((x) => (x.regions = v), 'regions'));

  body.append(
    shading.el,
    curvGroup,
    h('div', { class: 'ctl-grid' }, az.el, elv.el, fill.el, gloss.el),
    background.el,
    h('hr', { class: 'rule' }),
    h('div', { class: 'ctl-grid' }, thickness.el, colorMode.el),
    h('div', { class: 'check-row' }, labels, hidden, regions),
  );

  const refresh = (kind: RefreshKind) => {
    if (kind !== 'all' && kind !== 'display' && kind !== 'mesh') return;
    shading.set(api.display.shading);
    const scanBtn = shading.el.querySelector('[data-value="scan"]') as HTMLButtonElement | null;
    if (scanBtn) scanBtn.disabled = !api.hasScanColors();
    curvGroup.hidden = api.display.shading !== 'curvature';
    curvBusy.hidden = !api.curvatureBusy();
    az.set(api.display.light.azimuthDeg);
    elv.set(api.display.light.elevationDeg);
    background.set(api.display.background);
  };
  refresh('all');
  return { el, refresh };
}

// ---------------------------------------------------------------- measure mode

/** "12.345 mm²" (the unit is left out when it is not stated). */
const withUnit = (v: number, digits: number, unit: string, power = 1): string =>
  `${fmtNum(v, digits)}${unit ? ` ${unit}${power === 2 ? '²' : power === 3 ? '³' : ''}` : ''}`;

function measureAutoSection(api: AppApi): Section {
  const { el, body } = section('measure-auto', t('sec.measureAuto'));
  const meta = h('dl', { class: 'meta measure-auto', id: 'measure-auto' });
  body.append(meta);
  const row = (id: string, term: string, value: string) => [h('dt', {}, term), h('dd', { id: `auto-${id}`, class: 'mono' }, value)];
  const refresh = (kind: RefreshKind) => {
    if (!['all', 'mesh', 'measure', 'specimen'].includes(kind)) return;
    clear(meta);
    const m = api.autoMeasurements();
    if (!m) {
      if (api.measuringBusy()) meta.append(h('dt', {}, t('measure.busy')), h('dd', {}));
      return;
    }
    const u = api.store.state.specimen.unit;
    const open = t('measure.notClosed');
    meta.append(
      ...row('length', t('measure.length'), withUnit(m.length, 3, u)),
      ...row('width', t('measure.width'), withUnit(m.width, 3, u)),
      ...row('thickness', t('measure.thickness'), withUnit(m.thickness, 3, u)),
      ...row('frame', t('measure.axes'), t(`measure.axes.${m.frame}`)),
      ...row('area', t('measure.area'), withUnit(m.surfaceArea, 2, u, 2)),
      ...row('volume', t('measure.volume'), m.volume === null ? open : withUnit(m.volume, 2, u, 3)),
      ...row('svr', t('measure.svr'), m.surfaceToVolumeRatio === null ? '–' : fmtNum(m.surfaceToVolumeRatio, 3)),
      ...row('sphericity', t('measure.sphericity'), m.wadellSphericity === null ? '–' : fmtNum(m.wadellSphericity, 3)),
    );
  };
  refresh('all');
  return { el, refresh };
}

function measureManualSection(api: AppApi): Section {
  const badge = h('span', { class: 'badge mono' }, '0');
  const { el, body } = section('measure-manual', t('sec.measureManual'), badge);
  const list = h('ol', { class: 'arrow-list', id: 'measure-list', role: 'listbox', 'aria-label': t('sec.measureManual') });
  const del = h('button', { type: 'button', class: 'btn btn-danger btn-sm', id: 'measure-delete', title: `${t('arrows.delete')} (Delete)`, onclick: () => api.selection.id && deleteMeasurement(api.store, api.selection.id) }, icon(ICONS.trash), t('arrows.delete')) as HTMLButtonElement;
  const actions = h('div', { class: 'btn-row' }, del);
  body.append(list, actions);
  const refresh = (kind: RefreshKind) => {
    if (!['all', 'measurements', 'selection', 'specimen'].includes(kind)) return;
    const st = api.store.state;
    badge.textContent = String(st.measurements.length);
    list.hidden = st.measurements.length === 0;
    clear(list);
    const sel = api.selection.id;
    for (const m of st.measurements) {
      const isSel = m.id === sel;
      list.append(
        h(
          'li',
          { class: 'arrow-row measure-row', role: 'option', 'aria-selected': String(isSel), 'data-id': m.id, onclick: () => api.selection.set(m.id) },
          h('span', { class: 'chip chip-line', style: `--chip:${isSel ? MEASURE_COLORS.selected : MEASURE_COLORS.line}` }),
          h('span', { class: 'arrow-id mono' }, m.label),
          h('span', { class: 'arrow-meta' }, t(`measure.type.${m.type}`)),
          h('span', { class: 'arrow-len mono' }, api.formatMeasurement(m)),
        ),
      );
    }
    const selected = !!(sel && api.store.measurement(sel));
    actions.hidden = !selected;
  };
  refresh('all');
  return { el, refresh };
}

const PLANE_METHODS: PlaneMethod[] = ['all_vertices', 'scar_directions', 'scar_starts', 'curves'];

function planesSection(api: AppApi): Section {
  const badge = h('span', { class: 'badge mono' }, '0');
  const { el, body } = section('planes', t('sec.planes'), badge);
  const add = h('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'plane-add', onclick: () => api.addPlane() }, icon(ICONS.plus), t('plane.add')) as HTMLButtonElement;
  const list = h('ol', { class: 'arrow-list', id: 'plane-list', role: 'listbox', 'aria-label': t('sec.planes') });
  const inspector = h('div', { class: 'inspector', id: 'plane-inspector' });
  body.append(list, h('div', { class: 'btn-row' }, add), inspector);

  const renderInspector = () => {
    clear(inspector);
    const id = api.selection.id;
    const p = id ? api.store.plane(id) : undefined;
    if (!p) return;
    const method = selectRow('plane-method', t('plane.method'), PLANE_METHODS.map((m) => ({ value: m, label: t(`plane.method.${m}`) })), p.method, (v) =>
      setPlaneMethod(api.store, p.id, v as PlaneMethod),
    );
    const inputs = h('div', { class: 'plane-inputs', id: 'plane-inputs' });
    if (p.method === 'scar_starts') {
      const f = SCAR_FIELDS.find((x) => x.key === 'completeness');
      for (const o of f?.options ?? []) {
        const box = checkbox(`plane-use-${o.value}`, tl(o.label), !p.excludeCompleteness.includes(o.value), (on) => setPlaneExclusion(api.store, p.id, o.value, !on));
        inputs.append(box);
      }
    } else if (p.method === 'curves') {
      for (const c of api.store.state.curves) {
        const type = CURVE_FIELDS.find((f) => f.key === 'type')?.options?.find((o) => o.value === c.attributes.type);
        inputs.append(checkbox(`plane-curve-${c.id}`, type ? `${c.label} · ${tl(type.label)}` : c.label, p.curveIds.includes(c.id), (on) => setPlaneCurve(api.store, p.id, c.id, on)));
      }
    }
    const actions = h(
      'div',
      { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'plane-flip', onclick: () => flipPlane(api.store, p.id) }, t('plane.flip')),
      h('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'plane-view', onclick: () => api.viewAlongPlane(p.id) }, icon(ICONS.target), t('plane.view')),
      h('button', { type: 'button', class: 'btn btn-danger btn-sm', id: 'plane-delete', title: `${t('arrows.delete')} (Delete)`, onclick: () => deletePlane(api.store, p.id) }, icon(ICONS.trash), t('arrows.delete')),
    );
    inspector.append(method.el, inputs, actions);
  };

  const refresh = (kind: RefreshKind) => {
    if (!['all', 'planes', 'selection', 'mesh', 'arrows', 'curves'].includes(kind)) return;
    const st = api.store.state;
    const results = api.planeResults();
    badge.textContent = String(st.planes.length);
    add.disabled = !api.hasMesh();
    list.hidden = st.planes.length === 0;
    clear(list);
    const sel = api.selection.id;
    for (const p of st.planes) {
      const r = results.find((x) => x.id === p.id);
      const isSel = p.id === sel;
      const eye = h('input', { type: 'checkbox', class: 'plane-eye', title: t('plane.show'), 'aria-label': `${t('plane.show')} ${p.label}` }) as HTMLInputElement;
      eye.checked = p.visible;
      eye.addEventListener('click', (e) => e.stopPropagation());
      eye.addEventListener('change', () => setPlaneVisible(api.store, p.id, eye.checked));
      list.append(
        h(
          'li',
          { class: 'arrow-row plane-row', role: 'option', 'aria-selected': String(isSel), 'data-id': p.id, onclick: () => api.selection.set(p.id), ondblclick: () => api.viewAlongPlane(p.id) },
          h('span', { class: 'chip', style: `--chip:${planeColor(p.label)}` }),
          h('span', { class: 'arrow-id mono' }, p.label),
          h('span', { class: 'arrow-meta' }, t(`plane.short.${p.method}`)),
          h('span', { class: 'arrow-len' }, r && !r.valid ? t('plane.invalid') : ''),
          eye,
        ),
      );
    }
    renderInspector();
  };
  refresh('all');
  return { el, refresh };
}

function orientationSection(api: AppApi): Section {
  const { el, body } = section('orientation', t('sec.orientation'));
  const status = h('dl', { class: 'meta' });
  const btn = (id: string, label: string, onclick: () => void, kind = 'btn-quiet') =>
    h('button', { type: 'button', class: `btn ${kind} btn-sm`, id, onclick }, label) as HTMLButtonElement;
  const fromView = btn('frame-from-view', t('frame.fromView'), () => api.setFrameFromView(), 'btn-primary');
  const planeSel = h('select', { id: 'frame-plane', class: 'ctl-select', 'aria-label': t('sec.planes') }) as HTMLSelectElement;
  const fromPlane = btn('frame-from-plane', t('frame.fromPlane'), () => planeSel.value && api.setFrameFromPlane(planeSel.value));
  const arrowSel = h('select', { id: 'frame-arrow', class: 'ctl-select', 'aria-label': t('sec.arrows') }) as HTMLSelectElement;
  const vertical = btn('frame-vertical', t('frame.vertical'), () => arrowSel.value && api.setFrameVertical(arrowSel.value));
  const ccw = btn('frame-rot-ccw', t('frame.ccw'), () => api.turnFrame(90));
  const cw = btn('frame-rot-cw', t('frame.cw'), () => api.turnFrame(-90));
  // fine turning: keep turning the frame the slider started from, then let the slider go back to 0
  let fineBase: number[] | null = null;
  const fine = slider({
    id: 'frame-fine',
    label: t('frame.fine'),
    min: -45,
    max: 45,
    step: 0.5,
    value: 0,
    format: (v) => `${v > 0 ? '+' : ''}${v}°`,
    onInput: (v) => {
      const f = api.store.state.specimen.frame;
      if (!f) return;
      fineBase ??= [...f.matrix];
      api.turnFrame(-v, fineBase);
    },
  });
  fine.el.querySelector('input')?.addEventListener('change', () => {
    fineBase = null;
    fine.set(0);
  });
  const view = btn('frame-view', t('frame.view'), () => api.viewFrame());
  const clearBtn = btn('frame-clear', t('frame.clear'), () => api.clearFrame(), 'btn-danger');
  const planeRow = h('div', { class: 'btn-row frame-pick' }, planeSel, fromPlane);
  const arrowRow = h('div', { class: 'btn-row frame-pick' }, arrowSel, vertical);
  body.append(
    status,
    h('div', { class: 'btn-row' }, fromView),
    planeRow,
    arrowRow,
    h('div', { class: 'btn-row' }, ccw, cw),
    fine.el,
    h('div', { class: 'btn-row' }, view, clearBtn),
  );
  const options = (sel: HTMLSelectElement, items: Array<[string, string]>) => {
    const keep = sel.value;
    clear(sel);
    for (const [value, label] of items) sel.append(h('option', { value }, label));
    if (items.some(([v]) => v === keep)) sel.value = keep;
  };
  const refresh = (kind: RefreshKind) => {
    if (!['all', 'mesh', 'specimen', 'planes', 'arrows'].includes(kind)) return;
    const st = api.store.state;
    const f = st.specimen.frame;
    clear(status);
    status.append(...metaRow(t('frame.source'), h('span', { class: 'mono', id: 'frame-status' }, f ? f.source : t('frame.none'))));
    options(planeSel, api.planeResults().filter((p) => p.valid).map((p) => [p.id, p.label]));
    options(arrowSel, st.scars.filter((s) => s.vector).map((s) => [s.id, s.label]));
    fromView.disabled = !api.hasMesh();
    planeRow.hidden = planeSel.options.length === 0;
    arrowRow.hidden = arrowSel.options.length === 0;
    vertical.disabled = !f;
    for (const b of [ccw, cw, view, clearBtn]) b.disabled = !f;
    (fine.el.querySelector('input') as HTMLInputElement).disabled = !f;
  };
  refresh('all');
  return { el, refresh };
}

function figureSection(api: AppApi): Section {
  const { el, body } = section('figure', t('sec.figure'));
  const views = h('div', { class: 'fig-views', role: 'group', 'aria-label': t('figure.views') });
  const viewBoxes = FIGURE_VIEWS.map((v) => {
    const box = checkbox(`fig-view-${v}`, t(`figure.view.${v}`), api.figure.views.includes(v), (on) =>
      api.setFigure((f) => {
        f.views = FIGURE_VIEWS.filter((x) => (x === v ? on : f.views.includes(x)));
      }),
    );
    views.append(box);
    return box.querySelector('input') as HTMLInputElement;
  });
  const light = slider({
    id: 'fig-light',
    label: t('figure.light'),
    min: 5,
    max: 85,
    step: 1,
    value: api.figure.lightElevation,
    format: (v) => `${v}°`,
    onInput: (v) => api.setFigure((f) => (f.lightElevation = v)),
  });
  const overlay = (id: string, key: 'arrows' | 'curves' | 'planes' | 'regions' | 'landmarks' | 'scaleBar', label: string) =>
    checkbox(id, label, api.figure.overlays[key], (on) => api.setFigure((f) => (f.overlays[key] = on)));
  const scaleBarEl = overlay('fig-scalebar', 'scaleBar', t('figure.scaleBar'));
  const overlays = h(
    'div',
    { class: 'fig-views', role: 'group', 'aria-label': t('figure.overlays') },
    overlay('fig-arrows', 'arrows', t('figure.arrows')),
    overlay('fig-curves', 'curves', t('figure.curves')),
    overlay('fig-planes', 'planes', t('figure.planes')),
    overlay('fig-regions', 'regions', t('figure.regions')),
    overlay('fig-landmarks', 'landmarks', t('figure.landmarks')),
    scaleBarEl,
  );
  const scale = segmented('fig-scale', t('figure.scale'), [
    { value: '0.5', label: '1:2' },
    { value: '1', label: '1:1' },
    { value: '2', label: '2:1' },
  ], String(api.figure.scale), (v) => api.setFigure((f) => (f.scale = Number(v))));
  const dpi = segmented('fig-dpi', t('figure.dpi'), [300, 600, 1200].map((d) => ({ value: String(d), label: `${d} dpi` })), String(api.figure.dpi), (v) =>
    api.setFigure((f) => (f.dpi = Number(v))),
  );
  const sizeEl = h('dl', { class: 'meta' });
  const png = h('button', { type: 'button', class: 'btn btn-primary', id: 'fig-png', onclick: () => api.exportFigure('png') }, 'PNG') as HTMLButtonElement;
  const svg = h('button', { type: 'button', class: 'btn btn-primary', id: 'fig-svg', onclick: () => api.exportFigure('svg') }, 'SVG') as HTMLButtonElement;
  body.append(views, light.el, overlays, h('div', { class: 'ctl-grid' }, scale.el, dpi.el), sizeEl, h('div', { class: 'btn-row' }, png, svg));
  const refresh = (kind: RefreshKind) => {
    if (!['all', 'mesh', 'figure', 'specimen', 'sections'].includes(kind)) return;
    const f = api.figure;
    viewBoxes.forEach((b, i) => (b.checked = f.views.includes(FIGURE_VIEWS[i])));
    light.set(f.lightElevation);
    scale.set(String(f.scale));
    dpi.set(String(f.dpi));
    // without a stated unit there is no physical scale
    const unitStated = !!api.store.state.specimen.unit;
    (scaleBarEl.querySelector('input') as HTMLInputElement).disabled = !unitStated;
    for (const b of scale.el.querySelectorAll('button')) (b as HTMLButtonElement).disabled = !unitStated;
    for (const b of dpi.el.querySelectorAll('button')) (b as HTMLButtonElement).disabled = !unitStated;
    png.disabled = svg.disabled = !api.hasMesh() || (!f.views.length && !api.store.state.sections.some((x) => x.inFigure));
    clear(sizeEl);
    const layout = api.hasMesh() && api.mode === 'present' ? api.figureLayout() : null;
    if (layout) {
      const size = layout.mmPerPx ? `${fmtNum(layout.width * layout.mmPerPx, 0)} × ${fmtNum(layout.height * layout.mmPerPx, 0)} mm · ` : '';
      sizeEl.append(...metaRow(t('figure.size'), h('span', { class: 'mono', id: 'fig-size' }, `${size}${layout.width} × ${layout.height} px`)));
    }
  };
  refresh('all');
  return { el, refresh };
}

function regionsSection(api: AppApi, setType: (id: string, type: string) => void): Section {
  const badge = h('span', { class: 'badge mono' }, '0');
  const { el, body } = section('regions', t('sec.regions'), badge);
  const list = h('ol', { class: 'arrow-list', id: 'region-list', role: 'listbox', 'aria-label': t('sec.regions') });
  const inspector = h('div', { class: 'inspector', id: 'region-inspector' });
  const totals = h('dl', { class: 'meta', id: 'region-totals' });
  body.append(list, inspector, totals);
  const typeField = REGION_FIELDS[0];
  const refresh = (kind: RefreshKind) => {
    if (!['all', 'regions', 'selection', 'specimen', 'arrows', 'sequences', 'display', 'mesh'].includes(kind)) return;
    const st = api.store.state;
    const info = api.regionInfo();
    const u = st.specimen.unit;
    const area = (v: number | null) => (v === null ? '–' : `${fmtNum(v, 2)}${u ? ` ${u}²` : ''}`);
    badge.textContent = String(st.regions.length);
    list.hidden = st.regions.length === 0;
    clear(list);
    const sel = api.selection.id;
    const seq = api.display.arrows.colorMode === 'sequence' ? sequenceColors(st.sequences) : null;
    for (const r of st.regions) {
      const res = info?.results.find((x) => x.id === r.id);
      const scar = r.scarId ? st.scars.find((s) => s.id === r.scarId)?.label ?? null : null;
      const isSel = r.id === sel;
      const opt = typeField.options!.find((o) => o.value === r.type)!;
      list.append(
        h(
          'li',
          { class: 'arrow-row region-row', role: 'option', 'aria-selected': String(isSel), 'data-id': r.id, onclick: () => api.selection.set(r.id) },
          h('span', { class: 'chip', style: `--chip:${regionColorOf(r, st.scars, seq)}` }),
          h('span', { class: 'arrow-id mono' }, r.label),
          h('span', { class: 'arrow-meta' }, `${tl(opt.label)}${scar ? ` · ${scar}` : ''}${res?.conflict ? ` · ${t('region.conflict')}` : ''}`),
          h('span', { class: 'arrow-len mono' }, area(res?.area ?? null)),
        ),
      );
    }
    clear(inspector);
    const r = sel ? api.store.region(sel) : undefined;
    if (r) {
      const ctl = optionList('region-type', tl(typeField.label), typeField.options!.map((o, i) => ({ value: o.value, label: tl(o.label), key: String(i + 1) })), r.type, (v) => setType(r.id, v));
      inspector.append(
        ctl.el,
        h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-danger btn-sm', id: 'region-delete', title: `${t('arrows.delete')} (Delete)`, onclick: () => deleteRegion(api.store, r.id) }, icon(ICONS.trash), t('arrows.delete'))),
      );
    }
    clear(totals);
    totals.hidden = !info || st.regions.length === 0;
    if (info && st.regions.length) {
      for (const k of ['scar', 'cortex', 'joint', 'damage'] as const)
        totals.append(h('dt', {}, t(`region.area.${k}`)), h('dd', { class: 'mono', id: `region-total-${k}` }, area(info.totals[k])));
      totals.append(h('dt', {}, t('region.cortexRatio')), h('dd', { class: 'mono', id: 'region-cortex-ratio' }, fmtNum(info.totals.cortexRatio, 3)));
    }
  };
  refresh('all');
  return { el, refresh };
}

function relationsSection(api: AppApi): Section {
  const badge = h('span', { class: 'badge mono' }, '0');
  const { el, body } = section('relations', t('sec.relations'), badge);
  const checks = h('button', { type: 'button', class: 'btn btn-quiet btn-sm problem-toggle mono', id: 'relation-problems', onclick: () => api.setProblems(!api.problemsOpen) }) as HTMLButtonElement;
  const problems = h('ol', { class: 'problem-list', id: 'relation-problem-list' });
  const list = h('ol', { class: 'arrow-list', id: 'relation-list', role: 'listbox', 'aria-label': t('sec.relations') });
  const inspector = h('div', { class: 'inspector', id: 'relation-inspector' });
  const addSeq = h('button', { type: 'button', class: 'icon-btn', id: 'sequence-add', title: t('sequence.add'), 'aria-label': t('sequence.add'), onclick: () => api.selection.set(addSequence(api.store).id) }, icon(ICONS.plus));
  const seqList = h('ol', { class: 'arrow-list', id: 'sequence-list', role: 'listbox', 'aria-label': t('sequence.title') });
  const seqInspector = h('div', { class: 'inspector', id: 'sequence-inspector' });
  const harris = checkbox('harris-show', t('harris.title'), api.display.harris, (on) => api.setDisplay((d) => (d.harris = on), 'harris'));
  body.append(
    h('div', { class: 'checks-row' }, h('span', { class: 'ctl-label' }, t('relation.checks')), checks),
    problems,
    list,
    inspector,
    h('div', { class: 'checks-row' }, h('span', { class: 'ctl-label' }, t('sequence.title')), addSeq),
    seqList,
    seqInspector,
    harris,
  );

  const scarLabel = (id: string) => api.store.scar(id)?.label ?? '?';
  const seqLabel = (id: string) => api.store.sequence(id)?.label ?? '?';
  const relationText = (r: { a: string; b: string; kind: string }) =>
    r.kind === 'a_cuts_b' ? t('relation.cuts', { a: scarLabel(r.a), b: scarLabel(r.b) }) : t('relation.pairUnknown', { a: scarLabel(r.a), b: scarLabel(r.b) });
  const problemText = (p: RelationProblem): string => {
    switch (p.kind) {
      case 'cycle':
        return t('relation.problem.cycle', { list: p.scars.map(scarLabel).join(' · ') });
      case 'sequence':
        return t('relation.problem.sequence', { a: scarLabel(p.scars[0]), b: scarLabel(p.scars[1]), qa: seqLabel(p.sequences[0]), qb: seqLabel(p.sequences[1]) });
      case 'order':
        return t('relation.problem.order', { a: scarLabel(p.scars[0]), b: scarLabel(p.scars[1]), q: seqLabel(p.sequence) });
      default:
        return t('relation.problem.unassigned', { list: p.scars.map(scarLabel).join(' · ') });
    }
  };

  let seqBuiltFor: string | null = null;
  let seqLabelInput: HTMLInputElement | null = null;

  const renderSequence = () => {
    const st = api.store.state;
    const sel = api.selection.id;
    const q = sel ? api.store.sequence(sel) : undefined;
    if (!q) {
      clear(seqInspector);
      seqBuiltFor = null;
      seqLabelInput = null;
      return;
    }
    if (seqBuiltFor !== q.id || !seqLabelInput) {
      clear(seqInspector);
      const row = textRow('sequence-label', t('sequence.label'), q.label, (v) => updateSequence(api.store, q.id, { label: v }), { mono: true });
      seqLabelInput = row.input as HTMLInputElement;
      seqInspector.append(row.el, h('div', { class: 'seq-body' }));
      seqBuiltFor = q.id;
    }
    softSet(seqLabelInput, q.label);
    const holder = seqInspector.querySelector('.seq-body') as HTMLElement;
    clear(holder);
    const i = st.sequences.indexOf(q);
    const colors = sequenceColors(st.sequences);
    const members = h('ol', { class: 'arrow-list', id: 'sequence-members' });
    q.scarIds.forEach((id, k) => {
      const tools = q.ordered
        ? [
            h('button', { type: 'button', class: 'icon-btn', 'data-act': 'up', title: t('sequence.earlier'), 'aria-label': t('sequence.earlier'), disabled: k === 0, onclick: (e: Event) => (e.stopPropagation(), moveInSequence(api.store, id, -1)) }, icon(ICONS.up)),
            h('button', { type: 'button', class: 'icon-btn', 'data-act': 'down', title: t('sequence.later'), 'aria-label': t('sequence.later'), disabled: k === q.scarIds.length - 1, onclick: (e: Event) => (e.stopPropagation(), moveInSequence(api.store, id, 1)) }, icon(ICONS.down)),
          ]
        : [];
      members.append(
        h(
          'li',
          { class: 'arrow-row member-row', 'data-id': id, onclick: () => api.selection.set(id) },
          h('span', { class: 'chip', style: `--chip:${colors.get(id)}` }),
          h('span', { class: 'arrow-id mono' }, scarLabel(id)),
          h('span', { class: 'member-tools' }, ...tools, h('button', { type: 'button', class: 'icon-btn', 'data-act': 'remove', title: t('sequence.remove'), 'aria-label': t('sequence.remove'), onclick: (e: Event) => (e.stopPropagation(), setScarSequence(api.store, id, null)) }, icon(ICONS.close))),
        ),
      );
    });
    members.hidden = q.scarIds.length === 0;
    holder.append(
      checkbox('sequence-ordered', t('sequence.ordered'), q.ordered, (on) => updateSequence(api.store, q.id, { ordered: on })),
      members,
      h(
        'div',
        { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'sequence-earlier', disabled: i === 0, onclick: () => moveSequence(api.store, q.id, -1) }, icon(ICONS.up), t('sequence.earlier')),
        h('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'sequence-later', disabled: i === st.sequences.length - 1, onclick: () => moveSequence(api.store, q.id, 1) }, icon(ICONS.down), t('sequence.later')),
        h('button', { type: 'button', class: 'btn btn-danger btn-sm', id: 'sequence-delete', title: `${t('arrows.delete')} (Delete)`, onclick: () => deleteSequence(api.store, q.id) }, icon(ICONS.trash), t('arrows.delete')),
      ),
    );
  };

  const refresh = (kind: RefreshKind) => {
    if (!['all', 'relations', 'sequences', 'arrows', 'selection', 'display', 'mesh'].includes(kind)) return;
    const st = api.store.state;
    const sel = api.selection.id;
    badge.textContent = String(st.relations.length);
    // checks
    const found = relationProblems(api.relationChecks());
    checks.textContent = found.length ? `⚠ ${found.length}` : '✓';
    checks.classList.toggle('is-warn', found.length > 0);
    checks.disabled = found.length === 0;
    checks.setAttribute('aria-expanded', String(api.problemsOpen && found.length > 0));
    clear(problems);
    problems.hidden = !api.problemsOpen || !found.length;
    const focus = api.problemFocus();
    found.forEach((p, i) =>
      problems.append(h('li', { class: `problem-item${focus === i ? ' is-focused' : ''}`, 'data-kind': p.kind, onclick: () => api.setProblems(true, focus === i ? null : i) }, problemText(p))),
    );
    // relations
    clear(list);
    list.hidden = st.relations.length === 0;
    for (const r of st.relations)
      list.append(h('li', { class: 'arrow-row relation-row', role: 'option', 'aria-selected': String(r.id === sel), 'data-id': r.id, onclick: () => api.selection.set(r.id) }, h('span', { class: 'arrow-meta' }, relationText(r))));
    clear(inspector);
    const r = sel ? api.store.relation(sel) : undefined;
    if (r) {
      const A = scarLabel(r.a), B = scarLabel(r.b);
      const value = r.kind === 'indeterminate' ? 'ind' : 'ab';
      const kind = segmented('relation-kind', null, [
        { value: 'ab', label: t('relation.cuts', { a: A, b: B }) },
        { value: 'ba', label: t('relation.cuts', { a: B, b: A }) },
        { value: 'ind', label: t('relation.indeterminate') },
      ], value, (v) => {
        if (v === 'ab') setRelation(api.store, r.a, r.b, 'a_cuts_b');
        else if (v === 'ba') setRelation(api.store, r.b, r.a, 'a_cuts_b');
        else setRelation(api.store, r.a, r.b, 'indeterminate');
      });
      inspector.append(kind.el, h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-danger btn-sm', id: 'relation-delete', title: `${t('arrows.delete')} (Delete)`, onclick: () => deleteRelation(api.store, r.id) }, icon(ICONS.trash), t('arrows.delete'))));
    }
    // sequences
    clear(seqList);
    seqList.hidden = st.sequences.length === 0;
    st.sequences.forEach((q, i) =>
      seqList.append(
        h(
          'li',
          { class: 'arrow-row sequence-row', role: 'option', 'aria-selected': String(q.id === sel), 'data-id': q.id, onclick: () => api.selection.set(q.id) },
          h('span', { class: 'chip', style: `--chip:${sequenceSwatch(i)}` }),
          h('span', { class: 'arrow-id mono' }, q.label),
          h('span', { class: 'arrow-meta' }, q.scarIds.map(scarLabel).join(q.ordered ? ' → ' : ' · ')),
          h('span', { class: 'arrow-len mono' }, String(q.scarIds.length)),
        ),
      ),
    );
    renderSequence();
    (harris.querySelector('input') as HTMLInputElement).checked = api.display.harris;
  };
  refresh('all');
  return { el, refresh };
}

function landmarksSection(api: AppApi): Section {
  const badge = h('span', { class: 'badge mono' }, '0');
  const { el, body } = section('landmarks', t('sec.landmarks'), badge);
  const names = h('div', { class: 'checks-row', id: 'landmark-names' });
  const list = h('ol', { class: 'arrow-list', id: 'landmark-list', role: 'listbox', 'aria-label': t('sec.landmarks') });
  const inspector = h('div', { class: 'inspector', id: 'landmark-inspector' });
  const addSet = h('button', { type: 'button', class: 'icon-btn', id: 'semilandmark-add', title: t('semi.add'), 'aria-label': t('semi.add'), onclick: () => {
    const st = api.store.state;
    const sel = api.selection.id;
    const curve = (sel && api.store.curve(sel)) || st.curves[0];
    if (curve) api.selection.set(addSemilandmarkSet(api.store, curve.id).id);
  } }) as HTMLButtonElement;
  addSet.append(icon(ICONS.plus));
  const setList = h('ol', { class: 'arrow-list', id: 'semilandmark-list', role: 'listbox', 'aria-label': t('semi.title') });
  const setInspector = h('div', { class: 'inspector', id: 'semilandmark-inspector' });
  body.append(names, list, inspector, h('div', { class: 'checks-row' }, h('span', { class: 'ctl-label' }, t('semi.title')), addSet), setList, setInspector);

  let dragId: string | null = null;
  let builtFor: string | null = null;
  let nameInput: HTMLInputElement | null = null;
  let setBuiltFor: string | null = null;
  let countInput: HTMLInputElement | null = null;

  const select = (id: string, label: string, options: Array<[string, string]>, value: string, onChange: (v: string) => void) => {
    const sel = h('select', { id, class: 'ctl-select' }, ...options.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value));
    return h('div', { class: 'ctl' }, h('label', { class: 'ctl-label', for: id }, label), sel);
  };

  const refresh = (kind: RefreshKind) => {
    if (!['all', 'landmarks', 'curves', 'selection', 'mesh'].includes(kind)) return;
    const st = api.store.state;
    const sel = api.selection.id;
    const table = api.landmarkTable();
    badge.textContent = String(st.landmarks.length);

    // names carried over from the last specimen
    clear(names);
    const queue = api.nameQueue();
    if (queue) {
      names.append(
        h('span', { class: 'ctl-label' }, t('landmark.next')),
        h('span', { class: 'mono landmark-next', id: 'landmark-next-name' }, queue.next ?? '–'),
        h('span', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'landmark-skip-name', disabled: !queue.next, onclick: () => api.skipName() }, t('landmark.skip')),
          h('button', { type: 'button', class: 'icon-btn', id: 'landmark-stop-names', title: t('landmark.stopNames'), 'aria-label': t('landmark.stopNames'), onclick: () => api.stopNames() }, icon(ICONS.close))),
      );
    } else {
      names.append(h('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'landmark-reuse-names', disabled: !api.hasMesh() || !api.previousNames().length, onclick: () => api.reuseNames() }, t('landmark.reuseNames')));
    }

    // fixed landmarks, in export order (drag to reorder)
    clear(list);
    list.hidden = st.landmarks.length === 0;
    st.landmarks.forEach((l, i) => {
      const li = h(
        'li',
        { class: 'arrow-row landmark-row', role: 'option', 'aria-selected': String(l.id === sel), 'data-id': l.id, draggable: 'true', onclick: () => api.selection.set(l.id) },
        h('span', { class: 'chip chip-dot', style: `--chip:${l.id === sel ? LANDMARK_COLORS.selected : LANDMARK_COLORS.fixed}` }),
        h('span', { class: 'arrow-id mono' }, String(i + 1)),
        h('span', { class: 'arrow-meta' }, l.name),
      );
      li.addEventListener('dragstart', (e) => {
        dragId = l.id;
        e.dataTransfer?.setData('text/plain', l.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      li.addEventListener('dragover', (e) => {
        if (!dragId) return;
        e.preventDefault();
        li.classList.add('is-drop');
      });
      li.addEventListener('dragleave', () => li.classList.remove('is-drop'));
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        li.classList.remove('is-drop');
        const id = dragId;
        dragId = null;
        if (id && id !== l.id) reorderLandmark(api.store, id, i);
      });
      li.addEventListener('dragend', () => (dragId = null));
      list.append(li);
    });

    const l = sel ? api.store.landmark(sel) : undefined;
    if (!l) {
      clear(inspector);
      builtFor = null;
      nameInput = null;
    } else {
      if (builtFor !== l.id || !nameInput) {
        clear(inspector);
        const row = textRow('landmark-name', t('landmark.name'), l.name, (v) => renameLandmark(api.store, l.id, v));
        nameInput = row.input as HTMLInputElement;
        inspector.append(row.el, h('div', { class: 'landmark-body' }));
        builtFor = l.id;
      }
      softSet(nameInput, l.name);
      const holder = inspector.querySelector('.landmark-body') as HTMLElement;
      clear(holder);
      const i = st.landmarks.indexOf(l);
      const p = l.point;
      holder.append(
        h('dl', { class: 'meta coords' }, ...metaRow('x, y, z', h('span', { class: 'mono' }, `${fmtNum(p[0])}, ${fmtNum(p[1])}, ${fmtNum(p[2])}`))),
        h(
          'div',
          { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'landmark-up', disabled: i === 0, onclick: () => reorderLandmark(api.store, l.id, i - 1) }, icon(ICONS.up), t('landmark.up')),
          h('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'landmark-down', disabled: i === st.landmarks.length - 1, onclick: () => reorderLandmark(api.store, l.id, i + 1) }, icon(ICONS.down), t('landmark.down')),
          h('button', { type: 'button', class: 'btn btn-danger btn-sm', id: 'landmark-delete', title: `${t('arrows.delete')} (Delete)`, onclick: () => deleteLandmark(api.store, l.id) }, icon(ICONS.trash), t('arrows.delete')),
        ),
      );
    }

    // curve semilandmarks
    addSet.disabled = !api.hasMesh() || st.curves.length === 0;
    clear(setList);
    setList.hidden = st.semilandmarks.length === 0;
    for (const q of st.semilandmarks) {
      const res = table.sets.find((x) => x.id === q.id);
      const curve = api.store.curve(q.curveId);
      setList.append(
        h(
          'li',
          { class: 'arrow-row semilandmark-row', role: 'option', 'aria-selected': String(q.id === sel), 'data-id': q.id, onclick: () => api.selection.set(q.id) },
          h('span', { class: 'chip chip-dot', style: `--chip:${q.id === sel ? LANDMARK_COLORS.selected : LANDMARK_COLORS.semi}` }),
          h('span', { class: 'arrow-id mono' }, q.label),
          h('span', { class: 'arrow-meta' }, curve?.label ?? '–'),
          h('span', { class: 'arrow-len mono' }, res?.valid ? String(q.count) : '–'),
        ),
      );
    }
    const q = sel ? api.store.semilandmarkSet(sel) : undefined;
    if (!q) {
      clear(setInspector);
      setBuiltFor = null;
      countInput = null;
      return;
    }
    if (setBuiltFor !== q.id || !countInput) {
      clear(setInspector);
      countInput = h('input', { id: 'semilandmark-count', class: 'ctl-text mono', type: 'number', min: 1, max: 500, step: 1 }) as HTMLInputElement;
      const input = countInput;
      input.addEventListener('input', () => {
        const n = Number(input.value);
        if (Number.isInteger(n) && n >= 1 && n <= 500) updateSemilandmarkSet(api.store, q.id, { count: n });
      });
      setInspector.append(h('div', { class: 'ctl' }, h('label', { class: 'ctl-label', for: 'semilandmark-count' }, t('semi.count')), input), h('div', { class: 'semi-body' }));
      setBuiltFor = q.id;
    }
    softSet(countInput, String(q.count));
    const holder = setInspector.querySelector('.semi-body') as HTMLElement;
    clear(holder);
    const lms: Array<[string, string]> = [['', t('semi.none')], ...st.landmarks.map((x, i): [string, string] => [x.id, `${i + 1} · ${x.name}`])];
    holder.append(
      select('semilandmark-curve', t('semi.curve'), st.curves.map((c): [string, string] => [c.id, c.label]), q.curveId, (v) => updateSemilandmarkSet(api.store, q.id, { curveId: v })),
      h(
        'div',
        { class: 'ctl-grid' },
        select('semilandmark-start', t('semi.start'), lms, q.startLandmarkId ?? '', (v) => updateSemilandmarkSet(api.store, q.id, { startLandmarkId: v || null })),
        select('semilandmark-end', t('semi.end'), lms, q.endLandmarkId ?? '', (v) => updateSemilandmarkSet(api.store, q.id, { endLandmarkId: v || null })),
      ),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-danger btn-sm', id: 'semilandmark-delete', title: `${t('arrows.delete')} (Delete)`, onclick: () => deleteSemilandmarkSet(api.store, q.id) }, icon(ICONS.trash), t('arrows.delete'))),
    );
  };
  refresh('all');
  return { el, refresh };
}

function noduleSection(api: AppApi): Section {
  const { el, body } = section('nodule', t('sec.nodule'));
  const regions = h('div', { class: 'fig-views', id: 'nodule-regions' });
  const meta = h('dl', { class: 'meta' });
  const show = checkbox('nodule-show', t('nodule.show'), api.store.state.nodule.show, (on) => setNoduleShown(api.store, on));
  body.append(regions, meta, show);
  const refresh = (kind: RefreshKind) => {
    if (!['all', 'nodule', 'regions', 'specimen', 'mesh'].includes(kind)) return;
    const st = api.store.state;
    const cortex = st.regions.filter((r) => r.type === 'cortex');
    clear(regions);
    for (const r of cortex) regions.append(checkbox(`nodule-use-${r.label}`, r.label, !st.nodule.exclude.includes(r.id), (on) => setNoduleRegion(api.store, r.id, on)));
    clear(meta);
    const f = api.noduleFit();
    const u = st.specimen.unit;
    if (f)
      meta.append(
        ...metaRow(t('nodule.radius'), h('span', { class: 'mono', id: 'nodule-radius' }, `${fmtNum(f.radius, 3)}${u ? ` ${u}` : ''}`)),
        ...metaRow(t('nodule.rms'), h('span', { class: 'mono', id: 'nodule-rms' }, `${fmtNum(f.rms, 3)}${u ? ` ${u}` : ''}`)),
        ...metaRow(t('nodule.points'), h('span', { class: 'mono' }, fmtInt(f.count))),
      );
    (show.querySelector('input') as HTMLInputElement).checked = st.nodule.show;
    (show.querySelector('input') as HTMLInputElement).disabled = !f;
  };
  refresh('all');
  return { el, refresh };
}

function splitSection(api: AppApi): Section {
  const { el, body } = section('split', t('sec.split'));
  const select = h('select', { id: 'split-source', class: 'ctl-select', 'aria-label': t('split.by') }) as HTMLSelectElement;
  select.addEventListener('change', () => {
    const [source, id] = select.value.split(':');
    setSplit(api.store, source === 'plane' || source === 'curve' ? { source, id, upHint: api.towardViewer() } : null);
  });
  const flip = h('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'split-flip', onclick: () => {
    const sp = api.store.state.split;
    if (sp?.source === 'plane') flipPlane(api.store, sp.id);
    else if (sp) setSplit(api.store, { ...sp, upHint: [-sp.upHint[0], -sp.upHint[1], -sp.upHint[2]] });
  } }, t('split.flip')) as HTMLButtonElement;
  const meta = h('dl', { class: 'meta' });
  body.append(h('div', { class: 'ctl' }, h('label', { class: 'ctl-label', for: 'split-source' }, t('split.by')), select), h('div', { class: 'btn-row' }, flip), meta);
  const refresh = (kind: RefreshKind) => {
    if (!['all', 'split', 'planes', 'curves', 'mesh', 'specimen', 'measure'].includes(kind)) return;
    const st = api.store.state;
    const options: Array<[string, string]> = [['', t('split.none')]];
    for (const p of api.planeResults()) if (p.valid) options.push([`plane:${p.id}`, p.label]);
    for (const c of st.curves) if (c.closed) options.push([`curve:${c.id}`, c.label]);
    clear(select);
    for (const [value, label] of options) select.append(h('option', { value }, label));
    select.value = st.split ? `${st.split.source}:${st.split.id}` : '';
    flip.disabled = !st.split;
    clear(meta);
    const u = st.specimen.unit;
    const closed = api.meshClosed();
    if (closed === false) meta.append(...metaRow(t('measure.volume'), t('measure.notClosed')));
    const v = api.volumeSplit();
    if (v)
      meta.append(
        ...metaRow(t('split.upper'), h('span', { class: 'mono', id: 'split-upper' }, `${fmtNum(v.upper, 2)}${u ? ` ${u}³` : ''}`)),
        ...metaRow(t('split.lower'), h('span', { class: 'mono', id: 'split-lower' }, `${fmtNum(v.lower, 2)}${u ? ` ${u}³` : ''}`)),
        ...metaRow(t('split.ratio'), h('span', { class: 'mono', id: 'split-ratio' }, v.ratio === null ? '–' : fmtNum(v.ratio, 3))),
      );
  };
  refresh('all');
  return { el, refresh };
}

function sectionsSection(api: AppApi): Section {
  const badge = h('span', { class: 'badge mono' }, '0');
  const { el, body } = section('sections', t('sec.sections'), badge);
  const list = h('ol', { class: 'arrow-list', id: 'section-list', role: 'listbox', 'aria-label': t('sec.sections') });
  const inspector = h('div', { class: 'inspector', id: 'section-inspector' });
  body.append(list, inspector);
  const refresh = (kind: RefreshKind) => {
    if (!['all', 'sections', 'selection', 'mesh'].includes(kind)) return;
    const st = api.store.state;
    badge.textContent = String(st.sections.length);
    list.hidden = st.sections.length === 0;
    clear(list);
    const sel = api.selection.id;
    for (const s of st.sections) {
      const isSel = s.id === sel;
      list.append(
        h(
          'li',
          { class: 'arrow-row section-row', role: 'option', 'aria-selected': String(isSel), 'data-id': s.id, onclick: () => api.selection.set(s.id) },
          h('span', { class: 'chip chip-line', style: `--chip:${isSel ? SECTION_COLORS.selected : SECTION_COLORS.line}` }),
          h('span', { class: 'arrow-id mono' }, s.label),
          h('span', { class: 'arrow-meta' }, t(`section.keep.${s.keep}`)),
          h('span', { class: 'arrow-len' }, s.inFigure ? t('section.inFigure') : ''),
        ),
      );
    }
    clear(inspector);
    const s = sel ? api.store.section(sel) : undefined;
    if (!s) return;
    const keep = segmented('section-keep', t('section.keep'), (['both', 'front', 'back'] as const).map((k) => ({ value: k, label: t(`section.keep.${k}`) })), s.keep, (v) =>
      updateSection(api.store, s.id, { keep: v as 'both' | 'front' | 'back' }),
    );
    const fill = segmented('section-fill', t('section.fill'), (['solid', 'hatch'] as const).map((k) => ({ value: k, label: t(`section.fill.${k}`) })), s.fill, (v) =>
      updateSection(api.store, s.id, { fill: v as 'solid' | 'hatch' }),
    );
    const inFigure = checkbox('section-in-figure', t('section.inFigure'), s.inFigure, (on) => updateSection(api.store, s.id, { inFigure: on }));
    inspector.append(
      keep.el,
      fill.el,
      inFigure,
      h(
        'div',
        { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'section-png', onclick: () => api.exportSection(s.id, 'png') }, 'PNG'),
        h('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'section-svg', onclick: () => api.exportSection(s.id, 'svg') }, 'SVG'),
        h('button', { type: 'button', class: 'btn btn-danger btn-sm', id: 'section-delete', title: `${t('arrows.delete')} (Delete)`, onclick: () => deleteSection(api.store, s.id) }, icon(ICONS.trash), t('arrows.delete')),
      ),
    );
  };
  refresh('all');
  return { el, refresh };
}

function measureExportSection(api: AppApi): Section {
  const { el, body } = section('measure-export', t('sec.export'));
  const autoBtn = h('button', { type: 'button', class: 'btn btn-primary', id: 'export-measurements-csv', onclick: () => api.exportMeasurementsCsv() }, t('export.measurements')) as HTMLButtonElement;
  const manualBtn = h('button', { type: 'button', class: 'btn btn-primary', id: 'export-manual-csv', onclick: () => api.exportManualMeasurementsCsv() }, t('export.manualMeasurements')) as HTMLButtonElement;
  const planeBtn = h('button', { type: 'button', class: 'btn btn-primary', id: 'export-planes-csv', onclick: () => api.exportPlanesCsv() }, t('export.planes')) as HTMLButtonElement;
  body.append(h('div', { class: 'btn-row' }, autoBtn, manualBtn, planeBtn));
  const refresh = (kind: RefreshKind) => {
    if (!['all', 'mesh', 'measure', 'measurements', 'planes'].includes(kind)) return;
    autoBtn.disabled = !api.autoMeasurements();
    manualBtn.disabled = !api.hasMesh() || api.store.state.measurements.length === 0;
    planeBtn.disabled = !api.hasMesh() || api.store.state.planes.length === 0;
  };
  refresh('all');
  return { el, refresh };
}

// ---------------------------------------------------------------- export

function exportSection(api: AppApi): Section {
  const { el, body } = section('export', t('sec.export'));
  const csvBtn = h('button', { type: 'button', class: 'btn btn-primary', id: 'export-csv', onclick: () => api.exportCsv() }, t('export.csv')) as HTMLButtonElement;
  const curveBtn = h('button', { type: 'button', class: 'btn btn-primary', id: 'export-curves-csv', onclick: () => api.exportCurvesCsv() }, t('export.curvesCsv')) as HTMLButtonElement;
  const regionBtn = h('button', { type: 'button', class: 'btn btn-primary', id: 'export-regions-csv', onclick: () => api.exportRegionsCsv() }, t('export.regions')) as HTMLButtonElement;
  const relationBtn = h('button', { type: 'button', class: 'btn btn-primary', id: 'export-relations-csv', onclick: () => api.exportRelationsCsv() }, t('export.relations')) as HTMLButtonElement;
  const seriesBtn = h('button', { type: 'button', class: 'btn btn-primary', id: 'export-series-csv', onclick: () => api.exportSeriesCsv() }, t('export.series')) as HTMLButtonElement;
  const lmBtn = (id: string, kind: 'tps' | 'fcsv' | 'csv' | 'sliders', label: string) => h('button', { type: 'button', class: 'btn btn-primary', id, onclick: () => api.exportLandmarks(kind) }, label) as HTMLButtonElement;
  const lmBtns = [lmBtn('export-landmarks-tps', 'tps', t('export.landmarksTps')), lmBtn('export-landmarks-fcsv', 'fcsv', t('export.landmarksFcsv')), lmBtn('export-landmarks-csv', 'csv', t('export.landmarksCsv'))];
  const slidersBtn = lmBtn('export-sliders-csv', 'sliders', t('export.sliders'));
  const bom = checkbox('export-bom', t('export.bom'), api.display.excelBom, (v) => api.setDisplay((x) => (x.excelBom = v), 'other'));
  const saveBtn = h('button', { type: 'button', class: 'btn btn-quiet', id: 'export-project', onclick: () => api.saveProject() }, icon(ICONS.save), t('export.project')) as HTMLButtonElement;
  const openBtn = h('button', { type: 'button', class: 'btn btn-quiet', id: 'export-open-project', onclick: () => api.openProject() }, icon(ICONS.open), t('header.openProject'));
  body.append(h('div', { class: 'btn-row' }, csvBtn, curveBtn, regionBtn, relationBtn, seriesBtn, ...lmBtns, slidersBtn, bom), h('div', { class: 'btn-row' }, saveBtn, openBtn));

  const refresh = (kind: RefreshKind) => {
    if (!['all', 'mesh', 'curves', 'regions', 'relations', 'sequences', 'landmarks'].includes(kind)) return;
    csvBtn.disabled = !api.hasMesh();
    const table = api.landmarkTable();
    for (const b of lmBtns) b.disabled = !api.hasMesh() || table.rows.length === 0;
    slidersBtn.disabled = !api.hasMesh() || table.sliders.length === 0;
    relationBtn.disabled = !api.hasMesh() || api.store.state.relations.length === 0;
    seriesBtn.disabled = !api.hasMesh() || !api.store.state.sequences.some((q) => q.scarIds.length);
    curveBtn.disabled = !api.hasMesh() || api.store.state.curves.length === 0;
    regionBtn.disabled = !api.hasMesh() || api.store.state.regions.length === 0;
    saveBtn.disabled = !api.hasMesh();
  };
  refresh('all');
  return { el, refresh };
}

// ---------------------------------------------------------------- compare

function observersSection(api: AppApi): Section {
  const { el, body } = section('observers', t('sec.observers'));
  const list = h('ol', { class: 'arrow-list', id: 'observer-list', 'aria-label': t('sec.observers') });
  const add = h('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'compare-add', onclick: () => api.addObserverFiles() }, icon(ICONS.open), t('compare.add')) as HTMLButtonElement;
  const gate = h('input', { id: 'compare-gate', class: 'ctl-text mono', type: 'number', min: 0, step: 'any' }) as HTMLInputElement;
  gate.addEventListener('change', () => api.setCompareGate(Number(gate.value)));
  const unit = h('span', { class: 'gate-unit mono' });
  body.append(list, h('div', { class: 'btn-row' }, add), h('div', { class: 'ctl' }, h('label', { class: 'ctl-label', for: 'compare-gate' }, t('compare.gate')), h('div', { class: 'gate-row' }, gate, unit)));
  const refresh = (kind: RefreshKind) => {
    if (!['all', 'compare', 'mesh', 'specimen'].includes(kind)) return;
    clear(list);
    for (const o of api.observerList()) {
      const box = h('input', { type: 'checkbox', checked: o.included, 'aria-label': o.label }) as HTMLInputElement;
      box.addEventListener('change', () => api.setObserverIncluded(o.id, box.checked));
      list.append(
        h(
          'li',
          { class: 'arrow-row observer-row', 'data-id': o.id },
          box,
          h('span', { class: 'chip', style: `--chip:${o.color}` }),
          h('span', { class: 'arrow-meta observer-name', title: o.fileName }, o.label),
          o.current ? h('span') : h('button', { type: 'button', class: 'icon-btn', 'data-act': 'remove', title: t('compare.remove'), 'aria-label': t('compare.remove'), onclick: () => api.removeObserver(o.id) }, icon(ICONS.close)),
        ),
      );
    }
    add.disabled = !api.hasMesh();
    softSet(gate, String(api.compareGate()));
    unit.textContent = api.store.state.specimen.unit;
  };
  refresh('all');
  return { el, refresh };
}

function agreementSection(api: AppApi): Section {
  const { el, body } = section('agreement', t('sec.agreement'));
  const status = h('p', { class: 'agree-status', id: 'agreement-status' });
  const table = h('div', { class: 'agree-wrap', id: 'agreement-table' });
  const longBtn = h('button', { type: 'button', class: 'btn btn-primary', id: 'export-agreement-csv', onclick: () => api.exportAgreement('long') }, t('export.agreement')) as HTMLButtonElement;
  const sumBtn = h('button', { type: 'button', class: 'btn btn-primary', id: 'export-agreement-summary', onclick: () => api.exportAgreement('summary') }, t('export.agreementSummary')) as HTMLButtonElement;
  body.append(status, table, h('div', { class: 'btn-row' }, longBtn, sumBtn));
  const refresh = (kind: RefreshKind) => {
    if (!['all', 'compare', 'mesh'].includes(kind)) return;
    const busy = api.agreementBusy();
    status.textContent = busy ? t('compare.computing') : '';
    status.hidden = !busy;
    const res = api.agreementResult();
    clear(table);
    longBtn.disabled = sumBtn.disabled = !res || busy;
    if (!res) return;
    const head = h('tr', {}, ...[`${t('compare.item')} · ${t('compare.metric')}`, t('compare.pair'), 'n', t('compare.mean')].map((x) => h('th', {}, x)));
    const rows = res.summary.map((r) =>
      h(
        'tr',
        { 'data-item': r.itemType, 'data-metric': r.metric },
        h('td', { class: 'mono agree-item' }, r.itemType, h('br'), h('span', { class: 'agree-metric' }, r.metric)),
        h('td', {}, r.b ? `${r.a} – ${r.b}` : r.a),
        h('td', { class: 'mono num' }, String(r.n)),
        h('td', { class: 'mono num' }, Number.isFinite(r.mean) ? fmtNum(r.mean, 3) : '–'),
      ),
    );
    table.append(h('table', { class: 'agree-table' }, h('thead', {}, head), h('tbody', {}, ...rows)));
  };
  refresh('all');
  return { el, refresh };
}

const ALL_MODES: AppMode[] = ['annotate', 'measure', 'present', 'compare'];

/** The sidebar sections, in order, and the work modes that show them. */
const SECTIONS: Array<[(api: AppApi) => Section, AppMode[]]> = [
  [specimenSection, ALL_MODES],
  [orientationSection, ['present']],
  [sectionsSection, ['present']],
  [figureSection, ['present']],
  [arrowsSection, ['annotate']],
  [curvesSection, ['annotate']],
  [(api) => regionsSection(api, (id, type) => api.setRegionType(id, type)), ['annotate']],
  [relationsSection, ['annotate']],
  [landmarksSection, ['annotate']],
  [measureAutoSection, ['measure']],
  [measureManualSection, ['measure']],
  [planesSection, ['measure']],
  [noduleSection, ['measure']],
  [splitSection, ['measure']],
  [displaySection, ALL_MODES],
  [exportSection, ['annotate']],
  [measureExportSection, ['measure']],
  [observersSection, ['compare']],
  [agreementSection, ['compare']],
];

export interface Sidebar {
  el: HTMLElement;
  refresh: (kind: RefreshKind) => void;
}

export function buildSidebar(api: AppApi): Sidebar {
  const el = h('aside', { class: 'sidebar', id: 'sidebar' });
  const sections = SECTIONS.map(([make, modes]) => ({ ...make(api), modes }));
  el.append(...sections.map((s) => s.el));
  const showMode = () => {
    for (const s of sections) s.el.hidden = !s.modes.includes(api.mode);
  };
  showMode();
  return {
    el,
    refresh: (kind) => {
      if (kind === 'mode' || kind === 'all') showMode();
      if (kind === 'mode') {
        for (const s of sections) s.refresh('figure');
        return;
      }
      for (const s of sections) s.refresh(kind);
    },
  };
}

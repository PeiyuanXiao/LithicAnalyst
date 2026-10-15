import { deleteScarVector, setScarAttribute, setScarLabel, updateSpecimen } from '../core/actions';
import { SCAR_FIELDS, type FieldDef } from '../core/fields';
import { arrowLength } from '../core/store';
import type { ScarVector } from '../core/types';
import { readPref, writePref } from '../io/autosave';
import { ARROW_COLORS, arrowColor, type ArrowColorMode } from '../render/arrowLayer';
import type { ShadingMode } from '../render/meshView';
import type { AppApi, ViewportBackground } from './appApi';
import { checkbox, optionList, segmented, selectRow, slider, softSet, textRow } from './controls';
import { clear, h, icon, ICONS } from './dom';
import { t, tl } from './i18n';

export type RefreshKind = 'all' | 'arrows' | 'selection' | 'specimen' | 'display' | 'mesh';

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

function listSummary(a: ScarVector): string {
  const parts: string[] = [];
  for (const f of SCAR_FIELDS) {
    if (f.type !== 'enum' || !f.listSummary) continue;
    const opt = f.options?.find((o) => o.value === a.attributes[f.key]);
    if (!opt) continue;
    if (f.listSummary === 'nonDefault' && opt.value === f.default) continue;
    parts.push(tl(opt.short ?? opt.label));
  }
  return parts.join(' · ');
}

function arrowsSection(api: AppApi): Section {
  const badge = h('span', { class: 'badge mono' }, '0');
  const { el, body } = section('arrows', t('sec.arrows'), badge);
  const list = h('ol', { class: 'arrow-list', role: 'listbox', 'aria-label': t('sec.arrows') });
  const inspector = h('div', { class: 'inspector', id: 'arrow-inspector' });
  body.append(list, inspector);

  let builtFor: string | null = null;
  let refs: { label: HTMLInputElement; setters: Array<(a: ScarVector) => void>; coords: HTMLElement } | null = null;

  const renderList = () => {
    const st = api.store.state;
    badge.textContent = String(st.scarVectors.length);
    list.hidden = st.scarVectors.length === 0;
    clear(list);
    const sel = api.selection.id;
    const unit = st.specimen.unit;
    for (const a of st.scarVectors) {
      const isSel = a.id === sel;
      const color = isSel ? ARROW_COLORS.selected : arrowColor(a, api.display.arrows.colorMode);
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
        h('span', { class: 'arrow-meta' }, listSummary(a)),
        h('span', { class: 'arrow-len mono' }, `${fmtNum(arrowLength(a), 1)}${unit ? ` ${unit}` : ''}`),
      );
      list.append(li);
      if (isSel) requestAnimationFrame(() => li.scrollIntoView({ block: 'nearest' }));
    }
  };

  const buildField = (f: FieldDef, a: ScarVector): { el: HTMLElement; set: (a: ScarVector) => void } => {
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
    const a = id ? api.store.arrow(id) : undefined;
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
        h('button', { type: 'button', class: 'btn btn-danger btn-sm', id: 'insp-delete', title: `${t('arrows.delete')} (Delete)`, onclick: () => api.selection.id && deleteScarVector(api.store, api.selection.id) }, icon(ICONS.trash), t('arrows.delete')),
      );
      const fields = SCAR_FIELDS.map((f) => buildField(f, a));
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
    refs.coords.append(
      ...metaRow(t('arrows.start'), h('span', { class: 'mono' }, p(a.start))),
      ...metaRow(t('arrows.end'), h('span', { class: 'mono' }, p(a.end))),
      ...metaRow(t('arrows.length'), h('span', { class: 'mono' }, `${fmtNum(arrowLength(a))}${u ? ` ${u}` : ''}`)),
    );
  };

  const refresh = (kind: RefreshKind) => {
    if (kind === 'mesh') return;
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
  ], d.arrows.colorMode, (v) => api.setDisplay((x) => (x.arrows.colorMode = v as ArrowColorMode), 'arrows'));
  const labels = checkbox('arrow-labels', t('display.labels'), d.arrows.labels, (v) => api.setDisplay((x) => (x.arrows.labels = v), 'arrows'));
  const hidden = checkbox('arrow-hidden', t('display.hidden'), d.arrows.showHidden, (v) => api.setDisplay((x) => (x.arrows.showHidden = v), 'arrows'));

  body.append(
    shading.el,
    curvGroup,
    h('div', { class: 'ctl-grid' }, az.el, elv.el, fill.el, gloss.el),
    background.el,
    h('hr', { class: 'rule' }),
    h('div', { class: 'ctl-grid' }, thickness.el, colorMode.el),
    h('div', { class: 'check-row' }, labels, hidden),
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

// ---------------------------------------------------------------- export

function exportSection(api: AppApi): Section {
  const { el, body } = section('export', t('sec.export'));
  const csvBtn = h('button', { type: 'button', class: 'btn btn-primary', id: 'export-csv', onclick: () => api.exportCsv() }, t('export.csv')) as HTMLButtonElement;
  const bom = checkbox('export-bom', t('export.bom'), api.display.excelBom, (v) => api.setDisplay((x) => (x.excelBom = v), 'other'));
  const saveBtn = h('button', { type: 'button', class: 'btn btn-quiet', id: 'export-project', onclick: () => api.saveProject() }, icon(ICONS.save), t('export.project')) as HTMLButtonElement;
  const openBtn = h('button', { type: 'button', class: 'btn btn-quiet', id: 'export-open-project', onclick: () => api.openProject() }, icon(ICONS.open), t('header.openProject'));
  body.append(h('div', { class: 'btn-row' }, csvBtn, bom), h('div', { class: 'btn-row' }, saveBtn, openBtn));

  const refresh = (kind: RefreshKind) => {
    if (kind !== 'all' && kind !== 'mesh') return;
    csvBtn.disabled = !api.hasMesh();
    saveBtn.disabled = !api.hasMesh();
  };
  refresh('all');
  return { el, refresh };
}

export interface Sidebar {
  el: HTMLElement;
  refresh: (kind: RefreshKind) => void;
}

export function buildSidebar(api: AppApi): Sidebar {
  const el = h('aside', { class: 'sidebar', id: 'sidebar' });
  const sections = [specimenSection(api), arrowsSection(api), displaySection(api), exportSection(api)];
  el.append(...sections.map((s) => s.el));
  return {
    el,
    refresh: (kind) => {
      for (const s of sections) s.refresh(kind);
    },
  };
}

import {
  deleteTechnicalAxis,
  setPlaneRegion,
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
  resetConfigFace,
  setBiconeRole,
  setConfigAxis,
  setConfigModel,
  setConfigJoin,
  setConfigPolarity,
  setConfigRole,
  setConfigSurfaceType,
  setNoduleRegion,
  setNoduleShown,
  setSplit,
  swapSplit,
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
} from '../core/actions';
import { curveLength } from '../core/curveGeometry';
import { BICONE_ROLES, CONFIG_MODELS, CONFIG_ROLES, CURVE_FIELDS, customValue, fieldLocked, isCustomValue, keyedOptions, offeredOptions, PLATFORM_OUTLINE, POLARITIES, REGION_FIELDS, SCAR_FIELDS, SPECIMEN_TYPES, type BiconeRole, type ConfigFace, type ConfigModel, type ConfigRole, type FieldDef, type Polarity, type SpecimenType } from '../core/fields';
import { edgeCurves, isBicone, soleEdgeCurve, type BiconeResult } from '../compute/bicone';
import { FLAKE_MEASURES } from '../compute/flake';
import { landmarkName, platformSides, shownLandmarks } from '../compute/landmarks';
import type { ConfigurationResult, FlakingSurface } from '../compute/configuration';
import { fmtCount, fmtDuration, fmtNum, fmtQuantity, MISSING, quantityUnit, type Quantity } from '../core/format';
import { measurementUnit, measurementValue } from '../core/measurements';
import { vectorLength } from '../core/store';
import type { AttributeValue, Curve, Measurement, PlaneMethod, Scar, Vec3 } from '../core/types';
import { readPref, writePref } from '../io/autosave';
import { ARROW_COLORS, arrowColor, type ArrowColorMode } from '../render/arrowLayer';
import { CURVE_COLORS, curveColor } from '../render/curveLayer';
import { MEASURE_COLORS } from '../render/measureLayer';
import { planeColor } from '../render/planeLayer';
import { FIGURE_VIEWS } from '../render/figure';
import { SECTION_COLORS } from '../render/sectionLayer';
import { regionColorOf } from '../render/regionLayer';
import { relationInputs, relationProblems, stratigraphy, type RelationProblem, type Stratigraphy } from '../compute/relations';
import { sequenceColors, sequenceSwatch } from '../render/sequenceColor';
import { LANDMARK_COLORS } from '../render/landmarkLayer';
import type { ShadingMode } from '../render/meshView';
import type { AppApi, AppMode } from './appApi';
import { addButton, checkbox, coordRow, iconButton, numRow, optionList, plusButton, segmented, selectRow, slider, softSet, textRow, textValueRow } from './controls';
import { clear, h, icon, ICONS, revealInList } from './dom';
import { t, tl } from './i18n';
import { lightBall } from './lightBall';
import { tip, tips } from './tooltip';

/** The trash can, in the danger colour. */
const deleteButton = (id: string, onClick: () => void) => iconButton(ICONS.trash, t('arrows.delete'), onClick, { id, danger: true });

export type RefreshKind = 'all' | 'flake' | 'arrows' | 'curves' | 'measurements' | 'measure' | 'planes' | 'sections' | 'regions' | 'relations' | 'sequences' | 'landmarks' | 'configuration' | 'compare' | 'workspace' | 'nodule' | 'split' | 'figure' | 'selection' | 'specimen' | 'display' | 'mesh' | 'mode';

interface Section {
  el: HTMLElement;
  refresh: (kind: RefreshKind) => void;
  /** Shown only while this holds (besides the work mode). */
  visible?: () => boolean;
}

/** A quantity as a number and its unit, for the separate columns of lists and tables. */
const quantity = (kind: Quantity, v: number | null | undefined, unit: string): [string, string] => [fmtQuantity(kind, v), quantityUnit(kind, unit)];

/** A manual measurement's value and unit. */
function measurementParts(m: Measurement, unit: string): [string, string] {
  const v = measurementValue(m);
  return m.type === 'angle' ? quantity('angle', v, unit) : [fmtQuantity('length', v), measurementUnit(m, unit)];
}

/** The value and unit cells of a list row (`.num-list`). */
const valueCells = ([value, unit]: [string, string]) => [h('span', { class: 'arrow-len num' }, value), h('span', { class: 'unit' }, unit)];

/** A point's coordinates, each with the decimals of a coordinate. */
const coords = (p: Vec3): string[] => [p[0], p[1], p[2]].map((x) => fmtQuantity('coord', x));

function section(id: string, title: string, badge?: HTMLElement): { el: HTMLDetailsElement; body: HTMLElement } {
  const el = h('details', { class: 'panel', id: `sec-${id}` }) as HTMLDetailsElement;
  el.open = readPref(`sec:${id}`, true);
  // only what the user opens or closes is remembered (not what follows the tools)
  el.addEventListener('toggle', () => {
    if (el.dataset.auto === String(el.open)) delete el.dataset.auto;
    else writePref(`sec:${id}`, el.open);
  });
  const summary = h('summary', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, title), badge ?? null);
  const body = h('div', { class: 'panel-body' });
  el.append(summary, body);
  return { el, body };
}

const metaRow = (term: string, value: Node | string, title?: string) => [h('dt', {}, term), h('dd', { title }, value)];

// ---------------------------------------------------------------- arrows

/** An enum value as shown: its option's label, the user's own text, or — when not filled in. */
function fieldText(f: FieldDef, v: AttributeValue | undefined): string {
  const opt = f.options?.find((o) => o.value === v);
  return opt ? tl(opt.label) : isCustomValue(f, v) ? v : MISSING;
}

function listSummary(attributes: Record<string, AttributeValue>, fields: FieldDef[] = SCAR_FIELDS): string {
  const parts: string[] = [];
  for (const f of fields) {
    if (f.type !== 'enum' || !f.listSummary) continue;
    if (f.allowCustom) {
      parts.push(fieldText(f, attributes[f.key]));
      continue;
    }
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
  const list = h('ol', { class: 'arrow-list num-list', id: 'scar-list', role: 'listbox', 'aria-label': t('sec.arrows') });
  const inspector = h('div', { class: 'inspector', id: 'arrow-inspector' });
  body.append(list, inspector);

  let builtFor: string | null = null;
  let refs: { label: HTMLInputElement; setters: Array<(a: Scar) => void>; coords: HTMLElement; length: HTMLElement } | null = null;

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
        ...valueCells(a.vector ? quantity('length', vectorLength(a.vector), unit) : [MISSING, '']),
      );
      list.append(li);
      if (isSel) requestAnimationFrame(() => revealInList(list, li));
    }
  };

  const buildField = (f: FieldDef, a: Scar): { el: HTMLElement; set: (a: Scar) => void } => {
    const id = `field-${f.key}`;
    const current = a.attributes[f.key];
    const onPick = (v: string) => {
      if (api.selection.id) setScarAttribute(api.store, api.selection.id, f.key, v);
    };
    if (f.type === 'enum' && f.options && (f.numberKeys || f.shiftNumberKeys)) {
      // number keys (or Shift + number keys) set it; a field that follows another is locked meanwhile
      const key = (i: number) => (i < 9 ? `${f.shiftNumberKeys ? '⇧' : ''}${i + 1}` : undefined);
      const ctl = optionList(id, tl(f.label), f.options.map((o, i) => ({ value: o.value, label: tl(o.label), key: key(i) })), String(current), onPick);
      const set = (x: Scar) => {
        ctl.set(String(x.attributes[f.key]));
        const locked = fieldLocked(x.attributes, f.key);
        ctl.enable((v) => !locked || v === 'na');
      };
      set(a);
      return { el: h('div', { class: 'field', 'data-field': f.key }, ctl.el), set };
    }
    if (f.type === 'enum' && f.options) {
      const ctl = segmented(id, tl(f.label), f.options.map((o) => ({ value: o.value, label: tl(o.label) })), String(current), onPick);
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
        deleteButton('insp-delete', () => api.selection.id && deleteScar(api.store, api.selection.id)),
      );
      const fields = [...SCAR_FIELDS.map((f) => buildField(f, a)), sequenceField()];
      const coordsEl = h('dl', { class: 'coord-grid', id: 'arrow-coords' });
      const lengthEl = h('dl', { class: 'num-grid' });
      inspector.append(head, ...fields.map((f) => f.el), coordsEl, lengthEl);
      refs = { label, setters: fields.map((f) => f.set), coords: coordsEl, length: lengthEl };
      builtFor = a.id;
    }
    softSet(refs.label, a.label);
    for (const set of refs.setters) set(a);
    clear(refs.coords);
    clear(refs.length);
    const u = st.specimen.unit;
    const v = a.vector;
    refs.coords.hidden = refs.length.hidden = !v;
    if (v) {
      const cu = quantityUnit('coord', u);
      refs.coords.append(...coordRow(t('arrows.start'), coords(v.start), cu), ...coordRow(t('arrows.end'), coords(v.end), cu));
      refs.length.append(...numRow(t('arrows.length'), ...quantity('length', vectorLength(v), u), 'arrow-length'));
    }
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
  const list = h('ol', { class: 'arrow-list num-list', id: 'curve-list', role: 'listbox', 'aria-label': t('sec.curves') });
  const inspector = h('div', { class: 'inspector', id: 'curve-inspector' });
  body.append(list, inspector);

  let builtFor: string | null = null;
  let refs: { label: HTMLInputElement; setters: Array<(c: Curve) => void>; meta: HTMLElement; complete: HTMLButtonElement } | null = null;

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
        ...valueCells(quantity('length', curveLength(c), unit)),
      );
      list.append(li);
      if (isSel) requestAnimationFrame(() => revealInList(list, li));
    }
  };

  const buildField = (f: FieldDef, c: Curve): { el: HTMLElement; set: (c: Curve) => void } => {
    const id = `curve-field-${f.key}`;
    const current = c.attributes[f.key];
    const onPick = (v: string) => {
      if (api.selection.id) setCurveAttribute(api.store, api.selection.id, f.key, v);
    };
    if (f.type === 'enum' && f.options && f.allowCustom) return customField(api, f, id, String(current ?? ''), api.store.state.specimen.type, onPick);
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
        deleteButton('curve-insp-delete', () => api.selection.id && deleteCurve(api.store, api.selection.id)),
      );
      const fields = CURVE_FIELDS.map((f) => buildField(f, c));
      const meta = h('dl', { class: 'num-grid' });
      // an open curve along part of the edge, carried on round until it closes
      const complete = h('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'curve-complete', onclick: () => api.selection.id && api.completeLoop(api.selection.id) }, t('curves.complete')) as HTMLButtonElement;
      inspector.append(head, ...fields.map((f) => f.el), meta, h('div', { class: 'btn-row' }, complete));
      refs = { label, setters: fields.map((f) => f.set), meta, complete };
      builtFor = c.id;
    }
    softSet(refs.label, c.label);
    for (const set of refs.setters) set(c);
    clear(refs.meta);
    const u = st.specimen.unit;
    refs.meta.append(...numRow(t('arrows.length'), ...quantity('length', curveLength(c), u), 'curve-length'), ...textValueRow(t('curves.closed'), t(c.closed ? 'curves.yes' : 'curves.no')));
    // the platform outline must be closed before it means anything
    if (c.attributes.type === PLATFORM_OUTLINE && !c.closed) refs.meta.append(h('dt', {}), h('dd', { class: 'text', id: 'curve-outline-open' }, h('span', { class: 'pill pill-warn' }, t('curves.notClosed'))));
    (refs.complete.parentElement as HTMLElement).hidden = c.closed;
    refs.complete.disabled = c.anchors.length < 3 || api.completingLoop();
  };

  const refresh = (kind: RefreshKind) => {
    if (kind === 'mesh' || kind === 'arrows') return;
    renderList();
    // another type of specimen offers other curve types
    if (kind !== 'display') renderInspector(kind === 'all' || kind === 'specimen');
  };
  refresh('all');
  return { el, refresh };
}

/** The value that stands for the user's own text in the option list. */
const CUSTOM = 'custom';

/**
 * An enum field that also takes the user's own text: its offered options with
 * number keys, then Custom (the next key), which opens a text box suggesting the
 * custom values used so far (Enter keeps the text, Esc lets it go). An older
 * code no longer offered is shown while the item has it.
 */
function customField(api: AppApi, f: FieldDef, id: string, current: string, specimenType: SpecimenType, onPick: (v: string) => void): { el: HTMLElement; set: (x: { attributes: Record<string, AttributeValue> }) => void } {
  const offered = offeredOptions(f, specimenType);
  // a code not offered on this type of specimen is shown while the item has it
  const legacy = f.options?.find((o) => o.value === current && !offered.includes(o));
  const shown = (v: string) => (isCustomValue(f, v) ? CUSTOM : v);
  const keyed = keyedOptions(f, specimenType);
  const at = keyed.indexOf('custom');
  const entry = (o: (typeof keyed)[number], i: number) => (o === 'custom' ? { value: CUSTOM, label: t('field.custom'), key: String(i + 1) } : { value: o.value, label: tl(o.label), key: String(i + 1) });
  const ctl = optionList(
    id,
    tl(f.label),
    [
      ...keyed.slice(0, at).map((o, i) => entry(o, i)),
      ...(legacy ? [{ value: legacy.value, label: tl(legacy.label) }] : []),
      ...keyed.slice(at).map((o, i) => entry(o, at + i)),
    ],
    shown(current),
    (v) => {
      if (v === CUSTOM) return open();
      input.hidden = true;
      onPick(v);
    },
  );
  const customLabel = ctl.el.querySelector(`#${id}-${CUSTOM} span`) as HTMLElement;
  const list = h('datalist', { id: `${id}-suggest` });
  const input = h('input', { class: 'ctl-text', id: `${id}-text`, type: 'text', list: `${id}-suggest`, autocomplete: 'off', spellcheck: 'false', 'aria-label': t('field.custom'), hidden: true }) as HTMLInputElement;
  let value = current;
  const show = (v: string) => {
    value = v;
    ctl.set(shown(v));
    customLabel.textContent = isCustomValue(f, v) ? `${t('field.custom')} · ${v}` : t('field.custom');
  };
  function open() {
    clear(list);
    for (const s of api.customValues(f.key)) list.append(h('option', { value: s }));
    input.value = isCustomValue(f, value) ? value : '';
    input.hidden = false;
    input.focus();
    input.select();
  }
  const cancel = () => {
    input.hidden = true;
    show(value);
  };
  input.addEventListener('keydown', (e) => {
    // typed text is no shortcut
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      input.hidden = true;
      onPick(customValue(f, input.value, specimenType));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  });
  input.addEventListener('blur', () => !input.hidden && cancel());
  show(current);
  return { el: h('div', { class: 'field' }, ctl.el, input, list), set: (x) => show(String(x.attributes[f.key] ?? '')) };
}

// ---------------------------------------------------------------- display

/** Display settings: shown in a panel over the view, not in the sidebar. */
function displaySection(api: AppApi): Section {
  const body = h('div', { class: 'display-body', id: 'display-body' });
  const el = body;
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

  const ball = lightBall(d.light.azimuthDeg, d.light.elevationDeg, (azimuthDeg, elevationDeg) => api.setDisplay((x) => Object.assign(x.light, { azimuthDeg, elevationDeg }), 'light'));
  const lightRow = h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, t('display.light')), ball.el);

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
  /** A panel over the view, switched on or off: a row like the others, its label on the left. */
  const panelRow = (id: string, label: string, checked: boolean, onChange: (v: boolean) => void) => {
    const input = h('input', { type: 'checkbox', id, checked }) as HTMLInputElement;
    input.addEventListener('change', () => onChange(input.checked));
    return { el: h('label', { class: 'ctl', for: id }, h('span', { class: 'ctl-label' }, label), h('span', { class: 'ctl-check' }, input)), input };
  };
  const config = panelRow('config-show', t('sec.configuration'), d.configuration, (v) => api.setDisplay((x) => (x.configuration = v), 'configuration'));
  const harris = panelRow('harris-show', t('harris.title'), d.harris, (v) => api.setDisplay((x) => (x.harris = v), 'harris'));
  const profile = panelRow('profile-show', t('profile.title'), d.profile, (v) => api.setDisplay((x) => (x.profile = v), 'profile'));

  body.append(shading.el, curvGroup, lightRow, colorMode.el, config.el, harris.el, profile.el, h('div', { class: 'check-row' }, labels, hidden, regions));

  const refresh = (kind: RefreshKind) => {
    // these panels belong to the annotate mode
    const flake = api.store.state.specimen.type === 'flake';
    config.el.hidden = api.mode !== 'annotate' || flake;
    harris.el.hidden = api.mode !== 'annotate';
    config.input.checked = api.display.configuration;
    harris.input.checked = api.display.harris;
    // a flake's: it needs the technical axis
    profile.el.hidden = !flake;
    profile.input.checked = api.display.profile;
    profile.input.disabled = !api.store.state.flake.axis?.matrix;
    if (kind !== 'all' && kind !== 'display' && kind !== 'mesh') return;
    shading.set(api.display.shading);
    const scanBtn = shading.el.querySelector('[data-value="scan"]') as HTMLButtonElement | null;
    if (scanBtn) scanBtn.disabled = !api.hasScanColors();
    curvGroup.hidden = api.display.shading !== 'curvature';
    curvBusy.hidden = !api.curvatureBusy();
    ball.set(api.display.light.azimuthDeg, api.display.light.elevationDeg);
  };
  refresh('all');
  return { el, refresh };
}

// ---------------------------------------------------------------- measure mode

function measureAutoSection(api: AppApi): Section {
  const { el, body } = section('measure-auto', t('sec.measureAuto'));
  const meta = h('dl', { class: 'num-grid measure-auto', id: 'measure-auto' });
  body.append(meta);
  const row = (id: string, term: string, kind: Quantity, v: number | null) => numRow(term, ...quantity(kind, v, api.store.state.specimen.unit), `auto-${id}`);
  const refresh = (kind: RefreshKind) => {
    if (!['all', 'mesh', 'measure', 'specimen'].includes(kind)) return;
    clear(meta);
    const m = api.autoMeasurements();
    if (!m) {
      if (api.measuringBusy()) meta.append(h('dt', {}, t('measure.busy')));
      return;
    }
    meta.append(
      ...row('length', t('measure.length'), 'length', m.length),
      ...row('width', t('measure.width'), 'length', m.width),
      ...row('thickness', t('measure.thickness'), 'length', m.thickness),
      ...textValueRow(t('measure.axes'), t(`measure.axes.${m.frame}`), 'auto-frame'),
      ...row('area', t('measure.area'), 'area', m.surfaceArea),
      ...(m.volume === null ? textValueRow(t('measure.volume'), t('measure.notClosed'), 'auto-volume') : row('volume', t('measure.volume'), 'volume', m.volume)),
    );
  };
  refresh('all');
  return { el, refresh };
}

/** The kind of quantity of each of a flake's measurements. */
const flakeQuantity = (k: string): Quantity => (k === 'platform_area' ? 'area' : k.startsWith('epa') || k === 'ipa' || k.endsWith('_deg') ? 'angle' : 'length');

/** A flake's measurements (measure mode). */
function flakeSection(api: AppApi): Section {
  const { el, body } = section('flake', t('sec.flake'));
  const meta = h('dl', { class: 'num-grid measure-auto', id: 'flake-measures' });
  body.append(meta);
  const refresh = (kind: RefreshKind) => {
    if (!['all', 'mesh', 'measure', 'specimen', 'flake'].includes(kind)) return;
    clear(meta);
    const u = api.store.state.specimen.unit;
    const m = api.flakeMeasures();
    for (const k of FLAKE_MEASURES) meta.append(...numRow(t(`flake.${k}`), ...quantity(flakeQuantity(k), m?.[k] ?? null, u), `flake-${k}`));
    const a = api.autoMeasurements();
    meta.append(...numRow(t('measure.area'), ...quantity('area', a?.surfaceArea ?? null, u), 'flake-area'));
    meta.append(...(a && a.volume === null ? textValueRow(t('measure.volume'), t('measure.notClosed'), 'flake-volume') : numRow(t('measure.volume'), ...quantity('volume', a?.volume ?? null, u), 'flake-volume')));
  };
  refresh('all');
  return { el, refresh, visible: () => api.store.state.specimen.type === 'flake' };
}

/** A flake's technical axis (annotate mode): its ends, why it gives no frame, delete. */
function axisSection(api: AppApi): Section {
  const status = h('span', { class: 'pill', id: 'axis-status', hidden: true });
  const { el, body } = section('axis', t('sec.axis'), status);
  const inspector = h('div', { class: 'inspector', id: 'axis-inspector' });
  body.append(inspector);
  const refresh = (kind: RefreshKind) => {
    if (!['all', 'mesh', 'flake', 'specimen', 'selection'].includes(kind)) return;
    const st = api.store.state;
    const a = st.flake.axis;
    status.hidden = !a?.failure;
    status.classList.toggle('pill-warn', !!a?.failure);
    status.textContent = a?.failure ? t(`axis.${a.failure}`) : '';
    clear(inspector);
    if (!a) return;
    const cu = quantityUnit('coord', st.specimen.unit);
    const selected = api.selection.id === a.id;
    inspector.append(
      h('button', { type: 'button', class: `arrow-row axis-row${selected ? ' is-selected' : ''}`, id: 'axis-row', 'aria-pressed': String(selected), onclick: () => api.selection.set(a.id) }, h('span', { class: 'chip', style: `--chip:${selected ? ARROW_COLORS.selected : ARROW_COLORS.axis}` }), h('span', { class: 'arrow-meta' }, t('sec.axis'))),
      h('dl', { class: 'coord-grid', id: 'axis-coords' }, ...coordRow(t('axis.start'), coords(a.start), cu), ...coordRow(t('axis.end'), coords(a.end), cu)),
      h('div', { class: 'btn-row' }, deleteButton('axis-delete', () => deleteTechnicalAxis(api.store))),
    );
  };
  refresh('all');
  return { el, refresh, visible: () => api.store.state.specimen.type === 'flake' };
}

function measureManualSection(api: AppApi): Section {
  const badge = h('span', { class: 'badge mono' }, '0');
  const { el, body } = section('measure-manual', t('sec.measureManual'), badge);
  const list = h('ol', { class: 'arrow-list num-list', id: 'measure-list', role: 'listbox', 'aria-label': t('sec.measureManual') });
  const del = deleteButton('measure-delete', () => api.selection.id && deleteMeasurement(api.store, api.selection.id));
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
      const li = list.appendChild(
        h(
          'li',
          { class: 'arrow-row measure-row', role: 'option', 'aria-selected': String(isSel), 'data-id': m.id, onclick: () => api.selection.set(m.id) },
          h('span', { class: 'chip chip-line', style: `--chip:${isSel ? MEASURE_COLORS.selected : MEASURE_COLORS.line}` }),
          h('span', { class: 'arrow-id mono' }, m.label),
          h('span', { class: 'arrow-meta' }, t(`measure.type.${m.type}`)),
          ...valueCells(measurementParts(m, st.specimen.unit)),
        ),
      );
      if (isSel) requestAnimationFrame(() => revealInList(list, li));
    }
    const selected = !!(sel && api.store.measurement(sel));
    actions.hidden = !selected;
  };
  refresh('all');
  return { el, refresh };
}

const PLANE_METHODS: PlaneMethod[] = ['all_vertices', 'scar_directions', 'scar_starts', 'curves'];
/** A flake's planes go by part: a curve or a surface region. */
const FLAKE_PLANE_METHODS: PlaneMethod[] = ['curves', 'region'];

function planesSection(api: AppApi): Section {
  const badge = h('span', { class: 'badge mono' }, '0');
  const { el, body } = section('planes', t('sec.planes'), badge);
  const add = plusButton(t('plane.add'), () => api.addPlane(), 'plane-add');
  const list = h('ol', { class: 'arrow-list', id: 'plane-list', role: 'listbox', 'aria-label': t('sec.planes') });
  const inspector = h('div', { class: 'inspector', id: 'plane-inspector' });
  body.append(list, add, inspector);

  const renderInspector = () => {
    clear(inspector);
    const id = api.selection.id;
    const p = id ? api.store.plane(id) : undefined;
    if (!p) return;
    const offered = api.store.state.specimen.type === 'flake' ? FLAKE_PLANE_METHODS : PLANE_METHODS;
    // a plane made on the other type of specimen keeps its method
    const methods = offered.includes(p.method) ? offered : [...offered, p.method];
    const method = selectRow('plane-method', t('plane.method'), methods.map((m) => ({ value: m, label: t(`plane.method.${m}`) })), p.method, (v) =>
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
        const type = fieldText(CURVE_FIELDS.find((x) => x.key === 'type')!, c.attributes.type);
        inputs.append(checkbox(`plane-curve-${c.id}`, type !== MISSING ? `${c.label} · ${type}` : c.label, p.curveIds.includes(c.id), (on) => setPlaneCurve(api.store, p.id, c.id, on)));
      }
    } else if (p.method === 'region') {
      const types = REGION_FIELDS[0].options!;
      for (const r of api.store.state.regions) {
        const type = types.find((o) => o.value === r.type);
        inputs.append(checkbox(`plane-region-${r.id}`, `${r.label} · ${type ? tl(type.label) : r.type}`, p.regionIds.includes(r.id), (on) => setPlaneRegion(api.store, p.id, r.id, on)));
      }
    }
    const actions = h(
      'div',
      { class: 'btn-row' },
      iconButton(ICONS.swap, t('plane.flip'), () => flipPlane(api.store, p.id), { id: 'plane-flip' }),
      iconButton(ICONS.target, t('plane.view'), () => api.viewAlongPlane(p.id), { id: 'plane-view' }),
      deleteButton('plane-delete', () => deletePlane(api.store, p.id)),
    );
    inspector.append(method.el, inputs, actions);
  };

  const refresh = (kind: RefreshKind) => {
    if (!['all', 'planes', 'selection', 'mesh', 'arrows', 'curves', 'regions', 'specimen'].includes(kind)) return;
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

/** Where the specimen frame came from, in words: "Plane P1 · Arrow S1" (stored as `plane:P1; vertical:S1`). */
function frameSourceText(source: string): string {
  const part = (s: string): string | null =>
    s === 'view' ? t('frame.src.view') : s === 'technical_axis' ? t('frame.src.technical') : s === 'turned' ? t('frame.src.turned') : s.startsWith('plane:') ? t('frame.src.plane', { label: s.slice(6) }) : s.startsWith('vertical:') ? t('frame.src.vertical', { label: s.slice(9) }) : null;
  const parts = source.split('; ').map(part);
  return parts.every((p) => p !== null) ? parts.join(' · ') : t('frame.src.other');
}

function orientationSection(api: AppApi): Section {
  const status = h('span', { class: 'pill', id: 'frame-status' });
  const { el, body } = section('orientation', t('sec.orientation'), status);
  const btn = (id: string, label: string, onclick: () => void, kind = 'btn-quiet') =>
    h('button', { type: 'button', class: `btn ${kind} btn-sm`, id, onclick }, label) as HTMLButtonElement;
  const fromView = btn('frame-from-view', t('frame.fromView'), () => api.setFrameFromView());
  /** A button with a menu of items; when unusable it says why (a tooltip) instead of opening. */
  const menuButton = (id: string, label: string) => {
    const menu = h('div', { class: 'popover menu menu-left', id: `${id}-menu`, role: 'menu', hidden: true });
    let reason: string | null = null;
    const b = h('button', { type: 'button', class: 'btn btn-quiet btn-sm', id, 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => reason === null && api.popovers.toggle(b, menu) }, h('span', {}, label), icon(ICONS.chevron)) as HTMLButtonElement;
    tips.attach(b, () => (reason === null ? null : { label: reason }));
    const set = (items: Array<{ id: string; label: string; color?: string; pick: () => void }>, why: string | null) => {
      reason = why;
      b.setAttribute('aria-disabled', String(why !== null));
      clear(menu);
      for (const it of items)
        menu.append(
          h('button', { type: 'button', class: 'menu-item', role: 'menuitem', id: `${id}-${it.id}`, onclick: () => (api.popovers.close(), it.pick()) }, it.color ? h('span', { class: 'chip', style: `--chip:${it.color}` }) : null, h('span', { class: 'mono' }, it.label)),
        );
    };
    return { el: h('div', { class: 'menu-wrap' }, b, menu), set };
  };
  const fromPlane = menuButton('frame-from-plane', t('frame.fromPlane'));
  const vertical = menuButton('frame-vertical', t('frame.vertical'));
  const turnBtn = (id: string, ic: string, label: string, deg: number) => {
    const b = h('button', { type: 'button', class: 'icon-btn', id, 'aria-label': label, onclick: () => api.turnFrame(deg) }, icon(ic)) as HTMLButtonElement;
    tip(b, label);
    return b;
  };
  const ccw = turnBtn('frame-rot-ccw', ICONS.rotateLeft, t('frame.ccw'), 90);
  const cw = turnBtn('frame-rot-cw', ICONS.rotateRight, t('frame.cw'), -90);
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
  const clearBtn = btn('frame-clear', t('frame.clear'), () => api.clearFrame(), 'btn-text-danger');
  // front view, vertical, turning: a label column and the controls
  body.append(
    h(
      'div',
      { class: 'frame-rows' },
      h('span', { class: 'ctl-label' }, t('frame.front')),
      h('div', { class: 'btn-row' }, fromView, fromPlane.el),
      h('span', { class: 'ctl-label' }, t('frame.axis')),
      h('div', { class: 'btn-row' }, vertical.el),
      h('span', { class: 'ctl-label' }, t('frame.turn')),
      h('div', { class: 'frame-turn' }, ccw, cw, fine.el),
    ),
    h('div', { class: 'frame-foot' }, view, clearBtn),
  );
  const refresh = (kind: RefreshKind) => {
    if (!['all', 'mesh', 'specimen', 'planes', 'arrows'].includes(kind)) return;
    const st = api.store.state;
    const f = st.specimen.frame;
    status.textContent = f ? frameSourceText(f.source) : t('frame.none');
    status.classList.toggle('pill-set', !!f);
    const planes = api.planeResults().filter((p) => p.valid);
    fromPlane.set(
      planes.map((p) => ({ id: p.label, label: p.label, color: planeColor(p.label), pick: () => api.setFrameFromPlane(p.id) })),
      planes.length ? null : t('frame.noPlanes'),
    );
    const arrows = st.scars.filter((s) => s.vector);
    vertical.set(
      arrows.map((s) => ({ id: s.label, label: s.label, pick: () => api.setFrameVertical(s.id) })),
      !f ? t('frame.needFront') : arrows.length ? null : t('frame.noArrows'),
    );
    fromView.disabled = !api.hasMesh();
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
  // scale and resolution each on a line of its own, the choices of equal width
  for (const s of [scale, dpi]) s.el.querySelector('.seg')?.classList.add('seg-equal');
  const sizeEl = h('dl', { class: 'meta' });
  const png = h('button', { type: 'button', class: 'btn btn-primary', id: 'fig-png', onclick: () => api.exportFigure('png') }, 'PNG') as HTMLButtonElement;
  const svg = h('button', { type: 'button', class: 'btn btn-primary', id: 'fig-svg', onclick: () => api.exportFigure('svg') }, 'SVG') as HTMLButtonElement;
  // with a folder open: one figure per model instead
  const all = checkbox('fig-folder', t('figure.folder'), api.figureFolder, (on) => (api.figureFolder = on));
  body.append(views, light.el, overlays, scale.el, dpi.el, sizeEl, h('div', { class: 'btn-row' }, png, svg, all));
  const refresh = (kind: RefreshKind) => {
    if (!['all', 'mesh', 'figure', 'specimen', 'sections', 'workspace'].includes(kind)) return;
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
    png.disabled = svg.disabled = !api.hasMesh() || !!api.batchInfo() || (!f.views.length && !api.store.state.sections.some((x) => x.inFigure));
    all.hidden = !api.workspaceInfo();
    (all.querySelector('input') as HTMLInputElement).checked = api.figureFolder;
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
  const list = h('ol', { class: 'arrow-list num-list', id: 'region-list', role: 'listbox', 'aria-label': t('sec.regions') });
  const inspector = h('div', { class: 'inspector', id: 'region-inspector' });
  const totals = h('dl', { class: 'num-grid', id: 'region-totals' });
  body.append(list, inspector, totals);
  const typeField = REGION_FIELDS[0];
  const refresh = (kind: RefreshKind) => {
    if (!['all', 'regions', 'selection', 'specimen', 'arrows', 'sequences', 'display', 'mesh'].includes(kind)) return;
    const st = api.store.state;
    const info = api.regionInfo();
    const u = st.specimen.unit;
    const area = (v: number | null) => quantity('area', v, u);
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
          ...valueCells(area(res?.area ?? null)),
        ),
      );
    }
    clear(inspector);
    const r = sel ? api.store.region(sel) : undefined;
    if (r) {
      const offered = offeredOptions(typeField, st.specimen.type);
      // a type not offered on this type of specimen is shown while the region has it
      const here = typeField.options!.find((o) => o.value === r.type && !offered.includes(o));
      const ctl = optionList('region-type', tl(typeField.label), [...offered.map((o, i) => ({ value: o.value, label: tl(o.label), key: String(i + 1) })), ...(here ? [{ value: here.value, label: tl(here.label) }] : [])], r.type, (v) => setType(r.id, v));
      inspector.append(
        ctl.el,
        h('div', { class: 'btn-row' }, deleteButton('region-delete', () => deleteRegion(api.store, r.id))),
      );
    }
    clear(totals);
    totals.hidden = !info || st.regions.length === 0;
    if (info && st.regions.length) {
      for (const k of ['scar', 'cortex', 'joint', 'damage', 'platform'] as const) if (info.totals[k] > 0) totals.append(...numRow(t(`region.area.${k}`), ...area(info.totals[k]), `region-total-${k}`));
      if (info.totals.cortex > 0) totals.append(...numRow(t('region.cortexRatio'), fmtQuantity('ratio', info.totals.cortexRatio), '', 'region-cortex-ratio'));
      totals.hidden = !totals.childElementCount;
    }
  };
  refresh('all');
  return { el, refresh };
}

/** Name of a face ("Front"). */
const faceName = (f: ConfigFace) => t(`figure.view.${f}`);

/** A flaking surface's faces: "F1 Front + Right". */
const surfaceText = (s: FlakingSurface) => `${s.id} ${s.faces.map(faceName).join(t('config.join'))}`;

/** One value per flaking surface: "F1 Wide · F2 Narrow". */
const perSurface = (r: ConfigurationResult, value: (s: FlakingSurface) => string) => (r.surfaces.length ? r.surfaces.map((s) => `${s.id} ${value(s)}`).join(' · ') : MISSING);

/** The bicone's flaking surfaces: "Upper", "Lower", "Upper, lower". */
const coneSurfaces = (r: BiconeResult) =>
  r.surfaces.length === 2 ? t('config.cones.both') : r.surfaces.length ? t(`config.cone.${r.surfaces[0].cone}`) : MISSING;

/**
 * The volumetric configuration, for the panel over the view: the model (box or bicone, when the
 * volume is split along a closed curve), the sketch, the traits (seven for the box, two for the
 * bicone), the picked face's or cone's card; and the title bar's pill.
 */
function configurationPanel(api: AppApi): Section & { pill: HTMLElement } {
  const pill = h('span', { class: 'pill', id: 'config-frame', hidden: true }, t('config.principal'));
  const el = h('div', { class: 'config-content' });
  const body = el;
  /** Bicone was asked for and which curve it stands on cannot be told: the choice is open. */
  let choosing = false;
  const noCurve = () => !api.store.state.curves.some((c) => c.closed) && api.store.state.configuration.model !== 'bicone';
  const chooseModel = (v: ConfigModel) => {
    const st = api.store.state;
    choosing = false;
    if (v === 'box') setConfigModel(api.store, 'box');
    else if (!noCurve()) {
      const sp = st.split;
      if (st.configuration.model === 'bicone' || (sp?.source === 'curve' && api.store.curve(sp.id)?.closed)) setConfigModel(api.store, 'bicone');
      else {
        const sole = soleEdgeCurve(st.curves);
        if (sole) api.useEdgeCurve(sole.id);
        else choosing = true;
      }
    }
    refresh('configuration');
  };
  const model = segmented('config-model', null, CONFIG_MODELS.map((v) => ({ value: v, label: t(`config.model.${v}`) })), api.store.state.configuration.model, (v) => chooseModel(v as ConfigModel));
  // not `disabled`: the reason has to show on hover in every browser
  const biconeBtn = model.el.querySelector('#config-model-bicone') as HTMLElement;
  tips.attach(biconeBtn, () => (noCurve() ? { label: t('config.needsCurve') } : null));
  const status = h('span', { class: 'pill config-status', id: 'config-status', hidden: true });
  const modelRow = h('div', { class: 'config-model-row', id: 'config-model-row' }, model.el, status);
  const edgeSelect = h('select', { class: 'ctl-select', id: 'config-edge-curve', 'aria-label': t('config.edgeCurve') }) as HTMLSelectElement;
  edgeSelect.addEventListener('change', () => {
    if (!edgeSelect.value) return;
    choosing = false;
    api.useEdgeCurve(edgeSelect.value);
    refresh('configuration');
  });
  const swap = h('button', { type: 'button', class: 'icon-btn', id: 'config-swap', 'aria-label': t('split.swap'), onclick: () => swapSplit(api.store) }, icon(ICONS.swap)) as HTMLButtonElement;
  tip(swap, t('split.swap'));
  const edgeRow = h('div', { class: 'config-edge-row', id: 'config-edge-row' }, h('label', { class: 'ctl-label', for: 'config-edge-curve' }, t('config.edgeCurve')), edgeSelect, swap);
  const sketch = h('div', { class: 'config-sketch-wrap' }, api.configSketch().canvas);
  const traits = h('dl', { class: 'num-grid config-traits', id: 'config-traits' });
  const card = h('div', { class: 'config-card', id: 'config-card' });
  body.append(modelRow, edgeRow, sketch, traits, card);
  /** A card just opened or changed face comes into view, even in a very low window. */
  let cardFor: string | null = null;
  const fit = () => {
    api.fitConfigPanel();
    const pick = card.hidden ? null : api.configFace();
    if (pick && pick !== cardFor) card.scrollIntoView({ block: 'nearest' });
    cardFor = pick;
  };
  const polarity = h('select', { class: 'ctl-select config-polarity', id: 'config-polarity', 'aria-label': t('config.polarity') }) as HTMLSelectElement;
  polarity.addEventListener('change', () => setConfigPolarity(api.store, (polarity.value || null) as Polarity | null));

  /** The picked cone: its scars, whether it was edited, its role, and the swap of upper and lower. */
  const renderConeCard = (r: BiconeResult) => {
    clear(card);
    const pick = api.configFace();
    const cone = r.cones.find((x) => x.cone === pick);
    card.hidden = !cone;
    if (!cone) return;
    const edited = api.store.state.configuration.bicone.roles[cone.side] !== undefined;
    card.dataset.face = cone.cone;
    card.append(
      h(
        'div',
        { class: 'config-card-head' },
        h('span', { class: 'config-face-name', id: 'config-face-name' }, t(`config.cone.${cone.cone}`)),
        h('span', { class: 'config-face-count mono' }, t('config.scars', { n: cone.scars })),
        h('span', { class: `pill${edited ? ' pill-set' : ''}`, id: 'config-face-state' }, t(edited ? 'config.edited' : 'config.isAuto')),
        edited ? iconButton(ICONS.rotateLeft, t('config.reset'), () => setBiconeRole(api.store, cone.side, null), { id: 'config-reset' }) : null,
      ),
      segmented(
        'config-role',
        null,
        BICONE_ROLES.map((v) => ({ value: v, label: t(`config.coneRole.${v}`) })),
        cone.role,
        (v) => setBiconeRole(api.store, cone.side, v === cone.autoRole ? null : (v as BiconeRole)),
      ).el,
    );
  };

  const renderCard = (r: ConfigurationResult) => {
    clear(card);
    const st = api.store.state;
    const c = st.configuration;
    // only once a face is picked
    const pick = api.configFace();
    const face = pick && pick !== 'upper' && pick !== 'lower' ? pick : null;
    card.hidden = !face;
    if (!face) return;
    const fr = r.faces.find((f) => f.face === face)!;
    const edited = c.roles[face] !== undefined || c.surfaceType[face] !== undefined || c.axis[face] !== undefined || Object.keys(c.joins).some((k) => k.split('|').includes(face));
    const surface = r.surfaces.find((s) => s.faces.includes(face));
    card.dataset.face = face;
    card.append(
      h(
        'div',
        { class: 'config-card-head' },
        h('span', { class: 'config-face-name', id: 'config-face-name' }, faceName(face)),
        h('span', { class: 'config-face-count mono' }, t('config.scars', { n: fr.scars })),
        h('span', { class: `pill${edited ? ' pill-set' : ''}`, id: 'config-face-state' }, t(edited ? 'config.edited' : 'config.isAuto')),
        edited ? iconButton(ICONS.rotateLeft, t('config.reset'), () => resetConfigFace(api.store, face, surface?.faces ?? [face]), { id: 'config-reset' }) : null,
      ),
      segmented(
        'config-role',
        null,
        CONFIG_ROLES.map((v) => ({ value: v, label: t(`config.role.${v}`) })),
        fr.role,
        (v) => setConfigRole(api.store, face, v === fr.autoRole ? null : (v as ConfigRole)),
      ).el,
    );
    if (!surface) return;
    // type and axis act on the whole flaking surface; an automatic "unclear" or "—" lights neither
    card.append(
      h('div', { class: 'config-card-pair' }, segmented(
        'config-type',
        null,
        (['wide', 'narrow'] as const).map((v) => ({ value: v, label: t(`config.type.${v}`) })),
        surface.type,
        (v) => setConfigSurfaceType(api.store, face, v === surface.autoType ? null : (v as 'wide' | 'narrow'), surface.faces),
      ).el, segmented(
        'config-axis',
        null,
        (['long', 'short'] as const).map((v) => ({ value: v, label: t(`config.axis.${v}`) })),
        surface.axis,
        (v) => setConfigAxis(api.store, face, v === surface.autoAxis ? null : (v as 'long' | 'short'), surface.faces),
      ).el),
    );
    const joins = r.joins.filter((x) => x.faces.includes(face));
    if (!joins.length) return;
    const joinRow = h('div', { class: 'config-card-joins' });
    card.append(joinRow);
    for (const j of joins) {
      const other = j.faces[0] === face ? j.faces[1] : j.faces[0];
      joinRow.append(checkbox(`config-join-${other}`, t('config.joined', { face: faceName(other) }), j.joined, (on) => setConfigJoin(api.store, face, other, on === j.auto ? null : on)));
    }
  };

  const refresh = (kind: RefreshKind) => {
    if (!['all', 'configuration', 'arrows', 'specimen', 'mesh', 'figure', 'split', 'curves'].includes(kind)) return;
    const st = api.store.state;
    const bicone = st.configuration.model === 'bicone';
    pill.hidden = !!st.specimen.frame || bicone;
    model.set(st.configuration.model);
    const off = noCurve();
    biconeBtn.setAttribute('aria-disabled', String(off));
    biconeBtn.classList.toggle('is-disabled', off);
    // the curve under the bicone: always with the bicone, and while one has to be chosen for it
    const loops = edgeCurves(st.curves);
    if (bicone || off) choosing = false;
    edgeRow.hidden = !bicone && !choosing;
    const current = st.split?.source === 'curve' && loops.some((c) => c.id === st.split!.id) ? st.split.id : '';
    clear(edgeSelect);
    edgeSelect.append(h('option', { value: '', hidden: true }, MISSING), ...loops.map((c) => h('option', { value: c.id }, c.label)));
    edgeSelect.value = bicone ? current : '';
    swap.hidden = !bicone || !current;
    const reason = api.configStatus();
    status.hidden = !reason;
    const reasons = { computing: 'config.computing', not_closed: 'config.notClosed', split_invalid: 'config.splitInvalid' } as const;
    status.textContent = reason ? t(reasons[reason]) : '';
    const wasHidden = sketch.hidden;
    sketch.hidden = traits.hidden = !!reason;
    // shown again: what was built while it was hidden has not been drawn (and the size may not have changed in between)
    if (wasHidden && !sketch.hidden) api.configSketch().resize();
    const found = api.configuration();
    clear(traits);
    clear(card);
    clear(polarity);
    if (bicone) {
      const b = isBicone(found) ? found : null;
      traits.append(
        ...textValueRow(t('config.facial'), b?.facialCharacter ? t(`config.facial.${b.facialCharacter}`) : MISSING, 'config-facial'),
        ...textValueRow(t('config.surfaces'), b ? coneSurfaces(b) : MISSING, 'config-surfaces'),
      );
      if (b) renderConeCard(b);
      else card.hidden = true;
      fit();
      return;
    }
    const r = found && !isBicone(found) ? found : null;
    const code = (prefix: string, v: string | null) => (v ? t(`${prefix}.${v}`) : MISSING);
    polarity.append(
      h('option', { value: '', selected: !st.configuration.polarity }, t('config.auto', { value: code('config.polarity', r?.autoPolarity ?? null) })),
      ...POLARITIES.map((p) => h('option', { value: p, selected: st.configuration.polarity === p }, t(`config.polarity.${p}`))),
    );
    polarity.disabled = !r?.surfaces.length;
    traits.append(
      ...textValueRow(t('config.facial'), code('config.facial', r?.facialCharacter ?? null), 'config-facial'),
      ...textValueRow(t('config.surfaces'), r?.surfaces.length ? r.surfaces.map(surfaceText).join(' · ') : MISSING, 'config-surfaces'),
      ...textValueRow(t('config.surfaceRelation'), code('config.relation', r?.flakingSurfaceRelation ?? null), 'config-surface-relation'),
      ...textValueRow(t('config.platformRelation'), code('config.relation', r?.platformRelation ?? null), 'config-platform-relation'),
      h('dt', { class: 'config-wide' }, t('config.polarity')),
      h('dd', { class: 'text config-wide', id: 'config-polarity-cell' }, polarity),
      ...textValueRow(t('config.surfaceType'), r ? perSurface(r, (s) => t(`config.type.${s.type}`)) : MISSING, 'config-type-value'),
      ...textValueRow(t('config.axis'), r ? perSurface(r, (s) => t(`config.axis.${s.axis}`)) : MISSING, 'config-axis-value'),
    );
    if (r) renderCard(r);
    else card.hidden = true;
    fit();
  };
  refresh('all');
  return { el, refresh, pill };
}

function relationsSection(api: AppApi): Section {
  const badge = h('span', { class: 'badge mono' }, '0');
  const { el, body } = section('relations', t('sec.relations'), badge);
  const checks = h('button', { type: 'button', class: 'btn btn-quiet btn-sm problem-toggle mono', id: 'relation-problems', onclick: () => api.setProblems(!api.problemsOpen) }) as HTMLButtonElement;
  const problems = h('ol', { class: 'problem-list', id: 'relation-problem-list' });
  const list = h('ol', { class: 'arrow-list', id: 'relation-list', role: 'listbox', 'aria-label': t('sec.relations') });
  const inspector = h('div', { class: 'inspector', id: 'relation-inspector' });
  const addSeq = plusButton(t('sequence.add'), () => api.selection.set(addSequence(api.store).id), 'sequence-add');
  const seqList = h('ol', { class: 'arrow-list num-list', id: 'sequence-list', role: 'listbox', 'aria-label': t('sequence.title') });
  const seqInspector = h('div', { class: 'inspector', id: 'sequence-inspector' });
  const checksRow = h('div', { class: 'checks-row' }, h('span', { class: 'ctl-label' }, t('relation.checks')), checks);
  // the relation tool: bordering scars with nothing recorded yet
  const unjudgedText = h('span', { class: 'ctl-label', id: 'relation-unjudged-count' });
  const unjudged = h(
    'div',
    { class: 'checks-row', id: 'relation-unjudged', hidden: true },
    unjudgedText,
    iconButton(ICONS.next, t('relation.nextPair'), () => api.nextUnjudgedPair(), { id: 'relation-next-pair' }),
  );
  body.append(
    checksRow,
    problems,
    unjudged,
    list,
    inspector,
    h('span', { class: 'ctl-label sub-label' }, t('sequence.title')),
    seqList,
    addSeq,
    seqInspector,
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

  /** Why `later` comes after `earlier`: the relations leading from one to the other ("S3 cuts S5 · S5 cuts S2"). */
  const why = (s: Stratigraphy, later: string, earlier: string) =>
    (s.chain(later, earlier) ?? []).map((e) => t('relation.cuts', { a: scarLabel(e.later), b: scarLabel(e.earlier) })).join(' · ');
  /** Why sequence `p` comes before `q` (a member of q is later than one of p). */
  const whySeq = (s: Stratigraphy, p: readonly string[], q: readonly string[]) => {
    for (const x of q) for (const y of p) if (s.later(x, y)) return why(s, x, y);
    return '';
  };
  /** A move button; a move the relations rule out is disabled and says why. */
  const moveButton = (attrs: Record<string, unknown>, label: string, reason: string, content: Node[], blocked: boolean) =>
    h('button', { type: 'button', ...attrs, title: reason ? `${label} · ${reason}` : label, 'aria-label': label, disabled: blocked }, ...content);

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
    const { scarIds, edges } = relationInputs(st);
    const s = stratigraphy(scarIds, edges);
    const ids = q.scarIds;
    const members = h('ol', { class: 'arrow-list', id: 'sequence-members' });
    ids.forEach((id, k) => {
      // between two rows: solid where the relations put them in this order, dashed where only the hand did
      if (q.ordered && k > 0) {
        const held = s.before(ids[k - 1], id);
        members.append(h('li', { class: `member-link ${held ? 'is-held' : 'is-manual'}`, 'aria-hidden': 'true' }));
      }
      const upReason = k > 0 && s.before(ids[k - 1], id) ? why(s, id, ids[k - 1]) : '';
      const downReason = k < ids.length - 1 && s.before(id, ids[k + 1]) ? why(s, ids[k + 1], id) : '';
      const tools = q.ordered
        ? [
            moveButton({ class: 'icon-btn', 'data-act': 'up', onclick: (e: Event) => (e.stopPropagation(), moveInSequence(api.store, id, -1)) }, t('sequence.earlier'), upReason, [icon(ICONS.up)], k === 0 || !!upReason),
            moveButton({ class: 'icon-btn', 'data-act': 'down', onclick: (e: Event) => (e.stopPropagation(), moveInSequence(api.store, id, 1)) }, t('sequence.later'), downReason, [icon(ICONS.down)], k === ids.length - 1 || !!downReason),
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
    members.hidden = ids.length === 0;
    const prev = st.sequences[i - 1], next = st.sequences[i + 1];
    const earlierReason = prev && s.sequenceBefore(prev.scarIds, ids) ? whySeq(s, prev.scarIds, ids) : '';
    const laterReason = next && s.sequenceBefore(ids, next.scarIds) ? whySeq(s, ids, next.scarIds) : '';
    holder.append(
      checkbox('sequence-ordered', t('sequence.ordered'), q.ordered, (on) => updateSequence(api.store, q.id, { ordered: on })),
      members,
      h(
        'div',
        { class: 'btn-row' },
        moveButton({ class: 'icon-btn', id: 'sequence-earlier', onclick: () => moveSequence(api.store, q.id, -1) }, t('sequence.earlier'), earlierReason, [icon(ICONS.up)], !prev || !!earlierReason),
        moveButton({ class: 'icon-btn', id: 'sequence-later', onclick: () => moveSequence(api.store, q.id, 1) }, t('sequence.later'), laterReason, [icon(ICONS.down)], !next || !!laterReason),
        deleteButton('sequence-delete', () => deleteSequence(api.store, q.id)),
      ),
    );
  };

  const refresh = (kind: RefreshKind) => {
    if (!['all', 'relations', 'sequences', 'arrows', 'selection', 'display', 'mesh'].includes(kind)) return;
    const st = api.store.state;
    const sel = api.selection.id;
    badge.textContent = String(st.relations.length);
    // nothing to check or draw before something is recorded
    checksRow.hidden = !st.relations.length && !st.sequences.length;
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
    // bordering scars not judged yet (while the relation tool is in use)
    const pairs = api.toolId() === 'relation' ? api.unjudgedPairs() : 0;
    unjudged.hidden = pairs === 0;
    unjudgedText.textContent = t('relation.unjudged', { n: pairs });
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
      inspector.append(kind.el, h('div', { class: 'btn-row' }, deleteButton('relation-delete', () => deleteRelation(api.store, r.id))));
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
          ...valueCells([fmtCount(q.scarIds.length), '']),
        ),
      ),
    );
    renderSequence();
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
  const addSet = plusButton(t('semi.add'), () => {
    const st = api.store.state;
    const sel = api.selection.id;
    const curve = (sel && api.store.curve(sel)) || st.curves[0];
    if (curve) api.selection.set(addSemilandmarkSet(api.store, curve.id).id);
  }, 'semilandmark-add');
  const setList = h('ol', { class: 'arrow-list num-list', id: 'semilandmark-list', role: 'listbox', 'aria-label': t('semi.title') });
  const setInspector = h('div', { class: 'inspector', id: 'semilandmark-inspector' });
  const setHead = h('span', { class: 'ctl-label sub-label' }, t('semi.title'));
  body.append(names, list, inspector, setHead, setList, addSet, setInspector);

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
    if (!['all', 'landmarks', 'curves', 'selection', 'mesh', 'specimen', 'flake'].includes(kind)) return;
    const st = api.store.state;
    const sel = api.selection.id;
    const table = api.landmarkTable();
    const fixed = shownLandmarks(st);
    badge.textContent = String(fixed.length);
    const sides = platformSides(st.flake.axis?.matrix, fixed);
    /** What the list calls a landmark: those of the flake's own by what they are. */
    const nameOf = (l: (typeof fixed)[number]) => (l.code === 'pop' ? t('landmark.pop') : l.code !== 'platform_end' ? l.name : landmarkName(l, sides) === 'platform_left' ? t('landmark.platformLeft') : landmarkName(l, sides) === 'platform_right' ? t('landmark.platformRight') : t('landmark.platformEnd'));

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
    } else if (api.previousNames().length) {
      names.append(h('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'landmark-reuse-names', onclick: () => api.reuseNames() }, t('landmark.reuseNames')));
    }
    names.hidden = !names.childElementCount;

    // fixed landmarks, in export order (drag to reorder)
    clear(list);
    list.hidden = fixed.length === 0;
    fixed.forEach((l, shown) => {
      // the position in the whole list (the export order): what a move goes by
      const i = st.landmarks.indexOf(l);
      const li = h(
        'li',
        { class: 'arrow-row landmark-row', role: 'option', 'aria-selected': String(l.id === sel), 'data-id': l.id, draggable: 'true', onclick: () => api.selection.set(l.id) },
        h('span', { class: 'chip chip-dot', style: `--chip:${l.id === sel ? LANDMARK_COLORS.selected : LANDMARK_COLORS.fixed}` }),
        h('span', { class: 'arrow-id mono' }, String(shown + 1)),
        h('span', { class: 'arrow-meta' }, nameOf(l)),
        l.code === 'pop' ? h('span', { class: 'landmark-lock', id: 'landmark-pop-lock', title: t('landmark.locked'), 'aria-label': t('landmark.locked') }, icon(ICONS.lock)) : null,
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
        const row = textRow('landmark-name', t('landmark.name'), nameOf(l), (v) => renameLandmark(api.store, l.id, v));
        nameInput = row.input as HTMLInputElement;
        // a landmark of the flake's own is named by what it is
        nameInput.disabled = !!l.code;
        inspector.append(row.el, h('div', { class: 'landmark-body' }));
        builtFor = l.id;
      }
      softSet(nameInput, nameOf(l));
      const holder = inspector.querySelector('.landmark-body') as HTMLElement;
      clear(holder);
      const i = st.landmarks.indexOf(l);
      holder.append(
        h('dl', { class: 'coord-grid', id: 'landmark-coords' }, ...coordRow('x, y, z', coords(l.point), quantityUnit('coord', st.specimen.unit))),
        h(
          'div',
          { class: 'btn-row' },
          iconButton(ICONS.up, t('landmark.up'), () => reorderLandmark(api.store, l.id, i - 1), { id: 'landmark-up', disabled: i === 0 }),
          iconButton(ICONS.down, t('landmark.down'), () => reorderLandmark(api.store, l.id, i + 1), { id: 'landmark-down', disabled: i === st.landmarks.length - 1 }),
          l.code === 'pop' ? null : deleteButton('landmark-delete', () => deleteLandmark(api.store, l.id)),
        ),
      );
    }

    // curve semilandmarks
    addSet.disabled = !api.hasMesh() || st.curves.length === 0;
    // semilandmarks need a curve
    setHead.hidden = addSet.hidden = !st.curves.length && !st.semilandmarks.length;
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
          h('span', { class: 'arrow-meta' }, curve?.label ?? MISSING),
          ...valueCells([res?.valid ? fmtCount(q.count) : MISSING, '']),
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
    const lms: Array<[string, string]> = [['', t('semi.none')], ...fixed.map((x, i): [string, string] => [x.id, `${i + 1} · ${nameOf(x)}`])];
    holder.append(
      select('semilandmark-curve', t('semi.curve'), st.curves.map((c): [string, string] => [c.id, c.label]), q.curveId, (v) => updateSemilandmarkSet(api.store, q.id, { curveId: v })),
      h(
        'div',
        { class: 'ctl-grid' },
        select('semilandmark-start', t('semi.start'), lms, q.startLandmarkId ?? '', (v) => updateSemilandmarkSet(api.store, q.id, { startLandmarkId: v || null })),
        select('semilandmark-end', t('semi.end'), lms, q.endLandmarkId ?? '', (v) => updateSemilandmarkSet(api.store, q.id, { endLandmarkId: v || null })),
      ),
      h('div', { class: 'btn-row' }, deleteButton('semilandmark-delete', () => deleteSemilandmarkSet(api.store, q.id))),
    );
  };
  refresh('all');
  return { el, refresh };
}

function noduleSection(api: AppApi): Section {
  const { el, body } = section('nodule', t('sec.nodule'));
  const regions = h('div', { class: 'fig-views', id: 'nodule-regions' });
  const meta = h('dl', { class: 'num-grid' });
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
        ...numRow(t('nodule.radius'), ...quantity('length', f.radius, u), 'nodule-radius'),
        ...numRow(t('nodule.rms'), ...quantity('length', f.rms, u), 'nodule-rms'),
        ...numRow(t('nodule.points'), fmtCount(f.count), '', 'nodule-points'),
      );
    (show.querySelector('input') as HTMLInputElement).checked = st.nodule.show;
    (show.querySelector('input') as HTMLInputElement).disabled = !f;
  };
  refresh('all');
  // a sphere needs cortex
  return { el, refresh, visible: () => api.store.state.regions.some((r) => r.type === 'cortex') };
}

function splitSection(api: AppApi): Section {
  const { el, body } = section('split', t('sec.split'));
  const select = h('select', { id: 'split-source', class: 'ctl-select', 'aria-label': t('split.by') }) as HTMLSelectElement;
  select.addEventListener('change', () => {
    const [source, id] = select.value.split(':');
    // a new curve: the side with more scars up
    if (source === 'curve') setSplit(api.store, { source, id, upHint: api.splitUpHint(id), swap: false });
    else setSplit(api.store, source === 'plane' ? { source, id, upHint: api.towardViewer(), swap: false } : null);
  });
  const flip = iconButton(ICONS.swap, t('split.swap'), () => swapSplit(api.store), { id: 'split-swap' });
  const meta = h('dl', { class: 'num-grid' });
  body.append(h('div', { class: 'ctl' }, h('label', { class: 'ctl-label', for: 'split-source' }, t('split.by')), h('div', { class: 'split-source-row' }, select, flip)), meta);
  const refresh = (kind: RefreshKind) => {
    if (!['all', 'split', 'planes', 'curves', 'mesh', 'specimen', 'measure'].includes(kind)) return;
    const st = api.store.state;
    const options: Array<[string, string]> = [['', t('split.none')]];
    // closed core edges first: the curve a core is split along
    const loops = st.curves.filter((c) => c.closed);
    const edge = (c: Curve) => c.attributes.type === 'core_edge';
    for (const c of loops.filter(edge)) options.push([`curve:${c.id}`, c.label]);
    for (const p of api.planeResults()) if (p.valid) options.push([`plane:${p.id}`, p.label]);
    for (const c of loops.filter((x) => !edge(x))) options.push([`curve:${c.id}`, c.label]);
    // a split whose plane or curve can no longer split stays listed, so it can be seen and cleared
    const current = st.split ? `${st.split.source}:${st.split.id}` : '';
    if (st.split && !options.some(([v]) => v === current)) options.push([current, (st.split.source === 'plane' ? api.store.plane(st.split.id) : api.store.curve(st.split.id))?.label ?? '–']);
    clear(select);
    for (const [value, label] of options) select.append(h('option', { value }, label));
    select.value = current;
    flip.hidden = !st.split;
    clear(meta);
    const u = st.specimen.unit;
    const closed = api.meshClosed();
    if (closed === false) meta.append(...textValueRow(t('measure.volume'), t('measure.notClosed')));
    const v = api.volumeSplit();
    if (v)
      meta.append(
        ...numRow(t('split.upper'), ...quantity('volume', v.upper, u), 'split-upper'),
        ...numRow(t('split.lower'), ...quantity('volume', v.lower, u), 'split-lower'),
        ...numRow(t('split.ratio'), fmtQuantity('ratio', v.ratio), '', 'split-ratio'),
      );
  };
  refresh('all');
  // a split needs a closed curve or a plane
  return { el, refresh, visible: () => !!api.store.state.split || api.store.state.curves.some((c) => c.closed) || api.planeResults().some((p) => p.valid) };
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
        deleteButton('section-delete', () => deleteSection(api.store, s.id)),
      ),
    );
  };
  refresh('all');
  return { el, refresh };
}

// ---------------------------------------------------------------- workspace

function workspaceSection(api: AppApi): Section {
  const { el, body } = section('workspace', t('sec.workspace'));
  const name = h('div', { class: 'checks-row' });
  const typeFilter = h('select', { id: 'workspace-type', class: 'ctl-select', 'aria-label': t('workspace.type') }, h('option', { value: '' }, t('workspace.type.all')), ...SPECIMEN_TYPES.map((x) => h('option', { value: x }, t(`specimen.type.${x}`)))) as HTMLSelectElement;
  const filter = h('input', { id: 'workspace-filter', class: 'ctl-text', type: 'search', placeholder: t('workspace.filter'), 'aria-label': t('workspace.filter'), autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  // the models: only the rows in view are made (folders of a thousand models stay quick)
  const ROW = 28;
  const list = h('div', { class: 'ws-list', id: 'workspace-list', role: 'listbox', 'aria-label': t('sec.workspace') });
  const spacer = h('div', { class: 'ws-spacer' });
  list.append(spacer);
  const prev = h('button', { type: 'button', class: 'icon-btn', id: 'workspace-prev', title: `${t('workspace.prev')} (PageUp)`, 'aria-label': t('workspace.prev'), onclick: () => api.stepWorkspace(-1) }, icon(ICONS.up)) as HTMLButtonElement;
  const next = h('button', { type: 'button', class: 'icon-btn', id: 'workspace-next', title: `${t('workspace.next')} (PageDown)`, 'aria-label': t('workspace.next'), onclick: () => api.stepWorkspace(1) }, icon(ICONS.down)) as HTMLButtonElement;
  const nextNew = h('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'workspace-next-new', title: `${t('workspace.nextNew')} (Shift+PageDown)`, onclick: () => api.nextUnstarted() }, t('workspace.nextNew')) as HTMLButtonElement;
  const download = iconButton(ICONS.download, t('workspace.downloadProjects'), () => void api.downloadProjects(), { id: 'workspace-download' });
  const bar = h('progress', { id: 'batch-progress', max: 1, value: 0 }) as HTMLProgressElement;
  const barText = h('span', { class: 'mono', id: 'batch-status' });
  const cancel = iconButton(ICONS.close, t('dlg.cancel'), () => api.cancelBatch(), { id: 'batch-cancel' });
  const progress = h('div', { class: 'batch-row' }, barText, bar, cancel);
  body.append(name, h('div', { class: 'workspace-filters' }, filter, typeFilter), list, h('div', { class: 'workspace-nav' }, prev, next, nextNew, download), progress);

  let shown: number[] = [];
  let lastIndex = -2;
  const renderRows = () => {
    const ws = api.workspaceInfo();
    if (!ws) return;
    const from = Math.max(0, Math.floor(list.scrollTop / ROW) - 4);
    const to = Math.min(shown.length, from + Math.ceil((list.clientHeight || 10 * ROW) / ROW) + 8);
    for (const r of [...list.querySelectorAll('.ws-row')]) r.remove();
    for (let k = from; k < to; k++) {
      const i = shown[k];
      const started = ws.started[i];
      list.append(
        h(
          'div',
          { class: 'ws-row', role: 'option', 'data-index': String(i), 'aria-selected': String(i === ws.index), style: `top:${k * ROW}px`, title: ws.meshes[i], onclick: () => !api.batchInfo() && void api.openWorkspaceMesh(i) },
          h('span', { class: `ws-dot${started ? ' is-started' : ''}`, title: t(started ? 'workspace.started' : 'workspace.notStarted'), 'aria-label': t(started ? 'workspace.started' : 'workspace.notStarted') }),
          h('span', { class: 'ws-path mono' }, ws.meshes[i]),
          ws.types[i] ? h('span', { class: 'ws-type', 'data-type': ws.types[i] }, t(`specimen.type.${ws.types[i]}`)) : null,
        ),
      );
    }
  };
  list.addEventListener('scroll', () => requestAnimationFrame(renderRows));
  const applyFilter = () => {
    const ws = api.workspaceInfo();
    if (!ws) return;
    const q = filter.value.trim().toLowerCase();
    const type = typeFilter.value;
    shown = ws.meshes.flatMap((m, i) => ((!q || m.toLowerCase().includes(q)) && (!type || ws.types[i] === type) ? [i] : []));
    spacer.style.height = `${shown.length * ROW}px`;
    list.style.height = `${Math.max(1, Math.min(shown.length, 10)) * ROW + 2}px`;
    renderRows();
  };
  filter.addEventListener('input', applyFilter);
  typeFilter.addEventListener('change', applyFilter);

  const refresh = (kind: RefreshKind) => {
    if (!['all', 'workspace', 'mesh'].includes(kind)) return;
    const ws = api.workspaceInfo();
    if (!ws) return;
    clear(name);
    name.append(h('span', { class: 'workspace-name', id: 'workspace-name' }, ws.name), ws.writable ? h('span') : h('span', { class: 'tag', id: 'workspace-readonly' }, t('workspace.readOnly')));
    const b = api.batchInfo();
    applyFilter();
    // the open model in view
    if (ws.index !== lastIndex) {
      lastIndex = ws.index;
      const k = shown.indexOf(ws.index);
      if (k >= 0 && (k * ROW < list.scrollTop || (k + 1) * ROW > list.scrollTop + list.clientHeight)) {
        list.scrollTop = Math.max(0, k * ROW - list.clientHeight / 2);
        renderRows();
      }
    }
    prev.disabled = !!b || ws.index <= 0;
    next.disabled = !!b || ws.index >= ws.meshes.length - 1;
    nextNew.disabled = !!b || ws.started.every(Boolean);
    list.classList.toggle('is-busy', !!b);
    download.hidden = ws.writable;
    download.disabled = !!b || !ws.undownloaded;
    download.classList.toggle('btn-primary', ws.undownloaded > 0);
    progress.hidden = !b;
    if (b) {
      bar.max = b.total;
      bar.value = b.done;
      const what = t(b.kind === 'measure' ? 'workspace.exportAll' : 'workspace.batchFigures');
      const state = b.paused ? t('workspace.paused') : b.eta !== null ? t('workspace.eta', { t: fmtDuration(b.eta) }) : '';
      barText.textContent = [`${what} ${b.done} / ${b.total}`, state].filter(Boolean).join(' · ');
    }
  };
  refresh('all');
  return { el, refresh, visible: () => !!api.workspaceInfo() };
}

// ---------------------------------------------------------------- compare

function observersSection(api: AppApi): Section {
  const { el, body } = section('observers', t('sec.observers'));
  const list = h('ol', { class: 'arrow-list', id: 'observer-list', 'aria-label': t('sec.observers') });
  const add = addButton(t('compare.add'), () => api.addObserverFiles(), 'compare-add');
  const addFolder = addButton(t('compare.addFolder'), () => void api.addFolderObservers(), 'compare-add-folder');
  const gate = h('input', { id: 'compare-gate', class: 'ctl-text mono', type: 'number', min: 0, step: 'any' }) as HTMLInputElement;
  gate.addEventListener('change', () => api.setCompareGate(Number(gate.value)));
  const unit = h('span', { class: 'gate-unit mono' });
  body.append(list, add, addFolder, h('div', { class: 'ctl' }, h('label', { class: 'ctl-label', for: 'compare-gate' }, t('compare.gate')), h('div', { class: 'gate-row' }, gate, unit)));
  const refresh = (kind: RefreshKind) => {
    if (!['all', 'compare', 'mesh', 'specimen', 'workspace'].includes(kind)) return;
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
    addFolder.hidden = !api.workspaceInfo();
    addFolder.disabled = !api.hasMesh();
    softSet(gate, String(api.compareGate()));
    unit.textContent = api.store.state.specimen.unit;
  };
  refresh('all');
  return { el, refresh };
}

/** The groups of the agreement table, in order; region rows include the per-triangle type agreement. */
const AGREE_GROUPS: Array<[string, string[]]> = [
  ['arrow', ['arrow']],
  ['scar_attribute', ['scar_attribute']],
  ['curve', ['curve']],
  ['plane', ['plane']],
  ['region', ['region', 'region_type']],
  ['landmark', ['landmark']],
  ['semilandmark', ['semilandmark']],
  ['relation', ['relation']],
  ['measurement', ['measurement']],
];

/** Item types whose rows compare pairs of drawn items: a click shows the most different pair. */
const AGREE_PAIRS = new Set(['arrow', 'curve', 'landmark', 'semilandmark']);

const REGION_KEYS = ['scar', 'cortex', 'joint', 'damage', 'platform'];

function agreementSection(api: AppApi): Section {
  const { el, body } = section('agreement', t('sec.agreement'));
  const status = h('p', { class: 'agree-status', id: 'agreement-status' });
  const table = h('div', { class: 'agree-wrap', id: 'agreement-table' });
  const none = h('p', { class: 'agree-empty', id: 'agreement-empty', hidden: true }, t('agree.none'));
  body.append(status, table, none);
  const mean = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN);
  const refresh = (kind: RefreshKind) => {
    if (!['all', 'compare', 'mesh', 'specimen'].includes(kind)) return;
    const busy = api.agreementBusy();
    status.textContent = busy ? t('compare.computing') : '';
    status.hidden = !busy;
    const res = api.agreementResult();
    clear(table);
    none.hidden = true;
    if (!res) return;
    const u = api.store.state.specimen.unit;
    /** What kind of quantity a metric is (its decimals and unit). */
    const kindOf = (metric: string, itemType: string, key: string): Quantity => {
      if (metric.endsWith('_deg')) return 'angle';
      if (metric === 'area' || (itemType === 'measurement' && key.startsWith('area_'))) return 'area';
      if (['start_distance', 'end_distance', 'mean_distance', 'hausdorff', 'center_distance', 'distance'].includes(metric)) return 'length';
      if (itemType === 'measurement' && ['length', 'width', 'thickness'].includes(key)) return 'length';
      if (itemType === 'measurement' && key !== 'cortex_ratio') {
        const m = api.store.state.measurements.find((x) => x.label === key);
        if (m) return m.type === 'angle' ? 'angle' : 'length';
      }
      return 'ratio';
    };
    const unitOf = (metric: string, itemType: string, key: string): string => quantityUnit(kindOf(metric, itemType, key), u);
    const keyName = (itemType: string, key: string): string => {
      if (itemType === 'scar_attribute') {
        const f = SCAR_FIELDS.find((x) => x.key === key);
        return f ? tl(f.label) : key;
      }
      if (itemType === 'region' && REGION_KEYS.includes(key)) {
        const o = REGION_FIELDS[0].options?.find((x) => x.value === key);
        return o ? tl(o.label) : key;
      }
      if (itemType === 'region') return t('agree.scarRegions');
      if (itemType === 'region_type') return t('agree.regionTypes');
      if (itemType === 'measurement') return ['length', 'width', 'thickness', 'cortex_ratio'].includes(key) || key.startsWith('area_') ? t(`agree.measure.${key}`) : key;
      return '';
    };
    const focus = api.agreementFocus();
    // pairs of observers in the order they come, the joint (Fleiss) rows last
    const pairs = [...new Map(res.rows.map((r) => [`${r.a}\u0000${r.b}`, [r.a, r.b] as const])).values()];
    const sections: HTMLElement[] = [];
    for (const [group, types] of AGREE_GROUPS) {
      for (const [a, b] of pairs) {
        const rows = res.rows.filter((r) => types.includes(r.itemType) && r.a === a && r.b === b);
        if (!rows.length) continue;
        const who = b ? `${a} – ${b}` : t('agree.all');
        const value = (type: string, key: string, metric: string) => rows.find((r) => r.itemType === type && r.itemKey === key && r.metric === metric)?.value;
        // how the items were paired
        let pairing: string;
        if (group === 'arrow' || group === 'curve') {
          const m = value(group, 'all', 'matched') ?? 0, ua = value(group, 'all', 'unmatched_a') ?? 0, ub = value(group, 'all', 'unmatched_b') ?? 0;
          // neither observer drew any: nothing to show
          if (m + ua + ub === 0) continue;
          pairing = t('agree.pairing', { m, n: m + ua, a, ua, b, ub });
        } else if (group === 'region') {
          // scar regions are paired; region types are compared over the area both observers typed
          const n = new Set(rows.filter((r) => r.itemType === 'region' && !REGION_KEYS.includes(r.itemKey)).map((r) => r.itemKey)).size;
          const area = value('region_type', 'all', 'area');
          pairing = [n ? t('agree.paired', { n }) : '', area !== undefined ? `${t('agree.metric.area')} ${fmtQuantity('area', area)} ${unitOf('area', 'region_type', 'all')}`.trim() : ''].filter(Boolean).join(' · ');
        } else {
          const n = rows.find((r) => r.metric === 'n_items')?.value ?? new Set(rows.filter((r) => r.itemKey !== 'all').map((r) => r.itemKey)).size;
          pairing = t('agree.paired', { n });
        }
        const lines: HTMLElement[] = [];
        // one line per metric (and per key where the key names a quantity)
        const perKey = group === 'scar_attribute' || group === 'region' || group === 'measurement';
        const seen = new Map<string, { type: string; key: string; metric: string; values: number[] }>();
        for (const r of rows) {
          if (['matched', 'unmatched_a', 'unmatched_b', 'n_items'].includes(r.metric) || (r.itemType === 'region_type' && r.metric === 'area')) continue;
          const keyed = perKey && (r.itemType !== 'region' || REGION_KEYS.includes(r.itemKey) || r.itemKey === 'all');
          const id = `${r.itemType}\u0000${keyed ? r.itemKey : '*'}\u0000${r.metric}`;
          const g = seen.get(id) ?? seen.set(id, { type: r.itemType, key: keyed ? r.itemKey : '*', metric: r.metric, values: [] }).get(id)!;
          if (Number.isFinite(r.value)) g.values.push(r.value);
        }
        for (const g of seen.values()) {
          const name = [g.key === '*' && g.type !== 'region' ? '' : keyName(g.type, g.key), t(`agree.metric.${g.metric}`)].filter(Boolean).join(' · ');
          const v = mean(g.values);
          const clickable = AGREE_PAIRS.has(g.type) && g.values.length > 0;
          const rowKey = `${g.type}|${g.metric}|${a}|${b}`;
          const q = kindOf(g.metric, g.type, g.key);
          const tr = h(
            'tr',
            {
              'data-item': g.type,
              'data-metric': g.metric,
              class: `${clickable ? 'is-clickable' : ''}${focus === rowKey ? ' is-focused' : ''}`,
              title: g.values.length > 1 ? `n = ${g.values.length} · max ${fmtQuantity(q, Math.max(...g.values))}` : undefined,
              onclick: clickable ? () => api.focusAgreement(g.type, g.metric, a, b) : undefined,
            },
            h('td', {}, name),
            h('td', { class: 'num' }, fmtQuantity(q, v)),
            h('td', { class: 'agree-unit' }, quantityUnit(q, u)),
          );
          lines.push(tr);
        }
        sections.push(
          h(
            'tbody',
            { 'data-group': group },
            h('tr', { class: 'agree-group' }, h('th', { colspan: 3 }, `${t(`agree.group.${group}`)} · ${who}`)),
            pairing ? h('tr', { class: 'agree-pairing' }, h('td', { colspan: 3 }, pairing)) : null,
            ...lines,
          ),
        );
      }
    }
    if (sections.length) table.append(h('table', { class: 'agree-table' }, ...sections));
    // every group was empty for both observers
    else none.hidden = false;
  };
  refresh('all');
  // nothing to compare before a second observer
  return { el, refresh, visible: () => api.observerList().filter((o) => o.included).length >= 2 };
}

const ALL_MODES: AppMode[] = ['annotate', 'measure', 'present', 'compare'];

/** The sidebar sections, in order, and the work modes that show them. */
const SECTIONS: Array<[(api: AppApi) => Section, AppMode[]]> = [
  [workspaceSection, ALL_MODES],
  [orientationSection, ['present']],
  [sectionsSection, ['present']],
  [figureSection, ['present']],
  [axisSection, ['annotate']],
  [arrowsSection, ['annotate']],
  [relationsSection, ['annotate']],
  [curvesSection, ['annotate']],
  [(api) => regionsSection(api, (id, type) => api.setRegionType(id, type)), ['annotate']],
  [landmarksSection, ['annotate']],
  [flakeSection, ['measure']],
  [measureAutoSection, ['measure']],
  [measureManualSection, ['measure']],
  [planesSection, ['measure']],
  [noduleSection, ['measure']],
  [splitSection, ['measure']],
  [observersSection, ['compare']],
  [agreementSection, ['compare']],
];

export interface Sidebar {
  el: HTMLElement;
  refresh: (kind: RefreshKind) => void;
  /** The display settings, for the panel over the view. */
  displayEl: HTMLElement;
  /** The volumetric configuration, for its panel over the view, and its title bar's pill. */
  configEl: HTMLElement;
  configPill: HTMLElement;
  /** The selected curve's type: open the box for the user's own text. */
  openCustomType: () => void;
  /** A tool was chosen: open its section and fold the others but the folder's (choosing Select changes nothing). */
  focusTool: (tool: string) => void;
}

/** The section each tool works in: switching to the tool opens it and folds the others. */
const TOOL_SECTIONS: Record<string, string> = {
  draw: 'arrows',
  axis: 'axis',
  'platform-end': 'landmarks',
  curve: 'curves',
  region: 'regions',
  relation: 'relations',
  sequence: 'relations',
  landmark: 'landmarks',
  'measure-distance': 'measure-manual',
  'measure-geodesic': 'measure-manual',
  'measure-angle': 'measure-manual',
  section: 'sections',
};

/** Where the selected object is shown: its section and the part to bring into view. */
function selectionTarget(api: AppApi): [string, string] | null {
  const id = api.selection.id;
  const st = api.store;
  if (!id) return null;
  if (st.state.flake.axis?.id === id) return ['axis', '#axis-inspector'];
  if (st.scar(id)) return ['arrows', '#arrow-inspector'];
  if (st.curve(id)) return ['curves', '#curve-inspector'];
  if (st.region(id)) return ['regions', '#region-inspector'];
  if (st.relation(id)) return ['relations', '#relation-inspector'];
  if (st.sequence(id)) return ['relations', '#sequence-inspector'];
  if (st.landmark(id)) return ['landmarks', '#landmark-inspector'];
  if (st.semilandmarkSet(id)) return ['landmarks', '#semilandmark-inspector'];
  if (st.measurement(id)) return ['measure-manual', '#measure-list [aria-selected="true"]'];
  if (st.plane(id)) return ['planes', '#plane-inspector'];
  if (st.section(id)) return ['sections', '#section-inspector'];
  return null;
}

export function buildSidebar(api: AppApi): Sidebar {
  const el = h('aside', { class: 'sidebar', id: 'sidebar' });
  const sections = SECTIONS.map(([make, modes]) => ({ ...make(api), modes }));
  el.append(...sections.map((s) => s.el));
  const display = displaySection(api);
  const config = configurationPanel(api);
  const exportBtn = h('button', { type: 'button', class: 'btn btn-quiet btn-block', id: 'btn-export', onclick: () => api.openExport() }, icon(ICONS.download), t('export.button'));
  const foot = h('div', { class: 'sidebar-foot' }, exportBtn);
  el.append(foot);
  // before a model is open the sidebar is empty (the view offers the ways to open one)
  const showMode = () => {
    const has = api.hasMesh();
    // the folder's list stays while a folder is open, also when none of its models opened
    for (const s of sections) s.el.hidden = (!has && s.el.id !== 'sec-workspace') || !s.modes.includes(api.mode) || (!!s.visible && !s.visible());
    // data exports of the mode (figures and sections export from their own sections)
    foot.hidden = !has || api.mode === 'present';
  };
  const setOpen = (d: HTMLDetailsElement, open: boolean) => {
    if (d.open === open) return;
    d.dataset.auto = String(open);
    d.open = open;
  };
  const shown = () => sections.filter((s) => !s.el.hidden && s.el instanceof HTMLDetailsElement).map((s) => s.el as HTMLDetailsElement);
  /** Bring the selected object's section and its inspector into view. */
  const focusSelection = () => {
    const target = selectionTarget(api);
    // the relation tool's first scar is picked in the relations section
    if (!target || api.relationPending()) return;
    const sec = shown().find((d) => d.id === `sec-${target[0]}`);
    if (!sec) return;
    setOpen(sec, true);
    requestAnimationFrame(() => {
      const part = sec.querySelector<HTMLElement>(target[1]);
      if (!part) return;
      const list = part.parentElement;
      if (list?.classList.contains('arrow-list')) revealInList(list, part);
      // only a sidebar that scrolls on its own (in the narrow layout that would scroll the 3D view away)
      if (el.scrollHeight <= el.clientHeight || !/auto|scroll/.test(getComputedStyle(el).overflowY)) return;
      el.scrollTop += part.getBoundingClientRect().top - el.getBoundingClientRect().top - 8;
    });
  };
  showMode();
  return {
    el,
    refresh: (kind) => {
      showMode();
      if (kind === 'mode') {
        for (const s of sections) s.refresh('figure');
        display.refresh('mode');
        return;
      }
      for (const s of sections) s.refresh(kind);
      display.refresh(kind);
      config.refresh(kind);
      showMode();
      if (kind === 'selection') focusSelection();
    },
    displayEl: display.el,
    configEl: config.el,
    configPill: config.pill,
    openCustomType: () => (el.querySelector('#curve-field-type-custom') as HTMLButtonElement | null)?.click(),
    focusTool: (tool) => {
      const target = TOOL_SECTIONS[tool];
      if (!target) return;
      for (const d of shown()) if (d.id !== 'sec-workspace') setOpen(d, d.id === `sec-${target}`);
    },
  };
}

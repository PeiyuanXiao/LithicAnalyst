import { h, icon20, ICONS20 } from './dom';

export interface SliderOpts {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  onInput: (v: number) => void;
}

export function slider(o: SliderOpts): { el: HTMLElement; set: (v: number) => void } {
  const out = h('output', { class: 'ctl-value', for: o.id }, o.format(o.value));
  const input = h('input', {
    type: 'range',
    id: o.id,
    min: o.min,
    max: o.max,
    step: o.step,
    value: o.value,
    class: 'ctl-range',
  });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = o.format(v);
    o.onInput(v);
  });
  const el = h('div', { class: 'ctl ctl-slider' }, h('label', { for: o.id, class: 'ctl-label' }, o.label), out, input);
  return {
    el,
    set: (v: number) => {
      input.value = String(v);
      out.textContent = o.format(v);
    },
  };
}

export interface SegOption {
  value: string;
  label: string;
  disabled?: boolean;
  title?: string;
}

/** A row of mutually exclusive buttons (radio group semantics). */
export function segmented(
  id: string,
  label: string | null,
  options: SegOption[],
  value: string,
  onChange: (v: string) => void,
): { el: HTMLElement; set: (v: string) => void } {
  const buttons = options.map((opt) =>
    h(
      'button',
      {
        type: 'button',
        class: 'seg-btn',
        role: 'radio',
        'aria-checked': String(opt.value === value),
        disabled: opt.disabled,
        title: opt.title,
        'data-value': opt.value,
        id: `${id}-${opt.value}`,
        onclick: () => {
          set(opt.value);
          onChange(opt.value);
        },
      },
      opt.label,
    ),
  );
  const group = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label ?? id }, ...buttons);
  const set = (v: string) => {
    for (const b of buttons) b.setAttribute('aria-checked', String(b.dataset.value === v));
  };
  const el = label ? h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, label), group) : group;
  return { el, set };
}

/** A vertical list of mutually exclusive options, each with an optional key badge. */
export function optionList(
  id: string,
  label: string,
  options: Array<SegOption & { key?: string }>,
  value: string,
  onChange: (v: string) => void,
): { el: HTMLElement; set: (v: string) => void } {
  const buttons = options.map((opt) =>
    h(
      'button',
      {
        type: 'button',
        class: 'opt-btn',
        role: 'radio',
        'aria-checked': String(opt.value === value),
        'data-value': opt.value,
        id: `${id}-${opt.value}`,
        onclick: () => {
          set(opt.value);
          onChange(opt.value);
        },
      },
      opt.key ? h('kbd', {}, opt.key) : null,
      h('span', {}, opt.label),
    ),
  );
  const group = h('div', { class: 'opt-list', role: 'radiogroup', 'aria-label': label }, ...buttons);
  const set = (v: string) => {
    for (const b of buttons) b.setAttribute('aria-checked', String(b.dataset.value === v));
  };
  return { el: h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, label), group), set };
}

export function selectRow(
  id: string,
  label: string,
  options: SegOption[],
  value: string,
  onChange: (v: string) => void,
): { el: HTMLElement; set: (v: string) => void } {
  const sel = h(
    'select',
    { id, class: 'ctl-select' },
    ...options.map((o) => h('option', { value: o.value, selected: o.value === value, disabled: o.disabled }, o.label)),
  );
  sel.addEventListener('change', () => onChange(sel.value));
  const el = h('div', { class: 'ctl' }, h('label', { for: id, class: 'ctl-label' }, label), sel);
  return { el, set: (v) => (sel.value = v) };
}

export function checkbox(id: string, label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', id, checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'ctl-check', for: id }, input, h('span', {}, label));
}

export function textRow(
  id: string,
  label: string,
  value: string,
  onInput: (v: string) => void,
  opts: { placeholder?: string; multiline?: boolean; mono?: boolean } = {},
): { el: HTMLElement; input: HTMLInputElement | HTMLTextAreaElement } {
  const input = opts.multiline
    ? h('textarea', { id, rows: 2, placeholder: opts.placeholder, class: 'ctl-text' })
    : h('input', { id, type: 'text', placeholder: opts.placeholder, class: `ctl-text${opts.mono ? ' mono' : ''}`, autocomplete: 'off', spellcheck: 'false' });
  input.value = value;
  input.addEventListener('input', () => onInput(input.value));
  const el = h('div', { class: 'ctl' }, h('label', { for: id, class: 'ctl-label' }, label), input);
  return { el, input };
}

/** Set an input's value unless the user is typing in it. */
export function softSet(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  if (document.activeElement !== input && input.value !== value) input.value = value;
}

/** "Add …" at the end of a list: a dashed, full-width button with a plus. */
export function addButton(label: string, onClick: () => void, id?: string): HTMLButtonElement {
  return h('button', { type: 'button', class: 'add-btn', id, onclick: onClick }, icon20(ICONS20.plus), h('span', {}, label)) as HTMLButtonElement;
}

/**
 * A row of a `.num-grid` list: the label, the number (right-aligned, tabular) and its unit
 * in a column of its own, so the numbers line up. `id` goes on the number; `id-unit` on the unit.
 */
export function numRow(label: string, value: string, unit: string, id?: string): HTMLElement[] {
  return [h('dt', {}, label), h('dd', { class: 'num', id }, value), h('dd', { class: 'unit', id: id ? `${id}-unit` : undefined }, unit)];
}

/** A row of a `.num-grid` list whose value is not a number (it takes the number and unit columns). */
export function textValueRow(label: string, value: string, id?: string): [HTMLElement, HTMLElement] {
  return [h('dt', {}, label), h('dd', { class: 'text', id }, value)];
}

/** Coordinates in a `.coord-grid`: the label, x, y and z right-aligned in their columns, the unit. */
export function coordRow(label: string, values: string[], unit: string): HTMLElement[] {
  return [h('dt', {}, label), ...values.map((v) => h('dd', { class: 'num' }, v)), h('dd', { class: 'unit' }, unit)];
}

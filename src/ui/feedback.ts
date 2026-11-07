import { clear, h, icon, ICONS } from './dom';
import { t } from './i18n';
import { growFrom, reducedMotion } from './motion';

export interface ChoiceButton {
  id: string;
  label: string;
  kind?: 'primary' | 'quiet' | 'danger' | 'plain';
}

/** How long loading must take before the logo turns: a quick one shows none of it. */
export const BUSY_LOGO_AFTER_MS = 300;
/** How long a toast takes to fade out, and a dialog to go. */
const TOAST_OUT_MS = 150;
const MODAL_OUT_MS = 120;
/** A toast stands 8px over the coordinate reading (or, without it, this far above the bottom of the view), as far in from the right as the reading. */
const TOAST_GAP_PX = 8;
const TOAST_ABOVE_PX = 44;
const TOAST_RIGHT_PX = 12;

/** Toasts, modal dialogs and the busy overlay. No native alert/confirm (they are blocked in some hosts). */
export class Feedback {
  private toastHost: HTMLElement;
  private busyEl: HTMLElement;
  private busyText: HTMLElement;
  private busyTimer = 0;
  /** What toasts stand in the lower right corner of (the view); null or out of sight: the window's. */
  anchor: (() => HTMLElement | null) | null = null;

  /** `logo`: the drawing that turns while loading takes a while. */
  constructor(private readonly root: HTMLElement, logo?: Element) {
    this.toastHost = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    this.busyText = h('span', { class: 'busy-text' });
    logo?.setAttribute('aria-hidden', 'true');
    this.busyEl = h('div', { class: 'busy', hidden: true }, logo ?? null, this.busyText);
    root.append(this.toastHost, this.busyEl);
  }

  /** The toasts' corner: the view's lower right, 8px over the coordinate reading; the window's when the view is not in front. */
  private placeToasts(): void {
    const el = this.anchor?.() ?? null;
    const host = this.toastHost.style;
    const r = el && el.isConnected && el.offsetParent !== null ? el.getBoundingClientRect() : null;
    if (!r || r.width === 0 || r.height === 0) {
      host.right = host.bottom = '';
      return;
    }
    const w = document.documentElement.clientWidth, hgt = window.innerHeight;
    host.right = `${Math.max(0, w - Math.min(r.right, w)) + TOAST_RIGHT_PX}px`;
    // over the reading when it shows; else where it would be. A view scrolled partly out of sight (the narrow layout): the part that shows
    const reading = el!.querySelector<HTMLElement>('.status-coords')?.getBoundingClientRect();
    const top = reading && reading.height > 0 ? reading.top - TOAST_GAP_PX : r.bottom - TOAST_ABOVE_PX;
    host.bottom = `${Math.max(TOAST_GAP_PX, hgt - Math.min(Math.max(top, r.top + 40), hgt - TOAST_GAP_PX))}px`;
  }

  toast(message: string, tone: 'info' | 'warn' | 'error' = 'info', ms = 2800): void {
    this.placeToasts();
    const el = h('div', { class: `toast toast-${tone}` }, message);
    this.toastHost.append(el);
    // (the next frame, so it slides in from below)
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-in')));
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), TOAST_OUT_MS + 30);
    }, tone === 'error' ? Math.max(ms, 6000) : ms);
  }

  /** Overlay over the viewport while a long step runs; null hides it. The logo turns once it has taken a moment. */
  busy(text: string | null, host?: HTMLElement): void {
    if (host && this.busyEl.parentElement !== host) host.append(this.busyEl);
    const was = !this.busyEl.hidden;
    this.busyEl.hidden = text === null;
    if (text !== null) this.busyText.textContent = text;
    if (text === null) {
      clearTimeout(this.busyTimer);
      this.busyTimer = 0;
      this.busyEl.classList.remove('is-long');
    } else if (!was) {
      clearTimeout(this.busyTimer);
      this.busyTimer = window.setTimeout(() => this.busyEl.classList.add('is-long'), BUSY_LOGO_AFTER_MS);
    }
  }

  /** Modal dialog; resolves with the chosen button id, or null when dismissed. `wide`: room for two columns. */
  choose(title: string, body: Node | string, buttons: ChoiceButton[], opts: { wide?: boolean } = {}): Promise<string | null> {
    return new Promise((resolve) => {
      const prevFocus = document.activeElement as HTMLElement | null;
      const close = (value: string | null) => {
        document.removeEventListener('keydown', onKey, true);
        // the answer is in at once; the dialog only fades out, taking no more presses
        if (reducedMotion()) backdrop.remove();
        else {
          backdrop.classList.add('is-closing');
          setTimeout(() => backdrop.remove(), MODAL_OUT_MS);
        }
        prevFocus?.focus?.();
        resolve(value);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close(null);
        }
      };
      const titleId = `dlg-${Math.random().toString(36).slice(2)}`;
      const btnEls = buttons.map((b) =>
        h('button', { type: 'button', class: b.kind === 'plain' ? 'btn' : `btn btn-${b.kind ?? 'quiet'}`, 'data-choice': b.id, onclick: () => close(b.id) }, b.label),
      );
      const dialog = h(
        'div',
        { class: `modal${opts.wide ? ' modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
        h(
          'div',
          { class: 'modal-head' },
          h('h2', { id: titleId, class: 'modal-title' }, title),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('dlg.close'), onclick: () => close(null) }, icon(ICONS.close)),
        ),
        h('div', { class: 'modal-body' }, body),
        h('div', { class: 'modal-actions' }, ...btnEls),
      );
      const backdrop = h('div', { class: 'modal-backdrop', onclick: (e: Event) => e.target === backdrop && close(null) }, dialog);
      this.root.append(backdrop);
      // it grows from the button that opened it
      growFrom(dialog, prevFocus);
      document.addEventListener('keydown', onKey, true);
      (btnEls.find((_, i) => buttons[i].kind === 'primary') ?? btnEls[0])?.focus();
    });
  }

  async confirm(title: string, body: string, yes: string, no = t('dlg.cancel')): Promise<boolean> {
    return (await this.choose(title, body, [
      { id: 'no', label: no },
      { id: 'yes', label: yes, kind: 'primary' },
    ])) === 'yes';
  }

  /** When a download is impossible, show the text with a copy button. */
  showCopy(fileName: string, text: string): void {
    const area = h('textarea', { class: 'copy-area', readonly: true, rows: 10, spellcheck: 'false', id: 'copy-export-text' });
    area.value = text;
    const status = h('span', { class: 'copy-status' });
    const copyBtn = h('button', {
      type: 'button',
      class: 'btn btn-primary',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(text);
          status.textContent = t('dlg.copy.done');
        } catch {
          area.focus();
          area.select();
        }
      },
    }, t('dlg.copy.button'));
    const body = h('div', { class: 'copy-body' }, h('p', {}, t('dlg.copy.body', { name: fileName })), area, h('div', { class: 'copy-row' }, copyBtn, status));
    void this.choose(t('dlg.copy.title'), body, [{ id: 'close', label: t('dlg.close') }]);
    setTimeout(() => area.select(), 50);
  }

  static fill(el: HTMLElement, ...nodes: Array<Node | string>): void {
    clear(el);
    el.append(...nodes);
  }
}

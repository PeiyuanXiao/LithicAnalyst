import { clear, h, icon, ICONS } from './dom';
import { t } from './i18n';

export interface ChoiceButton {
  id: string;
  label: string;
  kind?: 'primary' | 'quiet' | 'danger';
}

/** Toasts, modal dialogs and the busy overlay. No native alert/confirm (they are blocked in some hosts). */
export class Feedback {
  private toastHost: HTMLElement;
  private busyEl: HTMLElement;
  private busyText: HTMLElement;

  constructor(private readonly root: HTMLElement) {
    this.toastHost = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    this.busyText = h('span', { class: 'busy-text' });
    this.busyEl = h('div', { class: 'busy', hidden: true }, h('span', { class: 'busy-spinner', 'aria-hidden': 'true' }), this.busyText);
    root.append(this.toastHost, this.busyEl);
  }

  toast(message: string, tone: 'info' | 'warn' | 'error' = 'info', ms = 2800): void {
    const el = h('div', { class: `toast toast-${tone}` }, message);
    this.toastHost.append(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    setTimeout(() => {
      el.classList.remove('is-in');
      setTimeout(() => el.remove(), 250);
    }, tone === 'error' ? Math.max(ms, 6000) : ms);
  }

  /** Overlay over the viewport while a long step runs; null hides it. */
  busy(text: string | null, host?: HTMLElement): void {
    if (host && this.busyEl.parentElement !== host) host.append(this.busyEl);
    this.busyEl.hidden = text === null;
    if (text !== null) this.busyText.textContent = text;
  }

  /** Modal dialog; resolves with the chosen button id, or null when dismissed. */
  choose(title: string, body: Node | string, buttons: ChoiceButton[]): Promise<string | null> {
    return new Promise((resolve) => {
      const prevFocus = document.activeElement as HTMLElement | null;
      const close = (value: string | null) => {
        backdrop.remove();
        document.removeEventListener('keydown', onKey, true);
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
        h('button', { type: 'button', class: `btn btn-${b.kind ?? 'quiet'}`, onclick: () => close(b.id) }, b.label),
      );
      const dialog = h(
        'div',
        { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
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

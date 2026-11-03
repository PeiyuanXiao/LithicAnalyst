import { h } from './dom';

/** What a tooltip says: a name, and the key that does the same (shown as a key cap); or further lines under the name. */
export interface TipContent {
  label: string;
  key?: string;
  lines?: readonly string[];
}

const DELAY_MS = 300;

/**
 * Tooltips: one at a time, below (or above) an element after a short hover, at once on
 * keyboard focus, or next to the cursor (`showAt`). They replace `title` attributes, so
 * an element never shows two.
 */
class Tips {
  private el: HTMLElement | null = null;
  private owner: HTMLElement | null = null;
  /** The one shown is next to the cursor (`showAt`), not below an element. */
  private atCursor = false;
  private timer = 0;

  constructor() {
    if (typeof document === 'undefined') return;
    document.addEventListener('pointerdown', () => this.hide(), true);
    document.addEventListener('keydown', (e) => e.key === 'Escape' && this.hide(), true);
    document.addEventListener('scroll', () => this.hide(), true);
    // the element it belongs to was left or taken out of the page
    document.addEventListener('pointerover', (e) => {
      const o = this.owner;
      if (o && (!o.isConnected || !o.contains(e.target as Node))) this.hide();
    });
  }

  /** Give `target` a tooltip; `content` is read each time it shows (null: none now). */
  attach(target: HTMLElement, content: () => TipContent | null, place: 'below' | 'above' = 'below'): void {
    target.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'touch') return;
      this.cancel();
      this.timer = window.setTimeout(() => this.showFor(target, content(), place), DELAY_MS);
    });
    target.addEventListener('pointerleave', () => this.hide());
    target.addEventListener('focusin', () => {
      if (target.matches(':focus-visible') || target.querySelector(':focus-visible')) this.showFor(target, content(), place);
    });
    target.addEventListener('focusout', () => this.hide());
  }

  /** A tooltip next to a client position (e.g. the cursor). */
  showAt(x: number, y: number, content: TipContent): void {
    this.cancel();
    const el = this.render(content);
    const w = el.offsetWidth, ht = el.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, x + 14));
    const top = y + 20 + ht > window.innerHeight - 8 ? y - 12 - ht : y + 20;
    this.place(el, left, Math.max(8, top));
    this.atCursor = true;
  }

  /** Hide a tooltip shown next to the cursor; one belonging to an element (or about to show) stays. */
  hideAt(): void {
    if (!this.atCursor) return;
    this.atCursor = false;
    this.el?.remove();
    this.el = null;
  }

  hide(): void {
    this.cancel();
    this.owner = null;
    this.atCursor = false;
    this.el?.remove();
    this.el = null;
  }

  private cancel(): void {
    clearTimeout(this.timer);
    this.timer = 0;
  }

  private showFor(target: HTMLElement, content: TipContent | null, place: 'below' | 'above'): void {
    this.cancel();
    if (!content || !target.isConnected) return;
    const el = this.render(content);
    this.owner = target;
    const r = target.getBoundingClientRect();
    const w = el.offsetWidth, ht = el.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const below = r.bottom + 6, above = r.top - 6 - ht;
    const top = place === 'below' ? (below + ht > window.innerHeight - 8 ? above : below) : above < 8 ? below : above;
    this.place(el, left, top);
  }

  private render(content: TipContent): HTMLElement {
    this.el?.remove();
    this.atCursor = false;
    const el = h('div', { class: content.lines ? 'tip tip-lines' : 'tip', role: 'tooltip' }, h('span', {}, content.label), ...(content.lines ?? []).map((l) => h('span', {}, l)), content.key ? h('kbd', {}, content.key) : null);
    el.style.visibility = 'hidden';
    document.body.append(el);
    this.el = el;
    return el;
  }

  private place(el: HTMLElement, left: number, top: number): void {
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.visibility = '';
  }
}

export const tips = new Tips();

/** Shorthand: a fixed tooltip for `target`. */
export function tip(target: HTMLElement, label: string | (() => string), key?: string, place: 'below' | 'above' = 'below'): void {
  tips.attach(target, () => ({ label: typeof label === 'function' ? label() : label, key }), place);
}

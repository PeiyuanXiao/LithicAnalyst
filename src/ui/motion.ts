/**
 * Small pieces of the interface's motion that need a script. The animations themselves are in the style sheet
 * (and stop there with reduced motion); here is only where a panel grows from, and when motion is wanted at all.
 */

export const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A press, focus or element that can stand for what opened a panel: shown, and not inside the panel. */
function openerOf(el: HTMLElement, opener: Element | null): HTMLElement | null {
  if (!(opener instanceof HTMLElement) || opener === document.body || opener === document.documentElement) return null;
  if (!opener.isConnected || el.contains(opener) || opener.getClientRects().length === 0) return null;
  return opener;
}

/**
 * The panel `el` grows from the side of `opener` (the button that opened it): its transform-origin is the button's
 * middle, brought onto the panel's edge. With nothing to go by, from the middle of its top.
 */
export function growFrom(el: HTMLElement, opener: Element | null): void {
  const from = openerOf(el, opener);
  const r = from ? el.getBoundingClientRect() : null;
  if (!from || !r || !r.width || !r.height) {
    el.style.transformOrigin = '50% 0';
    return;
  }
  const b = from.getBoundingClientRect();
  const x = Math.max(0, Math.min(r.width, b.left + b.width / 2 - r.left));
  const y = Math.max(0, Math.min(r.height, b.top + b.height / 2 - r.top));
  el.style.transformOrigin = `${Math.round(x)}px ${Math.round(y)}px`;
}

/** Each time `el` is shown (its `hidden` taken off), it grows from what has the focus then: the button that was pressed. */
export function growWhenShown(el: HTMLElement): void {
  new MutationObserver(() => {
    if (!el.hidden) growFrom(el, document.activeElement);
  }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
}

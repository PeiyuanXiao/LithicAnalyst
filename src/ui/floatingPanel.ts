import { readPref, writePref } from '../io/autosave';
import { h, icon, ICONS } from './dom';
import { t } from './i18n';

/** Where a floating panel is, how big, and whether it is folded (a UI preference, never in the project file). */
interface PanelGeometry {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  collapsed?: boolean;
}

export interface FloatingPanelOptions {
  /** Ids `${id}-panel`, `${id}-body`, `${id}-fold`, `${id}-close`; classes `${id}-panel`, `${id}-body`. */
  id: string;
  title: string;
  /** The preference that remembers its place, size and fold. */
  pref: string;
  /** The view it floats over and is kept inside. */
  area: HTMLElement;
  /** In the title bar, after the title. */
  extras?: Node[];
  /** Sized from its lower right corner. */
  resizable?: boolean;
  onClose: () => void;
  onFold?: (collapsed: boolean) => void;
}

export interface FloatingPanel {
  el: HTMLElement;
  body: HTMLElement;
  /** Put the remembered place into the view as it is now (the preference keeps what was chosen). */
  fit: () => void;
  collapsed: () => boolean;
}

/**
 * A panel over the 3D view: moved by its title bar, folded to its title bar,
 * optionally sized from its corner; always inside the view (also when the view
 * changes size). Its place, size and fold are remembered.
 */
export function floatingPanel(o: FloatingPanelOptions): FloatingPanel {
  const geo: PanelGeometry = { ...readPref<PanelGeometry>(o.pref, {}) };
  const body = h('div', { class: `float-body ${o.id}-body`, id: `${o.id}-body` });
  const fold = h('button', { type: 'button', class: 'icon-btn float-fold', id: `${o.id}-fold`, 'aria-label': t('panel.fold'), title: t('panel.fold') }, icon(ICONS.chevron)) as HTMLButtonElement;
  const head = h(
    'div',
    { class: 'float-head' },
    h('span', { class: 'float-title' }, o.title),
    ...(o.extras ?? []),
    fold,
    h('button', { type: 'button', class: 'icon-btn', id: `${o.id}-close`, 'aria-label': t('dlg.close'), onclick: () => o.onClose() }, icon(ICONS.close)),
  );
  const grip = o.resizable ? h('div', { class: 'float-grip', 'aria-hidden': 'true' }) : null;
  const el = h('div', { class: `viewport-ui float-panel ${o.id}-panel`, id: `${o.id}-panel`, hidden: true }, head, body, grip);
  const area = o.area;
  const apply = () => {
    const W = area.clientWidth, H = area.clientHeight;
    const fits = W > 0 && H > 0;
    const w = geo.w && fits ? Math.min(geo.w, W) : geo.w;
    const hgt = geo.h && fits ? Math.min(geo.h, H) : geo.h;
    if (w && hgt) {
      el.style.width = `${w}px`;
      el.style.height = geo.collapsed ? '' : `${hgt}px`;
      el.style.maxWidth = el.style.maxHeight = 'none';
    }
    el.classList.toggle('is-collapsed', !!geo.collapsed);
    fold.setAttribute('aria-expanded', String(!geo.collapsed));
    // a panel not sized by hand is as tall as its content; moved by hand, it goes up as far as that needs
    // (the remembered place stays) and scrolls only when the view is too low for it
    if (!o.resizable) el.style.maxHeight = geo.y !== undefined ? 'none' : '';
    if (geo.x !== undefined && geo.y !== undefined) {
      const pw = w || el.offsetWidth || 200, ph = Math.min((hgt && !geo.collapsed ? hgt : el.offsetHeight) || 36, H);
      const x = fits ? Math.max(0, Math.min(geo.x, W - pw)) : geo.x;
      const y = fits ? Math.max(0, Math.min(geo.y, H - ph - (o.resizable ? 0 : 8))) : geo.y;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.right = el.style.bottom = 'auto';
    }
    // (still in its default place, the stylesheet keeps it clear of what is above)
    if (!o.resizable && fits && !el.hidden && geo.y !== undefined) el.style.maxHeight = `${Math.max(80, H - el.offsetTop - 8)}px`;
  };
  const save = () => writePref(o.pref, geo);
  fold.addEventListener('click', () => {
    geo.collapsed = !geo.collapsed;
    apply();
    save();
    o.onFold?.(!!geo.collapsed);
  });
  // drag with the title bar, size with the corner; kept inside the view
  const drag = (handle: HTMLElement, move: (dx: number, dy: number, start: DOMRect, view: DOMRect) => void) => {
    let from: { x: number; y: number; rect: DOMRect; view: DOMRect } | null = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as Element).closest('button, select, input')) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      from = { x: e.clientX, y: e.clientY, rect: el.getBoundingClientRect(), view: area.getBoundingClientRect() };
    });
    handle.addEventListener('pointermove', (e) => {
      if (from) move(e.clientX - from.x, e.clientY - from.y, from.rect, from.view);
    });
    const end = () => {
      if (!from) return;
      from = null;
      save();
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };
  drag(head, (dx, dy, r, view) => {
    geo.x = Math.round(Math.max(0, Math.min(view.width - r.width, r.left - view.left + dx)));
    geo.y = Math.round(Math.max(0, Math.min(view.height - r.height, r.top - view.top + dy)));
    apply();
  });
  if (grip)
    drag(grip, (dx, dy, r, view) => {
      geo.x ??= Math.round(r.left - view.left);
      geo.y ??= Math.round(r.top - view.top);
      geo.w = Math.round(Math.max(200, Math.min(view.width - geo.x, r.width + dx)));
      geo.h = Math.round(Math.max(120, Math.min(view.height - geo.y, r.height + dy)));
      geo.collapsed = false;
      apply();
    });
  // a panel built again (another language) replaces this one
  const watch = new ResizeObserver(() => (el.isConnected ? !el.hidden && apply() : watch.disconnect()));
  watch.observe(area);
  apply();
  return { el, body, fit: apply, collapsed: () => !!geo.collapsed };
}

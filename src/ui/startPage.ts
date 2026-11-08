import { SPECIMEN_TYPES, type SpecimenType } from '../core/fields';
import { BRAND, brandEl, brandInner, brandPrefix, svgFrom } from './brand';
import { h } from './dom';
import { getLang, LANGS, setLang, t, textIn, type Lang } from './i18n';
import { getTheme, toggleThemeFrom } from './theme';

/** The rings behind the logo (also, still and fainter, behind the empty view). */
export const RINGS =`<svg viewBox="0 0 1500 1500"><g fill="none">
<circle cx="750" cy="750" r="190" stroke="var(--ring-2)" stroke-width="1"></circle>
<circle class="st-spin" cx="750" cy="750" r="236" stroke="var(--ring-2)" stroke-width="6" stroke-dasharray="1.5 14"></circle>
<circle cx="750" cy="750" r="300" stroke="var(--ring)" stroke-width="1"></circle>
<circle class="st-spin-r" cx="750" cy="750" r="390" stroke="var(--ring)" stroke-width="1" stroke-dasharray="90 18 8 18"></circle>
<circle cx="750" cy="750" r="490" stroke="var(--ring)" stroke-width="1"></circle>
<circle cx="750" cy="750" r="600" stroke="var(--ring)" stroke-width="1"></circle>
</g></svg>`;

const SUN = `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 18 18"><circle cx="9" cy="9" r="3.4" fill="none" stroke="currentColor" stroke-width="1.5"></circle><path d="M9 1.5 V3.5 M9 14.5 V16.5 M1.5 9 H3.5 M14.5 9 H16.5 M3.7 3.7 L5.1 5.1 M12.9 12.9 L14.3 14.3 M3.7 14.3 L5.1 12.9 M12.9 5.1 L14.3 3.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></svg>`;
const MOON = `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 18 18"><path d="M14.5 11.5 A6 6 0 1 1 6.5 3.5 A4.6 4.6 0 0 0 14.5 11.5 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path></svg>`;
const DOTS = `<svg class="start-dots" aria-hidden="true" width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="3" r="2.2" fill="var(--dot)"></circle><circle cx="3" cy="10" r="2.2" fill="var(--dot)"></circle><circle cx="11" cy="10" r="2.2" fill="var(--dot)"></circle></svg>`;
const ENTER = `<svg class="start-enter" aria-hidden="true" width="26" height="26" viewBox="0 0 22 22"><path d="M3 11 H17 M12 6 L17 11 L12 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;

/** The disc a card's icon sits in. */
function disc(type: SpecimenType): SVGSVGElement {
  const id = brandPrefix();
  return svgFrom(`<svg class="start-disc" aria-hidden="true" viewBox="0 0 260 260"><defs><radialGradient id="${id}-disc" cx="38%" cy="32%" r="75%"><stop offset="0" style="stop-color: var(--disc-c)"></stop><stop offset="1" style="stop-color: var(--disc-e)"></stop></radialGradient></defs><g class="start-rings-small" fill="none"><circle cx="130" cy="130" r="124" stroke="var(--disc-ring)" stroke-width="1"></circle><circle cx="130" cy="130" r="105" stroke="var(--disc-ring)" stroke-width="5" stroke-dasharray="1.5 9"></circle><circle cx="130" cy="130" r="92" stroke="var(--disc-ring)" stroke-width="1"></circle></g><circle cx="130" cy="130" r="80" fill="url(#${id}-disc)"></circle><circle class="start-hdisc" cx="130" cy="130" r="80" fill="var(--hover-disc)"></circle><g transform="translate(66 66) scale(1.07)"><g class="start-pict">${brandInner(BRAND.icons[type], id)}</g></g></svg>`);
}

/** The four colours in a row, each with its entrance delay. */
function stripe(className: string, delays: number[]): HTMLElement {
  return h('span', { class: className, 'aria-hidden': 'true' }, ...delays.map((d) => h('span', { class: 'st-grow', style: `animation-delay: ${d.toFixed(2)}s` })));
}

export interface StartPage {
  el: HTMLElement;
  /** It comes into view, with the card of `type` in focus (shown only once the keyboard is used). */
  show(type: SpecimenType): void;
  /** It goes; its entrance plays once a session. */
  leave(): void;
  /** The language or the theme changed. */
  paint(): void;
}

/** What the app opens on: a choice of module, and nothing to load until one is chosen. `onEnter`: the card pressed. */
export function buildStartPage(onEnter: (type: SpecimenType) => void): StartPage {
  const nextLang = (): (typeof LANGS)[number] => LANGS[(LANGS.findIndex((l) => l.code === getLang()) + 1) % LANGS.length];
  const langBtn = h('button', { type: 'button', class: 'start-ctl', id: 'start-lang', onclick: () => setLang(nextLang().code as Lang) });
  const themeBtn = h('button', { type: 'button', class: 'start-ctl', id: 'start-theme', onclick: () => toggleThemeFrom(themeBtn) });

  const cards = SPECIMEN_TYPES.map((type, i) => {
    const name = h('span', { class: 'start-card-name' });
    const button = h(
      'button',
      { type: 'button', class: 'start-card', id: `start-type-${type}`, 'data-value': type, onclick: () => onEnter(type) },
      h('span', { class: 'start-fill', 'aria-hidden': 'true' }),
      h('span', { class: 'start-ghost', 'aria-hidden': 'true' }, brandEl(BRAND.ghosts[type])),
      disc(type),
      h('span', { class: 'start-card-body' }, h('span', { class: 'start-card-head' }, name, svgFrom(DOTS)), svgFrom(ENTER)),
      stripe(
        'start-stripe',
        [0, 0.05, 0.1, 0.15].map((d) => 1.45 + 0.12 * i + d),
      ),
    );
    return { type, name, button, wrap: h('div', { class: 'start-card-wrap st-in', style: `animation-delay: ${(1.05 + 0.12 * i).toFixed(2)}s` }, button) };
  });

  const wordmark = brandEl(BRAND.wordmark, 'st-wipe');
  wordmark.style.animationDelay = '.45s';
  const el = h(
    'div',
    { class: 'start-page is-entering', id: 'start-page' },
    h(
      'div',
      { class: 'start-root' },
      h('div', { class: 'start-grid', 'aria-hidden': 'true' }),
      h('div', { class: 'start-rings st-bgin', 'aria-hidden': 'true' }, svgFrom(RINGS)),
      h('div', { class: 'start-ctls st-fade', style: 'animation-delay: 1.4s' }, langBtn, themeBtn),
      h(
        'div',
        { class: 'start-hero' },
        brandEl(BRAND.logo, 'start-logo'),
        h(
          'div',
          { class: 'start-title' },
          h('div', { class: 'start-wm' }, wordmark),
          h('div', { class: 'start-meta' }, stripe('start-bar', [1, 1.1, 1.2, 1.3]), h('span', { class: 'start-version st-fade', id: 'start-version', style: 'animation-delay: 1.35s' }, `v${__APP_VERSION__}`)),
        ),
      ),
      h('div', { class: 'start-cards' }, ...cards.map((c) => c.wrap)),
    ),
  );
  // what shows the focus waits for the keyboard: the card in focus from the start is not marked
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') el.classList.remove('quiet-focus');
  });

  const paint = (): void => {
    const next = nextLang();
    langBtn.textContent = next.short;
    // in the language it goes to (its name, until that is translated)
    langBtn.setAttribute('aria-label', textIn(next.code, 'start.switchLang') ?? next.label);
    for (const c of cards) {
      const name = t(`specimen.type.${c.type}`);
      c.name.textContent = name;
      c.button.setAttribute('aria-label', name);
    }
    const dark = getTheme() === 'dark';
    themeBtn.replaceChildren(svgFrom(dark ? SUN : MOON));
    themeBtn.setAttribute('aria-label', t(dark ? 'theme.light' : 'theme.dark'));
  };
  paint();

  return {
    el,
    paint,
    show(type) {
      el.classList.add('quiet-focus');
      cards.find((c) => c.type === type)?.button.focus({ preventScroll: true });
    },
    leave() {
      el.classList.remove('is-entering');
    },
  };
}

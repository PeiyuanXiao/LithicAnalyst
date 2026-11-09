/**
 * Who made LithicAnalyst, where to ask, how to cite it and under what licence: the first page of the
 * "?" dialog, the start page's credit line and the exports' manifest. The facts come from package.json
 * and LICENSE through vite.config.ts (`__APP_ABOUT__`), so they are kept in one place.
 */
import { apaCitation, apaCitationParts, type CitationSource } from '../core/citation';
import { BRAND, brandEl } from './brand';
import { h } from './dom';
import { t } from './i18n';

export const ABOUT = __APP_ABOUT__;
/** Where requests and problems go. */
export const ISSUES_URL = `${ABOUT.repository}/issues`;
export const LICENSE_URL = `${ABOUT.repository}/blob/main/LICENSE`;
/** The libraries inside the file and their licences, which ask for their notices to be kept. */
export const THIRD_PARTY = 'three.js, three-mesh-bvh (MIT) · IBM Plex (SIL OFL 1.1)';

export const citationSource = (): CitationSource => ({ authors: ABOUT.citationAuthors, year: ABOUT.year, version: __APP_VERSION__, url: ABOUT.repository, doi: ABOUT.doi });

/** This version's reference, APA style, as plain text. */
export const citation = (): string => apaCitation(citationSource());

/** The start page's line under the version: "© 2026 Peiyuan Xiao · MIT License". */
export const creditLine = (): string => `© ${ABOUT.copyright} · ${ABOUT.license} License`;

/** What the exports' manifest says of the program (its `app`). */
export const appInfo = () => ({
  name: 'LithicAnalyst',
  version: __APP_VERSION__,
  author: ABOUT.author,
  license: ABOUT.license,
  repository: ABOUT.repository,
  citation: citation(),
});

/** The about page: labels, links and the reference with a copy button; nothing to read through. */
export function aboutPanel(): HTMLElement {
  const link = (href: string, text: string, id: string) => h('a', { href, id, target: '_blank', rel: 'noopener' }, text);
  const parts = apaCitationParts(citationSource());
  const cite = h('p', { class: 'about-cite', id: 'about-cite' }, parts.before, h('i', {}, parts.title), parts.after);
  const status = h('span', { class: 'copy-status', id: 'about-cite-copied', 'aria-live': 'polite' });
  const copy = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm',
      id: 'about-cite-copy',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(citation());
          status.textContent = t('dlg.copy.done');
        } catch {
          // no clipboard (a file opened from the disk in some browsers): the reference is selected to copy by hand
          const range = document.createRange();
          range.selectNodeContents(cite);
          getSelection()?.removeAllRanges();
          getSelection()?.addRange(range);
        }
      },
    },
    t('dlg.copy.button'),
  );
  const row = (key: string, ...value: Array<Node | string>) => [h('dt', {}, t(key)), h('dd', {}, ...value)];
  return h(
    'div',
    { class: 'about', id: 'help-about' },
    h(
      'div',
      { class: 'about-head' },
      brandEl(BRAND.logoSmall, 'about-logo'),
      h(
        'div',
        {},
        h('div', { class: 'about-name' }, 'LithicAnalyst', h('span', { class: 'about-version', id: 'about-version' }, `v${__APP_VERSION__}`)),
        h('div', { class: 'about-credit', id: 'about-credit' }, creditLine()),
      ),
    ),
    h(
      'dl',
      { class: 'about-list' },
      ...row('about.author', ABOUT.author),
      ...row('about.source', link(ABOUT.repository, ABOUT.repository.replace(/^https?:\/\//, ''), 'about-repo')),
      ...row('about.feedback', link(ISSUES_URL, 'GitHub Issues', 'about-issues'), ' · ', link(`mailto:${ABOUT.email}`, ABOUT.email, 'about-email')),
      ...row('about.cite', cite, h('div', { class: 'copy-row' }, copy, status)),
      ...row('about.license', link(LICENSE_URL, `${ABOUT.license} License`, 'about-license'), ` · © ${ABOUT.copyright}`),
      ...row('about.thirdParty', THIRD_PARTY),
    ),
  );
}

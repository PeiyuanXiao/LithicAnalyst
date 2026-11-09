import type { LocalizedText } from '../core/types';
import { STRINGS } from './strings';

/**
 * The interface languages, each named in itself, in the menus' order: English (the default) and Chinese,
 * then the others by their own names. Adding one: a column headed with its code in the table
 * `npm run i18n -- export` makes, imported with `npm run i18n -- import` (an entry at the end here, to be
 * moved into place, and a property in every text of ui/strings.ts and core/fields.ts; see CONTRIBUTING.md).
 */
export const LANGS = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'zh', label: '中文', short: '中' },
  { code: 'de', label: 'Deutsch', short: 'DE' },
  { code: 'es', label: 'Español', short: 'ES' },
  { code: 'fr', label: 'Français', short: 'FR' },
  { code: 'it', label: 'Italiano', short: 'IT' },
  { code: 'vi', label: 'Tiếng Việt', short: 'VI' },
] as const;

export type Lang = (typeof LANGS)[number]['code'];

const KEY = 'lithicanalyst:lang';

let lang: Lang = detect();
const listeners = new Set<() => void>();

/** The saved choice, else the default (the browser's language is not consulted). */
function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    const known = LANGS.find((l) => l.code === saved);
    if (known) return known.code;
  } catch {
    /* storage unavailable */
  }
  return LANGS[0].code;
}

export const getLang = (): Lang => lang;

/** The current language's entry of LANGS. */
export const langInfo = (code: Lang = lang): (typeof LANGS)[number] => LANGS.find((l) => l.code === code) ?? LANGS[0];

/** The value for `<html lang>`. */
export const htmlLang = (code: Lang = lang): string => (code === 'zh' ? 'zh-CN' : code);

/** How dates are written: day before month in English, the language's own way otherwise. */
export const dateLocale = (code: Lang = lang): string => (code === 'en' ? 'en-GB' : htmlLang(code));

export function setLang(next: Lang): void {
  if (next === lang) return;
  lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = htmlLang(next);
  for (const fn of listeners) fn();
}

export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export type StringKey = keyof typeof STRINGS;

/** Translate a key (English where the language has no text for it); {name} placeholders are filled from vars. Unknown keys are returned as-is. */
export function t(key: StringKey | string, vars?: Record<string, string | number>): string {
  const entry = (STRINGS as Record<string, LocalizedText>)[key];
  let s = entry ? entry[lang] || entry.en : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Pick the current language from a field label. */
export const tl = (text: LocalizedText): string => text[lang] || text.en;

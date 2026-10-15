import type { LocalizedText } from '../core/types';
import { STRINGS } from './strings';

export type Lang = 'zh' | 'en';

let lang: Lang = detect();
const listeners = new Set<() => void>();

function detect(): Lang {
  try {
    const saved = localStorage.getItem('lithicanalyst:lang');
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export const getLang = (): Lang => lang;

export function setLang(next: Lang): void {
  if (next === lang) return;
  lang = next;
  try {
    localStorage.setItem('lithicanalyst:lang', next);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
  for (const fn of listeners) fn();
}

export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export type StringKey = keyof typeof STRINGS;

/** Translate a key; {name} placeholders are filled from vars. Unknown keys are returned as-is. */
export function t(key: StringKey | string, vars?: Record<string, string | number>): string {
  const entry = (STRINGS as Record<string, LocalizedText>)[key];
  let s = entry ? entry[lang] : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Pick the current language from a field label. */
export const tl = (text: LocalizedText): string => text[lang] || text.en;

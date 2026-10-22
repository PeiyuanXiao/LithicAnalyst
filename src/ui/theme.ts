/**
 * The shell's appearance: light or dark, as `<html data-theme>`. The choice is kept in
 * localStorage; without one the system's preference is followed. index.html sets it
 * before the first frame with the same rule (an inline script); `initTheme` covers hosts
 * that drop that script.
 */
export type Theme = 'light' | 'dark';

const KEY = 'lithicanalyst:theme';
const listeners = new Set<(t: Theme) => void>();

function saved(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function system(): Theme {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function initTheme(): void {
  const t = document.documentElement.dataset.theme;
  if (t !== 'light' && t !== 'dark') document.documentElement.dataset.theme = saved() ?? system();
}

export function setTheme(next: Theme): void {
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* storage unavailable: the choice lasts for this page */
  }
  for (const fn of listeners) fn(next);
}

export const toggleTheme = (): void => setTheme(getTheme() === 'dark' ? 'light' : 'dark');

export function onThemeChange(fn: (t: Theme) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

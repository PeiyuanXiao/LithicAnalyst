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

/** The circle that brings the other theme in: its length and easing. */
export const THEME_SWITCH = { MS: 480, EASING: 'cubic-bezier(.2,.7,.2,1)' } as const;

interface ViewTransitionLike {
  ready: Promise<void>;
  finished: Promise<void>;
  skipTransition(): void;
}

type DocumentWithTransitions = Document & { startViewTransition?: (update: () => void) => ViewTransitionLike };

/** The transition running, and the theme it goes to (its update may not have run yet). */
let running: { transition: ViewTransitionLike; to: Theme } | null = null;

const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The other theme, coming in as a circle that grows from the middle of `button` until it covers the window
 * (a view transition). Without view transitions, or with reduced motion, it changes at once. A second press
 * while the circle grows ends that one where it is going and starts again from the new state.
 */
export function toggleThemeFrom(button: Element | null): void {
  const doc = document as DocumentWithTransitions;
  const from = running?.to ?? getTheme();
  const next: Theme = from === 'dark' ? 'light' : 'dark';
  running?.transition.skipTransition();
  running = null;
  if (typeof doc.startViewTransition !== 'function' || reducedMotion()) {
    setTheme(next);
    return;
  }
  const w = window.innerWidth, hgt = window.innerHeight;
  const r = button?.getBoundingClientRect();
  const x = r ? r.left + r.width / 2 : w / 2;
  const y = r ? r.top + r.height / 2 : 0;
  // as far as the farthest corner of the window
  const radius = Math.hypot(Math.max(x, w - x), Math.max(y, hgt - y));
  const transition = doc.startViewTransition(() => {
    // (a press while it waited has moved on: this update still runs, to the theme it was for)
    setTheme(next);
  });
  const mine = { transition, to: next };
  running = mine;
  transition.ready
    .then(() => {
      doc.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: THEME_SWITCH.MS, easing: THEME_SWITCH.EASING, pseudoElement: '::view-transition-new(root)' },
      );
    })
    .catch(() => {
      /* skipped before it was ready */
    });
  transition.finished
    .catch(() => {})
    .finally(() => {
      if (running === mine) running = null;
    });
}

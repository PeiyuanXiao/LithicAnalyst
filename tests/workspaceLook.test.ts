import { afterEach, describe, expect, it, vi } from 'vitest';
import { addLandmark, addScarVector, setScarLabel } from '../src/core/actions';
import { emptyProject, ProjectStore } from '../src/core/store';
import { cubicBezier, EASE, EASE_POP } from '../src/render/easing';
import { getTheme, THEME_SWITCH, toggleThemeFrom } from '../src/ui/theme';

// ---------------------------------------------------------------- the theme's circle (ui/theme.ts)

interface FakeTransition {
  ready: Promise<void>;
  finished: Promise<void>;
  skipTransition: ReturnType<typeof vi.fn>;
}

/** A document with `<html data-theme>`, and maybe view transitions; a window of 1000 × 600; the system's motion setting. */
function fakePage(opts: { transitions: boolean; reduced: boolean }) {
  const animate = vi.fn();
  const transitions: FakeTransition[] = [];
  const documentElement = { dataset: { theme: 'light' } as Record<string, string>, animate };
  const doc: Record<string, unknown> = { documentElement };
  if (opts.transitions)
    doc.startViewTransition = vi.fn((update: () => void) => {
      // the update runs (here at once), then the pseudo-elements are ready
      update();
      const tr: FakeTransition = { ready: Promise.resolve(), finished: Promise.resolve(), skipTransition: vi.fn() };
      transitions.push(tr);
      return tr;
    });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 600 });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') && opts.reduced }));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  return { doc, animate, transitions };
}

/** A button whose middle is at (x, y). */
const buttonAt = (x: number, y: number) => ({ getBoundingClientRect: () => ({ left: x - 16, top: y - 16, width: 32, height: 32 }) }) as unknown as Element;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toggleThemeFrom', () => {
  it('with view transitions and motion: switches inside one, and grows a circle from the button to the farthest corner', async () => {
    const page = fakePage({ transitions: true, reduced: false });
    toggleThemeFrom(buttonAt(900, 20));
    expect(page.doc.startViewTransition).toHaveBeenCalledTimes(1);
    expect(getTheme()).toBe('dark');
    await Promise.resolve();
    await Promise.resolve();
    expect(page.animate).toHaveBeenCalledTimes(1);
    const [frames, options] = page.animate.mock.calls[0];
    // the farthest corner from (900, 20) is (0, 600)
    const r = Math.hypot(900, 580);
    expect(frames.clipPath).toEqual(['circle(0px at 900px 20px)', `circle(${r}px at 900px 20px)`]);
    expect(options).toMatchObject({ duration: THEME_SWITCH.MS, easing: THEME_SWITCH.EASING, pseudoElement: '::view-transition-new(root)' });
  });

  it('pressed again while it runs: the first is skipped, and the second goes back', () => {
    const page = fakePage({ transitions: true, reduced: false });
    toggleThemeFrom(buttonAt(10, 10));
    toggleThemeFrom(buttonAt(10, 10));
    expect(page.transitions[0].skipTransition).toHaveBeenCalled();
    expect(page.doc.startViewTransition).toHaveBeenCalledTimes(2);
    expect(getTheme()).toBe('light');
  });

  it('without view transitions: switches at once', () => {
    const page = fakePage({ transitions: false, reduced: false });
    toggleThemeFrom(buttonAt(10, 10));
    expect(getTheme()).toBe('dark');
    expect(page.animate).not.toHaveBeenCalled();
  });

  it('with reduced motion: switches at once, no transition', () => {
    const page = fakePage({ transitions: true, reduced: true });
    toggleThemeFrom(buttonAt(10, 10));
    expect(getTheme()).toBe('dark');
    expect(page.doc.startViewTransition).not.toHaveBeenCalled();
    expect(page.animate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- changes not saved (core/commands.ts)

const p = (x: number, y = 0, z = 0): [number, number, number] => [x, y, z];

describe('changes not saved', () => {
  /** A model opened: a fresh project, nothing to undo. */
  const opened = () => {
    const store = new ProjectStore();
    store.reset(emptyProject());
    return store;
  };

  it('none on opening; one after an annotation; none once saved; none again on undoing back to what was saved', () => {
    const store = opened();
    const hst = store.history;
    expect(hst.dirty).toBe(false);
    addLandmark(store, p(1));
    expect(hst.dirty).toBe(true);
    hst.markSaved();
    expect(hst.dirty).toBe(false);
    addLandmark(store, p(2));
    expect(hst.dirty).toBe(true);
    hst.undo();
    expect(hst.dirty).toBe(false);
    // and on past what was saved, and forward to it again
    hst.undo();
    expect(hst.dirty).toBe(true);
    hst.redo();
    expect(hst.dirty).toBe(false);
  });

  it('undone to the state as opened, nothing is unsaved', () => {
    const store = opened();
    addScarVector(store, { start: p(0), end: p(1), startNormal: p(0, 0, 1), endNormal: p(0, 0, 1) });
    expect(store.history.dirty).toBe(true);
    store.history.undo();
    expect(store.history.dirty).toBe(false);
  });

  it('a save of an earlier state leaves what was done since unsaved', () => {
    const store = opened();
    addLandmark(store, p(1));
    const at = store.history.stateId;
    addLandmark(store, p(2));
    store.history.markSaved(at);
    expect(store.history.dirty).toBe(true);
    store.history.undo();
    expect(store.history.dirty).toBe(false);
  });

  it('typing merged into the step that was saved is a change of its own', () => {
    const store = opened();
    const scar = addScarVector(store, { start: p(0), end: p(1), startNormal: p(0, 0, 1), endNormal: p(0, 0, 1) });
    setScarLabel(store, scar.id, 'A');
    store.history.markSaved();
    // (a label typed on within a moment merges into the step before)
    setScarLabel(store, scar.id, 'AB');
    expect(store.history.dirty).toBe(true);
  });

  it('opening another model or project starts clean', () => {
    const store = opened();
    addLandmark(store, p(1));
    store.reset(emptyProject());
    expect(store.history.dirty).toBe(false);
    expect(store.history.lastStep).toBe('clear');
  });

  it('says how the state last changed', () => {
    const store = opened();
    const steps: string[] = [];
    store.subscribe(() => steps.push(store.history.lastStep));
    addLandmark(store, p(1));
    store.history.undo();
    store.history.redo();
    expect(steps).toEqual(['execute', 'undo', 'redo']);
  });
});

// ---------------------------------------------------------------- the view's easings (render/easing.ts)

describe('cubicBezier', () => {
  it('is the identity for the straight curve, and holds its ends', () => {
    const lin = cubicBezier(0, 0, 1, 1);
    for (const k of [0, 0.1, 0.25, 0.5, 0.8, 1]) expect(lin(k)).toBeCloseTo(k, 6);
    expect(EASE(0)).toBe(0);
    expect(EASE(1)).toBe(1);
  });

  it("matches CSS's ease (0.25, 0.1, 0.25, 1) at known points", () => {
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    // (values of the curve, solved independently by bisection to 1e-9)
    expect(ease(0.5)).toBeCloseTo(0.8024033877399112, 5);
    expect(ease(0.25)).toBeCloseTo(0.40851059699, 5);
  });

  it('the interface easing rises fast and settles; the landmark pop overshoots and comes back', () => {
    expect(EASE(0.5)).toBeGreaterThan(0.85);
    for (let k = 0.05; k < 1; k += 0.05) expect(EASE(k + 0.05)).toBeGreaterThanOrEqual(EASE(k) - 1e-9);
    const peak = Math.max(...Array.from({ length: 99 }, (_, i) => EASE_POP((i + 1) / 100)));
    expect(peak).toBeGreaterThan(1.05);
    expect(EASE_POP(1)).toBe(1);
  });
});

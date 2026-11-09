import { inflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { boxPly, boxPoint, t1Ply } from './fixtures/meshes';
import { annotate } from './flakeSetup';
import { dragArrow, enterModule, expect, fileMenu, loadMesh, nextFrames, openApp, openStart, state, test, toScreen, viewFromTop } from './helpers';

const SHOTS = 'test-results/25';

/** A colour variable of the shell as the browser computes a background in it (rgb(…)). */
const colourOf = (page: Page, name: string): Promise<string> =>
  page.evaluate((v) => {
    const d = document.createElement('div');
    d.style.background = `var(${v})`;
    document.body.append(d);
    const c = getComputedStyle(d).backgroundColor;
    d.remove();
    return c;
  }, name);

const textColourOf = (page: Page, name: string): Promise<string> =>
  page.evaluate((v) => {
    const d = document.createElement('div');
    d.style.color = `var(${v})`;
    document.body.append(d);
    const c = getComputedStyle(d).color;
    d.remove();
    return c;
  }, name);

const setTheme = async (page: Page, theme: 'light' | 'dark'): Promise<void> => {
  if ((await page.evaluate(() => window.lithicanalyst.theme())) !== theme) await page.locator('#btn-theme').click();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.theme())).toBe(theme);
  await nextFrames(page, 3);
};

/** The box, a core, in the annotate mode, nothing changed. */
async function box(page: Page): Promise<void> {
  await openApp(page, 'core');
  await loadMesh(page, boxPly());
  await viewFromTop(page);
}

// ---------------------------------------------------------------- 25.2 cards

test('the sidebar is flat cards on a ground of its own; no frame inside a card; in both themes', async ({ page }) => {
  await box(page);
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    const look = await page.evaluate(() => {
      const side = getComputedStyle(document.querySelector('#sidebar')!).backgroundColor;
      return [...document.querySelectorAll<HTMLElement>('#sidebar .panel')]
        .filter((p) => p.getClientRects().length > 0)
        .map((p) => {
          const cs = getComputedStyle(p);
          return { id: p.id, radius: cs.borderTopLeftRadius, bg: cs.backgroundColor, image: cs.backgroundImage, side, shadow: cs.boxShadow };
        });
    });
    expect(look.length).toBeGreaterThan(1);
    for (const p of look) {
      expect(p.radius, p.id).toBe('4px');
      expect(p.bg, p.id).not.toBe(p.side);
      expect(p.image, p.id).toBe('none');
      expect(p.shadow, p.id).toBe('none');
    }
    // the lists in a card have no frame of their own
    const listFrames = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#sidebar .arrow-list, #sidebar .ws-list')].map((l) => getComputedStyle(l).borderLeftWidth));
    for (const w of listFrames) expect(w).toBe('0px');
  }
  // a section with nothing in it: its title recedes
  const ink3 = await textColourOf(page, '--ink-3');
  await expect(page.locator('#sec-arrows')).toHaveClass(/is-empty/);
  expect(await page.locator('#sec-arrows .panel-title').evaluate((e) => getComputedStyle(e).color)).toBe(ink3);
  // no sideways scrolling in a narrow sidebar, nor on a phone
  for (const width of [400, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await nextFrames(page, 3);
    expect(await page.evaluate(() => document.querySelector('#sidebar')!.scrollWidth - document.querySelector('#sidebar')!.clientWidth)).toBeLessThanOrEqual(0);
  }
});

// ---------------------------------------------------------------- 25.3 amber

test('solid amber is the current mode alone; Save has a dot only while something is not saved', async ({ page }) => {
  await box(page);
  await nextFrames(page, 3);
  const accent = await colourOf(page, '--accent');
  const amber = await page.evaluate((c) => {
    const out: Array<{ tag: string; cls: string; id: string }> = [];
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      if (getComputedStyle(el).backgroundColor !== c) continue;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) || el.getBoundingClientRect().width === 0) continue;
      out.push({ tag: el.tagName, cls: String(el.className), id: el.id });
    }
    return out;
  }, accent);
  expect(amber).toHaveLength(1);
  // the block under the chosen mode (or that button itself, before the block is placed)
  expect(amber[0].cls).toMatch(/mode-thumb|mode-btn/);
  const under = await page.evaluate(() => {
    const thumb = document.querySelector('.mode-thumb')!.getBoundingClientRect();
    const b = document.querySelector('.mode-btn[aria-checked="true"]')!.getBoundingClientRect();
    return Math.abs(thumb.left - b.left) + Math.abs(thumb.width - b.width);
  });
  expect(under).toBeLessThan(1.5);
  // check boxes are ink; the tool chosen is pale amber with an amber line
  await page.locator('#btn-display').click();
  const check = page.locator('#display-panel input[type="checkbox"]:checked').first();
  expect(await check.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(await colourOf(page, '--ink'));
  await page.keyboard.press('Escape');
  const tool = page.locator('.tool-btn[aria-checked="true"]').first();
  expect(await tool.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(await colourOf(page, '--accent-soft'));

  // nothing changed: no dot
  const save = page.locator('#btn-save-project');
  await expect(save).toHaveAttribute('data-dirty', 'false');
  expect(await save.evaluate((e) => getComputedStyle(e, '::after').content)).toBe('none');
  // a landmark: the dot
  await page.evaluate(() => window.lithicanalyst.setTool('landmark'));
  const at = await toScreen(page, boxPoint(0, 0, 5));
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await state(page)).landmarks.length).toBe(1);
  await expect(save).toHaveAttribute('data-dirty', 'true');
  const dot = await save.evaluate((e) => {
    const cs = getComputedStyle(e, '::after');
    return { bg: cs.backgroundColor, w: cs.width, h: cs.height };
  });
  expect(dot).toEqual({ bg: accent, w: '7px', h: '7px' });
  await page.screenshot({ path: `${SHOTS}/save-dot.png`, clip: { x: 900, y: 0, width: 380, height: 60 } });
  // undone, it goes again
  await page.keyboard.press('Control+z');
  await expect(save).toHaveAttribute('data-dirty', 'false');
});

// ---------------------------------------------------------------- 25.4 measures

test('a flake: the measures in groups; platform width and depth 2 × 2, EPA 2 × 3; a cell shows its own; an empty cell recedes', async ({ page }) => {
  await openApp(page, 'flake');
  await loadMesh(page, t1Ply());
  // nothing annotated yet: every value is empty, and recedes
  await page.locator('#app-mode-measure').click();
  const ink3 = await textColourOf(page, '--ink-3');
  await expect(page.locator('#flake-platform_width_chord')).toHaveText('—');
  expect(await page.locator('#flake-platform_width_chord').evaluate((e) => getComputedStyle(e).color)).toBe(ink3);
  expect(await page.locator('#flake-tech_length').evaluate((e) => getComputedStyle(e).color)).toBe(ink3);
  // a cell with nothing has no drawing to show, and no focus
  await expect(page.locator('#flake-epa_3pt_2mm')).not.toHaveAttribute('data-hint', /./);

  await page.locator('#app-mode-annotate').click();
  await annotate(page);
  await page.locator('#app-mode-measure').click();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.flake()?.measures?.epa_3pt_2mm ?? null)).not.toBeNull();
  if (await page.locator('#profile-panel').isVisible()) await page.locator('#profile-close').click();

  // the groups, their titles in the data face
  const titles = page.locator('#flake-measures .measure-group-title');
  await expect(titles).toHaveText(['Technological axis', 'Morphology', 'Platform', 'Whole']);
  expect(await titles.first().evaluate((e) => ({ font: getComputedStyle(e).fontFamily, size: getComputedStyle(e).fontSize, spacing: getComputedStyle(e).letterSpacing, color: getComputedStyle(e).color }))).toMatchObject({ size: '10.5px', color: ink3 });
  expect(await titles.first().evaluate((e) => getComputedStyle(e).fontFamily)).toContain('Plex Mono');

  const pw = page.locator('#flake-platform-table');
  await expect(pw.locator('tbody tr')).toHaveCount(2);
  for (const r of await pw.locator('tbody tr').all()) await expect(r.locator('td')).toHaveCount(2);
  await expect(pw.locator('thead th')).toHaveText(['mm', 'Chord', 'Along surface']);
  await expect(pw.locator('tbody th')).toHaveText(['Width', 'Depth']);
  const epa = page.locator('#flake-epa-table');
  await expect(epa.locator('tbody tr')).toHaveCount(2);
  for (const r of await epa.locator('tbody tr').all()) await expect(r.locator('td')).toHaveCount(3);
  await expect(epa.locator('thead th')).toHaveText(['°', '1 mm', '2 mm', '3 mm']);
  // the unit is in the head, not in the cells; the numbers right-aligned in the data face
  expect(await epa.locator('td').first().textContent()).not.toContain('°');
  expect(await epa.locator('td').first().evaluate((e) => getComputedStyle(e).textAlign)).toBe('right');
  // the same values as the measures, in the same places
  const m = await page.evaluate(() => window.lithicanalyst.flake()!.measures!);
  await expect(page.locator('#flake-epa_2ln_3mm')).toHaveText(m.epa_2ln_3mm!.toFixed(1));

  // the pointer on a cell of EPA: that EPA's drawing (as in 23.2)
  await page.locator('#flake-epa_3pt_2mm').hover();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.measureHint().key)).toBe('flake:epa_3pt_2mm');
  const parts = (await page.evaluate(() => window.lithicanalyst.measureHint())).prims.map((p) => `${p.kind}:${p.part}`);
  expect(parts).toEqual(expect.arrayContaining(['line:section', 'line:platform-line', 'line:to-q', 'arc:arc', 'dots:points']));
  await expect(page.locator('#flake-epa_3pt_2mm')).toHaveClass(/is-hinted/);
  // another cell, another drawing
  await page.locator('#flake-epa_2ln_1mm').hover();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.measureHint().key)).toBe('flake:epa_2ln_1mm');
  // the keyboard: a cell takes the focus and shows its own
  await page.locator('#flake-platform_depth_path').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(page.locator('#flake-platform_depth_path')).toBeFocused();
  await page.mouse.move(300, 400);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.measureHint().key)).toBe('flake:platform_depth_path');
  // a click fixes it, as ever
  await page.locator('#flake-platform_width_path').click();
  expect((await page.evaluate(() => window.lithicanalyst.measureHint())).pinned).toBe('flake:platform_width_path');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${SHOTS}/measures-flake.png` });
});

test('a core and a generic specimen: dimensions, then the whole', async ({ page }) => {
  for (const type of ['core', 'generic'] as const) {
    await openApp(page, type);
    await loadMesh(page, boxPly());
    await page.locator('#app-mode-measure').click();
    await expect(page.locator('#measure-auto .measure-group-title')).toHaveText(['Dimensions', 'Whole']);
    await expect(page.locator('#auto-length')).toHaveText('40.000');
    await expect(page.locator('#auto-volume')).toHaveText('8000.00');
  }
});

// ---------------------------------------------------------------- 25.5 empty

test('with no model: the module drawing over the start page grid; the sidebar has the mode’s sections, grey, that do not open; again after closing', async ({ page }) => {
  await openApp(page, 'flake');
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await page.screenshot({ path: `${SHOTS}/empty-${theme}.png` });
  }
  await setTheme(page, 'light');
  await expect(page.locator('#empty-icon')).toBeVisible();
  await expect(page.locator('#empty-icon')).toHaveAttribute('data-type', 'flake');
  expect(await page.locator('#empty-icon').evaluate((e) => getComputedStyle(e).opacity)).toBe('0.5');
  await expect(page.locator('.vp-empty-bg .start-grid')).toBeAttached();
  await expect(page.locator('.vp-empty-bg .start-rings svg')).toBeAttached();
  // no words were added
  expect(await page.locator('.vp-empty').evaluate((e) => [...e.querySelectorAll('.vp-empty-bg, #empty-icon')].map((x) => x.textContent?.trim()).join(''))).toBe('');

  const ghosts = page.locator('#sidebar .panel-ghost:visible');
  await expect(ghosts.first()).toBeVisible();
  const titles = await ghosts.locator('.panel-title').allTextContents();
  // the annotate mode of a flake
  expect(titles).toEqual(expect.arrayContaining(['Technological axis', 'Curves', 'Landmarks']));
  expect(await ghosts.locator('.badge').count()).toBe(0);
  const ink3 = await textColourOf(page, '--ink-3');
  expect(await ghosts.first().locator('.panel-title').evaluate((e) => getComputedStyle(e).color)).toBe(ink3);
  const before = await ghosts.first().boundingBox();
  await ghosts.first().click();
  await nextFrames(page, 3);
  expect((await ghosts.first().boundingBox())!.height).toBe(before!.height);
  await expect(ghosts.first().locator('.panel-body')).toHaveCount(0);
  await expect(page.locator('#sec-arrows')).toBeHidden();

  // File ▸ Close: the start page; another module: its drawing, its sections
  await fileMenu(page, '#btn-close-model');
  await expect(page.locator('#start-page')).toBeVisible();
  await enterModule(page, 'core');
  await expect(page.locator('#empty-icon')).toHaveAttribute('data-type', 'core');
  await expect(page.locator('#empty-icon')).toBeVisible();
  const coreTitles = await page.locator('#sidebar .panel-ghost:visible .panel-title').allTextContents();
  expect(coreTitles).not.toContain('Technological axis');
  expect(coreTitles).toContain('Scar arrows');
  // a model: the real sections
  await loadMesh(page, boxPly());
  await expect(page.locator('#sidebar .panel-ghost:visible')).toHaveCount(0);
  await expect(page.locator('#sec-arrows')).toBeVisible();
});

// ---------------------------------------------------------------- 25.6 toasts and panels

test('a toast stands at the lower right of the view, over the coordinate reading; every panel is the same card', async ({ page }) => {
  await openApp(page, 'core');
  await loadMesh(page, boxPly());
  const toast = page.locator('.toast').first();
  await expect(toast).toBeVisible();
  const view = (await page.locator('#viewport').boundingBox())!;
  const reading = (await page.locator('#status-coords').boundingBox())!;
  const tb = (await toast.boundingBox())!;
  expect(Math.abs(view.x + view.width - 12 - (tb.x + tb.width))).toBeLessThan(2);
  expect(Math.abs(reading.y - 8 - (tb.y + tb.height))).toBeLessThan(2);
  const look = await toast.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color, radius: getComputedStyle(e).borderTopLeftRadius }));
  expect(look).toEqual({ bg: await colourOf(page, '--surface-pop'), color: await textColourOf(page, '--ink'), radius: '4px' });
  await page.screenshot({ path: `${SHOTS}/toast.png` });

  // the same card everywhere over the view (the pointer off the buttons)
  await page.locator('#btn-display').click();
  await page.mouse.move(640, 300);
  const pop = await colourOf(page, '--surface-pop');
  const cards = await page.evaluate(() =>
    ['.vp-toolbar', '#btn-display', '#display-panel', '#status-coords'].map((s) => {
      const cs = getComputedStyle(document.querySelector(s)!);
      return { s, bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, border: cs.borderTopWidth, shadow: cs.boxShadow !== 'none' };
    }),
  );
  for (const c of cards) {
    expect(c.bg, c.s).toBe(pop);
    expect(c.border, c.s).toBe('1px');
    expect(c.shadow, c.s).toBe(true);
    expect(c.radius, c.s).toBe(c.s === '#display-panel' ? '6px' : '4px');
  }
  // what is left of rounded corners in the workspace: 4px, 6px and capsules
  const radii = await page.evaluate(() => {
    const seen = new Set<string>();
    for (const el of document.querySelectorAll<HTMLElement>('.app *:not(.start-page *)')) {
      if (el.closest('#start-page') || el instanceof SVGElement) continue;
      const r = getComputedStyle(el).borderTopLeftRadius;
      if (r !== '0px') seen.add(r);
    }
    return [...seen];
  });
  for (const r of radii) expect(['4px', '6px', '50%', '999px']).toContain(r);
});

// ---------------------------------------------------------------- 25.1 the theme's circle

test.describe('with motion', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test('the other theme grows as a circle from the button, and is there once it has covered the window', async ({ page }) => {
    await box(page);
    await nextFrames(page, 3);
    const btn = (await page.locator('#btn-theme').boundingBox())!;
    await page.locator('#btn-theme').click();
    // the circle, held 200 ms in
    const held = await page.evaluate(async () => {
      for (let i = 0; i < 60; i++) {
        const a = document.getAnimations().find((x) => (x.effect as KeyframeEffect | null)?.pseudoElement === '::view-transition-new(root)');
        if (a) {
          a.pause();
          a.currentTime = 200;
          return true;
        }
        await new Promise((r) => requestAnimationFrame(r));
      }
      return false;
    });
    expect(held).toBe(true);
    await nextFrames(page, 2);
    const shot = await page.screenshot({ path: `${SHOTS}/theme-switch.png` });
    const img = decodePng(shot);
    // in the circle, near the button: the dark shell's top bar; far away (lower left): still the light one
    const near = img.at(btn.x - 40, btn.y + btn.height / 2);
    const far = img.at(30, 780);
    expect(luma(near)).toBeLessThan(80);
    expect(luma(far)).toBeGreaterThan(150);
    // let it run to its end
    await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
    await expect.poll(() => page.evaluate(() => window.lithicanalyst.theme())).toBe('dark');
    await expect.poll(() => page.evaluate(() => document.getAnimations().some((x) => (x.effect as KeyframeEffect | null)?.pseudoElement?.startsWith('::view-transition') ?? false))).toBe(false);
    // two presses in a row: back where it was
    await page.locator('#btn-theme').click();
    await page.locator('#btn-theme').click();
    await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
    await expect.poll(() => page.evaluate(() => window.lithicanalyst.theme())).toBe('dark');
  });

  test('what the user just made comes in: a landmark pops, a pill ticks; an arrow is there at once; not on undo or redo', async ({ page }) => {
    await box(page);
    // an arrow drawn: whole at once, nothing in the view moves
    await page.keyboard.press('a');
    await dragArrow(page, boxPoint(-12, 0, 5), boxPoint(12, 0, 5));
    expect((await state(page)).scars).toHaveLength(1);
    expect(await page.evaluate(() => window.lithicanalyst.tweening())).toBe(false);
    // the scars' pill became done by it: it ticks
    const pill = page.locator('#status-scar_arrows');
    await expect(pill).toHaveAttribute('data-done', 'true');
    await expect(pill).toHaveClass(/is-ticking/);
    // undone and redone: no motion
    await page.keyboard.press('Control+z');
    await expect(pill).toHaveAttribute('data-done', 'false');
    await page.keyboard.press('Control+Shift+z');
    await expect(pill).toHaveAttribute('data-done', 'true');
    await expect(pill).not.toHaveClass(/is-ticking/);
    expect(await page.evaluate(() => window.lithicanalyst.tweening())).toBe(false);

    // a landmark placed: from nothing to its size (a little over it on the way), sampled every frame. The pop goes by the
    // clock, and without a GPU (as on CI) one frame can take longer than the whole pop, which then shows no frame of it:
    // while it comes in, the page's clock moves on by one 60 Hz frame for each frame drawn, however long that takes.
    await page.evaluate(() => {
      const real = { now: performance.now.bind(performance), raf: window.requestAnimationFrame.bind(window) };
      (window as unknown as { realClock: typeof real }).realClock = real;
      // the callbacks of one frame share its time: the clock moves on once a frame
      let t = real.now();
      let frame = -1;
      performance.now = () => t;
      window.requestAnimationFrame = (cb) =>
        real.raf((ts) => {
          if (ts !== frame) [frame, t] = [ts, t + 1000 / 60];
          cb(t);
        });
    });
    await nextFrames(page, 3);
    await page.evaluate(() => window.lithicanalyst.setTool('landmark'));
    const at = await toScreen(page, boxPoint(0, 5, 5));
    await page.evaluate(() => {
      const sizes: number[] = [];
      (window as unknown as { sizes: number[] }).sizes = sizes;
      const step = () => {
        const id = window.lithicanalyst.state().landmarks[0]?.id;
        const d = id ? window.lithicanalyst.landmarkDiameter(id) : null;
        if (d !== null) sizes.push(d);
        if (sizes.length < 400 && (sizes.length === 0 || window.lithicanalyst.tweening())) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    await page.mouse.click(at.x, at.y);
    await expect.poll(async () => (await state(page)).landmarks.length).toBe(1);
    const lm = (await state(page)).landmarks[0].id;
    await expect.poll(() => page.evaluate(() => window.lithicanalyst.tweening())).toBe(false);
    const full = (await page.evaluate((id) => window.lithicanalyst.landmarkDiameter(id), lm))!;
    const sizes = await page.evaluate(() => (window as unknown as { sizes: number[] }).sizes);
    expect(Math.min(...sizes)).toBeLessThan(0.6 * full);
    expect(Math.abs(sizes[sizes.length - 1] - full)).toBeLessThan(0.5);
    // the page's own clock again
    await page.evaluate(() => {
      const real = (window as unknown as { realClock: { now: () => number; raf: typeof requestAnimationFrame } }).realClock;
      performance.now = real.now;
      window.requestAnimationFrame = real.raf;
    });
    // pressed on the view while it grows: at its size at once
    await page.keyboard.press('Control+z');
    await page.mouse.click(at.x, at.y);
    await expect.poll(async () => (await state(page)).landmarks.length).toBe(1);
    const again = (await state(page)).landmarks[0].id;
    await page.mouse.move(at.x + 120, at.y + 60);
    await page.mouse.down();
    expect(await page.evaluate(() => window.lithicanalyst.tweening())).toBe(false);
    expect(Math.abs((await page.evaluate((id) => window.lithicanalyst.landmarkDiameter(id), again))! - full)).toBeLessThan(0.5);
    await page.mouse.up();
  });

  test('a value the user changes flashes; undone, it does not', async ({ page }) => {
    await openApp(page, 'flake');
    await loadMesh(page, t1Ply());
    await annotate(page);
    await page.locator('#app-mode-measure').click();
    await expect.poll(() => page.evaluate(() => window.lithicanalyst.flake()?.measures?.epa_3pt_2mm ?? null)).not.toBeNull();
    // what annotating changed while the list was out of sight does not flash now
    await expect(page.locator('#flake-measures .is-flash')).toHaveCount(0);
    // every cell that flashes from now on (a flash lasts 900 ms, and the rows are made anew)
    await page.evaluate(() => {
      const seen = new Set<string>();
      (window as unknown as { flashed: Set<string> }).flashed = seen;
      new MutationObserver(() => document.querySelectorAll('#flake-measures .is-flash[id]').forEach((e) => seen.add(e.id))).observe(document.querySelector('#flake-measures')!, { subtree: true, childList: true, attributes: true });
    });
    const flashed = () => page.evaluate(() => [...(window as unknown as { flashed: Set<string> }).flashed].sort());
    // no unit: what is taken at so many millimetres goes
    await page.locator('#specimen-more').click();
    await page.locator('#specimen-unit').selectOption('');
    await page.keyboard.press('Escape');
    await expect(page.locator('#flake-epa_3pt_2mm')).toHaveText('—');
    await expect.poll(flashed).toContain('flake-epa_3pt_2mm');
    // the values that did not change stay still
    expect(await flashed()).not.toContain('flake-tech_length');
    await page.evaluate(() => (window as unknown as { flashed: Set<string> }).flashed.clear());
    await page.keyboard.press('Control+z');
    await expect(page.locator('#flake-epa_3pt_2mm')).not.toHaveText('—');
    await nextFrames(page, 3);
    expect(await flashed()).toEqual([]);
  });

  test('loading that takes a while turns the logo; a quick one shows none of it', async ({ page }) => {
    await openApp(page, 'core');
    const looping = () => page.evaluate(() => [...document.querySelectorAll('.busy-logo .fx-c, .busy-logo .fx-m')].reduce((n, e) => n + e.getAnimations().filter((a) => a.playState === 'running').length, 0));
    // a quick one: gone before the logo shows
    await page.evaluate(() => {
      window.lithicanalyst.busy('Reading');
      setTimeout(() => window.lithicanalyst.busy(null), 150);
    });
    await expect(page.locator('.busy')).toBeVisible();
    expect(await page.locator('.busy').getAttribute('class')).not.toContain('is-long');
    await expect(page.locator('.busy')).toBeHidden();
    // a long one: the logo turns, over the progress
    await page.evaluate(() => window.lithicanalyst.busy('Reading'));
    await expect(page.locator('.busy')).toHaveClass(/is-long/);
    await expect(page.locator('.busy-logo')).toBeVisible();
    await expect(page.locator('.busy-text')).toHaveText('Reading');
    expect(await looping()).toBeGreaterThan(0);
    // its round is 1.5 s
    expect(await page.locator('.busy-logo .fx-c').evaluate((e) => getComputedStyle(e).animationDuration)).toBe('1.5s');
    await nextFrames(page, 3);
    await page.screenshot({ path: `${SHOTS}/loading.png` });
    await page.evaluate(() => window.lithicanalyst.busy(null));
    await expect(page.locator('.busy')).toBeHidden();
    expect(await page.locator('.busy').getAttribute('class')).not.toContain('is-long');
  });

  test('motion is on: the mode block slides, cards fold, panels grow', async ({ page }) => {
    await box(page);
    await page.locator('#btn-display').click();
    const durations = await page.evaluate(() => ({
      thumb: getComputedStyle(document.querySelector('.mode-thumb')!).transitionDuration,
      fold: getComputedStyle(document.querySelector('#sec-arrows')!, '::details-content').transitionDuration,
      display: getComputedStyle(document.querySelector('#display-panel')!).transitionDuration,
    }));
    expect(durations.thumb).toContain('0.3s');
    expect(durations.fold).toContain('0.2s');
    expect(durations.display).toContain('0.2s');
  });
});

test('reduced motion: the theme changes at once; no mode slide, no folding, no panel growing', async ({ page }) => {
  await box(page);
  const at = await page.evaluate(() => {
    (document.querySelector('#btn-theme') as HTMLButtonElement).click();
    return document.documentElement.dataset.theme;
  });
  expect(at).toBe('dark');
  const durations = await page.evaluate(() => ({
    thumb: getComputedStyle(document.querySelector('.mode-thumb')!).transitionDuration,
    mode: getComputedStyle(document.querySelector('.mode-btn')!).transitionDuration,
    fold: getComputedStyle(document.querySelector('#sec-arrows')!, '::details-content').transitionDuration,
    display: getComputedStyle(document.querySelector('#display-panel')!).transitionDuration,
    float: getComputedStyle(document.querySelector('.float-panel')!).transitionDuration,
    menu: getComputedStyle(document.querySelector('#file-menu')!).transitionDuration,
  }));
  for (const [k, v] of Object.entries(durations)) expect(v, k).toBe('0s');
  // a dialog: no animation
  await page.locator('#btn-help').click();
  expect(await page.locator('.modal').evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);
  // the mode switch: the block is under the new mode at once
  await page.locator('#app-mode-measure').click();
  const off = await page.evaluate(() => {
    const thumb = document.querySelector('.mode-thumb')!.getBoundingClientRect();
    const b = document.querySelector('#app-mode-measure')!.getBoundingClientRect();
    return Math.abs(thumb.left - b.left);
  });
  expect(off).toBeLessThan(1.5);
  // a long loading: the logo stands whole and still
  await page.evaluate(() => window.lithicanalyst.busy('Reading'));
  await expect(page.locator('.busy')).toHaveClass(/is-long/);
  const still = await page.evaluate(() => [...document.querySelectorAll<SVGElement>('.busy-logo [class^="fx-"]')].map((e) => ({ n: e.getAnimations().length, o: getComputedStyle(e).opacity })));
  for (const p of still) expect(p).toEqual({ n: 0, o: '1' });
  await page.evaluate(() => window.lithicanalyst.busy(null));
});

// ---------------------------------------------------------------- screenshots

test('screenshots: the five modes in both themes, the shortcuts, the profile panel', async ({ page }) => {
  test.setTimeout(120_000);
  await openApp(page, 'flake');
  await loadMesh(page, t1Ply());
  await annotate(page);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.flake()?.measures?.epa_3pt_2mm ?? null)).not.toBeNull();
  await page.evaluate(() => window.lithicanalyst.view([-0.62, -0.42, 0.66], [0, 0.7, 0.7]));
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    for (const mode of ['annotate', 'measure', 'retouch', 'present', 'compare'] as const) {
      await page.locator(`#app-mode-${mode}`).click();
      await nextFrames(page, 4);
      await page.mouse.move(640, 790);
      await page.screenshot({ path: `${SHOTS}/mode-${mode}-${theme}.png` });
    }
  }
  await setTheme(page, 'light');
  await page.locator('#app-mode-measure').click();
  if (!(await page.locator('#profile-panel').isVisible())) {
    await page.locator('#btn-display').click();
    await page.locator('#display-panel').getByText('Profiles').click();
    await page.keyboard.press('Escape');
  }
  await expect(page.locator('#profile-panel')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/profile-panel.png` });
  await page.locator('#btn-help').click();
  await expect(page.locator('#help-about')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/about.png` });
  await page.locator('#help-tab-shortcuts').click();
  await expect(page.locator('#help-cols')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/shortcuts.png` });
});

test('the start page goes on as it was; its theme button switches too', async ({ page }) => {
  await openStart(page);
  await page.locator('#start-theme').click();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.theme())).toBe('dark');
  await expect(page.locator('#start-page')).toBeVisible();
});

// ---------------------------------------------------------------- a PNG, read back (8-bit RGB or RGBA, as the browser writes it)

interface Image {
  width: number;
  height: number;
  at(x: number, y: number): [number, number, number];
}

const luma = ([r, g, b]: [number, number, number]): number => 0.299 * r + 0.587 * g + 0.114 * b;

function decodePng(buf: Buffer): Image {
  let pos = 8;
  let width = 0, height = 0, channels = 4;
  const data: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      channels = body[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') data.push(body);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[y * stride + i - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = y > 0 && i >= channels ? out[(y - 1) * stride + i - channels] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      out[y * stride + i] = (line[i] + pred) & 0xff;
    }
  }
  return {
    width,
    height,
    at: (x, y) => {
      const i = Math.round(y) * stride + Math.round(x) * channels;
      return [out[i], out[i + 1], out[i + 2]];
    },
  };
}

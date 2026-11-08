import { mkdir } from 'node:fs/promises';
import type { Page, Request } from '@playwright/test';
import { boxPly, t1Ply } from './fixtures/meshes';
import { APP_URL, enterModule, expect, fileMenu, loadMesh, openApp, openStart, specimenPanel, state, test, waitForMesh } from './helpers';

const SHOTS = 'test-results/22a';
const ENTRANCE = ['st-in', 'st-grow', 'st-wipe', 'st-bgin', 'st-fade', 'st-fxin'];

/** The animations of the page's entrance still to end. */
const entrance = (page: Page) => page.evaluate((names) => document.getAnimations().filter((a) => names.includes((a as CSSAnimation).animationName) && a.playState === 'running').length, ENTRANCE);
const focused = (page: Page) => page.evaluate(() => document.activeElement?.id ?? null);
const lit = (page: Page, id: string) => page.locator(id).evaluate((el) => getComputedStyle(el.querySelector('.start-fill')!).opacity);

test('it opens on the start page: three cards, its two controls and the version; no top bar and nothing to load', async ({ page }) => {
  await openStart(page);
  await expect(page.locator('.start-card')).toHaveCount(3);
  await expect(page.locator('.start-card-name')).toHaveText(['Core', 'Flake', 'General']);
  await expect(page.locator('.start-card').nth(0)).toHaveAttribute('aria-label', 'Core');
  expect(await page.evaluate(() => [...document.querySelectorAll('.start-card')].every((c) => c.tagName === 'BUTTON'))).toBe(true);
  await expect(page.locator('#start-version')).toHaveText(`v${await page.evaluate(() => window.lithicanalyst.version)}`);
  for (const id of ['#start-lang', '#start-theme', '.start-logo', '.start-wm svg']) await expect(page.locator(id)).toBeVisible();
  // the words behind the cards are not read out
  for (const name of ['.start-ghost', '.start-disc']) await expect(page.locator(name).first()).toHaveAttribute('aria-hidden', 'true');

  for (const id of ['.topbar', '#btn-file', '#btn-save-project', '#btn-lang', '#btn-theme', '#btn-help', '#empty-open', '#empty-open-folder', '#empty-open-project', '.mode-switch', '#specimen-bar', '.vp-toolbar', '#annotation-status']) await expect(page.locator(id).first()).toBeHidden();
  // it has the whole window, and what is under it cannot be reached
  const box = (await page.locator('#start-page').boundingBox())!;
  expect([box.x, box.y, box.width, box.height]).toEqual([0, 0, 1280, 800]);
  expect(await page.evaluate(() => document.querySelector('main')!.inert)).toBe(true);

  // the app's keys are off
  await page.keyboard.press('m');
  await page.keyboard.press('Shift+Slash');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.lithicanalyst.module())).toBeNull();
});

for (const [type, label, retouch] of [['core', 'Core', false], ['flake', 'Flake', true], ['generic', 'General', false]] as const) {
  test(`the ${label} card goes into its module; the empty view has what the start page used to`, async ({ page }) => {
    await openStart(page);
    await page.locator(`#start-type-${type}`).click();
    await expect(page.locator('#start-page')).toBeHidden();
    expect(await page.evaluate(() => window.lithicanalyst.module())).toBe(type);
    await expect(page.locator('.topbar')).toBeVisible();
    await expect(page.locator('#empty-open')).toHaveText('Open model');
    await expect(page.locator('#empty-open')).toHaveClass(/btn-primary/);
    await expect(page.locator('#empty-open-folder')).toHaveText('Open folder');
    await expect(page.locator('#empty-open-project')).toHaveText('Open project');
    await expect(page.locator('.vp-empty-formats')).toHaveText('PLY · STL · OBJ');
    // in the middle of the view
    const view = (await page.locator('#viewport').boundingBox())!;
    const main = (await page.locator('#empty-open').boundingBox())!;
    expect(Math.abs(main.x + main.width / 2 - (view.x + view.width / 2))).toBeLessThan(1);
    // its own shortcuts, before any model
    await page.locator('#btn-help').click();
    await expect(page.locator('#help-cols').getByText('Previous / next station')).toHaveCount(retouch ? 1 : 0);
    await page.keyboard.press('Escape');

    // each button does what it did
    const folder = page.waitForEvent('filechooser');
    await page.addScriptTag({ content: "Object.defineProperty(window, 'showDirectoryPicker', { value: undefined })" });
    await page.locator('#empty-open-folder').click();
    expect((await folder).isMultiple()).toBe(true);
    const project = page.waitForEvent('filechooser');
    await page.locator('#empty-open-project').click();
    await project;

    await loadMesh(page, boxPly(), '#empty-open');
    expect((await state(page)).specimen.type).toBe(type);
    await expect(page.locator('#viewport-empty')).toBeHidden();
    await expect(page.locator('#app-mode-retouch')).toBeVisible({ visible: retouch });
  });
}

test('File, Close comes back with no entrance and the last card in focus; from the empty view too', async ({ page }) => {
  await openStart(page);
  await expect(page.locator('#start-page')).toHaveClass(/is-entering/);
  await enterModule(page, 'generic');
  await expect(page.locator('#start-page')).not.toHaveClass(/is-entering/);

  // no model yet: a wrong card can be taken back
  await page.locator('#btn-file').click();
  await expect(page.locator('#btn-close-model')).toBeEnabled();
  await page.locator('#btn-close-model').click();
  await expect(page.locator('#start-page')).toBeVisible();
  await expect(page.locator('.topbar')).toBeHidden();
  expect(await focused(page)).toBe('start-type-generic');

  await enterModule(page);
  expect(await page.evaluate(() => window.lithicanalyst.module())).toBe('generic');
  await loadMesh(page, boxPly(), '#empty-open');
  expect((await state(page)).specimen.type).toBe('generic');
  await expect(page.locator('#app-mode-annotate')).toBeVisible();
  await expect(page.locator('#app-mode-retouch')).toBeHidden();
  await expect(page.locator('#specimen-bar')).toBeVisible();

  await fileMenu(page, '#btn-close-model');
  await expect(page.locator('#start-page')).toBeVisible();
  expect(await focused(page)).toBe('start-type-generic');
  await expect(page.locator('.mode-switch')).toBeHidden();

  // and after the page is opened again
  await page.reload();
  await page.waitForFunction(() => !!window.lithicanalyst);
  expect(await focused(page)).toBe('start-type-generic');

  // another card: a flake, with what a flake has
  await page.locator('#start-type-flake').click();
  await loadMesh(page, t1Ply(), '#empty-open');
  expect((await state(page)).specimen.type).toBe('flake');
  await expect(page.locator('#app-mode-retouch')).toBeVisible();
  await expect(page.locator('#mode-axis')).toBeVisible();

  // a type set in the specimen panel is what comes next too
  await specimenPanel(page);
  await page.locator('#specimen-type').selectOption('core');
  await page.keyboard.press('Escape');
  await fileMenu(page, '#btn-close-model');
  expect(await focused(page)).toBe('start-type-core');
});

test('the card in focus is not marked; Tab goes on with it marked; Enter and Space go in', async ({ page }) => {
  await openStart(page);
  // the focus is there, and shows nothing
  expect(await focused(page)).toBe('start-type-core');
  expect(await lit(page, '#start-type-core')).toBe('0');
  expect(await page.locator('#start-type-core').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
  // as a press would show it
  await page.keyboard.press('Tab');
  expect(await focused(page)).toBe('start-type-flake');
  expect(await lit(page, '#start-type-flake')).toBe('1');
  expect(await lit(page, '#start-type-core')).toBe('0');
  expect(await page.locator('#start-type-flake').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  const lifted = await page.locator('#start-type-flake').evaluate((el) => getComputedStyle(el).transform);
  expect(lifted).toContain('-8');
  await page.locator('#start-type-generic').hover();
  expect(await lit(page, '#start-type-generic')).toBe('1');
  await expect.poll(() => page.locator('#start-type-generic').evaluate((el) => getComputedStyle(el).transform)).toBe(lifted);
  await page.mouse.move(5, 5);

  await page.keyboard.press('Enter');
  await expect(page.locator('#start-page')).toBeHidden();
  expect(await page.evaluate(() => window.lithicanalyst.module())).toBe('flake');

  await fileMenu(page, '#btn-close-model');
  await page.keyboard.press('Tab');
  expect(await focused(page)).toBe('start-type-generic');
  await page.keyboard.press('Space');
  await expect(page.locator('#start-page')).toBeHidden();
  expect(await page.evaluate(() => window.lithicanalyst.module())).toBe('generic');
});

test('the language and the theme are the top bar\'s own, and stay as they were set here', async ({ page }) => {
  await openStart(page);
  await expect(page.locator('#start-lang')).toHaveText('中');
  await expect(page.locator('#start-lang')).toHaveAttribute('aria-label', '切换到中文');
  await page.locator('#start-lang').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('.start-card-name')).toHaveText(['石核', '石片', '通用']);
  await expect(page.locator('.start-card').nth(2)).toHaveAttribute('aria-label', '通用');
  // the next language, named in itself
  await expect(page.locator('#start-lang')).toHaveText('IT');
  await expect(page.locator('#start-lang')).toHaveAttribute('aria-label', 'Passa all’italiano');
  // the same button, still in focus
  expect(await focused(page)).toBe('start-lang');

  const before = await page.evaluate(() => window.lithicanalyst.theme());
  await page.locator('#start-theme').click();
  const after = before === 'dark' ? 'light' : 'dark';
  await expect(page.locator('html')).toHaveAttribute('data-theme', after);
  await expect(page.locator('#start-theme')).toHaveAttribute('aria-label', after === 'dark' ? '浅色模式' : '深色模式');
  await expect(page.locator('#start-root, .start-root').first()).toHaveCSS('color', after === 'dark' ? 'rgb(230, 226, 214)' : 'rgb(31, 29, 25)');

  await enterModule(page, 'core');
  await expect(page.locator('#empty-open')).toHaveText('打开模型');
  await expect(page.locator('#btn-lang')).toHaveText('中');
  await expect(page.locator('#btn-theme')).toHaveAttribute('aria-label', after === 'dark' ? '浅色模式' : '深色模式');
  // and back from the top bar
  await page.locator('#btn-lang').click();
  await page.locator('#lang-en').click();
  await page.locator('#btn-theme').click();
  await fileMenu(page, '#btn-close-model');
  await expect(page.locator('.start-card-name')).toHaveText(['Core', 'Flake', 'General']);
  await expect(page.locator('html')).toHaveAttribute('data-theme', before);
  await expect(page.locator('#start-theme')).toHaveAttribute('aria-label', before === 'dark' ? 'Light appearance' : 'Dark appearance');
  // the Close item's text too
  await enterModule(page);
  await page.locator('#btn-file').click();
  await expect(page.locator('#btn-close-model')).toBeEnabled();
});

test('the language button goes round every language and back to English', async ({ page }) => {
  await openStart(page);
  const seen: Array<[string | null, string | null, string]> = [];
  for (let i = 0; i < 4; i++) {
    await page.locator('#start-lang').click();
    seen.push([await page.locator('html').getAttribute('lang'), await page.locator('#start-lang').textContent(), (await page.locator('.start-card-name').allTextContents()).join(' ')]);
  }
  expect(seen).toEqual([
    ['zh-CN', 'IT', '石核 石片 通用'],
    ['it', 'FR', 'Nucleo Scheggia Generico'],
    ['fr', 'EN', 'Nucléus Éclat Générique'],
    ['en', '中', 'Core Flake General'],
  ]);
});

test('a project file says what it is, whichever card is chosen; the choice stands for what comes next', async ({ page }) => {
  await openApp(page, 'flake');
  // a flake's project file of this model
  await loadMesh(page, boxPly(), '#empty-open');
  const file = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(file.specimen.type).toBe('flake');
  // (the browser's autosave stays out of it)
  await page.evaluate(() => localStorage.clear());
  await fileMenu(page, '#btn-close-model');
  await page.evaluate(() => localStorage.clear());

  await enterModule(page, 'generic');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#empty-open-project').click();
  await (await chooser).setFiles({ name: 'box.lithicanalyst.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('box.ply');
  const meshChooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Open the matching model' }).click();
  await (await meshChooser).setFiles(boxPly());
  await waitForMesh(page, 'box.ply');
  await expect.poll(async () => (await state(page)).specimen.type).toBe('flake');
  await expect(page.locator('#app-mode-retouch')).toBeVisible();
  await fileMenu(page, '#btn-close-model');
  expect(await focused(page)).toBe('start-type-generic');
});

test('a model dragged onto the start page opens as the last card chosen', async ({ page }) => {
  await openApp(page, 'generic');
  await fileMenu(page, '#btn-close-model');
  const ply = boxPly();
  await page.evaluate(
    ({ name, b64 }) => {
      const file = new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name);
      const data = new DataTransfer();
      data.items.add(file);
      window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: data, bubbles: true }));
    },
    { name: ply.name, b64: ply.buffer.toString('base64') },
  );
  // what shows it can be dropped is in front
  await expect(page.locator('#start-page .drop-overlay')).toBeVisible();
  await page.evaluate(
    ({ name, b64 }) => {
      const file = new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name);
      const data = new DataTransfer();
      data.items.add(file);
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
    },
    { name: ply.name, b64: ply.buffer.toString('base64') },
  );
  await waitForMesh(page, ply.name);
  expect((await state(page)).specimen.type).toBe('generic');
  await expect(page.locator('#viewport .drop-overlay')).toBeHidden();
  await expect(page.locator('#start-page')).toBeHidden();
  // closing goes back to it
  await fileMenu(page, '#btn-close-model');
  await expect(page.locator('#start-page')).toBeVisible();
});

test('the top bar has the logo and the wordmark, in every mode and either theme, and they take no clicks', async ({ page }) => {
  await openApp(page, 'flake');
  await expect(page.locator('.topbar .brand-logo')).toBeVisible();
  await expect(page.locator('.topbar .brand-wm')).toBeVisible();
  const logo = (await page.locator('.brand-logo').boundingBox())!;
  const word = (await page.locator('.brand-wm').boundingBox())!;
  expect([logo.width, logo.height]).toEqual([28, 28]);
  expect(word.x - (logo.x + logo.width)).toBeCloseTo(8, 0);
  // the wordmark at 18px to the em, centred with the logo
  expect(word.height).toBeCloseTo(18 * 0.949, 1);
  expect(word.y + word.height / 2).toBeCloseTo(logo.y + logo.height / 2, 0);
  // it is not a control
  expect(await page.locator('.brand').evaluate((el) => el.closest('a, button'))).toBeNull();
  expect(await page.locator('.brand-logo').evaluate((el) => getComputedStyle(el).cursor)).not.toBe('pointer');

  const ink = () => page.locator('.brand').evaluate((el) => getComputedStyle(el).color);
  const bar = () => page.locator('.topbar').evaluate((el) => getComputedStyle(el).backgroundColor);
  const first = await ink();
  await page.locator('#btn-theme').click();
  expect(await ink()).not.toBe(first);
  expect(await bar()).not.toBe(first);
  await expect(page.locator('.topbar .brand-wm')).toBeVisible();
  await page.locator('#btn-theme').click();

  await loadMesh(page, t1Ply(), '#empty-open');
  const gap = (await page.locator('#specimen-bar').boundingBox())!.x - ((await page.locator('.brand-wm').boundingBox())!.x + (await page.locator('.brand-wm').boundingBox())!.width);
  expect(gap).toBeCloseTo(12, 0);
  for (const mode of ['annotate', 'measure', 'retouch', 'present', 'compare'] as const) {
    await page.evaluate((m) => window.lithicanalyst.setMode(m), mode);
    await expect(page.locator('.topbar .brand-logo')).toBeVisible();
    await expect(page.locator('.topbar .brand-wm')).toBeVisible();
  }
  await page.evaluate(() => window.lithicanalyst.setMode('annotate'));

  // what the drawings refer to is there, for the logo of the start page as well, now it is hidden
  const dangling = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('svg *')]
        .flatMap((el) => [...el.attributes].map((a) => /url\(#([^)]+)\)/.exec(a.value)?.[1]))
        .filter((id): id is string => !!id && !document.getElementById(id)),
    );
  await expect(page.locator('#start-page')).toBeHidden();
  expect(await page.locator('#start-page .start-logo [stroke^="url(#"]').count()).toBeGreaterThan(0);
  expect(await dangling()).toEqual([]);
  // and no id is twice over
  const ids = await page.evaluate(() => [...document.querySelectorAll('svg [id]')].map((el) => el.id));
  expect(new Set(ids).size).toBe(ids.length);
  // the language rebuilds the top bar: nothing is left without its drawing
  await page.locator('#btn-lang').click();
  await page.locator('#lang-zh').click();
  await expect(page.locator('.topbar .brand-logo')).toBeVisible();
  expect(await dangling()).toEqual([]);
});

test('a narrow top bar drops the wordmark before the logo; a narrow start page has one column and scrolls', async ({ page }) => {
  await openApp(page, 'flake');
  await page.setViewportSize({ width: 480, height: 800 });
  await expect(page.locator('.brand-wm')).toBeHidden();
  await expect(page.locator('.brand-logo')).toBeVisible();
  const top = await page.locator('.topbar').evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(top).toBe(true);
  await page.setViewportSize({ width: 481, height: 800 });
  await expect(page.locator('.brand-wm')).toBeVisible();
  await expect.poll(() => page.locator('.topbar').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

  await fileMenu(page, '#btn-close-model');
  await page.setViewportSize({ width: 760, height: 500 });
  const logo = (await page.locator('.start-logo').boundingBox())!;
  expect([logo.width, logo.height]).toEqual([112, 112]);
  const cards = await page.locator('.start-card').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [r.left, r.top, r.width]));
  expect(cards[0][0]).toBe(cards[1][0]);
  expect(cards[1][1]).toBeGreaterThan(cards[0][1]);
  expect(cards[0][2]).toBeGreaterThan(600);
  // the last card can be scrolled to
  await page.locator('#start-type-generic').scrollIntoViewIfNeeded();
  const last = (await page.locator('#start-type-generic').boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(500);
  await page.locator('#start-type-generic').click();
  await expect(page.locator('#start-page')).toBeHidden();

  // a phone: nothing runs off the side
  await fileMenu(page, '#btn-close-model');
  await page.setViewportSize({ width: 375, height: 700 });
  const page_ = page.locator('#start-page');
  expect(await page_.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const wm = (await page.locator('.start-wm svg').boundingBox())!;
  expect(wm.x).toBeGreaterThanOrEqual(0);
  expect(wm.x + wm.width).toBeLessThanOrEqual(375);
});

test('with reduced motion all is where it ends from the first frame', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { firstFrame: Promise<unknown> }).firstFrame = new Promise((resolve) => {
      const look = () => {
        if (!document.querySelector('#start-page')) return requestAnimationFrame(look);
        resolve({
          // (the start page's own: the loading overlay has a logo of its own, looked at in look.spec.ts)
          opacity: [...document.querySelectorAll('#start-page :is(.st-in, .st-fade, .st-bgin, .st-wipe, .fx-c, .fx-l, .fx-r, .fx-m, .fx-p)')].map((el) => getComputedStyle(el).opacity),
          transform: [...document.querySelectorAll('#start-page :is(.st-in, .st-grow, .fx-c, .fx-l, .fx-r, .fx-m)')].map((el) => getComputedStyle(el).transform),
          animations: document.getAnimations().length,
        });
      };
      look();
    });
  });
  await page.goto(APP_URL);
  const first = await page.evaluate(() => (window as unknown as { firstFrame: Promise<{ opacity: string[]; transform: string[]; animations: number }> }).firstFrame);
  expect(first.opacity).toHaveLength(18);
  expect(new Set(first.opacity)).toEqual(new Set(['1']));
  expect(new Set(first.transform)).toEqual(new Set(['none']));
  expect(first.animations).toBe(0);
  // a press is there at once, with nothing moving
  await page.locator('#start-type-generic').hover();
  expect(await lit(page, '#start-type-generic')).toBe('1');
  expect(await page.locator('#start-type-generic .wire').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  expect(await page.locator('#start-type-generic .lmk').first().evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('nothing is asked of the network, on the start page or in the workspace; the icon is in the file', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r: Request) => {
    if (!/^(file|data|blob):/.test(r.url())) asked.push(r.url());
  });
  await openStart(page);
  await page.locator('#start-theme').click();
  await page.locator('#start-type-core').hover();
  await enterModule(page, 'core');
  await loadMesh(page, boxPly(), '#empty-open');
  await fileMenu(page, '#btn-close-model');
  expect(asked).toEqual([]);
  // nothing in the file points out of it (the namespace is a name)
  const icon = await page.locator('link[rel="icon"]').getAttribute('href');
  expect(icon).toMatch(/^data:image\/svg\+xml,/);
  const drawn = decodeURIComponent(icon!.slice('data:image/svg+xml,'.length));
  expect(drawn).toContain('#1f1d19');
  expect(drawn).not.toContain('currentColor');
  expect(await page.locator('link[href^="http"], script[src^="http"], img[src^="http"]').count()).toBe(0);
});

test.describe('in motion', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test('the entrance plays when the app opens, and not again', async ({ page }) => {
    await openStart(page);
    expect(await entrance(page)).toBeGreaterThan(20);
    // the logo comes together: its top first, then the mesh row by row, then the points
    const delays = await page.evaluate(() =>
      ['.fx-c', '.fx-l', '.fx-r', '.fx-m', '.fx-p'].map((s) => [...document.querySelectorAll('.start-logo ' + s)].map((el) => parseFloat(getComputedStyle(el).animationDelay))),
    );
    expect(delays[0]).toEqual([0.15]);
    expect(delays[1]).toEqual([0.27]);
    expect(delays[2]).toEqual([0.27]);
    expect(delays[3]).toEqual([0.62, 0.72, 0.82, 0.92, 1.02]);
    expect(delays[4]).toEqual([1, 1.1, 1.2]);
    await expect.poll(() => entrance(page), { timeout: 15_000 }).toBe(0);
    // the rings go on turning
    expect(await page.evaluate(() => document.getAnimations().filter((a) => (a as CSSAnimation).animationName === 'st-spin').length)).toBe(2);

    await enterModule(page, 'core');
    await page.locator('#btn-file').click();
    await page.locator('#btn-close-model').click();
    await expect(page.locator('#start-page')).toBeVisible();
    expect(await entrance(page)).toBe(0);
    expect(await page.locator('.start-logo .fx-c').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    expect(await page.locator('.start-card-wrap').first().evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  });

  test('a press plays the card\'s animation: the needles grow in turn, the globe turns', async ({ page }) => {
    await openStart(page);
    await expect.poll(() => entrance(page), { timeout: 15_000 }).toBe(0);
    await page.locator('#start-type-core').hover();
    const core = page.locator('#start-type-core');
    await expect.poll(() => core.locator('.ndl').last().evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    await expect.poll(() => core.locator('.pc').evaluate((el) => getComputedStyle(el).fillOpacity)).toBe('0.14');
    await expect.poll(() => core.locator('.start-stripe').evaluate((el) => getComputedStyle(el).height)).toBe('7px');
    await expect.poll(() => core.locator('.start-enter').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    // the amber one is the last
    const delays = await core.locator('.ndl').evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).getPropertyValue('--d'))));
    expect(delays[delays.length - 1]).toBe(Math.max(...delays));
    expect(await core.locator('.ndl').last().getAttribute('fill')).toBe('#b8730f');

    await page.locator('#start-type-generic').hover();
    const globe = page.locator('#start-type-generic');
    await expect.poll(() => globe.locator('.solid').evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
    await expect.poll(() => globe.locator('.wire').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await expect.poll(() => globe.locator('.lmk').last().evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    expect(await page.evaluate(() => document.getAnimations().filter((a) => (a as CSSAnimation).animationName === 'st-mer').length)).toBe(2);
  });

  test('pictures for comparing with the reference', async ({ page }) => {
    await mkdir(SHOTS, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: 'light' });
    await openStart(page);
    await expect.poll(() => entrance(page), { timeout: 15_000 }).toBe(0);
    await page.mouse.move(5, 5);
    await page.screenshot({ path: `${SHOTS}/start-light.png` });
    // the same layout as the reference's
    const r = (s: string) => page.locator(s).first().boundingBox();
    expect(await r('.start-wm')).toMatchObject({ x: expect.closeTo(537.5, 0), width: expect.closeTo(583, 0) });
    expect(await r('.start-logo')).toMatchObject({ x: expect.closeTo(319.5, 0), y: 199, width: 188, height: 188 });
    expect(await r('.start-cards')).toMatchObject({ x: 160, y: 479, width: 1120 });
    expect(await r('.start-card')).toMatchObject({ x: 160, y: 479, width: 356, height: 234 });
    expect(await r('.start-ghost')).toMatchObject({ x: 177, width: expect.closeTo(271.8, 0), height: expect.closeTo(94.4, 0) });

    await page.locator('#start-type-core').hover();
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${SHOTS}/start-hover-core.png` });
    await page.locator('#start-type-flake').hover();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/start-hover-flake.png` });
    await page.locator('#start-type-generic').hover();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/start-hover-generic.png` });
    await page.mouse.move(5, 5);

    await page.locator('#start-theme').click();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/start-dark.png` });

    await page.setViewportSize({ width: 760, height: 1200 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/start-narrow-dark.png` });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('#start-lang').click();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/start-zh-dark.png` });
    await page.locator('#start-theme').click();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/start-zh.png` });
    await page.locator('#start-theme').click();
    await enterModule(page, 'flake');
    await page.mouse.move(5, 5);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/workspace-empty-dark.png` });
    await page.locator('#btn-theme').click();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/workspace-empty.png` });
    await page.screenshot({ path: `${SHOTS}/workspace-topbar.png`, clip: { x: 0, y: 0, width: 720, height: 52 } });
    await loadMesh(page, t1Ply(), '#empty-open');
    await page.mouse.move(5, 5);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/workspace-topbar-model.png`, clip: { x: 0, y: 0, width: 720, height: 52 } });
  });
});

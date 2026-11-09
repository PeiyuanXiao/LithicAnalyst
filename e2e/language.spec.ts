import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { Lang } from '../src/ui/i18n';
import { roofPly, roofPoint, t1Ply } from './fixtures/meshes';
import { annotate } from './flakeSetup';
import { dragArrow, expect, exportFile, loadMesh, nextFrames, openApp, test, viewFromTop, enterModule } from './helpers';

/** Choose a language in the language menu of the top bar. */
async function chooseLang(page: Page, code: Lang): Promise<void> {
  await page.locator('#btn-lang').click();
  await expect(page.locator(`#lang-${code}`)).toBeVisible();
  await page.locator(`#lang-${code}`).click();
}

test.describe('in a Chinese browser', () => {
  test.use({ locale: 'zh-CN' });

  test('starts in English, switches to Chinese and back from the menu, and keeps the choice', async ({ page }) => {
    // a new profile: English, whatever the browser's language
    await openApp(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#empty-open')).toHaveText('Open model');
    await expect(page.locator('#btn-lang')).toHaveText('EN');

    await loadMesh(page, roofPly());
    await viewFromTop(page);
    await page.keyboard.press('a');
    await dragArrow(page, roofPoint(-14, 10), roofPoint(-8, 22));
    await page.keyboard.press('5');
    const enCsv = await exportFile(page, 'scar-vectors');

    // the menu names each language in itself and checks the current one
    await page.locator('#btn-lang').click();
    await expect(page.locator('#lang-menu .menu-item')).toHaveText(['English', '中文', 'Deutsch', 'Español', 'Français', 'Italiano', 'Tiếng Việt']);
    await expect(page.locator('#lang-en')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#lang-zh')).toHaveAttribute('aria-checked', 'false');
    await page.locator('#lang-zh').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('#btn-lang')).toHaveText('中');
    await expect(page.locator('#sec-arrows .panel-title')).toHaveText('片疤箭头');
    await expect(page.locator('#mode-draw')).toContainText('画箭头');
    await expect(page.locator('#mode-draw')).toHaveAttribute('aria-label', '画箭头 (A)');
    // the selection and its inspector survive the switch
    await expect(page.locator('#insp-label')).toHaveValue('S1');
    await expect(page.locator('#field-completeness-bulb_truncated')).toContainText('可见负向打击泡+尾端缺失');
    await expect(page.locator('#field-completeness-bulb_truncated')).toHaveAttribute('aria-checked', 'true');

    // exported codes do not depend on the interface language
    const zhCsv = await exportFile(page, 'scar-vectors');
    expect(zhCsv.text).toBe(enCsv.text);
    expect(zhCsv.text).toMatch(/,bulb_truncated,na,certain,,[a-z]*,F?\d*,mm/);
    // nor in Vietnamese
    await chooseLang(page, 'vi');
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
    const viCsv = await exportFile(page, 'scar-vectors');
    expect(viCsv.text).toBe(enCsv.text);
    await chooseLang(page, 'zh');

    // the choice is kept
    await page.reload();
    await page.waitForFunction(() => !!window.lithicanalyst);
    await enterModule(page);
    await expect(page.locator('#empty-open')).toHaveText('打开模型');
    await chooseLang(page, 'en');
    await expect(page.locator('#empty-open')).toHaveText('Open model');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.reload();
    await page.waitForFunction(() => !!window.lithicanalyst);
    await enterModule(page);
    await expect(page.locator('#btn-lang')).toHaveText('EN');
  });
});

test('German, Spanish, French, Italian and Vietnamese: the top bar stays in the window, and the labels in the view change with the rest', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openApp(page, 'flake');
  await loadMesh(page, t1Ply());
  await annotate(page);
  const axisLabel = page.locator('.arrow-label').filter({ hasText: /axis|asse|axe|Achse|Eje|Trục/i });
  /** Whether the top bar fits, its last button inside the window, and the modes' names shown. */
  const bar = async () => {
    await nextFrames(page, 3);
    return page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.topbar')!;
      const label = document.querySelector<HTMLElement>('#app-mode-annotate .mode-label')!;
      return {
        fits: el.scrollWidth <= el.clientWidth + 1 && document.querySelector('#btn-help')!.getBoundingClientRect().right <= window.innerWidth,
        names: getComputedStyle(label).display !== 'none',
      };
    });
  };
  for (const [code, lang, axis, mode] of [
    ['en', 'en', 'Technological axis', 'Annotate'],
    ['de', 'de', 'Technologische Achse', 'Annotieren'],
    ['es', 'es', 'Eje tecnológico', 'Anotar'],
    ['fr', 'fr', 'Axe technologique', 'Annotation'],
    ['it', 'it', 'Asse tecnologico', 'Annotazione'],
    ['vi', 'vi', 'Trục kỹ thuật', 'Chú thích'],
  ] as const) {
    if (code !== 'en') await chooseLang(page, code);
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.locator('#app-mode-annotate')).toHaveAttribute('aria-label', mode);
    // the view's own labels follow at once
    await expect(axisLabel).toHaveText(axis);
    // room enough: every name shown
    expect(await bar(), code).toEqual({ fits: true, names: true });
  }
  // less room (in French, the longest): the modes' names go before anything leaves the window, and come back with the room
  await chooseLang(page, 'fr');
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await bar()).toEqual({ fits: true, names: false });
  await page.setViewportSize({ width: 1000, height: 800 });
  expect((await bar()).fits).toBe(true);
  await page.setViewportSize({ width: 1600, height: 900 });
  expect(await bar()).toEqual({ fits: true, names: true });
  await chooseLang(page, 'en');
  await expect(axisLabel).toHaveText('Technological axis');
});

test('starts in English in a new browser profile', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(await page.evaluate(() => localStorage.getItem('lithicanalyst:lang'))).toBeNull();
  await expect(page.locator('#empty-open')).toHaveText('Open model');
  await expect(page.locator('#btn-lang')).toHaveText('EN');
});

test('Vietnamese letters are drawn in IBM Plex, in every family and weight the interface uses', async ({ page }) => {
  // the faces of src/fonts.css, each family with each of its weights
  const css = readFileSync(new URL('../src/fonts.css', import.meta.url), 'utf8');
  const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map(([, body]) => `${/font-weight:\s*(\d+)/.exec(body)![1]} 16px "${/font-family:\s*"([^"]+)"/.exec(body)![1]}"`);
  const fonts = [...new Set(faces)];
  expect(fonts).toHaveLength(8);
  await openApp(page);
  await chooseLang(page, 'vi');
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  const found = await page.evaluate(
    (list) =>
      Promise.all(
        list.map(async (font) => {
          const loaded = await document.fonts.load(font, 'ơư ạỹ');
          return { font, faces: loaded.length, vietnamese: loaded.some((f) => f.unicodeRange.toLowerCase().includes('1ea0-1ef9')) };
        }),
      ),
    fonts,
  );
  // (before the Vietnamese subsets: only the Latin face, for the space)
  expect(found.filter((f) => f.faces < 1 || !f.vietnamese)).toEqual([]);
});

import type { Page } from '@playwright/test';
import { roofPly, roofPoint, t1Ply } from './fixtures/meshes';
import { annotate } from './flakeSetup';
import { dragArrow, expect, exportFile, loadMesh, nextFrames, openApp, test, viewFromTop, enterModule } from './helpers';

/** Choose a language in the language menu of the top bar. */
async function chooseLang(page: Page, code: 'en' | 'zh' | 'it' | 'fr'): Promise<void> {
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
    await expect(page.locator('#lang-menu .menu-item')).toHaveText(['English', '中文', 'Italiano', 'Français']);
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

test('Italian and French: the top bar stays in the window, and the labels in the view change with the rest', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openApp(page, 'flake');
  await loadMesh(page, t1Ply());
  await annotate(page);
  const axisLabel = page.locator('.arrow-label').filter({ hasText: /axis|asse|axe/i });
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
    ['it', 'it', 'Asse tecnologico', 'Annotazione'],
    ['fr', 'fr', 'Axe technologique', 'Annotation'],
  ] as const) {
    if (code !== 'en') await chooseLang(page, code);
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.locator('#app-mode-annotate')).toHaveAttribute('aria-label', mode);
    // the view's own labels follow at once
    await expect(axisLabel).toHaveText(axis);
    // room enough: every name shown
    expect(await bar(), code).toEqual({ fits: true, names: true });
  }
  // less room: the modes' names go before anything leaves the window, and come back with the room
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

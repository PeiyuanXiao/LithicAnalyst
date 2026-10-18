import { roofPly, roofPoint } from './fixtures/meshes';
import { dragArrow, expect, exportFile, loadMesh, openApp, test, viewFromTop } from './helpers';

test.describe('in a Chinese browser', () => {
  test.use({ locale: 'zh-CN' });

  test('starts in Chinese, switches to English and back, and keeps the choice', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('#btn-open')).toHaveText('打开模型');
    await expect(page.locator('#btn-lang')).toHaveText('English');

    await loadMesh(page, roofPly());
    await viewFromTop(page);
    await page.keyboard.press('a');
    await dragArrow(page, roofPoint(-14, 10), roofPoint(-8, 22));
    await page.keyboard.press('4');
    await expect(page.locator('#sec-arrows .panel-title')).toHaveText('片疤箭头');
    await expect(page.locator('#mode-draw')).toContainText('画箭头');
    await expect(page.locator('#field-completeness-bulb_truncated')).toContainText('可见负向打击泡+尾端缺失');
    const zhCsv = await exportFile(page, 'scar-vectors');

    await page.locator('#btn-lang').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#btn-open')).toHaveText('Open model');
    await expect(page.locator('#btn-lang')).toHaveText('中文');
    await expect(page.locator('#sec-arrows .panel-title')).toHaveText('Scar vectors');
    await expect(page.locator('#mode-draw')).toContainText('Draw arrow');
    // the selection and its inspector survive the switch
    await expect(page.locator('#insp-label')).toHaveValue('S1');
    await expect(page.locator('#field-completeness-bulb_truncated')).toContainText('Negative bulb, termination missing');
    await expect(page.locator('#field-completeness-bulb_truncated')).toHaveAttribute('aria-checked', 'true');

    // exported codes do not depend on the interface language
    const enCsv = await exportFile(page, 'scar-vectors');
    expect(enCsv.text).toBe(zhCsv.text);
    expect(enCsv.text).toContain(',bulb_truncated,certain,,mm');

    await page.reload();
    await page.waitForFunction(() => !!window.lithicanalyst);
    await expect(page.locator('#btn-open')).toHaveText('Open model');
    await page.locator('#btn-lang').click();
    await expect(page.locator('#btn-open')).toHaveText('打开模型');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  });
});

test('starts in English in an English browser', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#btn-open')).toHaveText('Open model');
  await expect(page.locator('#btn-lang')).toHaveText('中文');
});

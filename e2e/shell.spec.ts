import type { Page } from '@playwright/test';
import { boxPly, boxPoint } from './fixtures/meshes';
import { dragArrow, expect, loadMesh, openApp, test, viewFromTop } from './helpers';

/** Brightness (0–255) of pixels of an element's screenshot (`fx`: fraction of the width; `y` < 0 counts from the bottom). */
async function brightness(page: Page, selector: string, points: Array<{ fx: number; y: number }>): Promise<number[]> {
  const png = (await page.locator(selector).screenshot()).toString('base64');
  return page.evaluate(
    async ({ png, points }) => {
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const g = c.getContext('2d')!;
      g.drawImage(bmp, 0, 0);
      return points.map(({ fx, y }) => {
        const d = g.getImageData(Math.round(fx * bmp.width), y < 0 ? bmp.height + y : y, 1, 1).data;
        return 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2];
      });
    },
    { png, points },
  );
}

/** Alpha of the top-left pixel of a PNG (base64). */
async function cornerAlpha(page: Page, b64: string): Promise<number> {
  return page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0);
    return g.getImageData(0, 0, 1, 1).data[3];
  }, b64);
}

/** Add another observer's project file in the compare mode. */
async function addObserver(page: Page, file: object): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#compare-add').click();
  await (await chooser).setFiles([{ name: 'bo.lithicanalyst.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) }]);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.agreement())).not.toBeNull();
}

test.describe('on a system in dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('follows the system at first, then the switch, and keeps the choice', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => localStorage.getItem('lithicanalyst:theme'))).toBeNull();
    // dark: the switch offers the light appearance
    await expect(page.locator('#btn-theme')).toHaveAttribute('aria-label', 'Light appearance');

    await page.locator('#btn-theme').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('#btn-theme')).toHaveAttribute('aria-label', 'Dark appearance');
    expect(await page.evaluate(() => localStorage.getItem('lithicanalyst:theme'))).toBe('light');

    await page.reload();
    await page.waitForFunction(() => !!window.lithicanalyst);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => window.lithicanalyst.theme())).toBe('light');
  });
});

test('paints the view darker at the top in both themes; figures keep a transparent background', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, boxPly());
  for (const theme of ['light', 'dark'] as const) {
    if ((await page.evaluate(() => window.lithicanalyst.theme())) !== theme) await page.locator('#btn-theme').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // the middle of the top and bottom edges: background only (the model is framed inside)
    const [top, bottom] = await brightness(page, '#viewport', [
      { fx: 0.5, y: 3 },
      { fx: 0.5, y: -3 },
    ]);
    expect(top, theme).toBeLessThan(bottom);
    // a neutral grey, a few per cent apart
    expect(bottom - top, theme).toBeGreaterThan(4);
    expect(bottom - top, theme).toBeLessThan(25);

    // the figure is rendered apart, on a transparent background as before
    const fig = (await page.evaluate(() => window.lithicanalyst.figure('png')))!;
    expect(await cornerAlpha(page, fig.data), theme).toBe(0);
  }
});

test('shows the shortcuts in two columns without scrolling at 1440 × 900', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await page.locator('#btn-help').click();
  await page.locator('#help-tab-shortcuts').click();
  await expect(page.getByRole('dialog')).toContainText('Switch mode');
  const layout = await page.evaluate(() => {
    const body = document.querySelector('.modal-body') as HTMLElement;
    const cols = [...document.querySelectorAll('.help-col')].map((c) => c.getBoundingClientRect());
    return { scroll: body.scrollHeight, client: body.clientHeight, cols: cols.map((r) => ({ x: r.left, y: r.top })) };
  });
  expect(layout.scroll).toBeLessThanOrEqual(layout.client);
  expect(layout.cols).toHaveLength(2);
  expect(layout.cols[1].x).toBeGreaterThan(layout.cols[0].x + 100);
  expect(layout.cols[1].y).toBeCloseTo(layout.cols[0].y, 0);
  // "hold" goes with the key; the mouse column has no key caps
  await expect(page.locator('.help-col').first()).toContainText('Hold');
  await expect(page.locator('.help-mouse kbd')).toHaveCount(0);
});

test('keeps the top bar on one line and the resolution buttons on one row at 1024 × 768', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openApp(page);
  await loadMesh(page, boxPly());
  const bar = (await page.locator('.topbar').boundingBox())!;
  expect(bar.height).toBeLessThanOrEqual(64);
  // the modes show icons only, their names in tooltips
  await expect(page.locator('#app-mode-annotate .mode-label')).toBeHidden();
  await page.locator('#app-mode-measure').hover();
  await expect(page.locator('.tip')).toContainText('Measure');
  await expect(page.locator('.tip kbd')).toHaveText('M');

  await page.locator('#app-mode-present').click();
  const dpi = await page.evaluate(() =>
    ['300', '600', '1200'].map((d) => {
      const b = document.getElementById(`fig-dpi-${d}`) as HTMLElement;
      return { top: b.offsetTop, wraps: b.scrollWidth > b.clientWidth || b.clientHeight > 32 };
    }),
  );
  expect(new Set(dpi.map((d) => d.top)).size).toBe(1);
  expect(dpi.some((d) => d.wraps)).toBe(false);
});

test('compares only what the observers drew: no curve group without curves', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, boxPly());
  await viewFromTop(page);
  await page.keyboard.press('a');
  await dragArrow(page, boxPoint(-5, 0, 5), boxPoint(5, 2, 5));
  const other = await page.evaluate(() => window.lithicanalyst.projectJson());
  other.specimen.annotator = 'Bo';
  await page.locator('#app-mode-compare').click();
  await addObserver(page, other);
  await expect(page.locator('#agreement-table tbody[data-group="arrow"]')).toHaveCount(1);
  await expect(page.locator('#agreement-table tbody[data-group="curve"]')).toHaveCount(0);
  await expect(page.locator('#agreement-empty')).toBeHidden();
});

test('with nothing drawn, only the measurements are compared', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, boxPly());
  const other = await page.evaluate(() => window.lithicanalyst.projectJson());
  other.specimen.annotator = 'Bo';
  await page.locator('#app-mode-compare').click();
  await addObserver(page, other);
  // length, width and thickness are always there; no arrow or curve group with "0 / 0"
  await expect(page.locator('#agreement-table tbody')).toHaveCount(1);
  await expect(page.locator('#agreement-table tbody')).toHaveAttribute('data-group', 'measurement');
  await expect(page.locator('#agreement-empty')).toBeHidden();
});

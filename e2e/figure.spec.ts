import type { Page } from '@playwright/test';
import { pngDpi } from '../src/io/png';
import { boxPly, boxPoint } from './fixtures/meshes';
import { download, dragArrow, expect, loadMesh, nextFrames, openApp, test } from './helpers';

/** Decode a PNG in the page: size, and the alpha and darkness along one row. */
async function scanRow(page: Page, b64: string, y: number) {
  return page.evaluate(
    async ({ b64, y }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const g = c.getContext('2d')!;
      g.drawImage(bmp, 0, 0);
      const row = g.getImageData(0, Math.round(y), bmp.width, 1).data;
      const alpha: number[] = [];
      const dark: boolean[] = [];
      for (let x = 0; x < bmp.width; x++) {
        alpha.push(row[4 * x + 3]);
        dark.push(row[4 * x + 3] > 128 && row[4 * x] < 80 && row[4 * x + 1] < 80 && row[4 * x + 2] < 80);
      }
      return { width: bmp.width, height: bmp.height, alpha, dark, corner: g.getImageData(0, 0, 1, 1).data[3] };
    },
    { b64, y },
  );
}

const runOf = (flags: boolean[], from: number): number => {
  let x = from;
  while (x < flags.length && !flags[x]) x++;
  const start = x;
  while (x < flags.length && flags[x]) x++;
  return x - start;
};

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await loadMesh(page, boxPly());
  await page.evaluate(() => window.lithicanalyst.view([0, 0, 1], [0, 1, 0]));
  await nextFrames(page);
  await page.keyboard.press('a');
  await dragArrow(page, boxPoint(-15, -5, 5), boxPoint(-2, 4, 5));
  await page.keyboard.press('m');
  await page.keyboard.press('m');
  await page.evaluate(() => window.lithicanalyst.view([0, 0, 1], [0, 1, 0]));
  await page.locator('#frame-from-view').click();
});

test('exports a PNG at the stated physical scale with a transparent background and a true scale bar', async ({ page }) => {
  await page.locator('#fig-view-top').check();
  await page.locator('#fig-dpi-300').click();
  await page.locator('#fig-scale-1').click();
  const px = 300 / 25.4; // pixels per mm at 1:1
  await expect(page.locator('#fig-size')).toContainText(' mm · ');

  const fig = (await page.evaluate(() => window.lithicanalyst.figure('png')))!;
  const { layout } = fig;
  expect(layout.pxPerUnit).toBeCloseTo(px, 6);
  const front = layout.views.find((v) => v.view === 'front')!;
  const top = layout.views.find((v) => v.view === 'top')!;
  // the box is 40 × 20 × 10 mm: front view 40 × 20, the view from above (placed below) 40 × 10
  expect(front.width).toBeCloseTo(40 * px, -0.5);
  expect(front.height).toBeCloseTo(20 * px, -0.5);
  expect(top.height).toBeCloseTo(10 * px, -0.5);
  expect(top.y).toBeGreaterThan(front.y + front.height);
  expect(top.x).toBe(front.x);

  const bytes = Buffer.from(fig.data, 'base64');
  expect(pngDpi(bytes)).toBeCloseTo(300, 0);
  const mid = await scanRow(page, fig.data, front.y + front.height * 0.75);
  expect([mid.width, mid.height]).toEqual([layout.width, layout.height]);
  expect(mid.corner).toBe(0);
  // across the front view the model covers 40 mm of the row (the view from the left, 10 mm, sits to its right)
  const inFront = mid.alpha.slice(front.x - 5, front.x + front.width + 5).filter((a) => a > 128).length;
  expect(Math.abs(inFront - 40 * px)).toBeLessThan(3);
  expect(Math.abs(mid.alpha.filter((a) => a > 128).length - 50 * px)).toBeLessThan(5);
  // the scale bar is as long as it says, in pixels
  const bar = layout.scaleBar!;
  const scan = await scanRow(page, fig.data, bar.y);
  expect(Math.abs(runOf(scan.dark, Math.floor(bar.x0) - 2) - bar.length * px)).toBeLessThan(3);

  // 2:1 at 600 dpi doubles and doubles again
  await page.locator('#fig-scale-2').click();
  await page.locator('#fig-dpi-600').click();
  const big = (await page.evaluate(() => window.lithicanalyst.figure('png')))!;
  expect(big.layout.views[0].width).toBeCloseTo(40 * 2 * (600 / 25.4), -0.5);

  const file = await download(page, () => page.locator('#fig-png').click());
  expect(file.name).toBe('box_figure.png');
});

test('exports an SVG in millimetres with the shading as images and the rest as vectors', async ({ page }) => {
  for (const v of ['back', 'left', 'right', 'top', 'bottom']) await page.locator(`#fig-view-${v}`).check();
  await page.locator('#fig-dpi-300').click();
  const fig = (await page.evaluate(() => window.lithicanalyst.figure('svg')))!;
  const info = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    return {
      error: doc.getElementsByTagName('parsererror').length,
      name: root.nodeName,
      width: root.getAttribute('width'),
      viewBox: root.getAttribute('viewBox'),
      images: root.querySelectorAll('image').length,
      outlines: root.querySelectorAll('g.outline path').length,
      arrows: root.querySelectorAll('g.arrows polygon').length,
      groups: Array.from(root.querySelectorAll('g[id^="view-"]'), (g) => g.id),
      bar: root.querySelectorAll('#scale-bar path').length,
    };
  }, fig.data);
  expect(info.error).toBe(0);
  expect(info.name).toBe('svg');
  expect(info.width).toBe(`${Math.round(fig.layout.width * fig.layout.mmPerPx! * 100) / 100}mm`);
  expect(info.images).toBe(6);
  expect(info.outlines).toBeGreaterThanOrEqual(6);
  // the arrow lies on the face seen from the front: drawn there only
  expect(info.arrows).toBe(1);
  expect(info.groups).toEqual(['view-front', 'view-back', 'view-left', 'view-right', 'view-top', 'view-bottom']);
  expect(info.bar).toBe(1);
  // first-angle layout: left view right of the front, right view left of it, back at the far right, top below, bottom above
  const at = Object.fromEntries(fig.layout.views.map((v) => [v.view, v]));
  expect(at.left.x).toBeGreaterThan(at.front.x);
  expect(at.right.x).toBeLessThan(at.front.x);
  expect(at.back.x).toBeGreaterThan(at.left.x);
  expect(at.top.y).toBeGreaterThan(at.front.y);
  expect(at.bottom.y).toBeLessThan(at.front.y);

  // a browser draws it as an image
  const drawn = await page.evaluate(async (text) => {
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    await img.decode();
    return img.naturalWidth;
  }, fig.data);
  expect(drawn).toBeGreaterThan(0);

  const file = await download(page, () => page.locator('#fig-svg').click());
  expect(file.name).toBe('box_figure.svg');
  expect(file.text.startsWith('<?xml')).toBe(true);
});

test('has no physical scale when the unit is not stated', async ({ page }) => {
  await page.locator('#specimen-unit').selectOption('');
  await expect(page.locator('#fig-scalebar')).toBeDisabled();
  await expect(page.locator('#fig-scale-1')).toBeDisabled();
  const fig = (await page.evaluate(() => window.lithicanalyst.figure('png')))!;
  expect(fig.layout.mmPerPx).toBeNull();
  expect(fig.layout.scaleBar).toBeNull();
  expect(pngDpi(Buffer.from(fig.data, 'base64'))).toBeNull();
  const svg = (await page.evaluate(() => window.lithicanalyst.figure('svg')))!;
  expect(svg.data).not.toContain('mm"');
});

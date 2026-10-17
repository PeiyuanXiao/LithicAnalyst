import type { Page } from '@playwright/test';
import { BOX, boxPly, boxPoint } from './fixtures/meshes';
import { download, expect, loadMesh, nextFrames, openApp, state, test, toScreen } from './helpers';

/** Drag a line across the box (seen from above) along y = const. */
async function drawSection(page: Page, y: number): Promise<void> {
  const before = (await state(page)).sections.length;
  const a = await toScreen(page, boxPoint(-24, y, 5));
  const b = await toScreen(page, boxPoint(24, y, 5));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).sections.length).toBe(before + 1);
}

test('draws a section across the model, cuts it open, and exports the section drawing', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, boxPly());
  await page.keyboard.press('m');
  await page.keyboard.press('m');
  await page.evaluate(() => window.lithicanalyst.view([0, 0, 1], [0, 1, 0]));
  await nextFrames(page);
  await page.locator('#frame-from-view').click();
  await page.locator('#present-tool-section').click();
  await drawSection(page, 0);

  let sec = (await state(page)).sections[0];
  expect(sec).toMatchObject({ label: 'X1', keep: 'both', fill: 'hatch', inFigure: true });
  // the plane through the line and the view direction: y = 0, its normal pointing up the screen (+y)
  expect(sec.normal[1]).toBeCloseTo(1, 3);
  expect(sec.point[1]).toBeCloseTo(BOX.center[1], 1);
  await expect(page.locator('#section-list .section-row')).toHaveCount(1);
  expect(await page.evaluate(() => window.lithicanalyst.clipping())).toBe(0);

  // keep one side: the model is cut open in the present mode only
  await page.locator('#section-keep-front').click();
  expect(await page.evaluate(() => window.lithicanalyst.clipping())).toBe(1);
  await page.keyboard.press('m');
  expect(await page.evaluate(() => window.lithicanalyst.clipping())).toBe(0);
  await page.keyboard.press('m');
  await page.keyboard.press('m');
  expect(await page.evaluate(() => window.lithicanalyst.clipping())).toBe(1);

  // the section drawing alone: the box's cross-section, 40 × 10 mm, hatched, with a scale bar
  await page.locator('#fig-dpi-300').click();
  await page.locator('#fig-scale-1').click();
  const px = 300 / 25.4;
  sec = (await state(page)).sections[0];
  await expect.poll(() => page.evaluate((id) => window.lithicanalyst.sectionFigure(id, 'svg').then((f) => f?.layout.sections.length ?? 0), sec.id)).toBe(1);
  const only = (await page.evaluate((id) => window.lithicanalyst.sectionFigure(id, 'svg'), sec.id))!;
  expect(only.layout.views).toHaveLength(0);
  expect(only.layout.sections[0].width).toBeCloseTo(40 * px, -0.5);
  expect(only.layout.sections[0].height).toBeCloseTo(10 * px, -0.5);
  expect(only.data).toContain('id="section-X1"');
  expect(only.data).toContain('fill="url(#hatch)"');
  expect(only.data).toContain('id="scale-bar"');
  const file = await download(page, () => page.locator('#section-svg').click());
  expect(file.name).toBe('box_section_X1.svg');

  // in the figure, to the right of the views
  const fig = (await page.evaluate(() => window.lithicanalyst.figure('svg')))!;
  const right = Math.max(...fig.layout.views.map((v) => v.x + v.width));
  expect(fig.layout.sections).toHaveLength(1);
  expect(fig.layout.sections[0].x).toBeGreaterThan(right);
  await page.locator('#section-in-figure').uncheck();
  expect((await page.evaluate(() => window.lithicanalyst.figure('svg')))!.layout.sections).toHaveLength(0);

  // solid fill; a second section; delete and undo; saved with the project
  await page.locator('#section-fill-solid').click();
  expect((await state(page)).sections[0].fill).toBe('solid');
  // switching modes went back to the select tool
  await page.keyboard.press('x');
  await drawSection(page, 5);
  await expect(page.locator('#section-list .section-row')).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(page.locator('#section-list .section-row')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#section-list .section-row')).toHaveCount(2);
  const saved = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(saved.annotations.sections.map((s) => s.label)).toEqual(['X1', 'X2']);
});

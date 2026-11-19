import type { Page } from '@playwright/test';
import { BOX, boxPly, boxPoint } from './fixtures/meshes';
import { download, expect, loadMesh, nextFrames, openApp, openSection, state, test, toScreen } from './helpers';

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
  await page.keyboard.press('m');
  expect(await page.evaluate(() => window.lithicanalyst.clipping())).toBe(1);

  // the section drawing alone: the box's cross-section, 40 × 10 mm, hatched, with a scale bar
  await openSection(page, 'figure');
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

/** The section marks of the figure's SVG: the dashed lines and end labels in a view, the labels over the drawings. */
async function marks(page: Page) {
  const fig = (await page.evaluate(() => window.lithicanalyst.figure('svg')))!;
  const front = fig.layout.views.find((v) => v.view === 'front')!;
  const seen = await page.evaluate((text) => {
    const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
    const inView = (id: string) => {
      const g = root.querySelector(`#view-${id}`)!;
      return {
        dashes: Array.from(g.querySelectorAll('polyline.section'), (p) => p.getAttribute('stroke-dasharray')),
        ys: Array.from(g.querySelectorAll('polyline.section'), (p) => (p.getAttribute('points') ?? '').split(' ').map((q) => Number(q.split(',')[1]))).flat(),
        ends: Array.from(g.querySelectorAll('g.section-labels text'), (t) => ({ text: t.textContent, x: Number(t.getAttribute('x')) })),
      };
    };
    return { front: inView('front'), left: inView('left'), titles: Array.from(root.querySelectorAll('#section-titles text'), (t) => t.textContent) };
  }, fig.data);
  return { ...seen, layout: fig.layout, frontView: front };
}

test('marks a section where it cuts the model on the figure’s views, labelled at both ends, and labels its drawing', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, boxPly());
  await page.keyboard.press('m');
  await page.keyboard.press('m');
  await page.evaluate(() => window.lithicanalyst.view([0, 0, 1], [0, 1, 0]));
  await nextFrames(page);
  await page.locator('#frame-from-view').click();
  await page.locator('#present-tool-section').click();
  // a horizontal section of the specimen: seen edge-on from the front and from the left (the default views)
  await drawSection(page, 0);
  await openSection(page, 'figure');
  await expect(page.locator('#fig-sections')).toBeChecked();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.figure('svg').then((f) => f?.layout.sections.length ?? 0))).toBe(1);

  let m = await marks(page);
  // dashed, 1.5 mm drawn and 0.8 mm left out (600 dpi)
  expect(m.front.dashes.length).toBeGreaterThan(0);
  const [on, off] = m.front.dashes[0]!.split(' ').map(Number);
  expect(on).toBeCloseTo((1.5 * 600) / 25.4, 1);
  expect(off).toBeCloseTo((0.8 * 600) / 25.4, 1);
  // across the middle of the box (y = 0 of its 20 mm)
  for (const y of m.front.ys) expect(Math.abs(y - m.frontView.height / 2)).toBeLessThan(m.frontView.height * 0.03);
  // its label beyond either end, outside the view
  expect(m.front.ends.map((e) => e.text)).toEqual(['X1', 'X1']);
  expect(m.front.ends[0].x).toBeLessThan(0);
  expect(m.front.ends[1].x).toBeGreaterThan(m.frontView.width);
  expect(m.left.ends.map((e) => e.text)).toEqual(['X1', 'X1']);
  // the drawing has it above it
  expect(m.titles).toEqual(['X1']);
  expect(m.layout.sections[0].labelY).toBeLessThan(m.layout.sections[0].y);
  // the PNG draws the same
  expect((await page.evaluate(() => window.lithicanalyst.figure('png')))!.data.length).toBeGreaterThan(0);

  // without the positions: no lines and no end labels; the drawing keeps its label
  await page.locator('#fig-sections').uncheck();
  m = await marks(page);
  expect([m.front.dashes, m.front.ends, m.left.dashes, m.left.ends]).toEqual([[], [], [], []]);
  expect(m.titles).toEqual(['X1']);
  await page.locator('#fig-sections').check();

  // a label of one's own: at both ends, over the drawing and in the list; undone, back
  await page.locator('#section-list .section-row').first().click();
  await page.locator('#section-insp-label').fill('a');
  await expect.poll(async () => (await state(page)).sections[0].label).toBe('a');
  await expect(page.locator('#section-list .section-row .arrow-id')).toHaveText(['a']);
  m = await marks(page);
  expect(m.front.ends.map((e) => e.text)).toEqual(['a', 'a']);
  expect(m.titles).toEqual(['a']);
  await page.locator('#btn-undo').click();
  await expect.poll(async () => (await state(page)).sections[0].label).toBe('X1');
  await expect(page.locator('#section-insp-label')).toHaveValue('X1');
  m = await marks(page);
  expect(m.front.ends.map((e) => e.text)).toEqual(['X1', 'X1']);
  expect(m.titles).toEqual(['X1']);
});

import { boxPly, boxPoint } from './fixtures/meshes';
import { enterModule, expect, fileMenu, openSection, state, test } from './helpers';
import { boxScene, clickAt, drawn, regions } from './boxScene';

const hidden = (page: import('@playwright/test').Page) => page.evaluate(() => window.lithicanalyst.hidden());
const curvesInFigure = async (page: import('@playwright/test').Page) => ((await page.evaluate(() => window.lithicanalyst.figure('svg')))!.data.match(/<polyline class="curve"/g) ?? []).length;

test('a curve hidden for the session: not drawn, not picked, not in the figure; the regions as they were; not undone; shown again by the count', async ({ page, pageErrors }) => {
  const ids = await boxScene(page);
  await openSection(page, 'curves');
  const before = (await regions(page))!.results.map((r) => r.area);
  // shown, and picked by a click on it
  expect((await drawn(page)).curves).toEqual([ids.curve]);
  await clickAt(page, boxPoint(10, 0, 5));
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.selection())).toBe(ids.curve);
  expect(await curvesInFigure(page)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.lithicanalyst.selectForTest(null));

  // its eye in the list: the row recedes, the count beside the title, the selection stays as it was
  const eye = page.locator(`#curve-list [data-eye="${ids.curve}"]`);
  await expect(eye).toBeChecked();
  await eye.click();
  await expect.poll(() => hidden(page)).toEqual([ids.curve]);
  expect(await page.evaluate(() => window.lithicanalyst.selection())).toBeNull();
  await expect(page.locator(`#curve-list li[data-id="${ids.curve}"]`)).toHaveClass(/is-hidden/);
  await expect(page.locator('#curve-list-hidden')).toBeVisible();
  await expect(page.locator('#curve-list-hidden')).toHaveText('1 hidden');
  await expect(page.locator('#scar-list-hidden')).toBeHidden();

  // not drawn, not picked, not in the figure
  await expect.poll(async () => (await drawn(page)).curves).toEqual([]);
  await page.screenshot({ path: 'test-results/31/hidden-curve.png' });
  await clickAt(page, boxPoint(10, 0, 5));
  expect(await page.evaluate(() => window.lithicanalyst.selection())).not.toBe(ids.curve);
  expect(await curvesInFigure(page)).toBe(0);
  // it still cuts the surface: the regions and their areas as they were
  expect(await page.evaluate(() => window.lithicanalyst.regionCount())).toBe(2);
  expect((await regions(page))!.results.map((r) => r.area)).toEqual(before);
  // chosen in the list it shows its details, and stays hidden
  await page.locator(`#curve-list li[data-id="${ids.curve}"]`).click();
  expect(await page.evaluate(() => window.lithicanalyst.selection())).toBe(ids.curve);
  await expect(page.locator('#curve-insp-label')).toBeVisible();
  expect((await drawn(page)).curves).toEqual([]);

  // no step in the history: undo takes back the landmark, the last thing done, and the curve stays hidden
  await page.locator('#btn-undo').click();
  await expect.poll(async () => (await state(page)).landmarks.length).toBe(0);
  expect(await hidden(page)).toEqual([ids.curve]);
  await page.locator('#btn-redo').click();
  await expect.poll(async () => (await state(page)).landmarks.length).toBe(1);

  // the count: all shown again
  await page.locator('#curve-list-hidden').click();
  await expect.poll(() => hidden(page)).toEqual([]);
  await expect(page.locator('#curve-list-hidden')).toBeHidden();
  await expect.poll(async () => (await drawn(page)).curves).toEqual([ids.curve]);
  // (the card did not fold)
  await expect(page.locator('#sec-curves')).toHaveAttribute('open', '');
  expect(pageErrors).toEqual([]);
});

test('arrows, regions and landmarks hide each by their eye; a hidden region is not coloured nor picked; closing the model shows all again', async ({ page }) => {
  const ids = await boxScene(page);
  await openSection(page, 'arrows');
  await openSection(page, 'regions');
  await openSection(page, 'landmarks');
  expect((await drawn(page)).regions.sort()).toEqual([ids.scar, ids.cortex].sort());
  await page.locator(`#scar-list [data-eye="${ids.arrow}"]`).click();
  await page.locator(`#region-list [data-eye="${ids.cortex}"]`).click();
  await page.locator(`#landmark-list [data-eye="${ids.landmark}"]`).click();
  await expect.poll(async () => (await hidden(page)).length).toBe(3);
  const d = await drawn(page);
  expect(d.arrows).toEqual([]);
  expect(d.regions).toEqual([ids.scar]);
  expect(d.landmarks).toEqual([]);
  await expect(page.locator('#scar-list-hidden')).toHaveText('1 hidden');
  await expect(page.locator('#region-list-hidden')).toHaveText('1 hidden');
  await expect(page.locator('#landmark-list-hidden')).toHaveText('1 hidden');
  // the area of the hidden region still counts
  expect((await regions(page))!.totals.cortex).toBeGreaterThan(2000);
  // the region tool on its piece: nothing is picked and nothing is made
  await page.keyboard.press('r');
  await page.evaluate(() => window.lithicanalyst.selectForTest(null));
  await clickAt(page, boxPoint(15, 7, 5));
  expect(await page.evaluate(() => window.lithicanalyst.selection())).toBeNull();
  expect((await state(page)).regions).toHaveLength(2);
  await page.keyboard.press('v');
  // nor in the figure: no arrow, no landmark
  const svg = (await page.evaluate(() => window.lithicanalyst.figure('svg')))!.data;
  expect(svg).not.toContain('class="fixed"');
  expect(svg).not.toMatch(/<polygon fill="[^"]+" stroke="none" points=/);

  // File > Close, and the model again: all shown
  await fileMenu(page, '#btn-close-model');
  await enterModule(page);
  const chooser = page.waitForEvent('filechooser');
  await fileMenu(page, '#btn-open');
  await (await chooser).setFiles(boxPly());
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Restore' }).click();
  await expect.poll(async () => (await state(page)).regions.length).toBe(2);
  expect(await hidden(page)).toEqual([]);
  await expect.poll(async () => (await drawn(page)).arrows.length).toBe(1);
  await expect.poll(async () => (await drawn(page)).landmarks.length).toBe(1);
});

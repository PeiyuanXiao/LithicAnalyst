import type { Page } from '@playwright/test';
import { boxPly, boxPoint, type Vec3 } from './fixtures/meshes';
import { counts, curveClick, dragArrow, expect, exportFile, loadMesh, nextFrames, openApp, openSection, parseCsv, state, test, toScreen } from './helpers';

const regions = (page: Page) => page.evaluate(() => window.lithicanalyst.regions());
const pieces = (page: Page) => page.evaluate(() => window.lithicanalyst.regionCount());

async function click(page: Page, p: Vec3): Promise<void> {
  const s = await toScreen(page, p);
  await page.mouse.click(s.x, s.y);
}

test('curves split the surface into regions; regions keep their type when the curves change', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, boxPly());
  await page.evaluate(() => window.lithicanalyst.view([0, 0, 1], [0, 1, 0]));
  await nextFrames(page);

  // an arrow, then a closed curve around a 20 × 10 rectangle of the top face (along mesh edges)
  await page.keyboard.press('a');
  await dragArrow(page, boxPoint(-5, 0, 5), boxPoint(5, 2, 5));
  await page.keyboard.press('p');
  for (const p of [boxPoint(-10, -5, 5), boxPoint(10, -5, 5), boxPoint(10, 5, 5), boxPoint(-10, 5, 5)]) await curveClick(page, await toScreen(page, p), { shift: true });
  const first = await toScreen(page, boxPoint(-10, -5, 5));
  await page.mouse.move(first.x, first.y, { steps: 3 });
  await page.keyboard.down('Shift');
  await page.mouse.click(first.x, first.y);
  await page.keyboard.up('Shift');
  await expect.poll(() => counts(page)).toEqual({ arrows: 1, curves: 1 });
  await expect.poll(() => pieces(page)).toBe(2);

  // R: click inside — a scar region, linked to the arrow that starts there
  await page.keyboard.press('r');
  await expect(page.locator('#mode-region')).toHaveAttribute('aria-checked', 'true');
  await click(page, boxPoint(3, -1.3, 5));
  await expect.poll(async () => (await regions(page))?.results.length).toBe(1);
  let st = await state(page);
  expect(st.regions[0]).toMatchObject({ label: 'R1', type: 'scar', scarId: st.scars[0].id });
  expect((await regions(page))!.results[0].area).toBeCloseTo(200, 3);

  // outside: the rest of the box, set to cortex with key 2 (no stray scar is left behind)
  await click(page, boxPoint(15, 7, 5));
  await expect.poll(async () => (await regions(page))?.results.length).toBe(2);
  await page.keyboard.press('2');
  await expect.poll(async () => (await state(page)).regions[1].type).toBe('cortex');
  expect((await state(page)).scars).toHaveLength(1);
  let info = (await regions(page))!;
  expect(info.results[1].area).toBeCloseTo(2600, 2);
  expect(info.totals.scar).toBeCloseTo(200, 3);
  expect(info.totals.cortex).toBeCloseTo(2600, 2);
  expect(info.totals.cortexRatio).toBeCloseTo(2600 / 2800, 6);
  await expect(page.locator('#region-list .region-row')).toHaveCount(2);
  await expect(page.locator('#region-cortex-ratio')).toHaveText('0.929');

  // clicking an existing region selects it
  await click(page, boxPoint(-6, 3, 5));
  expect(await page.evaluate(() => window.lithicanalyst.selection())).toBe((await state(page)).regions[0].id);

  const csv = await exportFile(page, 'regions');
  expect(csv.name).toBe('box_regions.csv');
  expect(parseCsv(csv.text).map((r) => [r.region_id, r.type, r.scar_id, Number(r.area).toFixed(3), r.unit])).toEqual([
    ['R1', 'scar', 'S1', '200.000', 'mm'],
    ['R2', 'cortex', '', '2600.000', 'mm'],
  ]);
  const [row] = parseCsv(await page.evaluate(() => window.lithicanalyst.exportMeasurementsCsvText()));
  expect(Number(row.area_scar)).toBeCloseTo(200, 3);
  expect(Number(row.cortex_ratio)).toBeCloseTo(2600 / 2800, 5);

  // a second curve from edge to edge of the rectangle (its ends land on the first curve): the rectangle splits,
  // R1 keeps its type on the half that holds its seed
  await page.keyboard.press('p');
  for (const p of [boxPoint(0, 5.4, 5), boxPoint(0, -5.4, 5)]) await curveClick(page, await toScreen(page, p));
  await page.keyboard.press('Enter');
  await expect.poll(() => counts(page)).toEqual({ arrows: 1, curves: 2 });
  await expect.poll(() => pieces(page)).toBe(3);
  info = (await regions(page))!;
  expect(info.results[0]).toMatchObject({ type: 'scar', conflict: false });
  expect(info.results[0].area).toBeCloseTo(100, 3);
  st = await state(page);
  expect(Math.abs(st.curves[1].anchors[0][1] - boxPoint(0, 5, 5)[1])).toBeLessThan(1e-6);

  // removing that curve again joins the halves: nothing is lost
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => pieces(page)).toBe(2);
  expect((await regions(page))!.results[0].area).toBeCloseTo(200, 3);

  // deleting the rectangle puts both seeds in one piece: a conflict is reported; undo restores the regions
  await page.locator('#curve-list .curve-row', { hasText: 'C1' }).click();
  await page.keyboard.press('Delete');
  await expect.poll(() => pieces(page)).toBe(1);
  expect((await regions(page))!.results.map((r) => r.conflict)).toEqual([true, true]);
  await expect(page.locator('.toast-warn')).toContainText('same piece');
  await expect(page.locator('#region-list .region-row', { hasText: 'R2' })).toContainText('Conflict');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => pieces(page)).toBe(2);
  expect((await regions(page))!.results.map((r) => [r.type, r.conflict])).toEqual([
    ['scar', false],
    ['cortex', false],
  ]);

  // deleting a region; undo
  await openSection(page, 'regions');
  await page.locator('#region-list .region-row', { hasText: 'R1' }).click();
  await page.keyboard.press('Delete');
  await expect(page.locator('#region-list .region-row')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#region-list .region-row')).toHaveCount(2);

  const saved = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(saved.annotations.regions.map((r) => [r.label, r.type])).toEqual([
    ['R1', 'scar'],
    ['R2', 'cortex'],
  ]);
  expect(saved.derived.regionTotals!.cortexRatio).toBeCloseTo(2600 / 2800, 6);
});

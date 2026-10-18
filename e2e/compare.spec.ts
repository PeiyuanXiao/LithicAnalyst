import type { Page } from '@playwright/test';
import { boxPly, boxPoint, spherePly, type Vec3 } from './fixtures/meshes';
import { counts, curveClick, download, dragArrow, expect, exportAvailable, exportFile, loadMesh, openApp, parseCsv, setAnnotator, state, test, toScreen, viewFromTop } from './helpers';

const agreement = (page: Page) => page.evaluate(() => window.lithicanalyst.agreement());
const value = async (page: Page, itemType: string, itemKey: string, metric: string) =>
  (await agreement(page))?.rows.find((r) => r.itemType === itemType && r.itemKey === itemKey && r.metric === metric)?.value;

async function addFiles(page: Page, files: Array<{ name: string; text: string }>): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#compare-add').click();
  await (await chooser).setFiles(files.map((f) => ({ name: f.name, mimeType: 'application/json', buffer: Buffer.from(f.text) })));
}

test('compares the open project with other observers\' files of the same model', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, boxPly());
  await viewFromTop(page);
  await setAnnotator(page, 'Ann');
  // a closed rectangle on the top face with a scar region in it, an arrow inside, and a landmark
  await page.keyboard.press('p');
  for (const p of [boxPoint(-10, -5, 5), boxPoint(10, -5, 5), boxPoint(10, 5, 5), boxPoint(-10, 5, 5)]) await curveClick(page, await toScreen(page, p), { shift: true });
  const first = await toScreen(page, boxPoint(-10, -5, 5));
  await page.mouse.move(first.x, first.y, { steps: 3 });
  await page.keyboard.down('Shift');
  await page.mouse.click(first.x, first.y);
  await page.keyboard.up('Shift');
  await page.keyboard.press('a');
  await dragArrow(page, boxPoint(-5, 0, 5), boxPoint(5, 2, 5));
  await expect.poll(() => counts(page)).toEqual({ arrows: 1, curves: 1 });
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.regionCount())).toBe(2);
  await page.keyboard.press('r');
  const inside = await toScreen(page, boxPoint(3, -2.5, 5));
  await page.mouse.click(inside.x, inside.y);
  await expect.poll(async () => (await state(page)).regions.length).toBe(1);
  await page.keyboard.press('k');
  const lm = await toScreen(page, boxPoint(15, 7.5, 5));
  await page.keyboard.down('Shift');
  await page.mouse.click(lm.x, lm.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await state(page)).landmarks.length).toBe(1);

  // a second observer: the same annotations, but the arrow's end lower, the region cortex, the landmark 3 away
  const saved = await download(page, () => page.locator('#btn-save-project').click());
  const other = JSON.parse(saved.text);
  other.specimen.annotator = 'Bo';
  const arrow = other.annotations.scars[0].vector;
  arrow.end = [arrow.end[0], arrow.end[1] - 4, arrow.end[2]];
  other.annotations.regions[0].type = 'cortex';
  other.annotations.landmarks[0].point[0] += 3;
  const wrongModel = { ...other, mesh: { ...other.mesh, sha256: '0'.repeat(64) } };

  await page.locator('#app-mode-compare').click();
  await expect(page.locator('#sec-observers')).toBeVisible();
  await expect(page.locator('#observer-list .observer-row')).toHaveCount(1);
  expect(await exportAvailable(page, 'agreement')).toBe(false);
  await addFiles(page, [{ name: 'bo.lithicanalyst.json', text: JSON.stringify(other) }, { name: 'elsewhere.lithicanalyst.json', text: JSON.stringify(wrongModel) }]);
  await expect(page.locator('.toast-warn')).toContainText('elsewhere.lithicanalyst.json');
  await expect(page.locator('#observer-list .observer-row')).toHaveCount(2);
  expect((await page.evaluate(() => window.lithicanalyst.observers())).map((o) => [o.label, o.current])).toEqual([
    ['Ann', true],
    ['Bo', false],
  ]);
  await expect.poll(() => agreement(page)).not.toBeNull();

  // arrow (10, 2) against (10, −2): 2·atan(0.2)
  expect(await value(page, 'arrow', 'S1|S1', 'angle_deg')).toBeCloseTo((2 * Math.atan(0.2) * 180) / Math.PI, 3);
  expect(await value(page, 'arrow', 'S1|S1', 'end_distance')).toBeCloseTo(4, 4);
  expect(await value(page, 'arrow', 'all', 'matched')).toBe(1);
  expect(await value(page, 'curve', 'C1|C1', 'hausdorff')).toBeCloseTo(0, 6);
  expect(await value(page, 'landmark', 'LM1', 'distance')).toBeCloseTo(3, 4);
  // the 20 × 10 rectangle is a scar for one and cortex for the other
  expect(await value(page, 'region', 'scar', 'iou')).toBe(0);
  expect(await value(page, 'region_type', 'all', 'agreement')).toBe(0);
  expect(await value(page, 'region_type', 'all', 'area')).toBeCloseTo(200, 2);
  expect(await value(page, 'measurement', 'area_cortex', 'difference')).toBeCloseTo(200, 2);
  await expect(page.locator('#agreement-table tbody tr[data-item="arrow"][data-metric="angle_deg"]')).toHaveCount(1);

  const long = await exportFile(page, 'agreement');
  expect(long.name).toBe('box_agreement.csv');
  expect(long.text.split('\n')[0]).toBe('specimen_id,item_type,item_key,annotator_a,annotator_b,metric,value');
  expect(parseCsv(long.text).find((r) => r.item_type === 'landmark')).toMatchObject({ specimen_id: 'box', item_key: 'LM1', annotator_a: 'Ann', annotator_b: 'Bo', metric: 'distance' });
  const summary = await exportFile(page, 'agreement-summary');
  expect(summary.name).toBe('box_agreement_summary.csv');
  expect(summary.text.split('\n')[0]).toBe('specimen_id,item_type,metric,annotator_a,annotator_b,n,mean,sd,min,max');
  const angle = parseCsv(summary.text).find((r) => r.item_type === 'arrow' && r.metric === 'angle_deg')!;
  expect([angle.n, angle.sd]).toEqual(['1', '']);

  // changes to the open project are compared again (undo the landmark: its row goes)
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => value(page, 'landmark', 'LM1', 'distance')).toBeUndefined();
  // leave one observer out: nothing to compare
  await page.locator('#observer-list .observer-row', { hasText: 'Bo' }).locator('input').uncheck();
  await expect.poll(() => agreement(page)).toBeNull();
  await expect(page.locator('#agreement-table')).toBeEmpty();
  await page.locator('#observer-list .observer-row', { hasText: 'Bo' }).locator('input').check();
  await expect.poll(() => agreement(page)).not.toBeNull();
  await page.locator('#observer-list .observer-row', { hasText: 'Bo' }).locator('[data-act="remove"]').click();
  await expect(page.locator('#observer-list .observer-row')).toHaveCount(1);

  // a new model starts over
  await loadMesh(page, spherePly());
  await expect(page.locator('#observer-list .observer-row')).toHaveCount(1);
  expect(await agreement(page)).toBeNull();
});

test('three observers: Fleiss\' κ on what all of them share', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, boxPly());
  await viewFromTop(page);
  await page.keyboard.press('a');
  const ends: Array<[Vec3, Vec3]> = [
    [boxPoint(-10, -5, 5), boxPoint(10, -5, 5)],
    [boxPoint(-10, 5, 5), boxPoint(10, 5, 5)],
  ];
  for (const [a, b] of ends) await dragArrow(page, a, b);
  const saved = await download(page, () => page.locator('#btn-save-project').click());
  const make = (name: string, codes: string[]) => {
    const f = JSON.parse(saved.text);
    f.specimen.annotator = name;
    f.annotations.scars.forEach((s: { attributes: Record<string, string> }, i: number) => (s.attributes.completeness = codes[i]));
    return { name: `${name}.json`, text: JSON.stringify(f) };
  };
  await page.locator('#app-mode-compare').click();
  await addFiles(page, [make('B', ['point_complete', 'both_missing']), make('C', ['point_complete', 'both_missing'])]);
  await expect.poll(async () => (await agreement(page))?.rows.some((r) => r.a === 'all')).toBe(true);
  const rows = (await agreement(page))!.rows.filter((r) => r.a === 'all' && r.itemKey === 'completeness');
  // the open project rated both scars point_complete (the default): items (pc, pc, pc) and (pc, bm, bm)
  const byMetric = Object.fromEntries(rows.map((r) => [r.metric, r.value]));
  expect(byMetric.n_items).toBe(2);
  expect(byMetric.agreement).toBeCloseTo((1 + 1 / 3) / 2, 9);
  expect(await page.locator('#observer-list .observer-row').count()).toBe(3);
});

import type { Page } from '@playwright/test';
import { BOX, boxPly, boxPoint, type Vec3 } from './fixtures/meshes';
import { counts, curveClick, download, dragArrow, expect, loadMesh, nextFrames, openApp, parseCsv, state, test, toScreen } from './helpers';

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const planes = (page: Page) => page.evaluate(() => window.lithicanalyst.planes());
const plane = async (page: Page, label: string) => (await planes(page)).find((p) => p.label === label)!;

async function viewFromTop(page: Page): Promise<void> {
  await page.evaluate(() => window.lithicanalyst.view([0, 0, 1], [0, 1, 0]));
  await nextFrames(page);
}

test('fits planes by all four methods, follows their inputs, and exports them', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, boxPly());
  await viewFromTop(page);

  // inputs on the top face (z = +5): arrows in different directions, one marked "both ends missing", and a curve
  await page.keyboard.press('a');
  const arrows: Array<[Vec3, Vec3]> = [
    [boxPoint(-15, -5, 5), boxPoint(-8, 2, 5)],
    [boxPoint(0, 6, 5), boxPoint(6, 6, 5)],
    [boxPoint(12, -6, 5), boxPoint(12, 1, 5)],
    [boxPoint(4, -2, 5), boxPoint(-2, -7, 5)],
  ];
  for (const [a, b] of arrows) await dragArrow(page, a, b);
  await page.keyboard.press('5');
  await page.keyboard.press('p');
  for (const p of [boxPoint(-16, 7, 5), boxPoint(-4, 8, 5), boxPoint(8, 4, 5)]) await curveClick(page, await toScreen(page, p), { shift: true });
  await page.keyboard.press('Enter');
  await expect.poll(() => counts(page)).toEqual({ arrows: 4, curves: 1 });

  await page.keyboard.press('m');
  await expect(page.locator('#sec-planes')).toBeVisible();
  await expect(page.locator('#export-planes-csv')).toBeDisabled();

  // P1: all vertices — the box's mid-plane across its thickness, its normal toward the viewer
  await page.locator('#plane-add').click();
  await expect(page.locator('#plane-list .plane-row')).toHaveCount(1);
  await expect(page.locator('#plane-method')).toHaveValue('all_vertices');
  let p1 = await plane(page, 'P1');
  expect(p1.valid).toBe(true);
  expect(dot(p1.normal!, [0, 0, 1])).toBeCloseTo(1, 6);
  p1.center!.forEach((x, k) => expect(x).toBeCloseTo(BOX.center[k], 3));
  // the frame: +X along the length of the box, +Y = Z × X
  expect(p1.matrix!.slice(0, 3).map((x) => +x.toFixed(6) + 0)).toEqual([1, 0, 0]);
  expect(p1.matrix!.slice(4, 7).map((x) => +x.toFixed(6) + 0)).toEqual([0, 1, 0]);
  await expect.poll(() => page.evaluate((id) => window.lithicanalyst.planeSectionCount(id), p1.id)).toBe(1);

  // P1 → scar origins; leave out "both ends missing"
  await page.locator('#plane-method').selectOption('scar_starts');
  p1 = await plane(page, 'P1');
  expect(p1).toMatchObject({ method: 'scar_starts', valid: true, inputCount: 4 });
  expect(p1.center![2]).toBeCloseTo(BOX.center[2] + 5, 3);
  await page.locator('#plane-use-both_missing').uncheck();
  await expect.poll(async () => (await plane(page, 'P1')).inputCount).toBe(3);
  // flipping turns the normal; undo turns it back
  await page.locator('#plane-flip').click();
  await expect.poll(async () => (await plane(page, 'P1')).normal![2]).toBeCloseTo(-1, 6);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await plane(page, 'P1')).normal![2]).toBeCloseTo(1, 6);

  // P2: curves — invalid until a curve is chosen
  await page.locator('#plane-add').click();
  await page.locator('#plane-method').selectOption('curves');
  await expect(page.locator('#plane-list .plane-row', { hasText: 'P2' })).toContainText('Invalid');
  const curveId = (await state(page)).curves[0].id;
  await page.locator(`#plane-curve-${curveId}`).check();
  await expect.poll(async () => (await plane(page, 'P2')).valid).toBe(true);
  const p2 = await plane(page, 'P2');
  expect(Math.abs(p2.normal![2])).toBeCloseTo(1, 4);
  expect(p2.center![2]).toBeCloseTo(BOX.center[2] + 5, 2);

  // P3: scar directions
  await page.locator('#plane-add').click();
  await page.locator('#plane-method').selectOption('scar_directions');
  const p3 = await plane(page, 'P3');
  expect(p3.valid).toBe(true);
  expect(p3.normal![2]).toBeCloseTo(1, 4);

  // planes follow their inputs: deleting an arrow (annotate mode) refits P1
  await page.locator('#app-mode-annotate').click();
  await page.locator('#sec-arrows .arrow-row', { hasText: 'S1' }).click();
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await plane(page, 'P1')).inputCount).toBe(2);
  expect((await plane(page, 'P1')).valid).toBe(false);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await plane(page, 'P1')).inputCount).toBe(3);
  await page.keyboard.press('m');

  // view along the normal; hide one plane
  await page.locator('#plane-list .plane-row', { hasText: 'P3' }).click();
  await page.locator('#plane-view').click();
  await expect.poll(async () => dot((await page.evaluate(() => window.lithicanalyst.towardViewer()))!, p3.normal!)).toBeCloseTo(1, 6);
  await page.locator('#plane-list .plane-row', { hasText: 'P2' }).locator('.plane-eye').uncheck();
  expect((await state(page)).planes.map((p) => p.visible)).toEqual([true, false, true]);

  const csv = await download(page, () => page.locator('#export-planes-csv').click());
  expect(csv.name).toBe('box_planes.csv');
  const rows = parseCsv(csv.text);
  expect(rows.map((r) => [r.plane_id, r.method])).toEqual([
    ['P1', 'scar_starts'],
    ['P2', 'curves'],
    ['P3', 'scar_directions'],
  ]);
  for (const r of rows) {
    const m = Array.from({ length: 16 }, (_, i) => Number(r[`m${Math.floor(i / 4)}${i % 4}`]));
    const c: Vec3 = [Number(r.center_x), Number(r.center_y), Number(r.center_z)];
    // the matrix takes the centre to the origin
    for (let k = 0; k < 3; k++) expect(m[4 * k] * c[0] + m[4 * k + 1] * c[1] + m[4 * k + 2] * c[2] + m[4 * k + 3]).toBeCloseTo(0, 3);
    expect([m[8], m[9], m[10]].map((x, k) => x - Number(r[`normal_${'xyz'[k]}`])).every((d) => Math.abs(d) < 1e-6)).toBe(true);
  }

  const saved = JSON.parse((await download(page, () => page.locator('#btn-save-project').click())).text);
  expect(saved.annotations.planes).toHaveLength(3);
  expect(saved.derived.planes.map((p: { label: string; valid: boolean }) => [p.label, p.valid])).toEqual([
    ['P1', true],
    ['P2', true],
    ['P3', true],
  ]);

  // delete the selected plane, then undo
  await page.locator('#plane-list .plane-row', { hasText: 'P3' }).click();
  await page.keyboard.press('Delete');
  await expect(page.locator('#plane-list .plane-row')).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#plane-list .plane-row')).toHaveCount(3);
});

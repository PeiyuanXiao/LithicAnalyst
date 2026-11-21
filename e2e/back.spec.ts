import type { Page } from '@playwright/test';
import { curveClick, expect, nextFrames, openSection, parseCsv, state, test, toScreen } from './helpers';
import { T9, T9_AREAS, type Vec3 } from './fixtures/meshes';
import { openT9 } from './t9Setup';

/** Stage 33: the back of a core-edge flake, on T9 (tests/meshes.ts). */

const regions = (page: Page) => page.evaluate(() => window.lithicanalyst.regions());
const svg = async (page: Page): Promise<string> => (await page.evaluate(() => window.lithicanalyst.figure('svg')))!.data;

test('the back: a back ridge drawn and typed with 7 parts it off, coloured, in regions.csv and the legend; 8 and 0 on a region; 0 in the help', async ({ page, pageErrors }) => {
  await openT9(page);
  const before = (await regions(page))!;
  // the dorsal face before: the back with it
  expect(Math.abs(before.totals.dorsal - (T9_AREAS.dorsal + T9_AREAS.back))).toBeLessThan(0.5);

  // the ridge C–F, seen from the back's side and above
  const { C, F } = T9;
  await page.evaluate(() => window.lithicanalyst.view([1, -0.3, 0.8], [0, 0, 1]));
  await nextFrames(page);
  await page.keyboard.press('p');
  // (the distal tip is the outline's point: a little short of it, the open end then joins the edge by itself)
  const at = (k: number): Vec3 => [C[0] + k * (F[0] - C[0]), C[1] + k * (F[1] - C[1]), C[2] + k * (F[2] - C[2])];
  for (const p of [C, at(0.5), at(0.95)]) await curveClick(page, await toScreen(page, p), { shift: true });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).curves.length).toBe(3);
  await page.keyboard.press('v');
  await page.keyboard.press('7');
  await expect.poll(async () => (await state(page)).curves[2].attributes.type).toBe('back_ridge');

  // the back follows it: its own area, coloured on the model
  await expect.poll(async () => (await regions(page))?.results.find((r) => r.type === 'back')?.area ?? null).not.toBeNull();
  const res = (await regions(page))!;
  const back = res.results.find((r) => r.type === 'back')!;
  expect(Math.abs(back.area! - T9_AREAS.back)).toBeLessThan(0.5);
  expect(Math.abs(res.totals.dorsal - T9_AREAS.dorsal)).toBeLessThan(0.5);
  const st = await state(page);
  expect(st.regions.find((r) => r.id === back.id)).toMatchObject({ auto: true, curveId: st.curves[2].id });
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.drawn())).regions).toContain(back.id);
  // the ridge parts it off: no warning
  await expect(page.locator('#curve-back-uncut')).toHaveCount(0);
  // the region list: the parts in their order, the back after the dorsal face, with its area (one back: not again among the totals)
  await openSection(page, 'regions');
  const listed = await page.locator('#region-list li').evaluateAll((els) => els.map((e) => e.textContent ?? ''));
  expect(listed.findIndex((x) => x.includes('Back'))).toBeGreaterThan(listed.findIndex((x) => x.includes('Dorsal face')));
  expect(listed.find((x) => x.includes('Back'))).toMatch(/\d/);
  await expect(page.locator('#region-totals')).toBeAttached();
  await expect(page.locator('#region-total-back')).toHaveCount(0);

  // regions.csv has it
  const rows = parseCsv(await page.evaluate(() => window.lithicanalyst.exportRegionsCsvText()));
  expect(rows.some((r) => r.type === 'back')).toBe(true);

  // the legend of the figure names it
  await page.locator('#app-mode-present').click();
  await openSection(page, 'figure');
  await page.locator('#fig-legend').check();
  expect(await svg(page)).toMatch(/<g class="legend-item" data-kind="region" data-key="back">[\s\S]*?Back<\/text>/);
  await page.locator('#app-mode-annotate').click();

  // a region chosen, 8: a back; 0: the user's own type
  const dorsal = res.results.find((r) => r.type === 'dorsal')!;
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), dorsal.id);
  await page.keyboard.press('8');
  await expect.poll(async () => (await state(page)).regions.find((r) => r.id === dorsal.id)?.type).toBe('back');
  await page.keyboard.press('0');
  await expect(page.locator('#region-type-text')).toBeVisible();
  await page.keyboard.press('Escape');

  // the help: 0 among the keys
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+Slash');
  await expect(page.locator('.help-col kbd', { hasText: /^0$/ })).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});

test('a back ridge that does not reach the edge: no back, and its details say so', async ({ page, pageErrors }) => {
  await openT9(page);
  const { A, C, F } = T9;
  // from C into the middle of the dorsal face (its incentre)
  const a = Math.hypot(C[0] - F[0], C[1] - F[1], C[2] - F[2]), b = Math.hypot(A[0] - F[0], A[1] - F[1], A[2] - F[2]), c = Math.hypot(A[0] - C[0], A[1] - C[1], A[2] - C[2]);
  const I = [0, 1, 2].map((k) => (a * A[k] + b * C[k] + c * F[k]) / (a + b + c)) as Vec3;
  await page.evaluate(() => window.lithicanalyst.view([0.2, -0.3, 1], [0, 1, 0]));
  await nextFrames(page);
  await page.keyboard.press('p');
  for (const p of [C, I]) await curveClick(page, await toScreen(page, p), { shift: true });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).curves.length).toBe(3);
  await page.keyboard.press('v');
  await page.keyboard.press('7');
  await expect.poll(async () => (await state(page)).curves[2].attributes.type).toBe('back_ridge');
  await openSection(page, 'curves');
  await expect(page.locator('#curve-back-uncut')).toBeVisible();
  expect((await regions(page))!.results.find((r) => r.type === 'back')?.area ?? null).toBeNull();
  expect(pageErrors).toEqual([]);
});

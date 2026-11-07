import type { Page } from '@playwright/test';
import { T1, t1Ply, t2Ply, t3Ply, type Vec3 } from './fixtures/meshes';
import { curveClick, displayPanel, expect, exportAvailable, exportFile, folderPaths, folderText, loadMesh, mockFolder, nextFrames, openApp, openMockFolder, openSection, parseCsv, specimenPanel, state, test, toScreen } from './helpers';

const gm = (page: Page) => page.evaluate(() => window.lithicanalyst.gm());
/** 3 fixed; the edge's 48 and the outline's 3 × 8 between their ends; the grids. */
const DEFAULT_TOTAL = 3 + 48 + 24 + 150 + 150 + 32;

async function setFlake(page: Page): Promise<void> {
  await specimenPanel(page);
  await page.locator('#specimen-type').selectOption('flake');
  await page.keyboard.press('Escape');
}

/** The technical axis on T1, from the ventral side. */
async function drawAxis(page: Page): Promise<void> {
  await page.evaluate(() => window.lithicanalyst.view([0, 0, -1], [0, 1, 0]));
  await nextFrames(page);
  await page.evaluate(() => window.lithicanalyst.snap.prepare('ridge'));
  await page.keyboard.press('t');
  const s = await toScreen(page, [0, 0.4, 0]);
  const e = await toScreen(page, T1.A);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(e.x, e.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.flake()))?.axis?.matrix ?? null).not.toBeNull();
}

/** The outline round the P–E face, and the edge along the ventral face's boundary; its ends give the platform's, and without them it stops well short of the outline. */
async function annotate(page: Page, ends = true): Promise<void> {
  await drawAxis(page);
  await page.evaluate(() => window.lithicanalyst.view([0, -0.98, 0.196], [0, 0.196, 0.98]));
  await nextFrames(page);
  await page.keyboard.press('p');
  const corner = (x: number, f: number): Vec3 => [x, -2 * f, 10 * f];
  const a = await toScreen(page, corner(-14.8, 0.02)), b = await toScreen(page, corner(14.8, 0.02));
  const c = await toScreen(page, corner(14.8, 0.98)), d = await toScreen(page, corner(-14.8, 0.98));
  for (const at of [a, b, c, d]) await curveClick(page, at, { shift: true });
  await page.mouse.move(a.x, a.y, { steps: 3 });
  await page.keyboard.down('Shift');
  await page.mouse.click(a.x, a.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await state(page)).curves.length).toBe(1);
  await page.keyboard.press('v');
  await page.keyboard.press('5');
  if (ends) {
    for (const x of [-14.9, 14.9]) await page.evaluate((p) => window.lithicanalyst.placePlatformEnd(p), [x, -0.02, 0.1] as Vec3);
  }
  if (await page.locator('#profile-panel').isVisible()) await page.locator('#profile-close').click();
  await page.evaluate(() => window.lithicanalyst.view([0, 0, -1], [-1, 0, 0]));
  await nextFrames(page);
  await page.keyboard.press('p');
  const from = ends ? 0.3 : 12;
  for (const p of [[-14.7, from, 0], [-14.7, 59.7, 0], [14.7, 59.7, 0], [14.7, from, 0]] as Vec3[]) await curveClick(page, await toScreen(page, p), { shift: true });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).curves.length).toBe(2);
  await page.keyboard.press('v');
  await page.keyboard.press('2');
  await expect.poll(async () => (await state(page)).curves[1].attributes.type).toBe('edge');
}

const setNumber = async (page: Page, id: string, value: number) => {
  await page.locator(id).fill(String(value));
  await page.keyboard.press('Enter');
};

test('a flake\'s points: as configured, in the exports with their sliding definition; a core has none', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, t1Ply());
  await setFlake(page);
  await annotate(page);
  await openSection(page, 'gm');
  await expect.poll(async () => (await gm(page))?.complete ?? false).toBe(true);
  expect((await gm(page))!.rows.length).toBe(DEFAULT_TOTAL);

  // each item's count and the total
  await expect(page.locator('#gm-count-edge')).toHaveText('50');
  await expect(page.locator('#gm-count-platformOutline')).toHaveText('30');
  await expect(page.locator('#gm-count-ventral')).toHaveText('150');
  await expect(page.locator('#gm-count-platform')).toHaveText('32');
  await expect(page.locator('#gm-total')).toContainText(String(DEFAULT_TOTAL));
  await expect(page.locator('#gm-incomplete')).toBeHidden();

  // the display shows them, or not
  await displayPanel(page);
  await expect(page.locator('#gm-show')).not.toBeChecked();
  await page.locator('#gm-show').check();
  await page.keyboard.press('Escape');

  // fewer points: recomputed, no annotation changed, one undo step
  const before = await state(page);
  await setNumber(page, '#gm-edge-points', 20);
  await expect.poll(async () => (await gm(page))?.rows.length).toBe(DEFAULT_TOTAL - 30);
  await expect(page.locator('#gm-count-edge')).toHaveText('20');
  await expect(page.locator('#gm-total')).toContainText(String(DEFAULT_TOTAL - 30));
  await setNumber(page, '#gm-ventral-rows', 5);
  await expect.poll(async () => (await gm(page))?.rows.length).toBe(DEFAULT_TOTAL - 30 - 100);
  const after = await state(page);
  expect(after.curves).toEqual(before.curves);
  expect(after.landmarks).toEqual(before.landmarks);
  await page.locator('#btn-undo').click();
  await expect.poll(async () => (await gm(page))?.rows.length).toBe(DEFAULT_TOTAL - 30);
  await page.locator('#btn-undo').click();
  await expect.poll(async () => (await gm(page))?.rows.length).toBe(DEFAULT_TOTAL);

  // an item left out, a fixed landmark left out
  await page.locator('#gm-dorsal-on').uncheck();
  await expect.poll(async () => (await gm(page))?.surfaces.length).toBe(182);
  await page.locator('#gm-dorsal-on').check();
  await page.locator('#gm-fixed-pop').uncheck();
  await expect.poll(async () => (await gm(page))?.rows[0].name).toBe('platform_left');
  await page.locator('#gm-fixed-pop').check();
  await setNumber(page, '#gm-edge-points', 30);
  await expect.poll(async () => (await gm(page))?.rows.length).toBe(DEFAULT_TOTAL - 20);

  // the exports go with the number of points
  const table = await exportFile(page, 'gm-csv');
  expect(table.name).toBe('t1_gm_landmarks.csv');
  const rows = parseCsv(table.text);
  expect(rows.length).toBe(DEFAULT_TOTAL - 20);
  expect(rows[0]).toMatchObject({ index: '1', name: 'pop', kind: 'fixed', set_id: '' });
  expect(new Set(rows.map((r) => r.kind))).toEqual(new Set(['fixed', 'curve', 'surface']));
  const tps = await exportFile(page, 'gm-tps');
  expect(tps.name).toBe('t1_gm_landmarks.tps');
  expect(tps.text.split('\n')[0].trim()).toBe(`LM3=${DEFAULT_TOTAL - 20}`);
  const curves = await exportFile(page, 'gm-curves');
  expect(curves.name).toBe('t1_gm_curves.csv');
  expect(curves.text.trim().split('\n')[0]).toBe('before,slide,after');
  const sliding = parseCsv(curves.text);
  expect(sliding.length).toBe(28 + 24);
  // the edge begins on the left end, a fixed point that does not slide
  expect(sliding[0].before).toBe('2');
  expect(sliding.every((r) => !['1', '2', '3'].includes(r.slide))).toBe(true);
  const surfaces = await exportFile(page, 'gm-surfaces');
  expect(surfaces.name).toBe('t1_gm_surfaces.csv');
  const listed = parseCsv(surfaces.text);
  expect(listed.length).toBe(332);
  expect(rows[Number(listed[0].index) - 1].kind).toBe('surface');

  // the file holds the configuration and the points
  const file = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(file.gm.edge.points).toBe(30);
  expect(file.derived.gm?.rows.length).toBe(DEFAULT_TOTAL - 20);
  expect(file.derived.gm?.config.edge.points).toBe(30);

  // a core asks for none of this until its own lists are filled
  await setType(page, 'core');
  await expect(page.locator('#gm-add-landmark')).toHaveCount(1);
  await expect(page.locator('#gm-edge-on')).toHaveCount(0);
  await expect.poll(() => gm(page)).toBeNull();
  await displayPanel(page);
  await expect(page.locator('#gm-show')).toBeHidden();
  await page.keyboard.press('Escape');
  await page.locator('#btn-export').click();
  await expect(page.locator('.export-list input[data-key="gm-csv"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
});

async function setType(page: Page, type: 'core' | 'flake'): Promise<void> {
  await specimenPanel(page);
  await page.locator('#specimen-type').selectOption(type);
  await page.keyboard.press('Escape');
}

test('without platform ends: incomplete, and it says what is missing; nothing to export', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, t1Ply());
  await setFlake(page);
  await annotate(page, false);
  await openSection(page, 'gm');
  await expect.poll(async () => (await gm(page))?.missing ?? []).toEqual(['platform_ends']);
  expect((await gm(page))!.complete).toBe(false);
  await expect(page.locator('#gm-incomplete')).toBeVisible();
  await expect(page.locator('#gm-missing li')).toHaveText(['No platform ends']);
  for (const key of ['gm-tps', 'gm-csv', 'gm-curves', 'gm-surfaces']) expect(await exportAvailable(page, key)).toBe(false);

  // a point platform: what needs no ends is whole
  for (const id of ['#gm-fixed-platform_left', '#gm-fixed-platform_right', '#gm-platformOutline-on', '#gm-platform-on']) await page.locator(id).uncheck();
  await expect.poll(async () => (await gm(page))?.complete ?? false).toBe(true);
  const r = (await gm(page))!;
  await expect(page.locator('#gm-incomplete')).toBeHidden();
  expect(r.rows.length).toBe(1 + 48 + 300);
  // the edge begins and ends at the point of percussion
  expect(r.curves[0][0]).toBe(1);
  expect(r.curves[r.curves.length - 1][2]).toBe(1);
  expect(await exportAvailable(page, 'gm-csv')).toBe(true);
});

test('T3: grids over both faces of an ellipsoid, within its edge', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, t3Ply());
  await setFlake(page);
  await page.evaluate(() => window.lithicanalyst.view([0, 0, 1], [0, 1, 0]));
  await nextFrames(page);
  await page.keyboard.press('t');
  const onTop = (x: number, y: number): Vec3 => [x, y, 8 * Math.sqrt(Math.max(0, 1 - (x / 40) ** 2 - (y / 25) ** 2))];
  const s = await toScreen(page, onTop(-38, 0));
  const e = await toScreen(page, onTop(20, 0));
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(e.x, e.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.flake()))?.axis?.matrix ?? null).not.toBeNull();
  if (await page.locator('#profile-panel').isVisible()) await page.locator('#profile-close').click();
  await nextFrames(page);
  await page.keyboard.press('p');
  const ring = Array.from({ length: 16 }, (_, k) => onTop(0.97 * 40 * Math.cos(Math.PI + (2 * Math.PI * k) / 16), 0.97 * 25 * Math.sin(Math.PI + (2 * Math.PI * k) / 16)));
  for (const p of ring) await curveClick(page, await toScreen(page, p), { shift: true });
  const first = await toScreen(page, ring[0]);
  await page.mouse.move(first.x, first.y, { steps: 3 });
  await page.keyboard.down('Shift');
  await page.mouse.click(first.x, first.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await state(page)).curves[0]?.closed ?? false).toBe(true);
  await page.keyboard.press('v');
  await page.keyboard.press('2');
  await openSection(page, 'gm');
  for (const id of ['#gm-fixed-platform_left', '#gm-fixed-platform_right', '#gm-platformOutline-on', '#gm-platform-on']) await page.locator(id).uncheck();
  await expect.poll(async () => (await gm(page))?.complete ?? false).toBe(true);
  const r = (await gm(page))!;
  const ventral = r.rows.filter((x) => x.setId === 'ventral'), dorsal = r.rows.filter((x) => x.setId === 'dorsal');
  expect(ventral.length).toBe(150);
  expect(dorsal.length).toBe(150);
  // on the surface, the two faces on either side of the model's middle
  const off = (p: Vec3) => Math.abs(Math.hypot(p[0] / 40, p[1] / 25, p[2] / 8) - 1);
  for (const x of [...ventral, ...dorsal]) expect(off(x.point)).toBeLessThan(0.03);
  expect(new Set(ventral.map((x) => Math.sign(x.point[2])))).toEqual(new Set([Math.sign(ventral[0].point[2])]));
  expect(Math.sign(ventral[0].point[2])).toBe(-Math.sign(dorsal[0].point[2]));
});

test('a folder has one configuration: in its own file; the summary makes the points anew by it, and lists what it skips', async ({ page }) => {
  await mockFolder(page, 'dig', { 'a.ply': t1Ply().buffer, 'b.ply': t2Ply().buffer });
  await openApp(page);
  await openMockFolder(page);
  const meshName = () => page.evaluate(() => window.lithicanalyst.state().mesh?.fileName ?? null);
  const FILE = 'LithicAnalyst/gm-config.json';
  await expect.poll(meshName).toBe('a.ply');
  await setFlake(page);
  await annotate(page);
  await expect.poll(async () => (await gm(page))?.complete ?? false).toBe(true);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.state().modifiedAt)).toBeTruthy();

  // the next model: a flake too, with only its axis; the configuration changed there is the folder's
  await page.locator('#workspace-next').click();
  await expect.poll(meshName).toBe('b.ply');
  await drawAxis(page);
  await page.keyboard.press('v');
  await openSection(page, 'gm');
  await setNumber(page, '#gm-edge-points', 12);
  await expect.poll(async () => JSON.parse((await folderText(page, FILE)) ?? '{}').edge?.points).toBe(12);

  // the first model opens by it
  await page.locator('#workspace-prev').click();
  await expect.poll(meshName).toBe('a.ply');
  expect((await state(page)).gm.edge.points).toBe(12);
  await expect.poll(async () => (await gm(page))?.rows.length).toBe(DEFAULT_TOTAL - 38);
  await page.locator('#workspace-next').click();
  await expect.poll(meshName).toBe('b.ply');

  // the summary, from the other model: a's stored points are of this configuration only once it was opened
  await page.locator('#btn-export').click();
  await page.locator('#export-scope-folder').click();
  await page.locator('.modal [data-choice="export"]').click();
  const find = async (name: string) => (await folderPaths(page)).find((p) => new RegExp(`^LithicAnalyst/exports/[^/]+/${name}$`).test(p)) ?? null;
  await expect.poll(() => find('manifest\\.json'), { timeout: 60_000 }).not.toBeNull();
  const rows = parseCsv((await folderText(page, (await find('gm_landmarks\\.csv'))!))!);
  expect(new Set(rows.map((r) => r.specimen_id))).toEqual(new Set(['a']));
  expect(rows.length).toBe(DEFAULT_TOTAL - 38);
  const tps = (await folderText(page, (await find('gm_landmarks\\.tps'))!))!;
  expect(tps.match(/LM3=/g)!.length).toBe(1);
  expect(await find('gm_curves\\.csv')).not.toBeNull();
  expect(await find('gm_surfaces\\.csv')).not.toBeNull();
  const manifest = JSON.parse((await folderText(page, (await find('manifest\\.json'))!))!);
  expect(manifest.parameters.gm.edge.points).toBe(12);
  expect(manifest.gmSkipped).toEqual([{ file: 'b.ply', id: 'b', missing: ['platform_ends', 'edge', 'platform_outline'] }]);
  // the model that was open stays open
  await expect.poll(meshName).toBe('b.ply');
});

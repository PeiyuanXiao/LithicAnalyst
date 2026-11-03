import { boxPly, boxPoint, T4, t4Ply } from './fixtures/meshes';
import { closeDraftToward, curveClick, expect, loadMesh, nextFrames, openApp, openSection, parseCsv, state, test, toScreen } from './helpers';

const regionsOf = (page: import('@playwright/test').Page) => page.evaluate(() => window.lithicanalyst.regions());

test('a core: flaking surfaces between its edges, scars lying in them; custom is the last key', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, t4Ply());
  await page.evaluate(() => window.lithicanalyst.view([0, 0, 1], [0, 1, 0]));
  await nextFrames(page);
  await page.evaluate(() => window.lithicanalyst.snap.prepare('ridge'));
  // the edge round the bicone
  await page.keyboard.press('p');
  const rim = (deg: number): [number, number, number] => [0.97 * T4.radius * Math.cos((deg * Math.PI) / 180), 0.97 * T4.radius * Math.sin((deg * Math.PI) / 180), 0.03 * T4.upper];
  for (const d of [0, 90, 180, 270]) await curveClick(page, await toScreen(page, rim(d)));
  await closeDraftToward(page, [0, 0, T4.upper]);
  await expect.poll(async () => (await state(page)).curves[0]?.closed ?? false).toBe(true);
  await page.keyboard.press('v');
  await page.keyboard.press('2');

  // a scar's outline on the upper cone
  await page.keyboard.press('p');
  const on = (x: number, y: number): [number, number, number] => [x, y, 8 * (1 - Math.hypot(x, y) / 30)];
  const corners = [on(5, 5), on(15, 5), on(15, 15), on(5, 15)];
  for (const p of corners) await curveClick(page, await toScreen(page, p), { shift: true });
  const start = await toScreen(page, corners[0]);
  await page.mouse.move(start.x, start.y, { steps: 3 });
  await page.keyboard.down('Shift');
  await page.mouse.click(start.x, start.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await state(page)).curves.length).toBe(2);
  await page.keyboard.press('v');
  await page.keyboard.press('1');

  // the region tool: beside the scar, a surface (key 5); on the scar, a scar
  await page.keyboard.press('r');
  await openSection(page, 'regions');
  const beside = await toScreen(page, on(-10, -10));
  await page.mouse.click(beside.x, beside.y);
  await expect.poll(async () => (await state(page)).regions.length).toBe(1);
  await expect(page.locator('#region-inspector .opt-btn')).toHaveText(['1Scar', '2Cortex', '3Joint surface', '4Damage', '5Flaking surface', '6Platform', '7Retouch', '8Custom']);
  await page.keyboard.press('5');
  await expect.poll(async () => (await state(page)).regions[0].type).toBe('flaking_surface');
  await expect.poll(async () => (await regionsOf(page))?.totals.flaking_surface ?? 0).toBeGreaterThan(2000);
  const whole = (await regionsOf(page))!.totals.flaking_surface;
  const inside = await toScreen(page, on(10, 10));
  await page.mouse.click(inside.x, inside.y);
  await expect.poll(async () => (await state(page)).regions.length).toBe(2);
  await expect.poll(async () => (await regionsOf(page))?.results.find((r) => r.type === 'scar')?.parent ?? null).not.toBeNull();
  const res = (await regionsOf(page))!;
  const surface = res.results.find((r) => r.type === 'flaking_surface')!;
  const scar = res.results.find((r) => r.type === 'scar')!;
  expect(scar.parent).toBe(surface.id);
  // the surface keeps the whole cone: 2π·30·√(30² + 8²) / 2
  expect(Math.abs(whole - Math.PI * 30 * Math.hypot(30, 8))).toBeLessThan(40);
  expect(res.totals.flaking_surface).toBe(whole);
  expect(scar.area!).toBeLessThan(150);
  // the scars of the region: another scar can be chosen
  await expect(page.locator('#region-scar')).toBeVisible();

  const rows = parseCsv(await page.evaluate(() => window.lithicanalyst.exportRegionsCsvText()));
  expect(Object.keys(rows[0])).toEqual(['specimen_id', 'region_id', 'type', 'scar_id', 'area', 'unit', 'parent_region', 'retouch_layer']);
  expect(rows.find((r) => r.type === 'scar')!.parent_region).toBe(surface.label);

  // custom: the last key
  await page.keyboard.press('8');
  await expect(page.locator('#region-type-text')).toBeVisible();
  await page.locator('#region-type-text').fill('修理面');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).regions.find((r) => r.id === scar.id)?.type).toBe('修理面');
  await expect(page.locator('#region-type-custom')).toContainText('修理面');
});

test('a core without edges: the whole of it is one surface, and two seeds there conflict', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, boxPly());
  await page.evaluate(() => window.lithicanalyst.view([0, 0, 1], [0, 1, 0]));
  await nextFrames(page);
  await page.keyboard.press('r');
  await openSection(page, 'regions');
  const at = await toScreen(page, boxPoint(0, 0, 5));
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await state(page)).regions.length).toBe(1);
  await page.keyboard.press('5');
  await expect.poll(async () => (await regionsOf(page))?.totals.flaking_surface ?? 0).toBeGreaterThan(1000);
  // the whole surface, not divided further: a click selects it
  await page.keyboard.press('Escape');
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.selection())).toBe((await state(page)).regions[0].id);
  expect((await state(page)).regions.length).toBe(1);
});

import { SPHERE, spherePly } from './fixtures/meshes';
import { expect, loadMesh, nextFrames, openApp, parseCsv, state, test, toScreen } from './helpers';

test('fits a sphere to the cortex and reports its radius', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, spherePly());
  await page.evaluate(() => window.lithicanalyst.view([0, 0, 1], [0, 1, 0]));
  await nextFrames(page);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.regionCount())).toBe(1);

  // the whole surface is one piece: make it cortex
  await page.keyboard.press('r');
  const s = await toScreen(page, [SPHERE.center[0] + 3, SPHERE.center[1] + 2, SPHERE.center[2] + Math.sqrt(400 - 13)]);
  await page.mouse.click(s.x, s.y);
  await expect.poll(async () => (await state(page)).regions.length).toBe(1);
  await page.keyboard.press('2');
  await expect.poll(async () => (await state(page)).regions[0]?.type).toBe('cortex');

  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.nodule()))?.radius ?? 0).toBeGreaterThan(0);
  const fit = (await page.evaluate(() => window.lithicanalyst.nodule()))!;
  expect(fit.radius).toBeCloseTo(SPHERE.radius, 3);
  fit.center.forEach((x, k) => expect(x).toBeCloseTo(SPHERE.center[k], 3));
  expect(fit.rms).toBeLessThan(1e-3);

  await page.keyboard.press('m');
  await expect(page.locator('#nodule-radius')).toHaveText('20.000');
  await expect(page.locator('#nodule-radius-unit')).toHaveText('mm');
  await page.locator('#nodule-show').check();
  expect((await state(page)).nodule.show).toBe(true);
  const [row] = parseCsv(await page.evaluate(() => window.lithicanalyst.exportMeasurementsCsvText()));
  expect(Number(row.nodule_radius)).toBeCloseTo(20, 3);
  expect(Number(row.cortex_ratio)).toBeCloseTo(1, 6);

  // leave the only cortex region out: no sphere; undo brings it back
  await page.locator('#nodule-use-R1').uncheck();
  await expect(page.locator('#nodule-radius')).toHaveCount(0);
  expect(await page.evaluate(() => window.lithicanalyst.nodule())).toBeNull();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#nodule-radius')).toHaveText('20.000');

  const saved = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(saved.derived.nodule!.radius).toBeCloseTo(20, 3);
});

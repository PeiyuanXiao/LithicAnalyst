import type { Page } from '@playwright/test';
import { T4, t4Ply, type Vec3 } from './fixtures/meshes';
import { closeDraftToward, curveClick, expect, exportFile, loadMesh, nextFrames, openApp, openSection, parseCsv, setUnit, state, test, toScreen } from './helpers';

const HEADER = 'specimen_id,curve_id,curve_type,station,position,distance,method,angle_deg,working_edge';
const ANGLE = (Math.atan(8 / 30) * 180) / Math.PI + (Math.atan(5 / 30) * 180) / Math.PI;

/** Just inside the edge, seen from above: the point snaps onto it. */
const rimPoint = (deg: number): Vec3 => [0.97 * T4.radius * Math.cos((deg * Math.PI) / 180), 0.97 * T4.radius * Math.sin((deg * Math.PI) / 180), 0.03 * T4.upper];
const angles = (page: Page, id: string) => page.evaluate((c) => window.lithicanalyst.edgeAngles(c), id);

/** Round the bicone's edge, seen from above, with the curve tool; the type by its key. */
async function drawEdge(page: Page): Promise<string> {
  await page.evaluate(() => window.lithicanalyst.view([0, 0, 1], [0, 1, 0]));
  await nextFrames(page);
  await page.evaluate(() => window.lithicanalyst.snap.prepare('ridge'));
  await page.keyboard.press('p');
  for (const d of [0, 90, 180, 270]) await curveClick(page, await toScreen(page, rimPoint(d)));
  await closeDraftToward(page, [0, 0, T4.upper]);
  await expect.poll(async () => (await state(page)).curves[0]?.closed ?? false).toBe(true);
  await page.keyboard.press('v');
  await page.keyboard.press('2');
  await expect.poll(async () => (await state(page)).curves[0].attributes.type).toBe('core_edge');
  return (await state(page)).curves[0].id;
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await loadMesh(page, t4Ply());
});

test('the edge of the bicone: results and edge_angles.csv; the curve drawn by its angles; off, they are gone', async ({ page }) => {
  const id = await drawEdge(page);
  // a core's edge is measured by default
  await expect(page.locator('#curve-edge-angle')).toBeChecked();
  await expect.poll(async () => (await angles(page, id))?.stations.length ?? 0).toBeGreaterThan(150);
  const r = (await angles(page, id))!;
  expect(r.distances).toEqual([2, 5, 10]);
  for (const s of r.stations.filter((_, k) => k % 10 === 0)) for (const a of [...s.three_points, ...s.two_lines]) expect(Math.abs(a! - ANGLE)).toBeLessThan(2);

  // the measure mode: the selected curve by its angles, a scale with two numbers, the chart
  await page.locator('#app-mode-measure').click();
  await expect(page.locator('#sec-edge-angle')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.edgeColors())).not.toBeNull();
  await expect(page.locator('#edge-legend')).toBeVisible();
  await expect(page.locator('#edge-legend .edge-legend-value')).toHaveCount(2);
  await openSection(page, 'edge-angle');
  await expect(page.locator('#edge-chart .edge-chart-line')).toHaveCount(3);
  await expect(page.locator('#edge-chart-legend .edge-chart-key')).toHaveText(['2 mm', '5 mm', '10 mm']);
  const key = await page.evaluate(() => window.lithicanalyst.edgeColors()?.key);
  await page.locator('#edge-method-two_lines').click();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.edgeColors()?.key)).not.toBe(key);
  // hovering reads every line at the nearest station
  const plot = (await page.locator('#edge-chart').boundingBox())!;
  await page.mouse.move(plot.x + plot.width / 2, plot.y + plot.height / 2);
  await expect(page.locator('.edge-chart-cross')).toHaveAttribute('visibility', 'visible');
  await expect(page.locator('.edge-chart-dot').first()).toHaveAttribute('visibility', 'visible');
  // the position and a line for each distance, within the window
  await expect(page.locator('.tip span')).toHaveCount(4);
  const tip = (await page.locator('.tip').boundingBox())!;
  expect(tip.x + tip.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await page.locator('.tip').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);

  // the export: one row per station, distance and method
  const out = await exportFile(page, 'edge-angles');
  expect(out.name).toBe('t4_edge_angles.csv');
  expect(out.text.trim().split('\n')[0]).toBe(HEADER);
  const rows = parseCsv(out.text);
  expect(rows.length).toBe(r.stations.length * 3 * 2);
  expect(rows[0]).toMatchObject({ curve_id: 'C1', curve_type: 'core_edge', station: '0', position: '0', distance: '2', method: 'three_points' });
  expect(rows.at(-1)).toMatchObject({ distance: '10', method: 'two_lines' });
  expect(Math.abs(Number(rows[0].angle_deg) - ANGLE)).toBeLessThan(2);

  // switched off: no results, no section, nothing exported
  await page.locator('#app-mode-annotate').click();
  await openSection(page, 'curves');
  await page.locator('#curve-edge-angle').uncheck();
  await expect.poll(() => angles(page, id)).toBeNull();
  expect((await page.evaluate(() => window.lithicanalyst.exportEdgeAnglesCsvText())).trim()).toBe(HEADER);
  await page.locator('#app-mode-measure').click();
  await expect(page.locator('#sec-edge-angle')).toBeHidden();
  await expect(page.locator('#edge-legend')).toBeHidden();
  // and back, one undo step at a time
  await page.locator('#app-mode-annotate').click();
  await page.locator('#curve-edge-angle').check();
  await expect.poll(async () => (await angles(page, id))?.stations.length ?? 0).toBeGreaterThan(150);
});

test('without a stated unit nothing is measured, and it says so', async ({ page }) => {
  const id = await drawEdge(page);
  await expect.poll(async () => (await angles(page, id))?.stations.length ?? 0).toBeGreaterThan(150);
  await setUnit(page, '');
  await expect.poll(() => angles(page, id)).toBeNull();
  await openSection(page, 'curves');
  await expect(page.locator('#curve-edge-no-unit')).toBeVisible();
  await page.locator('#app-mode-measure').click();
  await expect(page.locator('#edge-no-unit')).toBeVisible();
  // stated again: measured again
  await setUnit(page, 'mm');
  await expect.poll(async () => (await angles(page, id))?.stations.length ?? 0).toBeGreaterThan(150);
});

test('the results and their parameters go into the project file', async ({ page }) => {
  const id = await drawEdge(page);
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.projectJson())).derived.edgeAngles?.curves[0]?.curveId ?? null).toBe(id);
  const file = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(file.derived.edgeAngles?.parameters).toEqual({ SMOOTH_WINDOW_MM: 5, EDGE_ANGLE_STEP_MM: 1, EDGE_ANGLE_DISTANCES_MM: [2, 5, 10], TWO_LINES_LENGTH_MM: 0.5 });
});

import type { Page } from '@playwright/test';
import { T4, twoAnglePly, type Vec3 } from './fixtures/meshes';
import { closeDraftToward, curveClick, expect, loadMesh, nextFrames, openApp, openSection, parseCsv, state, test, toScreen } from './helpers';

const ON = (r: number, deg: number, z: number): Vec3 => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180), z];
/** Just inside the edge, seen from above: the point snaps onto it. */
const rimPoint = (deg: number): Vec3 => ON(0.97 * T4.radius, deg, 0.03 * 3 * T4.upper);
const rim = (deg: number): Vec3 => ON(T4.radius, deg, 0);
const cell = (page: Page, method: string, d: number) => page.locator(`#edge-mean-${method}-${d}`);
const value = async (page: Page, method: string, d: number) => Number(await cell(page, method, d).textContent());

/** The two-angle bicone as a flake: its edge (about 24° on one half, 65° on the other), and a working edge on each half. */
async function twoHalves(page: Page): Promise<string> {
  await openApp(page, 'flake');
  await loadMesh(page, twoAnglePly());
  await page.evaluate(() => window.lithicanalyst.view([0, 0, 1], [0, 1, 0]));
  await nextFrames(page);
  await page.evaluate(() => window.lithicanalyst.snap.prepare('ridge'));
  await page.keyboard.press('p');
  for (const d of [0, 90, 180, 270]) await curveClick(page, await toScreen(page, rimPoint(d)));
  await closeDraftToward(page, [0, 0, 3 * T4.upper]);
  await expect.poll(async () => (await state(page)).curves[0]?.closed ?? false).toBe(true);
  await page.keyboard.press('v');
  await page.keyboard.press('2');
  await expect.poll(async () => (await state(page)).curves[0].attributes.type).toBe('edge');
  const edge = (await state(page)).curves[0].id;
  await expect.poll(() => page.evaluate((id) => window.lithicanalyst.edgeAngles(id)?.stations.length ?? 0, edge)).toBeGreaterThan(150);
  // E1 and E2, a half each
  await page.keyboard.press('w');
  const clickRim = async (deg: number) => {
    const s = await toScreen(page, rim(deg));
    await page.mouse.move(s.x, s.y);
    await page.mouse.click(s.x, s.y);
  };
  for (const [k, [a, b]] of [[0, 180], [180, 0]].entries()) {
    await clickRim(a);
    await expect.poll(() => page.evaluate(() => window.lithicanalyst.workingEdges().pending)).not.toBeNull();
    await clickRim(b);
    await expect.poll(async () => (await state(page)).workingEdges.length).toBe(k + 1);
  }
  await page.keyboard.press('v');
  return edge;
}

test('the table of means: by method and distance, over the curve or a working edge; a click shows a cell; it follows the rule; it replaces the two rows of buttons', async ({ page, pageErrors }) => {
  const edge = await twoHalves(page);
  await page.locator('#app-mode-measure').click();
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), edge);
  await openSection(page, 'edge-angle');
  await expect(page.locator('#edge-mean-table')).toBeVisible();
  // the method and distance buttons are gone
  await expect(page.locator('[id^="edge-method-"]')).toHaveCount(0);
  await expect(page.locator('[id^="edge-series-"]')).toHaveCount(0);
  await expect(page.locator('#edge-mean-table thead th')).toHaveText(['°', '2 mm', '5 mm', '10 mm']);
  await expect(page.locator('#edge-mean-table tbody tr')).toHaveCount(2);

  // all of the curve: the plain mean of the stations with a value
  const r = (await page.evaluate((id) => window.lithicanalyst.edgeAngles(id), edge))!;
  for (const [m, i, d] of [['three_points', 0, 2], ['two_lines', 2, 10]] as const) {
    const vals = r.stations.map((s) => s[m][i]).filter((v): v is number => v !== null);
    expect(Math.abs((await value(page, m, d)) - vals.reduce((a, b) => a + b, 0) / vals.length)).toBeLessThan(0.06);
  }
  const whole = await value(page, 'three_points', 2);

  // a working edge: its own stations, as working_edges.csv has them
  const rows = parseCsv(await page.evaluate(() => window.lithicanalyst.exportWorkingEdgesCsvText()));
  await page.locator('#edge-view-E1').click();
  const e1 = await value(page, 'three_points', 2);
  expect(Math.abs(e1 - Number(rows.find((x) => x.working_edge === 'E1')!.edge_angle_3pt_2mm))).toBeLessThan(0.06);
  await page.locator('#edge-view-E2').click();
  const e2 = await value(page, 'three_points', 2);
  expect(Math.abs(e2 - Number(rows.find((x) => x.working_edge === 'E2')!.edge_angle_3pt_2mm))).toBeLessThan(0.06);
  // the two halves differ, and the whole lies between them
  expect(Math.abs(e1 - e2)).toBeGreaterThan(20);
  expect(whole).toBeGreaterThan(Math.min(e1, e2));
  expect(whole).toBeLessThan(Math.max(e1, e2));
  await page.locator('#edge-view-all').click();

  // a click on a cell: the chart and the colours by its method and distance; the cell stays marked
  const lines = page.locator('#edge-chart .edge-chart-line');
  await expect(lines).toHaveCount(3);
  await cell(page, 'two_lines', 5).click();
  await expect(lines).toHaveCount(1);
  await expect(lines).toHaveAttribute('data-series', 'd5');
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.edgeColors()?.key ?? '')).toContain('|two_lines|d5|');
  await expect(cell(page, 'two_lines', 5)).toHaveClass(/is-chosen/);
  await expect(page.locator('#edge-mean-table td.is-chosen')).toHaveCount(1);
  // the name of a row: all its distances
  await page.locator('#edge-mean-row-three_points').click();
  await expect(lines).toHaveCount(3);
  await expect(page.locator('#edge-mean-table td.is-chosen')).toHaveCount(3);
  await expect(page.locator('#edge-mean-row-three_points')).toHaveClass(/is-chosen/);

  // the pointer on a cell: its SD and stations, the stations on the model, its mean on the chart
  await cell(page, 'three_points', 10).hover();
  await expect(page.locator('#edge-chart-mean')).toBeAttached();
  await expect(page.locator('.tip')).toContainText('SD');
  await expect(page.locator('.tip')).toContainText('stations');
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.measureHint().key)).toBe(`edgemean:${edge}||three_points|2`);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.measureHint().drawn?.dots ?? 0)).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/31/means-hover.png' });
  await page.locator('#sec-edge-angle').screenshot({ path: 'test-results/31/means-card.png' });
  await page.mouse.move(0, 0);
  await expect(page.locator('#edge-chart-mean')).toHaveCount(0);

  // the rule of the sharp edge chooses too
  await page.locator('#sharp-method').selectOption('two_lines');
  await expect(cell(page, 'two_lines', 2)).toHaveClass(/is-chosen/);
  await expect(page.locator('#edge-mean-table td.is-chosen')).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});

test('a working edge\'s note; a curve hidden is not coloured, nor are its working edges drawn', async ({ page }) => {
  const edge = await twoHalves(page);
  const e1 = (await state(page)).workingEdges[0].id;
  await openSection(page, 'working-edges');
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), e1);
  await page.locator('#working-edge-note').click();
  await page.keyboard.type('used', { delay: 20 });
  await page.locator('#working-edge-note').blur();
  await expect.poll(async () => (await state(page)).workingEdges[0].note).toBe('used');
  const out = parseCsv(await page.evaluate(() => window.lithicanalyst.exportWorkingEdgesCsvText()));
  expect(Object.keys(out[0]).slice(-7)).toEqual(['edge_angle_3pt_2mm', 'edge_angle_3pt_5mm', 'edge_angle_3pt_10mm', 'edge_angle_2ln_2mm', 'edge_angle_2ln_5mm', 'edge_angle_2ln_10mm', 'note']);
  expect(out.map((x) => x.note)).toEqual(['used', '']);
  await page.locator('#btn-undo').click();
  await expect.poll(async () => (await state(page)).workingEdges[0].note).toBe('');

  // in the measure mode the selected curve is coloured by its angles, with ticks for its working edges; hidden, neither
  await page.locator('#app-mode-measure').click();
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), edge);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.drawn().edgeColored)).toBe(edge);
  expect((await page.evaluate(() => window.lithicanalyst.drawn())).workingEdges).toHaveLength(2);
  await page.evaluate((id) => window.lithicanalyst.setHidden(id, true), edge);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.drawn().edgeColored)).toBeNull();
  expect((await page.evaluate(() => window.lithicanalyst.drawn())).workingEdges).toEqual([]);
  // its working edge alone
  await page.evaluate((id) => window.lithicanalyst.setHidden(id, false), edge);
  await page.evaluate((id) => window.lithicanalyst.setHidden(id, true), e1);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.drawn().workingEdges.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.drawn().edgeColored)).toBe(edge);
});

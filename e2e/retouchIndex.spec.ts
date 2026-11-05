import type { Page } from '@playwright/test';
import { heightAt, T4, T1, t1Ply, toolPly, type Vec3 } from './fixtures/meshes';
import { closeDraftToward, curveClick, expect, exportFile, folderPaths, folderText, loadMesh, mockFolder, nextFrames, openApp, openMockFolder, parseCsv, specimenPanel, state, test, toScreen } from './helpers';

const ON = (r: number, deg: number, z: number): Vec3 => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180), z];
const onTool = (r: number, deg: number): Vec3 => ON(r, deg, heightAt(r));
const rimPoint = (deg: number): Vec3 => ON(0.97 * T4.radius, deg, 0.03 * T4.upper);
const around = (count: number) => Array.from({ length: count }, (_, k) => (360 * k) / count);

const retouch = (page: Page) => page.evaluate(() => window.lithicanalyst.retouch());
const NEW_COLUMNS = ['retouch_axis', 'retouch_fit_length', 'removed_volume', 'erp', 'erp_filled_share', 'giur', 'giur_stations', 'invasiveness', 'invasiveness_continuous', 'retouch_perimeter', 'retouch_perimeter_dorsal', 'retouch_perimeter_ventral', 'edge_curvature', 'edge_curvature_chord', 'edge_curvature_depth'];

async function setFlake(page: Page): Promise<void> {
  await specimenPanel(page);
  await page.locator('#specimen-type').selectOption('flake');
  await page.keyboard.press('Escape');
}

const look = async (page: Page, toward: Vec3, up: Vec3) => {
  await page.evaluate(([t, u]) => window.lithicanalyst.view(t, u), [toward, up] as [Vec3, Vec3]);
  await nextFrames(page);
};

/** A closed curve through these points, seen from above; then its type by its key. */
async function drawLoop(page: Page, points: Vec3[], key: string, inward: Vec3): Promise<string> {
  const n = (await state(page)).curves.length;
  await look(page, [0, 0, 1], [0, 1, 0]);
  await page.evaluate(() => window.lithicanalyst.snap.prepare('ridge'));
  await page.keyboard.press('p');
  for (const p of points) await curveClick(page, await toScreen(page, p));
  await closeDraftToward(page, inward);
  await expect.poll(async () => (await state(page)).curves[n]?.closed ?? false).toBe(true);
  await page.keyboard.press('v');
  await page.keyboard.press(key);
  return (await state(page)).curves[n].id;
}

/** Click on the model with the region tool, and give what comes selected its type by its key. */
async function regionAt(page: Page, p: Vec3, key: string): Promise<string> {
  const n = (await state(page)).regions.length;
  const s = await toScreen(page, p);
  await page.mouse.click(s.x, s.y);
  await expect.poll(async () => (await state(page)).regions.length).toBe(n + 1);
  await page.keyboard.press(key);
  return (await state(page)).regions[n].id;
}

/** The stepped tool as a flake: its edge, the two borders of retouch, the two layers, the two faces. */
async function annotatedTool(page: Page): Promise<{ edge: string; first: string; second: string }> {
  await loadMesh(page, toolPly());
  await setFlake(page);
  const edge = await drawLoop(page, around(4).map(rimPoint), '2', [0, 0, T4.upper]);
  await expect.poll(async () => (await state(page)).curves[0].attributes.type).toBe('edge');
  await drawLoop(page, around(8).map((d) => onTool(24, d)), '6', [0, 0, 8]);
  await expect.poll(async () => (await state(page)).curves[1].attributes.type).toBe('retouch');
  await drawLoop(page, around(8).map((d) => onTool(12, d)), '6', [0, 0, 8]);
  await look(page, [0, 0, 1], [0, 1, 0]);
  await page.keyboard.press('r');
  const first = await regionAt(page, onTool(27, 45), '8');
  const second = await regionAt(page, onTool(18, 45), '8');
  await page.keyboard.press('Shift+Digit2');
  await expect.poll(async () => (await state(page)).regions[1].retouchLayer).toBe(2);
  // the two faces, by hand: there is no technical axis to tell them
  await regionAt(page, onTool(5, 45), '7');
  await look(page, [0, 0, -1], [0, 1, 0]);
  await regionAt(page, [10, 10, 0], '6');
  await expect.poll(async () => (await state(page)).regions.map((r) => r.type)).toEqual(['retouch', 'retouch', 'dorsal', 'ventral']);
  await page.keyboard.press('v');
  await page.locator('#app-mode-measure').click();
  return { edge, first, second };
}

test('the stepped tool: the indices of two layers and of one, and of another fitted length', async ({ page }) => {
  await openApp(page);
  const { first, second } = await annotatedTool(page);
  await expect.poll(async () => (await retouch(page))?.segments.length ?? 0).toBe(2);
  await expect.poll(async () => (await retouch(page))?.invasiveness ?? null).toBe(0.5);

  const r = (await retouch(page))!;
  expect(r.axis).toBe('longest');
  expect(r.fitLength).toBe(5);
  expect(Math.abs(r.giur! - 0.941)).toBeLessThan(0.015);
  expect(r.retouch_perimeter).toBeCloseTo(1, 6);
  expect(r.edge_curvature).toBeNull();
  expect(r.reasons.edge_curvature).toBe('whole_edge');
  expect(Math.abs(r.invasiveness_continuous! - 0.45)).toBeLessThanOrEqual(0.02);
  expect(r.erp).toBeGreaterThan(0);
  expect(r.erp).toBeLessThan(1);
  expect(r.retouch_perimeter_dorsal).toBeCloseTo(1, 6);
  expect(r.retouch_perimeter_ventral).toBe(0);
  // the curve need not follow mesh edges: the faces and the fits still hold at the stations
  expect(r.erp_filled_share).toBeLessThan(0.05);
  expect(r.giur_stations).toBe(r.stations.length);

  // flakes.csv ends with the fifteen columns
  const flakes = await exportFile(page, 'flakes');
  expect(flakes.text.trim().split('\n')[0].split(',').slice(-15)).toEqual(NEW_COLUMNS);
  const [row] = parseCsv(flakes.text);
  expect(row.retouch_axis).toBe('longest');
  expect(row.retouch_fit_length).toBe('5');
  expect(row.edge_curvature).toBe('');
  expect(row.retouch_perimeter).toBe('1');
  expect(row.invasiveness).toBe('0.5');
  expect(Number(row.giur)).toBeCloseTo(r.giur!, 5);
  expect(Number(row.erp)).toBeCloseTo(r.erp!, 5);

  // the three new files
  const sections = await exportFile(page, 'retouch-sections');
  expect(sections.name).toBe('tool_retouch_sections.csv');
  expect(sections.text.trim().split('\n')[0]).toBe('specimen_id,curve_id,station,position,segment,x,y,depth_dorsal,depth_ventral,removed_area,filled,original_angle_deg,recession,retouch_height,thickness,giur');
  const rows = parseCsv(sections.text);
  expect(rows.length).toBe(r.stations.length);
  expect(rows.length).toBeGreaterThan(150);
  expect(new Set(rows.map((x) => x.curve_id))).toEqual(new Set(['C1']));
  const inv = await exportFile(page, 'invasiveness');
  expect(inv.name).toBe('tool_invasiveness.csv');
  const invRows = parseCsv(inv.text);
  expect(invRows.length).toBe(16);
  expect(invRows.map((x) => x.segment)).toEqual(Array.from({ length: 16 }, (_, i) => String(i + 1)));
  const seg = await exportFile(page, 'retouch-segments');
  expect(seg.name).toBe('tool_retouch_segments.csv');
  const segRows = parseCsv(seg.text);
  expect(segRows.map((x) => [x.retouch_region, x.retouch_layer, x.face])).toEqual([['R1', '1', 'dorsal'], ['R2', '2', 'dorsal']]);
  for (const x of segRows) expect(Math.abs(Number(x.length) - rows.length)).toBeLessThan(3);

  // the file holds them, without the reasons
  const file = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(file.flake.retouch).toEqual({ fitLength: null, axis: 'auto', flip: false });
  expect(file.derived.retouchIndices?.stations.length).toBe(rows.length);
  expect(JSON.stringify(file.derived.retouchIndices)).not.toContain('reason');

  // the second layer gone
  await page.locator('#app-mode-annotate').click();
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), second);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await retouch(page))?.invasiveness ?? null).toBe(0.3125);
  await expect.poll(async () => Math.abs(((await retouch(page))?.giur ?? 0) - 0.706)).toBeLessThan(0.015);
  await expect.poll(async () => (await retouch(page))?.segments.map((s) => s.region)).toEqual([first]);
  const erp5 = (await retouch(page))!.erp!;

  // a longer fit reaches further up the slope: the original edge lay further out
  await page.evaluate(() => window.lithicanalyst.retouchSettings({ fitLength: 20 }));
  await expect.poll(async () => (await retouch(page))?.fitLength).toBe(20);
  expect((await retouch(page))!.erp!).toBeGreaterThan(erp5);
  await page.locator('#app-mode-measure').click();
  expect(parseCsv((await exportFile(page, 'flakes')).text)[0].retouch_fit_length).toBe('20');
  expect((await state(page)).flake.retouch?.fitLength).toBe(20);
  await page.locator('#btn-undo').click();
  await expect.poll(async () => (await retouch(page))?.fitLength).toBe(5);
  expect(parseCsv((await exportFile(page, 'flakes')).text)[0].retouch_fit_length).toBe('5');
  expect((await retouch(page))!.erp).toBeCloseTo(erp5, 6);
});

test('the frame: the technical axis while there is one, then the longest axis', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, t1Ply());
  await setFlake(page);
  await expect.poll(async () => (await retouch(page)) !== null).toBe(true);
  // no retouch region: not retouched; no faces, so no frame
  let r = (await retouch(page))!;
  expect([r.erp, r.giur, r.invasiveness, r.retouch_perimeter]).toEqual([0, 0, 0, 0]);
  expect(r.reasons.edge_curvature).toBe('no_retouch_on_edge');
  expect(r.axis).toBeNull();

  // an edge round the ventral face, and the two faces by hand
  await look(page, [0, 0, -1], [-1, 0, 0]);
  await page.keyboard.press('p');
  const corners: Vec3[] = [[-14.7, 0.3, 0], [-14.7, 59.7, 0], [14.7, 59.7, 0], [14.7, 0.3, 0]];
  for (const p of corners) await curveClick(page, await toScreen(page, p), { shift: true });
  const start = await toScreen(page, corners[0]);
  await page.mouse.move(start.x, start.y, { steps: 3 });
  await page.keyboard.down('Shift');
  await page.mouse.click(start.x, start.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await state(page)).curves[0]?.closed ?? false).toBe(true);
  await page.keyboard.press('v');
  await page.keyboard.press('2');
  await expect.poll(async () => (await state(page)).curves[0].attributes.type).toBe('edge');
  await page.keyboard.press('r');
  await regionAt(page, [0, 30, 0], '6');
  await look(page, [0, 0, 1], [-1, 0, 0]);
  await regionAt(page, [0, 30, (10 * 30) / 62], '7');
  await page.keyboard.press('v');
  // without an axis the longest serves, as soon as the faces say which way is up
  await expect.poll(async () => (await retouch(page))?.axis).toBe('longest');

  // the technical axis
  await look(page, [0, 0, -1], [0, 1, 0]);
  await page.evaluate(() => window.lithicanalyst.snap.prepare('ridge'));
  await page.keyboard.press('t');
  const s = await toScreen(page, [0, 0.4, 0]);
  const e = await toScreen(page, T1.A);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(e.x, e.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).flake.axis?.matrix ?? null).not.toBeNull();
  await expect.poll(async () => (await retouch(page))?.axis).toBe('technical');
  r = (await retouch(page))!;
  expect(r.frame!.y0).toBe(0);
  expect(r.frame!.y1).toBeCloseTo(60, 0);
  await page.keyboard.press('v');
  await page.locator('#app-mode-measure').click();
  expect(parseCsv((await exportFile(page, 'flakes')).text)[0].retouch_axis).toBe('technical');

  // asked for by name: the longest, and the other way round
  await page.evaluate(() => window.lithicanalyst.retouchSettings({ axis: 'longest' }));
  await expect.poll(async () => (await retouch(page))?.axis).toBe('longest');
  const up = (await retouch(page))!.frame!.y;
  await page.evaluate(() => window.lithicanalyst.retouchSettings({ flip: true }));
  await expect.poll(async () => (await retouch(page))?.frame?.y[1]).toBeCloseTo(-up[1], 6);
  await page.evaluate(() => window.lithicanalyst.retouchSettings({ axis: 'auto', flip: false }));
  await expect.poll(async () => (await retouch(page))?.axis).toBe('technical');

  // the axis gone
  await page.locator('#app-mode-annotate').click();
  const id = (await state(page)).flake.axis!.id;
  await page.evaluate((x) => window.lithicanalyst.selectForTest(x), id);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await state(page)).flake.axis).toBeNull();
  await expect.poll(async () => (await retouch(page))?.axis).toBe('longest');
  await page.locator('#app-mode-measure').click();
  expect(parseCsv((await exportFile(page, 'flakes')).text)[0].retouch_axis).toBe('longest');
});

test('a core has none', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, t1Ply());
  await nextFrames(page, 6);
  expect(await retouch(page)).toBeNull();
  await page.locator('#app-mode-measure').click();
  await page.locator('#btn-export').click();
  await expect(page.locator('.export-list input[data-key="invasiveness"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  const file = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(file.derived.retouchIndices).toBeUndefined();
});

test('a folder: the summary has the indices of its flakes and the manifest their parameters', async ({ page }) => {
  await mockFolder(page, 'dig', { 'a.ply': t1Ply().buffer });
  await openApp(page);
  await openMockFolder(page);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.state().mesh?.fileName ?? null)).toBe('a.ply');
  await setFlake(page);
  await expect.poll(async () => (await retouch(page)) !== null).toBe(true);
  await page.locator('#app-mode-measure').click();
  await page.locator('#btn-export').click();
  await page.locator('#export-scope-folder').click();
  await page.locator('.modal [data-choice="export"]').click();
  const find = async (name: string) => (await folderPaths(page)).find((p) => new RegExp(`^LithicAnalyst/exports/[^/]+/${name}$`).test(p)) ?? null;
  await expect.poll(() => find('manifest\\.json')).not.toBeNull();
  const manifest = JSON.parse((await folderText(page, (await find('manifest\\.json'))!))!);
  expect(manifest.parameters.retouchIndex).toMatchObject({ ORIGINAL_FIT_MM: 5, OUTLINE_BINS: 200, INVASIVE_BOUNDARY: 0.5 });
  const [row] = parseCsv((await folderText(page, (await find('flakes\\.csv'))!))!);
  expect(row.retouch_fit_length).toBe('5');
  expect(row.erp).toBe('0');
  expect(parseCsv((await folderText(page, (await find('invasiveness\\.csv'))!))!).length).toBe(16);
});

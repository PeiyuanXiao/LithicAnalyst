import type { Page } from '@playwright/test';
import { heightAt, T4, t4Ply, toolPly, twoAnglePly, type Vec3 } from './fixtures/meshes';
import { setType } from './retouchSetup';
import { closeDraftToward, curveClick, expect, exportAvailable, exportFile, folderPaths, folderText, loadMesh, mockFolder, nextFrames, openApp, openMockFolder, openSection, parseCsv, state, test, toScreen } from './helpers';

const ON = (r: number, deg: number, z: number): Vec3 => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180), z];
const onTool = (r: number, deg: number): Vec3 => ON(r, deg, heightAt(r));
/** Just inside the edge, seen from above: the point snaps onto it. */
const rimPoint = (deg: number, height = T4.upper): Vec3 => ON(0.97 * T4.radius, deg, 0.03 * height);

const angles = (page: Page, id: string) => page.evaluate((c) => window.lithicanalyst.retouchAngles(c), id);
const sharp = (page: Page, id: string) => page.evaluate((c) => window.lithicanalyst.sharpEdge(c), id);
const fromAbove = async (page: Page) => {
  await page.evaluate(() => window.lithicanalyst.view([0, 0, 1], [0, 1, 0]));
  await nextFrames(page);
};

/** A closed curve through these points, seen from above; then its type by its key. */
async function drawLoop(page: Page, points: Vec3[], key: string, inward: Vec3): Promise<string> {
  const n = (await state(page)).curves.length;
  await fromAbove(page);
  await page.evaluate(() => window.lithicanalyst.snap.prepare('ridge'));
  await page.keyboard.press('p');
  for (const p of points) await curveClick(page, await toScreen(page, p));
  await closeDraftToward(page, inward);
  await expect.poll(async () => (await state(page)).curves[n]?.closed ?? false).toBe(true);
  await page.keyboard.press('v');
  await page.keyboard.press(key);
  return (await state(page)).curves[n].id;
}

const around = (count: number) => Array.from({ length: count }, (_, k) => (360 * k) / count);
const drawRim = (page: Page, height = T4.upper) => drawLoop(page, around(4).map((d) => rimPoint(d, height)), '2', [0, 0, height]);

test('retouch layers: the curves and regions, each layer\'s angles, retouch_angles.csv', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, toolPly());
  const edge = await drawRim(page);
  expect((await state(page)).curves[0].attributes.type).toBe('core_edge');
  // the two borders, of the type that is new; the user's own type is still the last key
  await drawLoop(page, around(8).map((d) => onTool(24, d)), '5', [0, 0, 8]);
  await expect.poll(async () => (await state(page)).curves[1].attributes.type).toBe('retouch');
  await drawLoop(page, around(8).map((d) => onTool(12, d)), '5', [0, 0, 8]);

  // the two tiers, in their layers
  await page.keyboard.press('r');
  await openSection(page, 'regions');
  const click = async (p: Vec3) => {
    const s = await toScreen(page, p);
    await page.mouse.click(s.x, s.y);
  };
  await click(onTool(27, 45));
  await expect.poll(async () => (await state(page)).regions.length).toBe(1);
  await expect(page.locator('#region-inspector .opt-btn')).toHaveText(['1Scar', '2Cortex', '3Joint surface', '4Damage', '5Flaking surface', '6Platform', '7Retouch', '8Custom']);
  await page.keyboard.press('7');
  await expect.poll(async () => (await state(page)).regions[0]).toMatchObject({ type: 'retouch', retouchLayer: 1 });
  await expect(page.locator('#region-layer-1')).toHaveAttribute('aria-checked', 'true');

  await click(onTool(18, 45));
  await expect.poll(async () => (await state(page)).regions.length).toBe(2);
  await page.keyboard.press('7');
  await page.keyboard.press('Shift+Digit2');
  await expect.poll(async () => (await state(page)).regions[1].retouchLayer).toBe(2);
  await expect(page.locator('#region-list .arrow-meta').nth(1)).toContainText('Layer 2');
  // by the control too, and undone
  await page.locator('#region-layer-3').click();
  await expect.poll(async () => (await state(page)).regions[1].retouchLayer).toBe(3);
  await page.locator('#btn-undo').click();
  await expect.poll(async () => (await state(page)).regions[1].retouchLayer).toBe(2);

  // the regions' table, and the area
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.regions()))?.totals.retouch ?? 0).toBeGreaterThan(500);
  const table = parseCsv(await page.evaluate(() => window.lithicanalyst.exportRegionsCsvText()));
  expect(table.map((r) => [r.type, r.retouch_layer])).toEqual([['retouch', '1'], ['retouch', '2']]);

  // the edge, in the measure mode: edge angles are a flake's, and what a core had shows there
  await page.keyboard.press('v');
  await setType(page, 'flake');
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), edge);
  await page.locator('#app-mode-measure').click();
  await openSection(page, 'edge-angle');
  await expect.poll(async () => (await angles(page, edge))?.stations.filter((s) => s.stretches.length === 2).length ?? 0).toBeGreaterThan(150);
  const r = (await angles(page, edge))!;
  for (const s of r.stations.filter((_, k) => k % 15 === 0)) {
    const one = s.stretches.find((x) => x.layer === 1)!, two = s.stretches.find((x) => x.layer === 2)!;
    expect(Math.abs(one.layer_face! - 45)).toBeLessThan(5);
    expect(Math.abs(two.layer_face! - (Math.atan(2 / 12) * 180) / Math.PI)).toBeLessThan(5);
    expect(Math.abs(two.three_points! - (Math.atan(8 / 18) * 180) / Math.PI)).toBeLessThan(5);
  }

  // what the measure mode shows: all the distances, or one; no layers, no method of theirs
  const lines = page.locator('#edge-chart .edge-chart-line');
  await expect(lines).toHaveCount(3);
  await expect(page.locator('#edge-chart-legend .edge-chart-key')).toHaveText(['2 mm', '5 mm', '10 mm']);
  await expect(page.locator('#edge-method-layer_face')).toHaveCount(0);
  await expect(page.locator('#edge-series-L1')).toHaveCount(0);
  const key = await page.evaluate(() => window.lithicanalyst.edgeColors()?.key);
  await page.locator('#edge-series-d10').click();
  await expect(lines).toHaveCount(1);
  await expect(lines).toHaveAttribute('data-series', 'd10');
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.edgeColors()?.key)).not.toBe(key);
  await page.locator('#edge-series-all').click();
  await expect(lines).toHaveCount(3);

  // the export: a row per station, layer and method
  const out = await exportFile(page, 'retouch-angles');
  expect(out.name).toBe('tool_retouch_angles.csv');
  expect(out.text.trim().split('\n')[0]).toBe('specimen_id,curve_id,station,position,retouch_region,retouch_layer,distance,method,angle_deg,working_edge');
  const rows = parseCsv(out.text);
  expect(new Set(rows.map((x) => x.method))).toEqual(new Set(['three_points', 'two_lines', 'layer_face']));
  expect(new Set(rows.map((x) => x.retouch_layer))).toEqual(new Set(['1', '2']));
  expect(new Set(rows.map((x) => x.retouch_region))).toEqual(new Set(['R1', 'R2']));
  expect(rows.length).toBe(r.stations.reduce((n, s) => n + s.stretches.length, 0) * 3);

  // the project file holds them
  const file = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(file.derived.retouchAngles?.curves[0].curveId).toBe(edge);

  // the layers are the retouch mode's, and that mode a flake's: all the lines, a layer; the method of the layers' own faces
  await page.locator('#app-mode-annotate').click();
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), edge);
  await page.keyboard.press('2');
  await expect.poll(async () => (await state(page)).curves[0].attributes.type).toBe('edge');
  await page.locator('#app-mode-retouch').click();
  await openSection(page, 'retouch-angles');
  const layers = page.locator('#retouch-chart .edge-chart-line');
  await expect(layers).toHaveCount(2);
  await expect(page.locator('#retouch-chart-legend .edge-chart-key')).toHaveText(['Layer 1', 'Layer 2']);
  const layerKey = await page.evaluate(() => window.lithicanalyst.edgeColors()?.key);
  await page.locator('#retouch-series-L2').click();
  await expect(layers).toHaveCount(1);
  await expect(layers).toHaveAttribute('data-series', 'L2');
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.edgeColors()?.key)).not.toBe(layerKey);
  await page.locator('#retouch-method-layer_face').click();
  await page.locator('#retouch-series-all').click();
  await expect(layers).toHaveCount(2);
  await expect(page.locator('#retouch-chart-legend .edge-chart-key')).toHaveText(['Layer 1', 'Layer 2']);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.edgeColors())).not.toBeNull();

  // no retouch: nothing to choose, nothing to export
  await page.locator('#app-mode-annotate').click();
  for (const id of (await state(page)).regions.map((x) => x.id)) {
    await page.evaluate((x) => window.lithicanalyst.selectForTest(x), id);
    await page.keyboard.press('Delete');
  }
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), edge);
  await page.locator('#app-mode-measure').click();
  await expect.poll(() => angles(page, edge)).toBeNull();
  await expect(page.locator('#edge-method-layer_face')).toBeHidden();
  await expect(lines).toHaveCount(3);
});

test('an open retouch curve that stops just short of the edge still cuts off its part', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, toolPly());
  await drawRim(page);
  await fromAbove(page);
  await page.keyboard.press('p');
  for (const d of [-40, 0, 40]) await curveClick(page, await toScreen(page, onTool(d === 0 ? 24 : 28.6, d)), { shift: true });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).curves.length).toBe(2);
  await page.keyboard.press('v');
  await page.keyboard.press('5');
  await page.keyboard.press('r');
  const s = await toScreen(page, onTool(28.5, 0));
  await page.mouse.click(s.x, s.y);
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.regions()))?.results[0]?.area ?? null).not.toBeNull();
  const area = (await page.evaluate(() => window.lithicanalyst.regions()))!.results[0].area!;
  expect(area).toBeLessThan(600);
});

test('the sharp edge: a threshold, by hand, dragged or suggested; the stretches and edge_sharp.csv', async ({ page }) => {
  await openApp(page, 'flake');
  await loadMesh(page, twoAnglePly());
  const edge = await drawRim(page, 3 * T4.upper);
  await page.locator('#app-mode-measure').click();
  await openSection(page, 'edge-angle');
  await expect.poll(() => page.evaluate((id) => window.lithicanalyst.edgeAngles(id)?.stations.length ?? 0, edge)).toBeGreaterThan(150);

  // three points at 2 mm, and no threshold until one is set
  await expect(page.locator('#sharp-method')).toHaveValue('three_points');
  await expect(page.locator('#sharp-distance')).toHaveValue('2');
  await expect(page.locator('#sharp-threshold')).toHaveValue('');
  await expect(page.locator('#edge-chart-threshold')).toHaveCount(0);
  await expect(page.locator('#sharp-summary')).toBeHidden();
  await expect(page.locator('#edge-color')).toBeHidden();
  expect(await exportAvailable(page, 'edge-sharp')).toBe(false);

  // suggested: between the two kinds of angle
  await page.locator('#sharp-auto').click();
  await expect.poll(async () => (await state(page)).sharpEdge.threshold).not.toBeNull();
  const suggested = (await state(page)).sharpEdge.threshold!;
  expect(suggested).toBeGreaterThan(28);
  expect(suggested).toBeLessThan(62);
  await expect(page.locator('#sharp-threshold')).toHaveValue(String(suggested));

  // by hand: half the edge
  await page.locator('#sharp-threshold').fill('45');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).sharpEdge.threshold).toBe(45);
  const result = (await sharp(page, edge))!;
  expect(result.segments.length).toBe(1);
  expect(Math.abs(result.length - Math.PI * T4.radius)).toBeLessThan(12);
  await expect(page.locator('#sharp-count')).toContainText('1');
  await expect(page.locator('#edge-chart-threshold')).toHaveCount(1);
  await expect(page.locator('.edge-chart-band').first()).toBeAttached();

  // the curve by what is sharp, or by its angles
  await expect(page.locator('#edge-legend-sharp')).toHaveText('≤ 45.0°');
  await expect(page.locator('#edge-legend-other')).toHaveText('> 45.0°');
  await page.locator('#edge-color-angle').click();
  await expect(page.locator('#edge-legend-min')).toBeVisible();
  await page.locator('#edge-color-sharp').click();
  await expect(page.locator('#edge-legend-sharp')).toBeVisible();

  // the line can be dragged; undo goes back
  await page.locator('#edge-chart').scrollIntoViewIfNeeded();
  const plot = (await page.locator('#edge-chart').boundingBox())!;
  const lineY = Number(await page.locator('#edge-chart-threshold').getAttribute('y1'));
  const at = { x: plot.x + plot.width / 2, y: plot.y + (lineY / 170) * plot.height };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x, at.y + 12, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).sharpEdge.threshold).toBeLessThan(45);
  await page.locator('#btn-undo').click();
  await expect.poll(async () => (await state(page)).sharpEdge.threshold).toBe(45);

  // another series: the chart goes with it, and the line does not stand on the wrong one
  await page.locator('#sharp-distance').selectOption('5');
  await expect.poll(async () => (await state(page)).sharpEdge.distance).toBe(5);
  await expect(page.locator('#edge-chart .edge-chart-line')).toHaveAttribute('data-series', 'd5');
  await page.locator('#edge-series-d10').click();
  await expect(page.locator('#edge-chart-threshold')).toHaveCount(0);
  await page.locator('#edge-series-d5').click();
  await expect(page.locator('#edge-chart-threshold')).toHaveCount(1);

  // the export and the project file
  const out = await exportFile(page, 'edge-sharp');
  expect(out.name).toBe('two_edge_sharp.csv');
  expect(out.text.trim().split('\n')[0]).toBe('specimen_id,curve_id,method,distance,threshold_deg,segment,start_position,end_position,length,working_edge');
  const rows = parseCsv(out.text);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ curve_id: 'C1', method: 'three_points', distance: '5', threshold_deg: '45', segment: '1' });
  const file = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(file.sharpEdge).toEqual({ method: 'three_points', distance: 5, threshold: 45 });
  expect(file.derived.sharpEdge?.curves[0].length).toBeCloseTo(Number(rows[0].length), 3);

  // cleared: back to the angles' scale
  await page.locator('#sharp-threshold').fill('');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).sharpEdge.threshold).toBeNull();
  await expect(page.locator('#edge-legend-min')).toBeVisible();
});

test('an edge of one angle: no threshold is suggested, and it says so', async ({ page }) => {
  await openApp(page, 'flake');
  await loadMesh(page, t4Ply());
  const edge = await drawRim(page);
  await page.locator('#app-mode-measure').click();
  await openSection(page, 'edge-angle');
  await expect.poll(() => page.evaluate((id) => window.lithicanalyst.edgeAngles(id)?.stations.length ?? 0, edge)).toBeGreaterThan(150);
  await page.locator('#sharp-auto').click();
  await expect(page.locator('.toast').last()).toContainText('two clear groups');
  expect((await state(page)).sharpEdge.threshold).toBeNull();
});

test('a folder has one threshold: in its own file, for every model and the summary', async ({ page }) => {
  await mockFolder(page, 'dig', { 'a.ply': twoAnglePly().buffer, 'b.ply': t4Ply().buffer });
  await openApp(page, 'flake');
  await openMockFolder(page);
  const meshName = () => page.evaluate(() => window.lithicanalyst.state().mesh?.fileName ?? null);
  const FILE = 'LithicAnalyst/sharp-edge.json';
  await expect.poll(meshName).toBe('a.ply');
  await drawRim(page, 3 * T4.upper);
  await page.locator('#app-mode-measure').click();
  await openSection(page, 'edge-angle');
  await page.locator('#sharp-threshold').fill('45');
  await page.keyboard.press('Enter');
  await expect.poll(async () => JSON.parse((await folderText(page, FILE)) ?? '{}').threshold).toBe(45);

  // the next model starts with it; a change there is the folder's
  await page.locator('#workspace-next').click();
  await expect.poll(meshName).toBe('b.ply');
  expect((await state(page)).sharpEdge.threshold).toBe(45);
  await page.locator('#app-mode-annotate').click();
  await drawRim(page);
  await page.locator('#app-mode-measure').click();
  await page.locator('#sharp-threshold').fill('50');
  await page.keyboard.press('Enter');
  await expect.poll(async () => JSON.parse((await folderText(page, FILE)) ?? '{}').threshold).toBe(50);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.exportEdgeAnglesCsvText().trim().split('\n').length)).toBeGreaterThan(100);

  await page.locator('#workspace-prev').click();
  await expect.poll(meshName).toBe('a.ply');
  expect((await state(page)).sharpEdge.threshold).toBe(50);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.exportEdgeAnglesCsvText().trim().split('\n').length)).toBeGreaterThan(100);

  // the summary judges both by it
  await page.locator('#btn-export').click();
  await page.locator('#export-scope-folder').click();
  await page.locator('.modal [data-choice="export"]').click();
  const find = async (name: string) => (await folderPaths(page)).find((p) => new RegExp(`^LithicAnalyst/exports/[^/]+/${name}$`).test(p)) ?? null;
  await expect.poll(() => find('manifest\\.json')).not.toBeNull();
  const rows = parseCsv((await folderText(page, (await find('edge_sharp\\.csv'))!))!);
  expect(new Set(rows.map((r) => r.threshold_deg))).toEqual(new Set(['50']));
  expect(new Set(rows.map((r) => r.specimen_id))).toEqual(new Set(['a', 'b']));
  const manifest = JSON.parse((await folderText(page, (await find('manifest\\.json'))!))!);
  expect(manifest.parameters.sharpEdge).toMatchObject({ SHARP_MIN_RUN_MM: 3, rule: { method: 'three_points', distance: 2, threshold: 50 } });
});

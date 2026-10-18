import type { Page } from '@playwright/test';
import { boxPly, boxPoint, roofPly, type Vec3 } from './fixtures/meshes';
import { download, expect, loadMesh, measureDraftLength, nextFrames, openApp, parseCsv, state, test, toScreen, waitForMesh } from './helpers';

const MEASUREMENTS_HEADER =
  'specimen_id,unit,frame,length,width,thickness,surface_area,volume,surface_to_volume_ratio,wadell_sphericity,closed,area_scar,area_cortex,area_joint,area_damage,cortex_ratio,nodule_radius,nodule_fit_rms,volume_upper,volume_lower,volume_ratio';
const MANUAL_HEADER = 'specimen_id,measure_id,type,value,unit,p1_x,p1_y,p1_z,p2_x,p2_y,p2_z,p3_x,p3_y,p3_z';

async function measureMode(page: Page): Promise<void> {
  await page.keyboard.press('m');
  await expect(page.locator('#app-mode-measure')).toHaveAttribute('aria-checked', 'true');
}

/** Look at the box from above and in front, so its top and front faces are both in view. */
async function viewTopFront(page: Page): Promise<void> {
  await page.evaluate(() => window.lithicanalyst.view([0, -1, 1.3], [0, 0, 1]));
  await nextFrames(page);
}

/** Click the points of one measurement (tool already chosen) and wait until it is stored. */
async function measure(page: Page, points: Vec3[]): Promise<void> {
  const before = (await state(page)).measurements.length;
  for (const [i, p] of points.entries()) {
    const s = await toScreen(page, p);
    await page.mouse.move(s.x, s.y, { steps: 3 });
    await page.mouse.click(s.x, s.y);
    if (i < points.length - 1) await expect.poll(() => measureDraftLength(page)).toBe(i + 1);
  }
  await expect.poll(async () => (await state(page)).measurements.length).toBe(before + 1);
}

test('measures the size and shape of a closed model and exports them', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, boxPly());
  await measureMode(page);
  await expect(page.locator('#auto-length')).toHaveText('40.000 mm');
  await expect(page.locator('#auto-width')).toHaveText('20.000 mm');
  await expect(page.locator('#auto-thickness')).toHaveText('10.000 mm');
  await expect(page.locator('#auto-frame')).toHaveText('Principal axes');
  await expect(page.locator('#auto-area')).toHaveText('2800.00 mm²');
  await expect(page.locator('#auto-volume')).toHaveText('8000.00 mm³');
  await expect(page.locator('#auto-svr')).toHaveText('7.000');
  const psi = (Math.cbrt(Math.PI) * Math.pow(48000, 2 / 3)) / 2800;
  await expect(page.locator('#auto-sphericity')).toHaveText(psi.toFixed(3));

  // the unit is only a declaration: values stay, the unit label follows
  await page.locator('#specimen-unit').selectOption('cm');
  await expect(page.locator('#auto-area')).toHaveText('2800.00 cm²');

  const csv = await download(page, () => page.locator('#export-measurements-csv').click());
  expect(csv.name).toBe('box_measurements.csv');
  expect(csv.text.split('\n')[0]).toBe(MEASUREMENTS_HEADER);
  const [row] = parseCsv(csv.text);
  expect(row).toMatchObject({ specimen_id: 'box', unit: 'cm', frame: 'principal', closed: 'true' });
  expect(Number(row.length)).toBeCloseTo(40, 4);
  expect(Number(row.width)).toBeCloseTo(20, 4);
  expect(Number(row.thickness)).toBeCloseTo(10, 4);
  expect(Number(row.surface_area)).toBeCloseTo(2800, 3);
  expect(Number(row.volume)).toBeCloseTo(8000, 2);
  expect(Number(row.surface_to_volume_ratio)).toBeCloseTo(7, 5);
  expect(Number(row.wadell_sphericity)).toBeCloseTo(psi, 5);
});

test('leaves the volume empty when the model is not closed', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, roofPly());
  await measureMode(page);
  await expect(page.locator('#auto-volume')).toHaveText('Not closed');
  await expect(page.locator('#auto-svr')).toHaveText('–');
  await expect(page.locator('#auto-sphericity')).toHaveText('–');
  const [row] = parseCsv(await page.evaluate(() => window.lithicanalyst.exportMeasurementsCsvText()));
  expect(row).toMatchObject({ volume: '', surface_to_volume_ratio: '', wadell_sphericity: '', closed: 'false' });
  expect(Number(row.surface_area)).toBeGreaterThan(0);
});

test('takes distance, along-surface and angle measurements; undo, redo, export and reopen', async ({ page, browser }) => {
  const ply = boxPly();
  await openApp(page);
  await loadMesh(page, ply);
  await measureMode(page);
  await expect(page.locator('#measure-tool-measure-distance')).toBeVisible();
  await expect(page.locator('#export-manual-csv')).toBeDisabled();
  await viewTopFront(page);

  // straight distance across the top face
  await page.keyboard.press('d');
  await expect(page.locator('#measure-tool-measure-distance')).toHaveAttribute('aria-checked', 'true');
  await measure(page, [boxPoint(-10, 0, 5), boxPoint(10, 0, 5)]);
  // along the top face between two mesh vertices: the traced zig-zag (32.36) is pulled straight (√1000)
  await page.keyboard.press('g');
  await measure(page, [boxPoint(-15, -7.5, 5), boxPoint(15, 2.5, 5)]);
  // a right angle on the top face; Backspace and Esc on the way
  await page.locator('#measure-tool-measure-angle').click();
  const corner = await toScreen(page, boxPoint(-10, -5, 5));
  await page.mouse.click(corner.x, corner.y);
  await expect.poll(() => measureDraftLength(page)).toBe(1);
  await page.keyboard.press('Backspace');
  await expect.poll(() => measureDraftLength(page)).toBe(0);
  await page.mouse.click(corner.x, corner.y);
  await expect.poll(() => measureDraftLength(page)).toBe(1);
  await page.keyboard.press('Escape');
  await expect.poll(() => measureDraftLength(page)).toBe(0);
  await measure(page, [boxPoint(-10, -5, 5), boxPoint(0, -5, 5), boxPoint(0, 5, 5)]);

  let st = await state(page);
  expect(st.measurements.map((m) => [m.label, m.type])).toEqual([
    ['M1', 'distance'],
    ['M2', 'geodesic'],
    ['M3', 'angle'],
  ]);
  expect(st.measurements[1].path!.length).toBeGreaterThan(2);
  await expect(page.locator('#measure-list .measure-row')).toHaveCount(3);
  const values = async () => (await page.locator('#measure-list .arrow-len').allTextContents()).map((s) => parseFloat(s));
  const [d, g, a] = await values();
  expect(d).toBeCloseTo(20, 1);
  // relaxing gets within a few hundredths of the straight line
  expect(Math.abs(g - Math.sqrt(1000))).toBeLessThan(0.1);
  expect(a).toBeCloseTo(90, 0);
  await expect(page.locator('#measure-list .arrow-len').nth(2)).toHaveText(/°$/);
  await expect(page.locator('.measure-label', { hasText: 'M2' })).toBeVisible();

  // the last one is selected: delete it, then undo and redo
  await page.keyboard.press('Delete');
  await expect(page.locator('#measure-list .measure-row')).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#measure-list .measure-row')).toHaveCount(3);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('#measure-list .measure-row')).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#measure-list .measure-row')).toHaveCount(3);
  // measurements are not shown, nor deleted, in the annotate mode
  await page.locator('#measure-list .measure-row', { hasText: 'M1' }).click();
  // measure → present → compare → annotate
  await page.keyboard.press('m');
  await page.keyboard.press('m');
  await page.keyboard.press('m');
  await expect(page.locator('#app-mode-annotate')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.measure-label', { hasText: 'M1' })).toBeHidden();
  await page.keyboard.press('Delete');
  expect((await state(page)).measurements).toHaveLength(3);
  await page.keyboard.press('m');

  st = await state(page);
  const csv = await download(page, () => page.locator('#export-manual-csv').click());
  expect(csv.name).toBe('box_manual_measurements.csv');
  expect(csv.text.split('\n')[0]).toBe(MANUAL_HEADER);
  const rows = parseCsv(csv.text);
  expect(rows.map((r) => [r.measure_id, r.type, r.unit])).toEqual([
    ['M1', 'distance', 'mm'],
    ['M2', 'geodesic', 'mm'],
    ['M3', 'angle', 'deg'],
  ]);
  expect(Math.abs(Number(rows[1].value) - Math.sqrt(1000))).toBeLessThan(0.1);
  expect(rows[0].p3_x).toBe('');
  expect(Number(rows[2].p2_x)).toBeCloseTo(st.measurements[2].points[1][0], 5);

  const saved = await download(page, () => page.locator('#btn-save-project').click());
  const file = JSON.parse(saved.text);
  expect(file.annotations.measurements).toEqual(st.measurements);
  expect(file.derived.manualMeasurements.map((m: { label: string }) => m.label)).toEqual(['M1', 'M2', 'M3']);
  expect(file.derived.measurements).toMatchObject({ frame: 'principal', closed: true });

  const context = await browser.newContext();
  const fresh = await context.newPage();
  await openApp(fresh);
  await loadMesh(fresh, ply);
  const chooser = fresh.waitForEvent('filechooser');
  await fresh.locator('#btn-open-project').click();
  await (await chooser).setFiles({ name: saved.name, mimeType: 'application/json', buffer: Buffer.from(saved.text) });
  await waitForMesh(fresh, 'box.ply');
  await expect.poll(async () => (await state(fresh)).measurements).toEqual(st.measurements);
  expect((await state(fresh)).nextMeasureNumber).toBe(4);
  await context.close();
});

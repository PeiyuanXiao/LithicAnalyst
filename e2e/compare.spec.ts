import type { Page } from '@playwright/test';
import { boxPly, boxPoint, spherePly, t8Ply, type Vec3 } from './fixtures/meshes';
import { counts, curveClick, download, dragArrow, expect, exportAvailable, exportFile, folderPaths, folderText, loadMesh, mockFolder, openApp, openMockFolder, parseCsv, setAnnotator, state, test, toScreen, viewFromTop } from './helpers';
import { t8Project } from './t8Setup';

const agreement = (page: Page) => page.evaluate(() => window.lithicanalyst.agreement());
const value = async (page: Page, itemType: string, itemKey: string, metric: string) =>
  (await agreement(page))?.rows.find((r) => r.itemType === itemType && r.itemKey === itemKey && r.metric === metric)?.value;

async function addFiles(page: Page, files: Array<{ name: string; text: string }>): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#compare-add').click();
  await (await chooser).setFiles(files.map((f) => ({ name: f.name, mimeType: 'application/json', buffer: Buffer.from(f.text) })));
}

test('compares the open project with other observers\' files of the same model', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, boxPly());
  await viewFromTop(page);
  await setAnnotator(page, 'Ann');
  // a closed rectangle on the top face with a scar region in it, an arrow inside, and a landmark
  await page.keyboard.press('p');
  for (const p of [boxPoint(-10, -5, 5), boxPoint(10, -5, 5), boxPoint(10, 5, 5), boxPoint(-10, 5, 5)]) await curveClick(page, await toScreen(page, p), { shift: true });
  const first = await toScreen(page, boxPoint(-10, -5, 5));
  await page.mouse.move(first.x, first.y, { steps: 3 });
  await page.keyboard.down('Shift');
  await page.mouse.click(first.x, first.y);
  await page.keyboard.up('Shift');
  await page.keyboard.press('a');
  await dragArrow(page, boxPoint(-5, 0, 5), boxPoint(5, 2, 5));
  await expect.poll(() => counts(page)).toEqual({ arrows: 1, curves: 1 });
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.regionCount())).toBe(2);
  await page.keyboard.press('r');
  const inside = await toScreen(page, boxPoint(3, -2.5, 5));
  await page.mouse.click(inside.x, inside.y);
  await expect.poll(async () => (await state(page)).regions.length).toBe(1);
  await page.keyboard.press('k');
  const lm = await toScreen(page, boxPoint(15, 7.5, 5));
  await page.keyboard.down('Shift');
  await page.mouse.click(lm.x, lm.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await state(page)).landmarks.length).toBe(1);

  // a second observer: the same annotations, but the arrow's end lower, the region cortex, the landmark 3 away
  const saved = await download(page, () => page.locator('#btn-save-project').click());
  const other = JSON.parse(saved.text);
  other.specimen.annotator = 'Bo';
  const arrow = other.annotations.scars[0].vector;
  arrow.end = [arrow.end[0], arrow.end[1] - 4, arrow.end[2]];
  other.annotations.regions[0].type = 'cortex';
  other.annotations.landmarks[0].point[0] += 3;
  const wrongModel = { ...other, mesh: { ...other.mesh, sha256: '0'.repeat(64) } };

  await page.locator('#app-mode-compare').click();
  await expect(page.locator('#sec-observers')).toBeVisible();
  await expect(page.locator('#observer-list .observer-row')).toHaveCount(1);
  expect(await exportAvailable(page, 'agreement')).toBe(false);
  await addFiles(page, [{ name: 'bo.lithicanalyst.json', text: JSON.stringify(other) }, { name: 'elsewhere.lithicanalyst.json', text: JSON.stringify(wrongModel) }]);
  await expect(page.locator('.toast-warn')).toContainText('elsewhere.lithicanalyst.json');
  await expect(page.locator('#observer-list .observer-row')).toHaveCount(2);
  expect((await page.evaluate(() => window.lithicanalyst.observers())).map((o) => [o.label, o.current])).toEqual([
    ['Ann', true],
    ['Bo', false],
  ]);
  await expect.poll(() => agreement(page)).not.toBeNull();

  // arrow (10, 2) against (10, −2): 2·atan(0.2)
  expect(await value(page, 'arrow', 'S1|S1', 'angle_deg')).toBeCloseTo((2 * Math.atan(0.2) * 180) / Math.PI, 3);
  expect(await value(page, 'arrow', 'S1|S1', 'end_distance')).toBeCloseTo(4, 4);
  expect(await value(page, 'arrow', 'all', 'matched')).toBe(1);
  expect(await value(page, 'curve', 'C1|C1', 'hausdorff')).toBeCloseTo(0, 6);
  expect(await value(page, 'landmark', 'LM1', 'distance')).toBeCloseTo(3, 4);
  // the 20 × 10 rectangle is a scar for one and cortex for the other
  expect(await value(page, 'region', 'scar', 'iou')).toBe(0);
  expect(await value(page, 'region_type', 'all', 'agreement')).toBe(0);
  expect(await value(page, 'region_type', 'all', 'area')).toBeCloseTo(200, 2);
  // what is computed from the annotations is not compared (34d): no region areas, no length
  const rows = (await agreement(page))!.rows;
  expect(rows.filter((r) => r.itemType === 'measurement')).toEqual([]);
  expect(rows.some((r) => r.itemType === 'plane')).toBe(false);
  await expect(page.locator('#agreement-table tbody tr[data-item="arrow"][data-metric="angle_deg"]')).toHaveCount(1);

  const long = await exportFile(page, 'agreement');
  expect(long.name).toBe('box_agreement.csv');
  expect(long.text.split('\n')[0]).toBe('specimen_id,item_type,item_key,annotator_a,annotator_b,metric,value');
  expect(parseCsv(long.text).find((r) => r.item_type === 'landmark')).toMatchObject({ specimen_id: 'box', item_key: 'LM1', annotator_a: 'Ann', annotator_b: 'Bo', metric: 'distance' });
  const summary = await exportFile(page, 'agreement-summary');
  expect(summary.name).toBe('box_agreement_summary.csv');
  expect(summary.text.split('\n')[0]).toBe('specimen_id,item_type,metric,annotator_a,annotator_b,n,mean,sd,min,max');
  const angle = parseCsv(summary.text).find((r) => r.item_type === 'arrow' && r.metric === 'angle_deg')!;
  expect([angle.n, angle.sd]).toEqual(['1', '']);

  // changes to the open project are compared again (undo the landmark: its row goes)
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => value(page, 'landmark', 'LM1', 'distance')).toBeUndefined();
  // leave one observer out: nothing to compare
  await page.locator('#observer-list .observer-row', { hasText: 'Bo' }).locator('input').uncheck();
  await expect.poll(() => agreement(page)).toBeNull();
  await expect(page.locator('#agreement-table')).toBeEmpty();
  await page.locator('#observer-list .observer-row', { hasText: 'Bo' }).locator('input').check();
  await expect.poll(() => agreement(page)).not.toBeNull();
  await page.locator('#observer-list .observer-row', { hasText: 'Bo' }).locator('[data-act="remove"]').click();
  await expect(page.locator('#observer-list .observer-row')).toHaveCount(1);

  // a new model starts over
  await loadMesh(page, spherePly());
  await expect(page.locator('#observer-list .observer-row')).toHaveCount(1);
  expect(await agreement(page)).toBeNull();
});

test('three observers: Fleiss\' κ on what all of them share', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, boxPly());
  await viewFromTop(page);
  await page.keyboard.press('a');
  const ends: Array<[Vec3, Vec3]> = [
    [boxPoint(-10, -5, 5), boxPoint(10, -5, 5)],
    [boxPoint(-10, 5, 5), boxPoint(10, 5, 5)],
  ];
  for (const [a, b] of ends) await dragArrow(page, a, b);
  const saved = await download(page, () => page.locator('#btn-save-project').click());
  const make = (name: string, codes: string[]) => {
    const f = JSON.parse(saved.text);
    f.specimen.annotator = name;
    f.annotations.scars.forEach((s: { attributes: Record<string, string> }, i: number) => (s.attributes.completeness = codes[i]));
    return { name: `${name}.json`, text: JSON.stringify(f) };
  };
  await page.locator('#app-mode-compare').click();
  await addFiles(page, [make('B', ['point_complete', 'both_missing']), make('C', ['point_complete', 'both_missing'])]);
  await expect.poll(async () => (await agreement(page))?.rows.some((r) => r.a === 'all')).toBe(true);
  const rows = (await agreement(page))!.rows.filter((r) => r.a === 'all' && r.itemKey === 'completeness');
  // the open project rated both scars point_complete (the default): items (pc, pc, pc) and (pc, bm, bm)
  const byMetric = Object.fromEntries(rows.map((r) => [r.metric, r.value]));
  expect(byMetric.n_items).toBe(2);
  expect(byMetric.agreement).toBeCloseTo((1 + 1 / 3) / 2, 9);
  expect(await page.locator('#observer-list .observer-row').count()).toBe(3);
});

/** The files of the newest export folder of the mock folder that has `file`: its path, and the files below it. */
async function newestExport(page: Page, file: RegExp, not: string[] = []): Promise<{ base: string; files: string[] }> {
  let base = '';
  await expect
    .poll(async () => {
      const hit = (await folderPaths(page)).filter((p) => /^LithicAnalyst\/exports\/[^/]+\//.test(p) && file.test(p.split('/').pop()!)).map((p) => p.slice(0, p.lastIndexOf('/'))).find((b) => !not.includes(b));
      base = hit ?? '';
      return base;
    }, { timeout: 60_000 })
    .not.toBe('');
  return { base, files: (await folderPaths(page)).filter((p) => p.startsWith(`${base}/`)).map((p) => p.slice(base.length + 1)).sort() };
}

test('two observers of a flake (34d): the technological axis, platform ends by side, nothing computed; the manifest; the summary one set of rows per project file', async ({ page, pageErrors }) => {
  // B put P 0.4 mm to the side and listed its two platform ends the other way round (both are named platform_end)
  const a = t8Project('A');
  const bFile = JSON.parse(t8Project('B', { P: [0.4, 0, 0] }).text);
  const lms = bFile.annotations.landmarks as Array<{ code?: string }>;
  const ends = lms.filter((l) => l.code === 'platform_end').reverse();
  bFile.annotations.landmarks = [...lms.filter((l) => l.code !== 'platform_end'), ...ends];
  await mockFolder(page, 'flakes', {
    't8.ply': t8Ply().buffer,
    'LithicAnalyst/projects/t8.ply.lithicanalyst.json': Buffer.from(a.text),
    'others/t8.B.lithicanalyst.json': Buffer.from(JSON.stringify(bFile)),
  });
  await openApp(page, 'flake');
  await openMockFolder(page);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.state().specimen.annotator)).toBe('A');
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.flake()?.measures?.psia ?? null), { timeout: 30_000 }).not.toBeNull();

  await page.locator('#app-mode-compare').click();
  await page.locator('#compare-add-folder').click();
  await expect(page.locator('#observer-list .observer-row')).toHaveCount(2);
  await expect.poll(() => value(page, 'technological_axis', 'axis', 'pop_distance')).toBeCloseTo(0.4, 6);
  expect(await value(page, 'technological_axis', 'axis', 'angle_deg')).toBeCloseTo(0, 6);
  const rows = (await agreement(page))!.rows;
  // by side: left with left, right with right, though B listed them the other way round
  expect(rows.filter((r) => r.itemType === 'landmark').map((r) => [r.itemKey, +r.value.toFixed(6)])).toEqual([
    ['pop', 0.4],
    ['platform_left', 0],
    ['platform_right', 0],
  ]);
  // no planes, no length, width and thickness, no flake measures
  expect(rows.some((r) => r.itemType === 'plane' || r.itemType === 'measurement')).toBe(false);
  await expect(page.locator('#agreement-table tbody[data-group="technological_axis"]')).toHaveCount(1);
  await expect(page.locator('#agreement-table tbody[data-group="technological_axis"] tr[data-metric="pop_distance"]')).toHaveCount(1);
  // one axis each: no pairing line
  await expect(page.locator('#agreement-table tbody[data-group="technological_axis"] .agree-pairing')).toHaveCount(0);
  await expect(page.locator('#agreement-table tbody[data-group="plane"], #agreement-table tbody[data-group="measurement"]')).toHaveCount(0);
  await expect(page.locator('#sec-agreement')).toContainText('Technological axis');
  await expect(page.locator('#sec-agreement')).not.toContainText('PSIA');
  await page.screenshot({ path: 'test-results/34d/compare-flake.png' });

  // the export: the manifest says how the pairing was made
  await page.locator('#btn-export').click();
  await page.locator('.modal [data-choice="export"]').click();
  const one = await newestExport(page, /_agreement\.csv$/);
  expect(one.files.some((f) => f.endsWith('_agreement_summary.csv'))).toBe(true);
  const m1 = JSON.parse((await folderText(page, `${one.base}/manifest.json`))!);
  expect(m1.options.agreement).toEqual({ distanceLimit: await page.evaluate(() => window.lithicanalyst.compareGate()), curveSamples: 128, curveMatchSamples: 32 });
  expect(m1.options.agreement.distanceLimit).toBeGreaterThan(0);

  // the summary export: a set of rows per project file, the model's own first; the points of GM and the TPS once
  await page.locator('#btn-export').click();
  await page.locator('#export-scope-folder').click();
  await page.locator('.modal [data-choice="export"]').click();
  const all = await newestExport(page, /^measurements\.csv$/);
  await expect(page.locator('#batch-progress')).toBeHidden({ timeout: 60_000 });
  const table = async (name: string) => parseCsv((await folderText(page, `${all.base}/${name}`))!);
  expect((await table('measurements.csv')).map((r) => [r.specimen_id, r.annotator, r.file])).toEqual([
    ['T8', 'A', 't8.ply'],
    ['T8', 'B', 't8.ply'],
  ]);
  const flakes = await table('flakes.csv');
  expect(flakes.map((r) => [r.annotator, r.frame_source])).toEqual([
    ['A', 'technological_axis'],
    ['B', 'technological_axis'],
  ]);
  expect(Object.keys(flakes[0]).slice(0, 3)).toEqual(['specimen_id', 'annotator', 'unit']);
  // each its own: B's PSIA from its own P
  expect(Number(flakes[0].psia)).not.toBeCloseTo(Number(flakes[1].psia), 3);
  expect((await table('landmarks.csv')).filter((r) => r.name === 'pop').map((r) => r.annotator)).toEqual(['A', 'B']);
  expect(((await folderText(page, `${all.base}/landmarks.tps`))!.match(/^ID=/gm) ?? []).length).toBe(1);
  // no manual measurement: no icc.csv
  expect(all.files).not.toContain('icc.csv');
  const m2 = JSON.parse((await folderText(page, `${all.base}/manifest.json`))!);
  expect(m2.specimens.map((x: { file: string; project: string; annotator: string }) => [x.file, x.project, x.annotator])).toEqual([
    ['t8.ply', 'LithicAnalyst/projects/t8.ply.lithicanalyst.json', 'A'],
    ['t8.ply', 'others/t8.B.lithicanalyst.json', 'B'],
  ]);
  expect(m2.duplicateNames).toEqual([]);
  expect(pageErrors).toEqual([]);
});

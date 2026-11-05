import type { Page } from '@playwright/test';
import { boxPly, T1, t1Ply, type Vec3 } from './fixtures/meshes';
import { curveClick, displayPanel, dragArrow, expect, exportFile, folderPaths, folderText, loadMesh, mockFolder, nextFrames, openApp, openMockFolder, openSection, parseCsv, specimenPanel, state, test, toScreen } from './helpers';

const FLAKES_HEADER =
  'specimen_id,unit,frame_source,tech_length,tech_width,tech_thickness,morph_length,morph_width,morph_thickness,morph_tech_angle_deg,platform_width_chord,platform_width_path,platform_depth_chord,platform_depth_path,platform_area,epa_3pt_1mm,epa_3pt_2mm,epa_3pt_3mm,epa_2ln_1mm,epa_2ln_2mm,epa_2ln_3mm,ipa,retouch_axis,retouch_fit_length,removed_volume,erp,erp_filled_share,giur,giur_stations,invasiveness,invasiveness_continuous,retouch_perimeter,retouch_perimeter_dorsal,retouch_perimeter_ventral,edge_curvature,edge_curvature_chord,edge_curvature_depth';

const flake = (page: Page) => page.evaluate(() => window.lithicanalyst.flake());
const measures = async (page: Page) => (await flake(page))?.measures ?? null;
const panel = (page: Page) => page.evaluate(() => window.lithicanalyst.sectionPanel());

async function setType(page: Page, type: 'core' | 'flake'): Promise<void> {
  await specimenPanel(page);
  await page.locator('#specimen-type').selectOption(type);
  await page.keyboard.press('Escape');
}

/** Draw the technical axis on T1: from the ventral side, the start snapped onto the ridge at P. */
async function drawAxis(page: Page): Promise<void> {
  await page.evaluate(() => window.lithicanalyst.view([0, 0, -1], [0, 1, 0]));
  await nextFrames(page);
  await page.evaluate(() => window.lithicanalyst.snap.prepare('ridge'));
  await page.keyboard.press('t');
  await expect(page.locator('#mode-axis')).toHaveAttribute('aria-checked', 'true');
  // a little beside P, on the ventral face
  const s = await toScreen(page, [0, 0.4, 0]);
  const e = await toScreen(page, T1.A);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(e.x, e.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await flake(page))?.axis?.matrix ?? null).not.toBeNull();
}

/** Draw the platform outline round the P–E face, seen square on, and give it its type (key 5). */
async function drawOutline(page: Page): Promise<void> {
  await page.evaluate(() => window.lithicanalyst.view([0, -0.98, 0.196], [0, 0.196, 0.98]));
  await nextFrames(page);
  await page.keyboard.press('p');
  const corner = (x: number, f: number): Vec3 => [x, -2 * f, 10 * f];
  // Shift: no snapping; a little inside the corners
  const a = await toScreen(page, corner(-14.8, 0.02)), b = await toScreen(page, corner(14.8, 0.02));
  const c = await toScreen(page, corner(14.8, 0.98)), d = await toScreen(page, corner(-14.8, 0.98));
  for (const at of [a, b, c, d]) await curveClick(page, at, { shift: true });
  await page.mouse.move(a.x, a.y, { steps: 3 });
  await page.keyboard.down('Shift');
  await page.mouse.click(a.x, a.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await state(page)).curves.length).toBe(1);
  expect((await state(page)).curves[0].closed).toBe(true);
  await page.keyboard.press('v');
  await page.keyboard.press('5');
  await expect.poll(async () => (await state(page)).curves[0].attributes.type).toBe('platform_outline');
}

/** The two platform ends, clicked beside the outline's corners. */
async function placeEnds(page: Page): Promise<void> {
  await page.keyboard.press('e');
  await expect(page.locator('#mode-platform-end')).toHaveAttribute('aria-checked', 'true');
  for (const x of [-14.9, 14.9]) {
    const s = await toScreen(page, [x, -0.02, 0.1]);
    const n = (await state(page)).landmarks.length;
    await page.mouse.click(s.x, s.y);
    await expect.poll(async () => (await state(page)).landmarks.length).toBe(n + 1);
  }
}

async function annotate(page: Page): Promise<void> {
  await drawAxis(page);
  await drawOutline(page);
  await placeEnds(page);
  await page.keyboard.press('v');
}

/** Along the boundary of the ventral face, from one platform end round to the other; the type by its key. */
async function drawEdge(page: Page): Promise<void> {
  // the flake lying across the view, nothing over its corners
  if (await page.locator('#profile-panel').isVisible()) await page.locator('#profile-close').click();
  await page.evaluate(() => window.lithicanalyst.view([0, 0, -1], [-1, 0, 0]));
  await nextFrames(page);
  await page.keyboard.press('p');
  for (const p of [[-14.7, 0.3, 0], [-14.7, 59.7, 0], [14.7, 59.7, 0], [14.7, 0.3, 0]] as Vec3[]) await curveClick(page, await toScreen(page, p), { shift: true });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).curves.length).toBe(2);
  await page.keyboard.press('v');
  await page.keyboard.press('2');
  await expect.poll(async () => (await state(page)).curves[1].attributes.type).toBe('edge');
}

const regionsOf = (page: Page) => page.evaluate(() => window.lithicanalyst.regions());

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await loadMesh(page, t1Ply());
});

test('a flake: technical axis, platform outline and ends give the measurements; the profile panel and flakes.csv', async ({ page }) => {
  await expect(page.locator('#mode-axis')).toBeHidden();
  await setType(page, 'flake');
  await expect(page.locator('#mode-axis')).toBeVisible();
  await expect(page.locator('#frame-pill')).toHaveText('PCA');
  await expect.poll(async () => (await measures(page))?.morph_length ?? null).not.toBeNull();

  await drawAxis(page);
  const st = await state(page);
  expect(st.specimen.frame?.source).toBe('technical_axis');
  await expect(page.locator('#frame-pill')).toHaveText('Technical axis');
  // pressed beside P: the start went onto the ridge, a vertex, as a curve point does
  expect(Math.hypot(...st.flake.axis!.start)).toBeLessThan(1e-3);
  // the point of percussion: generated, at the start of the arrow, locked
  const pop = st.landmarks.find((l) => l.code === 'pop');
  expect(pop?.point).toEqual(st.flake.axis!.start);
  await openSection(page, 'landmarks');
  await expect(page.locator('#landmark-pop-lock')).toBeVisible();
  await page.locator(`#landmark-list [data-id="${pop!.id}"]`).click();
  await expect(page.locator('#landmark-delete')).toHaveCount(0);
  await page.keyboard.press('Delete');
  expect((await state(page)).landmarks.some((l) => l.code === 'pop')).toBe(true);
  // the frame: X, Y, Z as the model's
  const m = st.flake.axis!.matrix!;
  expect(m[0]).toBeCloseTo(1, 3);
  expect(m[5]).toBeCloseTo(1, 2);
  expect(m[10]).toBeCloseTo(1, 3);
  // the first frame opens the panel
  await expect.poll(async () => (await panel(page)).shown).toBe(true);

  await drawOutline(page);
  await expect.poll(async () => (await state(page)).regions.map((r) => [r.type, r.auto])).toEqual([['platform', true]]);
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.regions()))?.totals.platform ?? 0).toBeGreaterThan(280);
  await placeEnds(page);
  await page.keyboard.press('v');
  const names = (await page.evaluate(() => window.lithicanalyst.landmarkTable())).rows.map((r) => r.name);
  expect(names).toEqual(['pop', 'platform_left', 'platform_right']);

  await expect.poll(async () => (await measures(page))?.platform_width_path ?? null).not.toBeNull();
  const r = (await measures(page))!;
  expect(r.tech_length!).toBeCloseTo(60, 0);
  expect(r.tech_width!).toBeCloseTo(30, 0);
  expect(r.tech_thickness!).toBeCloseTo(10, 0);
  expect(r.platform_width_chord!).toBeCloseTo(30, 0);
  expect(Math.abs(r.platform_width_path! - 30)).toBeLessThan(0.5);
  expect(Math.abs(r.platform_depth_chord! - Math.sqrt(104))).toBeLessThan(0.5);
  expect(Math.abs(r.platform_depth_path! - Math.sqrt(104))).toBeLessThan(0.5);
  expect(Math.abs(r.platform_area! - 30 * Math.sqrt(104))).toBeLessThan(6);
  for (const k of ['epa_3pt_1mm', 'epa_3pt_2mm', 'epa_3pt_3mm', 'epa_2ln_1mm', 'epa_2ln_2mm', 'epa_2ln_3mm'] as const) expect(Math.abs(r[k]! - 69.53)).toBeLessThan(1);
  expect(Math.abs(r.ipa! - 101.31)).toBeLessThan(1);

  // the profile panel: the slider moves the section across; a click on the longitudinal section too
  await page.locator('#profile-slider').fill('25');
  await expect.poll(async () => (await panel(page)).at).toBeCloseTo(0.25, 3);
  await expect.poll(async () => (await panel(page)).width ?? 0).toBeCloseTo(30, 0);
  await expect.poll(async () => (await panel(page)).thickness ?? 0).toBeCloseTo((10 * 45) / 62, 0);
  await expect(page.locator('#profile-width')).toContainText('30');
  await expect(page.locator('#profile-y')).toContainText('15.0');
  await expect(page.locator('#profile-y-unit')).toHaveText('mm');
  expect((await panel(page)).ring).toBeGreaterThan(0);
  const box = (await page.locator('#profile-long').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.25);
  await expect.poll(async () => (await panel(page)).at).toBeGreaterThan(0.6);
  for (const id of ['#profile-long-line', '#profile-cross-line', '#profile-p', '#profile-e', '#profile-platform-line', '#profile-ventral-fit', '#profile-scale', '#profile-epa-1']) await expect(page.locator(id)).toBeAttached();

  // the export dialog: a flake has flakes.csv and no configuration
  await page.locator('#app-mode-measure').click();
  await expect(page.locator('#flake-tech_length')).toContainText('60');
  await expect(page.locator('#flake-ipa')).toContainText('101');
  const out = await exportFile(page, 'flakes');
  expect(out.name).toBe('t1_flakes.csv');
  expect(out.text.trim().split('\n')[0]).toBe(FLAKES_HEADER);
  const [row] = parseCsv(out.text);
  expect(row.frame_source).toBe('technical_axis');
  expect(row.unit).toBe('mm');
  expect(Number(row.tech_length)).toBeCloseTo(60, 0);
});

test('switching to a core and back: nothing lost, each shows its own', async ({ page }) => {
  await setType(page, 'flake');
  await annotate(page);
  await expect.poll(async () => (await measures(page))?.ipa ?? null).not.toBeNull();
  // an arrow of a scar: the frame's angle goes into its CSV
  await page.evaluate(() => window.lithicanalyst.view([0, 0, -1], [0, 1, 0]));
  await nextFrames(page);
  await page.keyboard.press('a');
  await dragArrow(page, [0, 20, 0], [-5, 20, 0]);
  const arrow = parseCsv(await page.evaluate(() => window.lithicanalyst.exportCsvText()))[0];
  expect(Number(arrow.tech_angle_deg)).toBeCloseTo(90, 0);
  expect(arrow.platform_face).toBe('');
  await page.keyboard.press('v');
  await displayPanel(page);
  await expect(page.locator('#config-show')).toBeHidden();
  await expect(page.locator('#profile-show')).toBeVisible();
  await page.keyboard.press('Escape');

  const before = await state(page);
  await setType(page, 'core');
  await expect(page.locator('#mode-axis')).toBeHidden();
  await expect(page.locator('#mode-platform-end')).toBeHidden();
  await expect(page.locator('#profile-panel')).toBeHidden();
  await expect(page.locator('#sec-axis')).toBeHidden();
  await expect(page.locator('#frame-pill')).toBeHidden();
  expect(await flake(page)).toBeNull();
  // the frame goes back to the core's (none), the flake's waits; the flake's landmarks are not shown or exported
  const core = await state(page);
  expect(core.specimen.frame).toBeNull();
  expect(core.flake.axis).toEqual(before.flake.axis);
  expect((await page.evaluate(() => window.lithicanalyst.landmarkTable())).rows).toEqual([]);
  expect(parseCsv(await page.evaluate(() => window.lithicanalyst.exportCsvText()))[0].tech_angle_deg).toBe('');
  // the flake's automatic parts wait for it too
  expect(core.regions.some((r) => r.auto)).toBe(true);
  await openSection(page, 'regions');
  await expect(page.locator('#region-list li')).toHaveCount(0);
  expect(parseCsv(await page.evaluate(() => window.lithicanalyst.exportRegionsCsvText()))).toEqual([]);
  // the volumetric configuration comes back
  await displayPanel(page);
  await expect(page.locator('#profile-show')).toBeHidden();
  await page.locator('#config-show').check();
  await expect(page.locator('#config-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#app-mode-measure').click();
  await expect(page.locator('#sec-flake')).toBeHidden();
  await page.locator('#app-mode-annotate').click();

  await setType(page, 'flake');
  await expect(page.locator('#config-panel')).toBeHidden();
  const back = await state(page);
  expect(back.specimen.frame?.source).toBe('technical_axis');
  expect(back.specimen.frame).toEqual(before.specimen.frame);
  await expect.poll(async () => (await measures(page))?.ipa ?? null).not.toBeNull();
  await expect.poll(async () => (await panel(page)).shown).toBe(true);

  // the whole switch is one undo step
  await page.locator('#btn-undo').click();
  expect((await state(page)).specimen.type).toBe('core');
  await page.locator('#btn-redo').click();
  expect((await state(page)).specimen.type).toBe('flake');
});

test('the axis: a new one replaces the old, its ends drag, delete takes the point of percussion and the frame with it', async ({ page }) => {
  await setType(page, 'flake');
  await drawAxis(page);
  const first = await state(page);
  // again: replaced, one axis, one point of percussion
  await page.keyboard.press('t');
  const s = await toScreen(page, [2, 3, 0]), e = await toScreen(page, [2, 45, 0]);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(e.x, e.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).flake.axis?.end[1] ?? 0).toBeGreaterThan(44);
  const second = await state(page);
  expect(second.flake.axis!.id).toBe(first.flake.axis!.id);
  expect(second.landmarks.filter((l) => l.code === 'pop').length).toBe(1);
  expect(second.landmarks.find((l) => l.code === 'pop')!.point).toEqual(second.flake.axis!.start);
  // undo: the first axis again, in one step
  await page.locator('#btn-undo').click();
  expect((await state(page)).flake.axis!.end).toEqual(first.flake.axis!.end);
  await page.locator('#btn-redo').click();

  // the select tool drags an end
  await page.keyboard.press('v');
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), second.flake.axis!.id);
  await nextFrames(page);
  const handle = await toScreen(page, second.flake.axis!.end);
  const to = await toScreen(page, [2, 30, 0]);
  await page.mouse.move(handle.x, handle.y, { steps: 2 });
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).flake.axis?.end[1] ?? 0).toBeLessThan(35);

  // too short: no frame, and it says so
  await page.keyboard.press('t');
  const a = await toScreen(page, [2, 10, 0]), b = await toScreen(page, [2, 12, 0]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).flake.axis?.failure ?? null).toBe('short');
  expect((await state(page)).specimen.frame).toBeNull();
  await expect(page.locator('#frame-pill')).toHaveText('No frame');
  await expect(page.locator('#axis-status')).toBeVisible();
  await expect.poll(async () => (await measures(page))?.tech_length ?? null).toBeNull();
  await expect.poll(async () => (await panel(page)).shown).toBe(false);

  // deleted: with the point of percussion, the principal axes again
  await page.keyboard.press('v');
  await page.locator('#axis-delete').click();
  const st = await state(page);
  expect(st.flake.axis).toBeNull();
  expect(st.landmarks.some((l) => l.code === 'pop')).toBe(false);
  await expect(page.locator('#frame-pill')).toHaveText('PCA');
});

test('the type: stays with the project file, the next new model starts with it, and the outline has one curve', async ({ page }) => {
  await setType(page, 'flake');
  await annotate(page);
  // a second outline takes the place of the first, in one step
  await page.keyboard.press('p');
  await page.evaluate(() => window.lithicanalyst.view([0, 0, -1], [0, 1, 0]));
  await nextFrames(page);
  const a = await toScreen(page, [-5, 10, 0]), b = await toScreen(page, [5, 10, 0]), c = await toScreen(page, [0, 20, 0]);
  for (const at of [a, b, c]) await curveClick(page, at, { shift: true });
  await page.mouse.move(a.x, a.y, { steps: 3 });
  await page.keyboard.down('Shift');
  await page.mouse.click(a.x, a.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await state(page)).curves.length).toBe(2);
  await page.keyboard.press('v');
  await page.keyboard.press('5');
  await expect.poll(async () => (await state(page)).curves.length).toBe(1);
  // the region follows: the smaller piece is now that triangle
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.regions()))?.totals.platform ?? 0).toBeLessThan(120);
  await page.locator('#btn-undo').click();
  await expect.poll(async () => (await state(page)).curves.length).toBe(2);
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.regions()))?.totals.platform ?? 0).toBeGreaterThan(280);

  // the project file holds the type, the axis, the results and the parameters
  const file = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(file.specimen.type).toBe('flake');
  expect(file.flake.axis?.matrix?.length).toBe(16);
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.projectJson())).derived.flake?.measures.ipa ?? null).not.toBeNull();
  const again = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(again.derived.flake?.parameters).toEqual({ STRIP_HALF_WIDTH_RATIO: 0.1, STRIP_NORMAL_OUTLIER_DEG: 60, FIT_RESAMPLE_COUNT: 200, EPA_DISTANCES_MM: [1, 2, 3], TWO_LINES_LENGTH_MM: 0.5, IPA_BAND: [0.25, 0.75], MIN_FIT_POINTS: 2, PLATFORM_START_EDGES: 3 });

  // a new model starts as a flake
  await loadMesh(page, { ...t1Ply(), name: 't1b.ply' });
  expect((await state(page)).specimen.type).toBe('flake');
});

test('the planes of a flake go by curve or by region', async ({ page }) => {
  await setType(page, 'flake');
  await annotate(page);
  await page.locator('#app-mode-measure').click();
  await page.locator('#plane-add').click();
  const options = await page.locator('#plane-method option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
  expect(options).toEqual(['curves', 'region']);
  await page.locator('#plane-method').selectOption('region');
  const region = (await state(page)).regions[0];
  await page.locator(`[id="plane-region-${region.id}"]`).check();
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.planes()))[0]?.valid ?? false).toBe(true);
  const fit = (await page.evaluate(() => window.lithicanalyst.planes()))[0];
  // the platform's plane: normal along (0, 10, 2)
  expect(Math.abs(fit.normal![1] * 10 + fit.normal![2] * 2) / Math.hypot(10, 2)).toBeGreaterThan(0.99);
});

test('a folder: the list shows and filters the type; the summary has flakes.csv of the flakes and the parameters in its manifest', async ({ page }) => {
  await mockFolder(page, 'dig', { 'a.ply': t1Ply().buffer, 'b.ply': boxPly().buffer });
  await openApp(page);
  await openMockFolder(page);
  const meshName = () => page.evaluate(() => window.lithicanalyst.state().mesh?.fileName ?? null);
  await expect.poll(meshName).toBe('a.ply');
  await setType(page, 'flake');
  await drawAxis(page);
  await page.keyboard.press('v');
  await expect.poll(async () => (await measures(page))?.tech_length ?? null).not.toBeNull();

  // the next new specimen starts as the last one; this one is told to be a core
  await page.locator('#workspace-next').click();
  await expect.poll(meshName).toBe('b.ply');
  expect((await state(page)).specimen.type).toBe('flake');
  await setType(page, 'core');
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.workspace()))?.types).toEqual(['flake', 'core']);
  await expect(page.locator('#workspace-list .ws-type')).toHaveText(['Flake', 'Core']);
  await page.locator('#workspace-type').selectOption('flake');
  await expect(page.locator('#workspace-list .ws-row .ws-path')).toHaveText(['a.ply']);
  await page.locator('#workspace-type').selectOption('core');
  await expect(page.locator('#workspace-list .ws-row .ws-path')).toHaveText(['b.ply']);
  await page.locator('#workspace-type').selectOption('');
  await expect(page.locator('#workspace-list .ws-row')).toHaveCount(2);

  // the whole folder
  await page.locator('#app-mode-measure').click();
  await page.locator('#btn-export').click();
  await page.locator('#export-scope-folder').click();
  await page.locator('.modal [data-choice="export"]').click();
  const find = async (name: string) => (await folderPaths(page)).find((p) => new RegExp(`^LithicAnalyst/exports/[^/]+/${name}$`).test(p)) ?? null;
  await expect.poll(() => find('manifest\\.json')).not.toBeNull();
  const [row, ...more] = parseCsv((await folderText(page, (await find('flakes\\.csv'))!))!);
  expect(more).toEqual([]);
  expect(row.specimen_id).toBe('a');
  expect(row.frame_source).toBe('technical_axis');
  expect(Number(row.tech_length)).toBeCloseTo(60, 0);
  const manifest = JSON.parse((await folderText(page, (await find('manifest\\.json'))!))!);
  expect(manifest.parameters.flake).toEqual({ STRIP_HALF_WIDTH_RATIO: 0.1, STRIP_NORMAL_OUTLIER_DEG: 60, FIT_RESAMPLE_COUNT: 200, EPA_DISTANCES_MM: [1, 2, 3], TWO_LINES_LENGTH_MM: 0.5, IPA_BAND: [0.25, 0.75], MIN_FIT_POINTS: 2, PLATFORM_START_EDGES: 3 });
});

test('the toolbar: the axis after Select, the platform ends after the curve; the automatic measurements are the flake\'s', async ({ page }) => {
  await setType(page, 'flake');
  const order = await page.locator('.tool-group[aria-label="Annotate"] .tool-btn').evaluateAll((els) => els.filter((e) => !(e as HTMLElement).hidden).map((e) => e.id));
  expect(order).toEqual(['mode-select', 'mode-axis', 'mode-draw', 'mode-curve', 'mode-platform-end', 'mode-region', 'mode-relation', 'mode-sequence', 'mode-landmark']);
  await page.locator('#app-mode-measure').click();
  await expect(page.locator('#sec-measure-auto')).toBeHidden();
  await expect(page.locator('#sec-flake .panel-title')).toHaveText('Automatic measurements');
  await expect(page.locator('#flake-tech_length')).toBeAttached();
  // a core keeps its own
  await page.locator('#app-mode-annotate').click();
  await setType(page, 'core');
  await page.locator('#app-mode-measure').click();
  await expect(page.locator('#sec-measure-auto')).toBeVisible();
  await expect(page.locator('#sec-flake')).toBeHidden();
});

test('F: the dorsal face toward the viewer, the platform down, from wherever the view is; nothing changes in the data', async ({ page }) => {
  await setType(page, 'flake');
  await expect(page.locator('#btn-orient')).toBeDisabled();
  await drawAxis(page);
  await expect(page.locator('#btn-orient')).toBeEnabled();
  await page.keyboard.press('v');
  await page.evaluate(() => window.lithicanalyst.view([1, -1, 0.3], [0, 0, 1]));
  await nextFrames(page);
  const before = JSON.stringify(await state(page));
  await page.keyboard.press('f');
  await nextFrames(page);
  const toward = (await page.evaluate(() => window.lithicanalyst.towardViewer()))!;
  const up = (await page.evaluate(() => window.lithicanalyst.cameraUp()))!;
  expect(toward[2]).toBeCloseTo(1, 2);
  expect(up[1]).toBeCloseTo(1, 2);
  expect(JSON.stringify(await state(page))).toBe(before);
  // the button does the same; a core has none
  await page.evaluate(() => window.lithicanalyst.view([1, 0, 0], [0, 0, 1]));
  await nextFrames(page);
  await page.locator('#btn-orient').click();
  await nextFrames(page);
  expect((await page.evaluate(() => window.lithicanalyst.towardViewer()))![2]).toBeCloseTo(1, 2);
  await setType(page, 'core');
  await expect(page.locator('#btn-orient')).toBeHidden();
});

test('a flake\'s faces follow from the edge and the axis; a scar on the dorsal face lies in it; the user\'s own type is the last key', async ({ page }) => {
  await setType(page, 'flake');
  await drawAxis(page);
  await drawOutline(page);
  await drawEdge(page);
  await expect.poll(async () => (await state(page)).regions.filter((r) => r.auto).map((r) => r.type).sort()).toEqual(['dorsal', 'platform', 'ventral']);
  // the three parts, each with its whole area
  await expect.poll(async () => (await regionsOf(page))?.totals.ventral ?? 0).toBeGreaterThan(1500);
  const totals = (await regionsOf(page))!.totals;
  expect(Math.abs(totals.ventral - 60 * 30)).toBeLessThan(120);
  expect(Math.abs(totals.platform - 30 * Math.sqrt(104))).toBeLessThan(40);
  expect(totals.dorsal).toBeGreaterThan(2000);
  await expect(page.locator('#region-faces-open')).toBeHidden();

  // a scar on the dorsal face, seen from above it
  await page.evaluate(() => window.lithicanalyst.view([0, 0.16, 0.99], [0, 1, 0]));
  await nextFrames(page);
  await page.keyboard.press('p');
  const dorsal = (y: number, x: number): Vec3 => [x, y, (10 * (60 - y)) / 62];
  const corners = [dorsal(20, -5), dorsal(20, 5), dorsal(32, 5), dorsal(32, -5)];
  for (const p of corners) await curveClick(page, await toScreen(page, p), { shift: true });
  const first = await toScreen(page, corners[0]);
  await page.mouse.move(first.x, first.y, { steps: 3 });
  await page.keyboard.down('Shift');
  await page.mouse.click(first.x, first.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await state(page)).curves.length).toBe(3);
  await page.keyboard.press('v');
  await page.keyboard.press('1');
  await page.keyboard.press('r');
  const inside = await toScreen(page, dorsal(26, 0));
  await page.mouse.click(inside.x, inside.y);
  await expect.poll(async () => (await regionsOf(page))?.results.some((r) => r.type === 'scar' && r.parent !== null) ?? false).toBe(true);
  const res = (await regionsOf(page))!;
  const scar = res.results.find((r) => r.type === 'scar')!;
  const dors = res.results.find((r) => r.type === 'dorsal')!;
  expect(scar.parent).toBe(dors.id);
  // the dorsal face keeps its area, the scar's is its own
  expect(Math.abs(res.totals.dorsal - totals.dorsal)).toBeLessThan(1);
  expect(scar.area!).toBeGreaterThan(80);
  expect(scar.area!).toBeLessThan(160);
  await expect(page.locator('#region-scar')).toBeVisible();
  // the user's own type is the last key
  await page.keyboard.press('9');
  await expect(page.locator('#region-type-text')).toBeVisible();
  await page.locator('#region-type-text').fill('retouch, fine');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).regions.find((r) => r.id === scar.id)?.type).toBe('retouch, fine');
  await page.locator('#app-mode-annotate').click();
  const rows = parseCsv(await page.evaluate(() => window.lithicanalyst.exportRegionsCsvText()));
  const row = rows.find((r) => r.type === 'retouch, fine')!;
  expect(row.parent_region).toBe(dors.label);
  expect(rows.find((r) => r.type === 'dorsal')!.parent_region).toBe('');
});

test('an edge that does not close leaves the two faces unnamed, and says so', async ({ page }) => {
  await setType(page, 'flake');
  await drawAxis(page);
  await drawOutline(page);
  // only a part of the way: the ventral and dorsal faces stay one piece
  await page.evaluate(() => window.lithicanalyst.view([0, 0, -1], [0, 1, 0]));
  await nextFrames(page);
  await page.keyboard.press('p');
  for (const p of [[-14.9, 20, 0], [14.9, 20, 0]] as Vec3[]) await curveClick(page, await toScreen(page, p), { shift: true });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).curves.length).toBe(2);
  await page.keyboard.press('v');
  await page.keyboard.press('2');
  await expect.poll(async () => (await state(page)).regions.filter((r) => r.auto).length).toBe(3);
  await openSection(page, 'regions');
  await expect(page.locator('#region-faces-open')).toBeVisible();
  const totals = (await regionsOf(page))!.totals;
  expect(totals.ventral).toBe(0);
  expect(totals.dorsal).toBe(0);
});

test('an empty measure says why when the pointer rests on it', async ({ page }) => {
  await setType(page, 'flake');
  await drawAxis(page);
  await drawOutline(page);
  await page.keyboard.press('v');
  await page.locator('#app-mode-measure').click();
  await openSection(page, 'flake');
  await expect.poll(async () => (await measures(page))?.platform_depth_chord ?? null).not.toBeNull();
  // no platform ends
  const empty = page.locator('#flake-platform_width_chord');
  await expect(empty).toHaveText('—');
  await empty.hover();
  await expect(page.locator('.tip')).toHaveText('Fewer than two platform ends');
  // one with a value has none
  await page.locator('#flake-platform_depth_chord').hover();
  await expect(page.locator('.tip')).toHaveCount(0);
  // nor do the reasons go into the file
  const file = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(file.derived.flake?.measures.platform_width_chord).toBeNull();
  expect(JSON.stringify(file)).not.toContain('no_ends');
  expect((await flake(page))?.reasons?.platform_width_chord).toBe('no_ends');
});

test('the tools that place things click through the labels; the select tool takes them', async ({ page }) => {
  await setType(page, 'flake');
  await drawAxis(page);
  if (await page.locator('#profile-panel').isVisible()) await page.locator('#profile-close').click();
  await page.keyboard.press('v');
  await page.evaluate(() => window.lithicanalyst.selectForTest(null));
  // the whole flake seen from its ventral face: the label over the model
  await page.evaluate(() => window.lithicanalyst.view([0, 0, -1], [0, 1, 0]));
  await nextFrames(page, 3);
  const label = page.locator('.arrow-label', { hasText: 'Technical axis' });
  const box = (await label.boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // the curve tool: the model under it takes the point
  await page.keyboard.press('p');
  await expect(page.locator('.viewport')).toHaveAttribute('data-tool', 'curve');
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.curveDraft()))?.length ?? 0).toBe(1);
  expect(await page.evaluate(() => window.lithicanalyst.selection())).toBeNull();
  await page.keyboard.press('Escape');
  // the select tool: the label takes the click
  await page.keyboard.press('v');
  await expect(page.locator('.viewport')).toHaveAttribute('data-tool', 'select');
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  const id = (await state(page)).flake.axis!.id;
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.selection())).toBe(id);
  // each of the other tools that place, and the two that pick by label
  const pointerEvents = () => label.evaluate((e) => getComputedStyle(e).pointerEvents);
  for (const [key, none] of [['a', true], ['e', true], ['k', true], ['r', true], ['b', false], ['q', false]] as const) {
    await page.keyboard.press(key);
    await expect.poll(pointerEvents).toBe(none ? 'none' : 'auto');
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
  }
});

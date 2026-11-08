import type { Page } from '@playwright/test';
import { type Vec3 } from './fixtures/meshes';
import { expect, exportFile, nextFrames, openApp, openSection, parseCsv, state, test, toScreen } from './helpers';
import { annotatedTool, look, retouch } from './retouchSetup';

const rim = (deg: number): Vec3 => [30 * Math.cos((deg * Math.PI) / 180), 30 * Math.sin((deg * Math.PI) / 180), 0];

const rows = (page: Page) => page.evaluate(() => window.lithicanalyst.workingEdges().rows);

const clickRim = async (page: Page, deg: number): Promise<void> => {
  const s = await toScreen(page, rim(deg));
  await page.mouse.move(s.x, s.y);
  await page.mouse.click(s.x, s.y);
};

/** Drag along the rim from one place to another. */
async function dragRim(page: Page, from: number, to: number): Promise<void> {
  const a = await toScreen(page, rim(from));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    const b = await toScreen(page, rim(from + ((to - from) * i) / steps));
    await page.mouse.move(b.x, b.y);
  }
  await page.mouse.up();
}

/** The stepped tool as a flake, and two working edges by the tool: half the rim each. */
async function twoHalves(page: Page): Promise<{ edge: string; first: string; second: string }> {
  await openApp(page);
  const a = await annotatedTool(page);
  await look(page, [0, 0, 1], [0, 1, 0]);
  await page.keyboard.press('w');
  await expect(page.locator('#mode-working-edge')).toHaveAttribute('aria-checked', 'true');
  await clickRim(page, 0);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.workingEdges().pending)).not.toBeNull();
  await clickRim(page, 180);
  await expect.poll(async () => (await state(page)).workingEdges.length).toBe(1);
  await clickRim(page, 180);
  await clickRim(page, 0);
  await expect.poll(async () => (await state(page)).workingEdges.length).toBe(2);
  await expect.poll(async () => (await retouch(page))?.segments.length ?? 0).toBe(2);
  await expect.poll(async () => (await rows(page))[0]?.giur ?? null).not.toBeNull();
  await page.keyboard.press('v');
  return a;
}

test('two halves by the tool: their rows, the columns of the files, the charts and the table', async ({ page, pageErrors }) => {
  await twoHalves(page);
  const st = await state(page);
  expect(st.workingEdges.map((e) => e.label)).toEqual(['E1', 'E2']);
  // the two meet in one point
  expect(st.workingEdges[0].end).toEqual(st.workingEdges[1].start);
  expect(st.workingEdges[1].end).toEqual(st.workingEdges[0].start);
  // the bands, labels and handles of the annotate mode
  await expect(page.locator('.edge-label')).toHaveCount(2);
  await expect(page.locator('#working-edge-list li')).toHaveCount(2);
  const drawn = await page.evaluate(() => window.lithicanalyst.workingEdges().drawn);
  expect(drawn).toEqual({ edges: 2, lines: 2, handles: 4 });

  const whole = (await retouch(page))!;
  const [a, b] = await rows(page);
  for (const r of [a, b]) {
    expect(Math.abs(r.edge_curvature! - 0.5)).toBeLessThan(0.02);
    expect(Math.abs(r.edge_curvature_chord! - 60)).toBeLessThan(2);
    expect(Math.abs(r.edge_curvature_depth! - 30)).toBeLessThan(1);
    expect(Math.abs(r.giur! - 0.941)).toBeLessThan(0.01);
    expect(Math.abs(r.retouch_perimeter! - 1)).toBeLessThan(0.005);
  }
  expect(a.removed_volume! + b.removed_volume!).toBeCloseTo(whole.removed_volume!, 6);
  expect(a.erp! + b.erp!).toBeCloseTo(whole.erp!, 9);

  // the files
  await page.locator('#app-mode-measure').click();
  await expect(page.locator('.edge-label')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.workingEdges().drawn?.handles)).toBe(0);
  // ticks, not bands: one at each end
  expect((await page.evaluate(() => window.lithicanalyst.workingEdges().drawn))?.lines).toBe(4);
  const out = await exportFile(page, 'working-edges');
  expect(out.name).toBe('tool_working_edges.csv');
  expect(out.text.split('\n')[0]).toBe('specimen_id,working_edge,name,curve_id,start_position,end_position,length,sharp_length,retouched_length,retouch_perimeter,retouch_perimeter_dorsal,retouch_perimeter_ventral,removed_volume,erp,erp_filled_share,giur,giur_stations,edge_curvature,edge_curvature_chord,edge_curvature_depth');
  const table = parseCsv(out.text);
  expect(table.map((r) => r.working_edge)).toEqual(['E1', 'E2']);
  expect(Math.abs(Number(table[0].edge_curvature) - 0.5)).toBeLessThan(0.02);
  expect(Number(table[0].giur_stations) + Number(table[1].giur_stations)).toBe(whole.giur_stations);
  for (const key of ['edge-angles', 'retouch-angles', 'retouch-sections', 'retouch-segments']) {
    const f = await exportFile(page, key);
    const lines = parseCsv(f.text);
    expect(Object.keys(lines[0]).at(-1), key).toBe('working_edge');
    expect(new Set(lines.map((r) => r.working_edge)), key).toEqual(new Set(key === 'retouch-segments' ? [lines[0].working_edge] : ['E1', 'E2']));
  }
  // the sharp stretches are cut where a working edge begins or ends
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), st.curves[0].id);
  await openSection(page, 'edge-angle');
  await page.locator('#sharp-threshold').fill('170');
  await page.locator('#sharp-threshold').press('Enter');
  await expect.poll(() => page.evaluate((id) => window.lithicanalyst.sharpEdge(id)?.segments.length ?? 0, st.curves[0].id)).toBeGreaterThan(0);
  const sharp = await page.evaluate((id) => window.lithicanalyst.sharpEdge(id)!, st.curves[0].id);
  const pieces = parseCsv((await exportFile(page, 'edge-sharp')).text);
  expect(Object.keys(pieces[0]).at(-1)).toBe('working_edge');
  expect(pieces.length).toBeGreaterThan(sharp.segments.length);
  expect(pieces.reduce((s, r) => s + Number(r.length), 0)).toBeCloseTo(sharp.length, 3);
  const sharpRows = parseCsv((await exportFile(page, 'working-edges')).text);
  expect(sharpRows.reduce((s, r) => s + Number(r.sharp_length), 0)).toBeCloseTo(sharp.length, 3);

  // the chart of the measure mode: all of the curve, or one working edge
  const stations = (id: string) => page.locator(id).getAttribute('data-stations');
  const all = Number(await stations('#edge-chart'));
  await expect(page.locator('#edge-chart-edge-E1')).toBeVisible();
  await expect(page.locator('#edge-chart-edge-E2')).toBeVisible();
  await page.locator('#edge-view-E1').click();
  await expect.poll(async () => Number(await stations('#edge-chart'))).toBeLessThan(0.6 * all);
  await expect(page.locator('#edge-chart-edge-E2')).toHaveCount(0);
  await page.locator('#edge-view-all').click();
  await expect.poll(async () => Number(await stations('#edge-chart'))).toBe(all);

  // the retouch mode: its chart, the label by the position, the table and the plan
  await page.locator('#app-mode-retouch').click();
  await expect(page.locator('#working-edge-table')).toBeVisible();
  await expect(page.locator('#working-edge-rows tr')).toHaveCount(2);
  await expect(page.locator('#retouch-section-edge')).toHaveText(/^E[12]$/);
  const allLayers = Number(await stations('#retouch-chart'));
  await page.locator('#retouch-view-E2').click();
  await expect.poll(async () => Number(await stations('#retouch-chart'))).toBeLessThan(0.6 * allLayers);
  await page.locator('#retouch-view-all').click();
  await expect(page.locator('#retouch-plan-edge')).toHaveCount(0);
  await page.locator('#working-edge-row-1').click();
  await expect(page.locator('#retouch-section-edge')).toHaveText('E2');
  await expect(page.locator('#retouch-plan-edge')).toHaveAttribute('data-edge', 'E2');
  await expect(page.locator('#working-edge-row-1')).toHaveClass(/is-selected/);
  // its own chord: the whole closed curve has none
  await expect(page.locator('#retouch-plan-chord')).toBeVisible();
  const r3 = await page.locator('#retouch-plan-chord').boundingBox();
  await page.locator('#working-edge-row-0').click();
  await expect(page.locator('#retouch-plan-edge')).toHaveAttribute('data-edge', 'E1');
  await expect(page.locator('#retouch-section-edge')).toHaveText('E1');
  await page.locator('#working-edge-row-0').click();
  await expect(page.locator('#retouch-plan-edge')).toHaveCount(0);
  await expect(page.locator('#retouch-plan-chord')).toHaveCount(0);
  expect(r3!.width + r3!.height).toBeGreaterThan(20);
  // the table of retouch regions has a column for it
  await expect(page.locator('#retouch-segment-table th').last()).toHaveText('Working edge');
  expect(pageErrors).toEqual([]);
});

test('an end stops at the next edge\'s; undo and redo; another stretch overlapping is refused', async ({ page, pageErrors }) => {
  await twoHalves(page);
  const ids = (await state(page)).workingEdges.map((e) => e.id);
  await look(page, [0, 0, 1], [0, 1, 0]);
  await page.evaluate(() => window.lithicanalyst.selectForTest(null));
  await nextFrames(page);
  // the end of E1 back to 135°: it may go there
  await dragRim(page, 180, 135);
  await expect.poll(async () => (await state(page)).workingEdges[0].end[0]).toBeGreaterThan(-25);
  const e1 = (await state(page)).workingEdges[0];
  expect(Math.atan2(e1.end[1], e1.end[0]) * 180 / Math.PI).toBeCloseTo(135, -1);
  expect((await state(page)).workingEdges[1].start[0]).toBeLessThan(-29);
  // the start of E2 past it: it stops on that very point
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), ids[1]);
  await nextFrames(page);
  await dragRim(page, 180, 90);
  await expect.poll(async () => (await state(page)).workingEdges[1].start).toEqual(e1.end);
  // undo: back; redo: there again
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await state(page)).workingEdges[1].start[0]).toBeLessThan(-29);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await state(page)).workingEdges[1].start).toEqual(e1.end);
  // the other stretch of E1 would run over E2
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), ids[0]);
  await page.locator('#working-edge-other').click();
  await expect(page.locator('.toast').last()).toContainText('E2');
  expect((await state(page)).workingEdges[0].end).toEqual(e1.end);
  // nor can a new one be made over them
  await page.keyboard.press('w');
  await clickRim(page, 30);
  await clickRim(page, 60);
  await expect(page.locator('.toast').last()).toContainText('E1');
  expect((await state(page)).workingEdges.length).toBe(2);
  // Esc lets the first point go
  await clickRim(page, 30);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.workingEdges().pending)).not.toBeNull();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.workingEdges().pending)).toBeNull();
  await page.keyboard.press('v');
  // a name, and it is deleted by its button
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), ids[1]);
  await page.locator('#working-edge-name').fill('left side');
  await expect.poll(async () => (await state(page)).workingEdges[1].name).toBe('left side');
  await expect(page.locator('#working-edge-list li').nth(1)).toContainText('left side');
  await page.locator('#working-edge-delete').click();
  await expect.poll(async () => (await state(page)).workingEdges.length).toBe(1);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await state(page)).workingEdges.length).toBe(2);
  expect(pageErrors).toEqual([]);
});

test('the edge curve deleted: its working edges with it, and back with undo; not measured: kept, and says so', async ({ page, pageErrors }) => {
  const { edge } = await twoHalves(page);
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), edge);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await state(page)).curves.some((c) => c.id === edge)).toBe(false);
  expect((await state(page)).workingEdges.length).toBe(0);
  await expect(page.locator('.edge-label')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await state(page)).workingEdges.length).toBe(2);
  await expect(page.locator('.edge-label')).toHaveCount(2);
  // the curve no longer measured: they stay, and take no part
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), edge);
  await page.locator('#curve-edge-angle').uncheck();
  await expect.poll(async () => (await rows(page)).length).toBe(0);
  const first = (await state(page)).workingEdges[0].id;
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), first);
  await expect(page.locator('#working-edge-not-measured')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('from the retouched stretches, and the project file keeps them', async ({ page, pageErrors }) => {
  await openApp(page);
  const { first } = await annotatedTool(page);
  // the layers go all round: no stretch to make one of
  await page.evaluate(() => window.lithicanalyst.selectForTest(null));
  await openSection(page, 'working-edges');
  await page.locator('#working-edge-generate').click();
  await expect(page.locator('.toast').last()).toContainText('No retouched stretch');
  expect((await state(page)).workingEdges.length).toBe(0);
  // no edges: the whole curve is one implied row
  await expect.poll(async () => (await rows(page)).length).toBe(1);
  expect((await rows(page))[0].label).toBe('');
  await expect.poll(async () => (await rows(page))[0].reasons.edge_curvature ?? null).toBe('whole_edge');
  await page.keyboard.press('w');
  await look(page, [0, 0, 1], [0, 1, 0]);
  await clickRim(page, 0);
  await clickRim(page, 120);
  await expect.poll(async () => (await state(page)).workingEdges.length).toBe(1);
  // only E1 now: there is no row for the rest of the curve
  await expect.poll(async () => (await rows(page)).map((r) => r.label)).toEqual(['E1']);
  const json = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(json.workingEdges.length).toBe(1);
  expect(json.nextWorkingEdgeNumber).toBe(2);
  expect(json.derived.workingEdges?.edges.map((r) => r.label)).toEqual(['E1']);
  expect(json.derived.workingEdges?.parameters.WORKING_EDGE_MIN_MM).toBe(2);
  expect(first).toBeTruthy();
  expect(pageErrors).toEqual([]);
});

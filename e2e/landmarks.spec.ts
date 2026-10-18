import type { Page } from '@playwright/test';
import { boxPly, boxPoint, spherePly, SPHERE, type Vec3 } from './fixtures/meshes';
import { counts, curveClick, dist, download, expect, loadMesh, nextFrames, openApp, parseCsv, state, test, toScreen, viewFromTop, waitForMesh } from './helpers';

const table = (page: Page) => page.evaluate(() => window.lithicanalyst.landmarkTable());
const names = async (page: Page) => (await state(page)).landmarks.map((l) => l.name);
const xs = async (page: Page) => (await table(page)).sets[0].points.map((p) => +(p[0] - boxPoint(0, 0, 0)[0]).toFixed(3) + 0);

/** Landmark tool: place a landmark exactly where clicked (Shift: no snapping). */
async function place(page: Page, p: Vec3): Promise<void> {
  const before = (await state(page)).landmarks.length;
  const s = await toScreen(page, p);
  await page.mouse.move(s.x, s.y, { steps: 2 });
  await page.keyboard.down('Shift');
  await page.mouse.click(s.x, s.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await state(page)).landmarks.length).toBe(before + 1);
}

test('places, names, orders and moves landmarks; semilandmarks follow; exports agree', async ({ page, browser }) => {
  const ply = boxPly();
  await openApp(page);
  await loadMesh(page, ply);
  await viewFromTop(page);
  // a straight curve along the top face, 30 long
  await page.keyboard.press('p');
  for (const p of [boxPoint(-15, -5, 5), boxPoint(15, -5, 5)]) await curveClick(page, await toScreen(page, p), { shift: true });
  await page.keyboard.press('Enter');
  await expect.poll(() => counts(page)).toEqual({ arrows: 0, curves: 1 });

  await page.keyboard.press('k');
  await expect(page.locator('#mode-landmark')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#snap-control')).toBeVisible();
  for (const p of [boxPoint(-15, -5, 5), boxPoint(15, -5, 5), boxPoint(0, 5, 5)]) await place(page, p);
  let st = await state(page);
  expect(st.landmarks.map((l) => l.name)).toEqual(['LM1', 'LM2', 'LM3']);
  expect(dist(st.landmarks[2].point, boxPoint(0, 5, 5))).toBeLessThan(0.2);
  expect(await page.evaluate(() => window.lithicanalyst.selection())).toBe(st.landmarks[2].id);
  await expect(page.locator('#landmark-list .landmark-row')).toHaveCount(3);

  // name it; drag it to the top of the list; undo, redo
  await page.locator('#landmark-name').fill('apex');
  await page.keyboard.press('Escape');
  await page.locator('#landmark-list .landmark-row', { hasText: 'apex' }).dragTo(page.locator('#landmark-list .landmark-row', { hasText: 'LM1' }));
  await expect.poll(() => names(page)).toEqual(['apex', 'LM1', 'LM2']);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => names(page)).toEqual(['LM1', 'LM2', 'apex']);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => names(page)).toEqual(['apex', 'LM1', 'LM2']);
  await page.locator('#landmark-list .landmark-row', { hasText: 'LM2' }).click();
  await page.locator('#landmark-up').click();
  await expect.poll(() => names(page)).toEqual(['apex', 'LM2', 'LM1']);
  await page.keyboard.press('ControlOrMeta+z');

  // four semilandmarks on the curve between LM1 and LM2
  await page.locator('#semilandmark-add').click();
  await expect(page.locator('#semilandmark-list .semilandmark-row')).toHaveCount(1);
  await page.locator('#semilandmark-count').fill('4');
  st = await state(page);
  await page.locator('#semilandmark-start').selectOption(st.landmarks[1].id);
  await page.locator('#semilandmark-end').selectOption(st.landmarks[2].id);
  await expect.poll(() => xs(page)).toEqual([-9, -3, 3, 9]);
  let tb = await table(page);
  expect(tb.rows.map((r) => [r.index, r.name, r.kind])).toEqual([
    [1, 'apex', 'fixed'],
    [2, 'LM1', 'fixed'],
    [3, 'LM2', 'fixed'],
    [4, 'SL1_1', 'curve'],
    [5, 'SL1_2', 'curve'],
    [6, 'SL1_3', 'curve'],
    [7, 'SL1_4', 'curve'],
  ]);
  expect(tb.sliders).toEqual([
    [2, 4, 5],
    [4, 5, 6],
    [5, 6, 7],
    [6, 7, 3],
  ]);

  // drag LM1 along the curve: the semilandmarks follow
  await page.keyboard.press('k');
  const from = await toScreen(page, boxPoint(-15, -5, 5));
  const to = await toScreen(page, boxPoint(-10, -5, 5));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(() => xs(page)).toEqual([-5, 0, 5, 10]);
  expect((await state(page)).landmarks).toHaveLength(3);
  // deleting the curve leaves the set without points; undo brings them back
  await page.locator('#curve-list .curve-row').first().click();
  await page.keyboard.press('Delete');
  await expect(page.locator('#semilandmark-list .arrow-len')).toHaveText('–');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#semilandmark-list .arrow-len')).toHaveText('4');

  // exports: the same seven points everywhere
  tb = await table(page);
  const tps = await download(page, () => page.locator('#export-landmarks-tps').click());
  expect(tps.name).toBe('box_landmarks.tps');
  const lines = tps.text.trim().split('\n');
  expect([lines[0], lines[8], lines.length]).toEqual(['LM3=7', 'ID=box', 9]);
  expect(lines[1].split(' ').map(Number)).toEqual(tb.rows[0].point.map((v) => +v.toFixed(6)));
  const fcsv = await download(page, () => page.locator('#export-landmarks-fcsv').click());
  expect(fcsv.name).toBe('box_landmarks.fcsv');
  expect(fcsv.text.split('\n')[1]).toBe('# CoordinateSystem = LPS');
  expect(fcsv.text.split('\n')[3]).toMatch(/^1,[-\d.]+,[-\d.]+,[-\d.]+,0,0,0,1,1,1,0,apex,,$/);
  const csv = await download(page, () => page.locator('#export-landmarks-csv').click());
  expect(parseCsv(csv.text).map((r) => [r.index, r.name, r.kind, r.set_id])).toEqual(tb.rows.map((r) => [String(r.index), r.name, r.kind, r.setId]));
  const sliders = await download(page, () => page.locator('#export-sliders-csv').click());
  expect(sliders.name).toBe('box_sliders.csv');
  expect(sliders.text).toBe('before,slider,after\n2,4,5\n4,5,6\n5,6,7\n6,7,3\n');

  // figure: landmarks drawn as dots in the view from the top
  await page.keyboard.press('m');
  await page.keyboard.press('m');
  await expect(page.locator('#fig-landmarks')).toBeChecked();
  const fig = await page.evaluate(() => window.lithicanalyst.figure('svg'));
  const front = /<g id="view-front"[\s\S]*?<\/g>\n<\/g>/.exec(fig!.data)?.[0] ?? '';
  expect(front.match(/<circle class="fixed"/g)).toHaveLength(3);
  expect(front.match(/<circle class="curve"/g)).toHaveLength(4);
  await page.keyboard.press('m');

  // save, reopen
  st = await state(page);
  const saved = await download(page, () => page.locator('#btn-save-project').click());
  expect(JSON.parse(saved.text).derived.landmarks.sliders).toEqual(tb.sliders);
  const context = await browser.newContext();
  const fresh = await context.newPage();
  await openApp(fresh);
  await loadMesh(fresh, ply);
  const chooser = fresh.waitForEvent('filechooser');
  await fresh.locator('#btn-open-project').click();
  await (await chooser).setFiles({ name: saved.name, mimeType: 'application/json', buffer: Buffer.from(saved.text) });
  await waitForMesh(fresh, 'box.ply');
  await expect.poll(async () => (await state(fresh)).landmarks).toEqual(st.landmarks);
  expect((await state(fresh)).semilandmarks).toEqual(st.semilandmarks);
  expect(await table(fresh)).toEqual(tb);
  await context.close();
});

test('names landmarks of the next specimen from the last one, with skipping', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, boxPly());
  await viewFromTop(page);
  await expect(page.locator('#landmark-reuse-names')).toBeDisabled();
  await page.keyboard.press('k');
  for (const p of [boxPoint(-10, 0, 5), boxPoint(10, 0, 5)]) await place(page, p);
  for (const [i, name] of ['apex', 'base'].entries()) {
    await page.locator('#landmark-list .landmark-row').nth(i).click();
    await page.locator('#landmark-name').fill(name);
  }
  await expect.poll(() => names(page)).toEqual(['apex', 'base']);

  await loadMesh(page, spherePly());
  await page.evaluate(() => window.lithicanalyst.view([0, 0, 1], [0, 1, 0]));
  await nextFrames(page);
  await page.locator('#landmark-reuse-names').click();
  await expect(page.locator('#landmark-next-name')).toHaveText('apex');
  await page.locator('#landmark-skip-name').click();
  await expect(page.locator('#landmark-next-name')).toHaveText('base');
  await page.keyboard.press('k');
  const top: Vec3 = [SPHERE.center[0], SPHERE.center[1], SPHERE.center[2] + SPHERE.radius];
  await place(page, top);
  await expect(page.locator('#landmark-next-name')).toHaveText('–');
  await place(page, [top[0] + 3, top[1], top[2] - 0.3]);
  expect(await names(page)).toEqual(['base', 'LM1']);
  // undo the named one: its name is next again
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#landmark-next-name')).toHaveText('base');
  await page.locator('#landmark-stop-names').click();
  await expect(page.locator('#landmark-reuse-names')).toBeEnabled();
});

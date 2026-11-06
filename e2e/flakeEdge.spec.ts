import type { Page } from '@playwright/test';
import { T1, t1Ply, type Vec3 } from './fixtures/meshes';
import { curveClick, expect, exportFile, loadMesh, nextFrames, openApp, openSection, parseCsv, state, test, toScreen } from './helpers';

const pill = (page: Page, key: string) => page.locator(`#status-${key}`);
const done = (page: Page, key: string) => expect(pill(page, key)).toHaveAttribute('data-done', 'true');
const notDone = (page: Page, key: string) => expect(pill(page, key)).toHaveAttribute('data-done', 'false');

// a little inside the model's corners, where a click finds the surface; the points go to the corners' vertices
const OUTLINE: Vec3[] = [[-14.8, -0.04, 0.2], [14.8, -0.04, 0.2], [14.8, -1.96, 9.8], [-14.8, -1.96, 9.8]];
const EDGE: Vec3[] = [[-14.7, 0.3, 0], [-14.7, 59.7, 0], [14.7, 59.7, 0], [14.7, 0.3, 0]];

async function openFlake(page: Page): Promise<void> {
  await openApp(page);
  await page.locator('#start-type-flake').click();
  await loadMesh(page, t1Ply());
}

async function drawAxis(page: Page): Promise<void> {
  await page.evaluate(() => window.lithicanalyst.view([0, 0, -1], [0, 1, 0]));
  await nextFrames(page);
  await page.evaluate(() => window.lithicanalyst.snap.prepare('ridge'));
  await pill(page, 'axis').click();
  const s = await toScreen(page, [0, 0.4, 0]), e = await toScreen(page, T1.A);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(e.x, e.y, { steps: 8 });
  await page.mouse.up();
  await done(page, 'axis');
  if (await page.locator('#profile-panel').isVisible()) await page.locator('#profile-close').click();
}

/** With the curve tool active (Shift: no snapping): through these points, closed or not. */
async function trace(page: Page, points: Vec3[], close: boolean): Promise<void> {
  const before = (await state(page)).curves.length;
  for (const p of points) await curveClick(page, await toScreen(page, p), { shift: true });
  if (close) {
    const a = await toScreen(page, points[0]);
    await page.mouse.move(a.x, a.y, { steps: 3 });
    await page.keyboard.down('Shift');
    await page.mouse.click(a.x, a.y);
    await page.keyboard.up('Shift');
  } else await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).curves.length).toBe(before + 1);
}

const onPlatform = () => window.lithicanalyst.view([0, -0.98, 0.196], [0, 0.196, 0.98]);
const onVentral = () => window.lithicanalyst.view([0, 0, -1], [-1, 0, 0]);

async function drawOutline(page: Page): Promise<void> {
  await pill(page, 'platform_outline').click();
  await page.evaluate(onPlatform);
  await nextFrames(page);
  await trace(page, OUTLINE, true);
  await done(page, 'platform_outline');
}

const curveOf = async (page: Page, type: string) => (await state(page)).curves.find((c) => c.attributes.type === type)!;
const edgeResult = async (page: Page) => {
  const id = (await curveOf(page, 'edge')).id;
  return page.evaluate((x) => window.lithicanalyst.edgeAngles(x), id);
};

test('the edge need not close: open, with its ends on the outline, the faces are apart; short of it, they are not, and it says why', async ({ page }) => {
  await openFlake(page);
  await drawAxis(page);

  // no outline yet: the regions are there, the faces are not apart
  await pill(page, 'edge').click();
  await page.evaluate(onVentral);
  await nextFrames(page);
  await trace(page, EDGE, false);
  await expect.poll(async () => (await state(page)).regions.map((r) => r.type).sort()).toEqual(['dorsal', 'ventral']);
  await notDone(page, 'faces');
  await pill(page, 'faces').hover();
  await expect(page.locator('.tip')).toContainText('both ends of the edge must reach it');
  await page.mouse.move(5, 5);
  await page.keyboard.press('v');
  await page.evaluate(async () => {
    const st = window.lithicanalyst.state();
    window.lithicanalyst.selectForTest(st.curves.find((c) => c.attributes.type === 'edge')!.id);
  });
  await openSection(page, 'regions');
  await expect(page.locator('#region-faces-open')).toBeVisible();
  // ... which offers to complete the loop, since without an outline it would have to close
  await expect(page.locator('#curve-complete')).toBeVisible();

  // the outline ends it: nothing more to do to the edge, and no offer to go on along the platform
  await drawOutline(page);
  await done(page, 'faces');
  await expect(page.locator('#region-faces-open')).toBeHidden();
  await page.keyboard.press('v');
  await page.evaluate(() => {
    const st = window.lithicanalyst.state();
    window.lithicanalyst.selectForTest(st.curves.find((c) => c.attributes.type === 'edge')!.id);
  });
  await expect(page.locator('#curve-insp-label')).toBeVisible();
  await expect(page.locator('#curve-complete')).toBeHidden();
  expect((await curveOf(page, 'edge')).closed).toBe(false);
  // all of it measured
  await expect(page.locator('#curve-measured-length')).toHaveCount(0);
  await expect.poll(async () => Math.round((await edgeResult(page))?.length ?? 0)).toBeGreaterThan(145);

  // undo the outline: the same again
  await page.keyboard.press('Control+z');
  await notDone(page, 'faces');
  await expect(page.locator('#curve-complete')).toBeVisible();
});

test('a closed edge beside a platform outline is measured off the platform, and all round without one', async ({ page }) => {
  await openFlake(page);
  await pill(page, 'edge').click();
  await page.evaluate(onVentral);
  await nextFrames(page);
  await trace(page, EDGE, true);
  const edge = await curveOf(page, 'edge');
  expect(edge.closed).toBe(true);
  await expect.poll(async () => (await edgeResult(page))?.stations.length ?? 0).toBeGreaterThan(170);
  const roundAll = (await edgeResult(page))!;
  const onRim = (r: typeof roundAll) => r.stations.filter((s) => s.point && Math.abs(s.point[1]) < 0.5 && Math.abs(s.point[0]) < 13).length;
  expect(onRim(roundAll)).toBeGreaterThan(20);

  await drawOutline(page);
  await page.keyboard.press('v');
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), edge.id);
  await expect.poll(async () => (await edgeResult(page))?.stations.length ?? 0).toBeLessThan(155);
  const off = (await edgeResult(page))!;
  expect(onRim(off)).toBe(0);
  expect(off.length).toBeGreaterThan(145);
  expect(off.length).toBeLessThan(151);

  // the curve itself as it was: closed, its whole length; and how much of it is measured
  expect((await curveOf(page, 'edge')).closed).toBe(true);
  await expect(page.locator('#curve-length')).toContainText('180');
  await expect(page.locator('#curve-measured-length')).toContainText('150');
  // its file says so
  const file = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(file.derived.measuredLines?.curves.map((c) => c.curveId)).toEqual([edge.id]);

  // the table has no row from the platform
  await page.locator('#app-mode-measure').click();
  await openSection(page, 'edge-angle');
  const rows = parseCsv((await exportFile(page, 'edge-angles')).text);
  expect(rows.length).toBeGreaterThan(0);
  expect(new Set(rows.map((r) => r.station)).size).toBe(off.stations.length);
  await page.locator('#app-mode-annotate').click();

  // the outline goes: all round again
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await edgeResult(page))?.stations.length ?? 0).toBeGreaterThan(170);
});

test('an edge stopping short of the outline goes to it, even with a scar\'s outline nearer', async ({ page }) => {
  await openFlake(page);
  await drawAxis(page);
  await drawOutline(page);
  await page.evaluate(onVentral);
  await nextFrames(page);
  // a scar's outline just beside where the edge will end, at both ends
  await page.keyboard.press('p');
  await trace(page, [[-14, 2, 0], [-5, 2, 0]], false);
  await page.keyboard.press('v');
  await page.keyboard.press('p');
  await trace(page, [[14, 2, 0], [5, 2, 0]], false);
  await page.keyboard.press('v');
  // the edge: 3 mm short of the outline, the scar's outline a little over 1 mm off
  await pill(page, 'edge').click();
  await trace(page, [[-14.7, 3, 0], EDGE[1], EDGE[2], [14.7, 3, 0]], false);
  await done(page, 'faces');
  await expect(page.locator('#region-faces-open')).toBeHidden();
  await expect.poll(async () => {
    const r = await page.evaluate(() => window.lithicanalyst.regions());
    return r?.results.filter((x) => x.area !== null).map((x) => x.type).sort() ?? [];
  }).toEqual(['dorsal', 'platform', 'ventral']);
});

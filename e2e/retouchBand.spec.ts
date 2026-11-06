import type { Page } from '@playwright/test';
import { T1, t1Ply, type Vec3 } from './fixtures/meshes';
import { curveClick, expect, loadMesh, nextFrames, openApp, openSection, state, test, toScreen } from './helpers';

const OUTLINE: Vec3[] = [[-14.8, -0.04, 0.2], [14.8, -0.04, 0.2], [14.8, -1.96, 9.8], [-14.8, -1.96, 9.8]];
const EDGE: Vec3[] = [[-14.7, 0.3, 0], [-14.7, 59.7, 0], [14.7, 59.7, 0], [14.7, 0.3, 0]];
const onVentral = () => window.lithicanalyst.view([0, 0, -1], [-1, 0, 0]);

const pill = (page: Page, key: string) => page.locator(`#status-${key}`);
const results = async (page: Page) => (await page.evaluate(() => window.lithicanalyst.regions()))?.results ?? [];
const retouchRegions = async (page: Page) => (await results(page)).filter((r) => r.type === 'retouch');
const areas = async (page: Page) => (await retouchRegions(page)).map((r) => Math.round(r.area ?? -1));

async function trace(page: Page, points: Vec3[], close = false): Promise<void> {
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

/** T1 as a flake: its axis, the outline round the platform, the edge. */
async function annotated(page: Page): Promise<void> {
  await openApp(page, 'flake');
  await loadMesh(page, t1Ply());
  await page.evaluate(() => window.lithicanalyst.view([0, 0, -1], [0, 1, 0]));
  await nextFrames(page);
  await page.evaluate(() => window.lithicanalyst.snap.prepare('ridge'));
  await page.keyboard.press('t');
  const s = await toScreen(page, [0, 0.4, 0]), e = await toScreen(page, T1.A);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(e.x, e.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.flake()))?.axis?.matrix ?? null).not.toBeNull();
  if (await page.locator('#profile-panel').isVisible()) await page.locator('#profile-close').click();
  await pill(page, 'platform_outline').click();
  await page.evaluate(() => window.lithicanalyst.view([0, -0.98, 0.196], [0, 0.196, 0.98]));
  await nextFrames(page);
  await trace(page, OUTLINE, true);
  await pill(page, 'edge').click();
  await page.evaluate(onVentral);
  await nextFrames(page);
  await trace(page, EDGE);
  await expect(pill(page, 'faces')).toHaveAttribute('data-done', 'true');
}

/** A retouch curve across the ventral face, from edge to edge. */
async function acrossVentral(page: Page, y: number): Promise<void> {
  await pill(page, 'retouch').click();
  await expect(page.locator('#mode-curve')).toHaveAttribute('aria-checked', 'true');
  await trace(page, [[-14.7, y, 0], [14.7, y, 0]]);
}

test('a retouch curve from edge to edge makes what lies between it and the edge a retouch region, with no region tool', async ({ page }) => {
  await annotated(page);
  await expect(pill(page, 'retouch')).toHaveAttribute('data-done', 'false');
  await acrossVentral(page, 55);
  await expect.poll(() => areas(page)).toEqual([150]);
  const [band] = (await state(page)).regions.filter((r) => r.curveId);
  expect(band).toMatchObject({ type: 'retouch', retouchLayer: 1, auto: true });
  await expect(pill(page, 'retouch')).toHaveAttribute('data-done', 'true');
  // no scar made for it
  expect((await state(page)).scars).toEqual([]);
  // in the ventral face
  const ventral = (await results(page)).find((r) => r.type === 'ventral')!;
  expect((await retouchRegions(page))[0].parent).toBe(ventral.id);

  // what the retouch mode measures, with nothing more
  await page.locator('#app-mode-retouch').click();
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.retouch()))?.retouch_perimeter ?? 0).toBeGreaterThan(0.2);
  const r = (await page.evaluate(() => window.lithicanalyst.retouch()))!;
  expect(r.retouch_perimeter!).toBeLessThan(0.3);
  expect(r.retouch_perimeter_ventral!).toBeCloseTo(r.retouch_perimeter!, 6);
  expect(r.retouch_perimeter_dorsal!).toBe(0);
  await page.locator('#app-mode-annotate').click();

  // undo takes both
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await state(page)).regions.filter((x) => x.curveId).length).toBe(0);
  expect((await state(page)).curves).toHaveLength(2);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => areas(page)).toEqual([150]);
});

test('the region tool corrects it: the other side, its layer, another type, or deleted', async ({ page }) => {
  await annotated(page);
  await acrossVentral(page, 55);
  await expect.poll(() => areas(page)).toEqual([150]);
  const curveId = (await state(page)).regions.find((r) => r.curveId)!.curveId!;

  // a click in it selects it
  await page.keyboard.press('r');
  const at = await toScreen(page, [0, 57.5, 0]);
  const count = (await state(page)).regions.length;
  await page.mouse.click(at.x, at.y);
  const id = (await state(page)).regions.find((r) => r.curveId)!.id;
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.selection())).toBe(id);
  expect((await state(page)).regions).toHaveLength(count);
  await expect(page.locator('#region-type-retouch')).toHaveAttribute('aria-checked', 'true');

  // the other side
  await openSection(page, 'regions');
  await page.locator('#region-other-side').click();
  await expect.poll(() => areas(page)).toEqual([1650]);
  expect((await state(page)).curves.find((c) => c.id === curveId)!.retouchSide).toBe('larger');
  // and back
  await page.locator('#region-other-side').click();
  await expect.poll(() => areas(page)).toEqual([150]);

  // its layer stays
  await page.keyboard.press('Shift+Digit2');
  await expect.poll(async () => (await state(page)).regions.find((r) => r.id === id)!.retouchLayer).toBe(2);
  await page.locator('#region-other-side').click();
  await expect.poll(() => areas(page)).toEqual([1650]);
  expect((await state(page)).regions.find((r) => r.id === id)!.retouchLayer).toBe(2);
  await page.locator('#region-other-side').click();
  await expect.poll(() => areas(page)).toEqual([150]);

  // deleted: it stays so while other curves change
  await page.locator('#region-delete').click();
  await expect.poll(async () => (await state(page)).regions.filter((r) => r.curveId).length).toBe(0);
  expect((await state(page)).curves.find((c) => c.id === curveId)!.retouchSide).toBe('off');
  await page.keyboard.press('p');
  await trace(page, [[-5, 20, 0], [5, 20, 0]]);
  expect((await state(page)).regions.filter((r) => r.curveId)).toEqual([]);
  // undo brings it back
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect.poll(() => areas(page)).toEqual([150]);
  expect((await state(page)).curves.find((c) => c.id === curveId)!.retouchSide).toBeUndefined();

  // another type by hand: an ordinary region, where it was
  await page.keyboard.press('r');
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.selection())).toBe(id);
  await page.keyboard.press('2');
  await expect.poll(async () => (await state(page)).regions.find((r) => r.id === id)!.type).toBe('cortex');
  const given = (await state(page)).regions.find((r) => r.id === id)!;
  expect(given.auto).toBeUndefined();
  expect(given.curveId).toBeUndefined();
  expect(given.seed[1]).toBeGreaterThan(55);
  expect((await state(page)).curves.find((c) => c.id === curveId)!.retouchSide).toBe('off');
  await expect.poll(async () => Math.round((await results(page)).find((r) => r.id === id)?.area ?? -1)).toBe(150);
});

test('a scar\'s outline across the band leaves it one region; a second curve further in has its own', async ({ page }) => {
  await annotated(page);
  await acrossVentral(page, 55);
  await expect.poll(() => areas(page)).toEqual([150]);
  const regions = (await state(page)).regions.length;

  // a scar's outline from the curve to the edge
  await page.keyboard.press('p');
  await trace(page, [[0, 55, 0], [0, 59.7, 0]]);
  await page.keyboard.press('v');
  await nextFrames(page, 3);
  await expect.poll(() => areas(page)).toEqual([150]);
  expect((await state(page)).regions).toHaveLength(regions);
  // both parts are it
  await page.keyboard.press('r');
  const id = (await state(page)).regions.find((r) => r.curveId)!.id;
  for (const p of [[-7, 57, 0], [7, 57, 0]] as Vec3[]) {
    const at = await toScreen(page, p);
    await page.evaluate(() => window.lithicanalyst.selectForTest(null));
    await page.mouse.click(at.x, at.y);
    await expect.poll(() => page.evaluate(() => window.lithicanalyst.selection())).toBe(id);
  }
  expect((await state(page)).regions).toHaveLength(regions);

  // another curve, further from the edge: what lies between the two is its
  await acrossVentral(page, 50);
  await expect.poll(async () => (await areas(page)).sort((a, b) => a - b)).toEqual([150, 150]);
  const bands = (await state(page)).regions.filter((r) => r.curveId);
  expect(bands).toHaveLength(2);
  const between = await toScreen(page, [0, 52.5, 0]);
  await page.keyboard.press('r');
  await page.mouse.click(between.x, between.y);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.selection())).toBe(bands[1].id);
  await page.keyboard.press('Shift+Digit2');
  await expect.poll(async () => (await state(page)).regions.find((r) => r.id === bands[1].id)!.retouchLayer).toBe(2);
  // the two layers along the edge
  await page.locator('#app-mode-retouch').click();
  await expect.poll(async () => {
    const curve = (await state(page)).curves.find((c) => c.attributes.type === 'edge')!;
    const a = await page.evaluate((x) => window.lithicanalyst.retouchAngles(x), curve.id);
    return [...new Set(a?.stations.flatMap((s) => s.stretches.map((x) => x.layer)) ?? [])].sort();
  }).toEqual([1, 2]);
});

test('a curve not reaching the edge has no region; a project file from before keeps its own, by hand', async ({ page }) => {
  await annotated(page);
  // from the edge to the middle of the face: it closes nothing off
  await pill(page, 'retouch').click();
  await trace(page, [[-14.7, 40, 0], [0, 40, 0]]);
  await page.keyboard.press('v');
  expect((await state(page)).regions.filter((r) => r.curveId)).toEqual([]);

  await acrossVentral(page, 55);
  await expect.poll(() => areas(page)).toEqual([150]);
  const file = await page.evaluate(() => window.lithicanalyst.projectJson());
  const old = structuredClone(file);
  // the region marked by hand, as files have it
  const made = old.annotations.regions.find((r) => r.curveId)!;
  delete made.curveId;
  delete made.auto;
  made.seed = [0, 57.5, 0];
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#btn-file').click();
  await page.locator('#btn-open-project').click();
  await (await chooser).setFiles({ name: 't1.lithicanalyst.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(old)) });
  await expect.poll(async () => (await state(page)).regions.find((r) => r.id === made.id)?.auto ?? null).toBeNull();
  await expect.poll(() => areas(page)).toEqual([150]);
  expect((await state(page)).regions.filter((r) => r.curveId)).toEqual([]);
  const curve = (await state(page)).curves.find((c) => c.attributes.type === 'retouch' && c.points.length > 20)!;
  expect(curve.retouchSide).toBe('off');
});

import type { Page } from '@playwright/test';
import { T1, t1Ply, t6Dorsal, t6Ply, t6Ventral, t6Zv, type Vec3 } from './fixtures/meshes';
import { curveClick, expect, loadMesh, nextFrames, openApp, openSection, state, test, toScreen } from './helpers';

const OUTLINE: Vec3[] = [[-14.8, -0.04, 0.2], [14.8, -0.04, 0.2], [14.8, -1.96, 9.8], [-14.8, -1.96, 9.8]];
const EDGE: Vec3[] = [[-14.7, 0.3, 0], [-14.7, 59.7, 0], [14.7, 59.7, 0], [14.7, 0.3, 0]];

const endsOf = async (page: Page) => (await state(page)).landmarks.filter((l) => l.code === 'platform_end');
const measures = async (page: Page) => (await page.evaluate(() => window.lithicanalyst.flake()))?.measures ?? null;
const pill = (page: Page, key: string) => page.locator(`#status-${key}`);

async function openFlake(page: Page): Promise<void> {
  await openApp(page, 'flake');
  await loadMesh(page, t1Ply());
}

async function drawAxis(page: Page): Promise<void> {
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
}

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
}

async function drawEdge(page: Page, points = EDGE, close = false): Promise<void> {
  await pill(page, 'edge').click();
  await page.evaluate(onVentral);
  await nextFrames(page);
  await trace(page, points, close);
}

test('there is no tool for them: they come where the edge meets the outline, and PW with them', async ({ page }) => {
  await openFlake(page);
  await expect(page.locator('#mode-platform-end')).toHaveCount(0);
  await page.keyboard.press('e');
  await expect(page.locator('#mode-select')).toHaveAttribute('aria-checked', 'true');
  await page.locator('#btn-help').click();
  await expect(page.getByRole('dialog')).not.toContainText('Platform end');
  await page.keyboard.press('Escape');

  await drawAxis(page);
  await drawOutline(page);
  expect(await endsOf(page)).toEqual([]);
  await expect(pill(page, 'platform_ends')).toHaveCount(0);

  await drawEdge(page);
  await expect(pill(page, 'edge')).toHaveAttribute('data-done', 'true');
  await expect.poll(async () => (await endsOf(page)).length).toBe(2);
  const ends = await endsOf(page);
  expect(ends.map((l) => l.auto)).toEqual([true, true]);
  expect(ends.map((l) => Math.round(l.point[0])).sort((a, b) => a - b)).toEqual([-15, 15]);
  const names = (await page.evaluate(() => window.lithicanalyst.landmarkTable())).rows.map((r) => r.name);
  expect(names).toEqual(['pop', 'platform_left', 'platform_right']);
  await expect.poll(async () => (await measures(page))?.platform_width_chord ?? null).not.toBeNull();
  expect((await measures(page))!.platform_width_chord!).toBeCloseTo(30, 0);

  // one step with the curve
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await state(page)).curves.length).toBe(1);
  expect(await endsOf(page)).toEqual([]);
  await expect.poll(async () => (await measures(page))?.platform_width_chord ?? null).toBeNull();
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await endsOf(page)).length).toBe(2);
});

test('a closed edge gives the same two points; an edge stopping far short of the outline, none', async ({ page }) => {
  await openFlake(page);
  await drawOutline(page);
  await drawEdge(page, EDGE, true);
  await expect.poll(async () => (await endsOf(page)).length).toBe(2);
  expect((await endsOf(page)).map((l) => Math.round(l.point[0])).sort((a, b) => a - b)).toEqual([-15, 15]);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await endsOf(page)).length).toBe(0);
  await drawEdge(page, [[-14.7, 12, 0], EDGE[1], EDGE[2], [14.7, 12, 0]]);
  expect(await endsOf(page)).toEqual([]);
  // the edge's pill says so, and goes to that edge
  await expect(pill(page, 'edge')).toHaveAttribute('data-done', 'false');
  await pill(page, 'edge').hover();
  await expect(page.locator('.tip')).toContainText('does not reach the platform outline');
  await page.mouse.move(5, 5);
  await pill(page, 'edge').click();
  await expect(page.locator('#mode-select')).toHaveAttribute('aria-checked', 'true');
  const edge = (await state(page)).curves.find((c) => c.attributes.type === 'edge')!;
  expect(await page.evaluate(() => window.lithicanalyst.selection())).toBe(edge.id);
  expect(await page.evaluate(() => window.lithicanalyst.nextCurveType())).toBeNull();
});

test('the select tool moves one along the outline; it stays there, undo and the reset bring it back', async ({ page }) => {
  await openFlake(page);
  await drawOutline(page);
  await drawEdge(page);
  await expect.poll(async () => (await endsOf(page)).length).toBe(2);
  await page.keyboard.press('v');
  await page.evaluate(() => window.lithicanalyst.selectForTest(null));
  await page.evaluate(onPlatform);
  await nextFrames(page, 3);
  const left = (await endsOf(page)).find((l) => l.point[0] < 0)!;
  const right = (await endsOf(page)).find((l) => l.point[0] > 0)!;

  // press on it, drag along the inner rim, a little off it: it goes to the outline
  const from = await toScreen(page, left.point), to = await toScreen(page, [-8, -0.2, 1]);
  await page.mouse.move(from.x, from.y, { steps: 2 });
  await nextFrames(page, 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).landmarks.find((l) => l.id === left.id)?.auto ?? null).toBeNull();
  const moved = (await state(page)).landmarks.find((l) => l.id === left.id)!;
  expect(Math.abs(moved.point[0] - left.point[0])).toBeGreaterThan(3);
  // on the outline: on the face from the inner rim to the outer one the points are all on a line through its plane
  expect(Math.min(Math.abs(moved.point[1]), Math.abs(moved.point[1] + 2))).toBeLessThan(0.3);
  await expect(page.locator('#sec-landmarks')).toHaveJSProperty('open', true);
  expect(await page.evaluate(() => window.lithicanalyst.selection())).toBe(left.id);
  // the other is as it was
  expect((await state(page)).landmarks.find((l) => l.id === right.id)).toMatchObject({ auto: true, point: right.point });

  // Esc lets a drag go
  const before = moved.point;
  const at = await toScreen(page, before), there = await toScreen(page, [-3, -0.2, 1]);
  await page.mouse.move(at.x, at.y, { steps: 2 });
  await page.mouse.down();
  await page.mouse.move(there.x, there.y, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await state(page)).landmarks.find((l) => l.id === left.id)!.point).toEqual(before);

  // undo: following again
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await state(page)).landmarks.find((l) => l.id === left.id)?.auto ?? null).toBe(true);
  expect((await state(page)).landmarks.find((l) => l.id === left.id)!.point).toEqual(left.point);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await state(page)).landmarks.find((l) => l.id === left.id)?.auto ?? null).toBeNull();

  // its panel: one moved by hand can go back; one following has nothing to delete
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), left.id);
  await openSection(page, 'landmarks');
  await expect(page.locator('#landmark-delete')).toHaveCount(0);
  await page.locator('#landmark-end-reset').click();
  await expect.poll(async () => (await state(page)).landmarks.find((l) => l.id === left.id)?.auto ?? null).toBe(true);
  expect((await state(page)).landmarks.find((l) => l.id === left.id)!.point).toEqual(left.point);
  await expect(page.locator('#landmark-end-reset')).toHaveCount(0);
  await expect(page.locator('#landmark-delete')).toHaveCount(0);
  // ... nor does the key delete it
  await page.mouse.move(5, 5);
  await page.keyboard.press('Delete');
  expect((await endsOf(page)).length).toBe(2);
});

test('the select tool moves a landmark of the user\'s too, by what it snaps to; not the point of percussion', async ({ page }) => {
  await openFlake(page);
  await drawAxis(page);
  await page.evaluate(() => window.lithicanalyst.view([0, 0, -1], [0, 1, 0]));
  await nextFrames(page, 3);
  // one of the user's, on the ventral face
  await page.keyboard.press('k');
  const from = await toScreen(page, [5, 30, 0]);
  await page.mouse.move(from.x, from.y, { steps: 2 });
  await page.keyboard.down('Shift');
  await page.mouse.click(from.x, from.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await state(page)).landmarks.filter((l) => !l.code).length).toBe(1);
  const own = (await state(page)).landmarks.find((l) => !l.code)!;
  await page.keyboard.press('v');
  await page.evaluate(() => window.lithicanalyst.selectForTest(null));
  await nextFrames(page, 2);

  // Shift: to the point, with no snapping
  const to = await toScreen(page, [-5, 20, 0]);
  await page.mouse.move(from.x, from.y, { steps: 2 });
  await nextFrames(page, 2);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(async () => Math.round((await state(page)).landmarks.find((l) => l.id === own.id)!.point[0])).toBe(-5);
  expect(Math.round((await state(page)).landmarks.find((l) => l.id === own.id)!.point[1])).toBe(20);
  expect(await page.evaluate(() => window.lithicanalyst.selection())).toBe(own.id);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => Math.round((await state(page)).landmarks.find((l) => l.id === own.id)!.point[0])).toBe(5);

  // a press on the point of percussion moves nothing of it
  const pop = (await state(page)).landmarks.find((l) => l.code === 'pop')!;
  const at = await toScreen(page, pop.point);
  await page.mouse.move(at.x, at.y, { steps: 2 });
  await page.mouse.down();
  await page.mouse.move(at.x + 30, at.y + 30, { steps: 4 });
  await page.mouse.up();
  await nextFrames(page, 2);
  expect((await state(page)).landmarks.find((l) => l.id === pop.id)!.point).toEqual(pop.point);
});

test('a project file from before they followed the curves: its own ends stay; without any, they come', async ({ page }) => {
  await openFlake(page);
  await drawOutline(page);
  await drawEdge(page);
  await expect.poll(async () => (await endsOf(page)).length).toBe(2);
  const file = await page.evaluate(() => window.lithicanalyst.projectJson());
  const open = async (raw: unknown) => {
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#btn-file').click();
    await page.locator('#btn-open-project').click();
    await (await chooser).setFiles({ name: 't1.lithicanalyst.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(raw)) });
  };

  // ends placed by hand: not moved, and none added
  const byHand = structuredClone(file);
  for (const l of byHand.annotations.landmarks) {
    delete l.auto;
    l.point = [l.point[0] * 0.8, l.point[1], l.point[2]];
  }
  await open(byHand);
  await expect.poll(async () => (await endsOf(page)).map((l) => l.auto ?? null)).toEqual([null, null]);
  expect((await endsOf(page)).map((l) => Math.round(l.point[0])).sort((a, b) => a - b)).toEqual([-12, 12]);

  // none in the file
  const none = structuredClone(file);
  none.annotations.landmarks = [];
  await open(none);
  await expect.poll(async () => (await endsOf(page)).map((l) => l.auto ?? null)).toEqual([true, true]);
  expect((await endsOf(page)).map((l) => Math.round(l.point[0])).sort((a, b) => a - b)).toEqual([-15, 15]);
});

test('on the realistic flake, its curves following the ridges, they give the platform width', async ({ page }) => {
  await openApp(page, 'flake');
  await loadMesh(page, t6Ply(14));
  await page.evaluate(() => window.lithicanalyst.snap.prepare('ridge'));
  // the axis, half a millimetre from the platform's edge
  await page.evaluate(() => window.lithicanalyst.view([0, 0, -1], [0, 1, 0]));
  await nextFrames(page);
  await page.keyboard.press('t');
  const s = await toScreen(page, t6Ventral(0, 0.5)), e = await toScreen(page, [0, 40, t6Zv(0, 40)]);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(e.x, e.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.flake()))?.axis?.matrix ?? null).not.toBeNull();
  if (await page.locator('#profile-panel').isVisible()) await page.locator('#profile-close').click();

  // the outline by its rims, seen square on
  await pill(page, 'platform_outline').click();
  await page.evaluate(() => window.lithicanalyst.view([0, -0.96, -0.28], [0, -0.28, 0.96]));
  await nextFrames(page);
  const rim = (s: number, k: number): Vec3 => {
    const a = t6Ventral(s, 0), b = t6Dorsal(s, 0);
    return [a[0], a[1] + k * (b[1] - a[1]), a[2] + k * (b[2] - a[2])];
  };
  for (const p of [...[-0.98, -0.5, 0, 0.5, 0.98].map((x) => rim(x, 0.03)), ...[0.5, 0, -0.5].map((x) => rim(x, 0.97))]) await curveClick(page, await toScreen(page, p));
  const first = await toScreen(page, (await page.evaluate(() => window.lithicanalyst.curveDraft()))![0]);
  await page.mouse.move(first.x, first.y, { steps: 3 });
  await page.mouse.click(first.x, first.y);
  await expect.poll(async () => (await state(page)).curves[0]?.closed ?? false).toBe(true);

  // the edge from one end of the platform round the distal end to the other
  await pill(page, 'edge').click();
  await page.evaluate(() => window.lithicanalyst.view([0, 0, -1], [0, 1, 0]));
  await nextFrames(page);
  const along = (s: number, y: number) => t6Ventral(s, y);
  const stops: Vec3[] = [along(-0.97, 2), along(-0.97, 16), along(-0.97, 32), along(-0.95, 46), along(-0.97, 54), along(-0.6, 57.8), along(0.6, 57.8), along(0.97, 54), along(0.95, 46), along(0.97, 32), along(0.97, 16), along(0.97, 2)];
  for (const p of stops) await curveClick(page, await toScreen(page, p));
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).curves.length).toBe(2);
  expect((await state(page)).curves[1].attributes.type).toBe('edge');

  await expect.poll(async () => (await endsOf(page)).length).toBe(2);
  await expect.poll(async () => (await measures(page))?.platform_width_chord ?? null).not.toBeNull();
  expect(Math.abs((await measures(page))!.platform_width_chord! - 22)).toBeLessThan(1);
  await expect(pill(page, 'faces')).toHaveAttribute('data-done', 'true');
});

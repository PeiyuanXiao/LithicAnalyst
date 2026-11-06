import type { Page } from '@playwright/test';
import { serializeProject } from '../src/core/schema';
import { emptyProject } from '../src/core/store';
import { boxPly, boxPoint, T1, t1Ply, type Vec3 } from './fixtures/meshes';
import { curveClick, dragArrow, expect, loadMesh, mockFolder, nextFrames, openApp, openMockFolder, setUnit, state, test, toScreen, viewFromTop } from './helpers';

const pill = (page: Page, key: string) => page.locator(`#status-${key}`);
const done = (page: Page, key: string) => expect(pill(page, key)).toHaveAttribute('data-done', 'true');
const notDone = (page: Page, key: string) => expect(pill(page, key)).toHaveAttribute('data-done', 'false');
const status = (page: Page) => page.evaluate(() => window.lithicanalyst.annotationStatus());
const nextType = (page: Page) => page.evaluate(() => window.lithicanalyst.nextCurveType());
const toolIs = (page: Page, id: string) => expect(page.locator(`#mode-${id}`)).toHaveAttribute('aria-checked', 'true');

/** A curve through these points, drawn with the curve tool active (Shift: no snapping). */
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

test('a flake from blank: each pill turns as what it stands for is made, and a click on it goes there', async ({ page }) => {
  await openApp(page, 'flake');
  await loadMesh(page, t1Ply());
  await setUnit(page, '');

  // all the items, none yet; the retouch regions apart
  await expect(page.locator('#annotation-status .status-pill:not(.status-count)')).toHaveText(['○Unit', '○Technical axis', '○Edge', '○Platform outline', '○Dorsal / ventral', '○Retouch regions']);
  await expect(pill(page, 'retouch')).toHaveClass(/is-optional/);
  await expect(page.locator('#status-count')).toBeHidden();
  expect(await status(page)).toMatchObject({ done: 0, total: 5 });

  // what is missing and why, in the tooltip
  await pill(page, 'platform_outline').hover();
  await expect(page.locator('.tip')).toContainText('No platform outline: PD, PW, platform area, EPA and IPA are empty');
  await page.mouse.move(5, 5);

  // from another mode, the unit: the specimen panel with the unit in focus
  await page.locator('#app-mode-measure').click();
  await pill(page, 'unit').click();
  expect(await page.evaluate(() => window.lithicanalyst.mode())).toBe('annotate');
  await expect(page.locator('#specimen-panel')).toBeVisible();
  await expect(page.locator('#specimen-unit')).toBeFocused();
  await page.locator('#specimen-unit').selectOption('mm');
  await page.keyboard.press('Escape');
  await done(page, 'unit');
  await expect(pill(page, 'unit')).toContainText('✓');

  // the technical axis
  await pill(page, 'axis').click();
  await toolIs(page, 'axis');
  await page.evaluate(() => window.lithicanalyst.view([0, 0, -1], [0, 1, 0]));
  await nextFrames(page);
  await page.evaluate(() => window.lithicanalyst.snap.prepare('ridge'));
  const s = await toScreen(page, [0, 0.4, 0]), e = await toScreen(page, T1.A);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(e.x, e.y, { steps: 8 });
  await page.mouse.up();
  await done(page, 'axis');
  expect((await status(page)).done).toBe(2);
  await notDone(page, 'faces');
  if (await page.locator('#profile-panel').isVisible()) await page.locator('#profile-close').click();

  // the edge: the curve tool, and the next curve is of that type
  await pill(page, 'edge').click();
  await toolIs(page, 'curve');
  expect(await nextType(page)).toBe('edge');
  await expect(pill(page, 'edge')).toHaveClass(/is-armed/);
  await page.evaluate(() => window.lithicanalyst.view([0, 0, -1], [-1, 0, 0]));
  await nextFrames(page);
  await trace(page, [[-14.7, 0.3, 0], [-14.7, 59.7, 0], [14.7, 59.7, 0], [14.7, 0.3, 0]], false);
  expect((await state(page)).curves[0].attributes.type).toBe('edge');
  expect(await nextType(page)).toBeNull();
  await expect(pill(page, 'edge')).not.toHaveClass(/is-armed/);
  await done(page, 'edge');
  // with the axis the regions follow, and the two faces are not apart until the outline ends the edge
  await expect.poll(async () => (await state(page)).regions.map((r) => r.type).sort()).toEqual(['dorsal', 'ventral']);
  await notDone(page, 'faces');
  expect(await status(page)).toMatchObject({ done: 3, total: 5 });

  // one step: undo takes the curve and its type back
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await state(page)).curves.length).toBe(0);
  await notDone(page, 'edge');
  await notDone(page, 'faces');
  await page.keyboard.press('Control+Shift+z');
  await done(page, 'edge');

  // asked for, then another tool: it is let go of
  await pill(page, 'platform_outline').click();
  expect(await nextType(page)).toBe('platform_outline');
  await page.keyboard.press('v');
  expect(await nextType(page)).toBeNull();

  // the platform outline: closed, and of its type by itself
  await pill(page, 'platform_outline').click();
  await toolIs(page, 'curve');
  await expect(pill(page, 'platform_outline')).toHaveClass(/is-armed/);
  await page.evaluate(() => window.lithicanalyst.view([0, -0.98, 0.196], [0, 0.196, 0.98]));
  await nextFrames(page);
  const corner = (x: number, f: number): Vec3 => [x, -2 * f, 10 * f];
  await trace(page, [corner(-14.8, 0.02), corner(14.8, 0.02), corner(14.8, 0.98), corner(-14.8, 0.98)], true);
  const outline = (await state(page)).curves[1];
  expect(outline).toMatchObject({ closed: true, attributes: { type: 'platform_outline' } });
  await done(page, 'platform_outline');
  await done(page, 'faces');
  // ... and the number keys still change the type
  await page.keyboard.press('v');
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), outline.id);
  await expect(page.locator('#curve-field-type-platform_outline')).toHaveAttribute('aria-checked', 'true');

  // the platform ends came with the edge and the outline: no pill of their own
  await expect(pill(page, 'platform_ends')).toHaveCount(0);
  expect((await state(page)).landmarks.filter((l) => l.code === 'platform_end')).toHaveLength(2);
  expect(await status(page)).toMatchObject({ done: 5, total: 5 });
  await notDone(page, 'retouch');

  // the retouch regions come with their curve
  await pill(page, 'retouch').click();
  await toolIs(page, 'curve');
  expect(await nextType(page)).toBe('retouch');
  await page.keyboard.press('v');

  // the faces: the region tool, its section open
  await page.locator('#sec-regions').evaluate((d) => ((d as HTMLDetailsElement).open = false));
  await pill(page, 'faces').click();
  await toolIs(page, 'region');
  await expect(page.locator('#sec-regions')).toHaveJSProperty('open', true);

  // a narrow view: the count alone, the pills on hovering over it
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect(page.locator('#status-count')).toBeVisible();
  await expect(page.locator('#status-count')).toHaveText('5/5');
  await expect(pill(page, 'unit')).toBeHidden();
  await page.locator('#status-count').hover();
  await expect(pill(page, 'unit')).toBeVisible();
  await page.locator('#status-count').click();
  await expect(pill(page, 'unit')).toBeVisible();
  await page.mouse.move(5, 5);
  await expect(pill(page, 'unit')).toBeHidden();
  // (without a hover, as by touch: a click opens them and another closes them)
  await page.locator('#status-count').evaluate((b) => (b as HTMLElement).click());
  await expect(pill(page, 'unit')).toBeVisible();
  await page.locator('#status-count').evaluate((b) => (b as HTMLElement).click());
  await expect(pill(page, 'unit')).toBeHidden();
  // wide again
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('#status-count')).toBeHidden();
  await expect(pill(page, 'unit')).toBeVisible();
});

test('a core has the unit, the scar arrows and the core edge; a generic specimen the unit; no model, none', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#annotation-status')).toBeHidden();
  await loadMesh(page, boxPly());
  await viewFromTop(page);
  await expect(page.locator('#annotation-status .status-pill:not(.status-count)')).toHaveText(['✓Unit', '○Scar arrows', '○Core edge']);
  await expect(page.locator('#annotation-status')).toBeVisible();

  await pill(page, 'scar_arrows').click();
  await toolIs(page, 'draw');
  await dragArrow(page, boxPoint(-15, -5, 5), boxPoint(-2, 4, 5));
  await done(page, 'scar_arrows');

  await pill(page, 'core_edge').click();
  await toolIs(page, 'curve');
  await trace(page, [boxPoint(-15, 5, 5), boxPoint(15, 5, 5)], false);
  expect((await state(page)).curves[0].attributes.type).toBe('core_edge');
  await done(page, 'core_edge');
  expect(await status(page)).toMatchObject({ done: 3, total: 3 });

  // all modes show it
  for (const mode of ['measure', 'present', 'compare'] as const) {
    await page.locator(`#app-mode-${mode}`).click();
    await expect(pill(page, 'unit')).toBeVisible();
  }
  await page.locator('#app-mode-annotate').click();
  await page.locator('#specimen-more').click();
  await page.locator('#specimen-type').selectOption('generic');
  await page.keyboard.press('Escape');
  await expect(page.locator('#annotation-status .status-pill:not(.status-count)')).toHaveText(['✓Unit']);
});

test('the folder\'s list shows the same count, from the project files, with no model opened', async ({ page }) => {
  const flake = emptyProject();
  flake.specimen = { ...flake.specimen, id: 'b', unit: 'mm', type: 'flake' };
  await mockFolder(page, 'dig', {
    'a.ply': boxPly().buffer,
    'b.ply': t1Ply().buffer,
    'c.ply': boxPly().buffer,
    'LithicAnalyst/projects/b.ply.lithicanalyst.json': Buffer.from(JSON.stringify(serializeProject(flake, 'test'))),
  });
  await openApp(page);
  await openMockFolder(page);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.state().mesh?.fileName ?? null)).toBe('a.ply');
  // the open model, the file not opened, and a model with no project
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.workspace()))?.completion).toEqual([{ done: 1, total: 3 }, { done: 1, total: 5 }, null]);
  await expect(page.locator('#workspace-list .ws-row[data-index="0"] .ws-done')).toHaveText('1/3');
  await expect(page.locator('#workspace-list .ws-row[data-index="1"] .ws-done')).toHaveText('1/5');
  await expect(page.locator('#workspace-list .ws-row[data-index="2"] .ws-done')).toHaveCount(0);

  // the open model's follows it at once
  await viewFromTop(page);
  await page.keyboard.press('a');
  await dragArrow(page, boxPoint(-15, -5, 5), boxPoint(-2, 4, 5));
  await expect(page.locator('#workspace-list .ws-row[data-index="0"] .ws-done')).toHaveText('2/3');
  // the filter by type is as it was, with the new type in it
  await expect(page.locator('#workspace-type option')).toHaveText(['All', 'Core', 'Flake', 'General']);
});

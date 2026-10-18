import { roofPly, roofPoint } from './fixtures/meshes';
import { counts, curveClick, dragArrow, draftLength, expect, loadMesh, openApp, state, test, toScreen, viewFromTop } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await loadMesh(page, roofPly());
  await viewFromTop(page);
});

test('undo and redo step through arrows, fields and curves', async ({ page }) => {
  const undo = page.locator('#btn-undo');
  const redo = page.locator('#btn-redo');
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  await page.keyboard.press('a');
  await dragArrow(page, roofPoint(-14, 10), roofPoint(-8, 22));
  await page.keyboard.press('2');
  await page.keyboard.press('p');
  await curveClick(page, await toScreen(page, roofPoint(10, 10)), { shift: true });
  await curveClick(page, await toScreen(page, roofPoint(12, 20)), { shift: true });
  await page.keyboard.press('Enter');
  await expect.poll(() => counts(page)).toEqual({ arrows: 1, curves: 1 });
  const done = await state(page);
  expect(done.scars[0].attributes.completeness).toBe('bulb_complete');
  await expect(undo).toBeEnabled();

  // keyboard: back to the empty project, one step at a time
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => counts(page)).toEqual({ arrows: 1, curves: 0 });
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await state(page)).scars[0].attributes.completeness).toBe('point_complete');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => counts(page)).toEqual({ arrows: 0, curves: 0 });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();

  // redo with the keyboard and the header button
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => counts(page)).toEqual({ arrows: 1, curves: 0 });
  await redo.click();
  await expect.poll(async () => (await state(page)).scars[0].attributes.completeness).toBe('bulb_complete');
  await redo.click();
  await expect.poll(() => counts(page)).toEqual({ arrows: 1, curves: 1 });
  await expect(redo).toBeDisabled();
  const redone = await state(page);
  expect(redone.scars).toEqual(done.scars);
  expect(redone.curves).toEqual(done.curves);

  // a new change after an undo clears the redo history
  await undo.click();
  await expect.poll(() => counts(page)).toEqual({ arrows: 1, curves: 0 });
  await expect(redo).toBeEnabled();
  await page.keyboard.press('a');
  await dragArrow(page, roofPoint(12, 30), roofPoint(9, 42));
  await expect(redo).toBeDisabled();
  expect((await state(page)).scars.map((a) => a.label)).toEqual(['S1', 'S2']);
});

test('while a curve is being drawn, Ctrl+Z removes its last point instead', async ({ page }) => {
  await page.keyboard.press('a');
  await dragArrow(page, roofPoint(-14, 10), roofPoint(-8, 22));
  await page.keyboard.press('p');
  await curveClick(page, await toScreen(page, roofPoint(10, 10)), { shift: true });
  await curveClick(page, await toScreen(page, roofPoint(12, 20)), { shift: true });
  await curveClick(page, await toScreen(page, roofPoint(10, 30)), { shift: true });

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => draftLength(page)).toBe(2);
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => draftLength(page)).toBe(0);
  expect(await counts(page)).toEqual({ arrows: 1, curves: 0 });

  // nothing left to remove: the history takes over
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => counts(page)).toEqual({ arrows: 0, curves: 0 });
});

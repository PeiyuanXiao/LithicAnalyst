import { roofPly, roofPoint } from './fixtures/meshes';
import { counts, curveClick, dragArrow, expect, loadMesh, openApp, state, test, toScreen, viewFromTop } from './helpers';

const sections = ['arrows', 'curves', 'measure-auto', 'orientation', 'observers'] as const;

async function visibleSections(page: import('@playwright/test').Page): Promise<string[]> {
  const out: string[] = [];
  for (const s of sections) if (await page.locator(`#sec-${s}`).isVisible()) out.push(s);
  return out;
}

test('each mode shows its own tools and sections; switching keeps the selection and the undo history', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, roofPly());
  await viewFromTop(page);
  await expect(page.locator('#app-mode-annotate')).toHaveAttribute('aria-checked', 'true');
  expect(await visibleSections(page)).toEqual(['arrows', 'curves']);

  await page.keyboard.press('a');
  const start = roofPoint(-14, 10);
  const end = roofPoint(-8, 22);
  await dragArrow(page, start, end);
  await page.keyboard.press('4');
  const before = await state(page);
  const id = before.scars[0].id;

  // M: annotate → measure
  await page.keyboard.press('m');
  await expect(page.locator('#app-mode-measure')).toHaveAttribute('aria-checked', 'true');
  expect(await visibleSections(page)).toEqual(['measure-auto']);
  await expect(page.locator('#mode-draw')).toBeHidden();
  await expect(page.locator('#btn-fit')).toBeVisible();
  expect(await page.evaluate(() => window.lithicanalyst.selection())).toBe(id);

  // annotation keys and endpoint dragging do nothing here
  await page.keyboard.press('a');
  await page.keyboard.press('1');
  await page.keyboard.press('Delete');
  const e = await toScreen(page, end);
  await page.mouse.move(e.x, e.y);
  await page.mouse.down();
  await page.mouse.move(e.x + 60, e.y + 40, { steps: 6 });
  await page.mouse.up();
  expect((await state(page)).scars).toEqual(before.scars);

  await page.locator('#app-mode-present').click();
  await expect(page.locator('#app-mode-present')).toHaveAttribute('aria-checked', 'true');
  expect(await visibleSections(page)).toEqual(['orientation']);

  await page.keyboard.press('m');
  await expect(page.locator('#app-mode-compare')).toHaveAttribute('aria-checked', 'true');
  expect(await visibleSections(page)).toEqual(['observers']);
  await expect(page.locator('#sec-observers')).toBeVisible();

  // M wraps around to annotate: selection and history are still there
  await page.keyboard.press('m');
  await expect(page.locator('#app-mode-annotate')).toHaveAttribute('aria-checked', 'true');
  expect(await visibleSections(page)).toEqual(['arrows', 'curves']);
  await expect(page.locator('#mode-select')).toBeVisible();
  await expect(page.locator('#insp-label')).toHaveValue('S1');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await state(page)).scars[0].attributes.completeness).toBe('point_complete');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => (await state(page)).scars[0].attributes.completeness).toBe('point_truncated');

  // leaving the mode while drawing keeps the curve traced so far
  await viewFromTop(page);
  await page.keyboard.press('p');
  await curveClick(page, await toScreen(page, roofPoint(10, 10)), { shift: true });
  await curveClick(page, await toScreen(page, roofPoint(12, 20)), { shift: true });
  await page.locator('#app-mode-measure').click();
  await expect.poll(() => counts(page)).toEqual({ arrows: 1, curves: 1 });

  // the mode is remembered
  await page.reload();
  await page.waitForFunction(() => !!window.lithicanalyst);
  await expect(page.locator('#app-mode-measure')).toHaveAttribute('aria-checked', 'true');

  await page.keyboard.press('?');
  await expect(page.getByRole('dialog')).toContainText('Switch mode');
});

test('works in a window 400 px wide', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await openApp(page);
  await loadMesh(page, roofPly());
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await fits()).toBe(true);
  for (const id of ['#app-mode-annotate', '#app-mode-measure', '#app-mode-present', '#app-mode-compare', '#btn-file', '#btn-save-project', '#btn-lang', '#btn-help']) {
    const box = await page.locator(id).boundingBox();
    expect(box, id).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(400);
  }
  await page.locator('#app-mode-measure').click();
  expect(await visibleSections(page)).toEqual(['measure-auto']);
  await page.locator('#app-mode-annotate').click();
  await page.locator('#mode-draw').click();
  await viewFromTop(page);
  await dragArrow(page, roofPoint(-14, 10), roofPoint(-8, 22));
  await page.locator('#sec-arrows').scrollIntoViewIfNeeded();
  await expect(page.locator('#sec-arrows .arrow-row')).toHaveCount(1);
  expect(await fits()).toBe(true);
});

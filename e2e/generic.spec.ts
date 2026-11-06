import type { Page } from '@playwright/test';
import { boxPly, boxPoint } from './fixtures/meshes';
import { curveClick, displayPanel, dragArrow, expect, loadMesh, nextFrames, openApp, openSection, specimenPanel, state, test, toScreen, viewFromTop } from './helpers';

async function openGeneric(page: Page): Promise<void> {
  await openApp(page, 'generic');
  await loadMesh(page, boxPly());
  await viewFromTop(page);
}

async function setType(page: Page, type: 'core' | 'flake' | 'generic'): Promise<void> {
  await specimenPanel(page);
  await page.locator('#specimen-type').selectOption(type);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).specimen.type).toBe(type);
}

/** A straight open curve along the top face, at y (Shift: no snapping). */
async function drawCurve(page: Page, y: number): Promise<void> {
  const before = (await state(page)).curves.length;
  await page.keyboard.press('p');
  for (const x of [-15, 15]) await curveClick(page, await toScreen(page, boxPoint(x, y, 5)), { shift: true });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).curves.length).toBe(before + 1);
  await page.keyboard.press('v');
}

test('a generic specimen has none of the tools, panels and sections of a core or a flake', async ({ page }) => {
  await openGeneric(page);
  for (const id of ['mode-axis', 'mode-platform-end', 'mode-relation', 'mode-sequence', 'app-mode-retouch', 'btn-orient']) await expect(page.locator(`#${id}`)).toBeHidden();
  for (const id of ['mode-select', 'mode-draw', 'mode-curve', 'mode-working-edge', 'mode-region', 'mode-landmark']) await expect(page.locator(`#${id}`)).toBeVisible();
  // nor their keys
  for (const key of ['b', 'q', 't', 'e']) {
    await page.keyboard.press(key);
    await expect(page.locator('#mode-select')).toHaveAttribute('aria-checked', 'true');
  }
  for (const id of ['axis', 'relations', 'gm']) await expect(page.locator(`#sec-${id}`)).toBeHidden();
  await displayPanel(page);
  for (const id of ['config-show', 'harris-show', 'profile-show', 'gm-show']) await expect(page.locator(`#${id}`)).toBeHidden();
  const colours = await page.locator('#arrow-color option').evaluateAll((els) => els.filter((e) => !(e as HTMLOptionElement).hidden).map((e) => (e as HTMLOptionElement).value));
  expect(colours).toEqual(['uniform', 'direction']);
  await page.keyboard.press('Escape');

  // arrows have a label, and no scar's attributes
  await expect(page.locator('#sec-arrows .panel-title')).toHaveText('Arrows');
  await page.keyboard.press('a');
  await dragArrow(page, boxPoint(-15, -5, 5), boxPoint(-2, 4, 5));
  await page.keyboard.press('v');
  await page.evaluate(() => window.lithicanalyst.selectForTest(window.lithicanalyst.state().scars[0].id));
  await expect(page.locator('#insp-label')).toHaveValue('S1');
  await expect(page.locator('#arrow-coords')).toBeVisible();
  for (const id of ['field-completeness-point_complete', 'field-termination-feather', 'field-note', 'scar-sequence']) await expect(page.locator(`#${id}`)).toHaveCount(0);
  await expect(page.locator('#scar-list .arrow-meta')).toHaveText('');
  // its number keys set nothing
  const attributes = (await state(page)).scars[0].attributes;
  await page.keyboard.press('2');
  await page.keyboard.press('Shift+2');
  expect((await state(page)).scars[0].attributes).toEqual(attributes);
  await expect(page.locator('#sequence-bar')).toBeHidden();

  // no configuration panel or view cube for the arrows it has
  expect(await page.evaluate(() => window.lithicanalyst.configPanelShown())).toBe(false);
  expect(await page.evaluate(() => window.lithicanalyst.harrisShown())).toBe(false);

  // the measure mode: dimensions, area and volume; no flake's, no nodule, no sharp edge
  await page.locator('#app-mode-measure').click();
  await expect(page.locator('#sec-measure-auto')).toBeVisible();
  await expect(page.locator('#auto-length')).not.toHaveText('—');
  for (const id of ['flake', 'nodule', 'edge-angle']) await expect(page.locator(`#sec-${id}`)).toBeHidden();
  // planes by all the vertices, curves or regions
  await expect(page.locator('#sec-planes')).toBeVisible();
  await page.locator('#plane-add').click();
  const methods = await page.locator('#plane-method option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
  expect(methods).toEqual(['all_vertices', 'curves', 'region']);

  // the shortcuts leave them out too
  await page.keyboard.press('Escape');
  await page.locator('#btn-help').click();
  const help = page.getByRole('dialog');
  await expect(help).toContainText('Curve / region type (custom)');
  await expect(help).not.toContainText('Sequence');
  await expect(help).not.toContainText('Termination');
  await page.keyboard.press('Escape');
});

test('curves and regions take the user\'s own text alone: key 1, and what was typed before is suggested', async ({ page }) => {
  await openGeneric(page);
  await drawCurve(page, -5);
  const first = (await state(page)).curves[0];
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), first.id);
  expect(first.attributes.type).toBe('');
  await expect(page.locator('#curve-field-type .opt-btn, [id^="curve-field-type-"].opt-btn')).toHaveText(['1Custom']);

  // key 1 opens the box for it
  await page.keyboard.press('1');
  await expect(page.locator('#curve-field-type-text')).toBeFocused();
  await page.locator('#curve-field-type-text').fill('suture');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).curves[0].attributes.type).toBe('suture');
  await expect(page.locator('#curve-field-type-custom')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#curve-field-type-custom')).toContainText('suture');

  // the second curve is offered what the first was given
  await drawCurve(page, 5);
  await page.evaluate(() => window.lithicanalyst.selectForTest(window.lithicanalyst.state().curves[1].id));
  await page.locator('#curve-field-type-custom').click();
  await expect(page.locator('#curve-field-type-suggest option')).toHaveCount(1);
  expect(await page.locator('#curve-field-type-suggest option').first().getAttribute('value')).toBe('suture');
  await page.locator('#curve-field-type-text').fill('rim');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).curves[1].attributes.type).toBe('rim');

  // no edge angles until asked for
  await expect(page.locator('#curve-edge-angle')).not.toBeChecked();
  await page.locator('#app-mode-measure').click();
  await expect(page.locator('#sec-edge-angle')).toBeHidden();
  await page.locator('#app-mode-annotate').click();
  await page.locator('#curve-edge-angle').check();
  await page.locator('#app-mode-measure').click();
  await expect(page.locator('#sec-edge-angle')).toBeVisible();
  await openSection(page, 'edge-angle');
  // ... and no sharp edge in it
  await expect(page.locator('#edge-angle-list .arrow-row')).toHaveCount(1);
  await page.locator('#edge-angle-list .arrow-row').click();
  await expect(page.locator('#edge-angle-chart')).toBeVisible();
  await expect(page.locator('#sharp-box')).toBeHidden();
  await expect(page.locator('#sharp-summary')).toBeHidden();
});

test('every curve cuts the one layer of regions; a region is no scar, and has the user\'s own text', async ({ page }) => {
  await openGeneric(page);
  // closed, with a type a flake's would count as a boundary of its upper layer
  await page.keyboard.press('p');
  const corners = [boxPoint(-10, -5, 5), boxPoint(10, -5, 5), boxPoint(10, 5, 5), boxPoint(-10, 5, 5)];
  for (const p of corners) await curveClick(page, await toScreen(page, p), { shift: true });
  const a = await toScreen(page, corners[0]);
  await page.mouse.move(a.x, a.y, { steps: 3 });
  await page.keyboard.down('Shift');
  await page.mouse.click(a.x, a.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await state(page)).curves.length).toBe(1);
  await page.keyboard.press('v');
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.regionCount())).toBe(2);

  await page.keyboard.press('r');
  const inside = await toScreen(page, boxPoint(0, 0, 5));
  await page.mouse.click(inside.x, inside.y);
  await expect.poll(async () => (await state(page)).regions.length).toBe(1);
  let st = await state(page);
  expect(st.regions[0]).toMatchObject({ type: 'region', scarId: null });
  expect(st.scars).toEqual([]);
  await expect(page.locator('#region-type-custom')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[id^="region-type-"].opt-btn')).toHaveCount(1);
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.regions()))?.results[0]?.area ?? null).toBeCloseTo(20 * 10, 3);
  await expect(page.locator('#region-totals')).toBeHidden();

  // key 1, the text; even a word that means something on another type
  await page.keyboard.press('1');
  await expect(page.locator('#region-type-text')).toBeFocused();
  await page.locator('#region-type-text').fill('platform');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).regions[0].type).toBe('platform');
  // ... which is still in the one layer, cut by the curve, with no parts above it
  const r = (await page.evaluate(() => window.lithicanalyst.regions()))!.results[0];
  expect(r.area).toBeCloseTo(20 * 10, 3);
  expect(r.parent).toBeNull();
  st = await state(page);
  expect(st.scars).toEqual([]);
  await page.locator('#region-type-custom').click();
  await page.locator('#region-type-text').fill('scar');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).regions[0].type).toBe('scar');
  expect((await state(page)).regions[0].scarId).toBeNull();
  expect((await state(page)).scars).toEqual([]);
  await expect(page.locator('#region-scar')).toHaveCount(0);
});

test('the export dialog has no file of the other types', async ({ page }) => {
  await openGeneric(page);
  const offered = async () => {
    await page.locator('#btn-export').click();
    const keys = await page.locator('.export-list input[data-key]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.key!));
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal')).toHaveCount(0);
    return keys;
  };
  const annotate = await offered();
  for (const key of ['configuration', 'flaking-surfaces', 'relations', 'series', 'gm-tps', 'flakes']) expect(annotate).not.toContain(key);
  for (const key of ['scar-vectors', 'curves', 'regions', 'landmarks-csv', 'landmarks-tps']) expect(annotate).toContain(key);
  await page.locator('#app-mode-measure').click();
  const measure = await offered();
  for (const key of ['flakes', 'retouch-sections', 'retouch-segments', 'invasiveness', 'retouch-angles', 'edge-sharp']) expect(measure).not.toContain(key);
  for (const key of ['edge-angles', 'working-edges', 'measurements', 'manual', 'planes']) expect(measure).toContain(key);
});

test('from another type and back: nothing is lost, and a preset type on a curve is shown but not offered', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, boxPly());
  await viewFromTop(page);
  expect((await state(page)).specimen.type).toBe('core');
  // a core's: an arrow with its attributes, a scar region, a curve of a preset type
  await page.keyboard.press('a');
  await dragArrow(page, boxPoint(-15, -5, 5), boxPoint(-2, 4, 5));
  await page.keyboard.press('2');
  await expect.poll(async () => (await state(page)).scars[0].attributes.completeness).toBe('bulb_complete');
  await drawCurve(page, 5);
  await page.evaluate(() => window.lithicanalyst.selectForTest(window.lithicanalyst.state().curves[0].id));
  await page.keyboard.press('1');
  await expect.poll(async () => (await state(page)).curves[0].attributes.type).toBe('scar_boundary');
  await page.keyboard.press('r');
  const at = await toScreen(page, boxPoint(0, 0, 5));
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await state(page)).regions.length).toBe(1);
  await page.keyboard.press('v');
  const before = await state(page);
  const data = (s: typeof before) => JSON.stringify([s.scars, s.curves, s.regions]);

  await setType(page, 'generic');
  expect(data(await state(page))).toBe(data(before));
  await page.evaluate(() => window.lithicanalyst.selectForTest(window.lithicanalyst.state().curves[0].id));
  await expect(page.locator('#curve-field-type-scar_boundary')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[id^="curve-field-type-"].opt-btn')).toHaveCount(2);
  await expect(page.locator('#curve-field-type-custom')).toBeVisible();
  // the number key is the user's own text, whatever the curve has now
  await page.keyboard.press('1');
  await expect(page.locator('#curve-field-type-text')).toBeFocused();
  await page.keyboard.press('Escape');

  await setType(page, 'flake');
  expect(data(await state(page))).toBe(data(before));
  await expect(page.locator('#mode-axis')).toBeVisible();
  await setType(page, 'generic');
  await setType(page, 'core');
  expect(data(await state(page))).toBe(data(before));
  await page.evaluate(() => window.lithicanalyst.selectForTest(window.lithicanalyst.state().scars[0].id));
  await expect(page.locator('#field-completeness-bulb_complete')).toHaveAttribute('aria-checked', 'true');
  await nextFrames(page);
  // the tools come back too
  await expect(page.locator('#mode-relation')).toBeVisible();
  await expect(page.locator('#mode-sequence')).toBeVisible();
  await expect(page.locator('#sec-arrows .panel-title')).toHaveText('Scar vectors');
});

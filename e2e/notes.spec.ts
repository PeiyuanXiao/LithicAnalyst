import type { Page } from '@playwright/test';
import { expect, exportFile, openSection, parseCsv, state, test } from './helpers';
import { boxScene } from './boxScene';

/** Type a note into a box, as a person does: a letter at a time. */
async function typeNote(page: Page, box: string, text: string): Promise<void> {
  await page.locator(box).click();
  await page.keyboard.type(text, { delay: 20 });
  // (out of the box, so the keys reach the app again)
  await page.locator(box).blur();
}

test('notes on a region and a landmark: one undo step each, written last in regions.csv and landmarks.csv', async ({ page, pageErrors }) => {
  const ids = await boxScene(page);
  // the region
  await openSection(page, 'regions');
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), ids.cortex);
  await expect(page.locator('#region-note')).toBeVisible();
  await typeNote(page, '#region-note', 'rolled, "old"');
  await expect.poll(async () => (await state(page)).regions[1].note).toBe('rolled, "old"');
  await page.locator('#sec-regions').screenshot({ path: 'test-results/31/region-note.png' });
  // the landmark
  await openSection(page, 'landmarks');
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), ids.landmark);
  await typeNote(page, '#landmark-note', 'corner');
  await expect.poll(async () => (await state(page)).landmarks[0].note).toBe('corner');

  // the exports: the note is the last column
  const reg = await exportFile(page, 'regions');
  expect(reg.text.split('\n')[0].endsWith(',retouch_layer,note')).toBe(true);
  expect(parseCsv(reg.text).map((r) => r.note)).toEqual(['', 'rolled, "old"']);
  const lm = parseCsv(await page.evaluate(() => window.lithicanalyst.exportLandmarksText('csv')));
  expect(Object.keys(lm[0]).pop()).toBe('note');
  expect(lm[0].note).toBe('corner');

  // undo: each note goes as one step, whole
  await page.locator('#btn-undo').click();
  await expect.poll(async () => (await state(page)).landmarks[0].note).toBe('');
  await expect(page.locator('#landmark-note')).toHaveValue('');
  await page.locator('#btn-undo').click();
  await expect.poll(async () => (await state(page)).regions[1].note).toBe('');
  expect((await state(page)).landmarks).toHaveLength(1);
  await page.locator('#btn-redo').click();
  await expect.poll(async () => (await state(page)).regions[1].note).toBe('rolled, "old"');
  // and the project file keeps it
  const file = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(file.annotations.regions[1].note).toBe('rolled, "old"');
  expect(pageErrors).toEqual([]);
});

test('a generic specimen\'s arrows take a note, and only that', async ({ page }) => {
  const ids = await boxScene(page, 'generic');
  await openSection(page, 'arrows');
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), ids.arrow);
  await expect(page.locator('#field-note')).toBeVisible();
  await expect(page.locator('#field-completeness')).toHaveCount(0);
  await expect(page.locator('#scar-sequence')).toHaveCount(0);
  await typeNote(page, '#field-note', 'a spall');
  await expect.poll(async () => (await state(page)).scars[0].attributes.note).toBe('a spall');
  const rows = parseCsv(await page.evaluate(() => window.lithicanalyst.exportCsvText()));
  expect(rows[0].note).toBe('a spall');
  expect(rows[0].completeness).toBe('');
  await page.locator('#btn-undo').click();
  await expect.poll(async () => (await state(page)).scars[0].attributes.note).toBe('');
});

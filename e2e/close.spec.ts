import type { Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boxPly, boxPoint } from './fixtures/meshes';
import { download, dragArrow, expect, fileMenu, loadMesh, openApp, state, test, viewFromTop } from './helpers';

const close = async (page: Page) => fileMenu(page, '#btn-close-model');

async function expectEmpty(page: Page): Promise<void> {
  await expect(page.locator('#empty-open')).toBeVisible();
  const st = await state(page);
  expect([st.mesh, st.scars.length]).toEqual([null, 0]);
  expect(await page.evaluate(() => window.lithicanalyst.selection())).toBeNull();
  await expect(page.locator('#btn-undo')).toBeDisabled();
  await expect(page.locator('#specimen-bar')).toBeHidden();
  await expect(page.locator('.vp-toolbar')).toBeHidden();
  await expect(page.locator('#sidebar details.panel:visible')).toHaveCount(0);
}

test('closes the model: the empty view again, with nothing left of it', async ({ page }) => {
  await openApp(page);
  // nothing to close yet
  await page.locator('#btn-file').click();
  await expect(page.locator('#btn-close-model')).toBeDisabled();
  await page.keyboard.press('Escape');

  await loadMesh(page, boxPly());
  await viewFromTop(page);
  await page.keyboard.press('a');
  await dragArrow(page, boxPoint(-10, 0, 5), boxPoint(10, 3, 5));
  expect(await page.evaluate(() => window.lithicanalyst.selection())).not.toBeNull();
  // no question: the browser keeps the autosave
  await close(page);
  await expect(page.locator('.modal')).toHaveCount(0);
  await expectEmpty(page);
  expect((await page.evaluate(() => window.lithicanalyst.observers())).length).toBe(1);

  // the autosave was written before closing: opening the model again offers it
  const chooser = page.waitForEvent('filechooser');
  await fileMenu(page, '#btn-open');
  await (await chooser).setFiles(boxPly());
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Restore your last session?');
  await dialog.getByRole('button', { name: 'Restore' }).click();
  await expect.poll(async () => (await state(page)).scars.length).toBe(1);
});

test('asks once before closing when the browser could not autosave', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, boxPly());
  await viewFromTop(page);
  // the browser's storage is full from now on
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
  });
  await page.keyboard.press('a');
  await dragArrow(page, boxPoint(-10, 0, 5), boxPoint(10, 3, 5));
  await close(page);
  await expect(page.locator('.modal')).toContainText('Close the model?');
  await page.locator('.modal [data-choice="no"]').click();
  expect((await state(page)).scars).toHaveLength(1);
  await close(page);
  await page.locator('.modal [data-choice="yes"]').click();
  await expectEmpty(page);
});

test('in a read-only folder, asks before closing with edits not downloaded, and leaves the folder', async ({ page }, info) => {
  const dir = info.outputPath('flakes');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'box.ply'), boxPly().buffer);
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { value: undefined }));
  await openApp(page);
  const chooser = page.waitForEvent('filechooser');
  await fileMenu(page, '#btn-open-folder');
  await (await chooser).setFiles(dir);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.state().mesh?.fileName ?? null)).toBe('box.ply');
  await expect(page.locator('#workspace-readonly')).toBeVisible();
  // nothing changed yet: no question
  await close(page);
  await expect(page.locator('.modal')).toHaveCount(0);
  await expectEmpty(page);
  await expect(page.locator('#sec-workspace')).toBeHidden();
  expect(await page.evaluate(() => window.lithicanalyst.workspace())).toBeNull();

  // again, with an arrow
  const again = page.waitForEvent('filechooser');
  await fileMenu(page, '#btn-open-folder');
  await (await again).setFiles(dir);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.state().mesh?.fileName ?? null)).toBe('box.ply');
  await viewFromTop(page);
  await page.keyboard.press('a');
  await dragArrow(page, boxPoint(-10, 0, 5), boxPoint(10, 3, 5));
  await close(page);
  await expect(page.locator('.modal')).toContainText('not been downloaded');
  await page.locator('.modal [data-choice="no"]').click();
  await expect(page.locator('.modal')).toHaveCount(0);
  // once the project file is downloaded, closing asks nothing
  await download(page, () => page.locator('#btn-save-project').click());
  await close(page);
  await expect(page.locator('.modal')).toHaveCount(0);
  await expectEmpty(page);
});

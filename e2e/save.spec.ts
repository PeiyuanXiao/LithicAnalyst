import type { Page } from '@playwright/test';
import { boxPly, roofPly } from './fixtures/meshes';
import {
  download,
  enterModule,
  expect,
  fileMenu,
  folderText,
  folderWrites,
  loadMesh,
  mockFilePickers,
  mockFolder,
  nextFrames,
  openApp,
  openMockFolder,
  pickerLog,
  setAnnotator,
  setPickers,
  specimenPanel,
  state,
  test,
  waitForMesh,
} from './helpers';

const writes = async (page: Page) => (await pickerLog(page)).writes;
const annotatorIn = (text: string | undefined) => (JSON.parse(text ?? '{}') as { specimen?: { annotator?: string } }).specimen?.annotator;
const dirty = (page: Page) => page.locator('#btn-save-project');

/** Downloads of the page, by name. */
function downloads(page: Page): string[] {
  const names: string[] = [];
  page.on('download', (d) => names.push(d.suggestedFilename()));
  return names;
}

test('a model saved twice goes into the file chosen the first time; Save as asks again', async ({ page }) => {
  await mockFilePickers(page);
  await openApp(page, 'core');
  await loadMesh(page, boxPly());
  const downloaded = downloads(page);
  await setAnnotator(page, 'First');
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => writes(page)).toBe(1);
  let log = await pickerLog(page);
  expect(log.save).toBe(1);
  expect(annotatorIn(log.files['box.lithicanalyst.json'])).toBe('First');
  await expect(dirty(page)).toHaveAttribute('data-dirty', 'false');

  // again: no dialog, the same file, now holding the second state
  await setAnnotator(page, 'Second');
  await expect(dirty(page)).toHaveAttribute('data-dirty', 'true');
  await page.locator('#btn-save-project').click();
  await expect.poll(() => writes(page)).toBe(2);
  log = await pickerLog(page);
  expect(log.save).toBe(1);
  expect(annotatorIn(log.files['box.lithicanalyst.json'])).toBe('Second');
  await expect(dirty(page)).toHaveAttribute('data-dirty', 'false');

  // Save as: the dialog again, and Save writes the new file from then on
  await setPickers(page, { saveName: 'copy.lithicanalyst.json' });
  await fileMenu(page, '#btn-save-as');
  await expect.poll(() => writes(page)).toBe(3);
  expect((await pickerLog(page)).save).toBe(2);
  await setAnnotator(page, 'Third');
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => writes(page)).toBe(4);
  log = await pickerLog(page);
  expect(log.save).toBe(2);
  expect(annotatorIn(log.files['copy.lithicanalyst.json'])).toBe('Third');
  expect(annotatorIn(log.files['box.lithicanalyst.json'])).toBe('Second');
  // Ctrl+Shift+S asks too
  await page.keyboard.press('ControlOrMeta+Shift+S');
  await expect.poll(async () => (await pickerLog(page)).save).toBe(3);
  await expect.poll(() => writes(page)).toBe(5);
  expect(downloaded).toEqual([]);
});

test('a project opened through the open dialog is saved back into its file, asking once for permission to write it', async ({ page }) => {
  await mockFilePickers(page);
  await openApp(page, 'core');
  await loadMesh(page, boxPly());
  const downloaded = downloads(page);
  const file = await page.evaluate(() => window.lithicanalyst.projectJson());
  file.specimen.annotator = 'Opened';
  await setPickers(page, { openName: 'mine.lithicanalyst.json', files: { 'mine.lithicanalyst.json': JSON.stringify(file) } });
  await fileMenu(page, '#btn-open-project');
  await expect.poll(async () => (await state(page)).specimen.annotator).toBe('Opened');
  expect((await pickerLog(page)).open).toBe(1);

  await setAnnotator(page, 'Edited');
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => writes(page)).toBe(1);
  let log = await pickerLog(page);
  expect(log.save).toBe(0);
  expect(log.permission).toBe(1);
  expect(annotatorIn(log.files['mine.lithicanalyst.json'])).toBe('Edited');
  await expect(dirty(page)).toHaveAttribute('data-dirty', 'false');
  // allowed once: the next save writes straight away
  await setAnnotator(page, 'Again');
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => writes(page)).toBe(2);
  log = await pickerLog(page);
  expect(log.permission).toBe(1);
  expect(log.save).toBe(0);
  expect(annotatorIn(log.files['mine.lithicanalyst.json'])).toBe('Again');
  expect(downloaded).toEqual([]);
});

test('in a writable folder, Save writes the folder’s project at once, changed or not; Save as writes a copy', async ({ page }) => {
  await mockFolder(page, 'flakes', { 'box.ply': boxPly().buffer });
  await mockFilePickers(page);
  await openApp(page, 'core');
  await openMockFolder(page);
  await waitForMesh(page, 'box.ply');
  const downloaded = downloads(page);
  const path = 'LithicAnalyst/projects/box.ply.lithicanalyst.json';

  // nothing changed: written all the same, and it says where
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.unsaved())).toBe(false);
  const w0 = await folderWrites(page, path);
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.toast').filter({ hasText: `Saved to the folder: ${path}` })).toBeVisible();
  expect(await folderWrites(page, path)).toBe(w0 + 1);
  expect(await folderText(page, path)).not.toBeNull();

  // a change saved in the same moment: written at once, and the folder's own save that the change set off is called off
  await specimenPanel(page);
  const pending = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('#specimen-annotator')!;
    input.value = 'Now';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const before = window.lithicanalyst.folderSavePending();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    return { before, after: window.lithicanalyst.folderSavePending() };
  });
  expect(pending).toEqual({ before: true, after: false });
  await expect.poll(() => folderWrites(page, path)).toBe(w0 + 2);
  expect(annotatorIn((await folderText(page, path))!)).toBe('Now');
  await expect(dirty(page)).toHaveAttribute('data-dirty', 'false');

  // Save as: a copy elsewhere; the folder's copy stays the project, and Save keeps writing it
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+Shift+S');
  await expect.poll(() => writes(page)).toBe(1);
  expect(Object.keys((await pickerLog(page)).files)).toEqual(['box.lithicanalyst.json']);
  expect(await folderWrites(page, path)).toBe(w0 + 2);
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => folderWrites(page, path)).toBe(w0 + 3);
  expect((await pickerLog(page)).save).toBe(1);
  expect(downloaded).toEqual([]);
});

test('where the browser has no file dialogs, Save downloads, and says so the first time only', async ({ page }) => {
  await openApp(page, 'core');
  await loadMesh(page, boxPly());
  await setAnnotator(page, 'A');
  const first = await download(page, () => page.keyboard.press('ControlOrMeta+s'));
  expect(first.name).toBe('box.lithicanalyst.json');
  expect(annotatorIn(first.text)).toBe('A');
  const note = page.locator('.toast').filter({ hasText: 'This browser can only download' });
  await expect(note).toHaveCount(1);
  await expect(note).toContainText('Downloaded box.lithicanalyst.json');
  await expect(dirty(page)).toHaveAttribute('data-dirty', 'false');

  await setAnnotator(page, 'B');
  const second = await download(page, () => page.keyboard.press('ControlOrMeta+s'));
  expect(annotatorIn(second.text)).toBe('B');
  await expect(page.locator('.toast').last()).toHaveText('Saved box.lithicanalyst.json');
  expect(await note.count()).toBeLessThanOrEqual(1);
});

test('the file chosen for one model is not used for another', async ({ page }) => {
  await mockFilePickers(page);
  await openApp(page, 'core');
  await loadMesh(page, boxPly());
  await setAnnotator(page, 'Box');
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => writes(page)).toBe(1);

  // closed, and another model opened: the dialog again
  await fileMenu(page, '#btn-close-model');
  await expect(page.locator('#start-page')).toBeVisible();
  await enterModule(page, 'core');
  await loadMesh(page, roofPly());
  await setAnnotator(page, 'Roof');
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => writes(page)).toBe(2);
  const log = await pickerLog(page);
  expect(log.save).toBe(2);
  expect(annotatorIn(log.files['box.lithicanalyst.json'])).toBe('Box');
  expect(annotatorIn(log.files['roof.lithicanalyst.json'])).toBe('Roof');

  // another model opened over this one: the same
  await loadMesh(page, boxPly());
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(async () => (await pickerLog(page)).save).toBe(3);
  await expect.poll(() => writes(page)).toBe(3);
  expect(annotatorIn((await pickerLog(page)).files['roof.lithicanalyst.json'])).toBe('Roof');
});

test('closing the save dialog without choosing writes nothing, says nothing and leaves the changes unsaved', async ({ page }) => {
  await mockFilePickers(page);
  await openApp(page, 'core');
  await loadMesh(page, boxPly());
  const downloaded = downloads(page);
  await setAnnotator(page, 'A');
  await setPickers(page, { cancel: true });
  const toasts = await page.locator('.toast').count();
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(async () => (await pickerLog(page)).save).toBe(1);
  // (what follows the closed dialog has run by the next frames)
  await nextFrames(page, 4);
  expect(await writes(page)).toBe(0);
  expect(await page.locator('.toast').filter({ hasText: /Saved|Could not|Downloaded/ }).count()).toBe(0);
  expect(await page.locator('.toast').count()).toBeLessThanOrEqual(toasts);
  await expect(dirty(page)).toHaveAttribute('data-dirty', 'true');
  expect(downloaded).toEqual([]);
});

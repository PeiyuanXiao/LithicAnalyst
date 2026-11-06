import { boxPly, t1Ply } from './fixtures/meshes';
import { expect, fileMenu, loadMesh, openApp, specimenPanel, state, test, waitForMesh } from './helpers';

const checked = (type: string) => `#start-type-${type}[aria-checked="true"]`;

test('with no model the start page stands in for the view and the sidebar; the top bar stays, without the modes and the specimen', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#start-page')).toBeVisible();
  await expect(page.locator('.start-card')).toHaveText(['Core', 'Flake', 'General']);
  await expect(page.locator(checked('core'))).toHaveCount(1);
  await expect(page.locator('.start-card svg')).toHaveCount(3);
  await expect(page.locator('#empty-open')).toHaveClass(/btn-primary/);
  await expect(page.locator('#empty-open-folder')).toBeVisible();
  await expect(page.locator('#empty-open-project')).toBeVisible();
  await expect(page.locator('.start-formats')).toHaveText('PLY · STL · OBJ');

  for (const id of ['#btn-file', '#btn-lang', '#btn-theme', '#btn-help']) await expect(page.locator(id)).toBeVisible();
  for (const id of ['.mode-switch', '#specimen-bar', '.vp-toolbar', '#annotation-status', '#sidebar .panel']) await expect(page.locator(id).first()).toBeHidden();

  // over the view and over where the sidebar is
  const inFront = await page.evaluate(() => {
    const at = (el: Element) => {
      const r = el.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('#start-page') !== null;
    };
    return [at(document.querySelector('#viewport')!), at(document.querySelector('#sidebar')!)];
  });
  expect(inFront).toEqual([true, true]);
  // the menus open over it
  await page.locator('#btn-file').click();
  await expect(page.locator('#btn-open')).toBeVisible();
  const item = (await page.locator('#btn-open').boundingBox())!;
  expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('#file-menu'), { x: item.x + item.width / 2, y: item.y + item.height / 2 })).toBe(true);
  await page.keyboard.press('Escape');

  // the modes are not there to be switched
  await page.keyboard.press('m');
  expect(await page.evaluate(() => window.lithicanalyst.mode())).toBe('annotate');

  // its labels follow the language
  await page.locator('#btn-lang').click();
  await page.locator('#lang-zh').click();
  await expect(page.locator('.start-card')).toHaveText(['石核', '石片', '通用']);
  await expect(page.locator('#empty-open')).toHaveText('打开模型');
  await page.locator('#btn-lang').click();
  await page.locator('#lang-en').click();
  await expect(page.locator('.start-card')).toHaveText(['Core', 'Flake', 'General']);
});

test('the card chosen is the type of a new model, stays chosen, and comes back when it is closed', async ({ page }) => {
  await openApp(page);
  await page.locator('#start-type-generic').click();
  await expect(page.locator(checked('generic'))).toHaveCount(1);
  await expect(page.locator(checked('core'))).toHaveCount(0);

  await loadMesh(page, boxPly(), '#empty-open');
  expect((await state(page)).specimen.type).toBe('generic');
  await expect(page.locator('#start-page')).toBeHidden();
  await expect(page.locator('#app-mode-annotate')).toBeVisible();
  await expect(page.locator('#app-mode-retouch')).toBeHidden();
  await expect(page.locator('#specimen-bar')).toBeVisible();

  await fileMenu(page, '#btn-close-model');
  await expect(page.locator('#start-page')).toBeVisible();
  await expect(page.locator(checked('generic'))).toHaveCount(1);
  await expect(page.locator('.mode-switch')).toBeHidden();

  // and after the page is opened again
  await page.reload();
  await page.waitForFunction(() => !!window.lithicanalyst);
  await expect(page.locator(checked('generic'))).toHaveCount(1);

  // another card: a flake, with what a flake has
  await page.locator('#start-type-flake').click();
  await loadMesh(page, t1Ply(), '#empty-open');
  expect((await state(page)).specimen.type).toBe('flake');
  await expect(page.locator('#app-mode-retouch')).toBeVisible();
  await expect(page.locator('#mode-axis')).toBeVisible();

  // a type set in the specimen panel is what comes next too
  await specimenPanel(page);
  await page.locator('#specimen-type').selectOption('core');
  await page.keyboard.press('Escape');
  await fileMenu(page, '#btn-close-model');
  await expect(page.locator(checked('core'))).toHaveCount(1);
});

test('a project file says what it is, whichever card is chosen', async ({ page }) => {
  await openApp(page);
  // a flake's project file of this model
  await page.locator('#start-type-flake').click();
  await loadMesh(page, boxPly(), '#empty-open');
  const file = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(file.specimen.type).toBe('flake');
  // (the browser's autosave stays out of it)
  await page.evaluate(() => localStorage.clear());
  await fileMenu(page, '#btn-close-model');
  await page.evaluate(() => localStorage.clear());

  await page.locator('#start-type-generic').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#empty-open-project').click();
  await (await chooser).setFiles({ name: 'box.lithicanalyst.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('box.ply');
  const meshChooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Open that model' }).click();
  await (await meshChooser).setFiles(boxPly());
  await waitForMesh(page, 'box.ply');
  await expect.poll(async () => (await state(page)).specimen.type).toBe('flake');
  await expect(page.locator('#app-mode-retouch')).toBeVisible();
  // the choice stands for what comes next
  await fileMenu(page, '#btn-close-model');
  await expect(page.locator(checked('generic'))).toHaveCount(1);
});

test('a model dragged onto the start page opens as the card chosen', async ({ page }) => {
  await openApp(page);
  await page.locator('#start-type-generic').click();
  const ply = boxPly();
  await page.evaluate(
    ({ name, b64 }) => {
      const file = new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name);
      const data = new DataTransfer();
      data.items.add(file);
      window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: data, bubbles: true }));
    },
    { name: ply.name, b64: ply.buffer.toString('base64') },
  );
  // what shows it can be dropped is in front
  await expect(page.locator('#start-page .drop-overlay')).toBeVisible();
  await page.evaluate(
    ({ name, b64 }) => {
      const file = new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name);
      const data = new DataTransfer();
      data.items.add(file);
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
    },
    { name: ply.name, b64: ply.buffer.toString('base64') },
  );
  await waitForMesh(page, ply.name);
  expect((await state(page)).specimen.type).toBe('generic');
  await expect(page.locator('#viewport .drop-overlay')).toBeHidden();
  await expect(page.locator('#start-page')).toBeHidden();
});

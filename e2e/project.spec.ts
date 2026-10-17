import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { roofPly, roofPoint } from './fixtures/meshes';
import { counts, curveClick, download, dragArrow, expect, loadMesh, openApp, state, test, toScreen, viewFromTop, waitForMesh } from './helpers';

/** One arrow and one curve, with fields and specimen details filled in. */
async function annotate(page: Page): Promise<void> {
  await viewFromTop(page);
  await page.locator('#specimen-annotator').fill('Observer 甲');
  await page.locator('#specimen-unit').selectOption('cm');
  // the unit list keeps the focus (and the keys): use the toolbar
  await page.locator('#mode-draw').click();
  await dragArrow(page, roofPoint(-14, 10), roofPoint(-8, 22));
  await page.locator('#field-completeness-bulb_truncated').click();
  await page.locator('#field-note').fill('近台面，"破损"');
  await page.locator('#mode-curve').click();
  await curveClick(page, await toScreen(page, roofPoint(10, 10)), { shift: true });
  await curveClick(page, await toScreen(page, roofPoint(12, 20)), { shift: true });
  await curveClick(page, await toScreen(page, roofPoint(9, 30)), { shift: true });
  await page.keyboard.press('Enter');
  await expect.poll(() => counts(page)).toEqual({ arrows: 1, curves: 1 });
  await page.keyboard.press('3');
  await expect.poll(async () => (await state(page)).curves[0].attributes.type).toBe('scar_boundary');
}

/** The parts of the project a file must carry over. */
const content = async (page: Page) => {
  const s = await state(page);
  return { specimen: s.specimen, scars: s.scars, curves: s.curves, nextLabelNumber: s.nextLabelNumber, nextCurveNumber: s.nextCurveNumber };
};

test('saves the project file and reads it back, here and in a fresh browser', async ({ page, browser }) => {
  const ply = roofPly();
  await openApp(page);
  await loadMesh(page, ply);
  await annotate(page);
  const before = await content(page);

  const saved = await download(page, () => page.locator('#btn-save-project').click());
  expect(saved.name).toBe('roof.lithicanalyst.json');
  const file = JSON.parse(saved.text);
  expect(file).toMatchObject({ format: 'lithicanalyst-project', formatVersion: 2, specimen: { id: 'roof', annotator: 'Observer 甲', unit: 'cm' } });
  expect(file.mesh).toMatchObject({ fileName: 'roof.ply', sha256: createHash('sha256').update(ply.buffer).digest('hex') });
  expect(file.annotations.scars).toEqual(before.scars);
  expect(file.annotations.curves).toEqual(before.curves);

  // Ctrl+S saves the same project
  const again = await download(page, () => page.keyboard.press('ControlOrMeta+s'));
  expect({ ...JSON.parse(again.text), savedAt: null }).toEqual({ ...file, savedAt: null });

  // change things, then open the saved file over them
  await page.keyboard.press('Delete');
  await page.locator('#sec-arrows .arrow-row').click();
  await page.keyboard.press('Delete');
  await page.locator('#specimen-annotator').fill('someone else');
  expect(await counts(page)).toEqual({ arrows: 0, curves: 0 });
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#btn-open-project').click();
  await (await chooser).setFiles({ name: saved.name, mimeType: 'application/json', buffer: Buffer.from(saved.text) });
  await expect.poll(() => content(page)).toEqual(before);
  await expect(page.locator('#specimen-annotator')).toHaveValue('Observer 甲');

  // a fresh browser (no autosave): open the project first, then the model it asks for
  const context = await browser.newContext();
  const fresh = await context.newPage();
  const errors: string[] = [];
  fresh.on('pageerror', (e) => errors.push(e.message));
  await openApp(fresh);
  const projectChooser = fresh.waitForEvent('filechooser');
  await fresh.locator('#export-open-project').click();
  await (await projectChooser).setFiles({ name: saved.name, mimeType: 'application/json', buffer: Buffer.from(saved.text) });
  const dialog = fresh.getByRole('dialog');
  await expect(dialog).toContainText('roof.ply');
  const meshChooser = fresh.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Open that model' }).click();
  await (await meshChooser).setFiles(ply);
  await waitForMesh(fresh, 'roof.ply');
  await expect.poll(() => content(fresh)).toEqual(before);

  // numbering carries on after the loaded labels
  await viewFromTop(fresh);
  await fresh.keyboard.press('a');
  await dragArrow(fresh, roofPoint(12, 30), roofPoint(9, 42));
  expect((await state(fresh)).scars.map((a) => a.label)).toEqual(['S1', 'S2']);
  await context.close();
  expect(errors).toEqual([]);
});

test('offers to restore the autosave when the model is opened again', async ({ page }) => {
  const ply = roofPly();
  await openApp(page);
  await loadMesh(page, ply);
  await annotate(page);
  const before = await content(page);
  const key = `lithicanalyst:autosave:${createHash('sha256').update(ply.buffer).digest('hex')}`;
  await expect
    .poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null')?.file?.annotations?.curves?.[0]?.attributes?.type ?? null, key))
    .toBe('scar_boundary');

  await page.reload();
  await page.waitForFunction(() => !!window.lithicanalyst);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#btn-open').click();
  await (await chooser).setFiles(ply);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Restore your last session?');
  await dialog.getByRole('button', { name: 'Restore' }).click();
  await expect.poll(() => content(page)).toEqual(before);
});

test('opens a project file from 0.1.0 (format 1) and saves it as format 2', async ({ page }) => {
  const ply = roofPly();
  const start = roofPoint(-14, 10);
  const end = roofPoint(-8, 22);
  const v1 = {
    format: 'lithicanalyst-project',
    formatVersion: 1,
    app: { name: 'LithicAnalyst', version: '0.1.0' },
    savedAt: '2026-10-15T20:45:00.000Z',
    specimen: { id: 'roof', annotator: 'PX', unit: 'mm', notes: '' },
    mesh: { fileName: 'roof.ply', format: 'ply', fileSize: ply.buffer.length, sha256: createHash('sha256').update(ply.buffer).digest('hex') },
    annotations: {
      scarVectors: [
        {
          id: 'old-arrow-1',
          label: 'S7',
          start,
          end,
          startNormal: [0, 0, 1],
          endNormal: [0, 0, 1],
          attributes: { completeness: 'point_truncated', certainty: 'probable', note: 'old' },
          createdAt: '2026-10-15T20:31:02.114Z',
          modifiedAt: '2026-10-15T20:31:40.551Z',
        },
      ],
    },
    nextLabelNumber: 8,
    createdAt: '2026-10-15T20:30:00.000Z',
    modifiedAt: '2026-10-15T20:31:40.551Z',
  };
  await openApp(page);
  await loadMesh(page, ply);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#btn-open-project').click();
  await (await chooser).setFiles({ name: 'old.lithicanalyst.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(v1)) });
  await expect.poll(async () => (await state(page)).scars.length).toBe(1);
  const scar = (await state(page)).scars[0];
  expect(scar).toMatchObject({ id: 'old-arrow-1', label: 'S7', vector: { start, end }, attributes: { completeness: 'point_truncated', note: 'old' } });
  await expect(page.locator('#sec-arrows .arrow-row')).toHaveCount(1);

  const csv = await download(page, () => page.locator('#export-csv').click());
  expect(csv.text.split('\n')[1]).toMatch(/^roof,S7,1186,-340,/);

  const saved = JSON.parse((await download(page, () => page.locator('#btn-save-project').click())).text);
  expect(saved.formatVersion).toBe(2);
  expect(saved.annotations.scarVectors).toBeUndefined();
  expect(saved.annotations.scars).toEqual([scar]);
  expect(saved.specimen.frame).toBeNull();
  expect(saved.derived).toEqual({ measurements: expect.objectContaining({ closed: false, volume: null }), manualMeasurements: [] });
});

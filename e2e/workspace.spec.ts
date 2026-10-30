import type { Download, Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boxMesh, boxPly, boxPoint, roofPly, spherePly, toBinaryStl } from './fixtures/meshes';
import { dragArrow, expect, fileMenu, folderPaths, folderText, mockFolder, openApp, openMockFolder, openSection, parseCsv, setAnnotator, state, test, unzip, viewFromTop } from './helpers';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const meshName = (page: Page) => page.evaluate(() => window.lithicanalyst.state().mesh?.fileName ?? null);
const rows = (page: Page) => page.locator('#workspace-list .ws-row .ws-path');

/** A project file of another session for a model (its checksum binds it to the model). */
function project(name: string, buffer: Buffer, annotator: string, scars: unknown[] = []): string {
  return JSON.stringify({
    format: 'lithicanalyst-project',
    formatVersion: 2,
    specimen: { id: name.replace(/\.[^.]+$/, ''), annotator, unit: 'mm', notes: '', frame: null },
    mesh: { fileName: name, format: 'ply', fileSize: buffer.length, sha256: sha(buffer), vertexCount: 0, triangleCount: 0, bboxMin: [0, 0, 0], bboxMax: [0, 0, 0] },
    annotations: { scars },
  });
}

const scar = { id: 'kept-1', label: 'S1', vector: { start: boxPoint(-10, 0, 5), end: boxPoint(10, 0, 5) }, attributes: {} };

/** The files written into an export folder of the mock folder: its path, and the files' paths below it. */
async function exportFolder(page: Page, kind: 'exports' | 'figures', file: string): Promise<{ base: string; files: string[] }> {
  let base = '';
  await expect
    .poll(async () => {
      const hit = (await folderPaths(page)).find((p) => new RegExp(`^LithicAnalyst/${kind}/\\d{4}-\\d\\d-\\d\\d_\\d{6}(-\\d+)?/${file.replace('.', '\\.')}$`).test(p));
      base = hit ? hit.slice(0, hit.length - file.length - 1) : '';
      return base;
    }, { timeout: 60_000 })
    .not.toBe('');
  return { base, files: (await folderPaths(page)).filter((p) => p.startsWith(`${base}/`)).map((p) => p.slice(base.length + 1)) };
}

test('a writable folder: subfolders, one project per model file in LithicAnalyst/projects, the list, and the next model not started', async ({ page }) => {
  const box = boxPly().buffer, stl = toBinaryStl(boxMesh()), sphere = spherePly().buffer;
  await mockFolder(page, 'flakes', {
    'site1/EXP03.ply': box,
    'site1/EXP03.stl': stl,
    'site2/nodule.ply': sphere,
    'site3/roof.ply': roofPly().buffer,
    // an earlier version's project next to its model
    'site2/nodule.lithicanalyst.json': Buffer.from(project('nodule.ply', sphere, 'Old', [scar])),
    '.trash/old.ply': box,
    'LithicAnalyst/exports/2026-01-01_000000/measurements.csv': Buffer.from('x'),
    'notes.txt': Buffer.from('ignored'),
  });
  await openApp(page);
  await openMockFolder(page);
  await expect.poll(() => meshName(page)).toBe('EXP03.ply');
  await expect(page.locator('#workspace-readonly')).toHaveCount(0);
  await expect(rows(page)).toHaveText(['site1/EXP03.ply', 'site1/EXP03.stl', 'site2/nodule.ply', 'site3/roof.ply']);
  // two models share a name: their IDs come from their paths, with the extension where that is the same too
  expect(await page.evaluate(() => window.lithicanalyst.specimenIds())).toEqual({ 'site1/EXP03.ply': 'site1/EXP03.ply', 'site1/EXP03.stl': 'site1/EXP03.stl', 'site2/nodule.ply': 'nodule', 'site3/roof.ply': 'roof' });
  expect((await state(page)).specimen.id).toBe('site1/EXP03.ply');
  // only the model with a project is started
  await expect(page.locator('#workspace-list .ws-dot.is-started')).toHaveCount(1);
  await expect(page.locator('#workspace-list .ws-row[aria-selected="true"] .ws-path')).toHaveText('site1/EXP03.ply');

  // the .ply and the .stl of the same name keep projects of their own
  await viewFromTop(page);
  await setAnnotator(page, 'Ann');
  await page.keyboard.press('a');
  await dragArrow(page, boxPoint(-10, 0, 5), boxPoint(10, 3, 5));
  const plyProject = 'LithicAnalyst/projects/site1/EXP03.ply.lithicanalyst.json';
  const stlProject = 'LithicAnalyst/projects/site1/EXP03.stl.lithicanalyst.json';
  await expect.poll(async () => JSON.parse((await folderText(page, plyProject)) ?? '{}').annotations?.scars?.length).toBe(1);
  await rows(page).nth(1).click();
  await expect.poll(() => meshName(page)).toBe('EXP03.stl');
  expect((await state(page)).scars).toHaveLength(0);
  await viewFromTop(page);
  await page.keyboard.press('a');
  await dragArrow(page, boxPoint(-10, -4, 5), boxPoint(10, -4, 5));
  await dragArrow(page, boxPoint(-10, 4, 5), boxPoint(10, 4, 5));
  await expect.poll(async () => JSON.parse((await folderText(page, stlProject)) ?? '{}').annotations?.scars?.length).toBe(2);
  expect(JSON.parse((await folderText(page, plyProject))!).annotations.scars).toHaveLength(1);
  await page.keyboard.press('PageUp');
  await expect.poll(() => meshName(page)).toBe('EXP03.ply');
  await expect.poll(async () => (await state(page)).scars).toHaveLength(1);

  // the old project next to the model is read (its checksum matches) and left as it was; edits go to the new place
  await rows(page).nth(2).click();
  await expect.poll(() => meshName(page)).toBe('nodule.ply');
  await expect.poll(async () => (await state(page)).scars.map((s) => s.id)).toEqual(['kept-1']);
  const oldText = await folderText(page, 'site2/nodule.lithicanalyst.json');
  await setAnnotator(page, 'Ann');
  await expect.poll(() => folderText(page, 'LithicAnalyst/projects/site2/nodule.ply.lithicanalyst.json')).not.toBeNull();
  expect(await folderText(page, 'site2/nodule.lithicanalyst.json')).toBe(oldText);
  expect((await folderPaths(page)).filter((p) => p.endsWith('.lithicanalyst.json')).sort()).toEqual([plyProject, stlProject, 'LithicAnalyst/projects/site2/nodule.ply.lithicanalyst.json', 'site2/nodule.lithicanalyst.json'].sort());

  // the list: filtered by name; Shift+PageDown opens the next model not started
  await page.locator('#workspace-filter').fill('stl');
  await expect(rows(page)).toHaveText(['site1/EXP03.stl']);
  await page.locator('#workspace-filter').fill('');
  // Esc leaves the filter (keys go to the app again)
  await page.keyboard.press('Escape');
  await expect(page.locator('#workspace-list .ws-dot.is-started')).toHaveCount(3);
  await page.keyboard.press('Shift+PageDown');
  await expect.poll(() => meshName(page)).toBe('roof.ply');
  await setAnnotator(page, 'Bea');
  await expect(page.locator('#workspace-list .ws-dot.is-started')).toHaveCount(4);
  await expect(page.locator('#workspace-next-new')).toBeDisabled();
});

test('summary export and figures for the whole folder: new export folders, broken files skipped and listed', async ({ page }) => {
  const box = boxPly().buffer, sphere = spherePly().buffer;
  await mockFolder(page, 'flakes', {
    'a/box.ply': box,
    'b/nodule.ply': sphere,
    'broken.ply': Buffer.from('ply\nformat ascii 1.0\nelement vertex 3\nend_header\nnot numbers\n'),
    // a second observer for each model (any project file of the folder counts, by checksum)
    'LithicAnalyst/projects/b/nodule.ply.lithicanalyst.json': Buffer.from(project('nodule.ply', sphere, 'Ann')),
    'bo/box.bo.lithicanalyst.json': Buffer.from(project('box.ply', box, 'Bo')),
    'bo/nodule.bo.lithicanalyst.json': Buffer.from(project('nodule.ply', sphere, 'Bo')),
  });
  await openApp(page);
  await openMockFolder(page);
  await expect.poll(() => meshName(page)).toBe('box.ply');
  await viewFromTop(page);
  await setAnnotator(page, 'Ann');
  await page.keyboard.press('a');
  await dragArrow(page, boxPoint(-10, 0, 5), boxPoint(10, 3, 5));

  // this specimen: its files into a new export folder, with a manifest
  await page.locator('#btn-export').click();
  await expect(page.locator('#export-scope-specimen')).toHaveAttribute('aria-checked', 'true');
  await page.locator('.modal [data-choice="export"]').click();
  const one = await exportFolder(page, 'exports', 'box_scar_vectors.csv');
  expect(one.files.sort()).toEqual(['box_scar_vectors.csv', 'manifest.json']);
  const m1 = JSON.parse((await folderText(page, `${one.base}/manifest.json`))!);
  expect(m1).toMatchObject({ scope: 'specimen', folder: 'flakes', specimens: [{ id: 'box', file: 'a/box.ply', annotator: 'Ann' }] });

  // the whole folder: the broken file is skipped, listed and the rest done
  await page.locator('#btn-export').click();
  await page.locator('#export-scope-folder').click();
  await expect(page.locator('#export-files')).toBeHidden();
  // nothing to pick for the whole folder: the button just exports, and says so
  const run = page.locator('.modal [data-choice="export"]');
  await expect(run).toHaveText('Export');
  await page.locator('#export-scope-specimen').click();
  await expect(run).toHaveText('Export selected');
  await page.locator('#export-scope-folder').click();
  await expect(run).toHaveText('Export');
  await page.locator('.modal [data-choice="export"]').click();
  const all = await exportFolder(page, 'exports', 'failures.csv');
  await expect(page.locator('#batch-progress')).toBeHidden({ timeout: 60_000 });
  expect(all.base).not.toBe(one.base);
  const files = (await folderPaths(page)).filter((p) => p.startsWith(`${all.base}/`)).map((p) => p.slice(all.base.length + 1)).sort();
  expect(files).toEqual(['failures.csv', 'icc.csv', 'manifest.json', 'measurements.csv', 'scar_vectors.csv']);
  const measured = parseCsv((await folderText(page, `${all.base}/measurements.csv`))!);
  expect(measured.map((r) => [r.specimen_id, r.file, r.closed])).toEqual([
    ['box', 'a/box.ply', 'true'],
    ['nodule', 'b/nodule.ply', 'true'],
  ]);
  expect(Number(measured[0].length)).toBeCloseTo(40, 3);
  expect(parseCsv((await folderText(page, `${all.base}/failures.csv`))!).map((r) => r.file)).toEqual(['broken.ply']);
  const icc = parseCsv((await folderText(page, `${all.base}/icc.csv`))!);
  expect(icc.find((r) => r.measure === 'length')).toMatchObject({ n_specimens: '2', n_raters: '2', icc: '1' });
  const m2 = JSON.parse((await folderText(page, `${all.base}/manifest.json`))!);
  expect(m2).toMatchObject({ scope: 'folder', kind: 'tables', failures: [{ file: 'broken.ply' }] });
  expect(m2.specimens.map((s: { file: string; project: string | null }) => [s.file, s.project])).toEqual([
    ['a/box.ply', 'LithicAnalyst/projects/a/box.ply.lithicanalyst.json'],
    ['b/nodule.ply', 'LithicAnalyst/projects/b/nodule.ply.lithicanalyst.json'],
  ]);
  await expect(page.locator('.toast').last()).toContainText(/2 done, 1 failed.*Written to LithicAnalyst\/exports\//);

  // figures of the whole folder, by subfolder; the open model comes back
  await page.locator('#app-mode-present').click();
  await openSection(page, 'figure');
  await page.locator('#fig-folder').check();
  await page.locator('#fig-svg').click();
  const figs = await exportFolder(page, 'figures', 'b/nodule_figure.svg');
  await expect(page.locator('#batch-progress')).toBeHidden({ timeout: 60_000 });
  const figFiles = (await folderPaths(page)).filter((p) => p.startsWith(`${figs.base}/`)).map((p) => p.slice(figs.base.length + 1)).sort();
  expect(figFiles).toEqual(['a/box_figure.svg', 'b/nodule_figure.svg', 'failures.csv', 'manifest.json']);
  expect(await folderText(page, `${figs.base}/a/box_figure.svg`)).toMatch(/^<\?xml[\s\S]*<svg/);
  await expect.poll(() => meshName(page)).toBe('box.ply');
  await expect.poll(async () => (await state(page)).scars).toHaveLength(1);
});

test('a read-only folder: subfolders, edits kept for the session, all projects in one ZIP, exports as a ZIP', async ({ page }, info) => {
  const dir = info.outputPath('flakes');
  await mkdir(join(dir, 'site1'), { recursive: true });
  const box = boxPly().buffer, sphere = spherePly().buffer;
  await writeFile(join(dir, 'site1', 'box.ply'), box);
  await writeFile(join(dir, 'nodule.ply'), sphere);
  await writeFile(join(dir, 'site1', 'box.lithicanalyst.json'), project('box.ply', box, 'Ann', [scar]));
  await writeFile(join(dir, 'notes.txt'), 'ignored');
  // no folder picker here: the folder is read from a directory upload
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { value: undefined }));
  await openApp(page);
  await expect(page.locator('#sec-workspace')).toBeHidden();
  const chooser = page.waitForEvent('filechooser');
  await fileMenu(page, '#btn-open-folder');
  await (await chooser).setFiles(dir);
  await expect.poll(() => meshName(page)).toBe('nodule.ply');
  await expect(page.locator('#workspace-readonly')).toBeVisible();
  await expect(rows(page)).toHaveText(['nodule.ply', 'site1/box.ply']);
  await expect(page.locator('#workspace-download')).toBeDisabled();

  // an edit on the first model; on to the next and back: still there (kept in memory, not in the folder)
  await setAnnotator(page, 'Cy');
  await page.keyboard.press('PageDown');
  await expect.poll(() => meshName(page)).toBe('box.ply');
  await expect.poll(async () => (await state(page)).scars.map((s) => s.id)).toEqual(['kept-1']);
  await page.keyboard.press('PageUp');
  await expect.poll(() => meshName(page)).toBe('nodule.ply');
  expect((await state(page)).specimen.annotator).toBe('Cy');
  await expect(page.locator('#workspace-download')).toBeEnabled();

  // the summary export: one ZIP with the LithicAnalyst/exports/… layout
  const downloads: Download[] = [];
  page.on('download', (d) => downloads.push(d));
  await page.locator('#btn-export').click();
  await page.locator('#export-scope-folder').click();
  await page.locator('.modal [data-choice="export"]').click();
  await expect.poll(() => downloads.length, { timeout: 60_000 }).toBe(1);
  expect(downloads[0].suggestedFilename()).toMatch(/^flakes_exports_\d{4}-\d\d-\d\d_\d{6}\.zip$/);
  const zip = unzip(await readFile((await downloads[0].path())!));
  const names = Object.keys(zip).map((n) => n.replace(/^LithicAnalyst\/exports\/[^/]+\//, ''));
  expect(names.sort()).toEqual(['manifest.json', 'measurements.csv', 'scar_vectors.csv']);
  expect(Object.keys(zip).every((n) => n.startsWith('LithicAnalyst/exports/'))).toBe(true);
  const measured = parseCsv(Object.entries(zip).find(([n]) => n.endsWith('measurements.csv'))![1]);
  expect(measured.map((r) => [r.specimen_id, r.file])).toEqual([
    ['nodule', 'nodule.ply'],
    ['box', 'site1/box.ply'],
  ]);

  // all projects edited this session, as LithicAnalyst/projects/… to unpack into the folder
  await page.locator('#workspace-download').click();
  await expect.poll(() => downloads.length).toBe(2);
  expect(downloads[1].suggestedFilename()).toBe('flakes_projects.zip');
  const projects = unzip(await readFile((await downloads[1].path())!));
  expect(Object.keys(projects)).toEqual(['LithicAnalyst/projects/nodule.ply.lithicanalyst.json']);
  expect(JSON.parse(projects['LithicAnalyst/projects/nodule.ply.lithicanalyst.json']).specimen.annotator).toBe('Cy');
  await expect(page.locator('#workspace-download')).toBeDisabled();

  // edits not downloaded: leaving the page asks first
  await setAnnotator(page, 'Dee');
  const dialog = page.waitForEvent('dialog');
  await page.close({ runBeforeUnload: true });
  const d = await dialog;
  expect(d.type()).toBe('beforeunload');
  await d.dismiss();
});

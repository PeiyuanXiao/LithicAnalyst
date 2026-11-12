import type { Page } from '@playwright/test';
import { igesText, line, sampleIges, type IgesEntity } from '../tests/igesFiles';
import { boxPly, boxPoint, roofPly, roofPoint, spherePly, type MeshFile, type Vec3 } from './fixtures/meshes';
import { dist, expect, fileMenu, folderText, loadMesh, mockFolder, openApp, openMockFolder, parseCsv, state, test, toScreen, viewFromTop } from './helpers';

const SHOTS = 'test-results/29';

const igs = (name: string, text: string): MeshFile => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(text, 'latin1') });

/** Ten vectors on the roof, their ends on its grid's vertices (so on the model). */
const ROOF_SEGMENTS: Array<[Vec3, Vec3]> = Array.from({ length: 10 }, (_, i) => [roofPoint(-16 + 3 * i, 5 + 4 * i), roofPoint(-13.5 + 3 * i, 6.5 + 4 * i)]);

/** A turn of 15° about z through the middle of the roof, and a move of (5, −3, 2.5): where the vectors lie in a file made before the model was processed. */
function displaced(p: Vec3): Vec3 {
  const c = roofPoint(0, 25);
  const a = (15 * Math.PI) / 180;
  const x = p[0] - c[0], y = p[1] - c[1];
  return [c[0] + Math.cos(a) * x - Math.sin(a) * y + 5, c[1] + Math.sin(a) * x + Math.cos(a) * y - 3, p[2] + 2.5];
}

const align = (page: Page) => page.evaluate(() => window.lithicanalyst.align());

/** Open the roof and import an IGES file into it through the File menu. */
async function importInto(page: Page, file: MeshFile): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await fileMenu(page, '#btn-import-iges');
  await (await chooser).setFiles(file);
}

async function roof(page: Page): Promise<void> {
  await openApp(page, 'core');
  await loadMesh(page, roofPly());
  await viewFromTop(page);
}

/** Take end `end` of the preview and drop it on the model at `to`. */
async function dragEnd(page: Page, end: number, to: Vec3): Promise<void> {
  const before = (await align(page))!;
  const from = before.ends[end];
  expect(from.visible).toBe(true);
  const target = await toScreen(page, to);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await align(page))!.pairs).toBe(before.pairs + 1);
}

test('vectors that lie on the model already: confirmed as they are, ten arrows on the surface, one undo step', async ({ page }) => {
  await roof(page);
  await importInto(page, igs('roof.igs', sampleIges(ROOF_SEGMENTS)));
  await expect(page.locator('#align-panel')).toBeVisible();
  await expect(page.locator('#align-ok')).toBeVisible();
  await expect(page.locator('#align-summary')).toContainText('10 vectors · 10 duplicates · 0 skipped');
  const a = (await align(page))!;
  // the header says centimetres; the vectors are in the model's unit
  expect(a.factor).toBe(1);
  expect(a.aligned).toBe(true);
  expect(await page.evaluate(() => window.lithicanalyst.alignDrawn())).toEqual({ arrows: 10, warned: 0 });
  await page.keyboard.press('Enter');
  await expect(page.locator('#align-panel')).toHaveCount(0);
  const st = await state(page);
  expect(st.scars).toHaveLength(10);
  expect(st.scars.map((s) => s.label)).toEqual(Array.from({ length: 10 }, (_, i) => `S${i + 1}`));
  st.scars.forEach((s, i) => {
    expect(dist(s.vector!.start, ROOF_SEGMENTS[i][0])).toBeLessThan(1e-3);
    expect(dist(s.vector!.end, ROOF_SEGMENTS[i][1])).toBeLessThan(1e-3);
    // the roof faces up: the normal too
    expect(s.vector!.startNormal[2]).toBeGreaterThan(0.5);
  });
  expect(st.imports).toHaveLength(1);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await state(page)).scars.length).toBe(0);
  expect((await state(page)).imports).toEqual([]);
});

test('vectors off the model: three ends dragged to where they belong, the automatic fit, then confirmed', async ({ page }) => {
  await mkdirShots();
  await roof(page);
  await importInto(page, igs('roof-moved.igs', sampleIges(ROOF_SEGMENTS.map(([a, b]) => [displaced(a), displaced(b)]))));
  await expect(page.locator('#align-panel')).toBeVisible();
  await expect(page.locator('#align-ok')).toBeHidden();
  const first = (await align(page))!;
  expect(first.aligned).toBe(false);
  expect(first.residual.median).toBeGreaterThan(first.tol);
  const bbox = (await state(page)).mesh!;
  await page.screenshot({ path: `${SHOTS}/align-before.png` });
  // ends on the left of the view, clear of the panel: segment 0's start, segment 3's start, segment 6's start
  for (const end of [0, 6, 12]) await dragEnd(page, end, ROOF_SEGMENTS[end >> 1][end & 1]);
  const paired = (await align(page))!;
  expect(paired.pairs).toBe(3);
  expect(paired.residual.median).toBeLessThan(2 * paired.tol);
  await expect(page.locator('#align-pairs .align-pair')).toHaveCount(3);
  await page.screenshot({ path: `${SHOTS}/align-paired.png` });
  await page.locator('#align-fit').click();
  await expect.poll(async () => (await align(page))!.fitted).toBe(true);
  const fitted = (await align(page))!;
  expect(fitted.residual.median).toBeLessThan(fitted.tol);
  await expect(page.locator('#align-ok')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/align-fitted.png` });
  // the fit can be taken back, and given again
  await page.locator('#align-unfit').click();
  await expect.poll(async () => (await align(page))!.fitted).toBe(false);
  await page.locator('#align-fit').click();
  await expect.poll(async () => (await align(page))!.fitted).toBe(true);
  await page.locator('#align-confirm').click();
  const st = await state(page);
  expect(st.scars).toHaveLength(10);
  st.scars.forEach((s, i) => expect(dist(s.vector!.start, ROOF_SEGMENTS[i][0])).toBeLessThan(0.3));
  expect(st.imports[0].pairs).toHaveLength(3);
  expect(st.imports[0].transform).toHaveLength(16);
  expect(st.imports[0].residual.median).toBeLessThan(fitted.tol);
  // only the vectors moved
  expect(st.mesh!.bboxMin).toEqual(bbox.bboxMin);
  expect(st.mesh!.bboxMax).toEqual(bbox.bboxMax);
});

test('Esc leaves the mode with nothing changed', async ({ page }) => {
  await roof(page);
  await importInto(page, igs('roof-moved.igs', sampleIges(ROOF_SEGMENTS.map(([a, b]) => [displaced(a), displaced(b)]))));
  await expect(page.locator('#align-panel')).toBeVisible();
  await dragEnd(page, 0, ROOF_SEGMENTS[0][0]);
  await page.keyboard.press('Escape');
  await expect(page.locator('#align-panel')).toHaveCount(0);
  expect(await align(page)).toBeNull();
  expect(await page.evaluate(() => window.lithicanalyst.alignDrawn())).toEqual({ arrows: 0, warned: 0 });
  const st = await state(page);
  expect(st.scars).toEqual([]);
  expect(st.imports).toEqual([]);
  await expect(page.locator('#btn-undo')).toBeDisabled();
});

test('the import as recorded: the project file, the source column, the arrows to check and their marks, the same file again', async ({ page }) => {
  await roof(page);
  // the last vector's end 6 mm over the roof: to be checked
  const segments = ROOF_SEGMENTS.map(([a, b], i): [Vec3, Vec3] => (i === 9 ? [a, [b[0], b[1], b[2] + 6]] : [a, b]));
  const file = igs('roof.igs', sampleIges(segments));
  await importInto(page, file);
  await expect(page.locator('#align-ok')).toBeVisible();
  expect(await page.evaluate(() => window.lithicanalyst.alignDrawn())).toEqual({ arrows: 10, warned: 1 });
  await page.locator('#align-confirm').click();
  await expect(page.locator('.toast').last()).toContainText('10 arrows imported · 1 to check');
  const st = await state(page);
  const flagged = st.scars[9].id;
  expect(await page.evaluate(() => window.lithicanalyst.toCheck())).toEqual([flagged]);
  const project = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(project.formatVersion).toBe(3);
  expect(project.imports).toHaveLength(1);
  const rec = project.imports[0];
  expect(rec).toMatchObject({ kind: 'iges-scars', file: 'roof.igs', unitsFlag: 10, unitsName: 'CM', scale: 1, pairs: [], review: [flagged] });
  expect(rec.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(rec.arrows).toEqual(st.scars.map((s) => s.id));
  expect(rec.transform).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const rows = parseCsv(await page.evaluate(() => window.lithicanalyst.exportCsvText()));
  expect(Object.keys(rows[0]).at(-1)).toBe('source');
  expect(rows.map((r) => r.source)).toEqual(Array(10).fill('iges:roof.igs'));
  // the mark in the list, gone once the arrow is edited
  await expect(page.locator('#scar-list .check-dot')).toHaveCount(1);
  await expect(page.locator(`#scar-list .arrow-row[data-id="${flagged}"] .check-dot`)).toHaveCount(1);
  await page.locator(`#scar-list .arrow-row[data-id="${flagged}"]`).click();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.selection())).toBe(flagged);
  // its completeness by its number key
  await page.keyboard.press('2');
  await expect.poll(async () => (await state(page)).scars[9].attributes.completeness).not.toBe(st.scars[9].attributes.completeness);
  await expect(page.locator('#scar-list .check-dot')).toHaveCount(0);
  expect(await page.evaluate(() => window.lithicanalyst.toCheck())).toEqual([]);
  // the same file again: asked first
  await importInto(page, file);
  await expect(page.locator('.modal [data-choice="again"]')).toBeVisible();
  await page.locator('.modal [data-choice="cancel"]').click();
  await expect(page.locator('#align-panel')).toHaveCount(0);
  await importInto(page, file);
  await page.locator('.modal [data-choice="again"]').click();
  await expect(page.locator('#align-panel')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('a file with no lines says so and changes nothing', async ({ page }) => {
  await roof(page);
  const other: IgesEntity[] = [{ type: 116, params: [1, 2, 3, 0] }, line(roofPoint(0, 0), roofPoint(1, 1), { form: 2 })];
  await importInto(page, igs('points.igs', igesText(other)));
  await expect(page.locator('.toast').last()).toContainText('no usable line segments');
  await expect(page.locator('#align-panel')).toHaveCount(0);
  expect((await state(page)).scars).toEqual([]);
});

test('the whole folder: one aligned and imported, one marked to align and opened in that mode, one without an IGES file', async ({ page }) => {
  await mkdirShots();
  // the box's top face, the vectors 4 mm above it and turned: to align
  const boxSegments: Array<[Vec3, Vec3]> = Array.from({ length: 6 }, (_, i) => [boxPoint(-15 + 5 * i, -6, 5), boxPoint(-12 + 5 * i, 4, 5)]);
  const shifted = (p: Vec3): Vec3 => [p[0] + 3, p[1] - 2, p[2] + 4];
  await mockFolder(page, 'scans', {
    'a_aligned.ply': roofPly().buffer,
    'a_aligned.igs': Buffer.from(sampleIges(ROOF_SEGMENTS), 'latin1'),
    'b_shifted.ply': boxPly().buffer,
    'b_shifted.IGES': Buffer.from(sampleIges(boxSegments.map(([a, b]) => [shifted(a), shifted(b)])), 'latin1'),
    'c_none.ply': spherePly().buffer,
  });
  await openApp(page);
  await openMockFolder(page);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.state().mesh?.fileName ?? null)).toBe('a_aligned.ply');
  await fileMenu(page, '#btn-import-folder-iges');
  await expect(page.locator('#import-folder-summary')).toHaveText('1 aligned, ready to import; 1 to align by hand; 1 without an igs');
  await page.screenshot({ path: `${SHOTS}/folder-summary.png` });
  await page.locator('.modal [data-choice="import"]').click();
  // the open model takes its arrows at once; its project file follows
  await expect.poll(async () => (await state(page)).scars.length).toBe(10);
  await expect
    .poll(async () => JSON.parse((await folderText(page, 'LithicAnalyst/projects/a_aligned.ply.lithicanalyst.json')) ?? '{}').imports?.length ?? 0)
    .toBe(1);
  const ws = (await page.evaluate(() => window.lithicanalyst.workspace()))!;
  expect(ws.toAlign).toEqual([false, true, false]);
  await expect(page.locator('#workspace-list .ws-align')).toHaveCount(1);
  await expect(page.locator('#workspace-list .ws-row').nth(1).locator('.ws-align')).toBeVisible();
  // the next one not finished: the one to align, opened in the mode with its file
  await page.keyboard.press('Shift+PageDown');
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.state().mesh?.fileName ?? null)).toBe('b_shifted.ply');
  await expect(page.locator('#align-panel')).toBeVisible();
  expect((await align(page))!.file).toBe('b_shifted.IGES');
  expect((await align(page))!.aligned).toBe(false);
  // the same again: the one done is passed by, the one to align still is
  await page.keyboard.press('Escape');
  await fileMenu(page, '#btn-import-folder-iges');
  await expect(page.locator('#import-folder-summary')).toHaveText('0 aligned, ready to import; 1 to align by hand; 1 without an igs · 1 already imported');
  await page.locator('.modal [data-choice="cancel"]').click();
});

async function mkdirShots(): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(SHOTS, { recursive: true });
}

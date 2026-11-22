import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { boxPly, boxPoint, t1Ply, type Vec3 } from './fixtures/meshes';
import { annotate, drawEdge } from './flakeSetup';
import { expect, fileMenu, loadMesh, nextFrames, openApp, openSection, state, test, viewFromTop } from './helpers';

const SHOTS = 'test-results/23';

const hint = (page: Page) => page.evaluate(() => window.lithicanalyst.measureHint());
const parts = async (page: Page) => (await hint(page)).prims.map((p) => `${p.kind}:${p.part}`);
const shown = (page: Page) => page.evaluate(() => window.lithicanalyst.measureHint().key);

/** The pointer on a row, by its number. */
const hover = async (page: Page, row: string): Promise<void> => {
  await page.locator(`#${row}`).scrollIntoViewIfNeeded();
  await page.locator(`#${row}`).hover();
};
/** The pointer off every row, over the view. */
const away = async (page: Page): Promise<void> => {
  await page.mouse.move(300, 400);
};

/** T1 annotated, in the measure mode, its measures in. */
async function flakeInMeasureMode(page: Page): Promise<void> {
  await openApp(page, 'flake');
  await loadMesh(page, t1Ply());
  await annotate(page);
  // the edge: the ventral face, for IPA
  await drawEdge(page);
  await page.locator('#app-mode-measure').click();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.flake()?.measures?.platform_width_path ?? null)).not.toBeNull();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.flake()?.measures?.ipa ?? null)).not.toBeNull();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.flake()?.measures?.epa_3pt_2mm ?? null)).not.toBeNull();
  await openSection(page, 'flake');
  // a three-quarter view, the panel out of the way
  if (await page.locator('#profile-panel').isVisible()) await page.locator('#profile-close').click();
  await page.evaluate(() => window.lithicanalyst.view([-0.62, -0.42, 0.66], [0, 0.7, 0.7]));
  await nextFrames(page);
}

test('hovering technical length: the axis, the box and three lines; gone when the pointer leaves; fixed by a click, let go by Esc', async ({ page }) => {
  await flakeInMeasureMode(page);
  const toward = await page.evaluate(() => window.lithicanalyst.towardViewer());
  // it waits a moment
  const atOnce = await page.locator('#flake-tech_length').evaluate((el) => {
    el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    return window.lithicanalyst.measureHint().key;
  });
  expect(atOnce).toBeNull();
  await expect.poll(() => shown(page)).toBe('flake:tech_length');
  await page.locator('#flake-tech_length').evaluate((el) => el.closest('.measure-auto')!.dispatchEvent(new PointerEvent('pointerleave')));
  await expect.poll(() => shown(page)).toBeNull();

  await hover(page, 'flake-tech_length');
  await expect.poll(() => shown(page)).toBe('flake:tech_length');
  const h = await hint(page);
  expect(h.pinned).toBeNull();
  expect(await parts(page)).toEqual(expect.arrayContaining(['line:axis', 'line:axis-head', 'line:box', 'line:length', 'line:width', 'line:thickness', 'dots:extremes']));
  expect(h.prims.find((p) => p.part === 'length')?.role).toBe('current');
  expect(h.prims.find((p) => p.part === 'width')?.role).toBe('other');
  // what is on the view: the current line with its value; the others fainter, without theirs
  expect(h.drawn!.lines).toBe(6);
  expect(h.drawn!.dots).toBe(2);
  expect(h.drawn!.labels).toBe(1);
  // (a label joins the page when the view is next drawn)
  await expect.poll(async () => (await hint(page)).labels.length).toBe(1);
  for (const l of (await hint(page)).labels) expect(l).toMatch(/^\d+\.\d{3} mm$/);
  expect(h.looks!.filter((l) => l.role === 'other').every((l) => l.opacity === 0.35 && !l.label)).toBe(true);
  await expect(page.locator('#flake-tech_length')).toHaveClass(/is-hinted/);
  // the labels take no clicks
  expect(await page.locator('.hint-label').first().evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  await page.screenshot({ path: `${SHOTS}/hint-tech-length.png` });
  // the camera stayed
  expect(await page.evaluate(() => window.lithicanalyst.towardViewer())).toEqual(toward);

  await away(page);
  await expect.poll(() => shown(page)).toBeNull();
  expect((await hint(page)).drawn).toEqual({ lines: 0, dots: 0, arcs: 0, faces: 0, patches: 0, labels: 0 });
  await expect(page.locator('.hint-label')).toHaveCount(0);

  // a click fixes it
  await hover(page, 'flake-tech_length');
  await page.locator('#flake-tech_length').click();
  expect((await hint(page)).pinned).toBe('flake:tech_length');
  await away(page);
  await nextFrames(page, 3);
  expect(await shown(page)).toBe('flake:tech_length');
  await expect(page.locator('#flake-tech_length')).toHaveClass(/is-pinned/);
  // another row shows while the pointer is on it, and the fixed one comes back
  await hover(page, 'flake-tech_width');
  await expect.poll(() => shown(page)).toBe('flake:tech_width');
  await away(page);
  await expect.poll(() => shown(page)).toBe('flake:tech_length');
  // Esc lets it go
  await page.keyboard.press('Escape');
  await expect.poll(() => shown(page)).toBeNull();
  expect((await hint(page)).pinned).toBeNull();

  // or a second click, the pointer still on the row
  await hover(page, 'flake-tech_length');
  await expect.poll(() => shown(page)).toBe('flake:tech_length');
  await page.locator('#flake-tech_length').click();
  expect((await hint(page)).pinned).toBe('flake:tech_length');
  await page.locator('#flake-tech_length').click();
  await expect.poll(() => shown(page)).toBeNull();
  await nextFrames(page, 3);
  expect(await shown(page)).toBeNull();
});

test('in the dark theme too, and a change of theme while one is fixed', async ({ page }) => {
  await flakeInMeasureMode(page);
  await hover(page, 'flake-tech_length');
  await page.locator('#flake-tech_length').click();
  await away(page);
  await page.locator('#btn-theme').click();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.theme())).toBe('dark');
  await away(page);
  expect(await shown(page)).toBe('flake:tech_length');
  expect((await hint(page)).drawn!.lines).toBe(6);
  await nextFrames(page, 3);
  await page.screenshot({ path: `${SHOTS}/hint-tech-length-dark.png` });
  await hover(page, 'flake-epa_3pt_2mm');
  await expect.poll(() => shown(page)).toBe('flake:epa_3pt_2mm');
  await nextFrames(page, 3);
  await page.screenshot({ path: `${SHOTS}/hint-epa-dark.png` });
});

test('the keyboard: a row with the focus shows at once; Enter fixes it', async ({ page }) => {
  await flakeInMeasureMode(page);
  // the dimensions' table goes by rows: technological length, morphological length, technological width …
  await page.locator('#flake-tech_length').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#flake-morph_length')).toBeFocused();
  await expect.poll(() => shown(page)).toBe('flake:morph_length');
  await page.keyboard.press('Enter');
  expect((await hint(page)).pinned).toBe('flake:morph_length');
  await page.keyboard.press('Tab');
  await expect.poll(() => shown(page)).toBe('flake:tech_width');
  await page.keyboard.press('Escape');
  expect((await hint(page)).pinned).toBeNull();
});

test('every measure of a flake draws its own; a pinned one goes with the mode and with the type', async ({ page }) => {
  await flakeInMeasureMode(page);
  await hover(page, 'flake-morph_width');
  await expect.poll(() => shown(page)).toBe('flake:morph_width');
  expect(await parts(page)).toEqual(expect.arrayContaining(['line:length', 'line:width', 'line:thickness', 'dots:extremes']));

  await hover(page, 'flake-morph_tech_angle_deg');
  await expect.poll(() => shown(page)).toBe('flake:morph_tech_angle_deg');
  expect(await parts(page)).toEqual(['line:technical-axis', 'line:morphological-axis', 'arc:arc']);
  expect((await hint(page)).drawn!.arcs).toBe(1);

  await hover(page, 'flake-platform_width_chord');
  await expect.poll(() => shown(page)).toBe('flake:platform_width_chord');
  expect(await parts(page)).toEqual(['line:path', 'line:chord', 'dots:ends']);
  expect((await hint(page)).prims.find((p) => p.part === 'chord')?.role).toBe('current');
  await page.screenshot({ path: `${SHOTS}/hint-platform-width.png` });

  await hover(page, 'flake-platform_depth_path');
  await expect.poll(() => shown(page)).toBe('flake:platform_depth_path');
  expect((await hint(page)).prims.find((p) => p.part === 'path')?.role).toBe('current');

  await hover(page, 'flake-platform_area');
  await expect.poll(() => shown(page)).toBe('flake:platform_area');
  expect((await hint(page)).drawn!.faces).toBe(1);

  await hover(page, 'flake-epa_3pt_2mm');
  await expect.poll(() => shown(page)).toBe('flake:epa_3pt_2mm');
  expect(await parts(page)).toEqual(expect.arrayContaining(['line:section', 'line:platform-line', 'line:to-q', 'arc:arc', 'dots:points']));
  await page.screenshot({ path: `${SHOTS}/hint-epa.png` });

  await hover(page, 'flake-epa_2ln_1mm');
  await expect.poll(() => shown(page)).toBe('flake:epa_2ln_1mm');
  expect(await parts(page)).toEqual(expect.arrayContaining(['line:section', 'line:chord', 'arc:arc']));

  await hover(page, 'flake-ipa');
  await expect.poll(() => shown(page)).toBe('flake:ipa');
  expect(await parts(page)).toEqual(expect.arrayContaining(['faces:band', 'patch:band-plane', 'line:platform-line', 'line:band-line', 'arc:arc']));

  await hover(page, 'flake-area');
  await expect.poll(() => shown(page)).toBe('flake:area');
  expect((await hint(page)).prims[0]).toMatchObject({ kind: 'faces', part: 'model' });
  await hover(page, 'flake-volume');
  await expect.poll(() => shown(page)).toBe('flake:volume');

  // fixed, then another mode: gone, and not back on return
  await page.locator('#flake-volume').click();
  await away(page);
  expect((await hint(page)).pinned).toBe('flake:volume');
  await page.locator('#app-mode-annotate').click();
  expect((await hint(page)).key).toBeNull();
  expect((await hint(page)).pinned).toBeNull();
  await page.locator('#app-mode-measure').click();
  await nextFrames(page, 3);
  expect(await shown(page)).toBeNull();

  // fixed, then another type
  await hover(page, 'flake-tech_length');
  await page.locator('#flake-tech_length').click();
  await away(page);
  expect((await hint(page)).pinned).toBe('flake:tech_length');
  await page.locator('#specimen-more').click();
  await page.locator('#specimen-type').selectOption('core');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).specimen.type).toBe('core');
  expect(await hint(page)).toMatchObject({ key: null, pinned: null });
});

test('an empty value draws nothing and says why, as before', async ({ page }) => {
  await openApp(page, 'flake');
  await loadMesh(page, t1Ply());
  await page.locator('#app-mode-measure').click();
  await expect(page.locator('#flake-tech_length')).toHaveText('—');
  await page.locator('#flake-tech_length').hover();
  await expect(page.locator('.tip')).toContainText('technological axis');
  await nextFrames(page, 3);
  await page.waitForTimeout(200);
  expect(await shown(page)).toBeNull();
  await page.locator('#flake-tech_length').click();
  expect((await hint(page)).pinned).toBeNull();
  await expect(page.locator('dt[data-hint="flake:tech_length"]')).toHaveCount(0);
  // what has a value beside it does draw
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.flake()?.measures?.morph_length ?? null)).not.toBeNull();
  await hover(page, 'flake-morph_length');
  await expect.poll(() => shown(page)).toBe('flake:morph_length');
});

/** A closed curve round the sides of the box, in a project file: what a symmetry reference parts the sides along. */
async function boxWithRing(page: Page, type: 'core' | 'generic'): Promise<void> {
  const ply = boxPly();
  await openApp(page, type);
  await loadMesh(page, ply);
  const corners: Vec3[] = [boxPoint(-20, -10, 2.5), boxPoint(20, -10, 2.5), boxPoint(20, 10, 2.5), boxPoint(-20, 10, 2.5)];
  const project = {
    format: 'lithicanalyst-project',
    formatVersion: 2,
    specimen: { id: 'box', annotator: '', unit: 'mm', notes: '', frame: null, type },
    mesh: { fileName: ply.name, sha256: createHash('sha256').update(ply.buffer).digest('hex') },
    annotations: { scars: [], curves: [{ id: 'ring', label: 'C1', anchors: corners, points: corners, anchorIndex: [0, 1, 2, 3], closed: true, attributes: { type: type === 'core' ? 'core_edge' : '', note: '' } }] },
  };
  const chooser = page.waitForEvent('filechooser');
  await fileMenu(page, '#btn-open-project');
  await (await chooser).setFiles({ name: 'ring.lithicanalyst.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect.poll(async () => (await state(page)).curves.length).toBe(1);
  await viewFromTop(page);
  await page.locator('#app-mode-measure').click();
  await expect(page.locator('#auto-length')).not.toHaveText('—');
}

test('a core: its three lines (as a flake\'s morphological ones); the whole model; a symmetry reference by its curve, side A coloured', async ({ page }) => {
  await boxWithRing(page, 'core');
  await hover(page, 'auto-width');
  await expect.poll(() => shown(page)).toBe('auto:width');
  expect(await parts(page)).toEqual(expect.arrayContaining(['line:length', 'line:width', 'line:thickness', 'dots:extremes']));
  expect(await parts(page)).not.toContain('line:box');
  expect((await hint(page)).prims.find((p) => p.part === 'width')?.role).toBe('current');
  await expect.poll(async () => (await hint(page)).labels.length).toBe(1);
  await hover(page, 'auto-area');
  await expect.poll(() => shown(page)).toBe('auto:area');
  expect((await hint(page)).prims).toMatchObject([{ kind: 'faces', part: 'model', role: 'current' }]);
  await hover(page, 'auto-volume');
  await expect.poll(() => shown(page)).toBe('auto:volume');

  await page.locator('#symmetry-add').click();
  await page.locator('#symmetry-add-curve-ring').click();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.symmetry().values[0]?.volumeA ?? null)).not.toBeNull();
  const id = (await state(page)).symmetry[0].id;
  await page.evaluate(() => window.lithicanalyst.view([0.5, -0.6, 0.62], [0, 0.7, 0.7]));
  await nextFrames(page);
  await hover(page, 'symmetry-volume-a');
  await expect.poll(() => shown(page)).toBe(`symmetry:${id}|volume`);
  expect(await parts(page)).toEqual(['faces:side-a', 'line:symmetry-curve']);
  expect((await hint(page)).drawn).toMatchObject({ faces: 1, lines: 1 });
  await page.screenshot({ path: `${SHOTS}/hint-symmetry.png` });
  // the values come from the reference as it stands: swapped, the same drawing of the other side
  await page.locator('#symmetry-swap').click();
  await hover(page, 'symmetry-volume-b');
  await expect.poll(() => shown(page)).toBe(`symmetry:${id}|volume`);
  expect(await parts(page)).toEqual(['faces:side-a', 'line:symmetry-curve']);
});

test('a generic specimen: the same three lines, and the same for the whole model', async ({ page }) => {
  await boxWithRing(page, 'generic');
  await hover(page, 'auto-length');
  await expect.poll(() => shown(page)).toBe('auto:length');
  expect(await parts(page)).toEqual(expect.arrayContaining(['line:length', 'line:width', 'line:thickness', 'dots:extremes']));
  expect(await parts(page)).not.toContain('line:box');
  await hover(page, 'auto-area');
  await expect.poll(() => shown(page)).toBe('auto:area');
});

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { frameMatrix } from '../src/core/frame';
import { S_CENTRE, s1Ply, s1Point, t1Ply } from './fixtures/meshes';
import { annotate } from './flakeSetup';
import { expect, fileMenu, loadMesh, nextFrames, openApp, state, test } from './helpers';

/** Stage 34b: fitted planes drawn as rounded rectangles fitted to their section; selected, a sparse grid and a slim normal. */

const style = (page: Page, id: string) => page.evaluate((i) => window.lithicanalyst.planeStyle(i), id);
const SHOTS = 'test-results/34b';

/** S1 as a core with a specimen frame, a closed curve round it at x = 0, and two planes: P1 through all the vertices, P2 by the curve. */
async function openPlanes(page: Page): Promise<void> {
  await openApp(page);
  const ply = s1Ply();
  await loadMesh(page, ply);
  await expect.poll(() => page.evaluate(() => !!window.lithicanalyst.autoMeasurements())).toBe(true);
  const ring = Array.from({ length: 48 }, (_, k) => s1Point(0, (360 * k) / 48));
  const plane = (id: string, label: string, method: string, curveIds: string[]) => ({ id, label, method, excludeCompleteness: [], curveIds, regionIds: [], upHint: [0, 0, 1], visible: true });
  const project = {
    format: 'lithicanalyst-project',
    formatVersion: 3,
    specimen: { id: 's1', annotator: '', unit: 'mm', notes: '', frame: { matrix: frameMatrix({ origin: S_CENTRE, x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }), source: 'view' }, type: 'core' },
    mesh: { fileName: ply.name, sha256: createHash('sha256').update(ply.buffer).digest('hex') },
    annotations: {
      scars: [],
      curves: [{ id: 'ring', label: 'C1', anchors: [ring[0], ring[16], ring[32]], points: ring, anchorIndex: [0, 16, 32], closed: true, attributes: { type: '', note: '' } }],
      planes: [plane('p1', 'P1', 'all_vertices', []), plane('p2', 'P2', 'curves', ['ring'])],
    },
  };
  const chooser = page.waitForEvent('filechooser');
  await fileMenu(page, '#btn-open-project');
  await (await chooser).setFiles({ name: 's1.lithicanalyst.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect.poll(async () => (await state(page)).planes.length).toBe(2);
  await page.evaluate(() => window.lithicanalyst.view([0.35, -0.75, 0.55], [0, 0, 1]));
  await page.locator('#app-mode-measure').click();
  // the sections came: the rectangles are fitted to them
  for (const id of ['p1', 'p2']) await expect.poll(async () => (await style(page, id))?.from ?? null, { timeout: 30_000 }).toBe('section');
  await nextFrames(page, 3);
}

test('selected: the grid and the normal at the selected look; the other plane without them; let go: back', async ({ page, pageErrors }) => {
  await openPlanes(page);
  // P1 (all the vertices): the plane across the shortest axis, z = centre; the section is the 60 × 40 ellipse
  const p1 = (await style(page, 'p1'))!;
  expect(Math.abs(p1.u[0])).toBeGreaterThan(0.999);
  expect(p1.halfWidth).toBeCloseTo(30 + 0.15 * 60, 0);
  expect(p1.halfHeight).toBeCloseTo(20 + 0.15 * 60, 0);
  expect(p1.radius).toBeCloseTo(0.1 * 2 * p1.halfHeight, 6);
  p1.center.forEach((c, k) => expect(c).toBeCloseTo(S_CENTRE[k], 1));
  // nothing selected: both thin and faint, no grid, no normal
  for (const id of ['p1', 'p2']) expect(await style(page, id)).toMatchObject({ look: 'idle', fill: 0.06, edge: 0.5, grid: 0, gridLines: 0, normal: false });
  await page.screenshot({ path: `${SHOTS}/core-unselected.png` });

  await page.locator('#plane-list .plane-row', { hasText: 'P1' }).click();
  await expect.poll(async () => (await style(page, 'p1'))?.look).toBe('selected');
  const sel = (await style(page, 'p1'))!;
  expect(sel).toMatchObject({ fill: 0.12, edge: 0.95, grid: 0.28, normal: true });
  // 78 × 58: a step of 10, lines through the centre every 10 either way
  expect(sel.gridLines).toBe(7 + 5);
  expect(await style(page, 'p2')).toMatchObject({ look: 'idle', gridLines: 0, normal: false });
  await nextFrames(page, 3);
  await page.screenshot({ path: `${SHOTS}/core-selected.png` });
  // the dark theme
  await page.locator('#btn-theme').click();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.theme())).toBe('dark');
  await nextFrames(page, 3);
  await page.screenshot({ path: `${SHOTS}/core-selected-dark.png` });
  await page.locator('#btn-theme').click();

  // let go: back to the plain look
  await page.evaluate(() => window.lithicanalyst.selectForTest(null));
  await expect.poll(async () => (await style(page, 'p1'))?.look).toBe('idle');
  expect(await style(page, 'p1')).toMatchObject({ fill: 0.06, edge: 0.5, grid: 0, gridLines: 0, normal: false });
  expect(pageErrors).toEqual([]);
});

test('a symmetry reference’s plane: the same look, fitted to its section or to its curve', async ({ page, pageErrors }) => {
  await openPlanes(page);
  await page.locator('#symmetry-add').click();
  await page.locator('#symmetry-add-frame-specimen-x').click();
  await page.locator('#symmetry-add').click();
  await page.locator('#symmetry-add-curve-ring').click();
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.symmetry())).values.length, { timeout: 60_000 }).toBe(2);
  const [byFrame, byCurve] = (await state(page)).symmetry.map((s) => s.id);
  // not pointed at: not drawn
  expect(await style(page, byFrame)).toBeNull();
  // the frame's mid-plane x = centre: the section is the 40 × 24 ellipse across Y and Z
  await page.locator('#symmetry-list li').first().click();
  await page.locator('#symmetry-volume-cell').hover();
  await expect.poll(async () => (await style(page, byFrame))?.from ?? null).toBe('section');
  const s = (await style(page, byFrame))!;
  expect(s).toMatchObject({ look: 'selected', fill: 0.12, edge: 0.95, grid: 0.28, normal: true });
  expect(s.gridLines).toBeGreaterThan(0);
  expect(Math.abs(s.u[1])).toBeGreaterThan(0.999);
  expect(s.halfWidth).toBeCloseTo(20 + 0.15 * 40, 0);
  await nextFrames(page, 3);
  await page.screenshot({ path: `${SHOTS}/symmetry-plane.png` });
  // the curve's reference: fitted to the curve's points
  await page.locator('#symmetry-list li').nth(1).click();
  await page.locator('#symmetry-volume-cell').hover();
  await expect.poll(async () => (await style(page, byCurve))?.look ?? null).toBe('selected');
  expect((await style(page, byCurve))!.from).toBe('section');
  await page.mouse.move(5, 5);
  await expect.poll(() => style(page, byCurve)).toBeNull();
  expect(pageErrors).toEqual([]);
});

test('the present mode with the planes in the figure: the figure’s look, a grid and no normal, selected or not', async ({ page, pageErrors }) => {
  await openPlanes(page);
  await page.locator('#plane-list .plane-row', { hasText: 'P1' }).click();
  await page.evaluate(() => window.lithicanalyst.setMode('present'));
  // not in the figure: not drawn
  await expect(page.locator('#fig-planes')).not.toBeChecked();
  expect(await style(page, 'p1')).toBeNull();
  await page.locator('#fig-planes').check();
  for (const id of ['p1', 'p2']) {
    await expect.poll(async () => (await style(page, id))?.look ?? null).toBe('figure');
    const f = (await style(page, id))!;
    expect(f).toMatchObject({ fill: 0.1, edge: 0.9, grid: 0.25, normal: false });
    expect(f.gridLines).toBeGreaterThan(0);
  }
  await nextFrames(page, 3);
  await page.screenshot({ path: `${SHOTS}/present.png` });
  // the figure itself draws the planes' sections
  const fig = await page.evaluate(() => window.lithicanalyst.figure('png'));
  expect(fig).not.toBeNull();
  writeFileSync(`${SHOTS}/figure-with-planes.png`, Buffer.from(fig!.data, 'base64'));
  expect(pageErrors).toEqual([]);
});

test('a flake: its plane (by the platform outline) fitted to its section', async ({ page, pageErrors }) => {
  await openApp(page, 'flake');
  await loadMesh(page, t1Ply());
  await expect.poll(() => page.evaluate(() => !!window.lithicanalyst.autoMeasurements())).toBe(true);
  await annotate(page);
  await page.locator('#app-mode-measure').click();
  await page.locator('#plane-add').click();
  // (a flake's planes go by curves or regions: the platform outline)
  const curve = (await state(page)).curves[0].id;
  await page.locator(`#plane-curve-${curve}`).check();
  const id = (await state(page)).planes[0].id;
  await expect.poll(async () => (await style(page, id))?.from ?? null, { timeout: 30_000 }).toBe('section');
  expect(await style(page, id)).toMatchObject({ look: 'selected', normal: true });
  await page.evaluate(() => window.lithicanalyst.view([0.4, -0.6, 0.7], [0, 0, 1]));
  await nextFrames(page, 3);
  await page.screenshot({ path: `${SHOTS}/flake-selected.png` });
  expect(pageErrors).toEqual([]);
});

test.describe('with motion', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test('selecting fades in 150 ms; with reduced motion, at once', async ({ page, pageErrors }) => {
    await openPlanes(page);
    // the click and the reading in one go: the fade has only begun
    const early = await page.evaluate(() => {
      (document.querySelectorAll<HTMLElement>('#plane-list .plane-row')[0]).click();
      return window.lithicanalyst.planeStyle('p1');
    });
    expect(early!.look).toBe('selected');
    expect(early!.fill).toBeLessThan(0.12);
    await expect.poll(async () => (await style(page, 'p1'))?.fill).toBe(0.12);
    expect(await style(page, 'p1')).toMatchObject({ edge: 0.95, grid: 0.28, normal: true });
    // reduced motion: the end at once
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const now = await page.evaluate(() => {
      (document.querySelectorAll<HTMLElement>('#plane-list .plane-row')[1]).click();
      return [window.lithicanalyst.planeStyle('p2'), window.lithicanalyst.planeStyle('p1')];
    });
    expect(now[0]).toMatchObject({ look: 'selected', fill: 0.12, edge: 0.95, grid: 0.28, normal: true });
    expect(now[1]).toMatchObject({ look: 'idle', fill: 0.06, edge: 0.5, grid: 0, gridLines: 0, normal: false });
    expect(pageErrors).toEqual([]);
  });
});

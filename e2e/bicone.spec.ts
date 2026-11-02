import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { BICONE, biconePly, biconePoint, type Vec3 } from './fixtures/meshes';
import { curveClick, displayPanel, dragArrow, expect, exportFile, fileMenu, loadMesh, nextFrames, openApp, parseCsv, state, test, toScreen } from './helpers';

const bicone = (page: Page) => page.evaluate(() => window.lithicanalyst.bicone());

/** Seen from in front and well above the rim (the whole upper cone and rim in view). */
const fromAbove = (page: Page) => page.evaluate(() => window.lithicanalyst.view([0, -0.6, 0.8], [0, 0, 1]));

/** Switch the configuration panel on in the display settings. */
async function showConfig(page: Page): Promise<void> {
  await displayPanel(page);
  await page.locator('#config-show').setChecked(true);
  await page.keyboard.press('Escape');
}

/** Trace a curve with the curve tool through points just inside the rim (they snap onto it) at these angles; closed: back to the first. */
async function traceRim(page: Page, degrees: number[], closed: boolean): Promise<void> {
  await page.keyboard.press('p');
  for (const d of degrees) await curveClick(page, await toScreen(page, biconePoint(d, 0.97)));
  const before = (await state(page)).curves.length;
  if (closed) {
    // the first point is on the outline: click a few pixels inside it (within closing reach)
    const first = await toScreen(page, (await page.evaluate(() => window.lithicanalyst.curveDraft()))![0] as Vec3);
    const apex = await toScreen(page, biconePoint(0, 0));
    const k = 5 / Math.hypot(apex.x - first.x, apex.y - first.y);
    const at = { x: first.x + k * (apex.x - first.x), y: first.y + k * (apex.y - first.y) };
    await page.mouse.move(at.x, at.y, { steps: 3 });
    await page.mouse.click(at.x, at.y);
  } else await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).curves.length).toBe(before + 1);
}

/** A closed curve round the bicone at `rho` of the radius (on a ring of the mesh), on the upper cone. */
function ringCurve(id: string, label: string, rho: number, type: string) {
  const points = Array.from({ length: BICONE.segments }, (_, j) => biconePoint((360 * j) / BICONE.segments, rho));
  return { id, label, anchors: [points[0], points[32], points[64]], points, anchorIndex: [0, 32, 64], closed: true, attributes: { type, note: '' } };
}

/** A scar from near the rim inward, at this angle, on one cone. */
const scarOn = (id: string, deg: number, upper: boolean) => ({
  id,
  label: id.toUpperCase(),
  vector: { start: biconePoint(deg, 0.95, upper), end: biconePoint(deg, 0.45, upper), startNormal: [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180), 0], endNormal: [0, 0, upper ? 1 : -1] },
  attributes: {},
});

/** The closed bicone with this project on it (its scars, curves …), measured. */
async function openProject(page: Page, annotations: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<void> {
  const ply = biconePly();
  await openApp(page);
  await loadMesh(page, ply);
  await expect.poll(() => page.evaluate(() => !!window.lithicanalyst.autoMeasurements())).toBe(true);
  const project = {
    format: 'lithicanalyst-project',
    formatVersion: 2,
    specimen: { id: 'bicone', annotator: '', unit: 'mm', notes: '', frame: null },
    mesh: { fileName: ply.name, sha256: createHash('sha256').update(ply.buffer).digest('hex') },
    annotations,
    ...extra,
  };
  const chooser = page.waitForEvent('filechooser');
  await fileMenu(page, '#btn-open-project');
  await (await chooser).setFiles({ name: 'bicone.lithicanalyst.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect.poll(async () => (await state(page)).scars.length).toBe((annotations.scars as unknown[]).length);
}

/** Distance of a point from the rim circle. */
const offRim = (p: Vec3) => Math.hypot(Math.hypot(p[0] - BICONE.center[0], p[1] - BICONE.center[1]) - BICONE.radius, p[2] - BICONE.center[2]);

test('a discoid core as a bicone: split along the core edge, two traits, swapped, the view bicone, exports', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, biconePly());
  await expect.poll(() => page.evaluate(() => !!window.lithicanalyst.autoMeasurements())).toBe(true);
  await fromAbove(page);
  await nextFrames(page);
  // the core's edge, traced round the rim and closed; set as a core edge
  await traceRim(page, [-90, 30, 150], true);
  const curve = (await state(page)).curves[0];
  expect(curve.closed).toBe(true);
  for (const p of curve.points) expect(offRim(p)).toBeLessThan(1);
  await page.keyboard.press('2');
  await expect.poll(async () => (await state(page)).curves[0].attributes.type).toBe('core_edge');
  // three scars on the upper cone, from the rim inward
  await page.keyboard.press('a');
  for (const d of [-90, -60, -120]) await dragArrow(page, biconePoint(d, 0.95), biconePoint(d, 0.45));
  await page.keyboard.press('v');

  // the split: closed core edges come first; upper toward the viewer (above)
  await page.keyboard.press('m');
  await page.locator('#plane-add').click();
  await expect(page.locator('#split-source option')).toHaveText(['None', 'C1', 'P1']);
  await page.locator('#split-source').selectOption(`curve:${curve.id}`);
  const area = (96 / 2) * BICONE.radius ** 2 * Math.sin((2 * Math.PI) / 96);
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.volumeSplit()))?.upper ?? 0).toBeCloseTo((area * BICONE.upper) / 3, 0);

  // the bicone: box / bicone shows once the split is along a curve
  await page.evaluate(() => window.lithicanalyst.setMode('annotate'));
  await showConfig(page);
  await expect(page.locator('#config-model-row')).toBeVisible();
  await expect(page.locator('#config-model-box')).toHaveAttribute('aria-checked', 'true');
  await page.locator('#config-model-bicone').click();
  await expect(page.locator('#config-facial')).toHaveText('Unifacial');
  await expect(page.locator('#config-surfaces')).toHaveText('Upper');
  await expect(page.locator('#config-surface-relation')).toHaveCount(0);
  await expect(page.locator('#config-status')).toBeHidden();
  const b = (await bicone(page))!;
  expect(b.area / (Math.PI * BICONE.radius ** 2)).toBeCloseTo(1, 1);
  // A is the traced curve's (a little inside the polygon's rim): within half a unit
  expect(b.upperHeight).toBeCloseTo(BICONE.upper, 0);
  expect(b.lowerHeight).toBeCloseTo(BICONE.lower, 0);
  expect(b.plane.normal[2]).toBeCloseTo(1, 3);
  expect(await page.evaluate(() => window.lithicanalyst.sketchArrowCount())).toBe(3);
  expect((await state(page)).configuration.model).toBe('bicone');

  // one scar on the lower cone: bifacial
  await page.evaluate(() => window.lithicanalyst.view([0, -0.6, -0.8], [0, 0, 1]));
  await nextFrames(page);
  await page.keyboard.press('a');
  await dragArrow(page, biconePoint(-90, 0.95, false), biconePoint(-90, 0.45, false));
  await page.keyboard.press('v');
  await expect(page.locator('#config-facial')).toHaveText('Bifacial');
  await expect(page.locator('#config-surfaces')).toHaveText('Upper, lower');

  // the view bicone: a click on the upper cone turns the view to look down on the base from above
  await page.evaluate(() => window.lithicanalyst.view([0.4, -0.7, 0.6], [0, 0, 1]));
  await nextFrames(page);
  await expect(page.locator('#view-cube')).toBeVisible();
  const at = (await page.evaluate(() => window.lithicanalyst.cubeFacePoint('upper')))!;
  expect(at).not.toBeNull();
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.configFace())).toBe('upper');
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.towardViewer()))![2]).toBeGreaterThan(0.999);
  await expect(page.locator('#config-card')).toHaveAttribute('data-face', 'upper');
  await expect(page.locator('#config-face-state')).toHaveText('Auto');
  // the lower cone's scar is faded while the upper is picked
  expect((await page.evaluate(() => window.lithicanalyst.fadedArrows())).length).toBe(1);

  // the upper cone set unflaked by hand: unifacial, the lower
  await page.locator('#config-role-none').click();
  await expect(page.locator('#config-facial')).toHaveText('Unifacial');
  await expect(page.locator('#config-surfaces')).toHaveText('Lower');
  expect((await state(page)).configuration.bicone.roles).toEqual({ positive: 'none' });

  // swapped: upper and lower change places, the correction stays with its cone (now the lower)
  await page.locator('#config-swap').click();
  await expect.poll(async () => (await bicone(page))?.upperHeight ?? 0).toBeCloseTo(BICONE.lower, 0);
  expect((await state(page)).split!.swap).toBe(true);
  await expect(page.locator('#config-surfaces')).toHaveText('Upper');
  const r = (await bicone(page))!;
  expect(r.cones.map((c) => [c.cone, c.side, c.role, c.scars])).toEqual([
    ['upper', 'negative', 'flaking', 1],
    ['lower', 'positive', 'none', 3],
  ]);
  const [m] = parseCsv(await page.evaluate(() => window.lithicanalyst.exportMeasurementsCsvText()));
  expect(Number(m.volume_upper)).toBeCloseTo((area * BICONE.lower) / 3, 0);
  // the same Command in the volume panel
  await page.keyboard.press('m');
  await expect(page.locator('#split-swap')).toBeVisible();
  await page.evaluate(() => window.lithicanalyst.setMode('annotate'));

  // exports: the model column; the cones as flaking surfaces; no platforms
  const conf = parseCsv((await exportFile(page, 'configuration')).text);
  expect(conf).toEqual([{ specimen_id: 'bicone', model: 'bicone', frame: 'principal', facial_character: 'unifacial', flaking_surface_relation: '', platform_relation: '', polarity: '' }]);
  const surf = parseCsv((await exportFile(page, 'flaking-surfaces')).text);
  expect(surf).toEqual([{ specimen_id: 'bicone', surface_id: 'F1', faces: 'upper', platforms: '', also_platform: '', n_scars: '1', surface_type: '', exploitation_axis: '' }]);
  const vec = parseCsv(await page.evaluate(() => window.lithicanalyst.exportCsvText()));
  expect(vec.map((v) => [v.platform_face, v.flaking_surface])).toEqual([['', ''], ['', ''], ['', ''], ['', 'F1']]);
  // the project file keeps the model, the side's correction and the swap
  const file = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(file.configuration).toMatchObject({ model: 'bicone', bicone: { roles: { positive: 'none' } } });
  expect(file.derived.configuration).toMatchObject({ model: 'bicone', facialCharacter: 'unifacial' });

  // undo the swap; back to the box
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await state(page)).split!.swap).toBe(false);
  await page.locator('#config-model-box').click();
  await expect(page.locator('#config-surface-relation')).toBeVisible();
  expect(await page.evaluate(() => window.lithicanalyst.configFace())).toBeNull();
});

test('one closed core edge and no split yet: Bicone does both in one step, and undo takes both back', async ({ page }) => {
  // the scars are on the upper cone; seen from below, that side is still upper
  await openProject(page, { scars: [scarOn('s1', 0, true), scarOn('s2', 120, true)], curves: [ringCurve('rim', 'C1', 1, 'core_edge')] });
  await page.evaluate(() => window.lithicanalyst.view([0, -0.6, -0.8], [0, 0, 1]));
  await showConfig(page);
  await expect(page.locator('#config-model-box')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#config-edge-row')).toBeHidden();
  await page.locator('#config-model-bicone').click();
  await expect(page.locator('#config-model-bicone')).toHaveAttribute('aria-checked', 'true');
  const st = await state(page);
  expect(st.split).toMatchObject({ source: 'curve', id: 'rim', swap: false });
  expect(st.split!.upHint[2]).toBeGreaterThan(0.9);
  expect(st.configuration.model).toBe('bicone');
  await expect(page.locator('#config-surfaces')).toHaveText('Upper');
  await expect(page.locator('#config-edge-curve')).toHaveValue('rim');
  // the sketch has every arrow, and is drawn (an empty canvas compresses to next to nothing)
  expect(await page.evaluate(() => window.lithicanalyst.sketchArrowCount())).toBe(2);
  await expect.poll(async () => (await page.locator('#config-sketch').screenshot()).length).toBeGreaterThan(8000);
  // one undo step for both
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await state(page)).split).toBeNull();
  expect((await state(page)).configuration.model).toBe('box');
  await expect(page.locator('#config-model-box')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#config-edge-row')).toBeHidden();
});

test('two closed curves: the edge curve is asked for first; it can be changed there, and the box keeps the split', async ({ page }) => {
  await openProject(page, { scars: [scarOn('s1', 0, true)], curves: [ringCurve('rim', 'C1', 1, 'core_edge'), ringCurve('ring', 'C2', 4 / 6, 'core_edge')] });
  await showConfig(page);
  await page.locator('#config-model-bicone').click();
  // nothing changes until one is chosen
  await expect(page.locator('#config-edge-row')).toBeVisible();
  await expect(page.locator('#config-edge-curve')).toHaveValue('');
  await expect(page.locator('#config-edge-curve option:not([hidden])')).toHaveText(['C1', 'C2']);
  await expect(page.locator('#config-model-box')).toHaveAttribute('aria-checked', 'true');
  expect((await state(page)).split).toBeNull();
  expect((await state(page)).configuration.model).toBe('box');
  await page.locator('#config-edge-curve').selectOption('rim');
  await expect(page.locator('#config-model-bicone')).toHaveAttribute('aria-checked', 'true');
  expect((await state(page)).split).toMatchObject({ source: 'curve', id: 'rim' });
  expect((await state(page)).configuration.model).toBe('bicone');
  await expect(page.locator('#config-edge-curve')).toHaveValue('rim');
  await expect.poll(async () => (await bicone(page))?.lowerHeight ?? 0).toBeCloseTo(BICONE.lower, 0);
  // changed directly: the same setting as the volume panel's
  await page.locator('#config-edge-curve').selectOption('ring');
  await expect.poll(async () => (await state(page)).split?.id).toBe('ring');
  await expect.poll(async () => (await bicone(page))?.radius ?? 0).toBeLessThan(BICONE.radius * 0.8);
  await page.keyboard.press('m');
  await expect(page.locator('#split-source')).toHaveValue('curve:ring');
  await page.evaluate(() => window.lithicanalyst.setMode('annotate'));
  // back to the box: the split stays
  await page.locator('#config-model-box').click();
  expect((await state(page)).split).toMatchObject({ source: 'curve', id: 'ring' });
  await expect(page.locator('#config-edge-row')).toBeHidden();
});

test('a split by a plane is replaced, and it says so', async ({ page }) => {
  await openProject(
    page,
    { scars: [scarOn('s1', 0, true)], curves: [ringCurve('rim', 'C1', 1, '')], planes: [{ id: 'p1', label: 'P1', method: 'all_vertices', upHint: [0, 0, 1], visible: true }] },
    { split: { source: 'plane', id: 'p1', upHint: [0, 0, 1] } },
  );
  await showConfig(page);
  await page.locator('#config-model-bicone').click();
  await expect(page.locator('.toast').filter({ hasText: 'Upper / lower volume is now split along C1' })).toBeVisible();
  expect((await state(page)).split).toMatchObject({ source: 'curve', id: 'rim' });
  expect((await state(page)).configuration.model).toBe('bicone');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await state(page)).split?.source).toBe('plane');
  expect((await state(page)).configuration.model).toBe('box');
});

test('a new split along a curve: the side with more scars is up, wherever it is seen from', async ({ page }) => {
  await openProject(page, { scars: [scarOn('s1', 0, true), scarOn('s2', 100, false), scarOn('s3', 200, false), scarOn('s4', 300, false)], curves: [ringCurve('rim', 'C1', 1, 'core_edge')] });
  // looking from above, at the side with fewer scars
  await fromAbove(page);
  await nextFrames(page);
  await page.keyboard.press('m');
  await page.locator('#split-source').selectOption('curve:rim');
  expect((await state(page)).split!.upHint[2]).toBeLessThan(-0.9);
  const area = (96 / 2) * BICONE.radius ** 2 * Math.sin((2 * Math.PI) / 96);
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.volumeSplit()))?.upper ?? 0).toBeCloseTo((area * BICONE.lower) / 3, 0);
});

test('without a closed curve the bicone cannot be chosen, and says why', async ({ page }) => {
  await openProject(page, { scars: [scarOn('s1', 0, true)] });
  await showConfig(page);
  const button = page.locator('#config-model-bicone');
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  await button.hover();
  await expect(page.locator('.tip')).toHaveText('Needs a closed curve');
  await button.click({ force: true });
  await expect(page.locator('#config-model-box')).toHaveAttribute('aria-checked', 'true');
  expect((await state(page)).configuration.model).toBe('box');
  await expect(page.locator('#config-edge-row')).toBeHidden();
});

test('the sketch is not drawn while the main view turns; the view bicone is, framed by its outline', async ({ page }) => {
  await openProject(page, { scars: [scarOn('s1', 0, true), scarOn('s2', 180, false)], curves: [ringCurve('rim', 'C1', 1, 'core_edge')] });
  await showConfig(page);
  await page.locator('#config-model-bicone').click();
  await expect(page.locator('#config-surfaces')).toHaveText('Upper, lower');
  await nextFrames(page, 3);
  const before = await page.evaluate(() => ({ sketch: window.lithicanalyst.sketchRenders(), cube: window.lithicanalyst.cubeDraws() }));
  for (const toward of [[1, 0, 0.3], [0, 1, 0.3], [-1, 0, 0.3], [0, -1, 0.3]]) {
    await page.evaluate((t) => window.lithicanalyst.view(t as Vec3, [0, 0, 1]), toward);
    await nextFrames(page, 2);
  }
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.cubeDraws())).toBeGreaterThan(before.cube);
  expect(await page.evaluate(() => window.lithicanalyst.sketchRenders())).toBe(before.sketch);
  // the base's width nearly fills the sketch in its default view
  const sketch = (await page.locator('#config-sketch').boundingBox())!;
  const upper = (await page.evaluate(() => window.lithicanalyst.sketchFacePoint('upper')))!;
  expect(upper.x).toBeGreaterThan(sketch.x);
  expect(await page.evaluate(() => window.lithicanalyst.sketchOutlineWidth())).toBeGreaterThan(0.8 * sketch.width);
  expect(await page.evaluate(() => window.lithicanalyst.sketchOutlineWidth())).toBeLessThan(0.9 * sketch.width);
});

/** How much of the panel's content is hidden (it would have to be scrolled to). */
const hiddenInPanel = (page: Page) => page.locator('#config-body').evaluate((b) => b.scrollHeight - b.clientHeight);

test.describe('in a low window', () => {
  test.use({ viewport: { width: 1366, height: 650 } });

  test('the bicone and its card are shown whole: the sketch gives way, and swapping needs no cone picked', async ({ page }) => {
    await openProject(page, { scars: [scarOn('s1', 0, true), scarOn('s2', 180, false)], curves: [ringCurve('rim', 'C1', 1, 'core_edge')] });
    await showConfig(page);
    await page.locator('#config-model-bicone').click();
    await expect(page.locator('#config-surfaces')).toHaveText('Upper, lower');
    await expect(page.locator('#config-swap')).toBeVisible();
    const whole = (await page.locator('#config-sketch').boundingBox())!;
    await page.evaluate(() => window.lithicanalyst.selectConfigFace('upper'));
    await expect(page.locator('#config-card')).toBeVisible();
    await expect(page.locator('#config-card #config-swap')).toHaveCount(0);
    await expect.poll(() => hiddenInPanel(page)).toBeLessThanOrEqual(1);
    const sketch = (await page.locator('#config-sketch').boundingBox())!;
    expect(sketch.height).toBeLessThan(whole.height);
    expect(sketch.height).toBeGreaterThanOrEqual(100);
    // still clear of the cube and the readout, and drawn at its new size, whole
    const panel = (await page.locator('#config-panel').boundingBox())!;
    const cube = (await page.locator('#view-cube').boundingBox())!;
    const readout = (await page.locator('.status-coords').boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(cube.y + cube.height);
    expect(panel.y + panel.height).toBeLessThanOrEqual(readout.y);
    await expect.poll(() => page.locator('#config-sketch').evaluate((c: HTMLCanvasElement) => c.height / devicePixelRatio - c.clientHeight)).toBe(0);
    expect(await page.evaluate(() => window.lithicanalyst.sketchOutlineWidth())).toBeLessThanOrEqual(0.9 * sketch.width);
    // swapped from the row of the edge curve, with no cone picked either
    await page.evaluate(() => window.lithicanalyst.selectConfigFace(null));
    await page.locator('#config-swap').click();
    await expect.poll(async () => (await state(page)).split!.swap).toBe(true);
  });
});

test('moved low by hand, the panel goes up when its card opens, and back when it closes', async ({ page }) => {
  await openProject(page, { scars: [scarOn('s1', 0, true), scarOn('s2', 180, false)], curves: [ringCurve('rim', 'C1', 1, 'core_edge')] });
  await showConfig(page);
  await page.locator('#config-model-bicone').click();
  await expect(page.locator('#config-surfaces')).toHaveText('Upper, lower');
  const view = (await page.locator('#viewport').boundingBox())!;
  const panel = page.locator('#config-panel');
  const head = (await page.locator('#config-panel .float-title').boundingBox())!;
  // as far down as it goes
  await page.mouse.move(head.x + 10, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x - 100, head.y + 4000, { steps: 5 });
  await page.mouse.up();
  const low = (await panel.boundingBox())!;
  expect(low.y + low.height).toBeGreaterThan(view.y + view.height - 12);
  await page.evaluate(() => window.lithicanalyst.selectConfigFace('upper'));
  await expect(page.locator('#config-card')).toBeVisible();
  await expect.poll(async () => (await panel.boundingBox())!.y).toBeLessThan(low.y - 40);
  const open = (await panel.boundingBox())!;
  expect(open.y + open.height).toBeLessThanOrEqual(view.y + view.height);
  expect(await hiddenInPanel(page)).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.lithicanalyst.selectConfigFace(null));
  await expect.poll(async () => Math.round((await panel.boundingBox())!.y)).toBe(Math.round(low.y));
});

test('an open mesh: the bicone shows only why it cannot', async ({ page }) => {
  const ply = biconePly(true);
  await openApp(page);
  await loadMesh(page, ply);
  const rim = Array.from({ length: BICONE.segments }, (_, j) => biconePoint((360 * j) / BICONE.segments, 1));
  const project = {
    format: 'lithicanalyst-project',
    formatVersion: 2,
    specimen: { id: 'open', annotator: '', unit: 'mm', notes: '', frame: null },
    mesh: { fileName: ply.name, sha256: createHash('sha256').update(ply.buffer).digest('hex') },
    annotations: {
      scars: [{ id: 's1', label: 'S1', vector: { start: biconePoint(0, 0.95), end: biconePoint(0, 0.45), startNormal: [1, 0, 0], endNormal: [0, 0, 1] }, attributes: {} }],
      curves: [{ id: 'rim', label: 'C1', anchors: [rim[0], rim[32], rim[64]], points: rim, anchorIndex: [0, 32, 64], closed: true, attributes: { type: 'core_edge', note: '' } }],
    },
    split: { source: 'curve', id: 'rim', upHint: [0, 0, 1] },
    configuration: { model: 'bicone' },
  };
  const chooser = page.waitForEvent('filechooser');
  await fileMenu(page, '#btn-open-project');
  await (await chooser).setFiles({ name: 'open.lithicanalyst.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect.poll(async () => (await state(page)).curves.length).toBe(1);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.autoMeasurements()?.closed)).toBe(false);
  await showConfig(page);
  await expect(page.locator('#config-status')).toHaveText('Mesh not closed');
  await expect(page.locator('#config-model-row')).toBeVisible();
  await expect(page.locator('#config-model-bicone')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.config-sketch-wrap')).toBeHidden();
  await expect(page.locator('#config-traits')).toBeHidden();
  await expect(page.locator('#view-cube')).toBeHidden();
  expect(await page.evaluate(() => window.lithicanalyst.configStatus())).toBe('not_closed');
  // the choice stays; the box still works
  expect((await state(page)).configuration.model).toBe('bicone');
  await page.locator('#config-model-box').click();
  await expect(page.locator('#config-status')).toBeHidden();
  await expect(page.locator('#config-traits')).toBeVisible();
  await expect(page.locator('#config-facial')).toHaveText('Unifacial');
});

test('an open curve along part of the edge, completed round the rim in one step', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, biconePly());
  await expect.poll(() => page.evaluate(() => !!window.lithicanalyst.autoMeasurements())).toBe(true);
  await fromAbove(page);
  await nextFrames(page);
  await traceRim(page, [-150, -90, -30], false);
  const open = (await state(page)).curves[0];
  expect(open.closed).toBe(false);
  await expect(page.locator('#curve-complete')).toBeEnabled();
  await page.locator('#curve-complete').click();
  await expect.poll(async () => (await state(page)).curves[0].closed, { timeout: 20000 }).toBe(true);
  const c = (await state(page)).curves[0];
  expect(c.completion).toEqual({ method: 'outline', firstAutoAnchor: 3, stepDeg: 2, anchorStepDeg: 12 });
  expect(c.anchors.slice(0, 3)).toEqual(open.anchors);
  // automatic anchors about 12° apart round the 240° that were missing (the rim has a vertex every 3.75°)
  const round = c.anchors.slice(2).concat([c.anchors[0]]).map((p) => (Math.atan2(p[1] - BICONE.center[1], p[0] - BICONE.center[0]) * 180) / Math.PI);
  const gaps = round.slice(1).map((d, i) => (d - round[i] + 720) % 360);
  expect(gaps.reduce((a, b) => a + b, 0)).toBeGreaterThan(220);
  for (const g of gaps) {
    expect(g).toBeGreaterThan(7);
    expect(g).toBeLessThan(19);
  }
  expect(gaps.reduce((a, b) => a + b, 0) / gaps.length).toBeCloseTo(12, -0.5);
  for (const p of c.points) expect(offRim(p)).toBeLessThan(4);
  let a2 = 0;
  for (let i = 0; i < c.points.length; i++) {
    const p = c.points[i], q = c.points[(i + 1) % c.points.length];
    a2 += (p[0] - BICONE.center[0]) * (q[1] - BICONE.center[1]) - (q[0] - BICONE.center[0]) * (p[1] - BICONE.center[1]);
  }
  expect(Math.abs(a2 / 2) / (Math.PI * BICONE.radius ** 2)).toBeGreaterThan(0.95);
  // closed now: no button
  await expect(page.locator('#curve-complete')).toBeHidden();
  // one undo step back to the open curve
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await state(page)).curves[0].closed).toBe(false);
  const back = (await state(page)).curves[0];
  expect(back.anchors).toEqual(open.anchors);
  expect(back.completion).toBeUndefined();
});

test('a curve too short to go round is left as it is', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, biconePly());
  await expect.poll(() => page.evaluate(() => !!window.lithicanalyst.autoMeasurements())).toBe(true);
  await fromAbove(page);
  await nextFrames(page);
  await traceRim(page, [-110, -90, -70], false);
  const before = (await state(page)).curves[0];
  await page.locator('#curve-complete').click();
  await expect(page.locator('.toast').filter({ hasText: 'Curve too short or straight to complete' })).toBeVisible();
  expect((await state(page)).curves[0]).toEqual(before);
});

test('the sketch keeps the bicone inside and centred however it is turned, and each model starts from its default view', async ({ page }) => {
  await openProject(page, { scars: [scarOn('s1', 0, true), scarOn('s2', 180, false)], curves: [ringCurve('rim', 'C1', 1, 'core_edge')] });
  await showConfig(page);
  const sketch = page.locator('#config-sketch');
  const turn = async (dx: number, dy: number) => {
    const b = (await sketch.boundingBox())!;
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 4 });
    await page.mouse.up();
  };
  const outline = async () => (await page.evaluate(() => window.lithicanalyst.sketchOutlineBox()))!;
  // turned as a box first: the bicone does not take that over
  await turn(30, 60);
  await page.locator('#config-model-bicone').click();
  await expect(page.locator('#config-surfaces')).toHaveText('Upper, lower');
  await nextFrames(page, 2);
  const home = await outline();
  await sketch.dblclick();
  const again = await outline();
  expect(Math.abs(again.bottom - again.top - (home.bottom - home.top))).toBeLessThan(1);
  expect(Math.abs(again.right - again.left - (home.right - home.left))).toBeLessThan(1);

  const b = (await sketch.boundingBox())!;
  let leastWidth = Infinity;
  for (const [dx, dy] of [[0, -50], [0, -50], [0, -50], [70, 0], [0, 120], [-40, 40]]) {
    await turn(dx, dy);
    const o = await outline();
    expect(o.left).toBeGreaterThanOrEqual(b.x);
    expect(o.right).toBeLessThanOrEqual(b.x + b.width);
    expect(o.top).toBeGreaterThanOrEqual(b.y);
    expect(o.bottom).toBeLessThanOrEqual(b.y + b.height);
    expect(Math.abs((o.left + o.right) / 2 - (b.x + b.width / 2))).toBeLessThan(2);
    expect(Math.abs((o.top + o.bottom) / 2 - (b.y + b.height / 2))).toBeLessThan(2);
    leastWidth = Math.min(leastWidth, o.right - o.left);
  }
  // seen from above, the round base had to be drawn smaller; back in the default view it is as large as before
  expect(leastWidth).toBeLessThan(0.9 * (home.right - home.left));
  await sketch.dblclick();
  const back = await outline();
  expect(Math.abs(back.right - back.left - (home.right - home.left))).toBeLessThan(1);

  // turned, then to the box and back
  await turn(0, -60);
  await page.locator('#config-model-box').click();
  await page.locator('#config-model-bicone').click();
  await expect(page.locator('#config-surfaces')).toHaveText('Upper, lower');
  await nextFrames(page, 2);
  const third = await outline();
  expect(Math.abs(third.bottom - third.top - (home.bottom - home.top))).toBeLessThan(1);
});

test('buttons with an icon show no words: their name is in the tooltip', async ({ page }) => {
  await openProject(page, { scars: [scarOn('s1', 0, true), scarOn('s2', 180, false)], curves: [ringCurve('rim', 'C1', 1, 'core_edge')] });
  await page.locator('#sec-arrows .arrow-row', { hasText: 'S1' }).click();
  const del = page.locator('#insp-delete');
  await expect(del).toHaveText('');
  await expect(del).toHaveAttribute('aria-label', 'Delete');
  await del.hover();
  // once: no key cap saying it again
  await expect(page.locator('.tip')).toHaveText('Delete');
  await del.click();
  await expect.poll(async () => (await state(page)).scars.length).toBe(1);
});

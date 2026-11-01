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
  expect(c.completion).toEqual({ method: 'outline', firstAutoAnchor: 3, stepDeg: 2 });
  expect(c.anchors.slice(0, 3)).toEqual(open.anchors);
  expect(c.anchors.length).toBeGreaterThan(20);
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

import type { Page } from '@playwright/test';
import type { ConfigFace } from '../src/core/fields';
import { columnPly, columnPoint } from './fixtures/meshes';
import { displayPanel, dragArrow, expect, exportFile, fileMenu, loadMesh, nextFrames, openApp, parseCsv, state, test, viewFromTop } from './helpers';

const config = (page: Page) => page.evaluate(() => window.lithicanalyst.configuration());

/** A columnar core with three scars on its +z face, all struck from the +y end. */
async function threeScars(page: Page): Promise<void> {
  await openApp(page);
  await loadMesh(page, columnPly());
  await viewFromTop(page);
  await expect.poll(() => page.evaluate(() => !!window.lithicanalyst.autoMeasurements())).toBe(true);
  await page.keyboard.press('a');
  for (const x of [-10, 0, 10]) await dragArrow(page, columnPoint(x, 27, 12), columnPoint(x, 5, 12));
  await page.keyboard.press('v');
  await expect.poll(async () => (await config(page))?.scars.length).toBe(3);
}

/** Switch the configuration panel on or off in the display settings. */
async function showConfig(page: Page, on: boolean): Promise<void> {
  await displayPanel(page);
  await page.locator('#config-show').setChecked(on);
  await page.keyboard.press('Escape');
  await expect(page.locator('#display-panel')).toBeHidden();
}

test('a columnar core: the seven traits in the panel, the view cube and the face card', async ({ page }) => {
  await threeScars(page);
  const r = (await config(page))!;
  // no specimen frame: the principal axes (their signs decide which face is "front")
  expect(r.frame).toBe('principal');
  const scarFace = r.scars[0].face, platform = r.scars[0].platform;
  expect(r.scars.every((s) => s.face === scarFace && s.platform === platform && s.surface === 'F1')).toBe(true);
  expect(['front', 'back']).toContain(scarFace);
  expect(['top', 'bottom']).toContain(platform);
  // no longer in the sidebar
  await expect(page.locator('#sec-configuration')).toHaveCount(0);
  await showConfig(page, true);
  await expect(page.locator('#config-panel')).toBeVisible();
  await expect(page.locator('#config-panel .float-head #config-frame')).toBeVisible();
  await expect(page.locator('#config-facial')).toHaveText('Unifacial');
  await expect(page.locator('#config-surfaces')).toHaveText(scarFace === 'front' ? 'F1 Front' : 'F1 Back');
  await expect(page.locator('#config-surface-relation')).toHaveText('—');
  await expect(page.locator('#config-platform-relation')).toHaveText('Single platform');
  await expect(page.locator('#config-polarity')).toHaveValue('');
  await expect(page.locator('#config-polarity option').first()).toHaveText('Auto (Unipolar longitudinal)');
  await expect(page.locator('#config-type-value')).toHaveText('F1 Wide');
  await expect(page.locator('#config-axis-value')).toHaveText('F1 Long');
  await expect(page.locator('#config-sketch')).toBeVisible();
  // the card opens once a face is picked
  await expect(page.locator('#config-card')).toBeHidden();

  // the view cube: a click on the face toward +x turns the view square on to it and picks it
  await page.evaluate(() => window.lithicanalyst.view([0.6, 0.45, 0.66], [0, 1, 0]));
  await nextFrames(page);
  const toward = (f: ConfigFace) => {
    const axis = { front: 2, back: 2, left: 0, right: 0, top: 1, bottom: 1 }[f];
    const side = ['front', 'right', 'top'].includes(f) ? 1 : -1;
    return r.axes[axis].map((v) => v * side);
  };
  const faces: ConfigFace[] = ['front', 'back', 'left', 'right', 'top', 'bottom'];
  const side = faces.reduce((best, f) => (toward(f)[0] > toward(best)[0] ? f : best));
  await expect(page.locator('#view-cube')).toBeVisible();
  const at = (await page.evaluate((f) => window.lithicanalyst.cubeFacePoint(f), side))!;
  expect(at).not.toBeNull();
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.configFace())).toBe(side);
  await expect(page.locator('#config-card')).toBeVisible();
  await expect(page.locator('#config-card')).toHaveAttribute('data-face', side);
  await expect
    .poll(async () => {
      const v = (await page.evaluate(() => window.lithicanalyst.towardViewer()))!;
      return v.reduce((s, x, k) => s + x * toward(side)[k], 0);
    })
    .toBeGreaterThan(0.999);
  // no scars on that face: every arrow is faded
  expect((await page.evaluate(() => window.lithicanalyst.fadedArrows())).length).toBe(3);

  // the face card: the platform set as unexploited by hand, then undone
  await page.evaluate((f) => window.lithicanalyst.selectConfigFace(f), platform);
  await expect(page.locator('#config-role-platform')).toHaveAttribute('aria-checked', 'true');
  await page.locator('#config-role-none').click();
  await expect(page.locator('#config-face-state')).toHaveText('Edited');
  await expect(page.locator('#config-platform-relation')).toHaveText('—');
  expect((await state(page)).configuration.roles).toEqual({ [platform]: 'none' });
  expect((await config(page))!.polarity).toBeNull();
  await page.keyboard.press('Control+z');
  await expect(page.locator('#config-platform-relation')).toHaveText('Single platform');
  await expect(page.locator('#config-face-state')).toHaveText('Auto');
  expect((await state(page)).configuration.roles).toEqual({});
  // the polarity by hand
  await page.locator('#config-polarity').selectOption('bipolar_opposed');
  expect((await config(page))!.polarity).toBe('bipolar_opposed');
  expect((await state(page)).configuration.polarity).toBe('bipolar_opposed');

  // Esc lets go of the face: the arrows come back and the card closes (the first Esc leaves the list)
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.lithicanalyst.configFace())).toBeNull();
  expect(await page.evaluate(() => window.lithicanalyst.fadedArrows())).toEqual([]);
  await expect(page.locator('#config-card')).toBeHidden();
  // hiding the panel lets go of the picked face too
  await page.evaluate((f) => window.lithicanalyst.selectConfigFace(f), scarFace);
  await showConfig(page, false);
  expect(await page.evaluate(() => window.lithicanalyst.configFace())).toBeNull();
  await expect(page.locator('#view-cube')).toBeHidden();
  // the panel and the cube belong to the annotate mode
  await showConfig(page, true);
  await page.evaluate(() => window.lithicanalyst.setMode('measure'));
  await expect(page.locator('#config-panel')).toBeHidden();
  await expect(page.locator('#view-cube')).toBeHidden();
  await displayPanel(page);
  await expect(page.locator('#config-show')).toBeHidden();
});

test('the panel: switched on in the display settings, moved, folded, kept inside the view and where it was after a reload', async ({ page }) => {
  await threeScars(page);
  // off by default, the cube with it
  await expect(page.locator('#config-panel')).toBeHidden();
  await expect(page.locator('#view-cube')).toBeHidden();
  await showConfig(page, true);
  await expect(page.locator('#config-panel')).toBeVisible();
  await expect(page.locator('#view-cube')).toBeVisible();
  const view = (await page.locator('#viewport').boundingBox())!;
  const panel = page.locator('#config-panel');
  const before = (await panel.boundingBox())!;
  // clear of the cube
  const cube = (await page.locator('#view-cube').boundingBox())!;
  expect(before.y).toBeGreaterThanOrEqual(cube.y + cube.height);

  // moved by its title bar
  const head = (await page.locator('#config-panel .float-title').boundingBox())!;
  await page.mouse.move(head.x + 10, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x - 150, head.y + 30, { steps: 5 });
  await page.mouse.up();
  const moved = (await panel.boundingBox())!;
  expect(moved.x).toBeCloseTo(before.x - 160, 0);
  expect(moved.y).toBeCloseTo(before.y + 30 - head.height / 2, 0);
  // not beyond the view
  const now = (await page.locator('#config-panel .float-title').boundingBox())!;
  await page.mouse.move(now.x + 10, now.y + now.height / 2);
  await page.mouse.down();
  await page.mouse.move(now.x + 4000, now.y - 4000, { steps: 4 });
  await page.mouse.up();
  const corner = (await panel.boundingBox())!;
  expect(corner.x + corner.width).toBeLessThanOrEqual(view.x + view.width + 0.5);
  expect(corner.y).toBeGreaterThanOrEqual(view.y - 0.5);
  // back to where it was moved first
  await page.mouse.move(corner.x + 20, corner.y + 10);
  await page.mouse.down();
  await page.mouse.move(corner.x + 20 - (corner.x - moved.x), corner.y + 10 + (moved.y - corner.y), { steps: 4 });
  await page.mouse.up();
  const placed = (await panel.boundingBox())!;

  // folded to its title bar and opened again
  await page.locator('#config-fold').click();
  await expect(page.locator('#config-body')).toBeHidden();
  await expect(page.locator('#config-fold')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#config-fold').click();
  await expect(page.locator('#config-body')).toBeVisible();

  // after a reload: switched on, in the same place (a preference, not part of the project)
  expect((await page.evaluate(() => window.lithicanalyst.projectJson())) as unknown as Record<string, unknown>).not.toHaveProperty('configPanel');
  await page.reload();
  await page.waitForFunction(() => !!window.lithicanalyst);
  const chooser = page.waitForEvent('filechooser');
  await fileMenu(page, '#btn-open');
  await (await chooser).setFiles(columnPly());
  await page.getByRole('dialog').getByRole('button', { name: 'Restore' }).click();
  await expect(panel).toBeVisible();
  const after = (await panel.boundingBox())!;
  expect([Math.round(after.x), Math.round(after.y)]).toEqual([Math.round(placed.x), Math.round(placed.y)]);
  // closed from its title bar
  await page.locator('#config-close').click();
  await expect(panel).toBeHidden();
  await displayPanel(page);
  await expect(page.locator('#config-show')).not.toBeChecked();
});

test('the sketch draws one arrow per scar; a click on one selects its scar', async ({ page }) => {
  await threeScars(page);
  await showConfig(page, true);
  const scars = (await state(page)).scars;
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.sketchArrowCount())).toBe(3);
  const target = scars[1];
  let at = await page.evaluate((id) => window.lithicanalyst.sketchArrowPoint(id), target.id);
  if (!at) {
    // the arrows are on the face away from the default view: turn the sketch half round
    const box = (await page.locator('#config-sketch').boundingBox())!;
    await page.mouse.move(box.x + 8, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 8 + 262, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    at = await page.evaluate((id) => window.lithicanalyst.sketchArrowPoint(id), target.id);
  }
  expect(at).not.toBeNull();
  await page.mouse.click(at!.x, at!.y);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.selection())).toBe(target.id);
  await expect(page.locator('#arrow-inspector #insp-label')).toHaveValue(target.label);
  // a scar more: one arrow more
  await page.keyboard.press('Escape');
  await page.keyboard.press('a');
  await dragArrow(page, columnPoint(-14, 20, 12), columnPoint(-14, 0, 12));
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.sketchArrowCount())).toBe(4);
});

test('exports the configuration, the flaking surfaces and the new arrow columns', async ({ page }) => {
  await threeScars(page);
  const r = (await config(page))!;
  const face = r.scars[0].face, platform = r.scars[0].platform;
  const conf = await exportFile(page, 'configuration');
  expect(conf.name).toBe('column_configuration.csv');
  expect(parseCsv(conf.text)).toEqual([{ specimen_id: 'column', frame: 'principal', facial_character: 'unifacial', flaking_surface_relation: '', platform_relation: 'single', polarity: 'unipolar_longitudinal' }]);
  const surfaces = await exportFile(page, 'flaking-surfaces');
  expect(surfaces.name).toBe('column_flaking_surfaces.csv');
  expect(parseCsv(surfaces.text)).toEqual([{ specimen_id: 'column', surface_id: 'F1', faces: face, platforms: platform, also_platform: 'false', n_scars: '3', surface_type: 'wide', exploitation_axis: 'long' }]);
  const arrows = parseCsv((await exportFile(page, 'scar-vectors')).text);
  expect(arrows.map((a) => [a.scar_id, a.platform_face, a.flaking_surface, a.unit])).toEqual([
    ['S1', platform, 'F1', 'mm'],
    ['S2', platform, 'F1', 'mm'],
    ['S3', platform, 'F1', 'mm'],
  ]);
  // the project file keeps the result with its box and thresholds
  const file = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(file.configuration).toEqual({ roles: {}, joins: {}, surfaceType: {}, axis: {}, polarity: null });
  expect(file.derived.configuration).toMatchObject({ frame: 'principal', facialCharacter: 'unifacial', thresholds: { wideRatio: 1.25 } });
  const size = [0, 1, 2].map((k) => file.derived.configuration!.max[k] - file.derived.configuration!.min[k]);
  expect(size.map((s) => Math.round(s))).toEqual([36, 60, 24]);

  // a scar on the platform, struck in from the worked face: each surface is the other's platform
  await page.evaluate(() => window.lithicanalyst.view([0, 1, 0.3], [0, 0, -1]));
  await nextFrames(page);
  await page.keyboard.press('a');
  await dragArrow(page, columnPoint(0, 30, 10), columnPoint(0, 30, -2));
  await expect.poll(async () => (await config(page))?.surfaces.length).toBe(2);
  const two = parseCsv((await exportFile(page, 'flaking-surfaces')).text);
  expect(two.map((s) => [s.faces, s.platforms, s.also_platform])).toEqual([
    [face, platform, 'true'],
    [platform, face, 'true'],
  ].sort((a, b) => ['front', 'back', 'left', 'right', 'top', 'bottom'].indexOf(a[0]) - ['front', 'back', 'left', 'right', 'top', 'bottom'].indexOf(b[0])));
});

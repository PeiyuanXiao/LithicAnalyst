import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { frameMatrix } from '../src/core/frame';
import { symmetryS1, symmetryS2 } from '../tests/meshes';
import { S_CENTRE, s1Ply, s1Point, s2Ply, t1Ply } from './fixtures/meshes';
import { annotate } from './flakeSetup';
import { displayPanel, expect, fileMenu, loadMesh, nextFrames, openApp, parseCsv, state, test } from './helpers';

/** Stages 34 and 34a: symmetry about a plane the user chooses, on S1 and S2 (tests/meshes.ts): three symmetries, computed in the background. */

const values = (page: Page) => page.evaluate(() => window.lithicanalyst.symmetry().values);
const settled = async (page: Page, n: number) => {
  await expect.poll(async () => {
    const s = await page.evaluate(() => window.lithicanalyst.symmetry());
    return !s.busy && s.values.length === n;
  }, { timeout: 60_000 }).toBe(true);
  return values(page);
};

/** S1 or S2 with a closed curve round it at x = 0, and a specimen frame along the model's axes. */
async function openS(page: Page, ply: ReturnType<typeof s1Ply>): Promise<void> {
  await openApp(page);
  await loadMesh(page, ply);
  await expect.poll(() => page.evaluate(() => !!window.lithicanalyst.autoMeasurements())).toBe(true);
  const ring = Array.from({ length: 48 }, (_, k) => s1Point(0, (360 * k) / 48));
  const project = {
    format: 'lithicanalyst-project',
    formatVersion: 3,
    specimen: { id: ply.name.replace('.ply', ''), annotator: '', unit: 'mm', notes: '', frame: { matrix: frameMatrix({ origin: S_CENTRE, x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }), source: 'view' }, type: 'core' },
    mesh: { fileName: ply.name, sha256: createHash('sha256').update(ply.buffer).digest('hex') },
    annotations: { scars: [], curves: [{ id: 'ring', label: 'C1', anchors: [ring[0], ring[16], ring[32]], points: ring, anchorIndex: [0, 16, 32], closed: true, attributes: { type: '', note: '' } }] },
  };
  const chooser = page.waitForEvent('filechooser');
  await fileMenu(page, '#btn-open-project');
  await (await chooser).setFiles({ name: 's.lithicanalyst.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect.poll(async () => (await state(page)).curves.length).toBe(1);
  await page.evaluate(() => window.lithicanalyst.view([0.3, -0.8, 0.5], [0, 0, 1]));
  await nextFrames(page);
  await page.locator('#app-mode-measure').click();
}

const add = async (page: Page, item: string) => {
  await page.locator('#symmetry-add').click();
  await page.locator(`#symmetry-add-${item}`).click();
};

/** The volume of a closed mesh (divergence theorem). */
function volumeOf(m: { positions: Float32Array; index: Uint32Array }): number {
  let v = 0;
  const P = (i: number) => [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]];
  for (let t = 0; 3 * t < m.index.length; t++) {
    const [a, b, c] = [P(m.index[3 * t]), P(m.index[3 * t + 1]), P(m.index[3 * t + 2])];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

test('the symmetry card: three symmetries from a fitted plane, a closed curve and a frame’s mid-plane; S1 alike on both sides', async ({ page, pageErrors }) => {
  await openS(page, s1Ply());
  await expect(page.locator('#sec-symmetry')).toBeVisible();
  // after the fitted planes
  const order = await page.locator('#sidebar .panel:visible').evaluateAll((els) => els.map((e) => e.id));
  expect(order.indexOf('sec-symmetry')).toBe(order.indexOf('sec-planes') + 1);
  // computed in the symmetry worker
  expect((await page.evaluate(() => window.lithicanalyst.symmetry())).worker).toBe(true);

  // the sources, grouped: valid fitted planes, closed curves, the frames' mid-planes (a core: the specimen frame's)
  await page.locator('#plane-add').click();
  const plane = (await state(page)).planes[0].id;
  await page.locator('#symmetry-add').click();
  await expect(page.locator('#symmetry-add-menu .menu-group')).toHaveText(['Fitted planes', 'Closed curves', 'Mid-planes of the frames']);
  await expect(page.locator('#symmetry-add-menu .menu-item')).toHaveText(['P1', 'C1', 'Specimen X', 'Specimen Y', 'Specimen Z']);
  // (the plane through all the vertices: across the shortest axis, a plane of symmetry too)
  await page.locator(`#symmetry-add-plane-${plane}`).click();
  await add(page, 'curve-ring');
  await add(page, 'frame-specimen-x');
  const v = await settled(page, 3);
  for (const r of v) {
    // (the curve's chain is a zigzag of mesh edges: its sides differ a little)
    const tol = r === v[1] ? 0.03 : 1e-4;
    expect(1 - r.volumeSymmetry!).toBeLessThan(tol);
    expect(1 - r.areaSymmetry!).toBeLessThan(tol);
    expect(r.shapeSymmetry!).toBeGreaterThan(0.99);
  }
  expect(v[0].deviationMean!).toBeLessThan(1e-3);
  expect(v[2].deviationMean!).toBeLessThan(1e-3);
  // the specimen frame's mid-plane goes through the surface centroid: the centre
  v[2].plane!.point.forEach((c, k) => expect(c).toBeCloseTo(S_CENTRE[k], 2));

  // the list: label, source, the shape symmetry; the last one selected, its details
  await expect(page.locator('#symmetry-list li')).toHaveCount(3);
  await expect(page.locator('#symmetry-list li .arrow-meta')).toHaveText(['P1', 'C1', 'Specimen X']);
  await expect(page.locator('#symmetry-list li .arrow-len').nth(2)).toHaveText(v[2].shapeSymmetry!.toFixed(3));
  await expect(page.locator('#symmetry-list li').nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#symmetry-source')).toHaveValue('frame:specimen:x');
  // the three symmetries in a row, then the raw values
  await expect(page.locator('#symmetry-scores .symmetry-score-label')).toHaveText(['Volume', 'Area', 'Shape']);
  await expect(page.locator('#symmetry-volume')).toHaveText('1.000');
  await expect(page.locator('#symmetry-area')).toHaveText('1.000');
  await expect(page.locator('#symmetry-shape')).toHaveText(v[2].shapeSymmetry!.toFixed(3));
  await expect(page.locator('#symmetry-table thead th')).toHaveText(['Raw values', 'A', 'B']);
  await expect(page.locator('#symmetry-table th[scope="row"]')).toHaveText(['Volume (mm³)', 'Area (mm²)']);
  await expect(page.locator('#symmetry-dev-mean')).toBeVisible();
  // RMS and 95 %: folded away until asked for
  await expect(page.locator('#symmetry-more')).not.toHaveAttribute('open', '');
  await expect(page.locator('#symmetry-dev-rms')).toBeHidden();
  await page.locator('#symmetry-more-head').click();
  await expect(page.locator('#symmetry-dev-rms')).toBeVisible();
  await expect(page.locator('#symmetry-dev-p95')).toBeVisible();
  // the best plane of symmetry is gone
  await expect(page.locator('#symmetry-optimize')).toHaveCount(0);
  await expect(page.locator('.symmetry-best')).toHaveCount(0);
  await expect(page.locator('#symmetry-angle')).toHaveCount(0);
  await expect(page.locator('#symmetry-progress')).toBeHidden();
  await page.screenshot({ path: 'test-results/34a/s1-card.png' });

  // symmetry.csv
  const text = await page.evaluate(() => window.lithicanalyst.exportSymmetryCsvText());
  expect(text.split('\n')[0]).toBe('specimen_id,symmetry_id,source,source_id,volume_symmetry,area_symmetry,shape_symmetry,volume_a,volume_b,area_a,area_b,deviation_mean,deviation_rms,deviation_p95,unit,note');
  const rows = parseCsv(text);
  expect(rows.map((r) => [r.symmetry_id, r.source, r.source_id])).toEqual([
    ['S1', 'plane', 'P1'],
    ['S2', 'curve', 'C1'],
    ['S3', 'frame', 'specimen_x'],
  ]);
  expect(Number(rows[2].shape_symmetry)).toBeCloseTo(v[2].shapeSymmetry!, 5);
  // the label and the note are the user's; a label is no reason to compute again
  await page.locator('#symmetry-label').fill('mid');
  await expect(page.locator('#symmetry-list li').nth(2)).toContainText('mid');
  expect((await page.evaluate(() => window.lithicanalyst.symmetry())).busy).toBe(false);
  // shown on the model while pointed at: side A and the plane
  await page.locator('#symmetry-volume-cell').hover();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.measureHint().key)).toBe(`symmetry:${(await state(page)).symmetry[2].id}|volume`);
  await page.screenshot({ path: 'test-results/34a/s1-hint.png' });
  expect(pageErrors).toEqual([]);
});

test('S2: computing shows, the values before fade; back to a source used before, at once; swapped and undone; the shading by deviation', async ({ page, pageErrors }) => {
  test.setTimeout(180_000);
  const v1 = volumeOf(symmetryS1()), bump = volumeOf(symmetryS2()) - v1;
  await openS(page, s2Ply());
  await add(page, 'frame-specimen-x');
  const [v] = await settled(page, 1);
  // the mid-plane goes through the surface centroid, which the bump draws toward +X: the sides differ
  expect(v.plane!.point[0]).toBeGreaterThan(S_CENTRE[0] + 0.1);
  expect(v.volumeSymmetry!).toBeLessThan(0.99);
  expect(v.shapeSymmetry!).toBeLessThan(1);
  expect(v.shapeSymmetry!).toBeGreaterThan(v1 / (v1 + 3 * bump));
  const id = (await state(page)).symmetry[0].id;

  // another source while nothing comes back: "Computing", the values before faded, the list's ellipsis
  await page.evaluate(() => window.lithicanalyst.symmetryHold(true));
  await page.locator('#symmetry-source').selectOption('curve:ring');
  await expect(page.locator('#symmetry-progress')).toBeVisible();
  await expect(page.locator('#symmetry-progress')).toHaveText(/^Computing \d+%$/);
  for (const what of ['volume', 'area', 'shape']) {
    await expect(page.locator(`#symmetry-${what}-cell`)).toHaveClass(/is-stale/);
  }
  await expect(page.locator('#symmetry-shape')).toHaveText(v.shapeSymmetry!.toFixed(3));
  await expect(page.locator('#symmetry-list li .arrow-len')).toHaveText('…');
  await page.screenshot({ path: 'test-results/34a/s2-computing.png' });
  // let go: the new values, in full colour
  await page.evaluate(() => window.lithicanalyst.symmetryHold(false));
  const [onCurve] = await settled(page, 1);
  await expect(page.locator('#symmetry-progress')).toBeHidden();
  await expect(page.locator('#symmetry-volume-cell')).not.toHaveClass(/is-stale/);
  await expect(page.locator('#symmetry-shape')).toHaveText(onCurve.shapeSymmetry!.toFixed(3));
  await expect(page.locator('#symmetry-list li .arrow-len')).toHaveText(onCurve.shapeSymmetry!.toFixed(3));
  // along the curve at x = 0: the bump's half against the rest
  expect(Math.abs(onCurve.volumeSymmetry! - v1 / 2 / (v1 / 2 + bump))).toBeLessThan(0.02);
  // back to the mid-plane: from the cache, nothing computed
  await page.locator('#symmetry-source').selectOption('frame:specimen:x');
  expect(await page.evaluate(() => window.lithicanalyst.symmetry().busy)).toBe(false);
  await expect(page.locator('#symmetry-progress')).toBeHidden();
  await expect(page.locator('#symmetry-shape')).toHaveText(v.shapeSymmetry!.toFixed(3));

  // swapped: the volumes change places, the symmetries stay; undone: back
  await page.locator('#symmetry-swap').click();
  await expect.poll(async () => (await values(page))[0]?.volumeA).toBeCloseTo(v.volumeB!, 6);
  const [swapped] = await values(page);
  expect([swapped.volumeSymmetry, swapped.areaSymmetry, swapped.shapeSymmetry]).toEqual([v.volumeSymmetry, v.areaSymmetry, v.shapeSymmetry]);
  await expect(page.locator('#symmetry-volume-a')).toHaveText(v.volumeB!.toFixed(2));
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await values(page))[0]?.volumeA).toBeCloseTo(v.volumeA!, 6);

  // pointed at, the shape shows the deviation in colour
  await page.locator('#symmetry-shape-cell').hover();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.measureHint().key)).toBe(`symmetry:${id}|shape`);
  await expect.poll(() => page.evaluate((i) => window.lithicanalyst.symmetryDeviation(i, 0), id)).not.toBeNull();
  await page.mouse.move(5, 5);

  // Display ▸ Shading ▸ Symmetry: its progress first where the scale goes, then the scale (up to its 95 % by default)
  await page.evaluate(() => window.lithicanalyst.symmetryHold(true));
  await page.locator('#symmetry-source').selectOption('curve:ring');
  await displayPanel(page);
  await page.locator('#shading-symmetry').click();
  await expect(page.locator('#symmetry-shading-ref')).toHaveValue(id);
  await expect(page.locator('#symmetry-legend-progress')).toHaveText(/^Computing \d+%$/);
  expect((await page.evaluate(() => window.lithicanalyst.symmetryShading())).colored).toBe(false);
  await page.evaluate(() => window.lithicanalyst.symmetryHold(false));
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.symmetryShading().colored), { timeout: 60_000 }).toBe(true);
  await expect(page.locator('#symmetry-legend-progress')).toHaveCount(0);
  const [c] = await settled(page, 1);
  const shade = await page.evaluate(() => window.lithicanalyst.symmetryShading());
  expect(shade.limit!.value).toBeCloseTo(c.deviationP95!, 6);
  await expect(page.locator('#symmetry-legend')).toBeVisible();
  await expect(page.locator('#symmetry-legend-max')).toHaveText(`≥ ${c.deviationP95!.toFixed(3)} mm`);
  // the slider sets the upper end
  await page.locator('#symmetry-limit').focus();
  await page.keyboard.press('End');
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.symmetryShading())).limit!.value).toBeCloseTo(shade.limit!.max, 6);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/34a/s2-shading.png' });
  // hidden for the session: not drawn, so no shading by it; shown again, the shading is back
  const eye = page.locator('#symmetry-list li .row-eye').first();
  await eye.uncheck();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.symmetryShading().colored)).toBe(false);
  await expect(page.locator('#symmetry-legend')).toBeHidden();
  await page.locator('#symmetry-dev-mean').hover();
  expect(await page.evaluate(() => window.lithicanalyst.measureHint().key)).toBeNull();
  await eye.check();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.symmetryShading().colored)).toBe(true);
  // selected, Delete takes it away; undone, it is back with its values (kept: nothing computed)
  await page.locator('#symmetry-list li').first().click();
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await state(page)).symmetry.length).toBe(0);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await values(page))[0]?.shapeSymmetry ?? null).toBe(c.shapeSymmetry);
  expect(pageErrors).toEqual([]);
});

test('a flake: the technological frame’s X mid-plane, through the point of percussion; T1 alike on both sides', async ({ page, pageErrors }) => {
  await openApp(page, 'flake');
  await loadMesh(page, t1Ply());
  await page.locator('#app-mode-measure').click();
  // no technological frame yet: its mid-plane cannot be chosen
  await page.locator('#symmetry-add').click();
  await expect(page.locator('#symmetry-add-frame-technological-x')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.locator('#app-mode-annotate').click();
  await annotate(page);
  await page.locator('#app-mode-measure').click();
  await page.locator('#symmetry-add').click();
  // (the platform outline is a closed curve too)
  await expect(page.locator('#symmetry-add-menu .menu-item')).toHaveText(['C1', 'Technological X', 'Specimen X', 'Specimen Y', 'Specimen Z']);
  await page.locator('#symmetry-add-frame-technological-x').click();
  const [v] = await settled(page, 1);
  // T1 is a prism across X from −15 to 15: the plane x = 0 through P
  expect(v.plane!.point[0]).toBeCloseTo(0, 1);
  expect(Math.abs(v.plane!.normal[0])).toBeGreaterThan(0.999);
  expect(v.volumeSymmetry!).toBeGreaterThan(0.99);
  expect(v.areaSymmetry!).toBeGreaterThan(0.99);
  expect(v.shapeSymmetry!).toBeGreaterThan(0.98);
  expect(v.deviationMean!).toBeLessThan(0.05);
  // the size of T1 says the units are right
  expect(v.areaA! + v.areaB!).toBeGreaterThan(2 * 30 * 40);
  await expect(page.locator('#symmetry-list li .arrow-meta')).toHaveText(['Technological X']);
  const [row] = parseCsv(await page.evaluate(() => window.lithicanalyst.exportSymmetryCsvText()));
  expect([row.source, row.source_id]).toEqual(['frame', 'technological_x']);
  await page.locator('#symmetry-area-cell').hover();
  await page.screenshot({ path: 'test-results/34a/t1-technological-x.png' });
  expect(pageErrors).toEqual([]);
});

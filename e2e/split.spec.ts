import { createHash } from 'node:crypto';
import { boxPly, boxPoint } from './fixtures/meshes';
import { expect, fileMenu, loadMesh, nextFrames, openApp, parseCsv, state, test } from './helpers';

const split = (page: import('@playwright/test').Page) => page.evaluate(() => window.lithicanalyst.volumeSplit());

test('splits the volume by a plane and by a closed curve', async ({ page }) => {
  const ply = boxPly();
  await openApp(page);
  await loadMesh(page, ply);
  // a closed curve around the sides of the box at z = 2.5 (given by its corners), from a project file
  const corners = [boxPoint(-20, -10, 2.5), boxPoint(20, -10, 2.5), boxPoint(20, 10, 2.5), boxPoint(-20, 10, 2.5)];
  const project = {
    format: 'lithicanalyst-project',
    formatVersion: 2,
    specimen: { id: 'box', annotator: '', unit: 'mm', notes: '', frame: null },
    mesh: { fileName: 'box.ply', sha256: createHash('sha256').update(ply.buffer).digest('hex') },
    annotations: { scars: [], curves: [{ id: 'ring', label: 'C1', anchors: corners, points: corners, anchorIndex: [0, 1, 2, 3], closed: true, attributes: { type: 'edge', note: '' } }] },
  };
  const chooser = page.waitForEvent('filechooser');
  await fileMenu(page, '#btn-open-project');
  await (await chooser).setFiles({ name: 'ring.lithicanalyst.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect.poll(async () => (await state(page)).curves.length).toBe(1);

  await page.evaluate(() => window.lithicanalyst.view([0, 0, 1], [0, 1, 0]));
  await nextFrames(page);
  await page.keyboard.press('m');
  await page.locator('#plane-add').click();
  const planeId = (await state(page)).planes[0].id;

  // by the mid-plane (all vertices; normal +Z): 4000 / 4000
  await page.locator('#split-source').selectOption(`plane:${planeId}`);
  await expect.poll(async () => (await split(page))?.upper ?? 0).toBeCloseTo(4000, 2);
  expect((await split(page))!.lower).toBeCloseTo(4000, 2);
  await expect(page.locator('#split-ratio')).toHaveText('1.000');

  // by the closed curve at z = 2.5, normal toward the viewer above: 2000 above, 6000 below
  await page.locator('#split-source').selectOption('curve:ring');
  await expect.poll(async () => (await split(page))?.upper ?? 0).toBeCloseTo(2000, 2);
  let v = (await split(page))!;
  expect(v.lower).toBeCloseTo(6000, 2);
  expect(v.upper + v.lower).toBeCloseTo(8000, 2);
  await page.locator('#split-swap').click();
  await expect.poll(async () => (await split(page))?.upper ?? 0).toBeCloseTo(6000, 2);

  const [row] = parseCsv(await page.evaluate(() => window.lithicanalyst.exportMeasurementsCsvText()));
  expect(Number(row.volume_upper)).toBeCloseTo(6000, 2);
  expect(Number(row.volume_lower)).toBeCloseTo(2000, 2);
  expect(Number(row.volume_ratio)).toBeCloseTo(3, 5);

  // no split
  await page.locator('#split-source').selectOption('');
  await expect.poll(() => split(page)).toBeNull();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await split(page))?.upper ?? 0).toBeCloseTo(6000, 2);
  const saved = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(saved.split).toMatchObject({ source: 'curve', id: 'ring' });
  expect(saved.derived.split!.upper).toBeCloseTo(6000, 2);
});

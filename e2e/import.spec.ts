import { createHash } from 'node:crypto';
import { ROOF_TRIANGLES, ROOF_VERTICES, roofMesh, roofObj, roofPly, roofPoint, roofStl, type MeshFile, type Vec3 } from './fixtures/meshes';
import { dist, expect, fileMenu, loadMesh, openApp, state, test, toScreen, viewFromTop } from './helpers';

function bbox(positions: Float32Array): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  return { min, max };
}

const cases: Array<{ file: MeshFile; format: string; button: string }> = [
  { file: roofPly(), format: 'ply', button: '#btn-open' },
  { file: roofStl(), format: 'stl', button: '#btn-open' },
  { file: roofObj(), format: 'obj', button: '#empty-open' },
];

for (const { file, format, button } of cases) {
  test(`opens ${format.toUpperCase()} and keeps the original coordinates`, async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#empty-open')).toBeVisible();
    await expect(page.locator('#btn-save-project')).toBeDisabled();

    await loadMesh(page, file, button);
    await expect(page.locator('#empty-open')).toBeHidden();
    await expect(page.locator('#btn-save-project')).toBeEnabled();
    await expect(page.locator('#specimen-id')).toHaveValue('roof');
    await expect(page.locator('#specimen-meta')).toContainText(`${ROOF_VERTICES.toLocaleString('en-US')} vertices`);
    await expect(page.locator('#specimen-meta')).toContainText(`${ROOF_TRIANGLES.toLocaleString('en-US')} triangles`);

    const mesh = (await state(page)).mesh!;
    expect(mesh).toMatchObject({ fileName: file.name, format, fileSize: file.buffer.length, vertexCount: ROOF_VERTICES, triangleCount: ROOF_TRIANGLES });
    expect(mesh.sha256).toBe(createHash('sha256').update(file.buffer).digest('hex'));
    const box = bbox(roofMesh().positions);
    for (let k = 0; k < 3; k++) {
      expect(mesh.bboxMin[k]).toBeCloseTo(box.min[k], 3);
      expect(mesh.bboxMax[k]).toBeCloseTo(box.max[k], 3);
    }

    // the view is re-centred internally, but picking reports file coordinates
    await viewFromTop(page);
    for (const target of [roofPoint(-12, 15), roofPoint(14, 38)]) {
      const s = await toScreen(page, target);
      const hit = await page.evaluate(({ x, y }) => window.lithicanalyst.pick(x, y), s);
      expect(hit).not.toBeNull();
      expect(dist(hit!, target)).toBeLessThan(0.01);
    }
  });
}

test('refuses a file that is not a model', async ({ page }) => {
  await openApp(page);
  const chooser = page.waitForEvent('filechooser');
  await fileMenu(page, '#btn-open');
  await (await chooser).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a mesh') });
  await expect(page.locator('.toast-error')).toContainText('Unsupported file');
  expect((await state(page)).mesh).toBeNull();
  await expect(page.locator('#empty-open')).toBeVisible();
});

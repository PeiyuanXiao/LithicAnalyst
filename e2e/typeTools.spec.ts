import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { boxPly, boxPoint, type Vec3 } from './fixtures/meshes';
import { displayPanel, expect, fileMenu, loadMesh, openApp, openSection, specimenPanel, state, test, viewFromTop } from './helpers';

const offered = async (page: Page): Promise<string[]> => {
  await page.locator('#btn-export').click();
  const keys = await page.locator('.export-list input[data-key]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.key!));
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);
  return keys;
};

/** A closed curve round the sides of the box, the only thing the checks below need, given in a project file. */
function ringProject(ply: ReturnType<typeof boxPly>, type: 'core' | 'flake' | 'generic', old: boolean) {
  const corners: Vec3[] = [boxPoint(-20, -10, 2.5), boxPoint(20, -10, 2.5), boxPoint(20, 10, 2.5), boxPoint(-20, 10, 2.5)];
  return {
    format: 'lithicanalyst-project',
    formatVersion: 2,
    specimen: { id: 'box', annotator: '', unit: 'mm', notes: '', frame: null, type },
    mesh: { fileName: ply.name, sha256: createHash('sha256').update(ply.buffer).digest('hex') },
    annotations: { scars: [], curves: [{ id: 'ring', label: 'C1', anchors: corners, points: corners, anchorIndex: [0, 1, 2, 3], closed: true, attributes: { type: type === 'core' ? 'core_edge' : 'edge', note: '' }, ...(old ? { edgeAngle: true } : {}) }] },
    ...(old
      ? {
          workingEdges: [{ id: 'we1', label: 'E1', name: 'kept', curveId: 'ring', start: corners[0], end: corners[2], createdAt: '2026-11-01T00:00:00.000Z', modifiedAt: '2026-11-01T00:00:00.000Z' }],
          nextWorkingEdgeNumber: 2,
          split: { source: 'curve', id: 'ring', upHint: [0, 0, 1], swap: false },
          sharpEdge: { method: 'three_points', distance: 2, threshold: 40 },
        }
      : {}),
  };
}

async function openRing(page: Page, type: 'core' | 'flake' | 'generic', old = false): Promise<void> {
  const ply = boxPly();
  await openApp(page, type);
  await loadMesh(page, ply);
  const chooser = page.waitForEvent('filechooser');
  await fileMenu(page, '#btn-open-project');
  await (await chooser).setFiles({ name: 'ring.lithicanalyst.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(ringProject(ply, type, old))) });
  await expect.poll(async () => (await state(page)).curves.length).toBe(1);
  expect((await state(page)).specimen.type).toBe(type);
  await viewFromTop(page);
}

const setType = async (page: Page, type: 'core' | 'flake' | 'generic'): Promise<void> => {
  await specimenPanel(page);
  await page.locator('#specimen-type').selectOption(type);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).specimen.type).toBe(type);
};

const helpText = async (page: Page): Promise<string> => {
  await page.locator('#btn-help').click();
  const text = (await page.getByRole('dialog').textContent()) ?? '';
  await page.keyboard.press('Escape');
  return text;
};

test('a core: no edge angles and no working edges anywhere; its volume split stays', async ({ page }) => {
  await openRing(page, 'core');
  await expect(page.locator('#mode-working-edge')).toBeHidden();
  await page.keyboard.press('w');
  await expect(page.locator('#mode-select')).toHaveAttribute('aria-checked', 'true');
  expect(await helpText(page)).not.toContain('Working edge');
  await openSection(page, 'curves');
  await page.evaluate(() => window.lithicanalyst.selectForTest('ring'));
  await expect(page.locator('#curve-field-type-core_edge')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#curve-edge-angle')).toBeHidden();
  await expect(page.locator('#sec-working-edges')).toBeHidden();

  await page.locator('#app-mode-measure').click();
  await expect(page.locator('#sec-edge-angle')).toBeHidden();
  await expect(page.locator('#sec-split')).toBeVisible();
  await page.locator('#split-source').selectOption('curve:ring');
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.volumeSplit()?.upper ?? null)).not.toBeNull();
  await expect(page.locator('#split-upper')).toBeVisible();
  const keys = await offered(page);
  for (const key of ['edge-angles', 'retouch-angles', 'edge-sharp', 'working-edges', 'flakes']) expect(keys).not.toContain(key);
  for (const key of ['measurements', 'manual', 'planes']) expect(keys).toContain(key);
  // nothing computed for what it does not have
  expect(await page.evaluate(() => window.lithicanalyst.edgeAngles('ring'))).toBeNull();
  expect(await page.evaluate(() => window.lithicanalyst.workingEdges().rows)).toEqual([]);
});

test('a flake: no volume split; its edge angles and working edges stay', async ({ page }) => {
  await openRing(page, 'flake');
  await expect(page.locator('#mode-working-edge')).toBeVisible();
  expect(await helpText(page)).toContain('Working edge');
  await page.evaluate(() => window.lithicanalyst.selectForTest('ring'));
  await openSection(page, 'curves');
  await expect(page.locator('#curve-edge-angle')).toBeChecked();
  await page.locator('#app-mode-measure').click();
  await expect(page.locator('#sec-split')).toBeHidden();
  await expect(page.locator('#sec-edge-angle')).toBeVisible();
  // the column stays, with nothing in it
  const row = await page.evaluate(() => window.lithicanalyst.exportMeasurementsCsvText());
  const [head, values] = row.trim().split('\n').map((l) => l.split(','));
  expect(head).toContain('volume_upper');
  expect(values[head.indexOf('volume_upper')]).toBe('');
  const keys = await offered(page);
  for (const key of ['edge-angles', 'edge-sharp', 'working-edges', 'flakes', 'measurements']) expect(keys).toContain(key);
});

test('a generic specimen: none of them; sections and fitted planes stay', async ({ page }) => {
  await openRing(page, 'generic');
  await expect(page.locator('#mode-working-edge')).toBeHidden();
  await page.locator('#app-mode-measure').click();
  for (const id of ['edge-angle', 'split']) await expect(page.locator(`#sec-${id}`)).toBeHidden();
  await expect(page.locator('#sec-planes')).toBeVisible();
  await page.locator('#plane-add').click();
  await expect.poll(async () => (await state(page)).planes.length).toBe(1);
  await expect(page.locator('#sec-split')).toBeHidden();
  await page.locator('#app-mode-present').click();
  await expect(page.locator('#present-tool-section')).toBeVisible();
  await expect(page.locator('#sec-sections')).toBeVisible();
});

test('a file with what its type no longer has: kept when written again, shown on a flake', async ({ page }) => {
  await openRing(page, 'core', true);
  const kept = async () => {
    const f = await page.evaluate(() => window.lithicanalyst.projectJson());
    return { edge: f.annotations.curves[0].edgeAngle, working: f.workingEdges.map((e) => [e.id, e.label, e.name]), next: f.nextWorkingEdgeNumber, split: f.split, sharp: f.sharpEdge };
  };
  const want = { edge: true, working: [['we1', 'E1', 'kept']], next: 2, split: { source: 'curve', id: 'ring', upHint: [0, 0, 1], swap: false }, sharp: { method: 'three_points', distance: 2, threshold: 40 } };
  expect(await kept()).toEqual(want);
  await expect(page.locator('#sec-working-edges')).toBeHidden();
  await page.locator('#app-mode-measure').click();
  await expect(page.locator('#sec-edge-angle')).toBeHidden();
  await expect(page.locator('#sec-split')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.volumeSplit()?.upper ?? null)).not.toBeNull();

  // as a generic specimen: the split gone from the view and the tables, and from nothing else
  await setType(page, 'generic');
  await expect(page.locator('#sec-split')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.volumeSplit())).toBeNull();
  expect(await kept()).toEqual(want);

  // as a flake: its edge angles and its working edge, as they were
  await setType(page, 'flake');
  await expect(page.locator('#sec-edge-angle')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.edgeAngles('ring')?.stations.length ?? 0)).toBeGreaterThan(50);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.workingEdges().rows.map((r) => r.label))).toEqual(['E1']);
  await page.locator('#app-mode-annotate').click();
  await expect(page.locator('#sec-working-edges')).toBeVisible();
  await expect(page.locator('#working-edge-list li')).toContainText('kept');
  expect(await kept()).toEqual(want);

  // and back
  await setType(page, 'core');
  await page.locator('#app-mode-measure').click();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.volumeSplit()?.upper ?? null)).not.toBeNull();
  await expect(page.locator('#sec-edge-angle')).toBeHidden();
  expect(await kept()).toEqual(want);
});

test('a tool of a type that goes with it: the tool and what is selected let go', async ({ page }) => {
  await openRing(page, 'flake', true);
  await page.keyboard.press('w');
  await expect(page.locator('#mode-working-edge')).toHaveAttribute('aria-checked', 'true');
  await setType(page, 'core');
  await expect(page.locator('#mode-select')).toHaveAttribute('aria-checked', 'true');
  await setType(page, 'flake');
  await page.evaluate(() => window.lithicanalyst.selectForTest('we1'));
  await setType(page, 'generic');
  expect(await page.evaluate(() => window.lithicanalyst.selection())).toBeNull();
  await displayPanel(page);
  await page.keyboard.press('Escape');
});

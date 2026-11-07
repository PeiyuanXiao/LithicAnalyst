import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { addCurve, addLandmark, addRegion, placePlatformEnd, setCurveAttribute, setSpecimenType, setTechnicalAxis } from '../src/core/actions';
import { frameMatrix } from '../src/core/frame';
import { serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import { bicone, flakeT1, mapped, rigid, T1, type Mesh } from '../tests/meshes';
import { toBinaryPly, type Vec3 } from './fixtures/meshes';
import { curveClick, exportAvailable, expect, folderPaths, folderText, mockFolder, nextFrames, openApp, openMockFolder, openSection, parseCsv, state, test, toScreen } from './helpers';

const SHOTS = 'test-results/24';
const gm = (page: Page) => page.evaluate(() => window.lithicanalyst.gm());
const template = (page: Page) => page.evaluate(() => window.lithicanalyst.gmTemplate());
const drawn = (page: Page) => page.evaluate(() => window.lithicanalyst.gmDrawn());
const meshName = (page: Page) => page.evaluate(() => window.lithicanalyst.state().mesh?.fileName ?? null);
const missingCodes = (page: Page) => page.locator('#gm-missing li').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.code));
/** Whether the export dialog lists a file at all. */
async function offered(page: Page, key: string): Promise<boolean> {
  await page.locator('#btn-export').click();
  await expect(page.locator('.export-list')).toBeVisible();
  const n = await page.locator(`.export-list input[data-key="${key}"]`).count();
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);
  return n > 0;
}
const shape = (points: Vec3[], closed: boolean) => ({ anchors: points, points, anchorIndex: points.map((_, i) => i), closed });

/** A model in a folder, with its project of another session (its checksum binds it to the model). */
function inFolder(name: string, mesh: Pick<Mesh, 'positions' | 'index'>, annotate: (s: ProjectStore) => void): Record<string, Buffer> {
  const buffer = toBinaryPly({ positions: mesh.positions, index: mesh.index } as never);
  const s = new ProjectStore({
    ...emptyProject(),
    mesh: { fileName: name, format: 'ply', fileSize: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex'), vertexCount: mesh.positions.length / 3, triangleCount: mesh.index.length / 3, bboxMin: [0, 0, 0], bboxMax: [0, 0, 0] },
  });
  s.state.specimen.id = name.replace(/\.ply$/, '');
  s.state.specimen.unit = 'mm';
  annotate(s);
  return { [name]: buffer, [`LithicAnalyst/projects/${name}.lithicanalyst.json`]: Buffer.from(JSON.stringify(serializeProject(s.state, '0.1.0'))) };
}

const SEGMENTS = 48;
/** A double cone, a little flattened in Y; the rim its widest. */
const cone = (r: number, up: number, down: number) => {
  const f = (p: Vec3): Vec3 => [p[0], 0.8 * p[1], p[2]];
  const m = mapped(bicone(r, up, down, SEGMENTS, 8), f);
  const round = (at: number, z: number): Vec3[] => Array.from({ length: SEGMENTS }, (_, j) => f([at * Math.cos((2 * Math.PI * j) / SEGMENTS), at * Math.sin((2 * Math.PI * j) / SEGMENTS), z]));
  return { m, f, round, rim: round(r, 0) };
};

/** A generic specimen: two landmarks and a closed curve on the rim, the regions on either side of it. `small`: the upper one kept to a little cap round the apex. */
function generic(name: string, r: number, up: number, down: number, opts: { small?: boolean; extra?: string } = {}): Record<string, Buffer> {
  const { m, f, round, rim } = cone(r, up, down);
  return inFolder(name, m, (s) => {
    setSpecimenType(s, 'generic');
    addLandmark(s, rim[0], 'east');
    addLandmark(s, rim[SEGMENTS / 4], 'north');
    if (opts.extra) addLandmark(s, rim[SEGMENTS / 2], opts.extra);
    setCurveAttribute(s, addCurve(s, shape(rim, true)).id, 'type', 'rim');
    if (opts.small) setCurveAttribute(s, addCurve(s, shape(round((2 * r) / 8, (up * 6) / 8), true)).id, 'type', 'ring');
    addRegion(s, f([(0.5 * r) / 8, 0, up * (1 - 0.5 / 8)]), 'up', null);
    addRegion(s, f([(4 * r) / 8, 0, -down * (1 - 4 / 8)]), 'down', null);
  });
}

/** T1 as a flake, moved by `f`, with all that its points go by. */
function flake(name: string, f: (p: Vec3) => Vec3): Record<string, Buffer> {
  return inFolder(name, mapped(flakeT1(), f), (s) => {
    setSpecimenType(s, 'flake');
    const o = f([0, 0, 0]);
    const dir = (a: Vec3): Vec3 => {
      const b = f(a);
      const v: Vec3 = [b[0] - o[0], b[1] - o[1], b[2] - o[2]];
      const l = Math.hypot(...v);
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    setTechnicalAxis(s, { start: o, end: f(T1.A), startNormal: dir([0, 0, 1]), endNormal: dir([0, 0, 1]), matrix: frameMatrix({ origin: o, x: dir([1, 0, 0]), y: dir([0, 1, 0]), z: dir([0, 0, 1]) }), failure: null });
    const corner = (x: number): Vec3 => f([x, -2, 10]);
    setCurveAttribute(s, addCurve(s, shape([f([-15, 0, 0]), f([0, 0, 0]), f([15, 0, 0]), corner(15), corner(-15)], true)).id, 'type', 'platform_outline');
    for (const x of [-15, 15]) placePlatformEnd(s, f([x, 0, 0]));
    setCurveAttribute(s, addCurve(s, shape(([[-15, 0, 0], [-15, 60, 0], [15, 60, 0], [15, 0, 0]] as Vec3[]).map(f), false)).id, 'type', 'edge');
  });
}

/** The lists filled in through the panel: two landmarks, the closed curve, two patches. */
async function fillLists(page: Page): Promise<void> {
  await openSection(page, 'gm');
  await page.locator('#gm-add-landmark').click();
  await expect(page.locator('#gm-landmark-0-name')).toHaveValue('east');
  await page.locator('#gm-add-landmark').click();
  await expect(page.locator('#gm-landmark-1-name')).toHaveValue('north');
  await page.locator('#gm-add-curve').click();
  await expect(page.locator('#gm-curve-0-type')).toHaveValue('rim');
  await page.locator('#gm-curve-0-closed').check();
  await expect(page.locator('#gm-curve-0-via')).toHaveValue('north');
  await page.locator('#gm-add-patch').click();
  await page.locator('#gm-add-patch').click();
  await expect(page.locator('#gm-patch-0-type')).toHaveValue('up');
  await expect(page.locator('#gm-patch-1-type')).toHaveValue('down');
  for (const [i, n] of [[0, 40], [1, 30]]) {
    await page.locator(`#gm-patch-${i}-count`).fill(String(n));
    await page.keyboard.press('Enter');
    await expect(page.locator(`#gm-patch-${i}-count`)).toHaveValue(String(n));
  }
}

const ROWS = 2 + 18 + 40 + 30;

test('a folder of generic specimens: the lists, a template, its points on the others, a summary with what R needs', async ({ page }) => {
  await mkdir(SHOTS, { recursive: true });
  await mockFolder(page, 'dig', { ...generic('a.ply', 30, 8, 5), ...generic('b.ply', 33, 7, 6), ...generic('c.ply', 27, 9, 4, { small: true, extra: 'only_c' }) });
  await openApp(page, 'generic');
  await openMockFolder(page);
  await expect.poll(() => meshName(page)).toBe('a.ply');
  // nothing asked for yet: no points, no pill
  await openSection(page, 'gm');
  await expect(page.locator('#status-gm')).toHaveCount(0);
  await expect(page.locator('#gm-template-set')).toBeDisabled();
  expect(await gm(page)).toBeNull();

  await fillLists(page);
  await expect.poll(() => missingCodes(page)).toEqual(['no_template']);
  await expect(page.locator('#status-gm')).toHaveText('○GM');
  await expect(page.locator('#gm-total')).toContainText(String(ROWS));
  // the file has it, in its order
  const FILE = 'LithicAnalyst/gm-config.json';
  await expect.poll(async () => JSON.parse((await folderText(page, FILE)) ?? '{}').patches?.length).toBe(2);
  // a row moved goes with the order of the export; and back
  await page.locator('#gm-patch-1-up').click();
  await expect(page.locator('#gm-patch-0-type')).toHaveValue('down');
  await page.locator('#gm-patch-1-up').click();
  await expect(page.locator('#gm-patch-0-type')).toHaveValue('up');

  // what lacks stops it being the template, and it says what
  await page.locator('#gm-add-landmark').click();
  await page.locator('#gm-landmark-2-name').selectOption('only_c');
  await page.locator('#gm-template-set').click();
  await expect(page.locator('.toast-warn')).toContainText('only_c');
  expect(await template(page)).toBeNull();
  await page.locator('#gm-landmark-2-remove').click();
  await expect(page.locator('#gm-landmark-2-name')).toHaveCount(0);

  // the template: its own points as laid
  await page.locator('#gm-template-set').click();
  await expect.poll(async () => (await template(page))?.patches.map((p) => p.points.length)).toEqual([40, 30]);
  await expect(page.locator('#gm-template-name')).toContainText('a.ply');
  await expect(page.locator('#gm-template-relay')).toBeVisible();
  await expect.poll(async () => (await gm(page))?.complete ?? false).toBe(true);
  expect((await gm(page))!.rows.length).toBe(ROWS);
  await expect(page.locator('#status-gm')).toHaveText('✓GM');
  await expect(page.locator('.ws-row[data-index="0"] .ws-template')).toBeVisible();
  await expect(page.locator('.ws-row[data-index="0"] .ws-gm')).toContainText('✓');

  // again, by another seed; nothing is drawn until it is asked for
  const first = await template(page);
  expect(first!.seed).toBe(1);
  await expect(page.locator('#gm-show-surface')).not.toBeChecked();
  expect((await drawn(page))!.shown).toBe(false);
  await page.locator('#gm-template-relay').click();
  await expect.poll(async () => (await template(page))?.seed).toBe(2);
  expect((await template(page))!.patches[0].points).not.toEqual(first!.patches[0].points);
  await page.locator('#gm-show-surface').check();
  await expect.poll(() => drawn(page)).toEqual({ shown: true, points: 70, flagged: 0 });
  await page.evaluate(() => window.lithicanalyst.view([0.4, -0.5, 0.8], [0, 1, 0]));
  await nextFrames(page);
  await page.screenshot({ path: `${SHOTS}/template-points.png` });
  await page.locator('#sec-gm').screenshot({ path: `${SHOTS}/panel.png` });

  // the next: its points passed on, on its own regions, nothing to check
  await page.locator('#workspace-next').click();
  await expect.poll(() => meshName(page)).toBe('b.ply');
  await expect.poll(async () => (await gm(page))?.complete ?? false).toBe(true);
  const b = (await gm(page))!;
  expect(b.rows.length).toBe(ROWS);
  expect(b.flagged).toEqual([]);
  expect(b.rows.filter((r) => r.name === 'up' && r.kind === 'surface').every((r) => r.point[2] >= -1e-3)).toBe(true);
  expect(b.rows.filter((r) => r.name === 'down' && r.kind === 'surface').every((r) => r.point[2] <= 1e-3)).toBe(true);
  await expect(page.locator('#gm-template-relay')).toHaveCount(0);
  await expect(page.locator('#gm-template-set')).toBeVisible();
  await expect.poll(() => drawn(page)).toEqual({ shown: true, points: 70, flagged: 0 });
  await page.evaluate(() => window.lithicanalyst.view([0.4, -0.5, 0.8], [0, 1, 0]));
  await nextFrames(page);
  await page.screenshot({ path: `${SHOTS}/transferred.png` });
  // they go into its file, with what they were made from
  const stored = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(stored.derived.gm?.rows.length).toBe(ROWS);
  expect(stored.derived.gm?.key).toBeTruthy();
  expect(stored.derived.gm?.config.template).toMatchObject({ file: 'a.ply', seed: 2, points: 70 });
  expect(stored.gm.template?.patches[0].points).toHaveLength(40);

  // a summary from here: the third, never opened, in the worker
  await page.locator('#btn-export').click();
  await page.locator('#export-scope-folder').click();
  await page.locator('.modal [data-choice="export"]').click();
  const find = async (name: string) => (await folderPaths(page)).find((p) => new RegExp(`^LithicAnalyst/exports/[^/]+/${name.replace('.', '\\.')}$`).test(p)) ?? null;
  await expect.poll(() => find('manifest.json'), { timeout: 60_000 }).not.toBeNull();
  const text = async (name: string) => (await folderText(page, (await find(name))!))!;
  const lines = (await text('gm_landmarks.csv')).replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  expect(lines[0]).toBe('specimen_id,index,name,kind,set_id,x,y,z,set_index,flagged');
  const rows = parseCsv(await text('gm_landmarks.csv'));
  expect(rows.length).toBe(3 * ROWS);
  const of = (id: string) => rows.filter((r) => r.specimen_id === id);
  for (const id of ['a', 'b', 'c']) {
    expect(of(id).length).toBe(ROWS);
    expect(of(id).map((r) => r.kind).slice(0, 3)).toEqual(['fixed', 'fixed', 'curve']);
    expect(of(id).filter((r) => r.kind === 'surface').map((r) => r.name)).toEqual([...new Array(40).fill('up'), ...new Array(30).fill('down')]);
    expect(of(id).filter((r) => r.name === 'rim').map((r) => r.set_index)).toEqual(Array.from({ length: 18 }, (_, i) => String(i + 1)));
  }
  expect(of('a').every((r) => r.flagged === '0')).toBe(true);
  expect(of('b').every((r) => r.flagged === '0')).toBe(true);
  // the little cap: what was passed on there crowds, and is marked
  const marked = of('c').filter((r) => r.flagged === '1');
  expect(marked.length).toBeGreaterThan(10);
  expect(marked.every((r) => r.name === 'up')).toBe(true);
  expect(parseCsv(await text('gm_curves.csv')).every((r) => of('a')[Number(r.slide) - 1].kind === 'curve')).toBe(true);
  expect(parseCsv(await text('gm_smvector.csv')).map((r) => r.index)).toEqual(parseCsv(await text('gm_curves.csv')).map((r) => r.slide));
  expect((await text('gm_outlines.csv')).split(/\r?\n/)[0]).toBe('outline,index');
  const surp = parseCsv(await text('gm_surp.csv'));
  expect(surp.length).toBe(70);
  expect(surp.every((r) => of('a')[Number(r.index) - 1].kind === 'surface')).toBe(true);
  expect(parseCsv(await text('gm_models.csv'))).toEqual([{ specimen_id: 'a', model: 'a.ply' }, { specimen_id: 'b', model: 'b.ply' }, { specimen_id: 'c', model: 'c.ply' }]);
  expect((await text('gm_landmarks.tps')).match(/LM3=/g)!.length).toBe(3);
  const manifest = JSON.parse(await text('manifest.json'));
  expect(manifest.gm).toEqual({ surfaceMethod: 'template', configVersion: 2, template: 'a.ply', seed: 2 });
  expect(manifest.gmSkipped ?? []).toEqual([]);
  expect(manifest.gmIncomplete ?? []).toEqual([]);
  // the points themselves are in the configuration, not in every manifest
  expect(manifest.parameters.gm.template).toMatchObject({ file: 'a.ply', points: 70 });
  expect(manifest.parameters.gm.template.patches).toBeUndefined();
  await expect.poll(() => meshName(page)).toBe('b.ply');

  // opened, the third has what the worker made, and says what is to be checked
  await page.locator('#workspace-next').click();
  await expect.poll(() => meshName(page)).toBe('c.ply');
  await expect.poll(async () => (await gm(page))?.flagged?.length ?? 0).toBeGreaterThan(10);
  const c = (await gm(page))!;
  expect(c.complete).toBe(true);
  expect(c.flagged!.length).toBe(marked.length);
  of('c').forEach((r, i) => {
    for (const [k, v] of [r.x, r.y, r.z].entries()) expect(Math.abs(Number(v) - c.rows[i].point[k])).toBeLessThan(1e-3);
  });
  await expect(page.locator('#gm-flagged')).toContainText(String(c.flagged!.length));
  await expect(page.locator('#status-gm')).toHaveText('○GM');
  await page.locator('#status-gm').hover();
  await expect(page.locator('.tip')).toContainText(String(c.flagged!.length));
  await page.mouse.move(640, 300);
  await expect.poll(() => drawn(page)).toEqual({ shown: true, points: 70, flagged: c.flagged!.length });
  await expect(page.locator('.ws-row[data-index="2"] .ws-gm')).toContainText('○');
  // the one before, left without an edit, still says how it came out
  await expect(page.locator('.ws-row[data-index="1"] .ws-gm')).toContainText('✓');
  await page.evaluate(() => window.lithicanalyst.view([0.4, -0.5, 0.8], [0, 1, 0]));
  await nextFrames(page);
  await page.screenshot({ path: `${SHOTS}/flagged.png` });
  // the pill leads to the panel
  await page.locator('#status-gm').click();
  await expect(page.locator('#gm-flagged')).toBeInViewport();
});

test('a flake by a template: the same rows as ever by the grid, and back; the files say which', async ({ page }) => {
  await mkdir(SHOTS, { recursive: true });
  await mockFolder(page, 'dig', { ...flake('a.ply', (p) => p), ...flake('b.ply', (p) => rigid([1, -2, 1], 40, [20, -30, 15])([1.05 * p[0], 1.05 * p[1], 1.05 * p[2]])) });
  await openApp(page, 'flake');
  await openMockFolder(page);
  await expect.poll(() => meshName(page)).toBe('a.ply');
  await openSection(page, 'gm');
  await expect.poll(async () => (await gm(page))?.complete ?? false).toBe(true);
  const grid = (await gm(page))!;
  expect(grid.method).toBe('grid');
  await expect(page.locator('#gm-method-grid')).toHaveAttribute('aria-checked', 'true');
  expect(await exportAvailable(page, 'gm-csv')).toBe(true);
  expect(await offered(page, 'gm-smvector')).toBe(false);

  await page.locator('#gm-method-template').click();
  await expect(page.locator('#gm-patch-0-count')).toHaveValue('150');
  await expect(page.locator('#gm-patch-1-count')).toHaveValue('150');
  await expect(page.locator('#gm-patch-2-count')).toHaveValue('32');
  await expect(page.locator('#gm-ventral-rows')).toHaveCount(0);
  await expect.poll(() => missingCodes(page)).toEqual(['no_template']);
  await page.locator('#gm-template-set').click();
  await expect.poll(async () => (await gm(page))?.complete ?? false, { timeout: 30_000 }).toBe(true);
  const own = (await gm(page))!;
  expect(own.method).toBe('template');
  expect(own.surfaces.length).toBe(332);
  // as many points, and the fixed and curve points in the same order as by the grid
  expect(own.rows.length).toBe(grid.rows.length);
  const notSurface = (r: { kind: string }) => r.kind !== 'surface';
  expect(own.rows.filter(notSurface).map((r) => r.kind)).toEqual(grid.rows.filter(notSurface).map((r) => r.kind));
  own.rows.filter(notSurface).forEach((r, i) => expect(r.point).toEqual(grid.rows.filter(notSurface)[i].point));

  await page.locator('#workspace-next').click();
  await expect.poll(() => meshName(page)).toBe('b.ply');
  await expect.poll(async () => (await gm(page))?.complete ?? false, { timeout: 30_000 }).toBe(true);
  const b = (await gm(page))!;
  expect(b.method).toBe('template');
  expect(b.surfaces.length).toBe(332);
  expect(b.flagged).toEqual([]);
  await page.locator('#gm-show-surface').check();
  await expect.poll(() => drawn(page)).toEqual({ shown: true, points: 332, flagged: 0 });
  await page.screenshot({ path: `${SHOTS}/flake-template.png` });
  const header = async () => (await page.evaluate(() => window.lithicanalyst.exportGmText('csv'))).split(/\r?\n/)[0];
  expect(await header()).toBe('specimen_id,index,name,kind,set_id,x,y,z,set_index,flagged');
  expect(await offered(page, 'gm-smvector')).toBe(true);

  // back to the grid, it is as it was
  await page.locator('#gm-method-grid').click();
  await expect.poll(async () => (await gm(page))?.method).toBe('grid');
  await expect(page.locator('#gm-ventral-rows')).toBeVisible();
  expect(await header()).toBe('specimen_id,index,name,kind,set_id,x,y,z');
  expect(await offered(page, 'gm-smvector')).toBe(false);
  await expect(page.locator('#gm-show-surface')).toBeHidden();
  // what was laid is kept for going back
  expect((await template(page))?.file).toBe('a.ply');
});

test('a folder from before the template: an old configuration in its file and old points in a flake\'s project open as ever', async ({ page }) => {
  const grids = { fixed: { pop: true, platform_left: true, platform_right: true }, edge: { on: true, points: 50 }, platformOutline: { on: true, points: 10 }, ventral: { on: true, rows: 15, cols: 10 }, dorsal: { on: true, rows: 15, cols: 10 }, platform: { on: true, rows: 4, cols: 8 } };
  const later = flake('z.ply', (p) => p);
  const path = 'LithicAnalyst/projects/z.ply.lithicanalyst.json';
  const saved = JSON.parse(later[path].toString());
  saved.derived.gm = { config: grids, complete: true, missing: [], rows: [{ index: 1, name: 'pop', kind: 'fixed', setId: '', point: [0, 0, 0] }], curves: [], surfaces: [] };
  await mockFolder(page, 'dig', {
    ...generic('a.ply', 30, 8, 5),
    ...later,
    [path]: Buffer.from(JSON.stringify(saved)),
    'LithicAnalyst/gm-config.json': Buffer.from(JSON.stringify({ ...grids, platform: { on: true, rows: 7, cols: 10 } })),
  });
  await openApp(page, 'generic');
  await openMockFolder(page);
  await expect.poll(() => meshName(page)).toBe('a.ply');
  await expect(page.locator('.toast-error')).toHaveCount(0);
  await expect(page.locator('#mode-select')).toBeVisible();
  // the old points are of another configuration: not done, and nothing breaks for it
  await expect(page.locator('.ws-row[data-index="1"] .ws-gm')).toContainText('○');
  await page.locator('#workspace-next').click();
  await expect.poll(() => meshName(page)).toBe('z.ply');
  expect((await state(page)).gm.platform.rows).toBe(7);
  await expect.poll(async () => (await gm(page))?.method).toBe('grid');
  // no specimen of it went by a template, and the manifest says so
  await page.locator('#btn-export').click();
  await page.locator('#export-scope-folder').click();
  await page.locator('.modal [data-choice="export"]').click();
  const manifestPath = async () => (await folderPaths(page)).find((p) => /^LithicAnalyst\/exports\/[^/]+\/manifest\.json$/.test(p)) ?? null;
  await expect.poll(manifestPath, { timeout: 60_000 }).not.toBeNull();
  expect(JSON.parse((await folderText(page, (await manifestPath())!))!).gm).toEqual({ surfaceMethod: 'grid', configVersion: 2, template: null, seed: null });
});

test('the template gone from the folder: nothing is passed on and it says why; changed: it says so and lays nothing by itself', async ({ page }) => {
  const files = { ...generic('a.ply', 30, 8, 5), ...generic('b.ply', 33, 7, 6) };
  await mockFolder(page, 'dig', files);
  await openApp(page, 'generic');
  await openMockFolder(page);
  await expect.poll(() => meshName(page)).toBe('a.ply');
  await fillLists(page);
  await page.locator('#gm-template-set').click();
  await expect.poll(async () => (await gm(page))?.complete ?? false).toBe(true);
  const laid = await template(page);

  // a curve more: the regions may have changed
  await page.evaluate(() => window.lithicanalyst.view([0, 0, 1], [0, 1, 0]));
  await nextFrames(page);
  await expect(page.locator('#gm-template-changed')).toHaveCount(0);
  await page.keyboard.press('p');
  for (const p of [[8, 0, 8 * (1 - 8 / 30)], [8, 6, 8 * (1 - 10 / 30)]] as Vec3[]) await curveClick(page, await toScreen(page, p), { shift: true });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).curves.length).toBe(2);
  await page.keyboard.press('v');
  await openSection(page, 'gm');
  await expect(page.locator('#gm-template-changed')).toBeVisible();
  expect(await template(page)).toEqual(laid);
  await page.locator('#gm-template-relay').click();
  await expect.poll(async () => (await template(page))?.seed).toBe(laid!.seed + 1);
  await expect(page.locator('#gm-template-changed')).toHaveCount(0);

  // the file gone: as a folder that no longer holds the template opens
  const config = (await folderText(page, 'LithicAnalyst/gm-config.json'))!;
  const elsewhere = await page.context().newPage();
  await mockFolder(elsewhere, 'dig', { ...generic('b.ply', 33, 7, 6), 'LithicAnalyst/gm-config.json': Buffer.from(config) });
  await openApp(elsewhere, 'generic');
  await openMockFolder(elsewhere);
  await expect.poll(() => meshName(elsewhere)).toBe('b.ply');
  await openSection(elsewhere, 'gm');
  await expect.poll(() => missingCodes(elsewhere)).toEqual(['template_missing']);
  const r = (await gm(elsewhere))!;
  expect(r.complete).toBe(false);
  expect(r.rows.filter((x) => x.kind === 'surface').every((x) => x.missing)).toBe(true);
  // the rest of what it has stands
  expect(r.rows.filter((x) => x.kind !== 'surface').every((x) => !x.missing)).toBe(true);
  await elsewhere.close();
});

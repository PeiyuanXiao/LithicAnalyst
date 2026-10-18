import type { Download, Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boxPly, boxPoint, spherePly } from './fixtures/meshes';
import { dragArrow, expect, fileMenu, openApp, openSection, parseCsv, setAnnotator, state, test, viewFromTop } from './helpers';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const meshName = (page: Page) => page.evaluate(() => window.lithicanalyst.state().mesh?.fileName ?? null);

/** A project file of another session for a model (its checksum binds it to the model). */
function project(name: string, buffer: Buffer, annotator: string, scars: unknown[] = []): string {
  return JSON.stringify({
    format: 'lithicanalyst-project',
    formatVersion: 2,
    specimen: { id: name.replace(/\.ply$/, ''), annotator, unit: 'mm', notes: '', frame: null },
    mesh: { fileName: name, format: 'ply', fileSize: buffer.length, sha256: sha(buffer), vertexCount: 0, triangleCount: 0, bboxMin: [0, 0, 0], bboxMax: [0, 0, 0] },
    annotations: { scars },
  });
}

const scar = { id: 'kept-1', label: 'S1', vector: { start: boxPoint(-10, 0, 5), end: boxPoint(10, 0, 5) }, attributes: {} };

test('a read-only folder: models in turn with their projects, batch results downloaded', async ({ page }, info) => {
  const dir = info.outputPath('flakes');
  await mkdir(dir, { recursive: true });
  const box = boxPly().buffer, sphere = spherePly().buffer;
  await writeFile(join(dir, 'box.ply'), box);
  await writeFile(join(dir, 'nodule.ply'), sphere);
  await writeFile(join(dir, 'box.lithicanalyst.json'), project('box.ply', box, 'Ann', [scar]));
  await writeFile(join(dir, 'notes.txt'), 'ignored');
  // no folder picker here: the folder is read from a directory upload
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { value: undefined }));
  await openApp(page);
  await expect(page.locator('#sec-workspace')).toBeHidden();
  const chooser = page.waitForEvent('filechooser');
  await fileMenu(page, '#btn-open-folder');
  await (await chooser).setFiles(dir);
  await expect.poll(() => meshName(page)).toBe('box.ply');
  await expect(page.locator('#sec-workspace')).toBeVisible();
  await expect(page.locator('#workspace-name')).toHaveText('flakes');
  await expect(page.locator('#workspace-readonly')).toBeVisible();
  await expect.poll(async () => (await state(page)).scars.map((s) => s.id)).toEqual(['kept-1']);
  expect((await state(page)).specimen.annotator).toBe('Ann');
  await expect(page.locator('#workspace-mesh option')).toHaveText(['1 / 2 · box.ply', '2 / 2 · nodule.ply']);

  await page.keyboard.press('PageDown');
  await expect.poll(() => meshName(page)).toBe('nodule.ply');
  expect((await state(page)).scars).toEqual([]);
  await expect(page.locator('#workspace-next')).toBeDisabled();
  await page.locator('#workspace-prev').click();
  await expect.poll(() => meshName(page)).toBe('box.ply');
  await expect.poll(async () => (await state(page)).scars).toHaveLength(1);

  // measure all: the merged files are downloaded
  const downloads: Download[] = [];
  page.on('download', (d) => downloads.push(d));
  await page.locator('#batch-measure').click();
  await expect.poll(() => downloads.length).toBe(2);
  expect(downloads.map((d) => d.suggestedFilename()).sort()).toEqual(['flakes_measurements.csv', 'flakes_scar_vectors.csv']);
  const measurements = await readFile((await downloads.find((d) => d.suggestedFilename() === 'flakes_measurements.csv')!.path())!, 'utf8');
  const rows = parseCsv(measurements);
  expect(rows.map((r) => [r.specimen_id, r.closed])).toEqual([
    ['box', 'true'],
    ['nodule', 'true'],
  ]);
  expect(Number(rows[0].length)).toBeCloseTo(40, 3);
  expect(Number(rows[0].volume)).toBeCloseTo(8000, 1);
  await expect(page.locator('#batch-progress')).toBeHidden();
});

test('a writable folder: projects saved next to the models, batch figures and measurements written into it', async ({ page }) => {
  const box = boxPly().buffer, sphere = spherePly().buffer;
  const files: Record<string, string> = {
    'box.ply': box.toString('base64'),
    'nodule.ply': sphere.toString('base64'),
    'box.bo.lithicanalyst.json': Buffer.from(project('box.ply', box, 'Bo')).toString('base64'),
    'nodule.lithicanalyst.json': Buffer.from(project('nodule.ply', sphere, 'Ann')).toString('base64'),
    'nodule.bo.lithicanalyst.json': Buffer.from(project('nodule.ply', sphere, 'Bo')).toString('base64'),
  };
  // an in-memory folder behind the File System Access API
  await page.addInitScript((initial: Record<string, string>) => {
    const folder = new Map<string, Uint8Array>(Object.entries(initial).map(([n, b]) => [n, Uint8Array.from(atob(b), (c) => c.charCodeAt(0))]));
    (window as unknown as { __folder: Map<string, Uint8Array> }).__folder = folder;
    const handle = (name: string) => ({
      kind: 'file' as const,
      name,
      getFile: async () => new File([folder.get(name)! as BlobPart], name),
      createWritable: async () => {
        const parts: Uint8Array[] = [];
        return {
          write: async (d: string | Uint8Array) => void parts.push(typeof d === 'string' ? new TextEncoder().encode(d) : d),
          close: async () => {
            const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
            let o = 0;
            for (const p of parts) out.set(p, (o += p.length) - p.length);
            folder.set(name, out);
          },
        };
      },
    });
    Object.defineProperty(window, 'showDirectoryPicker', {
      value: async () => ({
        kind: 'directory',
        name: 'flakes',
        values: async function* () {
          for (const n of [...folder.keys()]) yield handle(n);
        },
        getFileHandle: async (name: string, opts?: { create?: boolean }) => {
          if (!folder.has(name)) {
            if (!opts?.create) throw new DOMException('missing', 'NotFoundError');
            folder.set(name, new Uint8Array());
          }
          return handle(name);
        },
      }),
    });
  }, files);
  const folderText = (name: string) =>
    page.evaluate((n) => {
      const f = (window as unknown as { __folder: Map<string, Uint8Array> }).__folder.get(n);
      return f ? new TextDecoder().decode(f) : null;
    }, name);
  const folderNames = () => page.evaluate(() => [...(window as unknown as { __folder: Map<string, Uint8Array> }).__folder.keys()].sort());

  await openApp(page);
  await fileMenu(page, '#btn-open-folder');
  await expect.poll(() => meshName(page)).toBe('box.ply');
  await expect(page.locator('#workspace-readonly')).toHaveCount(0);
  await viewFromTop(page);
  await setAnnotator(page, 'Ann');
  await page.keyboard.press('a');
  await dragArrow(page, boxPoint(-10, 0, 5), boxPoint(10, 3, 5));
  // saved next to the model
  await expect.poll(async () => JSON.parse((await folderText('box.lithicanalyst.json')) ?? '{}').annotations?.scars?.length).toBe(1);

  await openSection(page, 'workspace');
  await page.locator('#workspace-next').click();
  await expect.poll(() => meshName(page)).toBe('nodule.ply');
  expect((await state(page)).specimen.annotator).toBe('Ann');
  await page.keyboard.press('PageUp');
  await expect.poll(() => meshName(page)).toBe('box.ply');
  await expect.poll(async () => (await state(page)).scars).toHaveLength(1);

  // figures for all, written into the folder; the open model comes back
  await page.locator('#batch-format-svg').click();
  await page.locator('#batch-figures').click();
  await expect.poll(folderNames, { timeout: 60_000 }).toContain('nodule_figure.svg');
  await expect(page.locator('#batch-progress')).toBeHidden({ timeout: 60_000 });
  expect(await folderText('box_figure.svg')).toMatch(/^<\?xml[\s\S]*<svg/);
  await expect.poll(() => meshName(page)).toBe('box.ply');
  await expect.poll(async () => (await state(page)).scars).toHaveLength(1);

  // measure all: merged tables and the ICC of the two observers over both specimens
  await page.locator('#batch-measure').click();
  await expect.poll(folderNames).toContain('flakes_icc.csv');
  const rows = parseCsv((await folderText('flakes_measurements.csv'))!);
  expect(rows.map((r) => r.specimen_id)).toEqual(['box', 'nodule']);
  const icc = parseCsv((await folderText('flakes_icc.csv'))!);
  expect(icc.find((r) => r.measure === 'length')).toMatchObject({ n_specimens: '2', n_raters: '2', icc: '1' });
  expect(await folderText('flakes_scar_vectors.csv')).toContain('box,S1,');
});

import { test as base, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { ProjectFile } from '../src/core/schema';
import type { ProjectState } from '../src/core/types';
import type { MeshFile, Vec3 } from './fixtures/meshes';

/** The test hook the app exposes as window.lithicanalyst (see the end of src/ui/app.ts). */
export interface LithicApi {
  version: string;
  state(): ProjectState;
  selection(): string | null;
  project(p: Vec3): { x: number; y: number; visible: boolean } | undefined;
  pick(x: number, y: number): Vec3 | null;
  view(toward: Vec3, up: Vec3): void;
  setTool(id: string): void;
  exportCsvText(): string;
  exportCurvesCsvText(): string;
  curveDraft(): Vec3[] | null;
  measureDraft(): Vec3[] | null;
  planes(): import('../src/compute/planes').PlaneResult[];
  planeSectionCount(id: string): number | null;
  exportPlanesCsvText(): string;
  towardViewer(): Vec3 | null;
  cameraUp(): Vec3 | null;
  sectionFigure(id: string, format: 'png' | 'svg'): Promise<{ layout: import('../src/render/figure').FigureLayout; data: string } | null>;
  clipping(): number;
  regions(): { results: import('../src/compute/regions').RegionResult[]; totals: import('../src/compute/regions').RegionTotals } | null;
  regionCount(): number | null;
  volumeSplit(): import('../src/compute/split').VolumeSplit | null;
  nodule(): (import('../src/compute/sphere').SphereFit & { regions: string[] }) | null;
  exportRegionsCsvText(): string;
  figure(format: 'png' | 'svg'): Promise<{ layout: import('../src/render/figure').FigureLayout; data: string } | null>;
  autoMeasurements(): import('../src/core/derived').AutoMeasurements | null;
  exportMeasurementsCsvText(): string;
  exportManualMeasurementsCsvText(): string;
  exportRelationsCsvText(): string;
  exportSeriesCsvText(): string;
  relationChecks(): import('../src/compute/relations').RelationChecks;
  harris(): import('../src/compute/relations').HarrisLayout;
  harrisSvg(): string;
  highlighted(): string[];
  relationPending(): string | null;
  landmarkTable(): import('../src/compute/landmarks').LandmarkTable;
  exportLandmarksText(kind: 'tps' | 'fcsv' | 'csv' | 'sliders'): string;
  mode(): string;
  setMode(m: 'annotate' | 'measure' | 'present' | 'compare'): void;
  agreement(): { rows: import('../src/compute/agreement').AgreementRow[]; summary: import('../src/compute/agreement').SummaryRow[] } | null;
  agreementBusy(): boolean;
  observers(): Array<{ id: string; label: string; fileName: string; included: boolean; color: string; current: boolean }>;
  projectJson(): ProjectFile;
  snap: {
    prepare(mode: 'ridge' | 'valley' | 'off'): Promise<boolean>;
    strengthAt(mode: 'ridge' | 'valley' | 'off', p: Vec3): number | null;
  };
}

declare global {
  interface Window {
    lithicanalyst: LithicApi;
  }
}

export const APP_URL = new URL('../dist/index.html', import.meta.url).href;

/** Fails a test on any uncaught exception in the page. */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await use(errors);
      expect(errors, 'uncaught errors in the page').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Open the built app and wait until it has started with a working WebGL view. */
export async function openApp(page: Page): Promise<void> {
  // the web fonts are a nicety; tests run offline
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.abort());
  await page.goto(APP_URL);
  await page.waitForFunction(() => !!window.lithicanalyst);
  await expect(page.locator('.vp-error')).toHaveCount(0);
  await expect(page.locator('canvas.viewport-canvas')).toBeVisible();
}

/** Choose an item of the File menu in the top bar (#btn-open, #btn-open-project, #btn-open-folder). */
export async function fileMenu(page: Page, item: string): Promise<void> {
  await page.locator('#btn-file').click();
  await page.locator(item).click();
}

/** Open a model through the File menu (or another button) and wait until it is shown. */
export async function loadMesh(page: Page, file: MeshFile, button = '#btn-open'): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  if (button === '#btn-open') await fileMenu(page, button);
  else await page.locator(button).click();
  await (await chooser).setFiles(file);
  await waitForMesh(page, file.name);
}

export async function waitForMesh(page: Page, fileName: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.state().mesh?.fileName ?? null)).toBe(fileName);
  await expect(page.locator('.busy')).toBeHidden();
}

export async function nextFrames(page: Page, n = 2): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
        step(count);
      }),
    n,
  );
}

/** Look straight down at the model (+y up on screen), so screen x/y follow model x/y. */
export async function viewFromTop(page: Page): Promise<void> {
  await page.evaluate(() => window.lithicanalyst.view([0, 0, 1], [0, 1, 0]));
  await nextFrames(page);
}

/** Client (page) position of a point given in original coordinates. */
export async function toScreen(page: Page, p: Vec3): Promise<{ x: number; y: number }> {
  const s = await page.evaluate((q) => window.lithicanalyst.project(q), p);
  if (!s || !s.visible) throw new Error(`point ${p.join(', ')} is not in view`);
  return { x: s.x, y: s.y };
}

export const state = (page: Page): Promise<ProjectState> => page.evaluate(() => window.lithicanalyst.state());

export const counts = (page: Page): Promise<{ arrows: number; curves: number }> =>
  page.evaluate(() => {
    const s = window.lithicanalyst.state();
    return { arrows: s.scars.length, curves: s.curves.length };
  });

export const draftLength = (page: Page): Promise<number> => page.evaluate(() => window.lithicanalyst.curveDraft()?.length ?? 0);

/** Press at `a`, drag to `b`, release (arrow tool active). */
export async function dragArrow(page: Page, a: Vec3, b: Vec3): Promise<void> {
  const before = (await counts(page)).arrows;
  const s = await toScreen(page, a);
  const e = await toScreen(page, b);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(e.x, e.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await counts(page)).arrows).toBe(before + 1);
}

/** Click at `a`, then click at `b` (arrow tool active). */
export async function clickArrow(page: Page, a: Vec3, b: Vec3): Promise<void> {
  const before = (await counts(page)).arrows;
  const s = await toScreen(page, a);
  const e = await toScreen(page, b);
  await page.mouse.click(s.x, s.y);
  await page.mouse.move((s.x + e.x) / 2, (s.y + e.y) / 2, { steps: 4 });
  await page.mouse.click(e.x, e.y);
  await expect.poll(async () => (await counts(page)).arrows).toBe(before + 1);
}

/**
 * One click of the curve tool at a screen position; waits until the point is
 * placed (clicks are ignored while the previous one is still being traced).
 */
export async function curveClick(page: Page, at: { x: number; y: number }, opts: { shift?: boolean } = {}): Promise<void> {
  const before = await draftLength(page);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.click(at.x, at.y);
  if (opts.shift) await page.keyboard.up('Shift');
  await expect.poll(() => draftLength(page)).toBe(before + 1);
}

/** Run `trigger` and return the file it downloads. */
export async function download(page: Page, trigger: () => Promise<void>): Promise<{ name: string; text: string }> {
  const [dl] = await Promise.all([page.waitForEvent('download'), trigger()]);
  return { name: dl.suggestedFilename(), text: await readFile(await dl.path(), 'utf8') };
}

/** Minimal CSV reader for the app's exports (quoted cells allowed, no line breaks inside cells). */
export function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.replace(/^﻿/, '').trimEnd().split('\n');
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const header = split(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = split(line);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  });
}

export const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Points of the measurement being taken. */
export const measureDraftLength = (page: Page): Promise<number> => page.evaluate(() => window.lithicanalyst.measureDraft()?.length ?? 0);

/** Open a sidebar section (sections fold when another tool is chosen). */
export async function openSection(page: Page, id: string): Promise<void> {
  await page.locator(`#sec-${id}`).evaluate((d) => ((d as HTMLDetailsElement).open = true));
}

/** Set the annotator in the specimen panel of the top bar. */
export async function setAnnotator(page: Page, name: string): Promise<void> {
  await page.locator('#specimen-more').click();
  await page.locator('#specimen-annotator').fill(name);
  await page.keyboard.press('Escape');
}

/** Open the display settings panel over the view. */
export async function displayPanel(page: Page): Promise<void> {
  if (!(await page.locator('#display-panel').isVisible())) await page.locator('#btn-display').click();
}

/** Export one file through the export dialog (`key`: the dialog's file key, e.g. "curves"). */
export async function exportFile(page: Page, key: string): Promise<{ name: string; text: string }> {
  await page.locator('#btn-export').click();
  const boxes = page.locator('.export-list input[data-key]');
  for (let i = 0; i < (await boxes.count()); i++) {
    const box = boxes.nth(i);
    if (await box.isDisabled()) continue;
    if ((await box.getAttribute('data-key')) === key) await box.check();
    else await box.uncheck();
  }
  return download(page, () => page.locator('.modal [data-choice="export"]').click());
}

/** Whether the export dialog offers a file (it has data); the dialog is closed again. */
export async function exportAvailable(page: Page, key: string): Promise<boolean> {
  await page.locator('#btn-export').click();
  const enabled = await page.locator(`.export-list input[data-key="${key}"]`).isEnabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);
  return enabled;
}

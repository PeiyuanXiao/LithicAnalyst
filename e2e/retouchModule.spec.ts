import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { pngDpi } from '../src/io/png';
import { openToolPly, t1Ply, toolPly, type Vec3 } from './fixtures/meshes';
import { curveClick, expect, exportFile, loadMesh, nextFrames, openApp, openSection, parseCsv, state, test, toScreen } from './helpers';
import { annotatedTool, drawLoop, look, onTool, regionAt, retouch, setType } from './retouchSetup';

const view = (page: Page) => page.evaluate(() => window.lithicanalyst.retouchView());

/** The stepped tool in the retouch mode, every result in. */
async function inRetouchMode(page: Page, file = toolPly()): Promise<{ edge: string; first: string; second: string }> {
  const a = await annotatedTool(page, file);
  await page.locator('#app-mode-retouch').click();
  await expect.poll(async () => (await retouch(page))?.segments.length ?? 0).toBe(2);
  await look(page, [0, 0, 1], [0, 1, 0]);
  return a;
}

/** Every view says the station is `k`. */
async function expectStation(page: Page, k: number): Promise<void> {
  await expect.poll(async () => (await view(page)).station?.station).toBe(k);
  await expect.poll(async () => (await view(page)).section).toBe(String(k));
  await expect.poll(async () => (await view(page)).plan).toBe(String(k));
  const v = await view(page);
  await expect.poll(async () => Number((await view(page)).chart)).toBeCloseTo(v.station!.position, 3);
  // the mark on the model is where the station's point is
  const r = await page.evaluate((curve) => window.lithicanalyst.edgeAngles(curve), v.station!.curveId);
  const p = r!.stations[k].point!;
  await expect.poll(async () => {
    const m = (await view(page)).marker;
    return m ? Math.hypot(m[0] - p[0], m[1] - p[1], m[2] - p[2]) : 99;
  }).toBeLessThan(1e-3);
}

test('the mode is a flake\'s: it shows, and goes, with the type', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, t1Ply());
  const button = page.locator('#app-mode-retouch');
  await expect(button).toBeHidden();
  // M goes round the modes shown
  const order: string[] = [];
  for (let i = 0; i < 4; i++) {
    order.push(await page.evaluate(() => window.lithicanalyst.mode()));
    await page.keyboard.press('m');
  }
  expect(order).toEqual(['annotate', 'measure', 'present', 'compare']);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.mode())).toBe('annotate');
  await setType(page, 'flake');
  await expect(button).toBeVisible();
  await page.keyboard.press('m');
  await page.keyboard.press('m');
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.mode())).toBe('retouch');
  // its one tool, always on, with no button or key of its own
  await expect(page.locator('#retouch-tool-station')).toHaveCount(0);
  await expect.poll(async () => (await view(page)).tool).toBe('station');
  await page.keyboard.press('v');
  expect((await view(page)).tool).toBe('station');
  await page.keyboard.press('j');
  expect((await view(page)).tool).toBe('station');
  await expect(page.locator('#sec-retouch-indices')).toBeVisible();
  // a core: back to measuring
  await setType(page, 'core');
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.mode())).toBe('measure');
  await expect(button).toBeHidden();
  await expect(page.locator('#retouch-section-panel')).toBeHidden();
  await expect(page.locator('#retouch-plan-panel')).toBeHidden();
  await expect.poll(async () => (await view(page)).tool).toBe('select');
  // the shortcuts say so, on a flake
  await setType(page, 'flake');
  await page.keyboard.press('Shift+Slash');
  await expect(page.locator('#help-cols')).toContainText('Previous / next station');
  await page.keyboard.press('Escape');
});

test('a core opened with the retouch mode remembered: the annotate mode; the preference stands for the next flake', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('once')) localStorage.setItem('lithicanalyst:pref:mode', JSON.stringify('retouch'));
    sessionStorage.setItem('once', '1');
  });
  await openApp(page);
  await loadMesh(page, t1Ply());
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.mode())).toBe('annotate');
  await expect(page.locator('#app-mode-annotate')).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => localStorage.getItem('lithicanalyst:pref:mode'))).toBe('"retouch"');
  // it is the user who changes it
  await setType(page, 'flake');
  await page.locator('#app-mode-measure').click();
  expect(await page.evaluate(() => localStorage.getItem('lithicanalyst:pref:mode'))).toBe('"measure"');
});

test('the current station: where the missing area is largest; every way of moving it, in every view', async ({ page }) => {
  await openApp(page);
  const { first } = await inRetouchMode(page);
  // the two previews open by themselves
  await expect(page.locator('#retouch-section-panel')).toBeVisible();
  await expect(page.locator('#retouch-plan-panel')).toBeVisible();
  await openSection(page, 'retouch-angles');
  // the largest missing area
  const r = (await retouch(page))!;
  const largest = Math.max(...r.stations.filter((s) => !s.filled).map((s) => s.removed_area!));
  const start = (await view(page)).station!;
  expect(r.stations.find((s) => s.station === start.station)!.removed_area).toBe(largest);
  await expectStation(page, start.station);
  const n = (await page.evaluate((id) => window.lithicanalyst.edgeAngles(id), start.curveId))!.stations.length;
  // the parts of the drawing
  for (const id of ['#retouch-section-outline', '#retouch-section-missing', '#retouch-section-fit-0', '#retouch-section-fit-1', '#retouch-section-line-0', '#retouch-section-a', '#retouch-section-a0', '#retouch-section-r-0', '#retouch-section-c', '#retouch-section-t', '#retouch-section-T', '#retouch-section-scale', '#retouch-plan-outline', '#retouch-plan-mid', '#retouch-plan-bounds', '#retouch-plan-seg-1', '#retouch-plan-seg-8', '#retouch-plan-layer-1', '#retouch-plan-layer-2', '#retouch-plan-scale']) await expect(page.locator(id)).toBeAttached();
  await expect(page.locator('#retouch-plan-tag')).toHaveText('Longest axis');
  await expect(page.locator('#retouch-read-area')).not.toHaveText('—');
  // on the model: the section, the mark, the segments' lines
  await expect.poll(async () => (await view(page)).lines?.segments ?? 0).toBe(3);
  expect((await view(page)).lines!.station).toBeGreaterThan(0);

  // the keys; round the closed edge
  await page.keyboard.press('ArrowRight');
  await expectStation(page, (start.station + 1) % n);
  await page.keyboard.press('Shift+ArrowRight');
  await expectStation(page, (start.station + 11) % n);
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expectStation(page, start.station);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expectStation(page, (start.station - 2 + n) % n);

  // a press near the edge, where no panel covers it: the nearest station; held, along the edge
  const free = await page.evaluate(([id]) => {
    const stations = window.lithicanalyst.edgeAngles(id)!.stations;
    const out: Array<{ k: number; x: number; y: number }> = [];
    stations.forEach((s, k) => {
      const q = window.lithicanalyst.project(s.point!)!;
      if (document.elementFromPoint(q.x, q.y)?.tagName === 'CANVAS') out.push({ k, x: q.x, y: q.y });
    });
    return out;
  }, [start.curveId]);
  expect(free.length).toBeGreaterThan(6);
  const a = free[Math.floor(free.length / 2)], b = free[Math.floor(free.length / 2) + 3];
  await page.mouse.move(a.x + 3, a.y + 3);
  await page.mouse.down();
  await expectStation(page, a.k);
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await expectStation(page, b.k);
  await page.mouse.up();
  // a press away from the edge turns the view, the station stays
  const box = (await page.locator('#viewport').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 60);
  expect((await view(page)).station!.station).toBe(b.k);

  // the slider
  await page.locator('#retouch-section-slider').fill('40');
  await expectStation(page, 40);
  await page.locator('#retouch-section-slider').evaluate((e) => (e as HTMLElement).blur());

  // the chart of the layers
  await page.locator('#retouch-chart').scrollIntoViewIfNeeded();
  const chart = (await page.locator('#retouch-chart').boundingBox())!;
  await page.mouse.click(chart.x + chart.width * 0.5, chart.y + chart.height * 0.5);
  await expect.poll(async () => (await view(page)).station?.station).not.toBe(40);
  await expectStation(page, (await view(page)).station!.station);

  // the plan: a press by its outline goes to the nearest station; far from it, nothing
  const outline = await page.locator('#retouch-plan-outline').evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.bottom };
  });
  const before = (await view(page)).station!.station;
  await page.mouse.click(outline.x, outline.y - 2);
  await expect.poll(async () => (await view(page)).station?.station).not.toBe(before);
  const pressed = (await view(page)).station!.station;
  await expectStation(page, pressed);
  await page.mouse.click(outline.x, outline.y - 90);
  expect((await view(page)).station!.station).toBe(pressed);

  // a row of the regions: the middle of its stretch, and the region selected
  await openSection(page, 'retouch-segments');
  await page.locator('#retouch-segment-0').click();
  await expectStation(page, Math.floor(n / 2));
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.selection())).toBe(first);
  await expect(page.locator('#retouch-segment-0')).toHaveClass(/is-selected/);

  // switched off and on from the display panel
  await page.locator('#btn-display').click();
  await page.locator('#retouch-section-show').uncheck();
  await expect(page.locator('#retouch-section-panel')).toBeHidden();
  await page.locator('#retouch-section-show').check();
  await expect(page.locator('#retouch-section-panel')).toBeVisible();
  await page.locator('#retouch-lines-show').uncheck();
  await expect.poll(async () => (await view(page)).lines?.segments ?? -1).toBe(0);
  await page.locator('#retouch-lines-show').check();
  await expect.poll(async () => (await view(page)).lines?.segments ?? 0).toBe(3);
  await page.keyboard.press('Escape');
});

test('the fitted length: previewed while dragged, written on letting go; undone; back to the default', async ({ page }) => {
  await openApp(page);
  await inRetouchMode(page);
  await openSection(page, 'retouch-params');
  await expect(page.locator('#retouch-fit-value')).toHaveValue('5');
  await expect(page.locator('#retouch-fit-own')).toBeHidden();
  const base = (await retouch(page))!;
  const length = async () => Number(await page.locator('#retouch-section-fit-0').getAttribute('data-length'));
  await expect.poll(length).toBeCloseTo(5, 1);
  // the small curve: over a range of lengths, a mark at this one
  await expect.poll(async () => (await view(page)).fitCurve?.length ?? 0).toBe(9);
  await expect(page.locator('#retouch-fit-dot')).toBeAttached();

  // press, drag, and nothing is written yet
  const box = (await page.locator('#retouch-fit').boundingBox())!;
  const at = (mm: number) => box.x + 8 + ((mm - 1) / 19) * (box.width - 16);
  await page.mouse.move(at(5), box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(at(12), box.y + box.height / 2, { steps: 5 });
  await expect.poll(async () => (await retouch(page))?.fitLength).toBeGreaterThan(9);
  await expect.poll(length).toBeGreaterThan(8);
  expect((await state(page)).flake.retouch).toBeUndefined();
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).flake.retouch?.fitLength ?? null).not.toBeNull();
  const w = (await state(page)).flake.retouch!.fitLength!;
  await expect.poll(async () => (await retouch(page))?.fitLength).toBe(w);
  expect((await retouch(page))!.erp).not.toBe(base.erp);
  await expect(page.locator('#retouch-fit-own')).toBeVisible();
  await expect(page.locator('#retouch-fit-value')).toHaveValue(String(w));

  // undone
  await page.locator('#btn-undo').click();
  await expect.poll(async () => (await retouch(page))?.fitLength).toBe(5);
  await expect.poll(length).toBeCloseTo(5, 1);
  expect((await retouch(page))!.erp).toBeCloseTo(base.erp!, 9);
  await expect(page.locator('#retouch-fit-own')).toBeHidden();

  // by the box; then the default
  await page.locator('#retouch-fit-value').fill('8');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await retouch(page))?.fitLength).toBe(8);
  await expect(page.locator('#retouch-fit-own')).toBeVisible();
  await page.locator('#retouch-fit-default').click();
  await expect.poll(async () => (await retouch(page))?.fitLength).toBe(5);
  await expect(page.locator('#retouch-fit-own')).toBeHidden();
  expect((await state(page)).flake.retouch).toBeUndefined();
  await expect(page.locator('#retouch-fit')).toHaveValue('5');
});

test('the frame and its direction: the ends exchanged on the plan and in invasiveness.csv; a segment shown from the grid', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, toolPly());
  await setType(page, 'flake');
  // retouch along a part of the edge only, so that the two ends differ
  const around = [0, 90, 180, 270];
  await drawLoop(page, around.map((d): Vec3 => [0.97 * 30 * Math.cos((d * Math.PI) / 180), 0.97 * 30 * Math.sin((d * Math.PI) / 180), 0.24]), '2', [0, 0, 8]);
  await look(page, [0, 0, 1], [0, 1, 0]);
  await page.keyboard.press('p');
  for (const d of [-40, 0, 40]) await curveClick(page, await toScreen(page, onTool(d === 0 ? 24 : 28.6, d)), { shift: true });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).curves.length).toBe(2);
  await page.keyboard.press('v');
  await page.keyboard.press('6');
  // between the curve and the edge, by itself
  await expect.poll(async () => (await state(page)).regions.map((r) => r.type)).toEqual(['retouch']);
  await page.keyboard.press('r');
  await regionAt(page, onTool(5, 45), '7');
  await look(page, [0, 0, -1], [0, 1, 0]);
  await regionAt(page, [10, 10, 0], '6');
  await page.keyboard.press('v');
  await page.locator('#app-mode-retouch').click();
  await expect.poll(async () => (await retouch(page))?.penetration.some((p) => p.score > 0) ?? false).toBe(true);
  await expect.poll(async () => (await view(page)).segments?.length ?? 0).toBe(8);

  // the longest axis, as there is no technical one
  await expect(page.locator('#retouch-plan-axis')).toHaveValue('auto');
  await expect(page.locator('#retouch-plan-tag')).toHaveText('Longest axis');
  await expect(page.locator('#retouch-plan-flip')).toBeVisible();
  // the technical axis, asked for: there is none
  await page.locator('#retouch-plan-axis').selectOption('technical');
  await expect(page.locator('#retouch-plan-empty')).toContainText('Technological axis');
  await expect(page.locator('#retouch-plan-flip')).toBeHidden();
  await expect.poll(async () => (await retouch(page))?.reasons.invasiveness).toBe('no_axis');
  await page.locator('#retouch-plan-axis').selectOption('auto');
  await expect(page.locator('#retouch-plan-tag')).toHaveText('Longest axis');
  await expect.poll(async () => (await retouch(page))?.penetration.some((p) => p.score > 0) ?? false).toBe(true);

  const before = parseCsv((await exportFile(page, 'invasiveness')).text);
  const placed = (await view(page)).segments!;
  await page.locator('#retouch-plan-flip').click();
  await expect.poll(async () => (await state(page)).flake.retouch?.flip).toBe(true);
  // segment 1 lies where segment 8 lay, and the other way round
  await expect.poll(async () => {
    const now = (await view(page)).segments;
    const one = now?.find((s) => s.segment === 1)?.model, eight = placed.find((s) => s.segment === 8)!.model;
    return one ? Math.hypot(one[0] - eight[0], one[1] - eight[1]) : 99;
  }).toBeLessThan(1.5);
  const now = (await view(page)).segments!;
  const eightNow = now.find((s) => s.segment === 8)!.model, oneBefore = placed.find((s) => s.segment === 1)!.model;
  expect(Math.hypot(eightNow[0] - oneBefore[0], eightNow[1] - oneBefore[1])).toBeLessThan(1.5);
  // on the page the proximal end stays down: the numbers keep their places
  await expect(async () => {
    const y1 = Number(await page.locator('#retouch-plan-seg-1').getAttribute('y')), y8 = Number(await page.locator('#retouch-plan-seg-8').getAttribute('y'));
    expect(y1).toBeGreaterThan(y8);
  }).toPass();
  // the table follows: each segment takes what the one turned half round had
  const mirror = (s: number) => (s > 8 ? 8 : 0) + 9 - (s > 8 ? s - 8 : s);
  await expect.poll(async () => JSON.stringify(parseCsv((await exportFile(page, 'invasiveness')).text).map((r) => r.score))).not.toBe(JSON.stringify(before.map((r) => r.score)));
  const after = parseCsv((await exportFile(page, 'invasiveness')).text);
  for (const r of before) expect(Number(after[mirror(Number(r.segment)) - 1].score)).toBe(Number(r.score));
  await page.locator('#btn-undo').click();
  await expect.poll(async () => (await state(page)).flake.retouch?.flip ?? false).toBe(false);

  // a cell of the grid: its face on the plan, the segment marked
  await openSection(page, 'retouch-indices');
  await page.locator('#retouch-cell-12').click();
  await expect(page.locator('#retouch-plan-face-ventral')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#retouch-plan-highlight')).toHaveAttribute('data-segment', '12');
  await expect(page.locator('#retouch-plan-seg-12')).toBeAttached();
  await expect(page.locator('#retouch-cell-12')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#retouch-cell-3').click();
  await expect(page.locator('#retouch-plan-face-dorsal')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#retouch-plan-highlight')).toHaveAttribute('data-segment', '3');
  // by score, or by how far in it reaches
  const lit = (await retouch(page))!.penetration.find((p) => p.score > 0)!;
  const style = () => page.locator(`#retouch-cell-${lit.segment}`).getAttribute('style');
  const byScore = await style();
  await page.locator('#retouch-grid-by-p').click();
  await expect.poll(style).not.toBe(byScore);
});

test('the previews export: SVG and PNG, named as they should be, to scale, on white', async ({ page }) => {
  await openApp(page);
  await inRetouchMode(page);
  const station = (await view(page)).station!;
  const save = async (id: string) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator(id).click()]);
    return { name: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
  };
  const section = await save('#retouch-section-svg');
  expect(section.name).toBe(`tool_retouch_section_C1_${station.position}.svg`);
  const text = section.bytes.toString('utf8');
  expect(text).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="[\d.]+mm" height="[\d.]+mm"/);
  expect(text).toContain('fill="#ffffff"');
  expect(text).not.toContain('var(--');
  expect(text).toContain('id="retouch-section-scale"');

  const png = await save('#retouch-section-png');
  expect(png.name).toBe(`tool_retouch_section_C1_${station.position}.png`);
  expect(png.bytes.subarray(1, 4).toString()).toBe('PNG');
  expect(Math.round(pngDpi(new Uint8Array(png.bytes))!)).toBe(600);

  const plan = await save('#retouch-plan-svg');
  expect(plan.name).toBe('tool_retouch_plan_dorsal.svg');
  const planText = plan.bytes.toString('utf8');
  expect(planText).toMatch(/width="[\d.]+mm"/);
  expect(planText).not.toContain('var(--');
  // 60 mm across, at the figure's scale, with the margin
  expect(Number(/width="([\d.]+)mm"/.exec(planText)![1])).toBeCloseTo(60 * 1.16, 0);

  await page.locator('#retouch-plan-face-ventral').click();
  const planPng = await save('#retouch-plan-png');
  expect(planPng.name).toBe('tool_retouch_plan_ventral.png');
  expect(Math.round(pngDpi(new Uint8Array(planPng.bytes))!)).toBe(600);

  // where the browser will not turn an SVG into an image: the same primitives, on a canvas
  await page.evaluate(() => {
    (window as unknown as { Image: unknown }).Image = class {
      onerror: (() => void) | null = null;
      set src(_: string) {
        setTimeout(() => this.onerror?.(), 0);
      }
    };
  });
  const drawn = await save('#retouch-section-png');
  expect(drawn.name).toBe(png.name);
  expect(drawn.bytes.subarray(1, 4).toString()).toBe('PNG');
  expect(Math.round(pngDpi(new Uint8Array(drawn.bytes))!)).toBe(600);
  // as many pixels, and as much drawn on them
  expect(drawn.bytes.readUInt32BE(16)).toBe(png.bytes.readUInt32BE(16));
  expect(drawn.bytes.length).toBeGreaterThan(png.bytes.length / 4);

  // the figure's settings: another resolution and scale
  await page.locator('#app-mode-present').click();
  await openSection(page, 'figure');
  await page.locator('#fig-dpi-300').click();
  await page.locator('#fig-scale-2').click();
  await page.locator('#app-mode-retouch').click();
  await expect(page.locator('#retouch-plan-panel')).toBeVisible();
  await expect.poll(async () => (await view(page)).plan).not.toBeNull();
  const again = await save('#retouch-plan-png');
  expect(Math.round(pngDpi(new Uint8Array(again.bytes))!)).toBe(300);
  const twice = (await save('#retouch-plan-svg')).bytes.toString('utf8');
  expect(Number(/width="([\d.]+)mm"/.exec(twice)![1])).toBeCloseTo(2 * 60 * 1.16, 0);

  // no unit: the panel's size, no scale bar, and the indices that need stations say why
  await page.locator('#specimen-more').click();
  await page.locator('#specimen-unit').selectOption('');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await retouch(page))?.reasons.erp).toBe('no_unit');
  const plain = (await save('#retouch-plan-svg')).bytes.toString('utf8');
  expect(plain).not.toMatch(/mm"/);
  expect(plain).not.toContain('retouch-plan-scale');
  await expect(page.locator('#retouch-erp')).toHaveText('—');
});

test('retouch on the ventral face alone: GIUR from the ventral line, t and T on the section; the line between the zones closed on the plan', async ({ page }) => {
  await openApp(page);
  await annotatedTool(page, toolPly(), true);
  await page.locator('#app-mode-retouch').click();
  await expect.poll(async () => (await retouch(page))?.giur ?? null).not.toBeNull();
  const r = (await retouch(page))!;
  expect(r.reasons.giur).toBeUndefined();
  expect(r.giur!).toBeGreaterThan(0);
  expect(r.giur!).toBeLessThanOrEqual(1);
  expect(r.giur_stations).toBe(r.stations.length);
  expect(r.stations.every((s) => s.depth_dorsal === 0 && s.depth_ventral! > 0 && s.giur !== null)).toBe(true);
  expect(r.retouch_perimeter_dorsal).toBe(0);
  expect(r.retouch_perimeter_ventral).toBeCloseTo(1, 5);
  // the station's readings, and its section
  await expect(page.locator('#retouch-read-ratio')).not.toHaveText('—');
  await expect(page.locator('#retouch-section-t')).toHaveCount(1);
  await expect(page.locator('#retouch-section-T')).toHaveCount(1);
  const d = (await page.locator('#retouch-plan-bounds').getAttribute('d'))!;
  expect(d.match(/M/g)!.length).toBe(1);
  expect(d.trim().endsWith('Z')).toBe(true);
});

test('an empty value says why: an open mesh has no ERP', async ({ page }) => {
  await openApp(page);
  await inRetouchMode(page, openToolPly());
  await openSection(page, 'retouch-indices');
  await expect.poll(async () => (await retouch(page))?.reasons.erp).toBe('mesh_open');
  // the volume removed is still there
  expect((await retouch(page))!.removed_volume).toBeGreaterThan(0);
  const cell = page.locator('#retouch-erp');
  await expect(cell).toHaveText('—');
  await cell.hover();
  await expect(page.locator('.tip')).toHaveText('Mesh not closed: volume unreliable');
  await page.mouse.move(5, 5);
  // the readings under the section too
  await nextFrames(page);
  await expect(page.locator('#retouch-read-area')).not.toHaveText('—');
});

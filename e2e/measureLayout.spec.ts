import type { Locator, Page } from '@playwright/test';
import { boxPly } from './fixtures/meshes';
import { expect, exportFile, loadMesh, nextFrames, openApp, openSection, parseCsv, state, test } from './helpers';
import { annotatedTool, retouch } from './retouchSetup';
import { openT8 } from './t8Setup';

/** Stage 34c: how the measures are laid out, pointed at and fixed; length, width and thickness without a frame; small fixes. */

const hint = (page: Page) => page.evaluate(() => window.lithicanalyst.measureHint());
const style = (l: Locator, prop: string) => l.evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop);
const box = async (l: Locator) => (await l.boundingBox())!;

/** The columns of the exports before stage 34c: the card lost rows, the files lost nothing. */
const FLAKES_HEADER =
  'specimen_id,unit,frame_source,tech_length,tech_width,tech_thickness,morph_length,morph_width,morph_thickness,morph_tech_angle_deg,platform_width_chord,platform_width_path,platform_depth_chord,platform_depth_path,platform_area,epa_3pt_1mm,epa_3pt_2mm,epa_3pt_3mm,epa_2ln_1mm,epa_2ln_2mm,epa_2ln_3mm,ipa,retouch_axis,retouch_fit_length,removed_volume,erp,erp_filled_share,giur,giur_stations,invasiveness,invasiveness_continuous,retouch_perimeter,retouch_perimeter_dorsal,retouch_perimeter_ventral,edge_curvature,edge_curvature_chord,edge_curvature_depth,psia,bulb_angle_3pt_1mm,bulb_angle_2ln_1mm,bsa,bsa_level_mm,bsa_ends_moved,vi_0_5mm,vi_1_0mm,vi_1_5mm,pop_mesh_edge';
const RETOUCH_HEADERS: Record<string, string> = {
  'retouch-sections': 'specimen_id,curve_id,station,position,segment,x,y,depth_dorsal,depth_ventral,removed_area,filled,original_angle_deg,recession,retouch_height,thickness,giur,working_edge',
  'retouch-segments': 'specimen_id,curve_id,retouch_region,retouch_layer,face,start_position,end_position,length,chord,depth,working_edge',
  invasiveness: 'specimen_id,face,segment,penetration,score',
};

test('a flake\'s measures: four groups, tables of method by distance, BSA at its level; the sparse mesh only as a warning', async ({ page }) => {
  await openT8(page);
  await page.locator('#app-mode-measure').click();
  await expect(page.locator('#flake-measures .measure-group-title')).toHaveText(['Dimensions', 'Platform', 'Proximal angles (°)', 'Bulb']);
  // a group's title in the interface's type, a table's heads monospaced and small, without letter spacing
  const title = page.locator('#flake-measures .measure-group-title').first();
  expect(await style(title, 'font-family')).toContain('IBM Plex Sans');
  expect(await style(title, 'font-size')).toBe('12px');
  expect(await style(title, 'font-weight')).toBe('500');
  const head = page.locator('#flake-angle-table thead th').nth(1);
  expect(await style(head, 'font-family')).toContain('IBM Plex Mono');
  expect(await style(head, 'font-size')).toBe('11px');
  expect(parseFloat(await style(head, 'letter-spacing')) || 0).toBeLessThanOrEqual(0.25);
  // a fine line over every group but the first
  expect(await style(page.locator('#flake-group-size'), 'border-top-width')).toBe('0px');
  expect(parseFloat(await style(page.locator('#flake-group-platform'), 'border-top-width'))).toBeGreaterThan(0);

  // what each table measures, in its corner; methods by rows, distances by columns
  await expect(page.locator('#flake-size-table thead th')).toHaveText(['mm', 'Technological', 'Morphological']);
  await expect(page.locator('#flake-size-table tbody th')).toHaveText(['Length', 'Width', 'Thickness']);
  await expect(page.locator('#flake-group-size dt')).toHaveText(['Morphological–technological angle', 'Surface area', 'Volume']);
  await expect(page.locator('#flake-platform-table thead th')).toHaveText(['mm', 'Chord', 'Along surface']);
  await expect(page.locator('#flake-platform-table tbody th')).toHaveText(['Width', 'Depth']);
  await expect(page.locator('#flake-group-platform dt')).toHaveText(['Area']);
  await expect(page.locator('#flake-angle-table thead th')).toHaveText(['', '1 mm', '2 mm', '3 mm']);
  await expect(page.locator('#flake-angle-table tbody th')).toHaveText(['EPA three points', 'EPA two lines', 'Bulb angle three points', 'Bulb angle two lines']);
  // the bulb angle only at 1 mm: the two other cells empty, without a dash
  for (const r of [3, 4]) {
    const cells = page.locator(`#flake-angle-table tbody tr:nth-child(${r}) td`);
    await expect(cells).toHaveCount(3);
    await expect(cells.nth(0)).not.toHaveText('');
    await expect(cells.nth(1)).toHaveText('');
    await expect(cells.nth(2)).toHaveText('');
  }
  // IPA and PSIA under the table: the unit is the group's
  await expect(page.locator('#flake-group-angles dt')).toHaveText(['IPA', 'PSIA']);
  await expect(page.locator('#flake-ipa-unit')).toHaveText('');
  await expect(page.locator('#flake-group-bulb dt')).toHaveText(['BSA (at 0.10 mm)']);
  await expect(page.locator('#flake-bsa')).not.toContainText('mm');
  await expect(page.locator('#flake-vi-table thead th')).toHaveText(['VI (mm)', '0.5 mm', '1.0 mm', '1.5 mm']);
  await expect(page.locator('#flake-vi-table tbody th')).toHaveText(['']);

  // the mesh round P: no value of its own, a warning only above the threshold
  await expect(page.locator('#flake-pop_mesh_edge')).toHaveCount(0);
  expect((await page.evaluate(() => window.lithicanalyst.flake()?.measures?.pop_mesh_edge)) ?? 0).toBeLessThan(0.5);
  await expect(page.locator('#flake-mesh-sparse')).toBeHidden();
  await page.evaluate(() => window.lithicanalyst.setMeshWarnMm(0.01));
  await expect(page.locator('#flake-mesh-sparse')).toBeVisible();
  await expect(page.locator('#flake-mesh-sparse')).toHaveText('Sparse mesh near the point of percussion');
  await expect(page.locator('#sec-flake > summary #flake-mesh-sparse')).toHaveCount(1);
  await page.evaluate(() => window.lithicanalyst.setMeshWarnMm(null));
  await expect(page.locator('#flake-mesh-sparse')).toBeHidden();
});

test('pointed at, a row gets a neutral ground, fixed one pale amber in a ring; a cell lights its row and column; on the model only the current part stands out', async ({ page }) => {
  await openT8(page);
  await page.locator('#app-mode-measure').click();
  const row = page.locator('#flake-group-size .num-row[data-hint="flake:morph_tech_angle_deg"]');
  const term = row.locator('dt');
  const colour = await style(term, 'color');
  // the transition: 140 ms; none with reduced motion
  expect(await style(row, 'transition-duration')).toMatch(/^0s/);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await style(row, 'transition-duration')).toBe('0.14s, 0.14s, 0.14s');
  expect(await style(row, 'transition-property')).toBe('background-color, box-shadow, color');
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await row.hover();
  await expect(row).toHaveClass(/is-hinted/);
  expect(await style(row, 'background-color')).not.toBe('rgba(0, 0, 0, 0)');
  expect(await style(row, 'box-shadow')).toBe('none');
  expect(await style(row, 'border-top-left-radius')).toBe('4px');
  // one piece from the name to the unit, 6 px past the text either side
  const r = await box(row), t = await box(term), u = await box(page.locator('#flake-morph_tech_angle_deg-unit'));
  expect(Math.abs(t.x - r.x - 6)).toBeLessThan(1);
  expect(Math.abs(r.x + r.width - (u.x + u.width) - 6)).toBeLessThan(1);

  await row.click();
  await expect(row).toHaveClass(/is-pinned/);
  await page.mouse.move(5, 400);
  expect(await style(row, 'box-shadow')).toContain('inset');
  expect(await style(term, 'color')).toBe(colour);
  expect(await style(page.locator('#flake-morph_tech_angle_deg'), 'font-weight')).toBe('500');
  // the text did not move
  expect((await box(term)).x).toBeCloseTo(t.x, 1);

  // on the model: the angle current, with its value; nothing else labelled
  let h = await hint(page);
  expect(h.pinned).toBe('flake:morph_tech_angle_deg');
  expect(h.looks!.filter((l) => l.label).length).toBe(1);
  await page.keyboard.press('Escape');
  await expect(row).not.toHaveClass(/is-pinned/);

  // the morphological length: the width and thickness lines and the others' dots at 35 %, unlabelled
  const cell = page.locator('#flake-morph_length');
  await cell.click();
  await expect(cell).toHaveClass(/is-pinned/);
  h = await hint(page);
  expect(h.drawn!.labels).toBe(1);
  for (const l of h.looks!) expect(l.opacity).toBe(l.role === 'other' ? 0.35 : 1);
  expect(h.looks!.filter((l) => l.label).map((l) => [l.part, l.role])).toEqual([['length', 'current']]);
  // its row's name and its column's head are lit; the others not
  await expect(page.locator('#flake-size-table tbody th').nth(0)).toHaveClass(/is-lit/);
  await expect(page.locator('#flake-size-table thead th').nth(2)).toHaveClass(/is-lit/);
  await expect(page.locator('#flake-size-table th.is-lit')).toHaveCount(2);
  // another cell, of the other table
  await page.locator('#flake-epa_3pt_2mm').click();
  await expect(page.locator('#flake-angle-table tbody th').nth(0)).toHaveClass(/is-lit/);
  await expect(page.locator('#flake-angle-table thead th').nth(2)).toHaveClass(/is-lit/);
  await expect(page.locator('#flake-size-table th.is-lit')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#flake-measures .is-pinned')).toHaveCount(0);
  await expect(page.locator('#flake-measures th.is-lit')).toHaveCount(0);
});

test('the tool without a technical axis: empty groups in one line each; the retouch card\'s four indices; the exports unchanged', async ({ page }) => {
  test.setTimeout(180_000);
  await openApp(page);
  await annotatedTool(page);
  await page.evaluate(() => window.lithicanalyst.selectForTest(null));
  await openSection(page, 'working-edges');
  await page.locator('#working-edge-generate').click();
  // a button on a row of its own: the standard one, with a border
  for (const id of ['#working-edge-generate']) {
    await expect(page.locator(id)).not.toHaveClass(/btn-quiet/);
    expect(await style(page.locator(id), 'border-top-style')).toBe('solid');
  }
  await page.locator('#app-mode-measure').click();
  await expect.poll(async () => (await retouch(page))?.segments.length ?? 0).toBe(2);
  // no axis: the groups that need one are a line each, saying why
  for (const g of ['platform', 'angles', 'bulb']) {
    const group = page.locator(`#flake-group-${g}`);
    await expect(group).toHaveClass(/is-empty/);
    await expect(group.locator('.measure-empty-why')).toHaveText('No technological axis');
    await expect(group.locator('.measure-empty-dash')).toHaveText('—');
    await expect(group.locator('table, dl')).toHaveCount(0);
  }
  // the dimensions still have the morphological ones
  await expect(page.locator('#flake-group-size')).not.toHaveClass(/is-empty/);

  await page.locator('#app-mode-retouch').click();
  await expect(page.locator('#retouch-scores .score-cell')).toHaveCount(4);
  await expect(page.locator('#retouch-scores .score-label')).toHaveText(['ERP', 'GIUR', 'Invasiveness', 'Retouched perimeter (total)']);
  // two by two, the numbers large and monospaced
  const cells = page.locator('#retouch-scores .score-cell');
  const [a, b, c] = [await box(cells.nth(0)), await box(cells.nth(1)), await box(cells.nth(2))];
  expect(Math.abs(a.y - b.y)).toBeLessThan(1);
  expect(c.y).toBeGreaterThan(a.y + a.height - 1);
  expect(await style(page.locator('#retouch-invasiveness'), 'font-family')).toContain('IBM Plex Mono');
  await expect(page.locator('#retouch-invasiveness')).toHaveText('0.500');
  await expect(page.locator('#retouch-grid-by')).toHaveCount(0);
  for (const id of ['retouch-removed', 'retouch-filled', 'retouch-giur-stations', 'retouch-continuous', 'retouch-perimeter-dorsal', 'retouch-perimeter-ventral', 'retouch-chord', 'retouch-depth']) await expect(page.locator(`#${id}`)).toHaveCount(0);
  await expect(page.locator('#retouch-values dt')).toHaveText(['Edge curvature']);
  // each working edge's own: a head on one line
  await expect(page.locator('#working-edge-table thead th')).toHaveText(['Working edge', 'ERP', 'GIUR', 'Perimeter', 'Curvature']);
  const heads = page.locator('#working-edge-table thead th');
  const tops = await heads.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
  expect(await style(heads.first(), 'white-space')).toBe('nowrap');
  // the retouch regions: four columns
  await openSection(page, 'retouch-segments');
  await expect(page.locator('#retouch-segment-table thead th')).toHaveText(['Region', 'Layer', 'Face', 'Length']);
  await expect(page.locator('#retouch-segment-rows tr').first().locator('td')).toHaveCount(4);

  // the fitted length's plot: what and its unit, its range, the lengths' range, the length in use
  await openSection(page, 'retouch-params');
  await expect(page.locator('#retouch-fit-ylabel')).toHaveText('Removed volume (mm³)');
  for (const id of ['ymax', 'ymin']) await expect(page.locator(`#retouch-fit-${id}`)).toHaveText(/^\d+(\.\d+)?$/);
  expect(Number(await page.locator('#retouch-fit-ymax').textContent())).toBeGreaterThan(Number(await page.locator('#retouch-fit-ymin').textContent()));
  await expect(page.locator('#retouch-fit-xmin')).toHaveText('1 mm');
  await expect(page.locator('#retouch-fit-xmax')).toHaveText('20 mm');
  await expect(page.locator('#retouch-fit-w')).toHaveAttribute('class', 'fit-plot-w');
  await expect(page.locator('#retouch-fit-dot')).toHaveCount(1);
  await expect(page.locator('#retouch-fit-wlabel')).toHaveText('5.0 mm');
  expect(await style(page.locator('#retouch-fit-xmin'), 'font-family')).toContain('IBM Plex Mono');
  // drawn at least as large as its units: 11 px numbers stay 11 px or more
  expect((await box(page.locator('#retouch-fit-curve'))).width).toBeGreaterThanOrEqual(260);
  await expect(page.locator('#retouch-fit-default')).not.toHaveClass(/btn-quiet/);
  expect(await style(page.locator('#retouch-fit-default'), 'border-top-style')).toBe('solid');

  // the files: every column as before
  expect((await exportFile(page, 'flakes')).text.split('\n')[0]).toBe(FLAKES_HEADER);
  for (const [key, header] of Object.entries(RETOUCH_HEADERS)) expect((await exportFile(page, key)).text.split('\n')[0], key).toBe(header);
  const edges = parseCsv((await exportFile(page, 'working-edges')).text);
  for (const col of ['retouched_length', 'retouch_perimeter', 'retouch_perimeter_dorsal', 'retouch_perimeter_ventral', 'removed_volume', 'erp', 'erp_filled_share', 'giur', 'giur_stations', 'edge_curvature', 'edge_curvature_chord', 'edge_curvature_depth']) expect(Object.keys(edges[0]), col).toContain(col);
});

test('a core\'s length, width and thickness: the longest measure and the widths across it, whatever the frame; no frame column', async ({ page }) => {
  await openApp(page, 'core');
  await loadMesh(page, boxPly());
  await page.locator('#app-mode-measure').click();
  await expect(page.locator('#auto-frame')).toHaveCount(0);
  await expect(page.locator('#measure-auto .measure-group-title')).toHaveText(['Dimensions', 'Whole']);
  // the box 40 × 20 × 10: its space diagonal, and the widths across it (tests/measure.test.ts)
  await expect(page.locator('#auto-length')).toHaveText('45.826');
  await expect(page.locator('#auto-width')).toHaveText('39.036');
  await expect(page.locator('#auto-thickness')).toHaveText('17.889');
  const before = await page.evaluate(() => window.lithicanalyst.autoMeasurements());
  // drawn as a flake's morphological ones: only the current line labelled
  await page.locator('#measure-auto .num-row[data-hint="auto:width"]').click();
  const h = await hint(page);
  expect(h.prims.filter((p) => p.kind === 'line').map((p) => [p.part, p.role])).toEqual([['length', 'other'], ['thickness', 'other'], ['width', 'current']]);
  expect(h.labels).toEqual(['39.036 mm']);
  await page.keyboard.press('Escape');

  // a specimen frame from the view, turned: the same values
  await page.locator('#app-mode-present').click();
  await page.evaluate(() => window.lithicanalyst.view([1, 1, 1], [0, 0, 1]));
  await nextFrames(page);
  await page.locator('#frame-from-view').click();
  await expect.poll(async () => (await state(page)).specimen.frame).not.toBeNull();
  await page.locator('#app-mode-measure').click();
  expect(await page.evaluate(() => window.lithicanalyst.autoMeasurements())).toEqual(before);
  await expect(page.locator('#auto-length')).toHaveText('45.826');
  // the frame's buttons have a border
  await page.locator('#app-mode-present').click();
  for (const id of ['#frame-view', '#frame-clear']) {
    await expect(page.locator(id)).not.toHaveClass(/btn-quiet/);
    expect(await style(page.locator(id), 'border-top-style')).toBe('solid');
  }

  await page.locator('#app-mode-measure').click();
  const csv = await exportFile(page, 'measurements');
  const header = csv.text.split('\n')[0].split(',');
  expect(header).not.toContain('frame');
  expect(header.slice(0, 5)).toEqual(['specimen_id', 'unit', 'length', 'width', 'thickness']);
  expect(Number(parseCsv(csv.text)[0].length)).toBeCloseTo(Math.hypot(40, 20, 10), 4);
});

test('the colour scale stands over the status pills, never on them, at any width', async ({ page }) => {
  await openT8(page);
  await page.locator('#app-mode-measure').click();
  const edge = (await state(page)).curves.find((c) => c.attributes.type === 'edge')!;
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), edge.id);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.edgeColors())).not.toBeNull();
  const legend = page.locator('#edge-legend'), pills = page.locator('#annotation-status');
  await expect(legend).toBeVisible();
  await expect(pills).toBeVisible();
  for (const width of [1280, 1000, 820]) {
    await page.setViewportSize({ width, height: 800 });
    await nextFrames(page, 3);
    const l = await box(legend), p = await box(pills);
    expect(l.y + l.height, `${width}px`).toBeLessThanOrEqual(p.y + 0.5);
    expect(Math.abs(l.x - p.x), `${width}px`).toBeLessThan(1);
  }
});

for (const lang of ['en', 'zh'] as const)
  test(`the top bar at 1280 × 800 (${lang}): the flake's five modes keep their names`, async ({ page }) => {
    await openT8(page);
    if (lang === 'zh') {
      await page.locator('#btn-lang').click();
      await page.locator('#lang-zh').click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    }
    await nextFrames(page, 3);
    const labels = page.locator('.mode-switch .mode-btn:not([hidden]) .mode-label');
    await expect(labels).toHaveCount(5);
    for (let i = 0; i < 5; i++) await expect(labels.nth(i)).toBeVisible();
    // the bar does not overflow
    expect(await page.locator('.topbar').evaluate((b) => b.scrollWidth <= b.clientWidth + 1)).toBe(true);
    // narrower and narrower: the frame's pill goes before the buttons' words, those before the modes' names; the current mode keeps its name
    for (const width of [1200, 1100, 1000, 940, 880]) {
      await page.setViewportSize({ width, height: 800 });
      await nextFrames(page, 3);
      const s = await page.evaluate(() => {
        const shown = (el: Element | null) => !!el && getComputedStyle(el).display !== 'none' && (el as HTMLElement).offsetWidth > 0;
        return {
          pill: shown(document.querySelector('#frame-pill')),
          words: shown(document.querySelector('#btn-file .btn-text')),
          others: [...document.querySelectorAll('.mode-btn:not([aria-checked="true"]) .mode-label')].every(shown),
          current: shown(document.querySelector('.mode-btn[aria-checked="true"] .mode-label')),
          fits: document.querySelector('.topbar')!.scrollWidth <= document.querySelector('.topbar')!.clientWidth + 1,
        };
      });
      expect(s.current, `${width}px`).toBe(true);
      if (!s.others) expect([s.pill, s.words], `${width}px`).toEqual([false, false]);
      if (!s.words) expect(s.pill, `${width}px`).toBe(false);
    }
  });

test('small fixes: the technical axis is one row; a region type with one region has no total; the edge list counts stations', async ({ page }) => {
  await openT8(page);
  // the technical axis: chip, name, delete, in one row; no coordinates
  const row = page.locator('#axis-row');
  await expect(row).toHaveClass(/arrow-row/);
  await expect(row.locator('.chip')).toHaveCount(1);
  await expect(row.locator('#axis-delete')).toHaveCount(1);
  await expect(page.locator('#axis-coords')).toHaveCount(0);
  await expect(page.locator('#axis-status')).toHaveCount(0);
  expect((await box(row.locator('.chip'))).y).toBeCloseTo((await box(row.locator('.arrow-meta'))).y, -1);

  // the regions' totals: a type with one region says its area in its row only
  const st = await state(page);
  const types = new Map<string, number>();
  for (const r of st.regions) types.set(r.type, (types.get(r.type) ?? 0) + 1);
  await expect.poll(() => page.locator('#region-totals .num-row').count()).toBeGreaterThanOrEqual(0);
  for (const [type, n] of types) if (n === 1) await expect(page.locator(`#region-total-${type}`), type).toHaveCount(0);

  // the edge angles' list: "{n} stations"
  await page.locator('#app-mode-measure').click();
  await openSection(page, 'edge-angle');
  const item = page.locator('#edge-angle-list .arrow-row').first();
  await expect(item.locator('.unit')).toHaveText('stations');
  await expect(item.locator('.arrow-len')).toHaveText(/^\d+$/);
});

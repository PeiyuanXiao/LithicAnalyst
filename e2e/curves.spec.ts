import type { Page } from '@playwright/test';
import { offCrest, OFFSET, ROOF, roofPly, roofPoint, type Vec3 } from './fixtures/meshes';
import { counts, curveClick, dist, download, draftLength, expect, loadMesh, openApp, parseCsv, state, test, toScreen, viewFromTop } from './helpers';

const CURVE_CSV_HEADER = 'specimen_id,curve_id,point_index,x,y,z,arc_length,anchor,closed,length,type,note,unit';

/** Screen position `px` pixels to the right of the ridge, at model height y. */
async function besideRidge(page: Page, y: number, px: number): Promise<{ x: number; y: number }> {
  const s = await toScreen(page, roofPoint(ROOF.crest(y), y));
  return { x: s.x + px, y: s.y };
}

const pick = (page: Page, s: { x: number; y: number }): Promise<Vec3 | null> =>
  page.evaluate(({ x, y }) => window.lithicanalyst.pick(x, y), s);

const maxOffCrest = (points: Vec3[]): number => Math.max(...points.map(offCrest));

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await loadMesh(page, roofPly());
  await viewFromTop(page);
});

test('with snapping on, points jump onto the ridge and the curve follows it', async ({ page }) => {
  await expect(page.locator('#snap-control')).toBeHidden();
  await page.keyboard.press('p');
  await expect(page.locator('#mode-curve')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#snap-control')).toBeVisible();
  await expect(page.locator('#snap-ridge')).toHaveAttribute('aria-checked', 'true');

  // clicks a little to the side of the ridge (within the snapping distance)
  const a = await besideRidge(page, 4, 7);
  const b = await besideRidge(page, 46, 7);
  for (const s of [a, b]) expect(offCrest((await pick(page, s))!)).toBeGreaterThan(0.4);
  await curveClick(page, a);
  await curveClick(page, b);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await counts(page)).curves).toBe(1);

  const c = (await state(page)).curves[0];
  expect(c).toMatchObject({ label: 'C1', closed: false, attributes: { type: 'other', note: '' } });
  expect(c.anchors).toHaveLength(2);
  for (const p of c.anchors) expect(offCrest(p)).toBeLessThan(0.4);
  // along the whole meander, not across it
  expect(maxOffCrest(c.points)).toBeLessThan(0.8);
  const xs = c.points.map((p) => p[0] - OFFSET[0]);
  expect(Math.max(...xs)).toBeGreaterThan(5);
  expect(Math.min(...xs)).toBeLessThan(-5);

  expect(await page.evaluate(() => window.lithicanalyst.selection())).toBe(c.id);
  await expect(page.locator('#curve-insp-label')).toHaveValue('C1');
  await expect(page.locator('#sec-curves .badge')).toHaveText('1');
  await page.keyboard.press('2');
  await expect(page.locator('#curve-field-type-ridge')).toHaveAttribute('aria-checked', 'true');
  expect((await state(page)).curves[0].attributes.type).toBe('ridge');
});

test('with snapping off, points stay where clicked and the curve takes the short way', async ({ page }) => {
  await page.keyboard.press('p');
  await page.locator('#snap-valley').click();
  await expect(page.locator('#snap-valley')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('s');
  await expect(page.locator('#snap-off')).toHaveAttribute('aria-checked', 'true');

  const a = await besideRidge(page, 4, 7);
  const b = await besideRidge(page, 46, 7);
  const hits = [(await pick(page, a))!, (await pick(page, b))!];
  await curveClick(page, a);
  await curveClick(page, b);
  // double-click finishes the curve
  await page.mouse.dblclick(b.x, b.y);
  await expect.poll(async () => (await counts(page)).curves).toBe(1);

  const c = (await state(page)).curves[0];
  expect(c.closed).toBe(false);
  expect(c.anchors).toHaveLength(2);
  c.anchors.forEach((p, i) => {
    // the mesh vertex nearest the click
    expect(dist(p, hits[i])).toBeLessThan(0.5);
    expect(offCrest(p)).toBeGreaterThan(0.3);
  });
  expect(maxOffCrest(c.points)).toBeGreaterThan(2);
});

test('Shift skips snapping, Backspace removes a point, the first point closes the curve; both kinds export to CSV', async ({ page }) => {
  await expect(page.locator('#export-curves-csv')).toBeDisabled();
  await page.keyboard.press('p');
  await expect(page.locator('#snap-ridge')).toHaveAttribute('aria-checked', 'true');

  // 10 px beside the ridge: a plain click would snap onto it
  const p1 = await besideRidge(page, 20, 10);
  await curveClick(page, p1, { shift: true });
  const first = (await page.evaluate(() => window.lithicanalyst.curveDraft()))![0];
  expect(offCrest(first)).toBeGreaterThan(0.6);

  await curveClick(page, await toScreen(page, roofPoint(-12, 22)), { shift: true });
  await curveClick(page, await toScreen(page, roofPoint(-16, 40)), { shift: true });
  await page.keyboard.press('Backspace');
  await expect.poll(() => draftLength(page)).toBe(2);
  await curveClick(page, await toScreen(page, roofPoint(-8, 32)), { shift: true });

  const close = await toScreen(page, first);
  await page.mouse.move(close.x, close.y, { steps: 3 });
  await page.keyboard.down('Shift');
  await page.mouse.click(close.x, close.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await counts(page)).curves).toBe(1);
  const loop = (await state(page)).curves[0];
  expect(loop.closed).toBe(true);
  expect(loop.anchors).toHaveLength(3);
  expect(dist(loop.anchors[2], roofPoint(-8, 32))).toBeLessThan(0.5);

  // an open curve, finished with Esc
  await curveClick(page, await toScreen(page, roofPoint(12, 8)), { shift: true });
  await curveClick(page, await toScreen(page, roofPoint(14, 18)), { shift: true });
  await curveClick(page, await toScreen(page, roofPoint(11, 28)), { shift: true });
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await counts(page)).curves).toBe(2);
  await page.keyboard.press('1');

  const st = await state(page);
  expect(st.curves.map((c) => [c.label, c.closed, c.attributes.type])).toEqual([
    ['C1', true, 'other'],
    ['C2', false, 'edge'],
  ]);

  await expect(page.locator('#export-curves-csv')).toBeEnabled();
  const csv = await download(page, () => page.locator('#export-curves-csv').click());
  expect(csv.name).toBe('roof_curves.csv');
  expect(csv.text).toBe(await page.evaluate(() => window.lithicanalyst.exportCurvesCsvText()));
  expect(csv.text.split('\n')[0]).toBe(CURVE_CSV_HEADER);
  const rows = parseCsv(csv.text);
  expect(rows).toHaveLength(st.curves.reduce((n, c) => n + c.points.length, 0));
  for (const c of st.curves) {
    const mine = rows.filter((r) => r.curve_id === c.label);
    expect(mine).toHaveLength(c.points.length);
    let arc = 0;
    mine.forEach((r, i) => {
      const p = c.points[i];
      if (i > 0) arc += dist(c.points[i - 1], p);
      expect(r.specimen_id).toBe('roof');
      expect(Number(r.point_index)).toBe(i);
      expect(Number(r.x)).toBeCloseTo(p[0], 5);
      expect(Number(r.y)).toBeCloseTo(p[1], 5);
      expect(Number(r.z)).toBeCloseTo(p[2], 5);
      expect(Number(r.arc_length)).toBeCloseTo(arc, 4);
      expect(r.anchor).toBe(c.anchorIndex.includes(i) ? 'true' : 'false');
      expect(r.closed).toBe(String(c.closed));
      expect(r.type).toBe(c.attributes.type);
      expect(r.unit).toBe('mm');
    });
    expect(mine.filter((r) => r.anchor === 'true')).toHaveLength(c.anchors.length);
    const closing = c.closed ? dist(c.points[c.points.length - 1], c.points[0]) : 0;
    for (const r of mine) expect(Number(r.length)).toBeCloseTo(arc + closing, 4);
  }
});

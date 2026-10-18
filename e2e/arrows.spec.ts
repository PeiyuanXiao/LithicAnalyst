import { roofPly, roofPoint } from './fixtures/meshes';
import { clickArrow, dist, dragArrow, expect, exportAvailable, exportFile, loadMesh, openApp, parseCsv, state, test, viewFromTop } from './helpers';

const ARROW_CSV_HEADER = 'specimen_id,scar_id,start_x,start_y,start_z,end_x,end_y,end_z,length,completeness,certainty,note,unit';

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await loadMesh(page, roofPly());
  await viewFromTop(page);
});

test('draws arrows by dragging and by two clicks, sets fields and exports the CSV', async ({ page }) => {
  // nothing to export before the first arrow
  expect(await exportAvailable(page, 'scar-vectors')).toBe(false);

  // press–drag–release (tool chosen with the A key)
  await page.keyboard.press('a');
  await expect(page.locator('#mode-draw')).toHaveAttribute('aria-checked', 'true');
  const drag = [roofPoint(-14, 10), roofPoint(-8, 22)] as const;
  await dragArrow(page, ...drag);

  // click at the origin, then at the termination (tool chosen with its button)
  await page.locator('#mode-select').click();
  await page.locator('#mode-draw').click();
  const clicks = [roofPoint(12, 30), roofPoint(9, 42)] as const;
  await clickArrow(page, ...clicks);

  let st = await state(page);
  expect(st.scars.map((a) => a.label)).toEqual(['S1', 'S2']);
  for (const [a, [s, e]] of st.scars.map((a, i) => [a, i === 0 ? drag : clicks] as const)) {
    expect(dist(a.vector!.start, s)).toBeLessThan(0.15);
    expect(dist(a.vector!.end, e)).toBeLessThan(0.15);
    expect(a.vector!.startNormal[2]).toBeGreaterThan(0.5);
    expect(a.attributes).toEqual({ completeness: 'point_complete', certainty: 'certain', note: '' });
  }
  await expect(page.locator('#sec-arrows .badge')).toHaveText('2');
  await expect(page.locator('#sec-arrows .arrow-row')).toHaveCount(2);

  // the new arrow is selected: number keys set its completeness
  expect(await page.evaluate(() => window.lithicanalyst.selection())).toBe(st.scars[1].id);
  await expect(page.locator('#insp-label')).toHaveValue('S2');
  await page.keyboard.press('3');
  await expect(page.locator('#field-completeness-point_truncated')).toHaveAttribute('aria-checked', 'true');

  // select S1 in the list and edit it in the inspector
  await page.locator('#sec-arrows .arrow-row', { hasText: 'S1' }).click();
  await expect(page.locator('#insp-label')).toHaveValue('S1');
  await page.locator('#field-completeness-both_missing').click();
  await page.locator('#field-certainty-uncertain').click();
  await page.locator('#field-note').fill('platform, "crushed"');

  st = await state(page);
  expect(st.scars[0].attributes).toEqual({ completeness: 'both_missing', certainty: 'uncertain', note: 'platform, "crushed"' });
  expect(st.scars[1].attributes.completeness).toBe('point_truncated');

  const csv = await exportFile(page, 'scar-vectors');
  expect(csv.name).toBe('roof_scar_vectors.csv');
  expect(csv.text).toBe(await page.evaluate(() => window.lithicanalyst.exportCsvText()));
  expect(csv.text.split('\n')[0]).toBe(ARROW_CSV_HEADER);
  const rows = parseCsv(csv.text);
  expect(rows).toHaveLength(2);
  rows.forEach((r, i) => {
    const a = st.scars[i];
    expect(r.specimen_id).toBe('roof');
    expect(r.scar_id).toBe(a.label);
    const start = [Number(r.start_x), Number(r.start_y), Number(r.start_z)] as const;
    const end = [Number(r.end_x), Number(r.end_y), Number(r.end_z)] as const;
    for (let k = 0; k < 3; k++) {
      expect(start[k]).toBeCloseTo(a.vector!.start[k], 5);
      expect(end[k]).toBeCloseTo(a.vector!.end[k], 5);
    }
    expect(Number(r.length)).toBeCloseTo(dist(a.vector!.start, a.vector!.end), 5);
    expect(r.completeness).toBe(a.attributes.completeness);
    expect(r.certainty).toBe(a.attributes.certainty);
    expect(r.note).toBe(a.attributes.note);
    expect(r.unit).toBe('mm');
  });
});

test('ignores an arrow that is too short and deletes the selected one', async ({ page }) => {
  await page.keyboard.press('a');
  const p = roofPoint(-10, 25);
  await dragArrow(page, p, roofPoint(-10, 33));
  const s = await page.evaluate((q) => window.lithicanalyst.project(q)!, p);
  // a press–drag of a few pixels ends on almost the same point
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(s.x + 6, s.y, { steps: 3 });
  await page.mouse.move(s.x + 0.4, s.y, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator('.toast-warn')).toContainText('too short');
  expect((await state(page)).scars).toHaveLength(1);

  await page.keyboard.press('Delete');
  expect((await state(page)).scars).toHaveLength(0);
  await expect(page.locator('#sec-arrows .badge')).toHaveText('0');
});

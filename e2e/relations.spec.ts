import type { Page } from '@playwright/test';
import { boxPly, boxPoint, type Vec3 } from './fixtures/meshes';
import { counts, curveClick, displayPanel, download, dragArrow, expect, exportFile, fileMenu, loadMesh, openApp, parseCsv, state, test, toScreen, viewFromTop, waitForMesh } from './helpers';

const pending = (page: Page) => page.evaluate(() => window.lithicanalyst.relationPending());
const highlighted = async (page: Page) => (await page.evaluate(() => window.lithicanalyst.highlighted())).sort();
const selection = (page: Page) => page.evaluate(() => window.lithicanalyst.selection());
const ids = async (page: Page) => (await state(page)).scars.map((s) => s.id);

async function click(page: Page, p: Vec3): Promise<void> {
  const s = await toScreen(page, p);
  await page.mouse.move(s.x, s.y, { steps: 2 });
  await page.mouse.click(s.x, s.y);
}

/** Relation tool: click two scars (points on their arrows or regions), then a choice in the dialog. */
async function relate(page: Page, a: Vec3, b: Vec3, choice: 'ab' | 'ba' | 'ind' | 'delete'): Promise<void> {
  await click(page, a);
  await expect.poll(() => pending(page)).not.toBeNull();
  await click(page, b);
  await page.locator(`#relation-pop [data-choice="${choice}"]`).click();
  await expect(page.locator('#relation-pop')).toHaveCount(0);
}

const scarRow = (page: Page, label: string) => page.locator('#scar-list .arrow-row').filter({ has: page.locator('.arrow-id', { hasText: new RegExp(`^${label}$`) }) });

/** Midpoint of the arrow drawn across the top face at y. */
const onArrow = (y: number) => boxPoint(0, y, 5);

/** Node centres of the Harris matrix panel, by label. */
async function nodes(page: Page): Promise<Record<string, number>> {
  return page.locator('#harris-body .hm-node').evaluateAll((els) =>
    Object.fromEntries(els.map((g) => [g.textContent ?? '', Number(g.querySelector('rect')!.getAttribute('y'))])),
  );
}

test('records relations by clicking arrows, checks them against the sequences live, and exports them', async ({ page, browser }) => {
  const ply = boxPly();
  await openApp(page);
  await loadMesh(page, ply);
  await viewFromTop(page);
  await page.keyboard.press('a');
  for (const y of [-6, 0, 6]) await dragArrow(page, boxPoint(-10, y, 5), boxPoint(10, y, 5));
  const [s1, s2, s3] = await ids(page);

  await page.keyboard.press('b');
  await expect(page.locator('#mode-relation')).toHaveAttribute('aria-checked', 'true');
  await click(page, onArrow(0));
  expect([await pending(page), await selection(page)]).toEqual([s2, s2]);
  await page.keyboard.press('Escape');
  expect(await pending(page)).toBeNull();
  await relate(page, onArrow(0), onArrow(-6), 'ab');
  let st = await state(page);
  expect(st.relations.map((r) => [r.a, r.b, r.kind])).toEqual([[s2, s1, 'a_cuts_b']]);
  // the new relation is selected and its two scars are highlighted
  expect(await selection(page)).toBe(st.relations[0].id);
  expect(await highlighted(page)).toEqual([s1, s2].sort());
  await relate(page, onArrow(6), onArrow(0), 'ab');
  await expect(page.locator('#relation-problems')).toHaveText('✓');
  // S1 cuts S3 closes a cycle
  await relate(page, onArrow(-6), onArrow(6), 'ab');
  await expect(page.locator('#relation-list .relation-row')).toHaveCount(3);
  await expect(page.locator('#relation-problems')).toHaveText('⚠ 1');
  expect((await page.evaluate(() => window.lithicanalyst.relationChecks())).cycles[0].sort()).toEqual([s1, s2, s3].sort());
  await page.keyboard.press('Escape');
  await page.locator('#relation-problems').click();
  await expect(page.locator('#relation-problem-list .problem-item')).toHaveCount(1);
  expect(await highlighted(page)).toEqual([s1, s2, s3].sort());
  // the same pair again: the dialog offers to delete it
  await relate(page, onArrow(6), onArrow(-6), 'delete');
  await expect(page.locator('#relation-problems')).toHaveText('✓');
  await expect(page.locator('#relation-problem-list')).toBeHidden();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#relation-problems')).toHaveText('⚠ 1');
  await expect(page.locator('#relation-problem-list')).toBeHidden();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#relation-problems')).toHaveText('✓');
  expect((await state(page)).relations).toHaveLength(2);

  // Harris matrix: later scars higher, only direct relations drawn
  await page.locator('#harris-show').check();
  await expect(page.locator('#harris-panel')).toBeVisible();
  await expect(page.locator('#harris-body .hm-node')).toHaveCount(3);
  let y = await nodes(page);
  expect(y.S3).toBeLessThan(y.S2);
  expect(y.S2).toBeLessThan(y.S1);
  await expect(page.locator('#harris-body line')).toHaveCount(2);
  // S3 cuts S1 is implied by S3 > S2 > S1: no extra line
  await page.keyboard.press('b');
  await relate(page, onArrow(6), onArrow(-6), 'ab');
  await expect(page.locator('#harris-body line')).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+z');
  // node ↔ selection
  await page.locator('#harris-body .hm-node', { hasText: 'S1' }).click();
  expect(await selection(page)).toBe(s1);
  await expect(page.locator('#harris-body .hm-node', { hasText: 'S1' }).locator('rect')).toHaveAttribute('stroke-width', '3');

  // change a relation in the sidebar: S3 – S2 cannot tell
  await page.locator('#relation-list .relation-row').nth(1).click();
  await page.locator('#relation-kind-ind').click();
  expect((await state(page)).relations[1]).toMatchObject({ a: s3, b: s2, kind: 'indeterminate' });
  await expect(page.locator('#harris-body line')).toHaveCount(1);
  // S3 has no "cuts" relation left: it stands apart, in the unrelated column
  expect((await page.evaluate(() => window.lithicanalyst.harris())).unrelated).toEqual([s3]);
  y = await nodes(page);
  expect(Object.keys(y).sort()).toEqual(['S1', 'S2', 'S3']);
  await page.locator('#relation-kind-ab').click();
  await expect(page.locator('#harris-body line')).toHaveCount(2);

  // sequences: Q1 (earlier) and Q2; S1, S2 in Q1, S3 in Q2
  await page.locator('#sequence-add').click();
  await page.locator('#sequence-add').click();
  await expect(page.locator('#sequence-list .sequence-row')).toHaveCount(2);
  for (const [i, q] of [[0, 'Q1'], [1, 'Q1'], [2, 'Q2']] as const) {
    await scarRow(page, `S${i + 1}`).click();
    await page.locator('#scar-sequence').selectOption({ label: q });
  }
  await expect(page.locator('#relation-problems')).toHaveText('✓');
  st = await state(page);
  expect(st.sequences.map((q) => [q.label, q.scarIds])).toEqual([
    ['Q1', [s1, s2]],
    ['Q2', [s3]],
  ]);
  // ordered within Q1: S1 then S2 agrees with "S2 cuts S1"; swapping them does not
  await page.locator('#sequence-list .sequence-row', { hasText: 'Q1' }).click();
  await page.locator('#sequence-ordered').check();
  await page.locator('#sequence-members .member-row', { hasText: 'S2' }).locator('[data-act="up"]').click();
  await expect(page.locator('#relation-problems')).toHaveText('⚠ 1');
  await page.locator('#relation-problems').click();
  await expect(page.locator('#relation-problem-list .problem-item')).toHaveText([/S2.*S1.*Q1/]);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#relation-problems')).toHaveText('✓');
  // Q2 before Q1 contradicts "S3 cuts S2"
  await page.locator('#sequence-list .sequence-row', { hasText: 'Q2' }).click();
  await page.locator('#sequence-earlier').click();
  await expect(page.locator('#relation-problems')).toHaveText('⚠ 1');
  await expect(page.locator('#relation-problem-list')).toBeHidden();
  await page.locator('#relation-problems').click();
  await page.locator('#relation-problem-list .problem-item').first().click();
  await expect(page.locator('#relation-problem-list .problem-item.is-focused')).toHaveCount(1);
  expect(await highlighted(page)).toEqual([s2, s3].sort());
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#relation-problems')).toHaveText('✓');
  // the matrix frames the sequences
  await expect(page.locator('#harris-body .hm-box')).toHaveCount(2);

  // colour by sequence: Q1 members light to dark, Q2 another hue
  await displayPanel(page);
  await page.locator('#arrow-color').selectOption('sequence');
  await page.keyboard.press('Escape');
  const chip = (label: string) => scarRow(page, label).locator('.chip').getAttribute('style');
  await page.keyboard.press('Escape');
  expect(new Set([await chip('S1'), await chip('S2'), await chip('S3')]).size).toBe(3);

  // exports
  const rel = await exportFile(page, 'relations');
  expect(rel.name).toBe('box_relations.csv');
  expect(parseCsv(rel.text).map((r) => [r.specimen_id, r.scar_a, r.scar_b, r.relation])).toEqual([
    ['box', 'S2', 'S1', 'a_cuts_b'],
    ['box', 'S3', 'S2', 'a_cuts_b'],
  ]);
  const ser = await exportFile(page, 'series');
  expect(ser.name).toBe('box_series.csv');
  expect(ser.text).toBe('specimen_id,series_id,series_order,scar_id,order_in_series\nbox,Q1,1,S1,1\nbox,Q1,1,S2,2\nbox,Q2,2,S3,\n');
  const svg = await download(page, () => page.locator('#harris-svg').click());
  expect(svg.name).toBe('box_harris.svg');
  expect(svg.text).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  expect(svg.text.match(/class="hm-node"/g)).toHaveLength(3);

  // deleting a scar takes it out of its relations and sequence; undo brings all back
  const before = await state(page);
  await scarRow(page, 'S2').click();
  await page.keyboard.press('Delete');
  st = await state(page);
  expect([st.scars.length, st.relations.length, st.sequences[0].scarIds]).toEqual([2, 0, [s1]]);
  await page.keyboard.press('ControlOrMeta+z');
  st = await state(page);
  expect([st.relations, st.sequences]).toEqual([before.relations, before.sequences]);

  // save, reopen
  const saved = await download(page, () => page.locator('#btn-save-project').click());
  const file = JSON.parse(saved.text);
  expect(file.annotations.relations).toEqual(st.relations);
  expect(file.derived.relations).toMatchObject({ count: 0, direct: [{ later: s2, earlier: s1 }, { later: s3, earlier: s2 }] });
  const context = await browser.newContext();
  const fresh = await context.newPage();
  await openApp(fresh);
  await loadMesh(fresh, ply);
  const chooser = fresh.waitForEvent('filechooser');
  await fileMenu(fresh, '#btn-open-project');
  await (await chooser).setFiles({ name: saved.name, mimeType: 'application/json', buffer: Buffer.from(saved.text) });
  await waitForMesh(fresh, 'box.ply');
  await expect.poll(async () => (await state(fresh)).sequences).toEqual(st.sequences);
  expect((await state(fresh)).relations).toEqual(st.relations);
  await expect(fresh.locator('#harris-panel')).toBeHidden();
  await context.close();
});

test('picks a scar known only by its region, and selects the region from the matrix', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, boxPly());
  await viewFromTop(page);
  // a closed curve around a rectangle of the top face; a region inside it (a scar without an arrow)
  await page.keyboard.press('p');
  for (const p of [boxPoint(-10, -5, 5), boxPoint(10, -5, 5), boxPoint(10, 5, 5), boxPoint(-10, 5, 5)]) await curveClick(page, await toScreen(page, p), { shift: true });
  const first = await toScreen(page, boxPoint(-10, -5, 5));
  await page.mouse.move(first.x, first.y, { steps: 3 });
  await page.keyboard.down('Shift');
  await page.mouse.click(first.x, first.y);
  await page.keyboard.up('Shift');
  await expect.poll(() => counts(page)).toEqual({ arrows: 0, curves: 1 });
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.regionCount())).toBe(2);
  await page.keyboard.press('r');
  await click(page, boxPoint(3, -1.3, 5));
  await expect.poll(async () => (await state(page)).regions.length).toBe(1);
  // an arrow outside the rectangle
  await page.keyboard.press('a');
  await dragArrow(page, boxPoint(-15, 8, 5), boxPoint(15, 8, 5));
  let st = await state(page);
  const [area, arrow] = st.scars.map((s) => s.id);
  expect(st.scars[0].vector).toBeNull();

  await page.keyboard.press('b');
  await click(page, boxPoint(0, 2, 5));
  expect([await pending(page), await selection(page)]).toEqual([area, st.regions[0].id]);
  // a click on the cortex-free rest of the box (no region) is ignored
  await click(page, boxPoint(15, -8, 5));
  expect(await pending(page)).toBe(area);
  await click(page, onArrow(8));
  await page.locator('#relation-pop [data-choice="ba"]').click();
  st = await state(page);
  expect(st.relations.map((r) => [r.a, r.b, r.kind])).toEqual([[arrow, area, 'a_cuts_b']]);

  await page.locator('#harris-show').check();
  await page.locator('#harris-body .hm-node', { hasText: 'S1' }).click();
  expect(await selection(page)).toBe(st.regions[0].id);
  await expect(page.locator('#harris-body .hm-node', { hasText: 'S1' }).locator('rect')).toHaveAttribute('stroke-width', '3');
});

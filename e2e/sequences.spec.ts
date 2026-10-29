import type { Page } from '@playwright/test';
import { boxPly, boxPoint, type Vec3 } from './fixtures/meshes';
import { counts, curveClick, dragArrow, expect, loadMesh, openApp, openSection, state, test, toScreen, viewFromTop } from './helpers';

const sequences = async (page: Page) => (await state(page)).sequences.map((q) => [q.label, q.scarIds]);
const faded = async (page: Page) => (await page.evaluate(() => window.lithicanalyst.fadedArrows())).sort();
const harrisShown = (page: Page) => page.evaluate(() => window.lithicanalyst.harrisShown());
const chips = (page: Page) => page.locator('#sequence-bar .seq-chip:not(.seq-add)');

async function click(page: Page, p: Vec3): Promise<void> {
  const s = await toScreen(page, p);
  await page.mouse.move(s.x, s.y, { steps: 2 });
  await page.mouse.click(s.x, s.y);
}

/** Midpoint of the arrow drawn across the top face at y. */
const onArrow = (y: number) => boxPoint(0, y, 5);

test('the sequence tool: a click puts a scar into the current sequence or takes it out; the order follows the relations', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, boxPly());
  await viewFromTop(page);
  await page.keyboard.press('a');
  for (const y of [-6, 0, 6]) await dragArrow(page, boxPoint(-10, y, 5), boxPoint(10, y, 5));
  const [s1, s2, s3] = (await state(page)).scars.map((s) => s.id);

  await expect(page.locator('#sequence-bar')).toBeHidden();
  expect(await harrisShown(page)).toBe(false);
  await page.keyboard.press('q');
  await expect(page.locator('#mode-sequence')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#sequence-bar')).toBeVisible();
  await expect(chips(page)).toHaveCount(0);
  // the matrix comes with the tool; every scar is faded while it is in no sequence
  expect(await harrisShown(page)).toBe(true);
  expect(await faded(page)).toEqual([s1, s2, s3].sort());

  // the first click starts Q1
  await click(page, onArrow(0));
  await expect.poll(() => sequences(page)).toEqual([['Q1', [s2]]]);
  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page).first()).toHaveAttribute('aria-checked', 'true');
  await expect(chips(page).first().locator('.seq-chip-count')).toHaveText('1');
  expect(await faded(page)).toEqual([s1, s3].sort());

  // N: a new sequence, made current; clicks fill it, a second click takes a scar out again
  await page.keyboard.press('n');
  await expect(chips(page)).toHaveCount(2);
  await expect(chips(page).nth(1)).toHaveAttribute('aria-checked', 'true');
  await click(page, onArrow(-6));
  await click(page, onArrow(6));
  await expect.poll(() => sequences(page)).toEqual([['Q1', [s2]], ['Q2', [s1, s3]]]);
  await click(page, onArrow(6));
  await expect.poll(() => sequences(page)).toEqual([['Q1', [s2]], ['Q2', [s1]]]);
  // 1 chooses Q1: S1 moves there from Q2; one undo step per click
  await page.keyboard.press('1');
  await expect(chips(page).first()).toHaveAttribute('aria-checked', 'true');
  await click(page, onArrow(-6));
  await expect.poll(() => sequences(page)).toEqual([['Q1', [s2, s1]], ['Q2', []]]);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => sequences(page)).toEqual([['Q1', [s2]], ['Q2', [s1]]]);
  // the "+" of the bar
  await page.locator('#sequence-bar-add').click();
  await expect(chips(page)).toHaveCount(3);
  expect(await page.evaluate(() => window.lithicanalyst.currentSequence())).toBe((await state(page)).sequences[2].id);
  // the selection is left alone: digits here choose sequences, not the completeness
  await page.keyboard.press('2');
  await expect(chips(page).nth(1)).toHaveAttribute('aria-checked', 'true');
  expect((await state(page)).scars.every((s) => s.attributes.completeness === 'point_complete')).toBe(true);

  // the matrix closed by hand stays away until the tool changes
  await page.locator('#harris-close').click();
  expect(await harrisShown(page)).toBe(false);

  // S2 cuts S1 (relation tool): S1's sequence Q2 now comes before Q1, in the same undo step
  await page.keyboard.press('b');
  expect(await harrisShown(page)).toBe(true);
  await expect(page.locator('#sequence-bar')).toBeHidden();
  expect(await faded(page)).toEqual([]);
  await click(page, onArrow(0));
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.relationPending())).toBe(s2);
  await click(page, onArrow(-6));
  await expect.poll(() => sequences(page)).toEqual([['Q2', [s1]], ['Q1', [s2]], ['Q3', []]]);
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+z');
  expect([(await state(page)).relations.length, await sequences(page)]).toEqual([0, [['Q1', [s2]], ['Q2', [s1]], ['Q3', []]]]);

  // leaving the tools: the user's own settings again (no matrix, no fading, digits set fields)
  await page.keyboard.press('v');
  expect(await harrisShown(page)).toBe(false);
  expect(await faded(page)).toEqual([]);
  await openSection(page, 'arrows');
  await page.locator('#scar-list .arrow-row').first().click();
  await page.keyboard.press('2');
  expect((await state(page)).scars[0].attributes.completeness).toBe('bulb_complete');
  await expect(page.locator('#sequence-bar')).toBeHidden();
});

test('in the relation tool, scars whose regions meet and are not judged yet are marked, and "next pair" turns to them', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, boxPly());
  await viewFromTop(page);
  // a closed curve around a rectangle of the top face: two pieces of surface
  await page.keyboard.press('p');
  for (const p of [boxPoint(-10, -5, 5), boxPoint(10, -5, 5), boxPoint(10, 5, 5), boxPoint(-10, 5, 5)]) await curveClick(page, await toScreen(page, p), { shift: true });
  const first = await toScreen(page, boxPoint(-10, -5, 5));
  await page.mouse.move(first.x, first.y, { steps: 3 });
  await page.keyboard.down('Shift');
  await page.mouse.click(first.x, first.y);
  await page.keyboard.up('Shift');
  await expect.poll(() => counts(page)).toEqual({ arrows: 0, curves: 1 });
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.regionCount())).toBe(2);
  // both pieces scar regions (each with a scar of its own)
  await page.keyboard.press('r');
  await click(page, boxPoint(3, -1.3, 5));
  await click(page, boxPoint(15, 8, 5));
  await expect.poll(async () => (await state(page)).regions.length).toBe(2);
  const [a, b] = (await state(page)).scars.map((s) => s.id);
  // they meet along the whole curve (2 × (20 + 10))
  await expect.poll(async () => (await page.evaluate(() => window.lithicanalyst.borders())).all.length).toBe(1);
  const border = (await page.evaluate(() => window.lithicanalyst.borders())).all[0];
  expect([border[0], border[1]].sort()).toEqual([a, b].sort());
  expect(border[2]).toBeCloseTo(60, 0);

  // only the relation tool draws the borders and counts them
  expect(await page.evaluate(() => window.lithicanalyst.borderLines())).toBe(0);
  await expect(page.locator('#relation-unjudged')).toBeHidden();
  await page.keyboard.press('b');
  await expect(page.locator('#relation-unjudged')).toBeVisible();
  await expect(page.locator('#relation-unjudged-count')).toHaveText('Adjacent pairs not judged: 1');
  expect(await page.evaluate(() => window.lithicanalyst.borderLines())).toBeGreaterThan(0);
  // "next pair": the view turns to a point on the border
  await page.locator('#relation-next-pair').click();
  const target = (await page.evaluate(() => window.lithicanalyst.viewTarget()))!;
  expect(target[2]).toBeCloseTo(boxPoint(0, 0, 5)[2], 1);
  const onCurve = Math.abs(Math.abs(target[0] - boxPoint(0, 0, 0)[0]) - 10) < 0.6 || Math.abs(Math.abs(target[1] - boxPoint(0, 0, 0)[1]) - 5) < 0.6;
  expect(onCurve).toBe(true);
  // judged — even "cannot tell" — they are no longer marked
  await page.evaluate(() => window.lithicanalyst.view([0, 0, 1], [0, 1, 0]));
  await click(page, boxPoint(3, -1.3, 5));
  await click(page, boxPoint(15, 8, 5));
  await page.keyboard.press('3');
  expect((await state(page)).relations.map((r) => r.kind)).toEqual(['indeterminate']);
  await expect(page.locator('#relation-unjudged')).toBeHidden();
  expect(await page.evaluate(() => window.lithicanalyst.borderLines())).toBe(0);
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#relation-unjudged')).toBeVisible();
  await page.keyboard.press('v');
  expect(await page.evaluate(() => window.lithicanalyst.borderLines())).toBe(0);
});

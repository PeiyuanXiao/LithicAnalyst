import type { Page } from '@playwright/test';
import { displayPanel, expect, openSection, state, test } from './helpers';
import { openT8 } from './t8Setup';

/** IPA (32a) on T8: the plane of a band of the ventral face, from the bulb's far end to 0.75 of the technical length. */

const flake = (page: Page) => page.evaluate(() => window.lithicanalyst.flake());
const hint = (page: Page) => page.evaluate(() => window.lithicanalyst.measureHint());
/** Where a mark of the band is drawn on the longitudinal section (its height in the drawing: larger is nearer P). */
const markAt = (page: Page, id: string) => page.locator(id).getAttribute('y1').then(Number);

test('IPA: the band\'s marks on the profile, what it was fitted to and what left out on the model; the BSA\'s level moves the band, and undo', async ({ page, pageErrors }) => {
  await openT8(page);
  await expect.poll(async () => (await flake(page))?.measures?.ipa ?? null, { timeout: 30_000 }).not.toBeNull();
  const first = (await flake(page))!;
  // the platform (y = 0) square to the flat ventral face: 90° (coarse mesh; ±0.2° on the fine one in tests/bulb.test.ts)
  expect(Math.abs(first.measures!.ipa! - 90)).toBeLessThan(1);
  expect(first.ipaBand!.fallback).toBe(false);
  expect(first.ipaBand!.from).toBeGreaterThan(5);
  expect(first.ipaBand!.to).toBeCloseTo(0.75 * first.measures!.tech_length!, 6);

  // the profile panel: the band's two marks on the section, its line, the angle at P
  await displayPanel(page);
  await page.locator('#profile-show').check();
  await page.keyboard.press('Escape');
  for (const id of ['#profile-ipa-from', '#profile-ipa-to', '#profile-ipa-line', '#profile-ipa-arc']) await expect(page.locator(id)).toBeAttached();
  const from = await markAt(page, '#profile-ipa-from');
  expect(from).toBeGreaterThan(await markAt(page, '#profile-ipa-to'));

  // hovering IPA: the triangles fitted, those left out (the bulb's among them), the plane over the band, its line, the platform line, the arc
  await page.locator('#app-mode-measure').click();
  await openSection(page, 'flake');
  await page.locator('#flake-ipa').hover();
  await expect.poll(async () => (await hint(page)).key).toBe('flake:ipa');
  const h = await hint(page);
  expect(h.prims.map((p) => `${p.kind}:${p.part}`)).toEqual(expect.arrayContaining(['faces:band', 'faces:left-out', 'patch:band-plane', 'line:band-line', 'line:platform-line', 'arc:arc']));
  expect(h.drawn).toMatchObject({ faces: 2, patches: 1, arcs: 1 });
  await page.mouse.move(0, 0);

  // the bulb page: a higher level, a smaller bulb; the band starts nearer P, IPA with it, and the mark moves
  await page.locator('#profile-page-bulb').click();
  await page.locator('#bulb-level').fill('0.3');
  await page.locator('#bulb-level').press('Enter');
  await expect.poll(async () => (await state(page)).flake.bsa?.level).toBe(0.3);
  await expect.poll(async () => (await flake(page))!.ipaBand!.from).toBeLessThan(first.ipaBand!.from - 0.1);
  expect((await flake(page))!.measures!.ipa).not.toBe(first.measures!.ipa);
  await page.locator('#profile-page-section').click();
  await expect.poll(() => markAt(page, '#profile-ipa-from')).toBeGreaterThan(from);

  // undo: the level, the band, IPA and the mark as they were
  await page.locator('#btn-undo').click();
  await expect.poll(async () => (await state(page)).flake.bsa?.level ?? 0.1).toBe(0.1);
  await expect.poll(async () => (await flake(page))!.ipaBand!.from).toBeCloseTo(first.ipaBand!.from, 9);
  expect((await flake(page))!.measures!.ipa).toBeCloseTo(first.measures!.ipa!, 9);
  await expect.poll(() => markAt(page, '#profile-ipa-from')).toBeCloseTo(from, 3);
  expect(pageErrors).toEqual([]);
});

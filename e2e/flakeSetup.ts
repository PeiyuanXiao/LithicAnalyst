import type { Page } from '@playwright/test';
import { T1, type Vec3 } from './fixtures/meshes';
import { curveClick, expect, nextFrames, state, toScreen } from './helpers';

/** T1 annotated as a flake, as the flake tests and the hints' use it. */

/** Draw the technical axis on T1: from the ventral side, the start snapped onto the ridge at P. */
export async function drawAxis(page: Page): Promise<void> {
  await page.evaluate(() => window.lithicanalyst.view([0, 0, -1], [0, 1, 0]));
  await nextFrames(page);
  await page.evaluate(() => window.lithicanalyst.snap.prepare('ridge'));
  await page.keyboard.press('t');
  await expect(page.locator('#mode-axis')).toHaveAttribute('aria-checked', 'true');
  // a little beside P, on the ventral face
  const s = await toScreen(page, [0, 0.4, 0]);
  const e = await toScreen(page, T1.A);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(e.x, e.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.flake()?.axis?.matrix ?? null)).not.toBeNull();
}

/** Draw the platform outline round the P–E face, seen square on, and give it its type (key 5). */
export async function drawOutline(page: Page): Promise<void> {
  await page.evaluate(() => window.lithicanalyst.view([0, -0.98, 0.196], [0, 0.196, 0.98]));
  await nextFrames(page);
  await page.keyboard.press('p');
  const corner = (x: number, f: number): Vec3 => [x, -2 * f, 10 * f];
  // Shift: no snapping; a little inside the corners
  const a = await toScreen(page, corner(-14.8, 0.02)), b = await toScreen(page, corner(14.8, 0.02));
  const c = await toScreen(page, corner(14.8, 0.98)), d = await toScreen(page, corner(-14.8, 0.98));
  for (const at of [a, b, c, d]) await curveClick(page, at, { shift: true });
  await page.mouse.move(a.x, a.y, { steps: 3 });
  await page.keyboard.down('Shift');
  await page.mouse.click(a.x, a.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await state(page)).curves.length).toBe(1);
  expect((await state(page)).curves[0].closed).toBe(true);
  await page.keyboard.press('v');
  await page.keyboard.press('5');
  await expect.poll(async () => (await state(page)).curves[0].attributes.type).toBe('platform_outline');
}

/** The two platform ends placed by hand, beside the outline's corners, with no edge yet to give them (as a file from before they followed the curves has them). */
export async function placeEnds(page: Page): Promise<void> {
  for (const x of [-14.9, 14.9]) await page.evaluate((p) => window.lithicanalyst.placePlatformEnd(p), [x, -0.02, 0.1] as Vec3);
  expect((await state(page)).landmarks.filter((l) => l.code === 'platform_end')).toHaveLength(2);
}

export async function annotate(page: Page): Promise<void> {
  await drawAxis(page);
  await drawOutline(page);
  await placeEnds(page);
  await page.keyboard.press('v');
}

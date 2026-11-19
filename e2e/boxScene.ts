import type { Page } from '@playwright/test';
import { boxPly, boxPoint, type Vec3 } from './fixtures/meshes';
import { counts, curveClick, dragArrow, expect, loadMesh, nextFrames, openApp, state, toScreen } from './helpers';

/** The box seen from above, as the tests of stage 31 use it: an arrow, a rectangle on the top face (a curve), a scar region in it, cortex around it and a landmark. */

export const regions = (page: Page) => page.evaluate(() => window.lithicanalyst.regions());
export const drawn = (page: Page) => page.evaluate(() => window.lithicanalyst.drawn());

export async function clickAt(page: Page, p: Vec3): Promise<void> {
  const s = await toScreen(page, p);
  await page.mouse.click(s.x, s.y);
}

export async function boxScene(page: Page, type?: 'core' | 'flake' | 'generic'): Promise<{ arrow: string; curve: string; scar: string; cortex: string; landmark: string }> {
  await openApp(page, type);
  await loadMesh(page, boxPly());
  await page.evaluate(() => window.lithicanalyst.view([0, 0, 1], [0, 1, 0]));
  await nextFrames(page);
  await page.keyboard.press('a');
  await dragArrow(page, boxPoint(-5, 0, 5), boxPoint(5, 2, 5));
  // a closed curve round a 20 × 10 rectangle of the top face
  await page.keyboard.press('p');
  for (const p of [boxPoint(-10, -5, 5), boxPoint(10, -5, 5), boxPoint(10, 5, 5), boxPoint(-10, 5, 5)]) await curveClick(page, await toScreen(page, p), { shift: true });
  const first = await toScreen(page, boxPoint(-10, -5, 5));
  await page.mouse.move(first.x, first.y, { steps: 3 });
  await page.keyboard.down('Shift');
  await page.mouse.click(first.x, first.y);
  await page.keyboard.up('Shift');
  await expect.poll(() => counts(page)).toEqual({ arrows: 1, curves: 1 });
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.regionCount())).toBe(2);
  // the regions: inside (a scar on a core, the user's word on a generic specimen), and cortex round it
  await page.keyboard.press('r');
  await clickAt(page, boxPoint(3, -1.3, 5));
  await expect.poll(async () => (await state(page)).regions.length).toBe(1);
  await clickAt(page, boxPoint(15, 7, 5));
  await expect.poll(async () => (await state(page)).regions.length).toBe(2);
  if (type !== 'generic') {
    await page.keyboard.press('2');
    await expect.poll(async () => (await state(page)).regions[1].type).toBe('cortex');
  }
  await expect.poll(async () => (await regions(page))?.results.filter((r) => r.area !== null).length).toBe(2);
  // a landmark at a corner of the top face
  await page.keyboard.press('k');
  const lm = await toScreen(page, boxPoint(-15, 7, 5));
  await page.mouse.move(lm.x, lm.y, { steps: 2 });
  await page.keyboard.down('Shift');
  await page.mouse.click(lm.x, lm.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await state(page)).landmarks.length).toBe(1);
  await page.keyboard.press('v');
  const st = await state(page);
  return { arrow: st.scars.find((s) => s.vector)!.id, curve: st.curves[0].id, scar: st.regions[0].id, cortex: st.regions[1].id, landmark: st.landmarks[0].id };
}

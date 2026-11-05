import type { Page } from '@playwright/test';
import { heightAt, T4, toolPly, type MeshFile, type Vec3 } from './fixtures/meshes';
import { closeDraftToward, curveClick, expect, loadMesh, nextFrames, specimenPanel, state, toScreen } from './helpers';

/** The stepped tool as a flake, as the retouch tests use it. */

const ON = (r: number, deg: number, z: number): Vec3 => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180), z];
export const onTool = (r: number, deg: number): Vec3 => ON(r, deg, heightAt(r));
const rimPoint = (deg: number): Vec3 => ON(0.97 * T4.radius, deg, 0.03 * T4.upper);
const around = (count: number) => Array.from({ length: count }, (_, k) => (360 * k) / count);

export const retouch = (page: Page) => page.evaluate(() => window.lithicanalyst.retouch());

export async function setType(page: Page, type: 'core' | 'flake'): Promise<void> {
  await specimenPanel(page);
  await page.locator('#specimen-type').selectOption(type);
  await page.keyboard.press('Escape');
}

export const look = async (page: Page, toward: Vec3, up: Vec3): Promise<void> => {
  await page.evaluate(([t, u]) => window.lithicanalyst.view(t, u), [toward, up] as [Vec3, Vec3]);
  await nextFrames(page);
};

/** A closed curve through these points, seen from above; then its type by its key. */
export async function drawLoop(page: Page, points: Vec3[], key: string, inward: Vec3): Promise<string> {
  const n = (await state(page)).curves.length;
  await look(page, [0, 0, 1], [0, 1, 0]);
  await page.evaluate(() => window.lithicanalyst.snap.prepare('ridge'));
  await page.keyboard.press('p');
  for (const p of points) await curveClick(page, await toScreen(page, p));
  await closeDraftToward(page, inward);
  await expect.poll(async () => (await state(page)).curves[n]?.closed ?? false).toBe(true);
  await page.keyboard.press('v');
  await page.keyboard.press(key);
  return (await state(page)).curves[n].id;
}

/** Click on the model with the region tool, and give what comes selected its type by its key. */
export async function regionAt(page: Page, p: Vec3, key: string): Promise<string> {
  const n = (await state(page)).regions.length;
  const s = await toScreen(page, p);
  await page.mouse.click(s.x, s.y);
  await expect.poll(async () => (await state(page)).regions.length).toBe(n + 1);
  await page.keyboard.press(key);
  return (await state(page)).regions[n].id;
}

/** The stepped tool as a flake: its edge, the two borders of retouch, the two layers, the two faces. `file`: of that model (an open one, say). `inverse`: the retouched top as the ventral face. */
export async function annotatedTool(page: Page, file: MeshFile = toolPly(), inverse = false): Promise<{ edge: string; first: string; second: string }> {
  await loadMesh(page, file);
  await setType(page, 'flake');
  const edge = await drawLoop(page, around(4).map(rimPoint), '2', [0, 0, T4.upper]);
  await expect.poll(async () => (await state(page)).curves[0].attributes.type).toBe('edge');
  await drawLoop(page, around(8).map((d) => onTool(24, d)), '6', [0, 0, 8]);
  await expect.poll(async () => (await state(page)).curves[1].attributes.type).toBe('retouch');
  await drawLoop(page, around(8).map((d) => onTool(12, d)), '6', [0, 0, 8]);
  await look(page, [0, 0, 1], [0, 1, 0]);
  await page.keyboard.press('r');
  const first = await regionAt(page, onTool(27, 45), '8');
  const second = await regionAt(page, onTool(18, 45), '8');
  await page.keyboard.press('Shift+Digit2');
  await expect.poll(async () => (await state(page)).regions[1].retouchLayer).toBe(2);
  // the two faces, by hand: there is no technical axis to tell them
  await regionAt(page, onTool(5, 45), inverse ? '6' : '7');
  await look(page, [0, 0, -1], [0, 1, 0]);
  await regionAt(page, [10, 10, 0], inverse ? '7' : '6');
  await expect.poll(async () => (await state(page)).regions.map((r) => r.type)).toEqual(['retouch', 'retouch', ...(inverse ? ['ventral', 'dorsal'] : ['dorsal', 'ventral'])]);
  await page.keyboard.press('v');
  return { edge, first, second };
}


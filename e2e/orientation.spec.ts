import type { Page } from '@playwright/test';
import { boxPly, boxPoint } from './fixtures/meshes';
import { dragArrow, expect, loadMesh, nextFrames, openApp, state, test } from './helpers';

type V = [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const frame = async (page: Page) => (await state(page)).specimen.frame;
const auto = (page: Page) => page.evaluate(() => window.lithicanalyst.autoMeasurements());
const camera = (page: Page) => page.evaluate(() => [window.lithicanalyst.towardViewer()!, window.lithicanalyst.cameraUp()!] as const);
const row = (m: number[], r: number): V => [m[4 * r], m[4 * r + 1], m[4 * r + 2]];

test('sets the specimen frame from the view, a plane and an arrow; turns it; measurements follow', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, boxPly());
  // an arrow along +X on the top face, and a plane (all vertices: normal +Z)
  await page.evaluate(() => window.lithicanalyst.view([0, 0, 1], [0, 1, 0]));
  await nextFrames(page);
  await page.keyboard.press('a');
  await dragArrow(page, boxPoint(-10, 0, 5), boxPoint(10, 0, 5));
  await page.keyboard.press('m');
  await page.locator('#plane-add').click();
  await expect.poll(async () => (await auto(page))?.frame).toBe('principal');

  await page.keyboard.press('m');
  await expect(page.locator('#sec-orientation')).toBeVisible();
  await expect(page.locator('#frame-status')).toHaveText('Not set');
  await expect(page.locator('#frame-rot-cw')).toBeDisabled();

  // looking at the top face from the front-left, up = +Y on screen
  await page.evaluate(() => window.lithicanalyst.view([0, 0, 1], [0, 1, 0]));
  await nextFrames(page);
  await page.locator('#frame-from-view').click();
  await expect(page.locator('#frame-status')).toHaveText('view');
  let f = (await frame(page))!;
  expect(dot(row(f.matrix, 2), [0, 0, 1])).toBeCloseTo(1, 6);
  expect(dot(row(f.matrix, 1), [0, 1, 0])).toBeCloseTo(1, 6);
  // length along the frame's Y (the box's 20), width along X (40)
  await expect.poll(async () => [(await auto(page))!.frame, (await auto(page))!.length, (await auto(page))!.width]).toEqual(['specimen', 20, 40]);

  // turn left 90°: what was to the right is up
  await page.locator('#frame-rot-ccw').click();
  f = (await frame(page))!;
  expect(dot(row(f.matrix, 1), [1, 0, 0])).toBeCloseTo(1, 6);
  await expect.poll(async () => (await auto(page))!.length).toBeCloseTo(40, 6);
  // the camera follows the frame
  const [toward, up] = await camera(page);
  expect(dot(toward, [0, 0, 1])).toBeCloseTo(1, 6);
  expect(dot(up, [1, 0, 0])).toBeCloseTo(1, 6);

  // front view from the plane; vertical from the arrow (origin at the bottom)
  await page.evaluate(() => window.lithicanalyst.view([1, -1, 0.2], [0, 0, 1]));
  await page.locator('#frame-from-plane').click();
  await expect(page.locator('#frame-status')).toHaveText('plane:P1');
  f = (await frame(page))!;
  expect(dot(row(f.matrix, 2), [0, 0, 1])).toBeCloseTo(1, 6);
  await page.locator('#frame-vertical').click();
  await expect(page.locator('#frame-status')).toHaveText('plane:P1; vertical:S1');
  f = (await frame(page))!;
  expect(dot(row(f.matrix, 1), [1, 0, 0])).toBeCloseTo(1, 6);

  // fine turning, then undo it
  const fine = page.locator('#frame-fine');
  await fine.fill('10');
  f = (await frame(page))!;
  expect(dot(row(f.matrix, 1), [1, 0, 0])).toBeCloseTo(Math.cos(Math.PI / 18), 6);
  await expect(fine).toHaveValue('0');

  await page.locator('#frame-clear').click();
  await expect(page.locator('#frame-status')).toHaveText('Not set');
  await expect.poll(async () => (await auto(page))!.frame).toBe('principal');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#frame-status')).not.toHaveText('Not set');

  // the frame is saved; the model and the annotations keep their coordinates
  const saved = await page.evaluate(() => window.lithicanalyst.projectJson());
  expect(saved.specimen.frame!.matrix).toHaveLength(16);
  expect(saved.annotations.scars[0].vector!.start[0]).toBeCloseTo(boxPoint(-10, 0, 5)[0], 1);
});

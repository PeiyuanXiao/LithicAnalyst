import type { Page } from '@playwright/test';
import { columnPly } from './fixtures/meshes';
import { displayPanel, expect, loadMesh, nextFrames, openApp, test } from './helpers';

const light = (page: Page) => page.evaluate(() => window.lithicanalyst.light());

/** A point of the light ball on the page, in its own terms: x right, y up, 1 at the rim. */
async function onBall(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const b = (await page.locator('#light-ball').boundingBox())!;
  return { x: b.x + (b.width / 2) * (1 + x), y: b.y + (b.height / 2) * (1 - y) };
}

test('the display panel: rows of one rank with the panels among them; no sliders for the light or the arrows', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, columnPly());
  await displayPanel(page);
  await expect(page.locator('#light-az')).toHaveCount(0);
  await expect(page.locator('#light-el')).toHaveCount(0);
  await expect(page.locator('#arrow-thickness')).toHaveCount(0);
  await expect(page.locator('#display-body > .ctl:not([hidden]) > .ctl-label')).toHaveText(['Shading', 'Light', 'Arrow colour', 'Volumetric configuration', 'Harris matrix']);
  await expect(page.locator('#display-body .check-row .ctl-check')).toHaveCount(3);

  // the Harris matrix is switched here, with or without relations
  await expect(page.locator('#sec-relations #harris-show')).toHaveCount(0);
  await expect(page.locator('#harris-panel')).toBeHidden();
  await page.locator('#harris-show').check();
  await expect(page.locator('#harris-panel')).toBeVisible();
  // closed from its own title bar: the switch follows
  await page.locator('#harris-close').click();
  await expect(page.locator('#harris-panel')).toBeHidden();
  await displayPanel(page);
  await expect(page.locator('#harris-show')).not.toBeChecked();

  // both panels belong to the annotate mode
  await page.evaluate(() => window.lithicanalyst.setMode('measure'));
  await displayPanel(page);
  await expect(page.locator('#harris-show')).toBeHidden();
  await expect(page.locator('#config-show')).toBeHidden();
  await expect(page.locator('#light-ball')).toBeVisible();
});

test('the light ball: a click and a drag set the light as the L key does, a double click goes back', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, columnPly());
  await displayPanel(page);
  await expect(page.locator('#light-ball')).toHaveAttribute('aria-valuetext', 'Azimuth 135° · elevation 35°');

  // a click at the centre: from the viewer
  let at = await onBall(page, 0, 0);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await light(page)).elevationDeg).toBeGreaterThan(85);

  // a drag to the rim on the right: raking, and it says so while dragging
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  at = await onBall(page, 0.99, 0);
  await page.mouse.move(at.x, at.y, { steps: 4 });
  await expect(page.locator('.tip')).toContainText('elevation');
  await page.mouse.up();
  await expect(page.locator('.tip')).toHaveCount(0);
  let l = await light(page);
  expect(Math.min(l.azimuthDeg, 360 - l.azimuthDeg)).toBeLessThanOrEqual(2);
  expect(l.elevationDeg).toBeLessThanOrEqual(7);
  await expect(page.locator('#light-ball')).toHaveAttribute('aria-valuetext', `Azimuth ${l.azimuthDeg}° · elevation ${l.elevationDeg}°`);

  // the arrow keys nudge it
  await page.keyboard.press('ArrowUp');
  expect((await light(page)).elevationDeg).toBe(l.elevationDeg + 5);

  // a double click: the default
  at = await onBall(page, -0.3, 0.3);
  await page.mouse.dblclick(at.x, at.y);
  await expect.poll(() => light(page)).toMatchObject({ azimuthDeg: 135, elevationDeg: 35 });

  // the same place on the ball and in the view under the L key give the same light
  at = await onBall(page, 0.5, 0.25);
  await page.mouse.click(at.x, at.y);
  const byBall = await light(page);
  await page.locator('#btn-display').click();
  await expect(page.locator('#display-panel')).toBeHidden();
  await page.mouse.click(1, 1);
  await page.keyboard.press('Escape');
  const view = (await page.locator('#viewport').boundingBox())!;
  const half = Math.min(view.width, view.height) / 2;
  await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
  await page.keyboard.down('l');
  await page.mouse.move(view.x + view.width / 2 + 0.5 * half, view.y + view.height / 2 - 0.25 * half, { steps: 3 });
  await page.keyboard.up('l');
  await nextFrames(page);
  l = await light(page);
  expect(Math.abs(l.azimuthDeg - byBall.azimuthDeg)).toBeLessThanOrEqual(3);
  expect(Math.abs(l.elevationDeg - byBall.elevationDeg)).toBeLessThanOrEqual(3);

  // and the ball shows what the L key did
  await displayPanel(page);
  await expect(page.locator('#light-ball')).toHaveAttribute('aria-valuetext', `Azimuth ${l.azimuthDeg}° · elevation ${l.elevationDeg}°`);
});

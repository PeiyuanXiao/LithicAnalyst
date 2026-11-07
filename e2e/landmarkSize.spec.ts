import type { Page } from '@playwright/test';
import { boxPly, boxPoint, T1, t1Ply, type Vec3 } from './fixtures/meshes';
import { displayPanel, expect, loadMesh, nextFrames, openApp, state, test, toScreen, viewFromTop } from './helpers';

const landmarkIds = async (page: Page) => (await state(page)).landmarks.map((l) => l.id);

/** Landmark tool: a landmark exactly where clicked (Shift: no snapping). */
async function clickLandmark(page: Page, at: { x: number; y: number }): Promise<void> {
  await page.mouse.move(at.x, at.y, { steps: 2 });
  await page.keyboard.down('Shift');
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up('Shift');
}

/** The camera moves toward (or, above 1, away from) the point under the cursor, by this factor of its distance (several wheel events: each is limited). */
async function zoomInAt(page: Page, at: { x: number; y: number }, factor: number): Promise<void> {
  await page.mouse.move(at.x, at.y);
  const way = factor < 1 ? -1 : 1;
  let left = Math.abs(Math.log(factor)) / 0.0016;
  while (left > 0.5) {
    const d = Math.min(400, left);
    await page.mouse.wheel(0, way * d);
    left -= d;
    await nextFrames(page);
  }
  await nextFrames(page, 3);
}

/** The width and height on the screen of what is in the landmarks' colour, around a point. */
async function dotOnScreen(page: Page, at: { x: number; y: number }): Promise<{ w: number; h: number }> {
  const reach = 16;
  const png = await page.screenshot({ clip: { x: Math.round(at.x) - reach, y: Math.round(at.y) - reach, width: 2 * reach, height: 2 * reach } });
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let y = 0; y < bmp.height; y++)
      for (let x = 0; x < bmp.width; x++) {
        const i = 4 * (y * bmp.width + x);
        if (d[i + 1] > d[i] + 40 && d[i + 2] > d[i] + 40) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
      }
    return { w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }, png.toString('base64'));
}

const SHOTS = 'test-results/23';
/** The box's diagonal, and a fixed landmark's diameter on it. */
const WORLD_DIAMETER = 2 * 0.005 * Math.hypot(40, 20, 10);

/** A landmark on the top of the box, nothing selected, the labels off. */
async function landmarkOnBox(page: Page): Promise<{ p: Vec3; diameter: () => Promise<number>; pxPerUnit: () => Promise<number> }> {
  await openApp(page);
  await loadMesh(page, boxPly());
  await displayPanel(page);
  await page.locator('#arrow-labels').uncheck();
  await page.keyboard.press('Escape');
  await viewFromTop(page);
  await page.keyboard.press('k');
  const p = boxPoint(0, 0, 5);
  await clickLandmark(page, await toScreen(page, p));
  await expect.poll(async () => (await landmarkIds(page)).length).toBe(1);
  const [id] = await landmarkIds(page);
  return {
    p,
    diameter: async () => (await page.evaluate((x) => window.lithicanalyst.landmarkDiameter(x), id))!,
    pxPerUnit: async () => {
      const a = await toScreen(page, boxPoint(-1, 0, 5)), b = await toScreen(page, boxPoint(1, 0, 5));
      return Math.hypot(a.x - b.x, a.y - b.y) / 2;
    },
  };
}

/** Let go of the selection and take the pointer off the model. */
async function plain(page: Page): Promise<void> {
  await page.evaluate(() => window.lithicanalyst.selectForTest(null));
  await nextFrames(page, 3);
  await page.mouse.move(5, 5);
  await nextFrames(page, 3);
}

test('a landmark is a share of the model, held between 6 and 16 pixels: far, in the middle and close up', async ({ page }) => {
  const { p, diameter, pxPerUnit } = await landmarkOnBox(page);
  // the one just placed is selected: 1.3 times the size
  const selected = await diameter();
  await plain(page);
  // (a little off: the larger ball rests a little nearer the camera)
  expect(selected / (await diameter())).toBeCloseTo(1.3, 2);

  // the camera moved out: the lower limit
  await zoomInAt(page, await toScreen(page, p), 2.5);
  await plain(page);
  expect(WORLD_DIAMETER * (await pxPerUnit())).toBeLessThan(6);
  expect(Math.abs((await diameter()) - 6)).toBeLessThan(0.1);
  const far = await dotOnScreen(page, await toScreen(page, p));
  expect(Math.abs(far.w - 6)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(far.h - 6)).toBeLessThanOrEqual(1.5);
  await page.screenshot({ path: `${SHOTS}/landmark-far.png` });

  // a little closer than the whole model in view: by the model
  await viewFromTop(page);
  await zoomInAt(page, await toScreen(page, p), 0.6);
  await plain(page);
  const between = WORLD_DIAMETER * (await pxPerUnit());
  expect(between).toBeGreaterThan(6);
  expect(between).toBeLessThan(16);
  expect(Math.abs((await diameter()) - between)).toBeLessThan(0.2);
  const middle = await dotOnScreen(page, await toScreen(page, p));
  expect(Math.abs(middle.w - between)).toBeLessThanOrEqual(1.5);
  await page.screenshot({ path: `${SHOTS}/landmark-middle.png` });

  // close up: the upper limit, however close
  await zoomInAt(page, await toScreen(page, p), 0.2);
  await plain(page);
  expect(WORLD_DIAMETER * (await pxPerUnit())).toBeGreaterThan(16);
  expect(Math.abs((await diameter()) - 16)).toBeLessThan(0.1);
  const near = await dotOnScreen(page, await toScreen(page, p));
  expect(Math.abs(near.w - 16)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(near.h - 16)).toBeLessThanOrEqual(1.5);
  await page.screenshot({ path: `${SHOTS}/landmark-near.png` });
});

test('seen at a slant, the surface it lies on hides none of a landmark', async ({ page }) => {
  const { p, diameter } = await landmarkOnBox(page);
  await page.evaluate(() => window.lithicanalyst.view([0, -0.8, 0.6], [0, 0.6, 0.8]));
  await nextFrames(page, 3);
  await zoomInAt(page, await toScreen(page, p), 0.3);
  await plain(page);
  const d = await diameter();
  // as high as it is wide: half sunk into the surface, it would show less than that
  const seen = await dotOnScreen(page, await toScreen(page, p));
  expect(Math.abs(seen.w - d)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(seen.h - d)).toBeLessThanOrEqual(1.5);
});

test.describe('on a screen of twice the density', () => {
  test.use({ deviceScaleFactor: 2 });

  test('the same in CSS pixels, drawn with twice the pixels', async ({ page }) => {
    const { p, diameter, pxPerUnit } = await landmarkOnBox(page);
    await zoomInAt(page, await toScreen(page, p), 0.6);
    await plain(page);
    const between = WORLD_DIAMETER * (await pxPerUnit());
    expect(between).toBeGreaterThan(6);
    expect(between).toBeLessThan(16);
    expect(Math.abs((await diameter()) - between)).toBeLessThan(0.2);
    // the picture has twice the pixels of the page
    const seen = await dotOnScreen(page, await toScreen(page, p));
    expect(Math.abs(seen.w / 2 - between)).toBeLessThanOrEqual(1);
    expect(Math.abs(seen.h / 2 - between)).toBeLessThanOrEqual(1);
    // and the limits too
    await zoomInAt(page, await toScreen(page, p), 0.2);
    await plain(page);
    expect(Math.abs((await diameter()) - 16)).toBeLessThan(0.1);
  });
});

test('close up, a click right beside the point of percussion reaches the model, not the landmark', async ({ page }) => {
  await openApp(page, 'flake');
  await loadMesh(page, t1Ply());
  // the axis puts the landmark at P
  await page.evaluate(() => window.lithicanalyst.view([0, 0, -1], [0, 1, 0]));
  await nextFrames(page);
  await page.evaluate(() => window.lithicanalyst.snap.prepare('ridge'));
  await page.keyboard.press('t');
  const s = await toScreen(page, [0, 0.4, 0]), e = await toScreen(page, T1.A);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(e.x, e.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).landmarks.filter((l) => l.code === 'pop').length).toBe(1);
  const pop = (await state(page)).landmarks.find((l) => l.code === 'pop')!;

  // the platform seen square on
  await page.evaluate(() => window.lithicanalyst.view([0, -0.98, 0.196], [0, 0.196, 0.98]));
  await nextFrames(page, 3);
  await page.keyboard.press('k');
  const inside: Vec3 = [pop.point[0], pop.point[1] - 1, pop.point[2] + 5];
  await zoomInAt(page, await toScreen(page, inside), 0.25);
  const P = await toScreen(page, pop.point), toward = await toScreen(page, inside);
  const k = Math.hypot(toward.x - P.x, toward.y - P.y);
  const beside = (px: number) => ({ x: P.x + (px * (toward.x - P.x)) / k, y: P.y + (px * (toward.y - P.y)) / k });
  await page.keyboard.press('Escape');

  // within reach of the landmark: it is picked, nothing is placed
  const count = (await state(page)).landmarks.length;
  await clickLandmark(page, beside(7));
  await nextFrames(page, 2);
  expect(await page.evaluate(() => window.lithicanalyst.selection())).toBe(pop.id);
  expect((await state(page)).landmarks).toHaveLength(count);

  // just past it: the model is under the click
  const at = beside(10);
  const hit = await page.evaluate(({ x, y }) => window.lithicanalyst.pick(x, y), at);
  expect(hit).not.toBeNull();
  await clickLandmark(page, at);
  await expect.poll(async () => (await state(page)).landmarks.length).toBe(count + 1);
  const placed = (await state(page)).landmarks[count];
  expect(Math.hypot(...placed.point.map((v, i) => v - hit![i]))).toBeLessThan(0.05);
});

/** The dots of a figure's SVG: outer diameter (the outline included), and where they are on the figure. */
async function svgDots(page: Page): Promise<Array<{ kind: string; diameter: number; x: number; y: number }>> {
  const fig = (await page.evaluate(() => window.lithicanalyst.figure('svg')))!;
  const view = /<g id="view-front" transform="translate\(([\d.]+) ([\d.]+)\)">/.exec(fig.data)!;
  const group = /<g class="landmarks"[^>]*stroke-width="([\d.]+)">([\s\S]*?)<\/g>/.exec(fig.data)!;
  const width = Number(group[1]);
  return [...group[2].matchAll(/<circle class="(\w+)" cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)].map((m) => ({ kind: m[1], diameter: 2 * Number(m[4]) + width, x: Number(view[1]) + Number(m[2]), y: Number(view[2]) + Number(m[3]) }));
}

/** How wide a dark ring is on one row of a PNG, around a point: from the first dark pixel to the last within `reach`. */
async function ringWidth(page: Page, b64: string, x: number, y: number, reach: number): Promise<number> {
  return page.evaluate(
    async ({ b64, x, y, reach }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const g = c.getContext('2d')!;
      g.drawImage(bmp, 0, 0);
      const row = g.getImageData(0, Math.round(y), bmp.width, 1).data;
      let first = Infinity, last = -Infinity;
      for (let i = Math.max(0, Math.round(x - reach)); i <= Math.min(bmp.width - 1, Math.round(x + reach)); i++) {
        if (row[4 * i + 3] > 128 && row[4 * i] < 90 && row[4 * i + 1] < 90 && row[4 * i + 2] < 90) {
          first = Math.min(first, i);
          last = Math.max(last, i);
        }
      }
      return last - first + 1;
    },
    { b64, x, y, reach },
  );
}

test('a figure draws landmarks at their size on paper, whatever the scale, the resolution or the camera', async ({ page }) => {
  await openApp(page);
  await loadMesh(page, boxPly());
  await viewFromTop(page);
  await page.keyboard.press('k');
  await clickLandmark(page, await toScreen(page, boxPoint(0, 0, 5)));
  await expect.poll(async () => (await landmarkIds(page)).length).toBe(1);
  await page.keyboard.press('m');
  await page.keyboard.press('m');
  await page.evaluate(() => window.lithicanalyst.view([0, 0, 1], [0, 1, 0]));
  await page.locator('#frame-from-view').click();

  const mm = (dpi: number) => (1.2 * dpi) / 25.4;
  await page.locator('#fig-scale-1').click();
  await page.locator('#fig-dpi-600').click();
  const [at600] = await svgDots(page);
  expect(at600.kind).toBe('fixed');
  expect(Math.abs(at600.diameter - mm(600))).toBeLessThanOrEqual(1);
  // ... as painted
  const png = (await page.evaluate(() => window.lithicanalyst.figure('png')))!;
  expect(Math.abs((await ringWidth(page, png.data, at600.x, at600.y, mm(600))) - mm(600))).toBeLessThanOrEqual(1);

  // the scale of the figure does not change it
  await page.locator('#fig-scale-2').click();
  const [scaled] = await svgDots(page);
  expect(Math.abs(scaled.diameter - mm(600))).toBeLessThanOrEqual(1);
  // the resolution does, as the same millimetres
  await page.locator('#fig-scale-1').click();
  await page.locator('#fig-dpi-300').click();
  const [at300] = await svgDots(page);
  expect(Math.abs(at300.diameter - mm(300))).toBeLessThanOrEqual(1);

  // nor does the camera
  await page.locator('#fig-dpi-600').click();
  const c = await toScreen(page, boxPoint(0, 0, 5));
  await zoomInAt(page, c, 0.25);
  const [close] = await svgDots(page);
  expect(Math.abs(close.diameter - at600.diameter)).toBeLessThanOrEqual(0.01);
});

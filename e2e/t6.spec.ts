import type { Page } from '@playwright/test';
import { T6, t6Dorsal, t6Ply, t6Ventral, t6Zv, type Vec3 } from './fixtures/meshes';
import { curveClick, expect, loadMesh, nextFrames, openApp, specimenPanel, state, test, toScreen } from './helpers';

/** About the mean edge length of T6. */
const EDGE = 0.8;
const P0: Vec3 = [0, 0, t6Zv(0, 0)];
const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const axisOf = async (page: Page) => (await state(page)).flake.axis;
const measures = async (page: Page) => (await page.evaluate(() => window.lithicanalyst.flake()))?.measures ?? null;
const distal: Vec3 = [0, 40, t6Zv(0, 40)];

const fromVentral = async (page: Page) => {
  await page.evaluate(() => window.lithicanalyst.view([0, 0, -1], [0, 1, 0]));
  await nextFrames(page);
};

async function closePanel(page: Page): Promise<void> {
  if (await page.locator('#profile-panel').isVisible()) await page.locator('#profile-close').click();
}

/** Open T6 as a flake, its ridges ready. */
async function openT6(page: Page, K = 14): Promise<void> {
  await openApp(page);
  await loadMesh(page, t6Ply(K));
  await specimenPanel(page);
  await page.locator('#specimen-type').selectOption('flake');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.lithicanalyst.snap.prepare('ridge'));
}

/** Draw the technical axis: press at `from`, let go toward the distal end. */
async function drawAxis(page: Page, from: Vec3, opts: { shift?: boolean } = {}): Promise<void> {
  await fromVentral(page);
  await page.keyboard.press('t');
  const before = (await axisOf(page))?.start ?? null;
  const s = await toScreen(page, from), e = await toScreen(page, distal);
  await page.mouse.move(s.x, s.y);
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.down();
  if (opts.shift) await page.keyboard.up('Shift');
  await page.mouse.move(e.x, e.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => JSON.stringify((await axisOf(page))?.start ?? null)).not.toBe(JSON.stringify(before));
  await expect.poll(async () => (await axisOf(page))?.matrix ?? null).not.toBeNull();
  await closePanel(page);
}

/** The platform's outline by its rims, the ridges followed, seen square on; its type by its key. */
async function drawOutline(page: Page): Promise<void> {
  await page.evaluate(() => window.lithicanalyst.view([0, -0.96, -0.28], [0, -0.28, 0.96]));
  await nextFrames(page);
  await page.keyboard.press('p');
  const n = (await state(page)).curves.length;
  const inner = (s: number): Vec3 => {
    const a = t6Ventral(s, 0), b = t6Dorsal(s, 0);
    return [a[0], a[1] + 0.03 * (b[1] - a[1]), a[2] + 0.03 * (b[2] - a[2])];
  };
  const outer = (s: number): Vec3 => {
    const a = t6Ventral(s, 0), b = t6Dorsal(s, 0);
    return [a[0], a[1] + 0.97 * (b[1] - a[1]), a[2] + 0.97 * (b[2] - a[2])];
  };
  const ring: Vec3[] = [...[-0.98, -0.5, 0, 0.5, 0.98].map(inner), ...[0.5, 0, -0.5].map(outer)];
  for (const p of ring) await curveClick(page, await toScreen(page, p));
  const first = await toScreen(page, (await page.evaluate(() => window.lithicanalyst.curveDraft()))![0]);
  await page.mouse.move(first.x, first.y, { steps: 3 });
  await page.mouse.click(first.x, first.y);
  await expect.poll(async () => (await state(page)).curves[n]?.closed ?? false).toBe(true);
  await page.keyboard.press('v');
  await page.keyboard.press('5');
  await expect.poll(async () => (await state(page)).curves[n].attributes.type).toBe('platform_outline');
}

/** The two platform ends. */
async function placeEnds(page: Page): Promise<void> {
  await page.keyboard.press('e');
  for (const s of [-0.98, 0.98]) {
    const at = await toScreen(page, t6Ventral(s, 0));
    const n = (await state(page)).landmarks.length;
    await page.mouse.click(at.x, at.y);
    await expect.poll(async () => (await state(page)).landmarks.length).toBe(n + 1);
  }
  await page.keyboard.press('v');
}

/** The edge from one end of the platform round the distal end to the other, its ridge followed; its type by its key. */
async function drawEdge(page: Page): Promise<void> {
  await fromVentral(page);
  await page.keyboard.press('p');
  const n = (await state(page)).curves.length;
  const along = (s: number, y: number) => t6Ventral(s, y);
  // each within reach of the edge: one further in would take the curve across the face
  const stops: Vec3[] = [along(-0.97, 2), along(-0.97, 16), along(-0.97, 32), along(-0.95, 46), along(-0.97, 54), along(-0.6, 57.8), along(0.6, 57.8), along(0.97, 54), along(0.95, 46), along(0.97, 32), along(0.97, 16), along(0.97, 2)];
  for (const p of stops) await curveClick(page, await toScreen(page, p));
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).curves.length).toBe(n + 1);
  await page.keyboard.press('v');
  await page.keyboard.press('2');
  await expect.poll(async () => (await state(page)).curves[n].attributes.type).toBe('edge');
}

// the radius of the snap is in pixels: in millimetres it goes with the window
for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  test.describe(`${viewport.width} wide`, () => {
    test.use({ viewport });

    test(`the point of percussion goes to the nearest place of the edge at ${viewport.width} px`, async ({ page }) => {
      await openT6(page);
      // half a millimetre from the platform's edge
      await drawAxis(page, t6Ventral(0, 0.5));
      expect(distance((await axisOf(page))!.start, P0)).toBeLessThanOrEqual(EDGE / 2);
    });
  });
}

test('the point of percussion goes to the nearest place of the edge, not along it; Shift puts it at the press', async ({ page }) => {
  await openT6(page);
  // half a millimetre from the platform's edge
  await drawAxis(page, t6Ventral(0, 0.5));
  const snapped = (await axisOf(page))!.start;
  expect(distance(snapped, P0)).toBeLessThanOrEqual(EDGE / 2);

  // Shift: the vertex under the press, the one of the next row
  await drawAxis(page, t6Ventral(0, 0.5), { shift: true });
  const exact = (await axisOf(page))!.start;
  expect(distance(exact, t6Ventral(0, T6.L / T6.ny))).toBeLessThan(1e-3);
  // the landmark goes with it
  expect((await state(page)).landmarks.find((l) => l.code === 'pop')!.point).toEqual(exact);
});

test('dragging the point of percussion snaps as drawing it does: it stays on the edge, and the platform is still measured', async ({ page }) => {
  await openT6(page);
  await drawAxis(page, t6Ventral(0, 0.5));
  await drawOutline(page);
  await placeEnds(page);
  await expect.poll(async () => (await measures(page))?.platform_width_chord ?? null).not.toBeNull();
  await expect.poll(async () => (await measures(page))?.epa_3pt_1mm ?? null).not.toBeNull();

  // the select tool, the axis selected, seen from its ventral face
  await fromVentral(page);
  await page.keyboard.press('v');
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), (await axisOf(page))!.id);
  await nextFrames(page);
  const from = await toScreen(page, (await axisOf(page))!.start);
  const to = await toScreen(page, t6Ventral(0.3, 0.6));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  const wanted: Vec3 = [0.3 * T6.w0, 0, t6Zv(0.3 * T6.w0, 0)];
  // on the way: the arrow's start is shown where it would go
  const shown = await page.evaluate(() => window.lithicanalyst.endpointPreview());
  expect(distance(shown!, wanted)).toBeLessThanOrEqual(EDGE);
  await page.mouse.up();
  await expect.poll(async () => distance((await axisOf(page))!.start, wanted)).toBeLessThanOrEqual(EDGE);
  await expect.poll(async () => (await axisOf(page))?.matrix ?? null).not.toBeNull();
  // still measured
  await expect.poll(async () => {
    const m = await measures(page);
    return m ? [m.platform_depth_chord, m.platform_width_chord, m.epa_3pt_1mm, m.epa_2ln_1mm, m.ipa].every((v) => v !== null) : false;
  }).toBe(true);
});

test('a fixed landmark goes to the nearest place of the edge', async ({ page }) => {
  await openT6(page);
  await fromVentral(page);
  await page.keyboard.press('k');
  await page.evaluate(() => window.lithicanalyst.snap.prepare('ridge'));
  // beside the left edge, half a millimetre in from it
  const edgeAt = t6Ventral(-1, 20);
  const press: Vec3 = [edgeAt[0] + 0.5, 20, t6Zv(edgeAt[0] + 0.5, 20)];
  const at = await toScreen(page, press);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await state(page)).landmarks.filter((l) => !l.code).length).toBe(1);
  const placed = (await state(page)).landmarks.find((l) => !l.code)!.point;
  // on the edge, abreast of the press
  expect(distance(placed, t6Ventral(-1, placed[1]))).toBeLessThan(1e-3);
  expect(Math.abs(placed[1] - 20)).toBeLessThanOrEqual(EDGE);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme, viewport: { width: 1440, height: 900 } });

    test(`T6 annotated, in the measure mode (${colorScheme}): every automatic measure has a value`, async ({ page }, info) => {
      await openT6(page);
      await drawAxis(page, t6Ventral(0, 0.5));
      await drawOutline(page);
      await placeEnds(page);
      await drawEdge(page);
      await page.locator('#app-mode-measure').click();
      await expect.poll(async () => {
        const m = await measures(page);
        return m ? Object.entries(m).filter(([, v]) => v === null).map(([k]) => k) : ['none yet'];
      }).toEqual([]);
      const m = (await measures(page))!;
      expect(Math.abs(m.platform_depth_chord! - 7.04)).toBeLessThan(0.1);
      // (the ends are clicked just inside the outline's corners, which come to a point at the model's outline)
      expect(Math.abs(m.platform_width_chord! - 22)).toBeLessThan(1);
      expect(Math.abs(m.ipa! - 106.46)).toBeLessThan(3);
      // the curve keeps to the edge, so its angles are those of an edge: no station on a face, near 180°
      const edge = (await state(page)).curves.find((c) => c.attributes.type === 'edge')!;
      const inside = (p: Vec3) => Math.min(Math.abs(t6Ventral(1, Math.max(0, Math.min(T6.L, p[1])))[0]) - Math.abs(p[0]), T6.L - p[1]);
      expect(Math.max(...edge.points.map(inside))).toBeLessThanOrEqual(EDGE);
      await expect.poll(() => page.evaluate((id) => window.lithicanalyst.edgeAngles(id)?.stations.length ?? 0, edge.id)).toBeGreaterThan(100);
      const stations = (await page.evaluate((id) => window.lithicanalyst.edgeAngles(id), edge.id))!.stations;
      expect(Math.max(...stations.flatMap((s) => s.three_points.filter((a): a is number => a !== null)))).toBeLessThan(60);
      await page.evaluate(() => window.lithicanalyst.view([0, 0.25, -0.97], [0, 1, 0.25]));
      await nextFrames(page, 4);
      await page.screenshot({ path: info.outputPath(`t6-measure-${colorScheme}.png`) });
    });
  });
}

import type { Page } from '@playwright/test';
import { displayPanel, expect, openSection, state, test } from './helpers';
import { t8Bulb } from './fixtures/meshes';
import { openT8, T8_ENDS } from './t8Setup';

/** T8 (tests/meshes.ts) coarse: rings of 0.2 mm near P and 145 steps of the half circle; its values are checked loosely here, exactly in tests/bulb.test.ts. */

const flake = (page: Page) => page.evaluate(() => window.lithicanalyst.flake());
const hint = (page: Page) => page.evaluate(() => window.lithicanalyst.measureHint());
const deg = (r: number) => (r * 180) / Math.PI;
const angleAt = (P: number[], a: number[], b: number[]) => {
  const u = a.map((x, i) => x - P[i]), v = b.map((x, i) => x - P[i]);
  return deg(Math.acos((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v))));
};

test('the proximal end: its measures in order, as computed, each showing how it was taken', async ({ page, pageErrors }) => {
  await openT8(page);
  await expect.poll(async () => (await flake(page))?.measures?.vi_1_0mm ?? null, { timeout: 30_000 }).not.toBeNull();
  const m = (await flake(page))!.measures!;
  // PSIA from the ends placed; the rest in their ranges (coarse mesh: see tests/bulb.test.ts for the exact answers)
  expect(Math.abs(m.psia! - angleAt([0, 0, 0], T8_ENDS[0], T8_ENDS[1]))).toBeLessThan(0.01);
  expect(m.bulb_angle_3pt_1mm).toBeGreaterThan(110);
  expect(m.bulb_angle_3pt_1mm).toBeLessThan(140);
  // the tangent at 1 mm is flatter than the chord from P: the two-line angle is the smaller
  expect(m.bulb_angle_2ln_1mm).toBeGreaterThan(95);
  expect(m.bulb_angle_2ln_1mm).toBeLessThan(m.bulb_angle_3pt_1mm!);
  expect(m.bsa).toBeGreaterThan(55);
  expect(m.bsa).toBeLessThan(80);
  expect(m.vi_0_5mm!).toBeLessThanOrEqual(m.vi_1_0mm! + 1e-9);
  expect(m.vi_1_0mm!).toBeLessThanOrEqual(m.vi_1_5mm! + 1e-9);
  expect(m.pop_mesh_edge).toBeGreaterThan(0.1);

  await page.locator('#app-mode-measure').click();
  await openSection(page, 'flake');
  // the groups: dimensions, platform, proximal angles, bulb
  await expect(page.locator('#flake-measures .measure-group-title')).toHaveText(['Dimensions', 'Platform', 'Proximal angles (°)', 'Bulb']);
  const ids = (group: string) => page.locator(`#flake-group-${group} [id^="flake-"]`).evaluateAll((els) => els.map((e) => e.id).filter((id) => !id.endsWith('-unit') && !id.endsWith('-table')));
  expect(await ids('platform')).toEqual(['flake-platform_width_chord', 'flake-platform_width_path', 'flake-platform_depth_chord', 'flake-platform_depth_path', 'flake-platform_area']);
  expect(await ids('angles')).toEqual(['flake-epa_3pt_1mm', 'flake-epa_3pt_2mm', 'flake-epa_3pt_3mm', 'flake-epa_2ln_1mm', 'flake-epa_2ln_2mm', 'flake-epa_2ln_3mm', 'flake-bulb_angle_3pt_1mm', 'flake-bulb_angle_2ln_1mm', 'flake-ipa', 'flake-psia']);
  expect(await ids('bulb')).toEqual(['flake-bsa', 'flake-vi_0_5mm', 'flake-vi_1_0mm', 'flake-vi_1_5mm']);
  await expect(page.locator('#flake-vi-table thead th')).toHaveText(['VI (mm)', '0.5 mm', '1.0 mm', '1.5 mm']);
  // the values as computed (one decimal for angles; the BSA's level in its row's name), no row for the mesh round P
  await expect(page.locator('#flake-psia')).toHaveText(m.psia!.toFixed(1));
  await expect(page.locator('#flake-bsa')).toHaveText(m.bsa!.toFixed(1));
  await expect(page.locator('#flake-group-bulb dt').first()).toHaveText('BSA (at 0.10 mm)');
  await expect(page.locator('#flake-pop_mesh_edge')).toHaveCount(0);

  // each new cell: its drawing on the model
  for (const k of ['psia', 'bulb_angle_3pt_1mm', 'bulb_angle_2ln_1mm', 'bsa', 'vi_0_5mm', 'vi_1_0mm', 'vi_1_5mm']) {
    await page.locator(`#flake-${k}`).hover();
    await expect.poll(async () => (await hint(page)).key, { message: k }).toBe(`flake:${k}`);
    const drawn = (await hint(page)).drawn!;
    expect(drawn.lines, k).toBeGreaterThan(0);
    if (['psia', 'bulb_angle_3pt_1mm', 'bulb_angle_2ln_1mm', 'bsa'].includes(k)) expect(drawn.arcs, k).toBe(1);
    if (k === 'bsa') expect(drawn.patches).toBe(1);
    if (k.startsWith('vi_')) expect(drawn.dots, k).toBeGreaterThan(0);
  }
  await page.mouse.move(0, 0);
  expect(pageErrors).toEqual([]);
});

const shading = (page: Page) => page.evaluate(() => window.lithicanalyst.heightShading());

test('shading by height: over the ventral reference plane, then a fitted plane; its range; its lines, the BSA level\'s thicker', async ({ page, pageErrors }) => {
  await openT8(page);
  await displayPanel(page);
  await page.locator('#shading-height').click();
  await expect.poll(async () => (await shading(page)).reference).toBe('ventral');
  expect((await shading(page)).shading).toBe('height');
  await expect.poll(async () => (await shading(page)).contours?.thin ?? 0).toBeGreaterThan(0);
  expect((await shading(page)).contours?.thick).toBeGreaterThan(0);
  await expect(page.locator('#height-group')).toBeVisible();
  await expect(page.locator('#height-ref option')).toHaveText(['Proximal ventral']);
  expect((await shading(page)).range).toMatchObject({ value: 0.25, unit: 'mm' });
  // a wider range: other lines (every 0.4 of it)
  const before = (await shading(page)).contours!.thin;
  await page.locator('#height-range').fill('1');
  await expect.poll(async () => (await shading(page)).range.value).toBe(1);
  await expect.poll(async () => (await shading(page)).contours!.thin).not.toBe(before);
  // a fitted plane: it is offered, and the BSA's line goes with the ventral plane
  await page.keyboard.press('Escape');
  await page.locator('#app-mode-measure').click();
  await openSection(page, 'planes');
  await page.locator('#plane-add').click();
  // fitted to the rim of the flake (the edge curve)
  const edge = (await state(page)).curves.find((c) => c.attributes.type !== 'platform_outline')!;
  await page.locator(`[id="plane-curve-${edge.id}"]`).check();
  await expect.poll(async () => (await shading(page)).references.length).toBe(2);
  const plane = (await shading(page)).references[1].value;
  await displayPanel(page);
  await page.locator('#height-ref').selectOption(plane);
  await expect.poll(async () => (await shading(page)).reference).toBe(plane);
  await expect.poll(async () => (await shading(page)).contours?.thick).toBe(0);
  expect((await shading(page)).contours!.thin).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});

test('the bulb page: the level moves the BSA; an end dragged moves it and can be reset; undo', async ({ page, pageErrors }) => {
  await openT8(page);
  await expect.poll(async () => (await flake(page))?.measures?.bsa ?? null, { timeout: 30_000 }).not.toBeNull();
  await displayPanel(page);
  await page.locator('#profile-show').check();
  await page.keyboard.press('Escape');
  await page.locator('#profile-page-bulb').click();
  await expect(page.locator('#bulb-drawing')).toBeVisible();
  await expect(page.locator('#profile-long')).toBeHidden();
  const bsa = async () => (await flake(page))!.measures!.bsa!;
  const first = await bsa();
  await expect(page.locator('#bulb-bsa')).toHaveText(first.toFixed(1));
  await expect.poll(() => page.locator('#bulb-drawing .bulb-contour').count()).toBeGreaterThan(3);
  await expect(page.locator('#bulb-drawing .bulb-contour.is-level')).toHaveCount(1);
  await expect(page.locator('#bulb-drawing .bulb-strip')).toHaveCount(3);
  // where the plane was fitted: a faint circle round P, out to min(10 mm, half the length): on T8 half its 20 mm, just under 10
  await expect(page.locator('#bulb-reference')).toBeAttached();
  const reach = (await flake(page))!.bulb!.radius;
  expect(reach).toBeCloseTo(10, 2);
  const pr = (await page.locator('#bulb-p').boundingBox())!;
  const ref = page.locator('#bulb-reference');
  expect(Number(await ref.getAttribute('cx'))).toBeGreaterThan(0);
  expect(Number(await ref.getAttribute('r'))).toBeGreaterThan(pr.width);
  await expect(page.locator('#bulb-reset')).toBeHidden();

  // the level: another outline, another BSA
  await page.locator('#bulb-level').fill('0.2');
  await page.locator('#bulb-level').press('Enter');
  await expect.poll(async () => (await state(page)).flake.bsa?.level).toBe(0.2);
  await expect.poll(bsa).not.toBeCloseTo(first, 3);
  const atLevel = await bsa();
  await expect(page.locator('#bulb-bsa')).toHaveText(atLevel.toFixed(1));

  // an end dragged halfway to P: it goes onto the outline, the angle changes, the ends are kept
  const end = (await page.locator('#bulb-end-0').boundingBox())!, p = (await page.locator('#bulb-p').boundingBox())!;
  const from = { x: end.x + end.width / 2, y: end.y + end.height / 2 }, to = { x: (from.x + p.x + p.width / 2) / 2, y: (from.y + p.y + p.height / 2) / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).flake.bsa?.ends ?? null).not.toBeNull();
  await expect.poll(bsa).not.toBeCloseTo(atLevel, 3);
  await expect(page.locator('#bulb-reset')).toBeVisible();
  const moved = await bsa();
  // the level no longer moves the angle
  await page.locator('#bulb-level').fill('0.15');
  await page.locator('#bulb-level').press('Enter');
  await expect.poll(async () => (await state(page)).flake.bsa?.level).toBe(0.15);
  await expect.poll(async () => (await flake(page))!.bulb?.level).toBe(0.15);
  expect(await bsa()).toBeCloseTo(moved, 9);
  // undo: the level, then the ends
  await page.locator('#btn-undo').click();
  await expect.poll(async () => (await state(page)).flake.bsa?.level).toBe(0.2);
  await page.locator('#btn-undo').click();
  await expect.poll(async () => (await state(page)).flake.bsa?.ends ?? null).toBeNull();
  await expect.poll(bsa).toBeCloseTo(atLevel, 6);
  await expect(page.locator('#bulb-reset')).toBeHidden();
  // reset after a drag
  await page.locator('#btn-redo').click();
  await expect(page.locator('#bulb-reset')).toBeVisible();
  await page.locator('#bulb-reset').click();
  await expect.poll(async () => (await state(page)).flake.bsa?.ends ?? null).toBeNull();

  // Shift: the end goes anywhere, onto the ventral surface under it (coarse mesh: within 0.05 mm of T8's height there)
  await expect(page.locator('#bulb-reset')).toBeHidden();
  const e1 = (await page.locator('#bulb-end-1').boundingBox())!;
  const at1 = { x: e1.x + e1.width / 2, y: e1.y + e1.height / 2 };
  await page.mouse.move(at1.x, at1.y);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(at1.x + 15, at1.y - 25, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await state(page)).flake.bsa?.ends ?? null).not.toBeNull();
  const free = (await state(page)).flake.bsa!.ends![1];
  expect(Math.abs(free[2] + t8Bulb(Math.hypot(free[0], free[1]), deg(Math.atan2(free[0], free[1]))))).toBeLessThan(0.05);
  expect(pageErrors).toEqual([]);
});

test('without a stated unit (34d): no IPA, and why; nor the BSA and VI, and no ventral reference to shade by', async ({ page, pageErrors }) => {
  await openT8(page, { unit: '' });
  const f = await page.evaluate(() => window.lithicanalyst.flake());
  expect(f!.measures!.ipa).toBeNull();
  expect(f!.reasons!.ipa).toBe('no_unit');
  for (const k of ['bsa', 'vi_1_0mm', 'epa_3pt_1mm'] as const) expect(f!.reasons![k]).toBe('no_unit');
  // PSIA needs no unit
  expect(f!.measures!.psia).not.toBeNull();
  await page.locator('#app-mode-measure').click();
  await expect(page.locator('#flake-ipa')).toHaveText('—');
  await page.locator('#flake-ipa').hover();
  await expect(page.locator('.tip')).toHaveText('No coordinate unit stated');
  await page.screenshot({ path: 'test-results/34d/ipa-no-unit.png' });
  expect(pageErrors).toEqual([]);
});
test('the platform\'s depth from S (32b): P a little onto the ventral face, the depth and its drawing still from the platform\'s edge', async ({ page, pageErrors }) => {
  // P 0.5 mm onto the ventral face, within 1 mm of the platform: S, where the section meets the platform's edge, stays at (0, 0, 0)
  await openT8(page, { P: [0, 0.5, -t8Bulb(0.5, 0)] });
  await expect.poll(async () => (await flake(page))?.measures?.platform_depth_chord ?? null, { timeout: 30_000 }).not.toBeNull();
  // from S to E, the dorsal edge above it: T8's thickness at P, 8 mm
  expect((await flake(page))!.measures!.platform_depth_chord).toBeCloseTo(8, 2);
  await page.locator('#app-mode-measure').click();
  await openSection(page, 'flake');
  await page.locator('#flake-platform_depth_chord').hover();
  await expect.poll(async () => (await hint(page)).key).toBe('flake:platform_depth_chord');
  const ends = (await hint(page)).prims.find((p) => p.kind === 'dots' && p.part === 'ends')!.points!;
  expect(Math.hypot(...ends[0])).toBeLessThan(0.01);
  expect(Math.hypot(ends[1][0], ends[1][1], ends[1][2] - 8)).toBeLessThan(0.01);
  await page.mouse.move(0, 0);
  expect(pageErrors).toEqual([]);
});

import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { displayPanel, expect, openSection, test } from './helpers';
import { boxScene } from './boxScene';

const svg = async (page: Page): Promise<string> => (await page.evaluate(() => window.lithicanalyst.figure('svg')))!.data;

/** The legend's items: kind, key, label and the colour of the sample. */
function legendOf(text: string): Array<{ kind: string; key: string; label: string; color: string }> {
  const g = /<g id="legend"[^>]*>([\s\S]*?)\n<\/g>\n(?:<\/svg>)/.exec(text)?.[1] ?? '';
  return [...g.matchAll(/<g class="legend-item" data-kind="([^"]+)" data-key="([^"]*)">([\s\S]*?)<\/g>/g)].map((m) => ({
    kind: m[1],
    key: m[2],
    label: /<text[^>]*>([^<]*)<\/text>/.exec(m[3])?.[1] ?? '',
    color: /(?:fill|stroke)="(#[0-9a-fA-F]{3,8})"/.exec(m[3].replace(/stroke="#000"/g, ''))?.[1] ?? '',
  }));
}

/** The colours of what the views draw, by kind. */
function drawnColours(text: string): { arrows: string[]; curves: string[]; fixed: boolean } {
  const views = text.split('<g id="legend"')[0];
  const arrows = [...views.matchAll(/<g class="arrows"[^>]*>([\s\S]*?)<\/g>/g)].flatMap((m) => [...m[1].matchAll(/stroke="([^"]+)"/g)].map((x) => x[1]));
  const curves = [...views.matchAll(/<polyline class="curve" stroke="([^"]+)"/g)].map((m) => m[1]);
  return { arrows: [...new Set(arrows)], curves: [...new Set(curves)], fixed: views.includes('class="fixed"') };
}

test('a legend on the figure: off by default; on, what is drawn and nothing else; what is hidden goes from it', async ({ page, pageErrors }) => {
  const ids = await boxScene(page);
  // the arrows by completeness
  await displayPanel(page);
  await page.locator('#arrow-color').selectOption('completeness');
  await page.keyboard.press('Escape');
  await page.locator('#app-mode-present').click();
  await openSection(page, 'figure');

  // off by default
  await expect(page.locator('#fig-legend')).not.toBeChecked();
  expect(await svg(page)).not.toContain('id="legend"');

  await page.locator('#fig-legend').check();
  const text = await svg(page);
  // to look at
  mkdirSync('test-results/31', { recursive: true });
  writeFileSync('test-results/31/legend.svg', text);
  writeFileSync('test-results/31/legend.png', Buffer.from((await page.evaluate(() => window.lithicanalyst.figure('png')))!.data, 'base64'));
  await page.locator('#sec-figure').screenshot({ path: 'test-results/31/figure-panel.png' });
  expect(text).toContain('<g id="legend"');
  const items = legendOf(text);
  const colours = drawnColours(text);
  // the arrow by its completeness, in the words of the interface, in the colour it is drawn in
  const arrows = items.filter((x) => x.kind === 'arrow');
  expect(arrows.map((x) => x.key)).toEqual(['completeness:point_complete']);
  expect(arrows[0].label).toBe('Point of percussion + termination');
  expect(colours.arrows).toContain(arrows[0].color);
  // the curve (of no type yet) in its colour
  const curves = items.filter((x) => x.kind === 'curve');
  expect(curves).toHaveLength(1);
  expect(colours.curves).toEqual([curves[0].color]);
  // the regions painted, by type
  expect(items.filter((x) => x.kind === 'region').map((x) => x.key)).toEqual(['scar', 'cortex']);
  expect(items.find((x) => x.key === 'cortex')!.label).toBe('Cortex');
  // the landmark; no plane is drawn, none listed
  expect(colours.fixed).toBe(true);
  expect(items.filter((x) => x.kind === 'landmark').map((x) => x.key)).toEqual(['fixed']);
  expect(items.some((x) => x.kind === 'plane')).toBe(false);
  // text for other programs, in the scale bar's font
  expect(text).toMatch(/<g id="legend" font-family="Helvetica, Arial, sans-serif"/);

  // hidden: gone from the views and from the legend
  await page.evaluate((id) => window.lithicanalyst.setHidden(id, true), ids.cortex);
  await page.evaluate((id) => window.lithicanalyst.setHidden(id, true), ids.arrow);
  const after = legendOf(await svg(page));
  expect(after.some((x) => x.key === 'cortex')).toBe(false);
  expect(after.some((x) => x.kind === 'arrow')).toBe(false);
  expect(after.some((x) => x.key === 'scar')).toBe(true);

  // one colour for all the arrows: they are not listed
  await page.evaluate((id) => window.lithicanalyst.setHidden(id, false), ids.arrow);
  await displayPanel(page);
  await page.locator('#arrow-color').selectOption('uniform');
  await page.keyboard.press('Escape');
  expect(legendOf(await svg(page)).some((x) => x.kind === 'arrow')).toBe(false);
  // the PNG has it too, and is taller than without it only by what the legend needs
  const png = (await page.evaluate(() => window.lithicanalyst.figure('png')))!;
  expect(png.layout.legend.length).toBeGreaterThan(0);
  expect(png.layout.legend.every((x) => x.y >= (png.layout.scaleBar?.y ?? 0))).toBe(true);
  expect(pageErrors).toEqual([]);
});

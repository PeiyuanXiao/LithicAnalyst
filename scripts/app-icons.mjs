// The app's icons, for the installable web app (`npm run pages`): the small logo in ink on a
// paper tile, with the four-colour bar of the start page under it. Run again when the logo
// changes: `node scripts/app-icons.mjs` (needs Playwright's Chromium: `npx playwright install chromium`).
// It writes src/assets/brand/app-icon/: the two drawings (app-icon.svg on a rounded tile,
// app-icon-maskable.svg full-bleed, its drawing inside the safe circle) and the PNG files
// the web app manifest lists. The logo's own geometry is used as it is.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BRAND = new URL('../src/assets/brand/', import.meta.url);
const OUT = new URL('app-icon/', BRAND);

/** The start page's paper, ink, a quiet edge for the tile, and its four-colour bar (colour, share). */
const PAPER = '#f0ebe0';
const INK = '#1f1d19';
const EDGE = '#d6cfbd';
const BAR = [
  ['#3f7f78', 38],
  ['#e8a33a', 22],
  ['#d4572a', 25],
  ['#8f2d24', 15],
];
const SIZE = 512;

const logo = readFileSync(new URL('logo-small.svg', BRAND), 'utf8');
const inner = logo.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

/** The bar from x, w wide: its parts in their shares, `gap` apart. */
function bar(x, y, w, h, gap) {
  const total = BAR.reduce((s, [, share]) => s + share, 0);
  const free = w - gap * (BAR.length - 1);
  let at = x;
  return BAR.map(([colour, share]) => {
    const width = (free * share) / total;
    const rect = `<rect x="${at.toFixed(2)}" y="${y}" width="${width.toFixed(2)}" height="${h}" fill="${colour}"/>`;
    at += width + gap;
    return rect;
  }).join('');
}

/** `maskable`: a full square, the drawing within the central circle of 80 % that a platform may cut out. */
function drawing(maskable) {
  const ground = maskable
    ? `<rect width="${SIZE}" height="${SIZE}" fill="${PAPER}"/>`
    : `<rect x="8" y="8" width="${SIZE - 16}" height="${SIZE - 16}" rx="104" fill="${PAPER}" stroke="${EDGE}" stroke-width="4"/>`;
  const box = maskable ? 236 : 316;
  const x = (SIZE - box) / 2;
  const y = maskable ? 122 : 64;
  const barY = y + box * 0.97 + (maskable ? 10 : 14);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">${ground}` +
    `<g color="${INK}" transform="translate(${x} ${y}) scale(${box / 200})">${inner}</g>` +
    `${bar(x, barY, box, maskable ? 14 : 18, maskable ? 5 : 6)}</svg>\n`
  );
}

/** File name, drawing, size in pixels. */
const PNGS = [
  ['icon-192.png', false, 192],
  ['icon-512.png', false, 512],
  ['icon-maskable-512.png', true, 512],
  ['apple-touch-icon.png', true, 180],
];

mkdirSync(OUT, { recursive: true });
const svgs = { false: drawing(false), true: drawing(true) };
writeFileSync(new URL('app-icon.svg', OUT), svgs.false);
writeFileSync(new URL('app-icon-maskable.svg', OUT), svgs.true);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, maskable, px] of PNGS) {
    await page.setViewportSize({ width: px, height: px });
    const src = `data:image/svg+xml,${encodeURIComponent(svgs[maskable])}`;
    await page.setContent(`<html><body style="margin:0;background:transparent"><img src="${src}" width="${px}" height="${px}" style="display:block"></body></html>`);
    await page.locator('img').evaluate((img) => img.decode());
    writeFileSync(new URL(name, OUT), await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: px, height: px } }));
    console.log(`${name}: ${px} px`);
  }
} finally {
  await browser.close();
}

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { packWebApp, serveDir, WEB_APP } from '../scripts/webApp';
import { expect, test } from './helpers';

// The installable web app (`npm run pages`): the built page with its manifest, worker and icons,
// served over http as a static host would.
const PAGE = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const ICONS = new URL('../src/assets/brand/app-icon/', import.meta.url);

let site = '';
let server: Server;
let url = '';

/** Put a build on the site, as `npm run pages` would. */
function deploy(html: string): void {
  for (const [path, body] of packWebApp(html, 'test', (file) => readFileSync(new URL(file, ICONS)))) {
    mkdirSync(dirname(join(site, path)), { recursive: true });
    writeFileSync(join(site, path), body);
  }
}

test.beforeAll(async () => {
  site = mkdtempSync(join(tmpdir(), 'lithicanalyst-pages-'));
  deploy(PAGE);
  server = await serveDir(site, 0);
  const address = server.address();
  url = `http://localhost:${typeof address === 'object' && address ? address.port : 0}/`;
});

test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(site, { recursive: true, force: true });
});

/** Open the site and wait until its worker keeps the files and has the page in hand. */
async function openKept(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(url);
  await expect(page.locator('#start-page')).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test('the single file is left as it is: no manifest, no worker', () => {
  expect(PAGE).not.toMatch(/rel="manifest"/);
  expect(PAGE).not.toContain('serviceWorker.register');
});

test('served with its web app, the page can be installed, and opens offline once visited', async ({ page, context }) => {
  await openKept(page);
  const cdp = await context.newCDPSession(page);
  const manifest = await cdp.send('Page.getAppManifest');
  expect(manifest.errors).toEqual([]);
  const data = JSON.parse(manifest.data ?? '{}') as { icons: Array<{ src: string }> };
  expect(data).toMatchObject({ name: 'LithicAnalyst', display: 'standalone', start_url: './' });
  // the browser does not fetch the icons to judge; they are on the site
  for (const icon of data.icons) {
    const response = await page.request.get(new URL(icon.src, url).href);
    expect(response.status(), icon.src).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');
  }
  // (a test browser is a private window, which no browser installs from)
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors.filter((e) => e.errorId !== 'in-incognito')).toEqual([]);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#start-page')).toBeVisible();
  await page.waitForFunction(() => !!window.lithicanalyst);
  await page.locator('#start-type-core').click();
  await expect(page.locator('#start-page')).toBeHidden();
});

test('a new version on the site is there at the next launch, not in the open one', async ({ page }) => {
  await openKept(page);
  const marked = () => page.evaluate(() => document.querySelector('meta[name="la-build"]')?.getAttribute('content') ?? null);
  deploy(PAGE.replace('<title>', '<meta name="la-build" content="next" />\n    <title>'));
  try {
    // this launch still has the version it opened with; a later one has the new
    await page.reload();
    expect(await marked()).toBeNull();
    await expect
      .poll(async () => {
        await page.reload();
        return marked();
      })
      .toBe('next');
  } finally {
    deploy(PAGE);
  }
});

test("the window's title bar follows the appearance", async ({ page }) => {
  await page.goto(url);
  await expect(page.locator('#start-page')).toBeVisible();
  const colour = () => page.locator('meta[name="theme-color"]').getAttribute('content');
  const dark = (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark';
  expect(await colour()).toBe(dark ? WEB_APP.theme.dark : WEB_APP.theme.light);
  await page.locator('#start-theme').click();
  await expect.poll(colour).toBe(dark ? WEB_APP.theme.light : WEB_APP.theme.dark);
});

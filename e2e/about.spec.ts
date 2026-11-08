import { readFileSync } from 'node:fs';
import { apaCitation, cffCitationAuthors } from '../src/core/citation';
import { APP_URL, expect, openApp, openStart, test } from './helpers';

// Who made it, where to ask, how to cite, the licence: the start page, the "?" dialog, the file itself.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
  license: string;
  author: { name: string; email: string };
  repository: { url: string };
};
const COPYRIGHT = /Copyright \(c\) (.+)/.exec(readFileSync(new URL('../LICENSE', import.meta.url), 'utf8'))?.[1].trim() ?? '';
const REPOSITORY = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
const CITATION = apaCitation({ authors: cffCitationAuthors(readFileSync(new URL('../CITATION.cff', import.meta.url), 'utf8')), year: new Date().getFullYear(), version: pkg.version, url: REPOSITORY });

test('the start page names the author and the licence under the version', async ({ page }) => {
  await openStart(page);
  await expect(page.locator('#start-credit')).toHaveText(`© ${COPYRIGHT} · ${pkg.license} License`);
  await expect(page.locator('#start-credit')).toBeVisible();
  // under the version, clear of the cards
  const version = (await page.locator('#start-version').boundingBox())!;
  const credit = (await page.locator('#start-credit').boundingBox())!;
  const cards = (await page.locator('.start-cards').boundingBox())!;
  expect(credit.y).toBeGreaterThan(version.y + version.height);
  expect(credit.y + credit.height).toBeLessThan(cards.y);
});

test('the ? button opens on the about page: author, source, where to ask, how to cite, licence', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openApp(page, 'flake');
  await page.locator('#btn-help').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.modal-title')).toHaveText('Help');
  await expect(page.locator('#help-about')).toBeVisible();
  await expect(page.locator('#help-cols')).toBeHidden();
  await expect(page.locator('#help-tab-about')).toHaveAttribute('aria-checked', 'true');

  await expect(dialog).toContainText(pkg.author.name);
  await expect(page.locator('#about-version')).toHaveText(`v${await page.evaluate(() => window.lithicanalyst.version)}`);
  await expect(page.locator('#about-credit')).toHaveText(`© ${COPYRIGHT} · ${pkg.license} License`);
  await expect(page.locator('#about-repo')).toHaveAttribute('href', REPOSITORY);
  await expect(page.locator('#about-issues')).toHaveAttribute('href', `${REPOSITORY}/issues`);
  await expect(page.locator('#about-email')).toHaveAttribute('href', `mailto:${pkg.author.email}`);
  await expect(page.locator('#about-license')).toHaveAttribute('href', `${REPOSITORY}/blob/main/LICENSE`);
  // links open outside the app
  for (const id of ['#about-repo', '#about-issues', '#about-license']) await expect(page.locator(id)).toHaveAttribute('target', '_blank');
  await expect(dialog).toContainText('three.js, three-mesh-bvh (MIT) · IBM Plex (SIL OFL 1.1)');

  // the reference, its title in italics, and a copy of it as plain text
  await expect(page.locator('#about-cite')).toHaveText(CITATION);
  await expect(page.locator('#about-cite i')).toHaveText('LithicAnalyst');
  await page.locator('#about-cite-copy').click();
  await expect(page.locator('#about-cite-copied')).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CITATION);
});

test('the dialog keeps the page last looked at; the ? key opens the shortcuts', async ({ page }) => {
  await openApp(page, 'core');
  await page.locator('#btn-help').click();
  await page.locator('#help-tab-shortcuts').click();
  await expect(page.locator('#help-cols')).toBeVisible();
  await expect(page.locator('#help-about')).toBeHidden();
  await page.keyboard.press('Escape');
  await page.locator('#btn-help').click();
  await expect(page.locator('#help-cols')).toBeVisible();
  await page.locator('#help-tab-about').click();
  await page.keyboard.press('Escape');

  await page.keyboard.press('Shift+Slash');
  await expect(page.locator('#help-cols')).toBeVisible();
  await expect(page.locator('#help-tab-shortcuts')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  // in Chinese too
  await page.evaluate(() => localStorage.setItem('lithicanalyst:lang', 'zh'));
  await page.reload();
  await page.waitForFunction(() => !!window.lithicanalyst);
  await page.locator('#start-type-core').click();
  await page.locator('#btn-help').click();
  await expect(page.getByRole('dialog').locator('.modal-title')).toHaveText('帮助');
  await expect(page.locator('#help-tab-about')).toHaveText('关于');
});

test('the built file carries the author, the licence and the address at its top', () => {
  const html = readFileSync(new URL(APP_URL), 'utf8');
  const [, second] = html.split(/\r?\n/);
  expect(second).toBe(`<!-- LithicAnalyst ${pkg.version} · © ${COPYRIGHT} · ${pkg.license} License · ${REPOSITORY} -->`);
  expect(html).toMatch(new RegExp(`<meta name="author" content="${pkg.author.name}"\\s*/?>`));
});

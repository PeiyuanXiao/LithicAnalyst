import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APPLE_TOUCH_ICON, CACHE_NAME, ICON_DIR, keptFiles, packWebApp, serviceWorker, WEB_APP, WEB_APP_ICONS, webManifest, withWebApp } from '../scripts/webApp';

const ICONS = new URL('../src/assets/brand/app-icon/', import.meta.url);
const icon = (file: string): Uint8Array => readFileSync(new URL(file, ICONS));
/** A PNG's signature, and its width and height from the header. */
const png = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { signature: Buffer.from(bytes.subarray(0, 8)).toString('hex'), size: `${view.getUint32(16)}x${view.getUint32(20)}` };
};
const PNG_SIGNATURE = '89504e470d0a1a0a';

// a page as the build writes it: the theme script, then the app, whose code may say </head>
const PAGE = [
  '<!doctype html>',
  '<html lang="en">',
  '  <head>',
  '    <title>LithicAnalyst</title>',
  `    <script id="theme-init">document.documentElement.setAttribute('data-theme','light')</script>`,
  '    <script type="module">const page = "<head></head>";</script>',
  '  </head>',
  '  <body><div id="app"></div></body>',
  '</html>',
  '',
].join('\n');

describe('the page', () => {
  it('gains the manifest, the title bar colour, the touch icon and the worker right after the theme script, and nothing else changes', () => {
    const out = withWebApp(PAGE);
    const at = PAGE.indexOf('</script>') + '</script>'.length;
    const rest = PAGE.length - at;
    expect(out.slice(0, at)).toBe(PAGE.slice(0, at));
    expect(out.slice(out.length - rest)).toBe(PAGE.slice(at));
    const added = out.slice(at, out.length - rest);
    expect(added).toContain('<link rel="manifest" href="manifest.webmanifest" />');
    expect(added).toContain(`<meta name="theme-color" content="${WEB_APP.theme.light}" />`);
    expect(added).toContain(`<link rel="apple-touch-icon" href="${ICON_DIR}/${APPLE_TOUCH_ICON}" />`);
    expect(added).toContain("navigator.serviceWorker.register('sw.js')");
    expect(added).toContain(WEB_APP.theme.dark);
    expect(added.match(/<script/g)).toHaveLength(1);
    // all of it on the site itself
    expect(added).not.toMatch(/[a-z]+:\/\//i);
  });

  it('goes after the title when there is no theme script', () => {
    const page = PAGE.replace(/ *<script id="theme-init">.*<\/script>\n/, '');
    const out = withWebApp(page);
    expect(out.indexOf('rel="manifest"')).toBeGreaterThan(out.indexOf('</title>'));
    expect(out.indexOf('rel="manifest"')).toBeLessThan(out.indexOf('<script type="module">'));
  });

  it('is not given a second manifest, and needs a place for its tags', () => {
    expect(() => withWebApp(withWebApp(PAGE))).toThrow(/manifest/);
    expect(() => withWebApp('<html><body></body></html>')).toThrow(/nowhere/);
  });
});

describe('the manifest', () => {
  const manifest = webManifest() as { icons: Array<{ src: string; sizes: string; type: string; purpose: string }> };

  it('names the app and opens it in a window of its own, wherever the site is put', () => {
    expect(manifest).toMatchObject({
      id: './',
      name: 'LithicAnalyst',
      short_name: 'LithicAnalyst',
      start_url: './',
      scope: './',
      display: 'standalone',
      background_color: WEB_APP.background,
      theme_color: WEB_APP.theme.light,
    });
  });

  it('lists PNG icons that are there, at the size it says, one of them maskable', () => {
    expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.filter((i) => i.purpose === 'maskable')).toHaveLength(1);
    for (const i of manifest.icons) {
      expect(i.src.startsWith(`${ICON_DIR}/`)).toBe(true);
      expect(i.type).toBe('image/png');
      expect(png(icon(i.src.slice(ICON_DIR.length + 1)))).toEqual({ signature: PNG_SIGNATURE, size: i.sizes });
    }
  });

  it('has a touch icon of 180 px beside it', () => {
    expect(png(icon(APPLE_TOUCH_ICON))).toEqual({ signature: PNG_SIGNATURE, size: '180x180' });
  });
});

describe('the site', () => {
  const files = packWebApp(PAGE, '9.9.9', icon);

  it('has the page, the manifest, the worker and the icons; the worker keeps every other file', () => {
    const icons = [...WEB_APP_ICONS.map((i) => i.file), APPLE_TOUCH_ICON].map((f) => `${ICON_DIR}/${f}`);
    expect([...files.keys()].sort()).toEqual(['index.html', 'manifest.webmanifest', 'sw.js', ...icons].sort());
    expect(keptFiles().map((f) => (f === './' ? 'index.html' : f)).sort()).toEqual([...files.keys()].filter((f) => f !== 'sw.js').sort());
    expect(files.get('index.html')).toBe(withWebApp(PAGE));
    expect(JSON.parse(files.get('manifest.webmanifest') as string)).toEqual(webManifest());
  });

  it('gets a new worker with every new build, and the same one for the same build', () => {
    const worker = files.get('sw.js') as string;
    expect(worker).toContain('LithicAnalyst 9.9.9');
    expect(worker).toContain(JSON.stringify(CACHE_NAME));
    expect(packWebApp(PAGE, '9.9.9', icon).get('sw.js')).toBe(worker);
    expect(packWebApp(PAGE.replace('<div id="app">', '<div id="app" class="next">'), '9.9.9', icon).get('sw.js')).not.toBe(worker);
  });

  it('has a worker that is a script', () => {
    expect(() => new Function(serviceWorker('1.0.0', 'abc'))).not.toThrow();
  });
});

describe('the app icon drawings', () => {
  for (const name of ['app-icon.svg', 'app-icon-maskable.svg']) {
    it(`${name} holds no address but its namespace`, () => {
      const svg = readFileSync(new URL(name, ICONS), 'utf8');
      expect(svg.match(/xmlns="[^"]+"/g)).toEqual(['xmlns="http://www.w3.org/2000/svg"']);
      const rest = svg.replace('xmlns="http://www.w3.org/2000/svg"', '');
      expect(rest).not.toMatch(/[a-z]+:\/\//i);
      expect(rest).not.toMatch(/\bhref\s*=/i);
    });
  }
});

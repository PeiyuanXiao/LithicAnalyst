// The installable web app (`npm run pages`): what the built single-file page needs to be one on a
// static host such as GitHub Pages — a web app manifest, a service worker that keeps the app for use
// offline, and a few tags in the page's head. dist/index.html itself is not touched: the file opened
// from the disk still asks nothing of the network: at run time the app loads no network resource,
// fonts included (docs/architecture.md, "Hosting"). Used by scripts/pages.ts and the tests; no DOM,
// no three.js.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, resolve, sep } from 'node:path';

export const WEB_APP = {
  name: 'LithicAnalyst',
  description: 'Open-source 3D annotation and measurement of lithic artefacts. It runs in the browser, offline; the data stay on your computer.',
  /** The start page's paper: the window's colour before the page is drawn. */
  background: '#f0ebe0',
  /** The top bar (`--surface-head`) in the light and the dark appearance: the colour of the window's title bar. */
  theme: { light: '#efeadf', dark: '#151716' },
} as const;

/** The icons (src/assets/brand/app-icon/, made by scripts/app-icons.mjs), served from ICON_DIR. */
export const WEB_APP_ICONS = [
  { file: 'icon-192.png', size: 192, purpose: 'any' },
  { file: 'icon-512.png', size: 512, purpose: 'any' },
  { file: 'icon-maskable-512.png', size: 512, purpose: 'maskable' },
] as const;
export const APPLE_TOUCH_ICON = 'apple-touch-icon.png';
export const ICON_DIR = 'icons';

/** The service worker's cache. Change it only when the worker comes to keep its files another way. */
export const CACHE_NAME = 'lithicanalyst-app-1';

export function webManifest(): Record<string, unknown> {
  return {
    id: './',
    name: WEB_APP.name,
    short_name: WEB_APP.name,
    description: WEB_APP.description,
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: WEB_APP.background,
    theme_color: WEB_APP.theme.light,
    lang: 'en',
    dir: 'ltr',
    icons: WEB_APP_ICONS.map((i) => ({ src: `${ICON_DIR}/${i.file}`, sizes: `${i.size}x${i.size}`, type: 'image/png', purpose: i.purpose })),
  };
}

/** Every file of the site but the worker, as the worker asks for it (relative to itself; `./` is the page). */
export function keptFiles(): string[] {
  return ['./', 'manifest.webmanifest', ...WEB_APP_ICONS.map((i) => `${ICON_DIR}/${i.file}`), `${ICON_DIR}/${APPLE_TOUCH_ICON}`];
}

/**
 * The service worker. It keeps every file of the site from the first visit on, so the app opens
 * offline. A file comes from what is kept, at once, and is fetched again behind it (past the HTTP
 * cache): a new version is there at the next launch, never in the middle of a session. `stamp` changes
 * with every build, so the browser installs the worker again, and it keeps the new files.
 */
export function serviceWorker(version: string, stamp: string): string {
  return `// LithicAnalyst ${version} (${stamp}): keeps the app for use offline. Made by scripts/pages.ts.
const CACHE = ${JSON.stringify(CACHE_NAME)};
const FILES = ${JSON.stringify(keptFiles())};
const PAGE = new URL('./', self.registration.scope).href;

// the page must be kept; a file missing from the site (an icon, say) is not kept, and nothing else fails
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(FILES.map((file) => cache.add(new Request(file, { cache: 'reload' })).catch((error) => { if (file === './') throw error; }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('lithicanalyst-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/** The file from the network, kept under \`key\`; undefined when the network fails. */
async function refresh(url, key) {
  try {
    const response = await fetch(url, { cache: 'no-cache' });
    if (response.ok) await (await caches.open(CACHE)).put(key, response.clone());
    return response;
  } catch {
    return undefined;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  // the page under any of its names (the folder, index.html, with a query) is one kept copy
  const key = request.mode === 'navigate' || url.pathname.endsWith('/index.html') ? PAGE : url.origin + url.pathname;
  const fresh = refresh(key, key);
  event.waitUntil(fresh);
  event.respondWith(caches.match(key).then((kept) => kept || fresh.then((response) => response || Response.error())));
});
`;
}

/** What the page's head gains: the manifest, the title bar's colour (following the appearance), the touch icon, the worker. */
export function headTags(): string {
  const { light, dark } = WEB_APP.theme;
  const script =
    `(function(){var r=document.documentElement,m=document.querySelector('meta[name="theme-color"]');` +
    `function t(){m.content=r.getAttribute('data-theme')==='dark'?'${dark}':'${light}'}t();` +
    `new MutationObserver(t).observe(r,{attributes:true,attributeFilter:['data-theme']});` +
    `if('serviceWorker' in navigator&&location.protocol!=='file:')addEventListener('load',function(){navigator.serviceWorker.register('sw.js')})})();`;
  return [
    '<link rel="manifest" href="manifest.webmanifest" />',
    `<meta name="theme-color" content="${light}" />`,
    `<link rel="apple-touch-icon" href="${ICON_DIR}/${APPLE_TOUCH_ICON}" />`,
    `<script id="web-app">${script}</script>`,
  ].join('\n    ');
}

/** The page with its web app tags, right after the theme script (else after the title); nothing else changes. */
export function withWebApp(html: string): string {
  if (/<link\b[^>]*rel="manifest"/.test(html)) throw new Error('the page has a web app manifest already');
  const theme = /<script id="theme-init">[\s\S]*?<\/script>/.exec(html);
  const at = theme ? theme.index + theme[0].length : html.indexOf('</title>') < 0 ? -1 : html.indexOf('</title>') + '</title>'.length;
  if (at < 0) throw new Error('no theme script and no title in the page: nowhere to put the web app tags');
  return `${html.slice(0, at)}\n    ${headTags()}${html.slice(at)}`;
}

/**
 * The site, by path: the page with its tags, the manifest, the worker and the icons (`icon` reads one
 * from src/assets/brand/app-icon/). The worker's stamp is the hash of everything else.
 */
export function packWebApp(html: string, version: string, icon: (file: string) => Uint8Array): Map<string, string | Uint8Array> {
  const files = new Map<string, string | Uint8Array>();
  files.set('index.html', withWebApp(html));
  files.set('manifest.webmanifest', `${JSON.stringify(webManifest(), null, 2)}\n`);
  for (const file of [...WEB_APP_ICONS.map((i) => i.file), APPLE_TOUCH_ICON]) files.set(`${ICON_DIR}/${file}`, icon(file));
  const hash = createHash('sha256');
  for (const [path, body] of files) hash.update(path).update(body);
  files.set('sw.js', serviceWorker(version, hash.digest('hex').slice(0, 12)));
  return files;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** A static server for the site on this computer only (`port` 0: any free one), to install and try it. */
export function serveDir(dir: string, port: number): Promise<Server> {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = resolve(root, `.${path}`);
    if (!file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    readFile(file).then(
      (body) => res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(body),
      () => res.writeHead(404).end(),
    );
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, 'localhost', () => ok(server));
  });
}

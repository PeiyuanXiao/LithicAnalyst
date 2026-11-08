// `npm run pages`: the built app (dist/index.html) as an installable web app in dist/pages/, ready for
// a static host such as GitHub Pages — the page with its web app tags, manifest.webmanifest, sw.js and
// the icons (scripts/webApp.ts). `npm run pages -- --serve` then serves it on http://localhost:4173/
// (`--port <n>` for another port) to install and try it in Chrome or Edge. dist/index.html is left as it is.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { packWebApp, serveDir } from './webApp';

const ROOT = process.cwd();
const PAGE = join(ROOT, 'dist', 'index.html');
const OUT = join(ROOT, 'dist', 'pages');
const ICONS = join(ROOT, 'src', 'assets', 'brand', 'app-icon');

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const port = portArg >= 0 ? Number(args[portArg + 1]) : 4173;

if (!existsSync(PAGE)) {
  console.error('dist/index.html is missing: run `npm run build` first');
  process.exit(1);
}
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
const files = packWebApp(readFileSync(PAGE, 'utf8'), version, (file) => readFileSync(join(ICONS, file)));

rmSync(OUT, { recursive: true, force: true });
for (const [path, body] of files) {
  mkdirSync(dirname(join(OUT, path)), { recursive: true });
  writeFileSync(join(OUT, path), body);
}
console.log(`${relative(ROOT, OUT).replace(/\\/g, '/')}/: ${[...files.keys()].join(', ')}`);

if (args.includes('--serve')) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`not a port: ${args[portArg + 1]}`);
    process.exit(1);
  }
  const server = await serveDir(OUT, port);
  const address = server.address();
  const at = typeof address === 'object' && address ? address.port : port;
  console.log(`http://localhost:${at}/  (Chrome or Edge: the install button is at the right of the address bar; Ctrl+C stops)`);
}

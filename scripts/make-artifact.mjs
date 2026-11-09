// Produces dist/artifact.html: the same single-file app without the document
// skeleton (doctype/html/head/body), for hosts that wrap pages themselves
// (e.g. claude.ai artifacts). dist/index.html stays a complete standalone page.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

const pick = (re) => [...src.matchAll(re)].map((m) => m[0]);
// who made it, under what licence, where it lives (vite.config.ts, credit()): kept at the top here too
const credit = pick(/<!-- LithicAnalyst [^\n]*?-->/g).slice(0, 1);
// the licences of the bundled libraries, which must go with every copy
const notices = pick(/<!-- Third-party software notices[\s\S]*?-->/g).slice(0, 1);
const title = pick(/<title>[\s\S]*?<\/title>/g)[0] ?? '<title>LithicAnalyst</title>';
const metas = pick(/<meta name="(?:claude:viewport-fit-sides|description|author)"[^>]*>/g);
const links = pick(/<link\b[^>]*>/g).filter((l) => /fonts\.(googleapis|gstatic)\.com/.test(l));
const styles = pick(/<style[^>]*>[\s\S]*?<\/style>/g);
// the theme is set before the first frame (index.html), then the app itself
const themeInit = pick(/<script id="theme-init">[\s\S]*?<\/script>/g);
const scripts = pick(/<script type="module"[^>]*>[\s\S]*?<\/script>/g);
const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/.exec(src);
const bodyMarkup = (bodyMatch ? bodyMatch[1] : '<div id="app"></div>').replace(/<script[\s\S]*?<\/script>/g, '').trim();

if (!scripts.length) throw new Error('No inline module script found in dist/index.html');
if (!notices.length) throw new Error('No third-party notices found in dist/index.html');

const out = [...credit, ...notices, title, ...metas, ...links, ...themeInit, ...styles, bodyMarkup, ...scripts].join('\n');
writeFileSync(new URL('../dist/artifact.html', import.meta.url), out);
console.log(`artifact.html: ${(out.length / 1024).toFixed(0)} KiB`);

// Produces dist/artifact.html: the same single-file app without the document
// skeleton (doctype/html/head/body), for hosts that wrap pages themselves
// (e.g. claude.ai artifacts). dist/index.html stays a complete standalone page.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

const pick = (re) => [...src.matchAll(re)].map((m) => m[0]);
const title = pick(/<title>[\s\S]*?<\/title>/g)[0] ?? '<title>LithicAnalyst</title>';
const metas = pick(/<meta name="(?:claude:viewport-fit-sides|description)"[^>]*>/g);
const links = pick(/<link\b[^>]*>/g).filter((l) => /fonts\.(googleapis|gstatic)\.com/.test(l));
const styles = pick(/<style[^>]*>[\s\S]*?<\/style>/g);
const scripts = pick(/<script type="module"[^>]*>[\s\S]*?<\/script>/g);
const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/.exec(src);
const bodyMarkup = (bodyMatch ? bodyMatch[1] : '<div id="app"></div>').replace(/<script[\s\S]*?<\/script>/g, '').trim();

if (!scripts.length) throw new Error('No inline module script found in dist/index.html');

const out = [title, ...metas, ...links, ...styles, bodyMarkup, ...scripts].join('\n');
writeFileSync(new URL('../dist/artifact.html', import.meta.url), out);
console.log(`artifact.html: ${(out.length / 1024).toFixed(0)} KiB`);

/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import pkg from './package.json' with { type: 'json' };

/**
 * Who made it, under what licence, where it lives: from package.json, and the copyright line from
 * LICENSE ("Copyright (c) 2026 Peiyuan Xiao"). The about page, the exports' manifest and the page's head use it.
 */
const copyright = /Copyright \(c\) (.+)/.exec(readFileSync(new URL('./LICENSE', import.meta.url), 'utf8'))?.[1].trim() ?? pkg.author.name;
const ABOUT = {
  author: pkg.author.name,
  email: pkg.author.email,
  repository: pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''),
  license: pkg.license,
  copyright,
  /** The year of the build: the year of the version in a citation. */
  year: new Date().getFullYear(),
};

/** The author and the licence where anyone holding the file sees them: a comment at its top, and the author meta. */
function credit(): Plugin {
  return {
    name: 'lithicanalyst-credit',
    transformIndexHtml(html) {
      const note = `<!-- LithicAnalyst ${pkg.version} · © ${ABOUT.copyright} · ${ABOUT.license} License · ${ABOUT.repository} -->`;
      return {
        html: html.replace(/^(<!doctype html>)(\r?\n)/i, (_, doctype: string, eol: string) => `${doctype}${eol}${note}${eol}`),
        tags: [{ tag: 'meta', attrs: { name: 'author', content: ABOUT.author }, injectTo: 'head' }],
      };
    },
  };
}

/** The small logo as the page's icon, in the fixed ink: inside the file, like everything else. */
function favicon(): Plugin {
  return {
    name: 'lithicanalyst-favicon',
    transformIndexHtml() {
      const svg = readFileSync(new URL('./src/assets/brand/logo-small.svg', import.meta.url), 'utf8').trim().split('currentColor').join('#1f1d19');
      return [{ tag: 'link', attrs: { rel: 'icon', type: 'image/svg+xml', href: `data:image/svg+xml,${encodeURIComponent(svg)}` }, injectTo: 'head' }];
    },
  };
}

// The whole app is bundled into one self-contained HTML file (dist/index.html)
// so it can be opened offline, shared as a single file, or hosted anywhere.
export default defineConfig({
  base: './',
  plugins: [favicon(), credit(), viteSingleFile()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_ABOUT__: JSON.stringify(ABOUT),
  },
  build: {
    target: 'es2020',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4000,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});

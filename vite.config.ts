/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import pkg from './package.json' with { type: 'json' };
import { cffAuthors, cffCitationAuthors, cffCitationDoi } from './src/core/citation';

/**
 * Who made it, under what licence, where it lives: the contact, licence and address from package.json,
 * the copyright line from LICENSE ("Copyright (c) 2026 Peiyuan Xiao"), the authors from CITATION.cff
 * ("Peiyuan Xiao, Ben Marwick") and the names to cite from its preferred-citation ("P. Y. Xiao",
 * "Ben Marwick"). The about page, the exports' manifest and the page's head use it.
 */
const copyright = /Copyright \(c\) (.+)/.exec(readFileSync(new URL('./LICENSE', import.meta.url), 'utf8'))?.[1].trim() ?? pkg.author.name;
const cff = readFileSync(new URL('./CITATION.cff', import.meta.url), 'utf8');
const authors = cffAuthors(cff);
const citationAuthors = cffCitationAuthors(cff);
const ABOUT = {
  /** The authors, "given family", joined with commas. */
  author: (authors.length ? authors : [pkg.author.name]).join(', '),
  /** The authors as cited, "given family". */
  citationAuthors: citationAuthors.length ? citationAuthors : [pkg.author.name],
  /** The DOI to cite (Zenodo's concept DOI, all versions), from CITATION.cff; null without one. */
  doi: cffCitationDoi(cff),
  email: pkg.author.email,
  repository: pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''),
  license: pkg.license,
  copyright,
  /** The year of the build: the year of the version in a citation. */
  year: new Date().getFullYear(),
};

/**
 * The bundled libraries whose licence must go with every copy, read in full from the package at build
 * time. three.js keeps its own @license comment in the script.
 */
const THIRD_PARTY = ['three-mesh-bvh'];

/** The third-party notices as one comment, lines joined with `eol`. */
function thirdPartyNotice(eol: string): string {
  const parts = THIRD_PARTY.map((name) => {
    const { version } = JSON.parse(readFileSync(new URL(`./node_modules/${name}/package.json`, import.meta.url), 'utf8')) as { version: string };
    const license = readFileSync(new URL(`./node_modules/${name}/LICENSE`, import.meta.url), 'utf8').replace(/\r\n?/g, '\n').trim();
    if (/<!--|--!?>/.test(license)) throw new Error(`${name}/LICENSE has text that would end an HTML comment`);
    return `${name} ${version}\n\n${license}`;
  });
  return ['<!-- Third-party software notices', ...parts, '-->'].join('\n\n').split('\n').join(eol);
}

/**
 * The author and the licence where anyone holding the file sees them: a comment at its top, the
 * third-party notices after it, and the author meta.
 */
function credit(): Plugin {
  return {
    name: 'lithicanalyst-credit',
    transformIndexHtml(html) {
      const note = `<!-- LithicAnalyst ${pkg.version} · © ${ABOUT.copyright} · ${ABOUT.license} License · ${ABOUT.repository} -->`;
      return {
        html: html.replace(/^(<!doctype html>)(\r?\n)/i, (_, doctype: string, eol: string) => `${doctype}${eol}${note}${eol}${thirdPartyNotice(eol)}${eol}`),
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

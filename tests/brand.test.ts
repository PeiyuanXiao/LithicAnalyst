import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND, brandInner, brandSvg } from '../src/ui/brand';

const DIR = resolve(__dirname, '../src/assets/brand');
const files = readdirSync(DIR).filter((f) => f.endsWith('.svg'));
const text = (name: string) => readFileSync(resolve(DIR, name), 'utf8');

const idsIn = (svg: string) => [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const refsIn = (svg: string) => [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
const WITH_IDS = { logo: BRAND.logo, core: BRAND.icons.core, generic: BRAND.icons.generic };

describe('brandSvg', () => {
  for (const [name, raw] of Object.entries(WITH_IDS)) {
    it(`gives two copies of ${name} ids of their own, and every reference goes with them`, () => {
      const a = brandSvg(raw, 'pa');
      const b = brandSvg(raw, 'pb');
      expect(a).not.toContain('LAID');
      expect(b).not.toContain('LAID');
      const [ia, ib] = [idsIn(a), idsIn(b)];
      expect(ia.length).toBeGreaterThan(0);
      expect(ia.filter((id) => ib.includes(id))).toEqual([]);
      // what each copy refers to is in that copy
      expect(refsIn(a).length).toBeGreaterThan(0);
      for (const ref of refsIn(a)) expect(ia).toContain(ref);
      for (const ref of refsIn(b)) expect(ib).toContain(ref);
    });
  }

  it('leaves a drawing with no ids as it is', () => {
    for (const raw of [BRAND.logoSmall, BRAND.icons.flake, BRAND.wordmark]) {
      expect(brandSvg(raw, 'p')).toBe(raw);
      expect(idsIn(raw)).toEqual([]);
    }
  });

  it('takes a drawing out of its own svg, to place in another', () => {
    const inner = brandInner(BRAND.icons.flake, 'p');
    expect(inner).not.toMatch(/<\/?svg/);
    expect(inner).toContain('class="pc"');
    expect(brandInner(BRAND.icons.core, 'p')).toContain('url(#p-m)');
  });
});

describe('the brand files', () => {
  it('are all there', () => {
    expect(files.sort()).toEqual(['ghost-core.svg', 'ghost-flake.svg', 'ghost-general.svg', 'icon-core.svg', 'icon-flake.svg', 'icon-generic.svg', 'logo-small.svg', 'logo.svg', 'wordmark.svg']);
  });

  for (const name of files) {
    it(`${name} holds no address but its namespace`, () => {
      const svg = text(name);
      expect(svg.match(/xmlns="[^"]+"/g)).toEqual(['xmlns="http://www.w3.org/2000/svg"']);
      const rest = svg.replace('xmlns="http://www.w3.org/2000/svg"', '');
      expect(rest).not.toMatch(/[a-z]+:\/\//i);
      expect(rest).not.toMatch(/\bhref\s*=/i);
      expect(rest).not.toMatch(/@import/i);
      // only references inside itself
      expect(rest.match(/url\((?!#)/g)).toBeNull();
    });

    it(`${name} leaves its size to its container`, () => {
      const root = /^<svg[^>]*>/.exec(text(name))![0];
      expect(root).toMatch(/viewBox="/);
      expect(root).not.toMatch(/\s(width|height)=/);
    });
  }

  it('the wordmark is two outlines in the colour of the text, in a box round its ink', () => {
    const svg = text('wordmark.svg');
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg.match(/fill="currentColor"/g)).toHaveLength(2);
    expect(svg).not.toMatch(/<text|font-family/);
    // the outlines reach all four sides of the box, in thousandths of an em
    const [, w, h] = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!;
    expect(+w).toBe(5302);
    expect(+h).toBe(949);
  });

  it('the ghost words are one outline each, in a line 0.8 em tall', () => {
    for (const [name, advance] of [['core', 2303], ['flake', 2712], ['general', 3966]] as const) {
      const svg = text(`ghost-${name}.svg`);
      expect(svg.match(/<path /g)).toHaveLength(1);
      expect(svg).toContain(`viewBox="0 0 ${advance} 800"`);
    }
  });
});

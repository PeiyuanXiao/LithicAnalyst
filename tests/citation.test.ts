import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { apaAuthors, apaCitation, apaCitationParts, apaName } from '../src/core/citation';
import { appInfo, citation, creditLine, ISSUES_URL, LICENSE_URL } from '../src/ui/about';

describe('a name as APA writes it', () => {
  it('is the family name, then the initials of the given names', () => {
    expect(apaName('Peiyuan Xiao')).toBe('Xiao, P.');
    expect(apaName('  Anna   Maria Rossi ')).toBe('Rossi, A. M.');
    expect(apaName('Jean-Paul Martin')).toBe('Martin, J.-P.');
    expect(apaName('Plato')).toBe('Plato');
    expect(apaName('')).toBe('');
  });

  it('joins two authors and more with a comma and an ampersand', () => {
    expect(apaAuthors(['Peiyuan Xiao'])).toBe('Xiao, P.');
    expect(apaAuthors(['Peiyuan Xiao', 'Anna Rossi'])).toBe('Xiao, P., & Rossi, A.');
    expect(apaAuthors(['Peiyuan Xiao', 'Anna Rossi', 'Jean Martin'])).toBe('Xiao, P., Rossi, A., & Martin, J.');
  });
});

describe('the reference', () => {
  const source = { authors: ['Peiyuan Xiao'], year: 2026, version: '0.1.0', url: 'https://github.com/PeiyuanXiao/LithicAnalyst' };

  it('is APA software: author, year, title, version, kind, publisher, address', () => {
    expect(apaCitation(source)).toBe('Xiao, P. (2026). LithicAnalyst (Version 0.1.0) [Computer software]. GitHub. https://github.com/PeiyuanXiao/LithicAnalyst');
  });

  it('comes in three parts, the title alone in the middle (for italics)', () => {
    const p = apaCitationParts(source);
    expect(p.title).toBe('LithicAnalyst');
    expect(p.before + p.title + p.after).toBe(apaCitation(source));
  });
});

describe('what the program says of itself', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
    license: string;
    author: { name: string; email: string };
    repository: { url: string };
  };
  const copyright = /Copyright \(c\) (.+)/.exec(readFileSync(new URL('../LICENSE', import.meta.url), 'utf8'))?.[1].trim();
  const repository = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');

  it('comes from package.json and LICENSE, and names the author in the licence', () => {
    expect(copyright).toContain(pkg.author.name);
    expect(creditLine()).toBe(`© ${copyright} · ${pkg.license} License`);
    expect(ISSUES_URL).toBe(`${repository}/issues`);
    expect(LICENSE_URL).toBe(`${repository}/blob/main/LICENSE`);
  });

  it('is what the exports\' manifest carries, with this version\'s reference', () => {
    expect(appInfo()).toEqual({ name: 'LithicAnalyst', version: pkg.version, author: pkg.author.name, license: pkg.license, repository, citation: citation() });
    expect(citation()).toBe(apaCitation({ authors: [pkg.author.name], year: new Date().getFullYear(), version: pkg.version, url: repository }));
  });

  it('is what CITATION.cff says: a new version is written there too', () => {
    const cff = readFileSync(new URL('../CITATION.cff', import.meta.url), 'utf8');
    const field = (key: string) => new RegExp(`^ *-? *${key}: *"?([^"\\r\\n]+)"?\\s*$`, 'm').exec(cff)?.[1].trim();
    expect(field('version')).toBe(pkg.version);
    expect(field('license')).toBe(pkg.license);
    expect(field('repository-code')).toBe(repository);
    expect(`${field('given-names')} ${field('family-names')}`).toBe(pkg.author.name);
    expect(field('email')).toBe(pkg.author.email);
  });
});

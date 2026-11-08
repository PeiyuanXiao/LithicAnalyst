/**
 * How to cite LithicAnalyst: a reference in APA style (7th edition, software), from the author,
 * the year, the version and the address of the repository. No DOM; the about page and the tests use it.
 */

/** "Peiyuan Xiao" → "Xiao, P."; "P. Y. Xiao" → "Xiao, P. Y."; "Jean-Paul Anne Martin" → "Martin, J.-P. A."; a one-word name stays as it is. */
export function apaName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  const family = parts[parts.length - 1];
  const initials = parts
    .slice(0, -1)
    .map((given) => given.split('-').map((p) => `${p.charAt(0).toUpperCase()}.`).join('-'))
    .join(' ');
  return `${family}, ${initials}`;
}

/** The authors as APA lists them: "A", "A, & B", "A, B, & C". */
export function apaAuthors(names: readonly string[]): string {
  const list = names.map(apaName).filter(Boolean);
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')}, & ${list[list.length - 1]}`;
}

/**
 * The authors of the `preferred-citation` in CITATION.cff, each as "given family" ("P. Y. Xiao"): the
 * names as the program is to be cited, which may give initials apart from the display name ("Peiyuan
 * Xiao"). GitHub's "Cite this repository" reads the same entry. Empty when there is none. Only the
 * two keys are read, line by line; no YAML parser.
 */
export function cffCitationAuthors(cff: string): string[] {
  const lines = cff.split(/\r?\n/);
  const start = lines.findIndex((line) => /^preferred-citation:\s*$/.test(line));
  if (start < 0) return [];
  const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, '$2');
  const authors: Array<{ family?: string; given?: string }> = [];
  let indent = -1;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const m = /^(\s*)(-\s*)?([\w-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, space, dash, key, value] = m;
    if (indent < 0) {
      if (key === 'authors' && !dash) indent = space.length;
      continue;
    }
    if (!dash && space.length <= indent) break;
    if (dash) authors.push({});
    const author = authors[authors.length - 1];
    if (!author) continue;
    if (key === 'family-names') author.family = unquote(value);
    if (key === 'given-names') author.given = unquote(value);
  }
  return authors.filter((a) => a.family).map((a) => [a.given, a.family].filter(Boolean).join(' '));
}

export interface CitationSource {
  authors: readonly string[];
  year: number;
  version: string;
  /** The repository's address. */
  url: string;
}

/** The reference in three parts, the title (to be set in italics) in the middle. */
export function apaCitationParts(s: CitationSource): { before: string; title: string; after: string } {
  return {
    before: `${apaAuthors(s.authors)} (${s.year}). `,
    title: 'LithicAnalyst',
    after: ` (Version ${s.version}) [Computer software]. GitHub. ${s.url}`,
  };
}

/** The reference as plain text: Xiao, P. (2026). LithicAnalyst (Version 0.1.0) [Computer software]. GitHub. https://… */
export function apaCitation(s: CitationSource): string {
  const p = apaCitationParts(s);
  return p.before + p.title + p.after;
}

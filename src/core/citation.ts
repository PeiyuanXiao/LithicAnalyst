/**
 * How to cite LithicAnalyst: a reference in APA style (7th edition, software), from the author,
 * the year, the version and the address of the repository. No DOM; the about page and the tests use it.
 */

/** "Peiyuan Xiao" → "Xiao, P."; "Jean-Paul Anne Martin" → "Martin, J.-P. A."; a one-word name stays as it is. */
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

import type { HarrisLayout } from '../compute/relations';

const NODE_W = 44;
const NODE_H = 24;

/** The matrix's colours and type: the panel draws it in the shell's colours, the export in print colours on white. */
export interface HarrisPalette {
  /** Under everything (null: nothing, the panel shows through). */
  background: string | null;
  /** A direct relation's line, and one in a cycle. */
  line: string;
  cycle: string;
  /** The sequences' dashed frames and their labels. */
  box: string;
  /** A scar in no sequence: its fill, outline and label. */
  node: string;
  nodeStroke: string;
  nodeInk: string;
  /** The selected scar: its outline, and its fill when it has no sequence colour. */
  selected: string;
  selectedFill: string;
  font: string;
  /** Of the scar labels (null: the font's own). */
  weight: number | null;
}

/** On the page: the shell's own colours, in both themes. */
export const HARRIS_SCREEN: HarrisPalette = {
  background: null,
  line: 'var(--ink-2)',
  cycle: 'var(--danger)',
  box: 'var(--ink-3)',
  node: 'var(--surface)',
  nodeStroke: 'var(--line-strong)',
  nodeInk: 'var(--ink)',
  selected: 'var(--accent-line)',
  selectedFill: 'var(--accent-soft)',
  font: '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace',
  weight: 600,
};

/** In a publication: the light colours on a clear ground, whatever the theme. */
export const HARRIS_PRINT: HarrisPalette = {
  background: null,
  line: '#4a4f57',
  cycle: '#d62828',
  box: '#7d838c',
  node: '#ffffff',
  nodeStroke: '#2b2f36',
  nodeInk: '#1d2025',
  selected: '#a8670f',
  selectedFill: '#f6dcae',
  font: 'Helvetica, Arial, sans-serif',
  weight: null,
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Dark text on light fills, white on dark ones. */
function textOn(fill: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(fill);
  if (!m) return '#1d2025';
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.55 ? '#1d2025' : '#ffffff';
}

export interface HarrisStyle {
  /** Scar labels by id. */
  labels: Map<string, string>;
  /** Fill of each scar's node (the scars not listed have the palette's node fill). */
  fills: Map<string, string>;
  /** Selected scar (drawn with a thick outline), or null. */
  selected: string | null;
}

/**
 * The Harris matrix as SVG: scars as boxes, later ones higher; lines join the
 * scars of each direct relation (in the cycle colour when in a cycle); dashed
 * frames group the sequences. Nodes carry `data-id` (the scar id), the selected
 * one also the class `is-selected`.
 */
export function harrisSvg(layout: HarrisLayout, style: HarrisStyle, palette: HarrisPalette = HARRIS_PRINT): string {
  const P = palette;
  const pos = new Map(layout.nodes.map((n) => [n.id, n]));
  const parts: string[] = [];
  if (P.background) parts.push(`<rect width="100%" height="100%" fill="${P.background}"/>`);
  for (const b of layout.boxes)
    parts.push(
      `<g class="hm-box"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="4" fill="none" stroke="${P.box}" stroke-dasharray="4 3"/>` +
        `<text x="${b.x + 5}" y="${b.y + 12}" font-size="10" fill="${P.box}">${esc(b.label)}</text></g>`,
    );
  for (const e of layout.edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    const down = b.y > a.y;
    const y1 = a.y + (down ? NODE_H / 2 : -NODE_H / 2);
    const y2 = b.y + (down ? -NODE_H / 2 : NODE_H / 2);
    parts.push(`<line class="hm-edge${e.cycle ? ' hm-cycle' : ''}" x1="${a.x}" y1="${y1}" x2="${b.x}" y2="${y2}" stroke="${e.cycle ? P.cycle : P.line}" stroke-width="${e.cycle ? 2 : 1.4}"/>`);
  }
  const weight = P.weight === null ? '' : ` font-weight="${P.weight}"`;
  for (const n of layout.nodes) {
    const own = style.fills.get(n.id);
    const sel = n.id === style.selected;
    const fill = own ?? (sel ? P.selectedFill : P.node);
    const ink = own ? textOn(own) : P.nodeInk;
    parts.push(
      `<g class="hm-node${sel ? ' is-selected' : ''}" data-id="${esc(n.id)}"><rect x="${n.x - NODE_W / 2}" y="${n.y - NODE_H / 2}" width="${NODE_W}" height="${NODE_H}" rx="4" fill="${fill}" stroke="${sel ? P.selected : P.nodeStroke}" stroke-width="${sel ? 2.5 : 1}"/>` +
        `<text x="${n.x}" y="${n.y + 4}" text-anchor="middle" font-size="12"${weight} fill="${ink}">${esc(style.labels.get(n.id) ?? '')}</text></g>`,
    );
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" font-family="${esc(P.font)}">` +
    parts.join('') +
    '</svg>'
  );
}

import type { HarrisLayout } from '../compute/relations';

const NODE_W = 44;
const NODE_H = 24;
export const HARRIS_COLORS = { line: '#4a4f57', cycle: '#d62828', box: '#7d838c', node: '#ffffff', stroke: '#2b2f36', selected: '#ffc61a' };

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
  /** Fill of each scar's node (scars not listed are white). */
  fills: Map<string, string>;
  /** Selected scar (drawn with a thick outline), or null. */
  selected: string | null;
}

/**
 * The Harris matrix as SVG: scars as boxes, later ones higher; lines join the
 * scars of each direct relation (red when in a cycle); dashed frames group the
 * sequences. Nodes carry `data-id` (the scar id).
 */
export function harrisSvg(layout: HarrisLayout, style: HarrisStyle): string {
  const pos = new Map(layout.nodes.map((n) => [n.id, n]));
  const parts: string[] = [];
  for (const b of layout.boxes)
    parts.push(
      `<g class="hm-box"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6" fill="none" stroke="${HARRIS_COLORS.box}" stroke-dasharray="4 3"/>` +
        `<text x="${b.x + 5}" y="${b.y + 12}" font-size="10" fill="${HARRIS_COLORS.box}">${esc(b.label)}</text></g>`,
    );
  for (const e of layout.edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    const down = b.y > a.y;
    const y1 = a.y + (down ? NODE_H / 2 : -NODE_H / 2);
    const y2 = b.y + (down ? -NODE_H / 2 : NODE_H / 2);
    parts.push(`<line class="hm-edge${e.cycle ? ' hm-cycle' : ''}" x1="${a.x}" y1="${y1}" x2="${b.x}" y2="${y2}" stroke="${e.cycle ? HARRIS_COLORS.cycle : HARRIS_COLORS.line}" stroke-width="${e.cycle ? 2 : 1.4}"/>`);
  }
  for (const n of layout.nodes) {
    const fill = style.fills.get(n.id) ?? HARRIS_COLORS.node;
    const sel = n.id === style.selected;
    parts.push(
      `<g class="hm-node" data-id="${esc(n.id)}"><rect x="${n.x - NODE_W / 2}" y="${n.y - NODE_H / 2}" width="${NODE_W}" height="${NODE_H}" rx="4" fill="${fill}" stroke="${sel ? HARRIS_COLORS.selected : HARRIS_COLORS.stroke}" stroke-width="${sel ? 3 : 1}"/>` +
        `<text x="${n.x}" y="${n.y + 4}" text-anchor="middle" font-size="12" fill="${textOn(fill)}">${esc(style.labels.get(n.id) ?? '')}</text></g>`,
    );
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" font-family="Helvetica, Arial, sans-serif">` +
    parts.join('') +
    '</svg>'
  );
}

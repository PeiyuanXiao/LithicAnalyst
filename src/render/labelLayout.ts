/**
 * Keeps the labels over the view from covering each other. Labels are placed
 * in order of priority — the selected one first, labels of things behind the
 * surface last — and each keeps its place when it is free; one that would
 * cover a label already placed moves outward, away from it, by up to about two
 * label heights; one that finds no free place is hidden.
 */

const offsets = new WeakMap<HTMLElement, [number, number]>();

/** Higher first. */
function priority(el: HTMLElement): number {
  let p = 0;
  if (el.classList.contains('is-selected')) p += 100;
  if (el.classList.contains('is-occluded')) p -= 50;
  if (el.classList.contains('measure-label')) p += 4;
  else if (el.classList.contains('landmark-label')) p += 3;
  else if (el.classList.contains('curve-label')) p += 1;
  else p += 2;
  return p;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const GAP = 2;
const hits = (a: Box, b: Box) => a.x0 < b.x1 + GAP && b.x0 < a.x1 + GAP && a.y0 < b.y1 + GAP && b.y0 < a.y1 + GAP;

export function declutterLabels(container: HTMLElement): void {
  const labels = [...container.querySelectorAll<HTMLElement>('.arrow-label')].filter((el) => el.offsetParent !== null && el.style.display !== 'none');
  // where each label would be without our offset
  const items = labels.map((el) => {
    const r = el.getBoundingClientRect();
    const [dx, dy] = offsets.get(el) ?? [0, 0];
    return { el, box: { x0: r.left - dx, y0: r.top - dy, x1: r.right - dx, y1: r.bottom - dy }, p: priority(el) };
  });
  items.sort((a, b) => b.p - a.p);
  const placed: Box[] = [];
  const at = (b: Box, dx: number, dy: number): Box => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });
  for (const it of items) {
    const b = it.box;
    let move: [number, number] | null = null;
    const blocker = placed.find((q) => hits(b, q));
    if (!blocker) move = [0, 0];
    else {
      // outward: away from the label in the way first, then the other directions
      const h = b.y1 - b.y0, w = b.x1 - b.x0;
      const ox = (b.x0 + b.x1) / 2 - (blocker.x0 + blocker.x1) / 2;
      const oy = (b.y0 + b.y1) / 2 - (blocker.y0 + blocker.y1) / 2;
      const len = Math.hypot(ox, oy) || 1;
      const dirs: Array<[number, number]> = [[ox / len, oy / len], [0, -1], [0, 1], [1, 0], [-1, 0], [0.7, -0.7], [-0.7, -0.7], [0.7, 0.7], [-0.7, 0.7]];
      search: for (const step of [0.6, 1.1, 1.7, 2.3]) {
        for (const [ux, uy] of dirs) {
          const dx = Math.round(ux * step * Math.max(h, w * 0.5)), dy = Math.round(uy * step * h);
          const c = at(b, dx, dy);
          if (!placed.some((q) => hits(c, q))) {
            move = [dx, dy];
            break search;
          }
        }
      }
    }
    const [dx, dy] = move ?? [0, 0];
    const prev = offsets.get(it.el) ?? [0, 0];
    if (prev[0] !== dx || prev[1] !== dy) {
      it.el.style.translate = dx || dy ? `${dx}px ${dy}px` : '';
      offsets.set(it.el, [dx, dy]);
    }
    it.el.classList.toggle('is-culled', !move);
    if (move) placed.push(at(b, dx, dy));
  }
}

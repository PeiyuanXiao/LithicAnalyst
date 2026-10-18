type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;
type Child = Node | string | number | null | undefined | false;

/** Tiny element builder: h('button', { class: 'btn', onclick: fn }, 'Label'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Inline SVG icon from a path list (24×24 viewBox, stroked). */
export function icon(paths: string, title?: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', title ? 'false' : 'true');
  svg.setAttribute('class', 'icon');
  if (title) {
    const t = document.createElementNS(ns, 'title');
    t.textContent = title;
    svg.appendChild(t);
  }
  for (const d of paths.split('|')) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

export const ICONS = {
  open: 'M3 7h6l2 2h10v10H3z|M3 7V5h6',
  save: 'M5 3h11l3 3v15H5z|M8 3v6h8V3|M8 21v-7h8v7',
  undo: 'M9 14L4 9l5-5|M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5|M20 9H9a5 5 0 0 0 0 10h3',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 1-1 1.7v.5|M12 17h.01',
  fit: 'M4 9V4h5|M20 9V4h-5|M4 15v5h5|M20 15v5h-5',
  trash: 'M4 7h16|M9 7V4h6v3|M6 7l1 13h10l1-13',
  target: 'M12 3v4|M12 17v4|M3 12h4|M17 12h4|M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  lang: 'M4 5h9|M8.5 3v2|M6 5c.5 3 2.5 6 6 8|M11 5c-.5 3-2.5 6-6 8|M13 20l4-9 4 9|M14.5 17h5',
  close: 'M6 6l12 12|M18 6L6 18',
  magnet: 'M5 4h5v7a2 2 0 0 0 4 0V4h5v7a7 7 0 0 1-14 0z|M5 8h5|M14 8h5',
  plus: 'M12 5v14|M5 12h14',
  up: 'M12 19V5|M6 11l6-6 6 6',
  down: 'M12 5v14|M6 13l6 6 6-6',
};

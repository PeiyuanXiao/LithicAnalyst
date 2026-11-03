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
  lock: 'M6 11h12v9H6z|M9 11V7a3 3 0 0 1 6 0v4',
  magnet: 'M5 4h5v7a2 2 0 0 0 4 0V4h5v7a7 7 0 0 1-14 0z|M5 8h5|M14 8h5',
  plus: 'M12 5v14|M5 12h14',
  up: 'M12 19V5|M6 11l6-6 6 6',
  down: 'M12 5v14|M6 13l6 6 6-6',
  file: 'M6 3h8l4 4v14H6z|M14 3v4h4',
  project: 'M6 3h8l4 4v14H6z|M14 3v4h4|M9 12h6|M9 16h6',
  cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z|M4 7.5l8 4.5 8-4.5|M12 12v9',
  chevron: 'M6 9l6 6 6-6',
  next: 'M9 6l6 6-6 6',
  swap: 'M8 20V4|M8 4L4 8|M8 4l4 4|M16 4v16|M16 20l-4-4|M16 20l4-4',
  sliders: 'M4 6h9|M17 6h3|M15 4v4|M4 12h3|M11 12h9|M9 10v4|M4 18h11|M19 18h1|M17 16v4',
  download: 'M12 4v11|M7 10l5 5 5-5|M5 19h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  rotateLeft: 'M4 4v5h5|M4.6 9A8 8 0 1 1 6 16.5',
  rotateRight: 'M20 4v5h-5|M19.4 9A8 8 0 1 0 18 16.5',
};

/** Inline SVG icon on the 20 × 20 grid from SVG markup (stroked; elements may carry their own fill). */
export function icon20(markup: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon20');
  svg.innerHTML = markup;
  return svg;
}

/** Icons of the view toolbar, the mode switch and the shell (20 × 20 grid). */
export const ICONS20 = {
  orient: '<rect x="5" y="3.5" width="10" height="13" rx="1.5"/><path d="M10 13.5 V6.5"/><path d="M7.5 9 L10 6.5 L12.5 9"/>',
  axis: '<circle cx="10" cy="16.5" r="2"/><path d="M10 14.5 V3.5"/><path d="M6.5 7 L10 3.5 L13.5 7"/><path d="M4 16.5 H6 M14 16.5 H16"/>',
  platformEnd: '<path d="M3 13.5 H17"/><circle cx="4.5" cy="13.5" r="2" fill="currentColor"/><circle cx="15.5" cy="13.5" r="2" fill="currentColor"/><path d="M10 13.5 V6"/>',
  select: '<path d="M5 3 L15 10.5 L10.2 11.4 L12.6 16.6 L10.8 17.4 L8.4 12.2 L5 15.2 Z"/>',
  arrow: '<circle cx="4.5" cy="15.5" r="2"/><path d="M6 14 L15.5 4.5"/><path d="M10 4.5 H15.5 V10"/>',
  curve: '<path d="M3 15 C6 4 11 17 17 5"/><rect x="1.8" y="13.8" width="2.4" height="2.4" fill="currentColor"/><rect x="15.8" y="3.8" width="2.4" height="2.4" fill="currentColor"/><rect x="8.8" y="8.8" width="2.4" height="2.4" fill="currentColor"/>',
  region: '<path d="M4 7 C4 3.5 9 2.5 12 4.5 C15.5 6.5 17.5 9 15.5 13 C13.5 17 7 17.5 5 14.5 C3.5 12 4 10 4 7 Z" fill="currentColor" fill-opacity="0.25"/>',
  relation: '<path d="M8 6.5 H3 V15.5 H12 V12.5"/><path d="M8 3.5 H17 V12.5 H8 Z" fill="currentColor" fill-opacity="0.3"/>',
  sequence: '<rect x="3" y="3" width="9" height="4" rx="1"/><rect x="5.5" y="8" width="9" height="4" rx="1"/><rect x="8" y="13" width="9" height="4" rx="1"/>',
  landmark: '<circle cx="10" cy="10" r="5.5"/><path d="M10 1.5 V5 M10 15 V18.5 M1.5 10 H5 M15 10 H18.5"/><circle cx="10" cy="10" r="1.2" fill="currentColor"/>',
  distance: '<path d="M5 15 L15 5"/><circle cx="4" cy="16" r="1.8" fill="currentColor"/><circle cx="16" cy="4" r="1.8" fill="currentColor"/><path d="M2.5 11 L9 4.5" stroke-width="1" stroke-dasharray="1.5 1.5"/>',
  geodesic: '<path d="M2.5 16.5 C6 16.5 7 7.5 10 7.5 C13 7.5 14 16.5 17.5 16.5"/><circle cx="2.5" cy="16.5" r="1.6" fill="currentColor"/><circle cx="17.5" cy="16.5" r="1.6" fill="currentColor"/>',
  angle: '<path d="M3 16 H17"/><path d="M3 16 L13 5"/><path d="M9 16 A6 6 0 0 0 7.04 11.56"/>',
  section: '<path d="M3 7 L13 4 L17 13 L7 16 Z"/><path d="M5.1 9.7 L13.5 7.2 M6.4 12.7 L14.9 10.2" stroke-width="1.1"/>',
  fit: '<path d="M3 7 V3 H7 M13 3 H17 V7 M17 13 V17 H13 M7 17 H3 V13"/>',
  display: '<path d="M3 6 H17 M3 14 H17"/><rect x="5.5" y="4" width="3" height="4" fill="currentColor"/><rect x="11.5" y="12" width="3" height="4" fill="currentColor"/>',
  plus: '<path d="M10 4 V16 M4 10 H16"/>',
  sun: '<circle cx="10" cy="10" r="3.5"/><path d="M10 2 V3.8 M10 16.2 V18 M2 10 H3.8 M16.2 10 H18 M4.3 4.3 L5.6 5.6 M14.4 14.4 L15.7 15.7 M4.3 15.7 L5.6 14.4 M14.4 5.6 L15.7 4.3"/>',
  moon: '<path d="M10 2.5 A5 5 0 0 0 17.5 10 A7.5 7.5 0 1 1 10 2.5 Z"/>',
  modeAnnotate: '<path d="M13 3.5 L16.5 7 L7.5 16 L3.5 16.5 L4 12.5 Z"/><path d="M11 5.5 L14.5 9"/><path d="M11.5 17 H17"/>',
  modeMeasure: '<path d="M2.5 13.5 L13.5 2.5 L17.5 6.5 L6.5 17.5 Z"/><path d="M5 11 L6.5 12.5 M7.5 8.5 L9.5 10.5 M10 6 L11.5 7.5"/>',
  modePresent: '<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M9 5.8 C11.3 7.2 11.8 10.5 10.4 13.2 C9.8 14.2 8.2 14.2 7.6 13.2 C6.2 10.5 6.7 7.2 9 5.8 Z" fill="currentColor" fill-opacity="0.25"/><path d="M13 14 H15.5"/>',
  modeCompare: '<circle cx="7.5" cy="10" r="5"/><circle cx="12.5" cy="10" r="5"/><path d="M10 5.67 A5 5 0 0 1 10 14.33 A5 5 0 0 1 10 5.67 Z" fill="currentColor" fill-opacity="0.3" stroke="none"/>',
};

/** Scroll a list box, and nothing around it, so that one of its rows is in view. */
export function revealInList(list: HTMLElement, row: HTMLElement): void {
  const l = list.getBoundingClientRect(), r = row.getBoundingClientRect();
  if (r.top < l.top) list.scrollTop -= l.top - r.top;
  else if (r.bottom > l.bottom) list.scrollTop += Math.min(r.bottom - l.bottom, r.top - l.top);
}

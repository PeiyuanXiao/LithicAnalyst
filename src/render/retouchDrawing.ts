import { pointAtArc } from '../compute/landmarks';
import type { StationSection } from '../compute/retouchAngle';
import { stretchOf, type LongestStretch, type RetouchStationDetail } from '../compute/retouchIndex';
import type { P2, PlanLoops, PlanShape } from '../compute/retouchPlan';
import { fmtNum } from '../core/format';
import type { Vec3 } from '../core/types';
import { scaleBarLength } from './figure';

/**
 * The two drawings of the retouch mode as lists of primitives: the panels turn them into SVG on the page, the exports into an SVG file
 * or onto a canvas. One drawing, whatever it ends up in; only the palette and the size differ. No DOM here.
 */

export interface Palette {
  /** Under everything (null: nothing, the panel shows through). */
  background: string | null;
  ink: string;
  ink2: string;
  /** The inside of the section. */
  sectionFill: string;
  /** The inside of the plan's outline. */
  planFill: string;
  accent: string;
  accentSoft: string;
  accentLine: string;
  series3: string;
  layers: string[];
  halo: string;
}

/** On the page: the shell's own colours, in both themes. */
export const SCREEN_PALETTE: Palette = {
  background: null,
  ink: 'var(--ink)',
  ink2: 'var(--ink-2)',
  sectionFill: 'color-mix(in srgb, var(--ink) 8%, transparent)',
  planFill: 'color-mix(in srgb, var(--ink) 6%, transparent)',
  accent: 'var(--accent)',
  accentSoft: 'var(--accent-soft)',
  accentLine: 'var(--accent-line)',
  series3: 'var(--series-3)',
  layers: ['var(--layer-1)', 'var(--layer-2)', 'var(--layer-3)', 'var(--layer-4)', 'var(--layer-5)'],
  halo: 'color-mix(in srgb, var(--accent) 35%, transparent)',
};

/** In a publication: the light colours, on white, whatever the theme. */
export const PRINT_PALETTE: Palette = {
  background: '#ffffff',
  ink: '#23211c',
  ink2: '#5b564a',
  sectionFill: '#ecebe8',
  planFill: '#f1f0ed',
  accent: '#e8a33a',
  accentSoft: '#f6dcae',
  accentLine: '#a8670f',
  series3: '#6250d6',
  layers: ['#6f1147', '#9a1c63', '#c0327f', '#d9559a', '#e77fb3'],
  halo: '#f6dcae',
};

export type Prim =
  | { kind: 'path'; rings: P2[][]; closed?: boolean; fill?: string; fillOpacity?: number; stroke?: string; width?: number; dash?: string; round?: boolean; hatch?: string; id?: string; data?: Record<string, string | number> }
  | { kind: 'circle'; x: number; y: number; r: number; fill?: string; stroke?: string; width?: number; id?: string; data?: Record<string, string | number> }
  | { kind: 'text'; x: number; y: number; text: string; size: number; fill: string; anchor?: 'start' | 'middle' | 'end'; id?: string };

/** A drawing and its size: pixels, and on paper when it is to scale. */
export interface Drawing {
  prims: Prim[];
  width: number;
  height: number;
  widthMm: number | null;
  heightMm: number | null;
}

const FONT = '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';

const num = (v: number): string => String(Math.round(v * 100) / 100);
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const dataAttrs = (d?: Record<string, string | number>): string => (d ? Object.entries(d).map(([k, v]) => ` data-${k}="${esc(String(v))}"`).join('') : '');
const idAttr = (id?: string): string => (id ? ` id="${esc(id)}"` : '');
const pathData = (rings: readonly P2[][], closed?: boolean): string => rings.map((r) => r.map((p, i) => `${i ? 'L' : 'M'}${num(p[0])} ${num(p[1])}`).join('') + (closed ? 'Z' : '')).join('');

/** The primitives as SVG elements; `prefix` keeps the hatches of two drawings on one page apart. */
export function primsMarkup(prims: readonly Prim[], prefix: string): string {
  const hatches = [...new Set(prims.flatMap((p) => (p.kind === 'path' && p.hatch ? [p.hatch] : [])))];
  const hatchId = (c: string) => `${prefix}-hatch-${hatches.indexOf(c)}`;
  const defs = hatches.length
    ? `<defs>${hatches.map((c) => `<pattern id="${hatchId(c)}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${esc(c)}" stroke-width="0.75"/></pattern>`).join('')}</defs>`
    : '';
  const out: string[] = [defs];
  for (const p of prims) {
    if (p.kind === 'path') {
      const d = pathData(p.rings, p.closed);
      const look = `${p.stroke ? ` stroke="${esc(p.stroke)}" stroke-width="${p.width ?? 1}"` : ''}${p.dash ? ` stroke-dasharray="${p.dash}"` : ''}${p.round ? ' stroke-linecap="round" stroke-linejoin="round"' : ''}`;
      const fill = `${p.fill ? ` fill="${esc(p.fill)}"` : ' fill="none"'}${p.fillOpacity !== undefined ? ` fill-opacity="${p.fillOpacity}"` : ''}${p.rings.length > 1 ? ' fill-rule="evenodd"' : ''}`;
      out.push(`<path${idAttr(p.id)}${dataAttrs(p.data)} d="${d}"${fill}${look}/>`);
      if (p.hatch) out.push(`<path d="${d}" fill="url(#${hatchId(p.hatch)})" stroke="none"/>`);
    } else if (p.kind === 'circle') {
      out.push(`<circle${idAttr(p.id)}${dataAttrs(p.data)} cx="${num(p.x)}" cy="${num(p.y)}" r="${p.r}" fill="${p.fill ? esc(p.fill) : 'none'}"${p.stroke ? ` stroke="${esc(p.stroke)}" stroke-width="${p.width ?? 1}"` : ''}/>`);
    } else {
      out.push(`<text${idAttr(p.id)} x="${num(p.x)}" y="${num(p.y)}" font-family="${esc(FONT)}" font-size="${p.size}" fill="${esc(p.fill)}" text-anchor="${p.anchor ?? 'start'}">${esc(p.text)}</text>`);
    }
  }
  return out.join('');
}

/** A whole SVG file: in millimetres when the drawing is to scale. */
export function svgFile(d: Drawing, prefix: string): string {
  const size = d.widthMm !== null && d.heightMm !== null ? `width="${num(d.widthMm)}mm" height="${num(d.heightMm)}mm"` : `width="${num(d.width)}" height="${num(d.height)}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" ${size} viewBox="0 0 ${num(d.width)} ${num(d.height)}">${primsMarkup(d.prims, prefix)}</svg>\n`;
}

/** The same primitives on a canvas, in the drawing's pixels (for when an SVG cannot be turned into an image). */
export function drawPrims(ctx: CanvasRenderingContext2D, prims: readonly Prim[]): void {
  const trace = (rings: readonly P2[][], closed?: boolean) => {
    ctx.beginPath();
    for (const r of rings) {
      r.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
      if (closed) ctx.closePath();
    }
  };
  for (const p of prims) {
    ctx.save();
    if (p.kind === 'path') {
      trace(p.rings, p.closed);
      if (p.fill) {
        ctx.fillStyle = p.fill;
        ctx.globalAlpha = p.fillOpacity ?? 1;
        ctx.fill(p.rings.length > 1 ? 'evenodd' : 'nonzero');
        ctx.globalAlpha = 1;
      }
      if (p.hatch) {
        ctx.save();
        ctx.clip();
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const r of p.rings) for (const q of r) {
          x0 = Math.min(x0, q[0]);
          x1 = Math.max(x1, q[0]);
          y0 = Math.min(y0, q[1]);
          y1 = Math.max(y1, q[1]);
        }
        ctx.strokeStyle = p.hatch;
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        const step = 6 * Math.SQRT2, span = x1 - x0 + (y1 - y0);
        for (let c = 0; c <= span; c += step) {
          ctx.moveTo(x0 + c, y0);
          ctx.lineTo(x0 + c - (y1 - y0), y1);
        }
        ctx.stroke();
        ctx.restore();
        trace(p.rings, p.closed);
      }
      if (p.stroke) {
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.width ?? 1;
        ctx.setLineDash(p.dash ? p.dash.split(' ').map(Number) : []);
        if (p.round) {
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
        }
        ctx.stroke();
      }
    } else if (p.kind === 'circle') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 2 * Math.PI);
      if (p.fill) {
        ctx.fillStyle = p.fill;
        ctx.fill();
      }
      if (p.stroke) {
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.width ?? 1;
        ctx.stroke();
      }
    } else {
      ctx.font = `${p.size}px ${FONT}`;
      ctx.fillStyle = p.fill;
      ctx.textAlign = p.anchor === 'middle' ? 'center' : p.anchor === 'end' ? 'right' : 'left';
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }
}

/** Pixels per millimetre of paper in an SVG file. */
export const PX_PER_MM = 96 / 25.4;

interface Box {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

const boxOf = (points: readonly P2[]): Box => {
  const b: Box = { u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity };
  for (const p of points) {
    b.u0 = Math.min(b.u0, p[0]);
    b.u1 = Math.max(b.u1, p[0]);
    b.v0 = Math.min(b.v0, p[1]);
    b.v1 = Math.max(b.v1, p[1]);
  }
  return b;
};

/** Where a label sits: of eight places round a point, the one furthest from the lines drawn and the labels placed. */
function placeLabel(text: string, at: P2, size: number, lines: readonly P2[][], taken: readonly P2[], w: number, h: number, reach = 10): P2 {
  const dirs: P2[] = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]];
  const half = (text.length * size * 0.3) + 2;
  let best = at, score = -Infinity;
  for (const d of dirs) {
    const c: P2 = [at[0] + d[0] * (reach + half * Math.abs(d[0])), at[1] + d[1] * reach];
    let near = Infinity;
    for (const line of lines) {
      for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i], b = line[i + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const l2 = dx * dx + dy * dy;
        const s = l2 > 0 ? Math.max(0, Math.min(1, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / l2)) : 0;
        near = Math.min(near, Math.hypot(c[0] - a[0] - s * dx, c[1] - a[1] - s * dy));
      }
    }
    for (const t of taken) near = Math.min(near, Math.hypot(c[0] - t[0], c[1] - t[1]) - half);
    const inside = c[0] - half > 0 && c[0] + half < w && c[1] - size > 0 && c[1] + size < h;
    if ((inside ? near : near - 1000) > score) {
      score = inside ? near : near - 1000;
      best = c;
    }
  }
  return best;
}

/** A scale bar at the lower left, in the drawing's pixels. */
function scaleBar(prims: Prim[], unit: string, scale: number, width: number, height: number, ink: string, id: string): void {
  const room = (0.5 * width) / scale;
  const len = scaleBarLength(room).length;
  if (!(len > 0)) return;
  const x = 12, y = height - 12;
  prims.push({ kind: 'path', rings: [[[x, y], [x + len * scale, y]]], stroke: ink, width: 2, id });
  prims.push({ kind: 'text', x, y: y - 5, text: `${fmtNum(len, len < 1 ? 2 : 0)} ${unit}`, size: 11, fill: ink, id: `${id}-text` });
}

// ---------------------------------------------------------------- the section

/** A station's section on the page's plane: u to the right, away from the edge; v up, toward the dorsal side; A at the origin. */
export interface SectionModel {
  section: { points: P2[]; closed: boolean };
  /** The retouch layers along the section, and their ends. */
  runs: Array<{ layer: number; points: P2[]; ends: boolean }>;
  /** Fitted stretches (dorsal first where told), with their length along the section. */
  fits: Array<{ points: P2[]; length: number; face: 'dorsal' | 'ventral' | 'side' }>;
  /** From the far end of each fitted stretch to where the lines meet. */
  lines: Array<[P2, P2]>;
  missing: P2[] | null;
  A0: P2 | null;
  R: P2[];
  C: P2 | null;
  t: [P2, P2] | null;
  T: [P2, P2] | null;
  overlay: { layer: number; Pk: P2; Q: P2 | null } | null;
  /** What the drawing frames by default. */
  box: Box;
  /** The whole section. */
  wholeBox: Box;
}

export interface SectionFaces {
  dorsal: number;
  extents: [number, number];
  depths: [number, number];
}

/** A station's section laid out for drawing. `layer`: a retouch layer shown on it, with its points. */
export function sectionModel(sec: StationSection, detail: RetouchStationDetail | null, faces: SectionFaces, layer: number | null = null): SectionModel {
  const { A, normal: n } = sec;
  const d = faces.dorsal < 0 ? 0 : faces.dorsal;
  const dorsalWay = sec.ways[d], ventralWay = sec.ways[1 - d];
  const surface = detail?.surface ?? null;
  const within = (v: Vec3): Vec3 => {
    const s = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
    return [v[0] - s * n[0], v[1] - s * n[1], v[2] - s * n[2]];
  };
  const unit = (v: Vec3): Vec3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // across: along the ventral line, away from the edge; else from A to the furthest point of the section
  let u: Vec3;
  if (surface) {
    const fit = surface.fits[1 - d];
    const far = pointAtArc(ventralWay.points, false, ventralWay.cum, fit.to);
    const near = pointAtArc(ventralWay.points, false, ventralWay.cum, fit.from);
    u = unit(within(dot(minus(far, near), fit.line.dir) < 0 ? [-fit.line.dir[0], -fit.line.dir[1], -fit.line.dir[2]] : fit.line.dir));
  } else {
    let far = A, best = -1;
    for (const w of sec.ways)
      for (const p of w.points) {
        const q = Math.hypot(p[0] - A[0], p[1] - A[1], p[2] - A[2]);
        if (q > best) {
          best = q;
          far = p;
        }
      }
    u = unit(within(minus(far, A)));
  }
  const raw: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  // up: toward the dorsal side
  const probe = pointAtArc(dorsalWay.points, false, dorsalWay.cum, Math.min(dorsalWay.length / 2, Math.max(faces.extents[d] / 2, faces.depths[d])));
  const v: Vec3 = dot(minus(probe, A), raw) >= 0 ? raw : [-raw[0], -raw[1], -raw[2]];
  const flat = (p: Vec3): P2 => {
    const q = minus(p, A);
    return [dot(q, u), dot(q, v)];
  };

  const points = sec.closed ? sec.ways[0].points.map(flat) : [...sec.ways[1].points.slice(1).reverse().map(flat), ...sec.ways[0].points.map(flat)];
  const runs: SectionModel['runs'] = [];
  sec.ways.forEach((way, i) => {
    sec.runs[i].forEach((r, j) => runs.push({ layer: r.layer, points: stretchOf(way, r.from, r.to).map(flat), ends: j < sec.runs[i].length - 1 }));
  });
  const R = sec.ways.flatMap((way, i) => (sec.runs[i].length ? [flat(pointAtArc(way.points, false, way.cum, faces.depths[i]))] : []));
  const fits: SectionModel['fits'] = [];
  const lines: SectionModel['lines'] = [];
  let missing: P2[] | null = null;
  let A0: P2 | null = null;
  if (surface) {
    A0 = flat(surface.A0);
    for (const i of [d, 1 - d]) {
      const f = surface.fits[i], way = sec.ways[i];
      fits.push({ points: stretchOf(way, f.from, f.to).map(flat), length: f.to - f.from, face: faces.dorsal < 0 ? 'side' : i === d ? 'dorsal' : 'ventral' });
      const end = pointAtArc(way.points, false, way.cum, f.to);
      const s = dot(minus(end, f.line.point), f.line.dir);
      lines.push([flat([f.line.point[0] + s * f.line.dir[0], f.line.point[1] + s * f.line.dir[1], f.line.point[2] + s * f.line.dir[2]]), A0]);
    }
    const one = surface.fits[0], two = surface.fits[1];
    missing = [A0, ...stretchOf(sec.ways[0], 0, one.from).reverse().map(flat), ...stretchOf(sec.ways[1], 0, two.from).slice(1).map(flat)];
  }
  // the point of the thickness; without GIUR, where the ridge ended the dorsal fit
  let C: P2 | null = detail?.C ? flat(detail.C) : null;
  if (!C && surface && faces.dorsal >= 0 && surface.fits[d].atRidge) C = flat(pointAtArc(dorsalWay.points, false, dorsalWay.cum, surface.fits[d].to));
  const foot = (p: Vec3, line: { point: Vec3; dir: Vec3 }): P2 => {
    const s = dot(minus(p, line.point), line.dir);
    return flat([line.point[0] + s * line.dir[0], line.point[1] + s * line.dir[1], line.point[2] + s * line.dir[2]]);
  };
  let t: [P2, P2] | null = null, T: [P2, P2] | null = null;
  if (detail?.reference && detail.H && detail.C) {
    t = [flat(detail.H), foot(detail.H, detail.reference)];
    T = [flat(detail.C), foot(detail.C, detail.reference)];
  }
  // a layer shown: where it ends, and as far along the other side
  let overlay: SectionModel['overlay'] = null;
  if (layer !== null) {
    for (let i = 0; i < 2 && !overlay; i++) {
      const r = sec.runs[i].find((x) => x.layer === layer);
      if (!r) continue;
      const other = sec.ways[1 - i];
      overlay = { layer, Pk: flat(pointAtArc(sec.ways[i].points, false, sec.ways[i].cum, r.to)), Q: r.to <= other.length ? flat(pointAtArc(other.points, false, other.cum, r.to)) : null };
    }
  }
  const framed: P2[] = [[0, 0], ...R];
  if (A0) framed.push(A0);
  for (const f of fits) framed.push(...f.points);
  if (C) framed.push(C);
  for (const seg of [t, T]) if (seg) framed.push(...seg);
  const wholeBox = boxOf(points);
  return { section: { points, closed: sec.closed }, runs, fits, lines, missing, A0, R, C, t, T, overlay, box: fits.length ? boxOf(framed) : wholeBox, wholeBox };
}

export interface SectionOptions {
  palette: Palette;
  whole: boolean;
  /** The narrowest the framing goes, in the coordinate unit. */
  minWidth: number;
  /** For the scale bar; null: none. */
  unit: string | null;
  /** The size of the drawing; or, to scale, pixels per coordinate unit and the size follows. */
  width: number;
  height: number;
  pxPerUnit?: number;
}

const FRAME_MARGIN = 0.15;
/** Room kept under a drawing for its scale bar, and over one to scale for its letters (pixels). */
const BAR_ROOM = 28;
const LETTER_ROOM = 14;

/** The section as primitives. */
export function sectionDrawing(m: SectionModel, o: SectionOptions): Drawing {
  const c = o.palette;
  const b = o.whole ? m.wholeBox : m.box;
  let u0 = b.u0, u1 = b.u1;
  if (!o.whole && u1 - u0 < o.minWidth) {
    const mid = (u0 + u1) / 2;
    u0 = mid - o.minWidth / 2;
    u1 = mid + o.minWidth / 2;
  }
  const spanU = Math.max(u1 - u0, 1e-9) * (1 + 2 * FRAME_MARGIN), spanV = Math.max(b.v1 - b.v0, 1e-9) * (1 + 2 * FRAME_MARGIN);
  const below = o.unit !== null ? BAR_ROOM : 0, above = o.pxPerUnit ? LETTER_ROOM : 0;
  const width = o.pxPerUnit ? spanU * o.pxPerUnit : o.width;
  const height = o.pxPerUnit ? spanV * o.pxPerUnit + below + above : o.height;
  const scale = o.pxPerUnit ?? Math.min(width / spanU, (height - below - above) / spanV);
  const cu = (u0 + u1) / 2, cv = (b.v0 + b.v1) / 2;
  const middle = above + (height - below - above) / 2;
  const page = (p: P2): P2 => [width / 2 + (p[0] - cu) * scale, middle - (p[1] - cv) * scale];
  const pages = (ps: readonly P2[]): P2[] => ps.map(page);
  const prims: Prim[] = [];
  if (c.background) prims.push({ kind: 'path', rings: [[[0, 0], [width, 0], [width, height], [0, height]]], closed: true, fill: c.background });
  const outline = pages(m.section.points);
  // what lies above and below the outline is what is drawn over it
  prims.push({ kind: 'path', rings: [outline], closed: m.section.closed, fill: c.sectionFill, id: 'retouch-section-fill' });
  if (m.missing) prims.push({ kind: 'path', rings: [pages(m.missing)], closed: true, fill: c.accentSoft, hatch: c.accentLine, id: 'retouch-section-missing' });
  prims.push({ kind: 'path', rings: [outline], closed: m.section.closed, stroke: c.ink, width: 1.25, id: 'retouch-section-outline' });
  m.runs.forEach((r, i) => {
    const pts = pages(r.points);
    const color = c.layers[Math.min(r.layer, c.layers.length) - 1];
    prims.push({ kind: 'path', rings: [pts], stroke: color, width: 2.5, round: true, id: `retouch-section-run-${i}`, data: { layer: r.layer } });
    if (r.ends && pts.length > 1) {
      const a = pts[pts.length - 2], e = pts[pts.length - 1];
      const l = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
      const nx = -(e[1] - a[1]) / l, ny = (e[0] - a[0]) / l;
      prims.push({ kind: 'path', rings: [[[e[0] - 4 * nx, e[1] - 4 * ny], [e[0] + 4 * nx, e[1] + 4 * ny]]], stroke: color, width: 1.25 });
    }
  });
  m.lines.forEach((l, i) => prims.push({ kind: 'path', rings: [pages(l)], stroke: c.ink, width: 1, dash: '4 3', id: `retouch-section-line-${i}` }));
  m.fits.forEach((f, i) => prims.push({ kind: 'path', rings: [pages(f.points)], stroke: c.accent, width: 3, round: true, id: `retouch-section-fit-${i}`, data: { length: Math.round(f.length * 1000) / 1000, face: f.face } }));
  const tick = (a: P2, e: P2, id: string): void => {
    const [p, q] = [page(a), page(e)];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const nx = -(q[1] - p[1]) / l, ny = (q[0] - p[0]) / l;
    prims.push({ kind: 'path', rings: [[p, q], [[p[0] - 3 * nx, p[1] - 3 * ny], [p[0] + 3 * nx, p[1] + 3 * ny]], [[q[0] - 3 * nx, q[1] - 3 * ny], [q[0] + 3 * nx, q[1] + 3 * ny]]], stroke: c.series3, width: 1, id });
  };
  if (m.t) tick(m.t[0], m.t[1], 'retouch-section-t');
  if (m.T) tick(m.T[0], m.T[1], 'retouch-section-T');
  if (m.overlay) {
    const color = c.layers[Math.min(m.overlay.layer, c.layers.length) - 1];
    const a = page([0, 0]);
    const reach = (q: P2, id: string) => {
      const p = page(q);
      prims.push({ kind: 'path', rings: [[a, p]], stroke: color, width: 1 });
      prims.push({ kind: 'circle', x: p[0], y: p[1], r: 2.5, fill: color, id });
    };
    reach(m.overlay.Pk, 'retouch-section-pk');
    if (m.overlay.Q) reach(m.overlay.Q, 'retouch-section-q');
  }
  const dot = (p: P2, id: string) => {
    const q = page(p);
    prims.push({ kind: 'circle', x: q[0], y: q[1], r: 2.5, fill: c.ink, id });
  };
  dot([0, 0], 'retouch-section-a');
  m.R.forEach((p, i) => dot(p, `retouch-section-r-${i}`));
  if (m.C) dot(m.C, 'retouch-section-c');
  if (m.A0) {
    const q = page(m.A0);
    prims.push({ kind: 'circle', x: q[0], y: q[1], r: 3.5, fill: o.palette.background ?? 'none', stroke: c.ink, width: 1.25, id: 'retouch-section-a0' });
  }
  // the letters, where they cover no line
  const lines: P2[][] = [outline, ...m.lines.map(pages), ...m.fits.map((f) => pages(f.points)), ...(m.t ? [pages(m.t)] : []), ...(m.T ? [pages(m.T)] : [])];
  const taken: P2[] = [];
  const letter = (text: string, at: P2) => {
    const p = placeLabel(text, page(at), 11, lines, taken, width, height);
    taken.push(p);
    prims.push({ kind: 'text', x: p[0], y: p[1] + 4, text, size: 11, fill: c.ink, anchor: 'middle', id: `retouch-section-label-${text}` });
  };
  const mid = (s: readonly P2[]): P2 => s[Math.floor(s.length / 2)];
  letter('A', [0, 0]);
  if (m.A0) letter('A₀', m.A0);
  if (m.R.length) letter('R', m.R[0]);
  if (m.C) letter('C', m.C);
  if (m.t) letter('t', [(m.t[0][0] + m.t[1][0]) / 2, (m.t[0][1] + m.t[1][1]) / 2]);
  if (m.T) letter('T', [(m.T[0][0] + m.T[1][0]) / 2, (m.T[0][1] + m.T[1][1]) / 2]);
  if (m.fits[0]) letter('w', mid(m.fits[0].points));
  if (o.unit !== null) scaleBar(prims, o.unit, scale, width, height, c.ink, 'retouch-section-scale');
  return { prims, width, height, widthMm: o.pxPerUnit ? width / PX_PER_MM : null, heightMm: o.pxPerUnit ? height / PX_PER_MM : null };
}

// ---------------------------------------------------------------- the plan

/** A working edge on the plan. */
export interface PlanEdge {
  label: string;
  /** Its stations' points, in order along it. */
  points: P2[];
}

export interface PlanOptions {
  shape: PlanShape;
  loops: readonly PlanLoops[];
  face: 'dorsal' | 'ventral';
  /** The current station, on the plan. */
  station: { at: P2; index: number } | null;
  longest: LongestStretch | null;
  /** A working edge picked (null: none): drawn heavier along the outline, its own chord standing for `longest`. */
  edge?: PlanEdge | null;
  /** A segment (1–16) marked. */
  highlight: number | null;
  /** Which frame it is. */
  tag: string;
  palette: Palette;
  unit: string | null;
  width: number;
  height: number;
  pxPerUnit?: number;
}

const PLAN_MARGIN = 0.08;

/** The plan as primitives, the proximal end down and X to the right, on either face. `toPlan`: from the drawing's pixels back to the plan. */
export function planDrawing(o: PlanOptions): Drawing & { toPlan: (x: number, y: number) => P2; toPage: (p: P2) => P2 } {
  const c = o.palette;
  const b = boxOf(o.shape.outline);
  const spanX = Math.max(b.u1 - b.u0, 1e-9) * (1 + 2 * PLAN_MARGIN), spanY = Math.max(b.v1 - b.v0, 1e-9) * (1 + 2 * PLAN_MARGIN);
  const below = o.unit !== null ? BAR_ROOM : 0;
  const width = o.pxPerUnit ? spanX * o.pxPerUnit : o.width;
  const height = o.pxPerUnit ? spanY * o.pxPerUnit + below : o.height;
  const scale = o.pxPerUnit ?? Math.min(width / spanX, (height - below) / spanY);
  const cx = (b.u0 + b.u1) / 2, cy = (b.v0 + b.v1) / 2;
  const middle = (height - below) / 2;
  const page = (p: P2): P2 => [width / 2 + (p[0] - cx) * scale, middle - (p[1] - cy) * scale];
  const pages = (ps: readonly P2[]): P2[] => ps.map(page);
  const prims: Prim[] = [];
  if (c.background) prims.push({ kind: 'path', rings: [[[0, 0], [width, 0], [width, height], [0, height]]], closed: true, fill: c.background });
  const outline = pages(o.shape.outline);
  prims.push({ kind: 'path', rings: [outline], closed: true, fill: c.planFill, id: 'retouch-plan-fill' });
  const faceBase = o.face === 'ventral' ? 8 : 0;
  if (o.highlight !== null && o.highlight > faceBase && o.highlight <= faceBase + 8) {
    const s = o.shape.segments.find((x) => x.segment === o.highlight! - faceBase);
    if (s) prims.push({ kind: 'path', rings: [pages(s.polygon)], closed: true, fill: c.accentSoft, stroke: c.accentLine, width: 1, id: 'retouch-plan-highlight', data: { segment: o.highlight } });
  }
  for (const l of o.loops) {
    if (l.face !== o.face) continue;
    prims.push({ kind: 'path', rings: l.loops.map(pages), closed: true, fill: c.layers[Math.min(l.layer, c.layers.length) - 1], fillOpacity: 0.45, id: `retouch-plan-layer-${l.layer}` });
  }
  for (const [i, r] of o.shape.rows.entries()) prims.push({ kind: 'path', rings: [pages(r)], stroke: c.ink2, width: 0.75, id: `retouch-plan-row-${i + 1}` });
  prims.push({ kind: 'path', rings: [pages(o.shape.mid)], stroke: c.ink2, width: 0.75, id: 'retouch-plan-mid' });
  prims.push({ kind: 'path', rings: o.shape.bounds.map(pages), closed: true, stroke: c.accent, width: 1, dash: '4 3', id: 'retouch-plan-bounds' });
  prims.push({ kind: 'path', rings: [outline], closed: true, stroke: c.ink, width: 1.25, id: 'retouch-plan-outline' });
  for (const s of o.shape.segments) {
    const q = page(s.at);
    prims.push({ kind: 'text', x: q[0], y: q[1] + 4, text: String(s.segment + faceBase), size: 11, fill: c.ink2, anchor: 'middle', id: `retouch-plan-seg-${s.segment + faceBase}` });
  }
  if (o.edge && o.edge.points.length > 1) prims.push({ kind: 'path', rings: [pages(o.edge.points)], stroke: c.accent, width: 3.5, id: 'retouch-plan-edge', data: { edge: o.edge.label } });
  if (o.longest) {
    const a = page(o.longest.a), e = page(o.longest.b), f = page(o.longest.far), g = page(o.longest.foot);
    prims.push({ kind: 'path', rings: [[a, e]], stroke: c.series3, width: 1.25, id: 'retouch-plan-chord' });
    prims.push({ kind: 'path', rings: [[f, g]], stroke: c.series3, width: 1.25, dash: '4 3', id: 'retouch-plan-depth' });
    prims.push({ kind: 'text', x: (a[0] + e[0]) / 2 + 6, y: (a[1] + e[1]) / 2 - 6, text: 'R3', size: 11, fill: c.series3, id: 'retouch-plan-r3' });
    prims.push({ kind: 'text', x: (f[0] + g[0]) / 2 + 6, y: (f[1] + g[1]) / 2 + 4, text: 'R6', size: 11, fill: c.series3, id: 'retouch-plan-r6' });
  }
  if (o.station) {
    const q = page(o.station.at);
    prims.push({ kind: 'circle', x: q[0], y: q[1], r: 8, fill: c.halo });
    prims.push({ kind: 'circle', x: q[0], y: q[1], r: 4, fill: c.accent, stroke: c.ink, width: 0.75, id: 'retouch-plan-station', data: { station: o.station.index } });
  }
  prims.push({ kind: 'text', x: 8, y: 16, text: o.tag, size: 11, fill: c.ink2, id: 'retouch-plan-tag' });
  if (o.unit !== null) scaleBar(prims, o.unit, scale, width, height, c.ink, 'retouch-plan-scale');
  return {
    prims,
    width,
    height,
    widthMm: o.pxPerUnit ? width / PX_PER_MM : null,
    heightMm: o.pxPerUnit ? height / PX_PER_MM : null,
    toPlan: (x, y) => [cx + (x - width / 2) / scale, cy - (y - middle) / scale],
    toPage: page,
  };
}

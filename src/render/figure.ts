import * as THREE from 'three';
import { simplifyLoop, traceOutlines } from '../compute/contour';
import { frameAxes } from '../core/frame';
import type { Vec3 } from '../core/types';
import { pngWithDpi } from '../io/png';
import type { LightRig, LightSettings } from './lighting';

/**
 * Figures for publication: standard orthographic views of the specimen in its
 * frame, laid out by the European convention (ISO first-angle projection),
 * at a stated physical scale. The model's shading is rendered off screen; the
 * overlays (arrows, curves, plane sections), the outline and the scale bar are
 * drawn as vectors, leaving out what the model hides.
 */

export type FigureView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
export const FIGURE_VIEWS: FigureView[] = ['front', 'back', 'left', 'right', 'top', 'bottom'];

export interface FigureSettings {
  views: FigureView[];
  /** Height of the raking light above the page (degrees); it comes from the upper left. */
  lightElevation: number;
  overlays: { arrows: boolean; curves: boolean; planes: boolean; scaleBar: boolean };
  /** Paper size / real size. */
  scale: number;
  dpi: number;
}

export const DEFAULT_FIGURE: FigureSettings = {
  views: ['front', 'left'],
  lightElevation: 35,
  overlays: { arrows: true, curves: true, planes: false, scaleBar: true },
  scale: 1,
  dpi: 600,
};

export interface FigureOverlays {
  arrows: Array<{ start: Vec3; end: Vec3; startNormal: Vec3; endNormal: Vec3; color: string }>;
  curves: Array<{ points: Vec3[]; closed: boolean; color: string }>;
  planes: Array<{ lines: Array<{ points: Vec3[]; closed: boolean }>; color: string }>;
}

export interface FigureContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /** Hidden while rendering (annotations are drawn as vectors instead). */
  overlay: THREE.Object3D;
  mesh: THREE.Mesh;
  lights: LightRig;
  /** Mesh vertices relative to `offset` (original = local + offset). */
  positions: ArrayLike<number>;
  offset: Vec3;
  diagonal: number;
}

export class FigureError extends Error {
  constructor(readonly code: 'tooLarge' | 'noViews', message: string) {
    super(message);
  }
}

/** Millimetres per unit; null when the unit is not stated. */
export function mmPerUnit(unit: string): number | null {
  return ({ mm: 1, cm: 10, m: 1000, in: 25.4 } as Record<string, number>)[unit] ?? null;
}

type Axis = 'x' | 'y' | 'z';
interface ViewDef {
  /** Direction toward the camera, right and up on the page, as signed specimen axes. */
  toward: [Axis, number];
  right: [Axis, number];
  up: [Axis, number];
  /** Cell in the first-angle layout (front at column 1, row 1). */
  col: number;
  row: number;
}

/** First-angle projection: the view from the left goes to the right of the front view, the view from above below it, the back at the far right. */
const VIEWS: Record<FigureView, ViewDef> = {
  front: { toward: ['z', 1], right: ['x', 1], up: ['y', 1], col: 1, row: 1 },
  left: { toward: ['x', -1], right: ['z', 1], up: ['y', 1], col: 2, row: 1 },
  right: { toward: ['x', 1], right: ['z', -1], up: ['y', 1], col: 0, row: 1 },
  back: { toward: ['z', -1], right: ['x', -1], up: ['y', 1], col: 3, row: 1 },
  top: { toward: ['y', 1], right: ['x', 1], up: ['z', -1], col: 1, row: 2 },
  bottom: { toward: ['y', -1], right: ['x', 1], up: ['z', 1], col: 1, row: 0 },
};

export interface FigureLayoutView {
  view: FigureView;
  /** Position and size on the figure, pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FigureLayout {
  width: number;
  height: number;
  pxPerUnit: number;
  /** Null when the unit is not stated (no physical size). */
  mmPerPx: number | null;
  views: FigureLayoutView[];
  scaleBar: { x0: number; x1: number; y: number; length: number; unit: string } | null;
}

export interface Figure {
  layout: FigureLayout;
  png: () => Promise<Uint8Array>;
  svg: () => Promise<string>;
}

interface RenderedView extends FigureLayoutView {
  image: ImageData;
  outline: Array<Array<[number, number]>>;
  arrows: Array<{ runs: Array<Array<[number, number]>>; head: [number, number, number, number] | null; color: string }>;
  lines: Array<{ runs: Array<Array<[number, number]>>; color: string; kind: 'curve' | 'plane' }>;
}

const vadd = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
const vdot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A round scale-bar length, about a third of `span`, and its divisions. */
export function scaleBarLength(span: number): { length: number; step: number } {
  const target = span / 3;
  const k = Math.floor(Math.log10(target));
  const base = 10 ** k;
  const d = [5, 2, 1].find((m) => m * base <= target) ?? 1;
  const length = d * base;
  return { length, step: d === 1 ? base / 5 : base };
}

/** The figure's size and layout without rendering it (for showing the size before exporting). */
export function figureLayout(ctx: FigureContext, frame: number[], unit: string, settings: FigureSettings): FigureLayout {
  return planFigure(ctx, frame, unit, settings).layout;
}

/**
 * Lay out and render the figure. `frame`: the specimen frame matrix; `unit`:
 * the specimen unit (no physical scale when it is not stated).
 */
export function renderFigure(ctx: FigureContext, frame: number[], unit: string, settings: FigureSettings, overlays: FigureOverlays): Figure {
  const plan = planFigure(ctx, frame, unit, settings);
  const { layout, size, axes, axis, lo, hi, pxPerUnit, mm, mmToPx } = plan;
  const max = ctx.renderer.capabilities.maxTextureSize;
  for (const v of layout.views) {
    const s = size(v.view);
    if (s.w > max || s.h > max) throw new FigureError('tooLarge', `A view would be ${s.w} × ${s.h} pixels; the limit here is ${max}.`);
  }
  if (layout.width > 16384 || layout.height > 16384) throw new FigureError('tooLarge', `The figure would be ${layout.width} × ${layout.height} pixels.`);
  const layoutViews = layout.views;
  return drawFigure(ctx, settings, overlays, { layout, layoutViews, size, axes, axis, lo, hi, pxPerUnit, mm, mmToPx });
}

function planFigure(ctx: FigureContext, frame: number[], unit: string, settings: FigureSettings) {
  const views = FIGURE_VIEWS.filter((v) => settings.views.includes(v));
  if (!views.length) throw new FigureError('noViews', 'No view chosen.');
  const axes = frameAxes(frame);
  const axis = ([a, s]: [Axis, number]): Vec3 => [axes[a][0] * s, axes[a][1] * s, axes[a][2] * s];

  // the model's extent along each specimen axis (original coordinates)
  const lo = { x: Infinity, y: Infinity, z: Infinity };
  const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  const p = ctx.positions;
  for (let i = 0; i + 2 < p.length; i += 3) {
    const q: Vec3 = [p[i] + ctx.offset[0], p[i + 1] + ctx.offset[1], p[i + 2] + ctx.offset[2]];
    for (const a of ['x', 'y', 'z'] as Axis[]) {
      const d = vdot(q, axes[a]);
      if (d < lo[a]) lo[a] = d;
      if (d > hi[a]) hi[a] = d;
    }
  }
  const range = (a: [Axis, number]): [number, number] => (a[1] > 0 ? [lo[a[0]], hi[a[0]]] : [-hi[a[0]], -lo[a[0]]]);

  const mm = mmPerUnit(unit);
  const pxPerMm = settings.dpi / 25.4;
  const pxPerUnit = mm ? mm * settings.scale * pxPerMm : 1500 / Math.max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z, 1e-9);
  const mmToPx = (v: number) => (mm ? v * pxPerMm : (v * 1500) / 100);
  const gap = Math.round(mmToPx(6));
  const margin = Math.round(mmToPx(3));

  // column widths and row heights from the views that are shown
  const colW = [0, 0, 0, 0];
  const rowH = [0, 0, 0];
  const size = (v: FigureView) => {
    const d = VIEWS[v];
    const [h0, h1] = range(d.right);
    const [v0, v1] = range(d.up);
    return { w: Math.max(1, Math.ceil((h1 - h0) * pxPerUnit)), h: Math.max(1, Math.ceil((v1 - v0) * pxPerUnit)), h0, v1 };
  };
  for (const v of views) {
    const s = size(v);
    colW[VIEWS[v].col] = Math.max(colW[VIEWS[v].col], s.w);
    rowH[VIEWS[v].row] = Math.max(rowH[VIEWS[v].row], s.h);
  }
  const colX: number[] = [];
  let x = margin;
  for (let c = 0; c < 4; c++) {
    colX[c] = x;
    if (colW[c]) x += colW[c] + gap;
  }
  const rowY: number[] = [];
  let y = margin;
  for (let r = 0; r < 3; r++) {
    rowY[r] = y;
    if (rowH[r]) y += rowH[r] + gap;
  }
  const bar = settings.overlays.scaleBar && mm ? scaleBarLength((hi.x - lo.x) || 1) : null;
  const barSpace = bar ? Math.round(mmToPx(9)) : 0;
  const width = x - gap + margin;
  const height = y - gap + barSpace + margin;

  const layoutViews: FigureLayoutView[] = views.map((v) => {
    const d = VIEWS[v];
    const s = size(v);
    // centre each view in its cell (cells of a row share its height, of a column its width)
    return { view: v, x: colX[d.col] + Math.floor((colW[d.col] - s.w) / 2), y: rowY[d.row] + Math.floor((rowH[d.row] - s.h) / 2), width: s.w, height: s.h };
  });
  const barLayout = bar
    ? (() => {
        const x0 = layoutViews[0].x;
        const yb = height - margin - Math.round(mmToPx(3));
        return { x0, x1: x0 + bar.length * pxPerUnit, y: yb, length: bar.length, unit };
      })()
    : null;
  const layout: FigureLayout = { width, height, pxPerUnit, mmPerPx: mm ? 1 / pxPerMm : null, views: layoutViews, scaleBar: barLayout };
  return { layout, size, axes, axis, lo, hi, pxPerUnit, mm, mmToPx };
}

type Plan = ReturnType<typeof planFigure> & { layoutViews: FigureLayoutView[] };

function drawFigure(ctx: FigureContext, settings: FigureSettings, overlays: FigureOverlays, plan: Plan): Figure {
  const { layout, layoutViews, size, axes, axis, lo, hi, pxPerUnit, mm, mmToPx } = plan;
  // ------------------------------------------------------------ render the views
  const rendered: RenderedView[] = layoutViews.map((lv) => {
    const d = VIEWS[lv.view];
    const s = size(lv.view);
    const toward = axis(d.toward), right = axis(d.right), up = axis(d.up);
    const centre = vadd(vadd([0, 0, 0], right, s.h0), up, s.v1);
    // camera: orthographic, its top-left corner at (h0, v1) of the view, one pixel = 1 / pxPerUnit
    const depth = ctx.diagonal * 4;
    const mid: Vec3 = [(lo.x + hi.x) / 2, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2];
    const midWorld = vadd(vadd(vadd([0, 0, 0], axes.x, mid[0]), axes.y, mid[1]), axes.z, mid[2]);
    const camPos = vadd(midWorld, toward, depth / 2);
    const cam = new THREE.OrthographicCamera(0, 1, 0, -1, 0.001 * depth, 2 * depth);
    cam.position.set(...camPos);
    cam.up.set(...up);
    cam.lookAt(new THREE.Vector3(...midWorld));
    cam.updateMatrixWorld(true);
    // frustum in camera space: x along `right`, y along `up`, relative to the camera position
    const cx = vdot(camPos, right), cy = vdot(camPos, up);
    cam.left = vdot(centre, right) - cx;
    cam.right = cam.left + s.w / pxPerUnit;
    cam.top = vdot(centre, up) - cy;
    cam.bottom = cam.top - s.h / pxPerUnit;
    cam.updateProjectionMatrix();
    const image = renderView(ctx, cam, s.w, s.h, settings.lightElevation, depth);

    const toPx = (q: Vec3): [number, number] => [(vdot(q, right) - s.h0) * pxPerUnit, (s.v1 - vdot(q, up)) * pxPerUnit];
    const raycaster = new THREE.Raycaster();
    (raycaster as unknown as { firstHitOnly: boolean }).firstHitOnly = true;
    const eps = ctx.diagonal * 2e-3;
    const towardV = new THREE.Vector3(...toward);
    const visible = (q: Vec3): boolean => {
      raycaster.set(new THREE.Vector3(q[0] + toward[0] * eps, q[1] + toward[1] * eps, q[2] + toward[2] * eps), towardV);
      return raycaster.intersectObject(ctx.mesh, false).length === 0;
    };
    // visible runs of a polyline (a segment counts when both of its ends are seen)
    const runs = (pts: Vec3[], closed: boolean): Array<Array<[number, number]>> => {
      const out: Array<Array<[number, number]>> = [];
      const seen = pts.map(visible);
      let cur: Array<[number, number]> = [];
      const n = pts.length + (closed ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const k = i % pts.length;
        if (seen[k]) cur.push(toPx(pts[k]));
        else {
          if (cur.length > 1) out.push(cur);
          cur = [];
        }
      }
      if (cur.length > 1) out.push(cur);
      return out;
    };
    // an arrow on a surface seen edge-on is unreadable: only draw arrows on surfaces facing this view
    const facing = (a: FigureOverlays['arrows'][number]) => vdot(vadd(a.startNormal, a.endNormal), toward) > 0.5;
    const arrows = settings.overlays.arrows
      ? overlays.arrows.filter(facing).map((a) => {
          // like the 3D arrows: straight, lifted along the normals
          const lift = ctx.diagonal * 0.004;
          const pts: Vec3[] = [];
          for (let i = 0; i <= 24; i++) {
            const t = i / 24;
            const base: Vec3 = [a.start[0] + t * (a.end[0] - a.start[0]), a.start[1] + t * (a.end[1] - a.start[1]), a.start[2] + t * (a.end[2] - a.start[2])];
            const n: Vec3 = [a.startNormal[0] + t * (a.endNormal[0] - a.startNormal[0]), a.startNormal[1] + t * (a.endNormal[1] - a.startNormal[1]), a.startNormal[2] + t * (a.endNormal[2] - a.startNormal[2])];
            pts.push(vadd(base, n, lift));
          }
          const r = runs(pts, false);
          const tip = visible(pts[24]) ? toPx(pts[24]) : null;
          const back = toPx(pts[0]);
          return { runs: r, head: tip ? ([back[0], back[1], tip[0], tip[1]] as [number, number, number, number]) : null, color: a.color };
        })
      : [];
    const lines: RenderedView['lines'] = [];
    if (settings.overlays.curves) for (const c of overlays.curves) lines.push({ runs: runs(c.points, c.closed), color: c.color, kind: 'curve' });
    if (settings.overlays.planes) for (const pl of overlays.planes) for (const l of pl.lines) lines.push({ runs: runs(l.points, l.closed), color: pl.color, kind: 'plane' });

    // outline from the coverage of the rendered model
    const alpha = new Uint8Array(s.w * s.h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = image.data[4 * i + 3];
    const outline = traceOutlines(alpha, s.w, s.h).map((l) => simplifyLoop(l, 0.35));
    return { ...lv, image, outline, arrows, lines };
  });

  const stroke = { arrow: mmToPx(0.35), line: mmToPx(0.3), outline: mmToPx(0.25), head: mmToPx(2.2) };
  return {
    layout,
    png: () => composePng(rendered, layout, stroke, settings.dpi, !!mm),
    svg: () => composeSvg(rendered, layout, stroke, mmToPx),
  };
}

function renderView(ctx: FigureContext, cam: THREE.OrthographicCamera, w: number, h: number, elevation: number, depth: number): ImageData {
  const r = ctx.renderer;
  const target = new THREE.WebGLRenderTarget(w, h, { samples: 4 });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const prevTarget = r.getRenderTarget();
  const prevColor = r.getClearColor(new THREE.Color());
  const prevAlpha = r.getClearAlpha();
  const prevLight: LightSettings = { ...ctx.lights.settings };
  const overlayShown = ctx.overlay.visible;
  try {
    ctx.overlay.visible = false;
    ctx.lights.set({ azimuthDeg: 135, elevationDeg: elevation });
    ctx.lights.update(cam, new THREE.Vector3().copy(cam.position).addScaledVector(cam.getWorldDirection(new THREE.Vector3()), depth / 2), depth);
    r.setRenderTarget(target);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(ctx.scene, cam);
    const buf = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(target, 0, 0, w, h, buf);
    // WebGL rows run bottom-up
    const out = new ImageData(w, h);
    for (let row = 0; row < h; row++) out.data.set(buf.subarray((h - 1 - row) * w * 4, (h - row) * w * 4), row * w * 4);
    return out;
  } finally {
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevColor, prevAlpha);
    ctx.lights.set(prevLight);
    ctx.overlay.visible = overlayShown;
    target.dispose();
  }
}

interface Strokes {
  arrow: number;
  line: number;
  outline: number;
  head: number;
}

/** Arrowhead triangle at the tip (x1, y1) of the segment from (x0, y0). */
function headPoints(seg: [number, number, number, number], size: number): Array<[number, number]> {
  const [x0, y0, x1, y1] = seg;
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
  const s = Math.min(size, len * 0.6);
  return [
    [x1, y1],
    [x1 - ux * s - uy * s * 0.45, y1 - uy * s + ux * s * 0.45],
    [x1 - ux * s + uy * s * 0.45, y1 - uy * s - ux * s * 0.45],
  ];
}

const barTicks = (bar: NonNullable<FigureLayout['scaleBar']>, pxPerUnit: number): number[] => {
  const { step } = scaleBarLength(bar.length * 3);
  const ticks: number[] = [];
  for (let v = 0; v <= bar.length + 1e-9; v += step) ticks.push(bar.x0 + v * pxPerUnit);
  return ticks;
};

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the PNG.');
  return new Uint8Array(await blob.arrayBuffer());
}

function drawOverlays(g: CanvasRenderingContext2D, v: RenderedView, stroke: Strokes): void {
  g.save();
  g.translate(v.x, v.y);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (const l of v.lines) {
    g.strokeStyle = l.color;
    g.lineWidth = stroke.line;
    for (const run of l.runs) {
      g.beginPath();
      run.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
      g.stroke();
    }
  }
  for (const a of v.arrows) {
    g.strokeStyle = g.fillStyle = a.color;
    g.lineWidth = stroke.arrow;
    for (const run of a.runs) {
      g.beginPath();
      run.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
      g.stroke();
    }
    if (a.head) {
      const h = headPoints(a.head, stroke.head);
      g.beginPath();
      h.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
      g.closePath();
      g.fill();
    }
  }
  g.restore();
}

function drawScaleBar(g: CanvasRenderingContext2D, layout: FigureLayout, stroke: Strokes, font: number): void {
  const bar = layout.scaleBar;
  if (!bar) return;
  g.save();
  g.strokeStyle = g.fillStyle = '#000';
  g.lineWidth = stroke.line;
  g.beginPath();
  g.moveTo(bar.x0, bar.y);
  g.lineTo(bar.x1, bar.y);
  for (const tx of barTicks(bar, layout.pxPerUnit)) {
    g.moveTo(tx, bar.y);
    g.lineTo(tx, bar.y - font * 0.6);
  }
  g.stroke();
  g.font = `${font}px Helvetica, Arial, sans-serif`;
  g.textBaseline = 'top';
  g.textAlign = 'left';
  g.fillText(`${bar.length} ${bar.unit}`, bar.x1 + font * 0.5, bar.y - font * 0.55);
  g.restore();
}

async function composePng(views: RenderedView[], layout: FigureLayout, stroke: Strokes, dpi: number, physical: boolean): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const g = canvas.getContext('2d')!;
  for (const v of views) {
    const tile = document.createElement('canvas');
    tile.width = v.width;
    tile.height = v.height;
    tile.getContext('2d')!.putImageData(v.image, 0, 0);
    g.drawImage(tile, v.x, v.y);
  }
  for (const v of views) drawOverlays(g, v, stroke);
  drawScaleBar(g, layout, stroke, layout.mmPerPx ? 2.6 / layout.mmPerPx : 24);
  const png = await canvasPng(canvas);
  return physical ? pngWithDpi(png, dpi) : png;
}

const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
const pts = (run: Array<[number, number]>) => run.map(([px, py]) => `${f2(px)},${f2(py)}`).join(' ');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

async function composeSvg(views: RenderedView[], layout: FigureLayout, stroke: Strokes, mmToPx: (v: number) => number): Promise<string> {
  const out: string[] = [];
  const mmPerPx = layout.mmPerPx;
  const size = mmPerPx ? `width="${f2(layout.width * mmPerPx)}mm" height="${f2(layout.height * mmPerPx)}mm"` : `width="${layout.width}" height="${layout.height}"`;
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" ${size} viewBox="0 0 ${layout.width} ${layout.height}">`);
  for (const v of views) {
    const tile = document.createElement('canvas');
    tile.width = v.width;
    tile.height = v.height;
    tile.getContext('2d')!.putImageData(v.image, 0, 0);
    const b64 = btoa(Array.from(await canvasPng(tile), (c) => String.fromCharCode(c)).join(''));
    out.push(`<g id="view-${v.view}" transform="translate(${v.x} ${v.y})">`);
    out.push(`<image width="${v.width}" height="${v.height}" xlink:href="data:image/png;base64,${b64}"/>`);
    out.push(`<g class="outline" fill="none" stroke="#000" stroke-width="${f2(stroke.outline)}" stroke-linejoin="round">`);
    for (const loop of v.outline) out.push(`<path d="M${pts(loop).replace(/ /g, ' L')} Z"/>`);
    out.push('</g>');
    out.push(`<g class="lines" fill="none" stroke-width="${f2(stroke.line)}" stroke-linecap="round" stroke-linejoin="round">`);
    for (const l of v.lines) for (const run of l.runs) out.push(`<polyline class="${l.kind}" stroke="${esc(l.color)}" points="${pts(run)}"/>`);
    out.push('</g>');
    out.push(`<g class="arrows" stroke-width="${f2(stroke.arrow)}" stroke-linecap="round" stroke-linejoin="round">`);
    for (const a of v.arrows) {
      for (const run of a.runs) out.push(`<polyline fill="none" stroke="${esc(a.color)}" points="${pts(run)}"/>`);
      if (a.head) out.push(`<polygon fill="${esc(a.color)}" stroke="none" points="${pts(headPoints(a.head, stroke.head))}"/>`);
    }
    out.push('</g>');
    out.push('</g>');
  }
  const bar = layout.scaleBar;
  if (bar) {
    const font = mmToPx(2.6);
    const ticks = barTicks(bar, layout.pxPerUnit).map((tx) => `M${f2(tx)} ${f2(bar.y)} V${f2(bar.y - font * 0.6)}`).join(' ');
    out.push(`<g id="scale-bar" stroke="#000" stroke-width="${f2(stroke.line)}" fill="none">`);
    out.push(`<path d="M${f2(bar.x0)} ${f2(bar.y)} H${f2(bar.x1)} ${ticks}"/>`);
    out.push(`<text x="${f2(bar.x1 + font * 0.5)}" y="${f2(bar.y + font * 0.35)}" font-family="Helvetica, Arial, sans-serif" font-size="${f2(font)}" fill="#000" stroke="none">${esc(`${bar.length} ${bar.unit}`)}</text>`);
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('\n');
}

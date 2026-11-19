import { describe, expect, it } from 'vitest';
import { nestLoops, signedArea, simplifyLoop, traceOutlines } from '../src/compute/contour';
import { crc32, pngDpi, pngWithDpi } from '../src/io/png';
import { DEFAULT_FIGURE, FIGURE_VIEWS, figureLayout, SECTION_LABEL_GAP_MM, SECTION_LABEL_MM, sectionTraceViews, type FigureContext, type FigureSettings, type SectionDrawing } from '../src/render/figure';

const area = (loop: Array<[number, number]>) => Math.abs(loop.reduce((s, p, i) => s + p[0] * loop[(i + 1) % loop.length][1] - loop[(i + 1) % loop.length][0] * p[1], 0) / 2);

describe('outlines', () => {
  it('trace a filled rectangle and a ring as closed loops', () => {
    const w = 20, h = 12;
    const mask = new Uint8Array(w * h);
    for (let y = 2; y < 8; y++) for (let x = 3; x < 13; x++) mask[y * w + x] = 255;
    const loops = traceOutlines(mask, w, h);
    expect(loops).toHaveLength(1);
    // the outline runs half way between inside and outside pixel centres: 10 × 6 pixels
    expect(Math.abs(area(loops[0]) - (10 * 6 - 0.5))).toBeLessThan(0.1);
    const simple = simplifyLoop(loops[0], 0.3);
    expect(simple.length).toBeLessThanOrEqual(8);
    expect(area(simple)).toBeCloseTo(area(loops[0]), 6);

    // a ring: outer and inner outline
    const ring = new Uint8Array(w * h);
    for (let y = 1; y < 11; y++) for (let x = 1; x < 11; x++) if (x < 3 || x > 8 || y < 3 || y > 8) ring[y * w + x] = 255;
    expect(traceOutlines(ring, w, h)).toHaveLength(2);
    // touching the border still closes
    expect(traceOutlines(new Uint8Array(w * h).fill(255), w, h)).toHaveLength(1);
  });
});

describe('PNG resolution', () => {
  it('writes a pHYs chunk with the dpi and a valid CRC', () => {
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
    // a 1 × 1 PNG: signature, IHDR, IDAT, IEND
    const hex = '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082';
    const png = new Uint8Array(hex.match(/../g)!.map((b) => parseInt(b, 16)));
    const out = pngWithDpi(png, 600);
    expect(out.length).toBe(png.length + 21);
    expect(pngDpi(out)).toBeCloseTo(600, 1);
    expect(pngDpi(pngWithDpi(out, 300))).toBeCloseTo(300, 1);
    expect(pngWithDpi(out, 300).length).toBe(out.length);
  });
});

describe('section loops', () => {
  it('nest outlines and holes', () => {
    const square = (c: number, r: number): Array<[number, number]> => [[c - r, c - r], [c + r, c - r], [c + r, c + r], [c - r, c + r]];
    const shapes = nestLoops([square(0, 1), square(0, 5), square(20, 2), square(0, 3)]);
    // 5 with a hole of 3 (inside which 1 is an island again), and 2 on its own
    expect(shapes.map((s) => [Math.abs(signedArea(s.outer)), s.holes.map((h) => Math.abs(signedArea(h)))])).toEqual([
      [100, [36]],
      [16, []],
      [4, []],
    ]);
  });
});

describe('section positions on the views', () => {
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const s45 = Math.SQRT1_2;

  it('are marked on the views that look along the section plane, within 30°', () => {
    // a horizontal section: seen edge-on from the four sides, face-on from above and below
    expect(sectionTraceViews([0, 1, 0], FIGURE_VIEWS, I)).toEqual(['front', 'back', 'left', 'right']);
    // 45° between the plane and the front, back, left and right lines of sight: only from above and below
    expect(sectionTraceViews([s45, 0, s45], FIGURE_VIEWS, I)).toEqual(['top', 'bottom']);
    // the limit itself counts (30° from the top and bottom lines of sight), 31° does not
    const deg = (d: number): [number, number, number] => [0, Math.sin((d * Math.PI) / 180), Math.cos((d * Math.PI) / 180)];
    expect(sectionTraceViews(deg(30), FIGURE_VIEWS, I)).toEqual(['left', 'right', 'top', 'bottom']);
    expect(sectionTraceViews(deg(31), FIGURE_VIEWS, I)).toEqual(['left', 'right']);
  });

  it('fall back to the view nearest to edge-on when none of the chosen ones is', () => {
    expect(sectionTraceViews([s45, 0, s45], ['front'], I)).toEqual(['front']);
    expect(sectionTraceViews([0, 0, 1], ['front', 'back'], I)).toEqual(['front']);
    expect(sectionTraceViews([0, 0.3, 0.954], ['front', 'top'], I)).toEqual(['top']);
    expect(sectionTraceViews([0, 1, 0], [], I)).toEqual([]);
  });

  it('follow the specimen frame, not the file axes', () => {
    // specimen Y along the file's Z
    const frame = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
    expect(sectionTraceViews([0, 0, 1], FIGURE_VIEWS, frame)).toEqual(['front', 'back', 'left', 'right']);
  });
});

describe('figure layout', () => {
  // a 20 mm cube around the origin, in millimetres, at 1:1 and 600 dpi
  const cube: number[] = [];
  for (const x of [-10, 10]) for (const y of [-10, 10]) for (const z of [-10, 10]) cube.push(x, y, z);
  const ctx = { positions: cube, offset: [0, 0, 0] } as unknown as FigureContext;
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const px = (mm: number) => (mm * 600) / 25.4;
  const square: Array<[number, number]> = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
  const drawing = (label: string, trace: SectionDrawing['trace'] = null): SectionDrawing => ({ label, loops: [square], fill: 'hatch', trace });
  const settings = (o: Partial<FigureSettings> = {}): FigureSettings => ({ ...DEFAULT_FIGURE, views: ['front'], ...o, overlays: { ...DEFAULT_FIGURE.overlays, ...(o.overlays ?? {}) } });

  it('puts each section drawing under its label', () => {
    const plain = figureLayout(ctx, I, 'mm', settings(), [drawing('')]);
    const named = figureLayout(ctx, I, 'mm', settings(), [drawing('X1')]);
    const title = Math.round(px(SECTION_LABEL_MM) * 1.4);
    expect(named.sections[0].y - plain.sections[0].y).toBe(title);
    expect(named.sections[0].labelY).toBeCloseTo(plain.sections[0].y + px(SECTION_LABEL_MM), 6);
    expect(named.height - plain.height).toBe(title);
    // the front view does not move
    expect(named.views[0]).toEqual(plain.views[0]);
  });

  it('makes room around the views for the labels at the ends of a marked section', () => {
    const trace = { normal: [0, 1, 0] as [number, number, number], lines: [{ points: [[-10, 0, -10], [10, 0, -10], [10, 0, 10], [-10, 0, 10]] as Array<[number, number, number]>, closed: true }] };
    const off = figureLayout(ctx, I, 'mm', settings({ overlays: { ...DEFAULT_FIGURE.overlays, sections: false } }), [drawing('X1', trace)]);
    const on = figureLayout(ctx, I, 'mm', settings(), [drawing('X1', trace)]);
    // without marks: the usual 3 mm margin
    expect(off.views[0].x).toBe(Math.round(px(3)));
    // with them: the gap and the label's width beyond the view's edge
    const reach = px(SECTION_LABEL_GAP_MM) + 0.6 * px(SECTION_LABEL_MM) * 2;
    expect(on.views[0].x).toBe(Math.round(reach + px(0.5)));
    expect(on.sections[0].x - (on.views[0].x + on.views[0].width)).toBe(Math.round(2 * reach + px(1)));
  });
});

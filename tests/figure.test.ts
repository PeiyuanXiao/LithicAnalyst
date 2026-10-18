import { describe, expect, it } from 'vitest';
import { nestLoops, signedArea, simplifyLoop, traceOutlines } from '../src/compute/contour';
import { crc32, pngDpi, pngWithDpi } from '../src/io/png';

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

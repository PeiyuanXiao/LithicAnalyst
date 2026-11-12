import { describe, expect, it } from 'vitest';
import { globalFields, igesNumber, igesUnitMm, readIges } from '../src/io/iges';
import { dNumber, HEADER_FILE_NAME, igesText, line, PTC_HEADER, sampleIges, type Vec3 } from './igesFiles';

/** Ten segments as in the user's sample: about 20 × 24 × 22, z between 470 and 493, far from the origin. */
export const SAMPLE_SEGMENTS: Array<[Vec3, Vec3]> = Array.from({ length: 10 }, (_, i) => [
  [-31.14144833307 + 2 * i, 12.5 + 1.7 * i, 470.25 + 2.1 * i],
  [-31.14144833307 + 2 * i + 1.3, 14.25 + 1.7 * i, 472.5 + 2.1 * i],
]);

const close = (a: Vec3, b: Vec3, tol = 1e-9) => a.every((v, k) => Math.abs(v - b[k]) <= tol);

describe('IGES reading', () => {
  it('writes and reads numbers with Fortran exponents', () => {
    expect(dNumber(-31.14144833307)).toBe('-3.114144833307D1');
    expect(igesNumber('-3.114144833307D1')).toBeCloseTo(-31.14144833307, 12);
    expect(igesNumber(' 1.0D-6 ')).toBe(1e-6);
    expect(igesNumber('1.')).toBe(1);
  });

  it('reads the global section: delimiters, Hollerith strings with commas and backslashes, the units', () => {
    const text = sampleIges(SAMPLE_SEGMENTS);
    const g = text
      .split('\r\n')
      .filter((l) => l[72] === 'G')
      .map((l) => l.slice(0, 72))
      .join('');
    const { pd, rd, fields } = globalFields(g);
    expect([pd, rd]).toEqual([',', ';']);
    expect(fields[4]).toBe(HEADER_FILE_NAME);
    expect(fields[5]).toBe('PTC Creo Parametric, 9.0');
    expect(fields.slice(13, 16)).toEqual(['1.', '10', 'CM']);
    expect(fields[20]).toBe('0.386401');
  });

  it('reads the sample format: ten lines written twice, each line once', () => {
    const r = readIges(sampleIges(SAMPLE_SEGMENTS));
    expect(r.segments).toHaveLength(10);
    expect(r.duplicates).toBe(10);
    expect(r.conflicts).toEqual([]);
    expect(r.skipped).toEqual({});
    expect(r.units).toEqual({ flag: 10, name: 'CM', scale: 1 });
    r.segments.forEach((s, i) => {
      expect(close(s.start, SAMPLE_SEGMENTS[i][0])).toBe(true);
      expect(close(s.end, SAMPLE_SEGMENTS[i][1])).toBe(true);
      expect(s.label).toBe('LINE');
    });
    // every other entity is the copy: the first of each pair is kept
    expect(r.segments.map((s) => s.de)).toEqual(Array.from({ length: 10 }, (_, i) => 4 * i + 1));
    // the parameters ran on to a second line
    expect(sampleIges(SAMPLE_SEGMENTS).split('\r\n').filter((l) => l[72] === 'P').length).toBe(40);
  });

  it('reads polylines (106), B-spline curves (126) and matrices (124); rays and other entities are counted', () => {
    // a turn of 90° about z and a move of 10 along x
    const matrix = { type: 124, params: [0, -1, 0, 10, 1, 0, 0, 0, 0, 0, 1, 0] };
    const P: Vec3[] = [
      [0, 0, 0],
      [3, 1, 0],
      [6, -1, 2],
      [9, 0, 4],
    ];
    const text = igesText([
      matrix,
      // a 3D path: first and last of three points
      { type: 106, form: 12, ints: 2, params: [2, 3, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
      // a 2D path at z = 5
      { type: 106, form: 11, ints: 2, params: [1, 3, 5, 0, 0, 1, 1, 2, 0] },
      // a clamped cubic: its first and last control points
      { type: 126, ints: 6, params: [3, 3, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, ...P.flat(), 0, 1, 0, 0, 0] },
      // a uniform cubic (knots 0…7): at u = 3 and u = 4, (P0 + 4 P1 + P2) / 6 and (P1 + 4 P2 + P3) / 6
      { type: 126, ints: 6, params: [3, 3, 0, 0, 1, 0, 0, 1, 2, 3, 4, 5, 6, 7, 1, 1, 1, 1, ...P.flat(), 3, 4, 0, 0, 0] },
      // a line under the matrix
      line([1, 0, 0], [2, 0, 0], { matrix: 0 }),
      // a ray, a point
      line([0, 0, 0], [1, 1, 1], { form: 1 }),
      { type: 116, params: [1, 2, 3, 0] },
    ]);
    const r = readIges(text);
    expect(r.skipped).toEqual({ '110.1': 1, '116': 1 });
    expect(r.segments).toHaveLength(5);
    const [poly3, poly2, clamped, uniform, moved] = r.segments;
    expect(close(poly3.start, [1, 2, 3]) && close(poly3.end, [7, 8, 9])).toBe(true);
    expect(close(poly2.start, [0, 0, 5]) && close(poly2.end, [2, 0, 5])).toBe(true);
    expect(close(clamped.start, P[0]) && close(clamped.end, P[3])).toBe(true);
    const at = (a: Vec3, b: Vec3, c: Vec3): Vec3 => [0, 1, 2].map((k) => (a[k] + 4 * b[k] + c[k]) / 6) as Vec3;
    expect(close(uniform.start, at(P[0], P[1], P[2]))).toBe(true);
    expect(close(uniform.end, at(P[1], P[2], P[3]))).toBe(true);
    expect(close(moved.start, [10, 1, 0]) && close(moved.end, [10, 2, 0])).toBe(true);
  });

  it('leaves out hidden entities and lines of no length', () => {
    const r = readIges(igesText([line([0, 0, 0], [1, 0, 0]), line([0, 1, 0], [1, 1, 0], { hidden: true }), line([5, 5, 5], [5, 5, 5])]));
    expect(r.segments.map((s) => s.de)).toEqual([1]);
    expect(r.skipped).toEqual({ hidden: 1, zero: 1 });
  });

  it('keeps a line written again the other way round once, and lists it as a conflict', () => {
    const r = readIges(igesText([line([0, 0, 0], [4, 0, 0]), line([4, 0, 0], [0, 0, 0]), line([0, 2, 0], [4, 2, 0])]));
    expect(r.segments.map((s) => s.de)).toEqual([1, 5]);
    expect(r.conflicts).toEqual([{ de: 3, kept: 1 }]);
    expect(r.duplicates).toBe(0);
  });

  it('tells no IGES apart', () => {
    expect(() => readIges('solid nothing\nendsolid')).toThrow();
  });

  it('gives the millimetres of a unit by its flag, or by its name', () => {
    expect(igesUnitMm(PTC_HEADER)).toBe(10);
    expect(igesUnitMm({ flag: 2, name: '' })).toBe(1);
    expect(igesUnitMm({ flag: 3, name: 'INCH' })).toBe(25.4);
    expect(igesUnitMm({ flag: null, name: '' })).toBeNull();
  });
});

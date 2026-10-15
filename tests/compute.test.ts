import { describe, expect, it } from 'vitest';
import { buildAdjacency, meanCurvature } from '../src/compute/curvature';
import { sha256Hex, sha256Js } from '../src/compute/hash';
import { CurvatureService } from '../src/compute/curvatureService';
import { removeDegenerateTriangles, weldExact } from '../src/compute/weld';
import type { Vec3 } from '../src/core/types';
import { buildLoadedMesh } from '../src/io/loadMesh';

function uvSphere(r: number, nlat: number, nlon: number, c: Vec3 = [0, 0, 0]) {
  const pos: number[] = [c[0], c[1], c[2] + r];
  for (let i = 1; i < nlat; i++) {
    const th = (Math.PI * i) / nlat;
    for (let j = 0; j < nlon; j++) {
      const ph = (2 * Math.PI * j) / nlon;
      pos.push(c[0] + r * Math.sin(th) * Math.cos(ph), c[1] + r * Math.sin(th) * Math.sin(ph), c[2] + r * Math.cos(th));
    }
  }
  pos.push(c[0], c[1], c[2] - r);
  const south = pos.length / 3 - 1;
  const ring = (i: number, j: number) => 1 + (i - 1) * nlon + (((j % nlon) + nlon) % nlon);
  const idx: number[] = [];
  for (let j = 0; j < nlon; j++) idx.push(0, ring(1, j), ring(1, j + 1));
  for (let i = 1; i < nlat - 1; i++)
    for (let j = 0; j < nlon; j++) {
      const a = ring(i, j), b = ring(i + 1, j), cc = ring(i + 1, j + 1), d = ring(i, j + 1);
      idx.push(a, b, cc, a, cc, d);
    }
  for (let j = 0; j < nlon; j++) idx.push(south, ring(nlat - 1, j + 1), ring(nlat - 1, j));
  return { positions: new Float32Array(pos), index: new Uint32Array(idx) };
}


describe('weldExact', () => {
  it('merges shared corners, including -0 and +0', () => {
    const soup = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, -0, 1, 0]);
    const w = weldExact(soup);
    expect(w.positions.length / 3).toBe(4);
    expect(Array.from(w.index)).toEqual([0, 1, 2, 1, 3, 2]);
  });
  it('drops degenerate triangles', () => {
    expect(Array.from(removeDegenerateTriangles(new Uint32Array([0, 1, 2, 3, 3, 4, 5, 6, 7])))).toEqual([0, 1, 2, 5, 6, 7]);
  });
});

describe('sha256', () => {
  it('matches the standard test vector', async () => {
    const abc = new TextEncoder().encode('abc');
    const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(Array.from(sha256Js(abc), (b) => b.toString(16).padStart(2, '0')).join('')).toBe(expected);
    expect(await sha256Hex(abc)).toBe(expected);
    const big = new Uint8Array(100_003).map((_, i) => (i * 31) % 251);
    expect(Array.from(sha256Js(big), (b) => b.toString(16).padStart(2, '0')).join('')).toBe(await sha256Hex(big));
  });
});

describe('curvature', () => {
  it('is about 1/R and positive on an outward sphere', async () => {
    const s = uvSphere(10, 40, 80, [300, -200, 50]);
    const loaded = buildLoadedMesh({ positions: s.positions, index: s.index, colors: null, fileName: 's', format: 'ply', fileSize: 0, sha256: 'x' });
    expect(loaded.orientationSign).toBe(1);
    const pos = loaded.geometry.getAttribute('position').array as Float32Array;
    const nor = loaded.geometry.getAttribute('normal').array as Float32Array;
    const idx = loaded.geometry.index!.array as Uint32Array;
    const k = await meanCurvature(pos, nor, buildAdjacency(idx, pos.length / 3), loaded.orientationSign);
    const sorted = Array.from(k).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    expect(median).toBeGreaterThan(0.09);
    expect(median).toBeLessThan(0.11);
  });
});

describe('buildLoadedMesh', () => {
  it('keeps original coordinates through the display offset and does not mutate the input index', () => {
    const s = uvSphere(5, 10, 20, [1e5, 2e5, -3e4]);
    const indexCopy = s.index.slice();
    const loaded = buildLoadedMesh({ positions: s.positions, index: s.index, colors: null, fileName: 's', format: 'ply', fileSize: 0, sha256: 'x' });
    expect(Array.from(s.index)).toEqual(Array.from(indexCopy));
    expect(loaded.offset[0]).toBeCloseTo(1e5, 2);
    const local = loaded.geometry.getAttribute('position').array as Float32Array;
    for (let i = 0; i < 30; i++) {
      for (let c = 0; c < 3; c++) expect(local[3 * i + c] + loaded.offset[c]).toBeCloseTo(s.positions[3 * i + c], 2);
    }
  });
});


describe('CurvatureService', () => {
  it('serves smoothing levels up to 100 and reuses checkpoints', async () => {
    const sph = uvSphere(10, 30, 60);
    const loaded = buildLoadedMesh({ positions: sph.positions, index: sph.index, colors: null, fileName: 's', format: 'ply', fileSize: 0, sha256: 'x' });
    const g = loaded.geometry;
    const svc = new CurvatureService(
      g.getAttribute('position').array as Float32Array,
      g.getAttribute('normal').array as Float32Array,
      g.index!.array as Uint32Array,
      loaded.orientationSign,
    );
    const a = await svc.field(37);
    const b = await svc.field(100);
    const c = await svc.field(37);
    expect(a && b && c).toBeTruthy();
    expect(Array.from(c!.field)).toEqual(Array.from(a!.field));
    // heavy smoothing flattens the field toward its mean
    const spread = (f: Float32Array) => Math.max(...f) - Math.min(...f);
    expect(spread(b!.field)).toBeLessThan(spread((await svc.field(0))!.field));
    const colors = await svc.colors(100, 1);
    expect(colors!.length).toBe(g.getAttribute('position').count * 3);
  });
});

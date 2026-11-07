import { describe, expect, it } from 'vitest';
import { runSync } from '../src/compute/steps';
import { anchorWarpSteps, applySimilarity, similarityFit, TPS_PARAMETERS } from '../src/compute/tps';
import { triangleBvh } from '../src/compute/triangleBvh';
import type { Vec3 } from '../src/core/types';
import { box, rigid, sphere } from './meshes';

const warpOf = (from: Vec3[], to: Vec3[]) => {
  const w = runSync(anchorWarpSteps(from, to));
  if (!w) throw new Error('no fit');
  return w;
};
const gap = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Anchors spread in space, unevenly, with no symmetry to lean on. */
function anchors(n: number): Vec3[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n;
    return [40 * Math.cos(11 * t) + 3 * t, 25 * Math.sin(7 * t + 1), 12 * Math.cos(5 * t + 2) * t] as Vec3;
  });
}
/** Points among them. */
const among: Vec3[] = [[1, 2, 3], [-10, 5, 2], [20, -8, -4], [33, 12, 6], [-25, -15, 1]];

describe('carrying points by anchors', () => {
  it('anchors on themselves: nothing moves', () => {
    const a = anchors(24);
    const w = warpOf(a, a);
    for (const p of [...among, ...a]) expect(gap(w(p), p)).toBeLessThan(1e-9);
  });

  it('goes exactly through the anchors, for a deformation that is not affine', () => {
    const a = anchors(40);
    const bent = a.map((p): Vec3 => [p[0] + 0.01 * p[1] * p[1], p[1] - 0.004 * p[0] * p[2], p[2] + 3 * Math.sin(p[0] / 20)]);
    const w = warpOf(a, bent);
    a.forEach((p, i) => expect(gap(w(p), bent[i])).toBeLessThan(1e-9));
  });

  it('a purely affine change of the anchors moves every point by that affine change', () => {
    const a = anchors(30);
    // a stretch along X, a shear, a turn and a shift
    const turn = rigid([1, 2, -1], 40, [7, -3, 11]);
    const affine = (p: Vec3): Vec3 => turn([1.2 * p[0] + 0.3 * p[1], 0.8 * p[1], p[2] - 0.2 * p[0]]);
    const w = warpOf(a, a.map(affine));
    for (const p of among) expect(gap(w(p), affine(p))).toBeLessThan(1e-9);
  });

  it('a similarity is found as it is, without any bending', () => {
    const a = anchors(12);
    const turn = rigid([2, -1, 3], 123, [50, 60, -70]);
    const f = (p: Vec3): Vec3 => turn([2.5 * p[0], 2.5 * p[1], 2.5 * p[2]]);
    const b = a.map(f);
    const fit = similarityFit(a, b);
    expect(fit.scale).toBeCloseTo(2.5, 9);
    for (const p of among) expect(gap(applySimilarity(fit, p), f(p))).toBeLessThan(1e-9);
    const det = fit.rotation[0] * (fit.rotation[4] * fit.rotation[8] - fit.rotation[5] * fit.rotation[7]) - fit.rotation[1] * (fit.rotation[3] * fit.rotation[8] - fit.rotation[5] * fit.rotation[6]) + fit.rotation[2] * (fit.rotation[3] * fit.rotation[7] - fit.rotation[4] * fit.rotation[6]);
    expect(det).toBeCloseTo(1, 9);
  });

  it('a mirror image is not taken for a turn', () => {
    const a = anchors(12);
    const fit = similarityFit(a, a.map((p): Vec3 => [-p[0], p[1], p[2]]));
    const r = fit.rotation;
    expect(r[0] * (r[4] * r[8] - r[5] * r[7]) - r[1] * (r[3] * r[8] - r[5] * r[6]) + r[2] * (r[3] * r[7] - r[4] * r[6])).toBeCloseTo(1, 9);
  });

  it('anchors all in one plane: it solves, and nothing is squashed across the plane', () => {
    // the rim of a flat object: all in z = 0
    const a: Vec3[] = Array.from({ length: 20 }, (_, i) => {
      const t = (2 * Math.PI * i) / 20;
      return [30 * Math.cos(t), 20 * Math.sin(t), 0];
    });
    // on the other specimen the rim is deformed in its plane
    const b = a.map((p): Vec3 => [1.1 * p[0] + 0.05 * p[1] + 0.002 * p[1] * p[1], 0.9 * p[1], 0]);
    const w = warpOf(a, b);
    a.forEach((p, i) => expect(gap(w(p), b[i])).toBeLessThan(1e-9));
    // a point off the plane stays as far off it as the similarity put it
    const fit = similarityFit(a, b);
    for (const p of [[0, 0, 8], [10, 5, -6], [-12, 3, 4]] as Vec3[]) {
      const carried = w(p);
      const only = applySimilarity(fit, p);
      expect(Math.abs(carried[2] - only[2])).toBeLessThan(1e-9);
      expect(Math.abs(carried[2])).toBeGreaterThan(0.5 * Math.abs(p[2]));
    }
  });

  it('anchors along a line: it still solves, and they are still met', () => {
    const a: Vec3[] = Array.from({ length: 6 }, (_, i) => [i * 10, 0, 0]);
    const b = a.map((p): Vec3 => [p[0] * 1.5 + 2, 1, 2]);
    const w = warpOf(a, b);
    a.forEach((p, i) => expect(gap(w(p), b[i])).toBeLessThan(1e-9));
  });

  it('an anchor given twice counts once', () => {
    const a = anchors(10);
    const twice = [...a, a[0], a[3]];
    const b = twice.map((p): Vec3 => [p[0] + 1, p[1] - 2, p[2] + 0.5 * Math.sin(p[1])]);
    const w = warpOf(twice, b);
    a.forEach((p, i) => expect(gap(w(p), b[i])).toBeLessThan(1e-9));
  });

  it('a thousand anchors, more than one block of columns many times over: it meets them just as well', () => {
    const n = 1000;
    expect(n).toBeGreaterThan(10 * TPS_PARAMETERS.FACTOR_BLOCK);
    const a = anchors(n);
    const b = a.map((p): Vec3 => [p[0] + 0.01 * p[1] * p[1], p[1] - 0.004 * p[0] * p[2], p[2] + 3 * Math.sin(p[0] / 20)]);
    const w = warpOf(a, b);
    for (let i = 0; i < n; i += 37) expect(gap(w(a[i]), b[i])).toBeLessThan(1e-8);
  }, 30_000);
});

describe('the tree of triangles', () => {
  it('finds the closest point as a search over all of them does', () => {
    const m = sphere(10, 3);
    const tree = triangleBvh(m.positions, m.index);
    for (const q of [[12, 0, 0], [3, 4, 5], [-20, 1, 2], [0, 0, 0.5], [7, -7, 7]] as Vec3[]) {
      const hit = tree.closest(q)!;
      let best = Infinity;
      for (let t = 0; 3 * t < m.index.length; t++) {
        const hitOf = triangleBvh(m.positions, m.index, [t]).closest(q)!;
        best = Math.min(best, hitOf.distance);
      }
      expect(hit.distance).toBeCloseTo(best, 9);
      expect(gap(hit.point, q)).toBeCloseTo(hit.distance, 9);
    }
  });

  it('holds only the triangles it was given', () => {
    const m = box([10, 10, 10], 4);
    const top: number[] = [];
    for (let t = 0; 3 * t < m.index.length; t++) if ([0, 1, 2].every((k) => m.positions[3 * m.index[3 * t + k] + 2] === 5)) top.push(t);
    const tree = triangleBvh(m.positions, m.index, top);
    // below the box: the closest of the whole box would be its bottom
    const hit = tree.closest([0, 0, -20])!;
    expect(hit.point[2]).toBe(5);
    expect(top).toContain(hit.face);
    expect(triangleBvh(m.positions, m.index, []).closest([0, 0, 0])).toBeNull();
  });
});

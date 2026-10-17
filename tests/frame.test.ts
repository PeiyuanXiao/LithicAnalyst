import { describe, expect, it } from 'vitest';
import { frameAxes, frameFromView, frameWithVertical, rotateFrame } from '../src/core/frame';
import type { Vec3 } from '../src/core/types';

const apply = (m: number[], p: Vec3): Vec3 => [0, 1, 2].map((r) => m[4 * r] * p[0] + m[4 * r + 1] * p[1] + m[4 * r + 2] * p[2] + m[4 * r + 3]) as Vec3;
const round = (v: number[]) => v.map((x) => +x.toFixed(9) + 0);

describe('specimen frame', () => {
  it('is built from a view: +Z toward the viewer, +Y up, origin at the centre', () => {
    const o: Vec3 = [100, 50, -20];
    const m = frameFromView([0, -2, 0], [0, 0.3, 1], o)!;
    expect(round(apply(m, o))).toEqual([0, 0, 0]);
    // a point toward the viewer, one above, one to the right (viewer at −Y looking along +Y, up +Z → right is +X)
    expect(round(apply(m, [100, 40, -20]))).toEqual([0, 0, 10]);
    expect(round(apply(m, [100, 50, -10]))).toEqual([0, 10, 0]);
    expect(round(apply(m, [110, 50, -20]))).toEqual([10, 0, 0]);
    expect(round(frameAxes(m).origin)).toEqual(o);
    expect(frameFromView([0, 0, 1], [0, 0, 5], o)).toBeNull();
  });

  it('turns on the page and takes its vertical from a direction', () => {
    const m = frameFromView([0, 0, 1], [0, 1, 0], [0, 0, 0])!;
    // +90°: what was to the right is now up
    const r = rotateFrame(m, 90);
    expect(round(apply(r, [1, 0, 0]))).toEqual([0, 1, 0]);
    expect(round(apply(rotateFrame(r, -90), [1, 0, 0]))).toEqual([1, 0, 0]);
    // an arrow pointing to +X (with a component toward the viewer): +X becomes up, the front view stays
    const v = frameWithVertical(m, [3, 0, 1])!;
    expect(round(apply(v, [1, 0, 0]))).toEqual([0, 1, 0]);
    expect(round(frameAxes(v).z)).toEqual([0, 0, 1]);
    expect(frameWithVertical(m, [0, 0, 2])).toBeNull();
  });
});

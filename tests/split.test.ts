import { describe, expect, it } from 'vitest';
import { buildEdges } from '../src/compute/meshGeometry';
import { splitByLoopSteps, splitByPlaneSteps } from '../src/compute/split';
import { runSync } from '../src/compute/steps';
import { box, moved } from './meshes';

describe('volume split', () => {
  const cube = box([2, 2, 2], 4);

  it('halves a cube along its mid-plane, either way up', () => {
    const s = runSync(splitByPlaneSteps(cube.positions, cube.index, [0, 0, 0], [0, 0, 1]));
    expect(s.upper).toBeCloseTo(4, 9);
    expect(s.lower).toBeCloseTo(4, 9);
    expect(s.ratio).toBeCloseTo(1, 9);
    // inward-facing triangles give the same volumes
    const flipped = new Uint32Array(cube.index);
    for (let t = 0; t < flipped.length; t += 3) [flipped[t + 1], flipped[t + 2]] = [flipped[t + 2], flipped[t + 1]];
    expect(runSync(splitByPlaneSteps(cube.positions, flipped, [0, 0, 0.5], [0, 0, 1])).upper).toBeCloseTo(2, 9);
  });

  it('matches the analytic volume for an oblique plane, far from the origin', () => {
    // x + y > 0.5 inside [−1, 1]³: a prism over a right triangle with legs 1.5, height 2
    const far = moved(cube, [500, -300, 80]);
    const n = [Math.SQRT1_2, Math.SQRT1_2, 0] as [number, number, number];
    const s = runSync(splitByPlaneSteps(far.positions, far.index, [500.25, -299.75, 80], n));
    expect(s.upper).toBeCloseTo(2.25, 3);
    expect(s.lower).toBeCloseTo(5.75, 3);
    expect(s.upper + s.lower).toBeCloseTo(8, 3);
  });

  it('splits along a closed loop of mesh edges', () => {
    const vc = cube.positions.length / 3;
    const edges = buildEdges(cube.index, vc);
    const z = (v: number) => cube.positions[3 * v + 2];
    const ring: number[] = [];
    for (let e = 0; e < edges.v0.length; e++) if (z(edges.v0[e]) === 0.5 && z(edges.v1[e]) === 0.5) ring.push(edges.v0[e], edges.v1[e]);
    const s = runSync(splitByLoopSteps(cube.positions, cube.index, edges, ring, [0, 0, 1]))!;
    expect(s.upper).toBeCloseTo(2, 9);
    expect(s.lower).toBeCloseTo(6, 9);
    // the other way up
    const t = runSync(splitByLoopSteps(cube.positions, cube.index, edges, ring, [0, 0, -1]))!;
    expect(t.upper).toBeCloseTo(6, 9);
    // a chain that does not close: no split
    expect(runSync(splitByLoopSteps(cube.positions, cube.index, edges, ring.slice(2), [0, 0, 1]))).toBeNull();
  });
});

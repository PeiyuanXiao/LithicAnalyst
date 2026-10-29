import { describe, expect, it } from 'vitest';
import { chainEdges, scarBordersSteps } from '../src/compute/adjacency';
import { buildEdges } from '../src/compute/meshGeometry';
import { runSync } from '../src/compute/steps';
import { removeDegenerateTriangles, weldIndexed } from '../src/compute/weld';
import { box } from './meshes';

describe('scars whose regions border on each other', () => {
  // a cube, each face an n × n grid; box() writes the faces one after another
  const n = 4;
  const b = box([2, 2, 2], n);
  const edges = buildEdges(b.index, b.positions.length / 3);
  const tris = b.index.length / 3;
  const face = new Uint32Array(tris).map((_, t) => Math.floor(t / (2 * n * n)));
  const scars = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
  const borders = (owner: number[], minFactor?: number) => runSync(scarBordersSteps(b.positions, b.index, edges, face, owner, scars, minFactor));

  it('each face of a cube, a scar region each, borders on four others', () => {
    const list = borders([0, 1, 2, 3, 4, 5]);
    expect(list).toHaveLength(12);
    for (const s of scars) expect(list.filter((x) => x.a === s || x.b === s)).toHaveLength(4);
    // opposite faces (box order: +x −x, +y −y, +z −z) never meet
    for (const [p, q] of [['S1', 'S2'], ['S3', 'S4'], ['S5', 'S6']]) expect(list.some((x) => (x.a === p && x.b === q) || (x.a === q && x.b === p))).toBe(false);
    // a whole cube edge: length 2 in n mesh edges, and a middle point on it
    for (const x of list) {
      expect(x.length).toBeCloseTo(2, 5);
      expect(x.edges).toHaveLength(2 * n);
      expect(x.mid.filter((c) => Math.abs(Math.abs(c) - 1) < 1e-6)).toHaveLength(2);
    }
  });

  it('leaves out pieces that are no scar region, and borders shorter than twice the mean edge', () => {
    // only +x and +y are scars
    expect(borders([0, 2, -1, -1, -1, -1]).map((x) => [x.a, x.b])).toEqual([]);
    expect(borders([0, -1, 2, -1, -1, -1]).map((x) => [x.a, x.b])).toEqual([['S1', 'S3']]);
    // two faces of one scar do not border on themselves
    expect(borders([0, 0, 0, 0, 0, 0])).toEqual([]);
    // with a factor beyond the border's length the pair is left out
    expect(borders([0, -1, 2, -1, -1, -1], 20)).toEqual([]);
  });

  it('joins edges into chains and loops', () => {
    // an open path 1-2-3-4, given out of order, and a loop 7-8-9
    const chains = chainEdges([3, 4, 1, 2, 2, 3, 7, 8, 8, 9, 9, 7]);
    expect(chains).toHaveLength(2);
    const open = chains.find((c) => c.includes(1))!;
    expect(open[0] === 1 ? open : [...open].reverse()).toEqual([1, 2, 3, 4]);
    const loop = chains.find((c) => c.includes(7))!;
    expect(loop).toHaveLength(4);
    expect(loop[0]).toBe(loop[3]);
    // a junction breaks the chains: three spokes from 0
    expect(chainEdges([0, 1, 0, 2, 0, 3]).map((c) => c.length)).toEqual([2, 2, 2]);
  });
});

describe('welding an indexed mesh', () => {
  /** The cube with three vertices of its own for every triangle (as some PLY writers do). */
  const separate = () => {
    const b = box([2, 2, 2], 1);
    const positions = new Float32Array(b.index.length * 3);
    b.index.forEach((v, i) => positions.set(b.positions.subarray(3 * v, 3 * v + 3), 3 * i));
    return { positions, index: new Uint32Array(b.index.length).map((_, i) => i) };
  };

  it('joins a cube with separate vertices per face into 8 vertices and 12 triangles', () => {
    const s = separate();
    expect(s.positions.length / 3).toBe(36);
    const w = weldIndexed(s.positions, s.index);
    expect(w.positions.length / 3).toBe(8);
    const index = removeDegenerateTriangles(w.index);
    expect(index.length / 3).toBe(12);
    // every triangle keeps its corners where they were
    for (let i = 0; i < s.index.length; i++)
      for (let k = 0; k < 3; k++) expect(w.positions[3 * index[i] + k]).toBe(s.positions[3 * i + k]);
    // the faces now share edges: a closed surface
    const e = buildEdges(index, 8);
    expect([...e.faces].every((c) => c === 2)).toBe(true);
  });

  it('keeps a mesh without repeated vertices as it is, and the first colour of a merged vertex', () => {
    const b = box([2, 2, 2], 2);
    const colors = new Float32Array(b.positions.length).map((_, i) => i / b.positions.length);
    const w = weldIndexed(b.positions, b.index, colors);
    expect(w.positions).toBe(b.positions);
    expect(w.index).toBe(b.index);
    expect(w.colors).toBe(colors);
    // a repeated vertex at the end takes the colour of the first one
    const n = b.positions.length / 3;
    const positions = new Float32Array([...b.positions, ...b.positions.subarray(0, 3)]);
    const more = new Float32Array([...colors, 0.9, 0.9, 0.9]);
    const index = new Uint32Array([...b.index, n, 1, 2]);
    const v = weldIndexed(positions, index, more);
    expect(v.positions.length / 3).toBe(n);
    expect(v.index[v.index.length - 3]).toBe(0);
    expect([...v.colors!.subarray(0, 3)]).toEqual([...colors.subarray(0, 3)]);
  });
});

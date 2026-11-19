import { describe, expect, it } from 'vitest';
import { runSync } from '../src/compute/steps';
import type { Vec3 } from '../src/core/types';
import { facesOfPieceSteps, regionPly, regionPlyComments } from '../src/io/regionPly';
import { box } from './meshes';

/** A binary little-endian PLY of vertices (float x, y, z) and triangles (uchar 3, int ×3), read back. */
function readPly(bytes: Uint8Array): { header: string[]; vertices: Vec3[]; faces: Array<[number, number, number]> } {
  const text = new TextDecoder().decode(bytes);
  const end = text.indexOf('end_header\n') + 'end_header\n'.length;
  const header = text.slice(0, end).trim().split('\n');
  const headBytes = new TextEncoder().encode(text.slice(0, end)).length;
  const count = (el: string) => Number(header.find((l) => l.startsWith(`element ${el} `))!.split(' ')[2]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = headBytes;
  const vertices: Vec3[] = [];
  for (let i = 0; i < count('vertex'); i++, at += 12) vertices.push([view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true)]);
  const faces: Array<[number, number, number]> = [];
  for (let i = 0; i < count('face'); i++, at += 13) {
    expect(view.getUint8(at)).toBe(3);
    faces.push([view.getInt32(at + 1, true), view.getInt32(at + 5, true), view.getInt32(at + 9, true)]);
  }
  expect(at).toBe(bytes.length);
  return { header, vertices, faces };
}

describe('a region as a PLY mesh', () => {
  // a 2 mm cube, each face a 4 × 4 grid; its +z face is the region
  const m = box([2, 2, 2], 4);
  const tris = m.index.length / 3;
  const corner = (t: number, j: number): Vec3 => {
    const v = m.index[3 * t + j];
    return [m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]];
  };
  const pieceOf = new Uint32Array(tris);
  for (let t = 0; t < tris; t++) pieceOf[t] = [0, 1, 2].every((j) => corner(t, j)[2] === 1) ? 7 : 3;
  const offset: Vec3 = [1000.5, -20.25, 3];
  const comments = regionPlyComments({ app: 'LithicAnalyst', version: '9.9.9', specimen: 'EXP 03', region: 'R2', type: 'cortex', unit: 'mm', file: 'EXP03.ply', sha256: 'ab12' });

  it('takes the triangles of its piece', () => {
    const faces = runSync(facesOfPieceSteps(pieceOf, 7));
    expect(faces.length).toBe(32);
    expect([...faces].every((t) => pieceOf[t] === 7)).toBe(true);
  });

  it('has the vertices it uses once each, its triangles, the original coordinates (with the offset) and the header comments', () => {
    const faces = runSync(facesOfPieceSteps(pieceOf, 7));
    const ply = readPly(regionPly({ positions: m.positions, index: m.index, offset, faces, comments }));
    expect(ply.header.slice(0, 2)).toEqual(['ply', 'format binary_little_endian 1.0']);
    expect(ply.header.filter((l) => l.startsWith('comment '))).toEqual(['comment LithicAnalyst 9.9.9', 'comment specimen EXP 03', 'comment region R2 cortex', 'comment unit mm', 'comment source EXP03.ply sha256 ab12']);
    expect(ply.header.slice(-6)).toEqual(['property float x', 'property float y', 'property float z', 'element face 32', 'property list uchar int vertex_indices', 'end_header']);
    // a 4 × 4 grid: 25 vertices, 32 triangles
    expect(ply.vertices.length).toBe(25);
    expect(ply.faces.length).toBe(32);
    expect(new Set(ply.vertices.map((v) => v.join())).size).toBe(25);
    expect(ply.vertices.every((v) => Math.abs(v[2] - (1 + offset[2])) < 1e-4)).toBe(true);
    // each triangle as it is on the model, corner by corner, moved by the offset
    const f32 = (x: number) => Math.fround(x);
    ply.faces.forEach((f, k) => {
      for (let j = 0; j < 3; j++) {
        const want = corner(faces[k], j).map((x, a) => f32(x + offset[a]));
        expect(ply.vertices[f[j]]).toEqual(want);
      }
    });
  });

  it('says when the unit is not stated', () => {
    expect(regionPlyComments({ app: 'LithicAnalyst', version: '1', specimen: '', region: 'R1', type: 'scar', unit: '', file: 'a.ply', sha256: '' })).toContain('unit unspecified');
  });

  it('a piece with no triangles: an empty mesh', () => {
    const ply = readPly(regionPly({ positions: m.positions, index: m.index, offset, faces: runSync(facesOfPieceSteps(pieceOf, 99)), comments: [] }));
    expect(ply.vertices.length + ply.faces.length).toBe(0);
  });
});

import { YIELD_EVERY, runSync, type Steps } from '../compute/steps';
import type { Vec3 } from '../core/types';

/**
 * A surface region as a mesh of its own: binary little-endian PLY with the vertices it uses (each once, in the order the region's
 * triangles first use them) as `float x, y, z` in the model file's own coordinates, and its triangles as `list uchar int
 * vertex_indices`. No colours, no normals. No DOM: written in slices, so a large region of a large scan never holds up the page.
 */

export interface RegionPlyInput {
  /** The mesh's vertices relative to `offset` (original = local + offset), and its triangles. */
  positions: ArrayLike<number>;
  index: ArrayLike<number>;
  offset: Vec3;
  /** The triangles of the region (indices of triangles). */
  faces: ArrayLike<number>;
  /** Header comments, one line each (line breaks become spaces). */
  comments: readonly string[];
}

/** The triangles whose piece (`pieceOf`, one per triangle) is `piece`. */
export function* facesOfPieceSteps(pieceOf: ArrayLike<number>, piece: number): Steps<Uint32Array> {
  let n = 0;
  for (let t = 0; t < pieceOf.length; t++) {
    if (pieceOf[t] === piece) n++;
    if (t % YIELD_EVERY === 0) yield;
  }
  const out = new Uint32Array(n);
  let k = 0;
  for (let t = 0; t < pieceOf.length; t++) {
    if (pieceOf[t] === piece) out[k++] = t;
    if (t % YIELD_EVERY === 0) yield;
  }
  return out;
}

export function* regionPlySteps(input: RegionPlyInput): Steps<Uint8Array> {
  const { positions, index, offset, faces } = input;
  const vertexCount = positions.length / 3;
  // each vertex the region uses, numbered in the order its triangles first use it
  const newIndex = new Int32Array(vertexCount).fill(-1);
  const used = new Uint32Array(vertexCount);
  let n = 0;
  for (let k = 0; k < faces.length; k++) {
    const t = faces[k];
    for (let j = 0; j < 3; j++) {
      const v = index[3 * t + j];
      if (newIndex[v] < 0) {
        newIndex[v] = n;
        used[n++] = v;
      }
    }
    if (k % YIELD_EVERY === 0) yield;
  }
  const header =
    [
      'ply',
      'format binary_little_endian 1.0',
      ...input.comments.map((c) => `comment ${c.replace(/[\r\n]+/g, ' ')}`),
      `element vertex ${n}`,
      'property float x',
      'property float y',
      'property float z',
      `element face ${faces.length}`,
      'property list uchar int vertex_indices',
      'end_header',
    ].join('\n') + '\n';
  const head = new TextEncoder().encode(header);
  const out = new Uint8Array(head.length + 12 * n + 13 * faces.length);
  out.set(head, 0);
  const view = new DataView(out.buffer);
  let at = head.length;
  for (let i = 0; i < n; i++) {
    const v = used[i];
    view.setFloat32(at, positions[3 * v] + offset[0], true);
    view.setFloat32(at + 4, positions[3 * v + 1] + offset[1], true);
    view.setFloat32(at + 8, positions[3 * v + 2] + offset[2], true);
    at += 12;
    if (i % YIELD_EVERY === 0) yield;
  }
  for (let k = 0; k < faces.length; k++) {
    const t = faces[k];
    view.setUint8(at, 3);
    view.setInt32(at + 1, newIndex[index[3 * t]], true);
    view.setInt32(at + 5, newIndex[index[3 * t + 1]], true);
    view.setInt32(at + 9, newIndex[index[3 * t + 2]], true);
    at += 13;
    if (k % YIELD_EVERY === 0) yield;
  }
  return out;
}

export const regionPly = (input: RegionPlyInput): Uint8Array => runSync(regionPlySteps(input));

/** The header comments of a region's PLY: the program, the specimen, the region, the unit, the model it was cut from. */
export function regionPlyComments(o: { app: string; version: string; specimen: string; region: string; type: string; unit: string; file: string; sha256: string }): string[] {
  return [`${o.app} ${o.version}`, `specimen ${o.specimen}`, `region ${o.region} ${o.type}`, o.unit ? `unit ${o.unit}` : 'unit unspecified', `source ${o.file} sha256 ${o.sha256}`];
}

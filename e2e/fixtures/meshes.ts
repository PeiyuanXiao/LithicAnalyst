/**
 * Test models for the end-to-end tests, generated on the fly so that no scans
 * are committed. The "roof" is a grid surface with one sharp, meandering ridge:
 * a straight line between two points on the ridge cuts across the meander, so a
 * traced curve that stays on the ridge shows that snapping worked.
 */

export type Vec3 = [number, number, number];

/** Original coordinates sit far from the origin; the app must keep them as they are in the file. */
export const OFFSET: Vec3 = [1200, -350, 40];

export const ROOF = {
  xMin: -20,
  xMax: 20,
  yMin: 0,
  yMax: 50,
  step: 0.5,
  /** x of the ridge line at height y (local coordinates). */
  crest: (y: number): number => 6 * Math.sin(y / 8),
  /** Surface height at (x, y) (local coordinates). */
  height: (x: number, y: number): number => 10 - 0.9 * Math.abs(x - ROOF.crest(y)),
};

export const roofNx = Math.round((ROOF.xMax - ROOF.xMin) / ROOF.step);
export const roofNy = Math.round((ROOF.yMax - ROOF.yMin) / ROOF.step);
export const ROOF_VERTICES = (roofNx + 1) * (roofNy + 1);
export const ROOF_TRIANGLES = 2 * roofNx * roofNy;

/** Point on the roof above local (x, y), in original (file) coordinates. */
export function roofPoint(x: number, y: number): Vec3 {
  return [OFFSET[0] + x, OFFSET[1] + y, OFFSET[2] + ROOF.height(x, y)];
}

/** Horizontal distance of an original-coordinate point from the ridge line. */
export function offCrest(p: Vec3): number {
  const x = p[0] - OFFSET[0];
  const y = p[1] - OFFSET[1];
  return Math.abs(x - ROOF.crest(y));
}

export interface Mesh {
  positions: Float32Array;
  /** Triangles, counter-clockwise seen from +z (normals face up). */
  index: Uint32Array;
}

export function roofMesh(): Mesh {
  const positions = new Float32Array(ROOF_VERTICES * 3);
  let k = 0;
  for (let j = 0; j <= roofNy; j++)
    for (let i = 0; i <= roofNx; i++) {
      const [x, y, z] = roofPoint(ROOF.xMin + i * ROOF.step, ROOF.yMin + j * ROOF.step);
      positions[k++] = x;
      positions[k++] = y;
      positions[k++] = z;
    }
  const id = (i: number, j: number) => j * (roofNx + 1) + i;
  const index = new Uint32Array(ROOF_TRIANGLES * 3);
  k = 0;
  for (let j = 0; j < roofNy; j++)
    for (let i = 0; i < roofNx; i++) {
      index.set([id(i, j), id(i + 1, j), id(i + 1, j + 1)], k);
      index.set([id(i, j), id(i + 1, j + 1), id(i, j + 1)], k + 3);
      k += 6;
    }
  return { positions, index };
}

export function toBinaryPly(m: Mesh): Buffer {
  const nv = m.positions.length / 3;
  const nf = m.index.length / 3;
  const header =
    'ply\nformat binary_little_endian 1.0\ncomment LithicAnalyst e2e test model\n' +
    `element vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\n` +
    `element face ${nf}\nproperty list uchar int vertex_indices\nend_header\n`;
  const head = Buffer.from(header, 'ascii');
  const body = Buffer.alloc(nv * 12 + nf * 13);
  let o = 0;
  for (let i = 0; i < m.positions.length; i++, o += 4) body.writeFloatLE(m.positions[i], o);
  for (let f = 0; f < nf; f++) {
    body.writeUInt8(3, o++);
    for (let c = 0; c < 3; c++, o += 4) body.writeInt32LE(m.index[3 * f + c], o);
  }
  return Buffer.concat([head, body]);
}

export function toBinaryStl(m: Mesh): Buffer {
  const nf = m.index.length / 3;
  const buf = Buffer.alloc(84 + nf * 50);
  buf.write('LithicAnalyst e2e test model', 0, 'ascii');
  buf.writeUInt32LE(nf, 80);
  const p = (v: number, c: number) => m.positions[3 * v + c];
  let o = 84;
  for (let f = 0; f < nf; f++) {
    const [a, b, c] = [m.index[3 * f], m.index[3 * f + 1], m.index[3 * f + 2]];
    const u = [p(b, 0) - p(a, 0), p(b, 1) - p(a, 1), p(b, 2) - p(a, 2)];
    const w = [p(c, 0) - p(a, 0), p(c, 1) - p(a, 1), p(c, 2) - p(a, 2)];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    for (const x of n) buf.writeFloatLE(x / len, (o += 4) - 4);
    for (const v of [a, b, c]) for (let d = 0; d < 3; d++) buf.writeFloatLE(p(v, d), (o += 4) - 4);
    o += 2; // attribute byte count
  }
  return buf;
}

export function toObj(m: Mesh): Buffer {
  const lines = ['# LithicAnalyst e2e test model'];
  for (let i = 0; i < m.positions.length; i += 3) lines.push(`v ${m.positions[i]} ${m.positions[i + 1]} ${m.positions[i + 2]}`);
  for (let i = 0; i < m.index.length; i += 3) lines.push(`f ${m.index[i] + 1} ${m.index[i + 1] + 1} ${m.index[i + 2] + 1}`);
  return Buffer.from(lines.join('\n') + '\n', 'utf8');
}

export interface MeshFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export const roofPly = (): MeshFile => ({ name: 'roof.ply', mimeType: 'application/octet-stream', buffer: toBinaryPly(roofMesh()) });
export const roofStl = (): MeshFile => ({ name: 'roof.stl', mimeType: 'application/octet-stream', buffer: toBinaryStl(roofMesh()) });
export const roofObj = (): MeshFile => ({ name: 'roof.obj', mimeType: 'text/plain', buffer: toObj(roofMesh()) });

/** A closed box 40 × 20 × 10 (each face an 8 × 8 grid), centred away from the origin. */
export const BOX = { center: [500, 200, -50] as Vec3, size: [40, 20, 10] as Vec3, n: 8 };

/** Point given relative to the box centre, in original (file) coordinates. */
export const boxPoint = (x: number, y: number, z: number): Vec3 => [BOX.center[0] + x, BOX.center[1] + y, BOX.center[2] + z];

export function boxMesh(): Mesh {
  const [hx, hy, hz] = BOX.size.map((s) => s / 2);
  const n = BOX.n;
  // origin corner and two edge vectors per face, u × v pointing outward
  const faces: Array<[Vec3, Vec3, Vec3]> = [
    [[hx, -hy, -hz], [0, 2 * hy, 0], [0, 0, 2 * hz]],
    [[-hx, -hy, -hz], [0, 0, 2 * hz], [0, 2 * hy, 0]],
    [[-hx, hy, -hz], [0, 0, 2 * hz], [2 * hx, 0, 0]],
    [[-hx, -hy, -hz], [2 * hx, 0, 0], [0, 0, 2 * hz]],
    [[-hx, -hy, hz], [2 * hx, 0, 0], [0, 2 * hy, 0]],
    [[-hx, -hy, -hz], [0, 2 * hy, 0], [2 * hx, 0, 0]],
  ];
  const ids = new Map<string, number>();
  const pos: number[] = [];
  const vertex = (p: number[]): number => {
    const key = p.join(',');
    let i = ids.get(key);
    if (i === undefined) {
      i = pos.length / 3;
      ids.set(key, i);
      pos.push(...boxPoint(p[0], p[1], p[2]));
    }
    return i;
  };
  const index: number[] = [];
  for (const [o, u, v] of faces) {
    const at = (i: number, j: number) => vertex([0, 1, 2].map((k) => o[k] + (i / n) * u[k] + (j / n) * v[k]));
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) index.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
  }
  return { positions: new Float32Array(pos), index: new Uint32Array(index) };
}

export const boxPly = (): MeshFile => ({ name: 'box.ply', mimeType: 'application/octet-stream', buffer: toBinaryPly(boxMesh()) });

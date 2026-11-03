/**
 * Test models for the end-to-end tests, generated on the fly so that no scans
 * are committed. The "roof" is a grid surface with one sharp, meandering ridge:
 * a straight line between two points on the ridge cuts across the meander, so a
 * traced curve that stays on the ridge shows that snapping worked.
 */

import { bicone, ellipsoid, flakeT1, flakeT2, heightAt, steppedTool, T1 } from '../../tests/meshes';

export { heightAt, T1 };

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

export const boxMesh = (): Mesh => cuboidMesh(BOX.center, BOX.size, BOX.n);

/** A closed axis-aligned box of `size` around `center`, each face an n × n grid. */
function cuboidMesh(center: Vec3, size: Vec3, n: number): Mesh {
  const [hx, hy, hz] = size.map((s) => s / 2);
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
      pos.push(center[0] + p[0], center[1] + p[1], center[2] + p[2]);
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

export const t1Ply = (): MeshFile => ({ name: 't1.ply', mimeType: 'application/octet-stream', buffer: toBinaryPly(flakeT1()) });
export const t2Ply = (): MeshFile => ({ name: 't2.ply', mimeType: 'application/octet-stream', buffer: toBinaryPly(flakeT2()) });
/** T4: the bicone of the edge angles (edge radius 30, cones 8 and 5 high). */
export const T4 = { radius: 30, upper: 8, lower: 5 };
export const t4Ply = (): MeshFile => ({ name: 't4.ply', mimeType: 'application/octet-stream', buffer: toBinaryPly(bicone(T4.radius, T4.upper, T4.lower, 96, 8)) });
/** A tool with two tiers of retouch above a flat ventral face (edge radius 30; the tiers end at radius 24 and 12). */
export const toolPly = (): MeshFile => ({ name: 'tool.ply', mimeType: 'application/octet-stream', buffer: toBinaryPly(steppedTool()) });
/** The bicone of T4 with its cones three times as high on one half: an edge of two angles, about 24.4° and 65.2°. */
export function twoAnglePly(): MeshFile {
  const m = bicone(T4.radius, T4.upper, T4.lower, 240, 12);
  const p = m.positions;
  for (let i = 0; i < p.length; i += 3) if (p[i + 1] < -1e-6) p[i + 2] *= 3;
  return { name: 'two.ply', mimeType: 'application/octet-stream', buffer: toBinaryPly(m) };
}
export const t3Ply = (): MeshFile => ({ name: 't3.ply', mimeType: 'application/octet-stream', buffer: toBinaryPly(ellipsoid(40, 25, 8)) });

export const boxPly = (): MeshFile => ({ name: 'box.ply', mimeType: 'application/octet-stream', buffer: toBinaryPly(boxMesh()) });

/** A columnar core 36 × 60 × 24 (x × y × z), centred away from the origin: its principal axes are y, x, z. */
export const COLUMN = { center: [300, -100, 20] as Vec3, size: [36, 60, 24] as Vec3, n: 6 };

export const columnPoint = (x: number, y: number, z: number): Vec3 => [COLUMN.center[0] + x, COLUMN.center[1] + y, COLUMN.center[2] + z];

export const columnPly = (): MeshFile => ({ name: 'column.ply', mimeType: 'application/octet-stream', buffer: toBinaryPly(cuboidMesh(COLUMN.center, COLUMN.size, COLUMN.n)) });

/** An icosphere of radius 20 (1280 triangles), centred away from the origin: a whole nodule of cortex. */
export const SPHERE = { center: [-100, 50, 30] as Vec3, radius: 20 };

export function sphereMesh(subdivisions = 3): Mesh {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts: Vec3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const unit = (p: Vec3): Vec3 => {
    const l = Math.hypot(...p);
    return [p[0] / l, p[1] / l, p[2] / l];
  };
  verts = verts.map(unit);
  for (let s = 0; s < subdivisions; s++) {
    const mid = new Map<string, number>();
    const m = (a: number, b: number) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let i = mid.get(key);
      if (i === undefined) {
        i = verts.length;
        verts.push(unit([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2]));
        mid.set(key, i);
      }
      return i;
    };
    faces = faces.flatMap(([a, b, c]) => {
      const ab = m(a, b), bc = m(b, c), ca = m(c, a);
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
    });
  }
  const positions = new Float32Array(verts.flatMap((p) => p.map((x, k) => SPHERE.center[k] + SPHERE.radius * x)));
  return { positions, index: new Uint32Array(faces.flat()) };
}

export const spherePly = (): MeshFile => ({ name: 'nodule.ply', mimeType: 'application/octet-stream', buffer: toBinaryPly(sphereMesh()) });

/**
 * A discoid core as two cones base to base, axis along z, away from the origin:
 * the rim (radius 30) at the centre's height, the apexes 10 above and 20 below.
 * Every ring has its vertices at the same angles. `open` leaves out the lower
 * apex's triangles (a mesh with a hole).
 */
export const BICONE = { center: [80, -40, 15] as Vec3, radius: 30, upper: 10, lower: 20, segments: 96, rings: 6 };

/** On the bicone at angle `deg` round the axis (0° along +x), `rho` of the radius out from it, on the upper or lower cone. */
export const biconePoint = (deg: number, rho: number, upper = true): Vec3 => {
  const t = (deg * Math.PI) / 180;
  const h = upper ? BICONE.upper : -BICONE.lower;
  return [BICONE.center[0] + rho * BICONE.radius * Math.cos(t), BICONE.center[1] + rho * BICONE.radius * Math.sin(t), BICONE.center[2] + h * (1 - rho)];
};

export function biconeMesh(open = false): Mesh {
  const { segments: n, rings } = BICONE;
  const pos: number[] = [...biconePoint(0, 0, true)];
  const ring = (rho: number, upper: boolean) => {
    const start = pos.length / 3;
    for (let j = 0; j < n; j++) pos.push(...biconePoint((360 * j) / n, rho, upper));
    return start;
  };
  const bands: number[] = [];
  for (let k = 1; k <= rings; k++) bands.push(ring(k / rings, true));
  for (let k = rings - 1; k >= 1; k--) bands.push(ring(k / rings, false));
  const bottom = pos.length / 3;
  pos.push(...biconePoint(0, 0, false));
  const idx: number[] = [];
  const next = (j: number) => (j + 1) % n;
  for (let j = 0; j < n; j++) idx.push(0, bands[0] + j, bands[0] + next(j));
  for (let b = 0; b + 1 < bands.length; b++)
    for (let j = 0; j < n; j++) {
      const a0 = bands[b] + j, a1 = bands[b] + next(j), b0 = bands[b + 1] + j, b1 = bands[b + 1] + next(j);
      idx.push(a0, b0, b1, a0, b1, a1);
    }
  const last = bands[bands.length - 1];
  if (!open) for (let j = 0; j < n; j++) idx.push(bottom, last + next(j), last + j);
  return { positions: new Float32Array(pos), index: new Uint32Array(idx) };
}

export const biconePly = (open = false): MeshFile => ({ name: open ? 'bicone-open.ply' : 'bicone.ply', mimeType: 'application/octet-stream', buffer: toBinaryPly(biconeMesh(open)) });

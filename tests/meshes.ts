import { weldExact } from '../src/compute/weld';
import type { Vec3 } from '../src/core/types';

/** Test meshes generated in code (no scans in the repository). */

export interface Mesh {
  positions: Float32Array;
  index: Uint32Array;
}

export type Face = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

/** Axis-aligned box centred at the origin, each face an n×n grid, triangles facing outward. */
export function box(size: Vec3, n: number, omit: Face[] = []): Mesh {
  const [hx, hy, hz] = size.map((s) => s / 2);
  const faces: Record<Face, [Vec3, Vec3, Vec3]> = {
    '+x': [[hx, -hy, -hz], [0, 2 * hy, 0], [0, 0, 2 * hz]],
    '-x': [[-hx, -hy, -hz], [0, 0, 2 * hz], [0, 2 * hy, 0]],
    '+y': [[-hx, hy, -hz], [0, 0, 2 * hz], [2 * hx, 0, 0]],
    '-y': [[-hx, -hy, -hz], [2 * hx, 0, 0], [0, 0, 2 * hz]],
    '+z': [[-hx, -hy, hz], [2 * hx, 0, 0], [0, 2 * hy, 0]],
    '-z': [[-hx, -hy, -hz], [0, 2 * hy, 0], [2 * hx, 0, 0]],
  };
  const soup: number[] = [];
  for (const [name, [o, u, v]] of Object.entries(faces) as Array<[Face, [Vec3, Vec3, Vec3]]>) {
    if (omit.includes(name)) continue;
    const p = (i: number, j: number) => [0, 1, 2].map((k) => o[k] + (i / n) * u[k] + (j / n) * v[k]);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) soup.push(...p(i, j), ...p(i + 1, j), ...p(i + 1, j + 1), ...p(i, j), ...p(i + 1, j + 1), ...p(i, j + 1));
  }
  return weldExact(new Float32Array(soup));
}

/** Icosphere of radius r (outward triangles). */
export function sphere(r: number, subdivisions: number): Mesh {
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
  return { positions: new Float32Array(verts.flatMap((p) => p.map((x) => x * r))), index: new Uint32Array(faces.flat()) };
}

export function merge(...meshes: Mesh[]): Mesh {
  const positions: number[] = [];
  const index: number[] = [];
  for (const m of meshes) {
    const base = positions.length / 3;
    positions.push(...m.positions);
    index.push(...Array.from(m.index, (i) => i + base));
  }
  return { positions: new Float32Array(positions), index: new Uint32Array(index) };
}

export const moved = (m: Mesh, d: Vec3): Mesh => ({ positions: m.positions.map((x, i) => x + d[i % 3]), index: m.index });

/**
 * Two cones base to base, the rim (radius r) at z = 0 and the apexes at z = up
 * and z = −down: `segments` vertices round every ring (all at the same angles),
 * `rings` bands from each apex to the rim. Triangles outward. `rim` is the index
 * of the rim's first vertex (the rest follow round the ring).
 */
export function bicone(r: number, up: number, down: number, segments: number, rings: number): Mesh & { rim: number } {
  const pos: number[] = [0, 0, up];
  const ring = (rad: number, z: number) => {
    const start = pos.length / 3;
    for (let j = 0; j < segments; j++) pos.push(rad * Math.cos((2 * Math.PI * j) / segments), rad * Math.sin((2 * Math.PI * j) / segments), z);
    return start;
  };
  const bands: number[] = [];
  for (let k = 1; k <= rings; k++) bands.push(ring((r * k) / rings, up * (1 - k / rings)));
  const rim = bands[bands.length - 1];
  for (let k = rings - 1; k >= 1; k--) bands.push(ring((r * k) / rings, -down * (1 - k / rings)));
  const bottom = pos.length / 3;
  pos.push(0, 0, -down);
  const idx: number[] = [];
  const next = (j: number) => (j + 1) % segments;
  for (let j = 0; j < segments; j++) idx.push(0, bands[0] + j, bands[0] + next(j));
  for (let b = 0; b + 1 < bands.length; b++)
    for (let j = 0; j < segments; j++) {
      const a0 = bands[b] + j, a1 = bands[b] + next(j), b0 = bands[b + 1] + j, b1 = bands[b + 1] + next(j);
      idx.push(a0, b0, b1, a0, b1, a1);
    }
  const last = bands[bands.length - 1];
  for (let j = 0; j < segments; j++) idx.push(bottom, last + next(j), last + j);
  return { positions: new Float32Array(pos), index: new Uint32Array(idx), rim };
}

/** The mesh as a binary PLY file (little endian, float positions, triangle faces). */
export function plyBytes(m: Mesh): Uint8Array {
  const nv = m.positions.length / 3, nf = m.index.length / 3;
  const head = new TextEncoder().encode(
    `ply\nformat binary_little_endian 1.0\nelement vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\nelement face ${nf}\nproperty list uchar int vertex_indices\nend_header\n`,
  );
  const out = new Uint8Array(head.length + nv * 12 + nf * 13);
  out.set(head);
  const v = new DataView(out.buffer);
  let o = head.length;
  for (let i = 0; i < m.positions.length; i++, o += 4) v.setFloat32(o, m.positions[i], true);
  for (let f = 0; f < nf; f++) {
    v.setUint8(o++, 3);
    for (let c = 0; c < 3; c++, o += 4) v.setInt32(o, m.index[3 * f + c], true);
  }
  return out;
}

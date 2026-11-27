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

/** A rotation by `deg` about `axis` and a translation applied to points. */
export function rigid(axis: Vec3, deg: number, t: Vec3): (p: Vec3) => Vec3 {
  const l = Math.hypot(...axis);
  const [x, y, z] = axis.map((a) => a / l);
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180), q = 1 - c;
  const R = [
    [c + x * x * q, x * y * q - z * s, x * z * q + y * s],
    [y * x * q + z * s, c + y * y * q, y * z * q - x * s],
    [z * x * q - y * s, z * y * q + x * s, c + z * z * q],
  ];
  return (p) => [0, 1, 2].map((i) => R[i][0] * p[0] + R[i][1] * p[1] + R[i][2] * p[2] + t[i]) as Vec3;
}

/** The mesh with every vertex moved by `f`. */
export function mapped(m: Mesh, f: (p: Vec3) => Vec3): Mesh {
  const positions = new Float32Array(m.positions.length);
  for (let i = 0; i < m.positions.length; i += 3) positions.set(f([m.positions[i], m.positions[i + 1], m.positions[i + 2]]), i);
  return { positions, index: m.index };
}

/**
 * A closed profile (y, z, counter-clockwise, star-shaped from its centroid) extruded along X: bands
 * `dx` wide across the sides, each end a fan from the profile's centre. Triangles outward.
 */
export function extrudedProfile(profile: Array<[number, number]>, halfWidth: number, dx: number): Mesh {
  const n = profile.length;
  const steps = Math.round((2 * halfWidth) / dx);
  const pos: number[] = [];
  for (let j = 0; j <= steps; j++) for (const [y, z] of profile) pos.push(-halfWidth + (j * 2 * halfWidth) / steps, y, z);
  const id = (i: number, j: number) => j * n + (i % n);
  const idx: number[] = [];
  for (let j = 0; j < steps; j++)
    for (let i = 0; i < n; i++) idx.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
  const cy = profile.reduce((s, p) => s + p[0], 0) / n, cz = profile.reduce((s, p) => s + p[1], 0) / n;
  const lo = pos.length / 3;
  pos.push(-halfWidth, cy, cz);
  const hi = pos.length / 3;
  pos.push(halfWidth, cy, cz);
  for (let i = 0; i < n; i++) {
    idx.push(lo, id(i + 1, 0), id(i, 0));
    idx.push(hi, id(i, steps), id(i + 1, steps));
  }
  return { positions: new Float32Array(pos), index: new Uint32Array(idx) };
}

/** T1, the triangular prism flake: profile P(0, 0), D(60, 0), E(−2, 10) in (y, z), x in [−15, 15]. */
export const T1 = { P: [0, 0, 0] as Vec3, E: [0, -2, 10] as Vec3, D: [0, 60, 0] as Vec3, A: [0, 40, 0] as Vec3, ends: [[-15, 0, 0], [15, 0, 0]] as Vec3[], halfWidth: 15 };

export const flakeT1 = (ds = 1): Mesh => extrudedProfile(t1Profile(ds), T1.halfWidth, 1);

function t1Profile(ds: number): Array<[number, number]> {
  const line = (a: [number, number], b: [number, number], step: number): Array<[number, number]> => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    return Array.from({ length: n }, (_, k): [number, number] => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  };
  // the platform finer than the rest: the section has points enough on it
  return [...line([0, 0], [60, 0], ds), ...line([60, 0], [-2, 10], ds), ...line([-2, 10], [0, 0], ds / 2)];
}

/** T2: T1 with a bulb (below the ventral face, y in [0, 12]) and the distal end curving toward the dorsal side (y in [51, 60]; the whole end, so the two faces do not cross). */
export function flakeT2(ds = 1): Mesh {
  const bump = (y: number, a: number, b: number) => (y <= a || y >= b ? 0 : Math.sin((Math.PI * (y - a)) / (b - a)) ** 2);
  const curl = (y: number) => (y <= 51 ? 0 : 2 * ((y - 51) / 9) ** 2);
  const prof = t1Profile(ds).map(([y, z]): [number, number] => {
    const ventral = z === 0;
    return [y, z + curl(y) - (ventral ? 1.5 * bump(y, 0, 12) : 0)];
  });
  return extrudedProfile(prof, T1.halfWidth, 1);
}

/** T3: an ellipsoid with semi-axes (a, b, c), its poles on X; rows and columns even, so the axes' ends are vertices. */
export function ellipsoid(a: number, b: number, c: number, rows = 96, cols = 128): Mesh {
  const pos: number[] = [-a, 0, 0];
  for (let i = 1; i < rows; i++) {
    const t = (Math.PI * i) / rows;
    for (let j = 0; j < cols; j++) {
      const f = (2 * Math.PI * j) / cols;
      pos.push(-a * Math.cos(t), b * Math.sin(t) * Math.cos(f), c * Math.sin(t) * Math.sin(f));
    }
  }
  const last = pos.length / 3;
  pos.push(a, 0, 0);
  const id = (i: number, j: number) => 1 + (i - 1) * cols + (j % cols);
  const idx: number[] = [];
  for (let j = 0; j < cols; j++) {
    idx.push(0, id(1, j), id(1, j + 1));
    idx.push(last, id(rows - 1, j + 1), id(rows - 1, j));
  }
  for (let i = 1; i < rows - 1; i++)
    for (let j = 0; j < cols; j++) idx.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
  return { positions: new Float32Array(pos), index: new Uint32Array(idx) };
}

/** T5: a piece of a cylinder (radius r, axis Z, `deg` degrees round, height h); `nt` columns, `nz` rows (even: a row at mid-height). */
export function cylinderPatch(r: number, deg: number, h: number, nt = 32, nz = 8): Mesh {
  const pos: number[] = [];
  for (let k = 0; k <= nz; k++)
    for (let j = 0; j <= nt; j++) {
      const f = (((deg * j) / nt) * Math.PI) / 180;
      pos.push(r * Math.cos(f), r * Math.sin(f), (h * k) / nz);
    }
  const id = (j: number, k: number) => k * (nt + 1) + j;
  const idx: number[] = [];
  for (let k = 0; k < nz; k++) for (let j = 0; j < nt; j++) idx.push(id(j, k), id(j + 1, k), id(j + 1, k + 1), id(j, k), id(j + 1, k + 1), id(j, k + 1));
  return { positions: new Float32Array(pos), index: new Uint32Array(idx) };
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

/** The profile of a tool with two tiers of retouch above a flat ventral face: (r, z) from the edge inward. */
const TIER_1 = [30, 24] as const, TIER_2 = [24, 12] as const;
export const heightAt = (r: number): number => (r >= 24 ? 30 - r : r >= 12 ? 6 + (24 - r) / 6 : 8 + (12 - r) / 24);
export const SEGMENTS = 240;

/** Rings of vertices on it, so that the tiers' borders lie along mesh edges; the rings' first vertices by radius. */
export function steppedTool(): Mesh & { ringAt: (r: number, up: boolean) => number } {
  const up: number[] = [];
  for (let r = TIER_1[0]; r > TIER_1[1] + 1e-9; r -= 0.6) up.push(r);
  for (let r = TIER_2[0]; r > TIER_2[1] + 1e-9; r -= 0.8) up.push(r);
  for (let r = 12; r > 0.5; r -= 1.5) up.push(r);
  const down: number[] = [];
  for (let r = 30 - 0.8; r > 0.5; r -= 0.8) down.push(r);
  const rings = [...up.map((r) => [r, heightAt(r)]), ...down.reverse().reverse().map((r) => [r, 0])];
  const pos: number[] = [0, 0, heightAt(0)];
  const starts: number[] = [];
  for (const [r, z] of rings) {
    starts.push(pos.length / 3);
    for (let j = 0; j < SEGMENTS; j++) pos.push(r * Math.cos((2 * Math.PI * j) / SEGMENTS), r * Math.sin((2 * Math.PI * j) / SEGMENTS), z);
  }
  const bottom = pos.length / 3;
  pos.push(0, 0, 0);
  const idx: number[] = [];
  const nx = (j: number) => (j + 1) % SEGMENTS;
  // the upper rings run from the edge inward, as do the lower ones
  const upper = starts.slice(0, up.length), lower = starts.slice(up.length);
  for (let j = 0; j < SEGMENTS; j++) idx.push(0, upper[upper.length - 1] + j, upper[upper.length - 1] + nx(j));
  for (let b = 0; b + 1 < upper.length; b++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const a0 = upper[b] + j, a1 = upper[b] + nx(j), b0 = upper[b + 1] + j, b1 = upper[b + 1] + nx(j);
      idx.push(a0, a1, b1, a0, b1, b0);
    }
  }
  const ventral = [upper[0], ...lower];
  for (let b = 0; b + 1 < ventral.length; b++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const a0 = ventral[b] + j, a1 = ventral[b] + nx(j), b0 = ventral[b + 1] + j, b1 = ventral[b + 1] + nx(j);
      idx.push(a0, b1, a1, a0, b0, b1);
    }
  }
  const last = ventral[ventral.length - 1];
  for (let j = 0; j < SEGMENTS; j++) idx.push(bottom, last + nx(j), last + j);
  const ringAt = (r: number, above: boolean): number => {
    const list = above ? up : [30, ...down];
    const firsts = above ? upper : ventral;
    const i = list.findIndex((x) => Math.abs(x - r) < 1e-6);
    if (i < 0) throw new Error(`no ring at ${r}`);
    return firsts[i];
  };
  return { positions: new Float32Array(pos), index: new Uint32Array(idx), ringAt };
}

const tan = (deg: number) => Math.tan((deg * Math.PI) / 180);

/** The sections of T7: the sides of each polygon in (x, z), each with its name, clockwise (the normals of the extrusion then face outward). */
const RETOUCH_PRISMS = {
  unifacial: { A: [4, 0], R: [8, 8 * tan(30)], C: [20, 20 * tan(30)], F: [40, 0] },
  bifacial: { A: [4, 0], R: [8, 8 * tan(20)], C: [20, 20 * tan(20)], F: [40, 0], Cv: [20, -20 * tan(20)], Rv: [8, -8 * tan(20)] },
  flat: { A: [4, 0], R: [8, 8 * tan(30)], C: [30, 8 * tan(30)], F: [40, 0] },
  inverse: { A: [4, 0], C: [20, 12], F: [40, -2], Rv: [8, -2] },
} as const;

export type RetouchPrismKind = keyof typeof RETOUCH_PRISMS;

/**
 * T7, the retouch prism: a polygon in (x, z) extruded along y from 0 to 40, its sides in pieces of at most 0.5 mm with the corners among the
 * vertices, 0.5 mm steps along y, each end a fan from the polygon's centre. Closed, triangles outward. `side`: the polygon's side
 * each triangle lies on, by its two corners (`AR`, `RC`, …), null for the ends.
 */
export function retouchPrism(kind: RetouchPrismKind): Mesh & { side: Array<string | null> } {
  const corners = Object.entries(RETOUCH_PRISMS[kind]) as Array<[string, readonly [number, number]]>;
  const ring: Array<[number, number]> = [];
  const ofRing: string[] = [];
  corners.forEach(([name, a], i) => {
    const [next, b] = corners[(i + 1) % corners.length];
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5 - 1e-9);
    for (let k = 0; k < n; k++) {
      ring.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      ofRing.push(name + next);
    }
  });
  const m = ring.length;
  const steps = 80;
  const pos: number[] = [];
  for (let j = 0; j <= steps; j++) for (const [x, z] of ring) pos.push(x, (40 * j) / steps, z);
  const id = (i: number, j: number) => j * m + (i % m);
  const index: number[] = [];
  const side: Array<string | null> = [];
  for (let j = 0; j < steps; j++)
    for (let i = 0; i < m; i++) {
      index.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
      side.push(ofRing[i], ofRing[i]);
    }
  const cx = ring.reduce((s, p) => s + p[0], 0) / m, cz = ring.reduce((s, p) => s + p[1], 0) / m;
  const lo = pos.length / 3;
  pos.push(cx, 0, cz);
  const hi = pos.length / 3;
  pos.push(cx, 40, cz);
  for (let i = 0; i < m; i++) {
    index.push(lo, id(i + 1, 0), id(i, 0), hi, id(i, steps), id(i + 1, steps));
    side.push(null, null);
  }
  return { positions: new Float32Array(pos), index: new Uint32Array(index), side };
}

export const T6 = { L: 58, w0: 11, wmax: 21, ny: 90, ns: 48 };

const t6Width = (y: number): number => {
  const t = y / T6.L;
  if (t <= 0.55) return T6.w0 + (T6.wmax - T6.w0) * Math.sin((Math.PI / 2) * (t / 0.55));
  const u = (t - 0.55) / 0.45;
  return T6.wmax * (0.35 + 0.65 * Math.sqrt(Math.max(0, 1 - u * u)));
};
/** Ventral height: gently concave lengthwise, a bulb near the platform. */
export const t6Zv = (x: number, y: number): number => 0.002 * (y - 29) ** 2 - 1.6 * Math.exp(-((y - 4) ** 2 / 18 + (x * x) / 40));
const t6H = (y: number): number => 9 * (1 - (y / T6.L) ** 2) * (0.75 + 0.25 * Math.sin((Math.PI * y) / T6.L));
/** How far the dorsal side is set back near the platform (the platform leans back). */
const t6Back = (s: number, y: number): number => 2 * (1 - s * s) * Math.max(0, 1 - y / 8);

/** s ∈ [−1, 1] across, y ∈ [0, L] along. */
export const t6Ventral = (s: number, y: number): Vec3 => {
  const x = s * t6Width(y);
  return [x, y, t6Zv(x, y)];
};
export const t6Dorsal = (s: number, y: number): Vec3 => {
  const x = s * t6Width(y);
  return [x, y - t6Back(s, y), t6Zv(x, y) + t6H(y) * (1 - Math.abs(s))];
};

/** T6: a flake of realistic shape; `K` rows of triangles over the platform. */
export function flakeT6(K = 14): Mesh {
  const { ny, ns, L } = T6;
  const pos: number[] = [];
  const V: number[][] = [];
  const D: number[][] = [];
  const add = (p: Vec3) => (pos.push(...p), pos.length / 3 - 1);
  for (let i = 0; i <= ny; i++) {
    const y = (L * i) / ny;
    V.push([]);
    D.push([]);
    for (let j = 0; j <= ns; j++) V[i][j] = add(t6Ventral(-1 + (2 * j) / ns, y));
    for (let j = 0; j <= ns; j++) D[i][j] = j === 0 || j === ns || i === ny ? V[i][j] : add(t6Dorsal(-1 + (2 * j) / ns, y));
  }
  const tris: number[] = [];
  const P = (k: number): Vec3 => [pos[3 * k], pos[3 * k + 1], pos[3 * k + 2]];
  // a triangle, turned so that its normal passes `out`
  const tri = (a: number, b: number, c: number, out: (n: Vec3) => boolean) => {
    if (a === b || b === c || a === c) return;
    const A = P(a), B = P(b), C = P(c);
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (out(n)) tris.push(a, b, c);
    else tris.push(a, c, b);
  };
  for (let i = 0; i < ny; i++)
    for (let j = 0; j < ns; j++) {
      tri(V[i][j], V[i][j + 1], V[i + 1][j + 1], (n) => n[2] < 0);
      tri(V[i][j], V[i + 1][j + 1], V[i + 1][j], (n) => n[2] < 0);
      tri(D[i][j], D[i][j + 1], D[i + 1][j + 1], (n) => n[2] > 0);
      tri(D[i][j], D[i + 1][j + 1], D[i + 1][j], (n) => n[2] > 0);
    }
  // the platform: K rows between the ventral and dorsal rows at y = 0, facing −y
  const rows: number[][] = [V[0]];
  for (let k = 1; k < K; k++) {
    const t = k / K;
    rows.push(V[0].map((v, j) => {
      if (j === 0 || j === ns) return v;
      const a = P(v), b = P(D[0][j]);
      return add([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]);
    }));
  }
  rows.push(D[0]);
  for (let k = 0; k < K; k++)
    for (let j = 0; j < ns; j++) {
      tri(rows[k][j], rows[k][j + 1], rows[k + 1][j + 1], (n) => n[1] < 0);
      tri(rows[k][j], rows[k + 1][j + 1], rows[k + 1][j], (n) => n[1] < 0);
    }
  // at the two distal corners a ventral and a dorsal triangle share all three vertices: drop both
  const seen = new Map<string, number[]>();
  for (let f = 0; f < tris.length; f += 3) {
    const key = [tris[f], tris[f + 1], tris[f + 2]].sort((a, b) => a - b).join(',');
    seen.set(key, [...(seen.get(key) ?? []), f]);
  }
  const drop = new Set<number>();
  for (const fs of seen.values()) if (fs.length === 2) fs.forEach((f) => drop.add(f));
  const kept: number[] = [];
  for (let f = 0; f < tris.length; f += 3) if (!drop.has(f)) kept.push(tris[f], tris[f + 1], tris[f + 2]);
  return { positions: new Float32Array(pos), index: new Uint32Array(kept) };
}

// ------------------------------------------------------------ T8, the bulb

/**
 * T8: a flake whose ventral face carries a bulb of percussion of known shape. Coordinates are the technological frame's: P at the origin,
 * +Y distal, +Z dorsal. The ventral face is the half disc y ≥ 0 of radius R, at z = −b(r, φ) (φ from +Y toward +X, degrees): flat
 * but for a fan from P, |φ| ≤ φ2, whose height along it rises from P and falls to nothing at Rb, its sides narrow smooth bands
 * (φ1 to φ2), a little lower toward them so that its top is on φ = 0. The platform is the plane y = 0, from the ventral edge up to the
 * dorsal dome z = D (1 − r²/R²), which meets the ventral face at r = R. Closed, triangles outward.
 */
export const T8 = { R: 20, D: 8, a0: 0.6, r0: 2, Rb: 12, phi1: 31, phi2: 35, toward: 0.2 };

/** The bulb's height over the flat ventral face at (r, φ), outward (−z). */
export function t8Bulb(r: number, phiDeg: number): number {
  const { a0, r0, Rb, phi1, phi2, toward } = T8;
  if (r >= Rb) return 0;
  const a = Math.abs(phiDeg);
  const side = a <= phi1 ? 1 : a >= phi2 ? 0 : 0.5 * (1 + Math.cos((Math.PI * (a - phi1)) / (phi2 - phi1)));
  return a0 * (r / r0) * Math.exp(1 - r / r0) * (1 - (r / Rb) ** 2) ** 2 * side * (1 - toward * (phiDeg / phi2) ** 2);
}

/** The dorsal dome's height at radius r. */
export const t8Dorsal = (r: number): number => T8.D * (1 - (r / T8.R) ** 2);

/** The radii of T8's rings (P is at 0): fine near P, coarser outward; the last is R. */
export function t8Rings(fine: boolean): number[] {
  const out: number[] = [];
  const run = (to: number, step: number) => {
    let r = out.length ? out[out.length - 1] : 0;
    while (r + step <= to + 1e-9) {
      r = Math.round((r + step) * 1e6) / 1e6;
      out.push(r);
    }
  };
  run(4, fine ? 0.05 : 0.2);
  run(T8.Rb, fine ? 0.2 : 0.5);
  run(T8.R, fine ? 0.5 : 1);
  return out;
}

/**
 * T8 as a mesh: `fine` for the unit tests, else coarse enough for the end-to-end tests. `arcs` steps of the half circle (an odd number,
 * so the section through P along +Y runs between the rays), `rows` rows up the platform. The ventral, platform and dorsal triangles are
 * listed apart.
 */
/** The steps of T8's half circle (an odd number), fine or coarse. */
export const t8Arcs = (fine: boolean): number => (fine ? 241 : 145);

/**
 * T8's variants for IPA's band (32a), on the ventral face between the bulb and 0.75 of the technological length (y = 15):
 * `retouch`, a patch (`T8_RETOUCH`) slanted up toward the dorsal face along +Y, by `rise` at its far side and back down beyond it, its
 * sides eased in over 1 mm; `ripple`, a small wave over the face beyond y = 8 and a few sharp bumps outward (`T8_SPIKES`).
 */
export const T8_RETOUCH = { x0: -10, x1: 10, y0: 11, y1: 15, rise: 0.4 };
export const T8_RIPPLE = { amplitude: 0.02, wavelength: 2, from: 8 };
export const T8_SPIKES: Array<[number, number]> = [[-6, 9], [5, 10.5], [-3, 13], [8, 13.5]];
const T8_SPIKE = { height: 0.6, sigma: 0.25 };

/**
 * T8's variants for the proximal measures' robustness (32b): `bend`, the ventral face bent and twisted away from the dorsal face beyond
 * y = 10 (outside the BSA's reach of P, so the plane there stays z = 0), eased to nothing at the sharp edge; `flat`, no bulb;
 * `noise`, a relief of that amplitude (mm) at every vertex, the same each time; `platformHalfWidth`, the platform region only as far as
 * that either side of the axis; `open`, a lip `T8_LIP` high along the platform's edge (y up to `T8_LIP.width`, eased out over half a mm),
 * joined to the bulb near P: the bulb at its level runs out to the edge far from P, not closed at the sides.
 */
export const T8_LIP = { height: 0.15, width: 0.6 };
export const T8_BEND = { from: 10, bend: 0.12, twist: 0.04 };

/** A number in [0, 1) that comes the same for the same point. */
const hash01 = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export interface T8Variant {
  retouch?: boolean;
  ripple?: boolean;
  bend?: boolean;
  flat?: boolean;
  noise?: number;
  platformHalfWidth?: number;
  open?: boolean;
}

/** What a variant adds to the ventral face's z at (x, y) (+z: toward the dorsal face). */
export function t8Extra(x: number, y: number, o: T8Variant): number {
  let z = 0;
  if (o.bend) {
    const { from, bend, twist } = T8_BEND;
    const d = Math.max(0, y - from);
    z -= (bend * d * d + twist * x * d) * Math.max(0, 1 - (x * x + y * y) / (T8.R * T8.R));
  }
  if (o.noise) z += o.noise * (2 * hash01(x, y) - 1);
  if (o.open) z -= T8_LIP.height * (1 - ease((y - T8_LIP.width) / 0.5));
  if (o.retouch) {
    const { x0, x1, y0, y1, rise } = T8_RETOUCH;
    const along = y <= y0 ? 0 : y <= y1 ? (y - y0) / (y1 - y0) : Math.max(0, 1 - (y - y1));
    const across = Math.min(ease(x - x0 + 1), ease(x1 + 1 - x));
    z += rise * along * across;
  }
  if (o.ripple) {
    const { amplitude, wavelength, from } = T8_RIPPLE;
    z += amplitude * ease(y - (from - 1)) * Math.sin((2 * Math.PI * x) / wavelength) * Math.sin((2 * Math.PI * y) / wavelength);
    for (const [sx, sy] of T8_SPIKES) z -= T8_SPIKE.height * Math.exp(-((x - sx) ** 2 + (y - sy) ** 2) / (2 * T8_SPIKE.sigma ** 2));
  }
  return z;
}

/** Whether a point is in T8's retouch patch (its eased sides and its far slope down included). */
export const inT8Retouch = (x: number, y: number): boolean => x >= T8_RETOUCH.x0 - 1 && x <= T8_RETOUCH.x1 + 1 && y >= T8_RETOUCH.y0 && y <= T8_RETOUCH.y1 + 1;

export function flakeT8(fine = true, dense: { step: number; arcs: number } | null = null, variant: T8Variant = {}): Mesh & { ventral: Uint32Array; platform: Uint32Array; dorsal: Uint32Array; retouch: Uint32Array } {
  // `dense` (the bench): rings `step` apart all the way out, `arcs` steps of the half circle
  const rings = dense ? Array.from({ length: Math.round(T8.R / dense.step) }, (_, i) => Math.round((i + 1) * dense.step * 1e6) / 1e6) : t8Rings(fine);
  const arcs = dense ? dense.arcs : t8Arcs(fine);
  const rows = fine ? 40 : 24;
  const N = rings.length;
  const pos: number[] = [];
  const add = (p: Vec3): number => {
    pos.push(p[0], p[1], p[2]);
    return pos.length / 3 - 1;
  };
  const phiOf = (j: number) => -90 + (180 * j) / arcs;
  /** A point at radius r and the j-th angle, its height h; on the two rays along y = 0 exactly so. */
  const at = (r: number, j: number, h: number): Vec3 => {
    if (j === 0) return [-r, 0, h];
    if (j === arcs) return [r, 0, h];
    const f = (phiOf(j) * Math.PI) / 180;
    return [r * Math.sin(f), r * Math.cos(f), h];
  };
  const P = add([0, 0, 0]);
  const ventralAt = (r: number, j: number): Vec3 => {
    const p = at(r, j, 0);
    return [p[0], p[1], -(variant.flat ? 0 : t8Bulb(r, phiOf(j))) + t8Extra(p[0], p[1], variant)];
  };
  // (the last ring is the sharp edge, shared with the dorsal face: the variants keep off it)
  const V: number[][] = rings.map((r) => Array.from({ length: arcs + 1 }, (_, j) => add(ventralAt(r, j))));
  const E = add([0, 0, T8.D]);
  // the dorsal rings but the last, which is the ventral one (the sharp edge)
  const D: number[][] = rings.map((r, i) => (i === N - 1 ? V[N - 1] : Array.from({ length: arcs + 1 }, (_, j) => add(at(r, j, t8Dorsal(r))))));
  const tris: number[] = [];
  const parts: Array<'ventral' | 'platform' | 'dorsal'> = [];
  const vtx = (v: number): Vec3 => [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]];
  const tri = (a: number, b: number, c: number, part: 'ventral' | 'platform' | 'dorsal', out: Vec3) => {
    if (a === b || b === c || c === a) return;
    const A = vtx(a), B = vtx(b), C = vtx(c);
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] >= 0) tris.push(a, b, c);
    else tris.push(a, c, b);
    parts.push(part);
  };
  // the ventral face (outward −z) and the dorsal face (+z): a fan round the centre, then the rings
  for (const [centre, grid, part, out] of [[P, V, 'ventral', [0, 0, -1]], [E, D, 'dorsal', [0, 0, 1]]] as const) {
    for (let j = 0; j < arcs; j++) tri(centre, grid[0][j], grid[0][j + 1], part, out as Vec3);
    for (let i = 0; i + 1 < N; i++)
      for (let j = 0; j < arcs; j++) {
        tri(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], part, out as Vec3);
        tri(grid[i][j], grid[i + 1][j + 1], grid[i][j + 1], part, out as Vec3);
      }
  }
  // the platform, in the plane y = 0 (outward −y): columns at the rings' x, `rows` rows each, the last one at the sharp edge a point
  const column = (c: number): number[] => {
    const i = Math.abs(c) - 1;
    if (c === 0) return [P, ...Array.from({ length: rows - 1 }, (_, k) => add([0, 0, (T8.D * (k + 1)) / rows])), E];
    const j = c < 0 ? 0 : arcs;
    if (i === N - 1) return [V[i][j]];
    const x = c < 0 ? -rings[i] : rings[i];
    return [V[i][j], ...Array.from({ length: rows - 1 }, (_, k) => add([x, 0, (t8Dorsal(rings[i]) * (k + 1)) / rows])), D[i][j]];
  };
  const columns = new Map<number, number[]>();
  for (let c = -N; c <= N; c++) columns.set(c, column(c));
  for (let c = -N; c < N; c++) {
    const a = columns.get(c)!, b = columns.get(c + 1)!;
    if (a.length === 1) for (let k = 0; k < rows; k++) tri(a[0], b[k], b[k + 1], 'platform', [0, -1, 0]);
    else if (b.length === 1) for (let k = 0; k < rows; k++) tri(a[k], b[0], a[k + 1], 'platform', [0, -1, 0]);
    else
      for (let k = 0; k < rows; k++) {
        tri(a[k], b[k], b[k + 1], 'platform', [0, -1, 0]);
        tri(a[k], b[k + 1], a[k + 1], 'platform', [0, -1, 0]);
      }
  }
  const of = (p: string) => Uint32Array.from(parts.flatMap((x, t) => (x === p ? [t] : [])));
  const ventral = of('ventral');
  // the retouch patch's triangles: those of the ventral face with their centroid in it
  const retouch = variant.retouch
    ? Uint32Array.from(Array.from(ventral).filter((t) => {
        const c = [0, 1].map((k) => (pos[3 * tris[3 * t] + k] + pos[3 * tris[3 * t + 1] + k] + pos[3 * tris[3 * t + 2] + k]) / 3);
        return inT8Retouch(c[0], c[1]);
      }))
    : new Uint32Array(0);
  // a narrow platform: only its triangles near the axis
  const half = variant.platformHalfWidth;
  const platform = half === undefined ? of('platform') : Uint32Array.from(Array.from(of('platform')).filter((t) => Math.abs((pos[3 * tris[3 * t]] + pos[3 * tris[3 * t + 1]] + pos[3 * tris[3 * t + 2]]) / 3) <= half));
  return { positions: new Float32Array(pos), index: new Uint32Array(tris), ventral, platform, dorsal: of('dorsal'), retouch };
}

/** The triangles whose outward normal lies within 60° (`minCos`) of `dir`: a flat face of a test body, as its region would give it. */
export function facesFacing(m: Mesh, dir: Vec3, minCos = 0.5): Uint32Array {
  const l = Math.hypot(...dir);
  const out: number[] = [];
  for (let t = 0; t < m.index.length / 3; t++) {
    const p = [0, 1, 2].map((k) => [0, 1, 2].map((j) => m.positions[3 * m.index[3 * t + k] + j]));
    const u = p[1].map((x, j) => x - p[0][j]), w = p[2].map((x, j) => x - p[0][j]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const s = Math.hypot(n[0], n[1], n[2]);
    if (s > 0 && (n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2]) / (s * l) >= minCos) out.push(t);
  }
  return Uint32Array.from(out);
}

/**
 * T9, a core-edge (débordant) flake, as a tetrahedron so that every face is flat and its area exact: the platform ABC (y = 0), the
 * ventral face ABF (z = 0), the back BCF (the plane x = 10, square to the ventral face, from the platform to the distal end) and the
 * dorsal face ACF; the back ridge C–F between the back and the dorsal face, from the platform's corner C to the distal end F, where the
 * edges A–F and B–F of the ventral face meet. Each face cut into n² triangles; `T9_AREAS` its faces' areas.
 */
export const T9 = { L: 40, A: [-15, 0, 0] as Vec3, B: [10, 0, 0] as Vec3, C: [10, 0, 6] as Vec3, F: [10, 40, 0] as Vec3 };
const triArea = (a: Vec3, b: Vec3, c: Vec3): number => {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
};
export const T9_AREAS = { platform: triArea(T9.A, T9.B, T9.C), ventral: triArea(T9.A, T9.B, T9.F), back: triArea(T9.B, T9.C, T9.F), dorsal: triArea(T9.A, T9.C, T9.F) };

export function flakeT9(n = 24): Mesh & { platform: Uint32Array; ventral: Uint32Array; back: Uint32Array; dorsal: Uint32Array } {
  const { A, B, C, F } = T9;
  const centre: Vec3 = [(A[0] + B[0] + C[0] + F[0]) / 4, (A[1] + B[1] + C[1] + F[1]) / 4, (A[2] + B[2] + C[2] + F[2]) / 4];
  const soup: number[] = [];
  const parts: string[] = [];
  // the same point the same way from either face: on a grid of 1e-6
  const snap = (x: number) => Math.round(x * 1e6) / 1e6;
  const point = (p: Vec3, q: Vec3, r: Vec3, i: number, j: number): Vec3 => [0, 1, 2].map((k) => snap(p[k] + (i / n) * (q[k] - p[k]) + (j / n) * (r[k] - p[k]))) as Vec3;
  const face = (p: Vec3, q: Vec3, r: Vec3, name: string) => {
    // wound outward: away from the centre
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const out = nrm[0] * (p[0] - centre[0]) + nrm[1] * (p[1] - centre[1]) + nrm[2] * (p[2] - centre[2]) > 0;
    const tri = (a: Vec3, b: Vec3, c: Vec3) => {
      soup.push(...a, ...(out ? b : c), ...(out ? c : b));
      parts.push(name);
    };
    for (let i = 0; i < n; i++)
      for (let j = 0; i + j < n; j++) {
        tri(point(p, q, r, i, j), point(p, q, r, i + 1, j), point(p, q, r, i, j + 1));
        if (i + j + 1 < n) tri(point(p, q, r, i + 1, j), point(p, q, r, i + 1, j + 1), point(p, q, r, i, j + 1));
      }
  };
  face(A, B, C, 'platform');
  face(A, B, F, 'ventral');
  face(B, C, F, 'back');
  face(A, C, F, 'dorsal');
  const m = weldExact(new Float32Array(soup));
  const of = (name: string) => Uint32Array.from(parts.flatMap((x, t) => (x === name ? [t] : [])));
  return { ...m, platform: of('platform'), ventral: of('ventral'), back: of('back'), dorsal: of('dorsal') };
}

/** S1 (stage 34): an ellipsoid of three different half-axes, made from the icosphere, which keeps its symmetry about each coordinate plane to the last bit. */
export const S_BODY = { a: 30, b: 20, c: 12, subdivisions: 5, bump: 3 };
export const symmetryS1 = (): Mesh => mapped(sphere(1, S_BODY.subdivisions), (p) => [S_BODY.a * p[0], S_BODY.b * p[1], S_BODY.c * p[2]]);
/** How far S2's bump pushes a point of S1 at this x outward along X: from nothing at x = 0.8 a, smoothly, to `bump` at the end. */
export const s2Bump = (x: number): number => (x > 0.8 * S_BODY.a ? S_BODY.bump * ((x / S_BODY.a - 0.8) / 0.2) ** 2 : 0);
/** S2: S1 with a bump on its +X end; its volume is told by the whole meshes' volumes. */
export const symmetryS2 = (): Mesh => mapped(symmetryS1(), (p) => [p[0] + s2Bump(p[0]), p[1], p[2]]);

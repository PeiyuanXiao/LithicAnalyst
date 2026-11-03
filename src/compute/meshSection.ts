import type { FrameAxes } from '../core/frame';
import type { Vec3 } from '../core/types';

/** A polyline where a plane cuts the mesh, with the triangle of each stretch. */
export interface SectionLine {
  points: Vec3[];
  /** The triangle of the stretch from point i to point i + 1 (closed: the last one back to the first). */
  faces: number[];
  closed: boolean;
}

/**
 * Hands over the triangles a plane may cut (the app's come from the BVH); all of
 * them when there is none. Called with the plane, and a function to call per triangle.
 */
export type PlaneCandidates = (point: Vec3, normal: Vec3, visit: (triangle: number) => void, within?: SectionReach | null) => void;

/** Only this near a point: triangles further away are left out of a section. */
export interface SectionReach {
  center: Vec3;
  radius: number;
}

/**
 * Where the plane through `point` with normal `normal` cuts the mesh. Vertices on
 * the plane count as being on its positive side, so every crossing is a proper
 * edge crossing (as in intersectPlane); the triangle of each stretch is kept.
 */
export function sectionByPlane(positions: ArrayLike<number>, index: ArrayLike<number>, point: Vec3, normal: Vec3, candidates: PlaneCandidates | null = null, within: SectionReach | null = null): SectionLine[] {
  const vertexCount = Math.floor(positions.length / 3);
  const [px, py, pz] = point;
  const [nx, ny, nz] = normal;
  const dist = (v: number) => (positions[3 * v] - px) * nx + (positions[3 * v + 1] - py) * ny + (positions[3 * v + 2] - pz) * nz;
  // crossed edges by number; each is met by at most two triangles
  const ids = new Map<number, number>();
  const verts: number[] = [];
  const links: number[] = [];
  const linkFaces: number[] = [];
  const edgeOf = (a: number, b: number): number => {
    const lo = a < b ? a : b, hi = a < b ? b : a;
    const key = lo * vertexCount + hi;
    let e = ids.get(key);
    if (e === undefined) {
      e = verts.length / 2;
      ids.set(key, e);
      verts.push(lo, hi);
      links.push(-1, -1);
      linkFaces.push(-1, -1);
    }
    return e;
  };
  const link = (x: number, y: number, t: number) => {
    if (links[2 * x] < 0) {
      links[2 * x] = y;
      linkFaces[2 * x] = t;
    } else if (links[2 * x + 1] < 0) {
      links[2 * x + 1] = y;
      linkFaces[2 * x + 1] = t;
    }
  };
  // whether a triangle may reach into the sphere: by the sphere round its middle
  const nearReach = (t: number): boolean => {
    const { center: o, radius } = within!;
    const a = 3 * index[3 * t], b = 3 * index[3 * t + 1], c = 3 * index[3 * t + 2];
    const mx = (positions[a] + positions[b] + positions[c]) / 3, my = (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3, mz = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
    let r2 = 0;
    for (const v of [a, b, c]) r2 = Math.max(r2, (positions[v] - mx) ** 2 + (positions[v + 1] - my) ** 2 + (positions[v + 2] - mz) ** 2);
    return Math.hypot(mx - o[0], my - o[1], mz - o[2]) <= radius + Math.sqrt(r2);
  };
  const visit = (t: number) => {
    const a = index[3 * t], b = index[3 * t + 1], c = index[3 * t + 2];
    const sa = dist(a) >= 0, sb = dist(b) >= 0, sc = dist(c) >= 0;
    if (sa === sb && sb === sc) return;
    if (within && !nearReach(t)) return;
    // the two sides that change: the odd corner's
    const [u, v, w] = sa === sb ? [c, a, b] : sa === sc ? [b, c, a] : [a, b, c];
    const e = edgeOf(u, v), f = edgeOf(u, w);
    link(e, f, t);
    link(f, e, t);
  };
  if (candidates) candidates(point, normal, visit, within);
  else for (let t = 0, n = Math.floor(index.length / 3); t < n; t++) visit(t);

  const crossing = (e: number): Vec3 => {
    const a = verts[2 * e], b = verts[2 * e + 1];
    const da = dist(a), db = dist(b);
    const s = da / (da - db);
    return [positions[3 * a] + s * (positions[3 * b] - positions[3 * a]), positions[3 * a + 1] + s * (positions[3 * b + 1] - positions[3 * a + 1]), positions[3 * a + 2] + s * (positions[3 * b + 2] - positions[3 * a + 2])];
  };
  const count = verts.length / 2;
  const done = new Uint8Array(count);
  const walk = (from: number): SectionLine => {
    const points: Vec3[] = [];
    const faces: number[] = [];
    let cur = from, entry = -1;
    let closed = false;
    for (;;) {
      done[cur] = 1;
      const p = crossing(cur);
      const q = points[points.length - 1];
      // a vertex on the plane is where several crossed edges meet: drop the stretch of no length
      if (!q || q[0] !== p[0] || q[1] !== p[1] || q[2] !== p[2]) points.push(p);
      else faces.pop();
      const side = links[2 * cur] >= 0 && 2 * cur !== entry && !done[links[2 * cur]] ? 2 * cur : links[2 * cur + 1] >= 0 && 2 * cur + 1 !== entry && !done[links[2 * cur + 1]] ? 2 * cur + 1 : -1;
      if (side < 0) {
        // back at the start?
        const a = links[2 * cur], b = links[2 * cur + 1];
        if (points.length > 2 && (a === from || b === from)) {
          closed = true;
          faces.push(linkFaces[a === from && 2 * cur !== entry ? 2 * cur : 2 * cur + 1]);
        }
        break;
      }
      faces.push(linkFaces[side]);
      const next = links[side];
      entry = links[2 * next] === cur ? 2 * next : 2 * next + 1;
      cur = next;
    }
    // the closing stretch of no length (the start was a vertex on the plane)
    if (closed && points.length > 1) {
      const f = points[0], l = points[points.length - 1];
      if (f[0] === l[0] && f[1] === l[1] && f[2] === l[2]) {
        points.pop();
        faces.pop();
      }
    }
    return { points, faces, closed };
  };
  const out: SectionLine[] = [];
  // open pieces first, from their ends
  for (let e = 0; e < count; e++) if (!done[e] && links[2 * e + 1] < 0) out.push(walk(e));
  for (let e = 0; e < count; e++) if (!done[e]) out.push(walk(e));
  return out.filter((l) => l.points.length > 1);
}

/** Distance from a point to a section line. */
export function distanceToLine(line: SectionLine, p: Vec3): number {
  let best = Infinity;
  const n = line.points.length;
  for (let i = 0; i < n - (line.closed ? 0 : 1); i++) {
    const a = line.points[i], b = line.points[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const l2 = dx * dx + dy * dy + dz * dz;
    const s = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / l2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - a[0] - s * dx, p[1] - a[1] - s * dy, p[2] - a[2] - s * dz));
  }
  return best;
}

/** The section line passing nearest a point. */
export function lineNear(lines: readonly SectionLine[], p: Vec3): SectionLine | null {
  let best: SectionLine | null = null, d = Infinity;
  for (const l of lines) {
    const x = distanceToLine(l, p);
    if (x < d) {
      d = x;
      best = l;
    }
  }
  return best;
}

/** A point's coordinates in a frame (the frame's origin and the point in the same coordinates). */
export const inFrame = (f: FrameAxes, p: Vec3): Vec3 => {
  const dx = p[0] - f.origin[0], dy = p[1] - f.origin[1], dz = p[2] - f.origin[2];
  return [dx * f.x[0] + dy * f.x[1] + dz * f.x[2], dx * f.y[0] + dy * f.y[1] + dz * f.y[2], dx * f.z[0] + dy * f.z[1] + dz * f.z[2]];
};

/** A cross-section of the flake: the lines in the frame's X and Z, and its width (X range) and thickness (Z range). */
export interface CrossSection {
  loops: Array<{ points: Array<[number, number]>; closed: boolean }>;
  width: number | null;
  thickness: number | null;
  /** The lines in the mesh's coordinates. */
  lines: SectionLine[];
}

/** The section across the flake at Y = `y` of the frame. */
export function crossSectionAt(positions: ArrayLike<number>, index: ArrayLike<number>, frame: FrameAxes, y: number, candidates: PlaneCandidates | null = null): CrossSection {
  const point: Vec3 = [frame.origin[0] + y * frame.y[0], frame.origin[1] + y * frame.y[1], frame.origin[2] + y * frame.y[2]];
  const lines = sectionByPlane(positions, index, point, frame.y, candidates);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const loops = lines.map((l) => ({
    closed: l.closed,
    points: l.points.map((p): [number, number] => {
      const [x, , z] = inFrame(frame, p);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
      return [x, z];
    }),
  }));
  return { loops, lines, width: x1 >= x0 ? x1 - x0 : null, thickness: z1 >= z0 ? z1 - z0 : null };
}

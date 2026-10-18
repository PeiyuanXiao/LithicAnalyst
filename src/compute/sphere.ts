import type { Vec3 } from '../core/types';

export interface SphereFit {
  center: Vec3;
  radius: number;
  /** Root-mean-square distance of the points from the sphere. */
  rms: number;
  count: number;
}

/** Solve a small dense linear system (Gaussian elimination with partial pivoting); null when singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-300) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = c + 1; r < n; r++) {
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let k = r + 1; k < n; k++) s -= m[r][k] * x[k];
    x[r] = s / m[r][r];
  }
  return x.every(Number.isFinite) ? x : null;
}

/**
 * Least-squares sphere through points (xyz…): an algebraic fit
 * (x² + y² + z² + Dx + Ey + Fz + G = 0) gives the start, then Gauss–Newton
 * minimises the geometric residuals |p − c| − r. Null for fewer than four
 * points or a degenerate set (e.g. all on a plane).
 */
export function fitSphere(points: ArrayLike<number>, iterations = 50): SphereFit | null {
  const n = Math.floor(points.length / 3);
  if (n < 4) return null;
  // work relative to the centroid for precision
  const o = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) o[k] += points[3 * i + k] / n;
  const P = (i: number, k: number) => points[3 * i + k] - o[k];

  // algebraic: minimise Σ (x·D + y·E + z·F + G + |p|²)²
  const ata = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
  const atb = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const row = [P(i, 0), P(i, 1), P(i, 2), 1];
    const rhs = -(P(i, 0) ** 2 + P(i, 1) ** 2 + P(i, 2) ** 2);
    for (let r = 0; r < 4; r++) {
      atb[r] += row[r] * rhs;
      for (let c = 0; c < 4; c++) ata[r][c] += row[r] * row[c];
    }
  }
  const alg = solve(ata, atb);
  if (!alg) return null;
  let c = [-alg[0] / 2, -alg[1] / 2, -alg[2] / 2];
  const r2 = c[0] ** 2 + c[1] ** 2 + c[2] ** 2 - alg[3];
  if (!(r2 > 0)) return null;
  let r = Math.sqrt(r2);

  // geometric: Gauss–Newton on (cx, cy, cz, r)
  for (let it = 0; it < iterations; it++) {
    const jtj = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
    const jtr = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const d = [P(i, 0) - c[0], P(i, 1) - c[1], P(i, 2) - c[2]];
      const dist = Math.hypot(d[0], d[1], d[2]) || 1e-300;
      const res = dist - r;
      const jac = [-d[0] / dist, -d[1] / dist, -d[2] / dist, -1];
      for (let a = 0; a < 4; a++) {
        jtr[a] += jac[a] * res;
        for (let b = 0; b < 4; b++) jtj[a][b] += jac[a] * jac[b];
      }
    }
    const step = solve(jtj, jtr.map((x) => -x));
    if (!step) break;
    c = [c[0] + step[0], c[1] + step[1], c[2] + step[2]];
    r += step[3];
    if (Math.hypot(step[0], step[1], step[2], step[3]) < 1e-12 * Math.max(1, r)) break;
  }
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (Math.hypot(P(i, 0) - c[0], P(i, 1) - c[1], P(i, 2) - c[2]) - r) ** 2;
  return { center: [c[0] + o[0], c[1] + o[1], c[2] + o[2]], radius: Math.abs(r), rms: Math.sqrt(ss / n), count: n };
}

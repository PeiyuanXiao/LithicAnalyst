import type { Vec3 } from '../core/types';
import { symmetricEigen3 } from './linalg';
import type { Steps } from './steps';

/**
 * Carrying points from one set of anchors to another: first the similarity (rotation, one scale, translation) that fits the anchors best, then a thin-plate
 * spline of what is left, on the displacements. Kernel U(r) = r (three dimensions). The affine part is the least-norm solution, so with the anchors in a plane
 * nothing moves across that plane beyond what the similarity did: flat objects are not squashed.
 */

export const TPS_PARAMETERS = {
  /** Singular values of the affine part below this share of the largest count as zero. */
  PINV_CUTOFF: 1e-8,
  /** Columns factored at a time: what keeps 2000 anchors within a second. */
  FACTOR_BLOCK: 32,
};

export interface Similarity {
  /** Row-major. */
  rotation: number[];
  scale: number;
  translation: Vec3;
}

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
/** A unit vector across `a`. */
const across = (a: Vec3): Vec3 => unit(cross(a, Math.abs(a[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]));

const mean = (pts: readonly Vec3[]): Vec3 => {
  const m: Vec3 = [0, 0, 0];
  for (const p of pts) for (let k = 0; k < 3; k++) m[k] += p[k] / pts.length;
  return m;
};

/** The similarity taking `from` nearest to `to`, point by point (Kabsch, with one scale); a proper rotation, never a mirror image. */
export function similarityFit(from: readonly Vec3[], to: readonly Vec3[]): Similarity {
  const ma = mean(from), mb = mean(to);
  const H = new Array<number>(9).fill(0);
  let spread = 0;
  from.forEach((p, i) => {
    const a: Vec3 = [p[0] - ma[0], p[1] - ma[1], p[2] - ma[2]];
    const q = to[i];
    const b: Vec3 = [q[0] - mb[0], q[1] - mb[1], q[2] - mb[2]];
    spread += dot(a, a);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) H[3 * r + c] += b[r] * a[c];
  });
  const mul = (v: Vec3): Vec3 => [H[0] * v[0] + H[1] * v[1] + H[2] * v[2], H[3] * v[0] + H[4] * v[1] + H[5] * v[2], H[6] * v[0] + H[7] * v[1] + H[8] * v[2]];
  const HtH = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) HtH[3 * i + j] += H[3 * k + i] * H[3 * k + j];
  const { vectors } = symmetricEigen3(HtH);
  const v1 = vectors[0];
  const v2 = unit(cross(cross(v1, vectors[1]), v1));
  const v2Sure = Math.hypot(...v2) > 0 ? v2 : across(v1);
  const v3 = cross(v1, v2Sure);
  const u1Raw = mul(v1);
  const u1 = Math.hypot(...u1Raw) > 0 ? unit(u1Raw) : [1, 0, 0] as Vec3;
  const inPlane = mul(v2Sure);
  const off = dot(inPlane, u1);
  const u2Raw: Vec3 = [inPlane[0] - off * u1[0], inPlane[1] - off * u1[1], inPlane[2] - off * u1[2]];
  // (nothing there: anchors along a line; the turn about the line is not told by them)
  const u2 = Math.hypot(...u2Raw) > 1e-12 * (Math.hypot(...u1Raw) || 1) ? unit(u2Raw) : across(u1);
  const u3 = cross(u1, u2);
  const rotation = new Array<number>(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) rotation[3 * r + c] = u1[r] * v1[c] + u2[r] * v2Sure[c] + u3[r] * v3[c];
  // the best scale for that rotation
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += rotation[i] * H[i];
  const scale = spread > 0 ? sum / spread : 1;
  const turned = turn(rotation, ma);
  return { rotation, scale, translation: [mb[0] - scale * turned[0], mb[1] - scale * turned[1], mb[2] - scale * turned[2]] };
}

const turn = (r: readonly number[], p: Vec3): Vec3 => [r[0] * p[0] + r[1] * p[1] + r[2] * p[2], r[3] * p[0] + r[4] * p[1] + r[5] * p[2], r[6] * p[0] + r[7] * p[1] + r[8] * p[2]];

export function applySimilarity(s: Similarity, p: Vec3): Vec3 {
  const q = turn(s.rotation, p);
  return [s.scale * q[0] + s.translation[0], s.scale * q[1] + s.translation[1], s.scale * q[2] + s.translation[2]];
}

/** The fitted spline of the displacements, in coordinates centred and scaled for the numbers' sake. */
export interface TpsModel {
  /** xyz of each anchor, centred and scaled. */
  anchors: Float64Array;
  /** The weights of each anchor, xyz. */
  weights: Float64Array;
  /** Per axis: constant, x, y, z. */
  affine: [number[], number[], number[]];
  centre: Vec3;
  scale: number;
}

/** Singular value decomposition of a tall matrix (one-sided Jacobi): columns of U and of V, the values. */
function thinSvd(columns: Float64Array[]): { u: Float64Array[]; v: number[][]; s: number[] } {
  const m = columns.length;
  const u = columns.map((c) => Float64Array.from(c));
  const v: number[][] = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let rotated = false;
    for (let p = 0; p < m - 1; p++) {
      for (let q = p + 1; q < m; q++) {
        const a = u[p], b = u[q];
        let aa = 0, bb = 0, ab = 0;
        for (let i = 0; i < a.length; i++) {
          aa += a[i] * a[i];
          bb += b[i] * b[i];
          ab += a[i] * b[i];
        }
        if (Math.abs(ab) <= 1e-15 * Math.sqrt(aa * bb) || ab === 0) continue;
        rotated = true;
        const zeta = (bb - aa) / (2 * ab);
        const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t), s = c * t;
        for (let i = 0; i < a.length; i++) {
          const x = a[i];
          a[i] = c * x - s * b[i];
          b[i] = s * x + c * b[i];
        }
        const vp = v[p], vq = v[q];
        for (let i = 0; i < m; i++) {
          const x = vp[i];
          vp[i] = c * x - s * vq[i];
          vq[i] = s * x + c * vq[i];
        }
      }
    }
    if (!rotated) break;
  }
  const s = u.map((c) => Math.sqrt(c.reduce((t, x) => t + x * x, 0)));
  u.forEach((c, k) => {
    if (s[k] > 0) for (let i = 0; i < c.length; i++) c[i] /= s[k];
  });
  return { u, v, s };
}

/**
 * Cholesky in place (the lower triangle), a block of columns at a time: first what the columns before take off the block, for every row from the block down (none of these depends
 * on another, so four are worked out at once, which is twice as fast as one by one); then the block itself and the rows below it. False when the matrix is not positive definite. In slices.
 */
function* choleskySteps(a: Float64Array, n: number): Steps<boolean> {
  const block = TPS_PARAMETERS.FACTOR_BLOCK;
  for (let j0 = 0; j0 < n; j0 += block) {
    yield;
    const j1 = Math.min(n, j0 + block);
    for (let i = j0; i < n; i++) {
      const ri = n * i;
      const top = Math.min(i + 1, j1);
      let j = j0;
      for (; j + 3 < top; j += 4) {
        const r0 = n * j, r1 = r0 + n, r2 = r1 + n, r3 = r2 + n;
        let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
        for (let k = 0; k < j0; k++) {
          const x = a[ri + k];
          s0 += x * a[r0 + k];
          s1 += x * a[r1 + k];
          s2 += x * a[r2 + k];
          s3 += x * a[r3 + k];
        }
        a[ri + j] -= s0;
        a[ri + j + 1] -= s1;
        a[ri + j + 2] -= s2;
        a[ri + j + 3] -= s3;
      }
      for (; j < top; j++) {
        const rj = n * j;
        let s = 0;
        for (let k = 0; k < j0; k++) s += a[ri + k] * a[rj + k];
        a[ri + j] -= s;
      }
    }
    for (let i = j0; i < n; i++) {
      const ri = n * i;
      const top = Math.min(i + 1, j1);
      for (let j = j0; j < top; j++) {
        const rj = n * j;
        let s = a[ri + j];
        for (let k = j0; k < j; k++) s -= a[ri + k] * a[rj + k];
        if (i === j) {
          if (!(s > 0)) return false;
          a[ri + i] = Math.sqrt(s);
        } else a[ri + j] = s / a[rj + j];
      }
    }
  }
  return true;
}

function choleskySolve(l: Float64Array, n: number, b: Float64Array, out: Float64Array): void {
  for (let i = 0; i < n; i++) {
    const r = n * i;
    let s = b[i];
    for (let k = 0; k < i; k++) s -= l[r + k] * out[k];
    out[i] = s / l[r + i];
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = out[i];
    for (let k = i + 1; k < n; k++) s -= l[n * k + i] * out[k];
    out[i] = s / l[n * i + i];
  }
}

/** The weights: −K on the space across the affine part, the affine part itself held apart. Null when it cannot be factored (anchors on top of each other). */
function* weightsSteps(K: Float64Array, n: number, basis: readonly Float64Array[], rhs: readonly Float64Array[]): Steps<Float64Array[] | null> {
  // with Π the projection across U: M = −ΠKΠ + c UUᵀ = −K + UVᵀ + VUᵀ, positive definite, and it leaves the two spaces apart
  const KU = basis.map((u) => {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const r = n * i;
      let s = 0;
      for (let j = 0; j < n; j++) s += K[r + j] * u[j];
      out[i] = s;
    }
    return out;
  });
  const UKU = basis.map((a) => basis.map((_, q) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += a[i] * KU[q][i];
    return s;
  }));
  const V = KU.map((w, p) => {
    const out = Float64Array.from(w);
    basis.forEach((u, q) => {
      for (let i = 0; i < n; i++) out[i] -= 0.5 * UKU[p][q] * u[i];
    });
    return out;
  });
  // the mean of −ΠKΠ's diagonal, to weigh the two spaces alike
  let trace = 0;
  basis.forEach((u, p) => {
    for (let i = 0; i < n; i++) trace += 2 * u[i] * V[p][i];
  });
  const c = trace / n > 0 ? trace / n : 1;
  basis.forEach((u, p) => {
    for (let i = 0; i < n; i++) V[p][i] += 0.5 * c * u[i];
  });
  yield;
  const M = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) M[n * i + j] = -K[n * i + j];
  for (let p = 0; p < basis.length; p++) {
    yield;
    const u = basis[p], v = V[p];
    for (let i = 0; i < n; i++) {
      const r = n * i, ui = u[i], vi = v[i];
      for (let j = 0; j <= i; j++) M[r + j] += ui * v[j] + vi * u[j];
    }
  }
  if (!(yield* choleskySteps(M, n))) return null;
  yield;
  return rhs.map((b) => {
    const neg = Float64Array.from(b, (x) => -x);
    const out = new Float64Array(n);
    choleskySolve(M, n, neg, out);
    return out;
  });
}

/**
 * The spline through the displacements at the anchors. Null when the anchors give no system that can be solved. The weights lie across the
 * affine part (Pᵀw = 0); the affine part is the least-norm fit of what the weights leave, by the pseudo-inverse.
 */
export function* tpsFitSteps(anchors: readonly Vec3[], displacements: readonly Vec3[]): Steps<TpsModel | null> {
  const n = anchors.length;
  const centre = mean(anchors);
  let scale = 0;
  for (const p of anchors) for (let k = 0; k < 3; k++) scale = Math.max(scale, Math.abs(p[k] - centre[k]));
  if (!(scale > 0)) scale = 1;
  const at = new Float64Array(3 * n);
  anchors.forEach((p, i) => {
    for (let k = 0; k < 3; k++) at[3 * i + k] = (p[k] - centre[k]) / scale;
  });
  const P = [new Float64Array(n).fill(1), ...[0, 1, 2].map((k) => Float64Array.from({ length: n }, (_, i) => at[3 * i + k]))];
  const svd = thinSvd(P);
  const top = Math.max(...svd.s);
  const kept = svd.s.flatMap((s, k) => (s > TPS_PARAMETERS.PINV_CUTOFF * top ? [k] : []));
  const basis = kept.map((k) => svd.u[k]);
  const K = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    if (i % 256 === 0) yield;
    for (let j = 0; j < i; j++) {
      const dx = at[3 * i] - at[3 * j], dy = at[3 * i + 1] - at[3 * j + 1], dz = at[3 * i + 2] - at[3 * j + 2];
      K[n * i + j] = K[n * j + i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  }
  const across: Float64Array[] = [0, 1, 2].map((k) => {
    const v = Float64Array.from({ length: n }, (_, i) => displacements[i][k]);
    for (const u of basis) {
      let d = 0;
      for (let i = 0; i < n; i++) d += u[i] * v[i];
      for (let i = 0; i < n; i++) v[i] -= d * u[i];
    }
    return v;
  });
  let w: Float64Array[] | null = null;
  if (n > basis.length) {
    w = yield* weightsSteps(K, n, basis, across);
    if (!w) return null;
  } else w = across.map(() => new Float64Array(n));
  // what the weights leave goes to the affine part
  const affine = [0, 1, 2].map((k) => {
    const left = Float64Array.from({ length: n }, (_, i) => {
      const row = n * i;
      let s = 0;
      for (let j = 0; j < n; j++) s += K[row + j] * w![k][j];
      return displacements[i][k] - s;
    });
    const a = [0, 0, 0, 0];
    for (const c of kept) {
      let d = 0;
      for (let i = 0; i < n; i++) d += svd.u[c][i] * left[i];
      d /= svd.s[c];
      for (let t = 0; t < 4; t++) a[t] += svd.v[c][t] * d;
    }
    return a;
  }) as [number[], number[], number[]];
  const weights = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) weights[3 * i + k] = w[k][i];
  yield;
  return { anchors: at, weights, affine, centre, scale };
}

/** The displacement at a point. */
export function tpsDisplace(m: TpsModel, p: Vec3): Vec3 {
  const x = (p[0] - m.centre[0]) / m.scale, y = (p[1] - m.centre[1]) / m.scale, z = (p[2] - m.centre[2]) / m.scale;
  const out: Vec3 = [0, 0, 0];
  const n = m.anchors.length / 3;
  for (let i = 0; i < n; i++) {
    const dx = x - m.anchors[3 * i], dy = y - m.anchors[3 * i + 1], dz = z - m.anchors[3 * i + 2];
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    out[0] += m.weights[3 * i] * r;
    out[1] += m.weights[3 * i + 1] * r;
    out[2] += m.weights[3 * i + 2] * r;
  }
  for (let k = 0; k < 3; k++) {
    const a = m.affine[k];
    out[k] += a[0] + a[1] * x + a[2] * y + a[3] * z;
  }
  return out;
}

/**
 * What carries a point from among the anchors `from` to among the anchors `to`: the similarity, then the spline of what is left. Pairs that repeat an anchor count once.
 * Null when no spline can be fitted.
 */
export function* anchorWarpSteps(from: readonly Vec3[], to: readonly Vec3[]): Steps<((p: Vec3) => Vec3) | null> {
  const seen = new Set<string>();
  const a: Vec3[] = [], b: Vec3[] = [];
  from.forEach((p, i) => {
    const key = p.join();
    if (seen.has(key)) return;
    seen.add(key);
    a.push(p);
    b.push(to[i]);
  });
  const fit = similarityFit(a, b);
  const aligned = a.map((p) => applySimilarity(fit, p));
  const model = yield* tpsFitSteps(aligned, aligned.map((p, i): Vec3 => [b[i][0] - p[0], b[i][1] - p[1], b[i][2] - p[2]]));
  if (!model) return null;
  return (p) => {
    const q = applySimilarity(fit, p);
    const d = tpsDisplace(model, q);
    return [q[0] + d[0], q[1] + d[1], q[2] + d[2]];
  };
}

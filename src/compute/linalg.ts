import type { Vec3 } from '../core/types';

/** Eigen decomposition of a symmetric 3×3 matrix (row-major, 9 numbers). */
export interface Eigen3 {
  /** Eigenvalues, largest first. */
  values: [number, number, number];
  /** Unit eigenvectors, in the order of `values`. */
  vectors: [Vec3, Vec3, Vec3];
}

/** Cyclic Jacobi rotations: robust for the small symmetric matrices used here (covariances, tensors). */
export function symmetricEigen3(m: ArrayLike<number>): Eigen3 {
  const a = [
    [m[0], m[1], m[2]],
    [m[3], m[4], m[5]],
    [m[6], m[7], m[8]],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    const scale = Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]) + off;
    if (off <= 1e-15 * scale || off === 0) break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (a[p][q] === 0) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k];
        const aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return {
    values: order.map((i) => a[i][i]) as [number, number, number],
    vectors: order.map((i) => [v[0][i], v[1][i], v[2][i]] as Vec3) as [Vec3, Vec3, Vec3],
  };
}

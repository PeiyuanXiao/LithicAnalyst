/**
 * Per-vertex curvature for shading. Pure functions on typed arrays so they can
 * move into a Web Worker later without changes.
 */

export interface Adjacency {
  offsets: Uint32Array; // length vertexCount + 1
  neighbors: Uint32Array;
}

/** One-ring neighbours from a triangle index (interior neighbours appear twice; harmless for averages). */
export function buildAdjacency(index: ArrayLike<number>, vertexCount: number): Adjacency {
  const deg = new Uint32Array(vertexCount + 1);
  const triCount = Math.floor(index.length / 3);
  for (let t = 0; t < triCount; t++) {
    deg[index[3 * t]] += 2;
    deg[index[3 * t + 1]] += 2;
    deg[index[3 * t + 2]] += 2;
  }
  const offsets = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < vertexCount; i++) offsets[i + 1] = offsets[i] + deg[i];
  const fill = offsets.slice(0, vertexCount);
  const neighbors = new Uint32Array(offsets[vertexCount]);
  for (let t = 0; t < triCount; t++) {
    const a = index[3 * t], b = index[3 * t + 1], c = index[3 * t + 2];
    neighbors[fill[a]++] = b;
    neighbors[fill[a]++] = c;
    neighbors[fill[b]++] = c;
    neighbors[fill[b]++] = a;
    neighbors[fill[c]++] = a;
    neighbors[fill[c]++] = b;
  }
  return { offsets, neighbors };
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Mean normal curvature estimate: average over neighbours j of
 *   (n_j − n_i) · (p_j − p_i) / |p_j − p_i|²
 * Positive = convex (ridges between scars), negative = concave (scar beds),
 * for outward-facing normals. For a sphere of radius R this gives 1/R.
 */
export async function meanCurvature(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  adj: Adjacency,
  orientationSign = 1,
  onProgress?: (fraction: number) => void,
): Promise<Float32Array> {
  const n = adj.offsets.length - 1;
  const k = new Float32Array(n);
  const chunk = 200_000;
  for (let start = 0; start < n; start += chunk) {
    const end = Math.min(n, start + chunk);
    for (let i = start; i < end; i++) {
      const px = positions[3 * i], py = positions[3 * i + 1], pz = positions[3 * i + 2];
      const nx = normals[3 * i], ny = normals[3 * i + 1], nz = normals[3 * i + 2];
      let sum = 0;
      let cnt = 0;
      for (let e = adj.offsets[i]; e < adj.offsets[i + 1]; e++) {
        const j = adj.neighbors[e];
        const dx = positions[3 * j] - px, dy = positions[3 * j + 1] - py, dz = positions[3 * j + 2] - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (!(d2 > 0)) continue;
        sum += ((normals[3 * j] - nx) * dx + (normals[3 * j + 1] - ny) * dy + (normals[3 * j + 2] - nz) * dz) / d2;
        cnt++;
      }
      k[i] = cnt ? (orientationSign * sum) / cnt : 0;
    }
    onProgress?.(end / n);
    if (end < n) await yieldToUi();
  }
  return k;
}

/** Repeated one-ring averaging; more iterations show broader forms (scars) instead of fine texture (ripples, noise). */
export async function smoothField(values: Float32Array, adj: Adjacency, iterations: number): Promise<Float32Array> {
  let cur = values;
  const n = values.length;
  for (let it = 0; it < iterations; it++) {
    const next = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = cur[i];
      let cnt = 1;
      for (let e = adj.offsets[i]; e < adj.offsets[i + 1]; e++) {
        sum += cur[adj.neighbors[e]];
        cnt++;
      }
      next[i] = sum / cnt;
    }
    cur = next;
    if (n > 300_000) await yieldToUi();
  }
  return cur;
}

/** Robust symmetric range: the given quantile of |values| (ignores a few extreme spikes). */
export function robustAbsRange(values: Float32Array, quantile = 0.95): number {
  const n = values.length;
  if (n === 0) return 1;
  const step = Math.max(1, Math.floor(n / 50_000));
  const sample: number[] = [];
  for (let i = 0; i < n; i += step) {
    const v = Math.abs(values[i]);
    if (Number.isFinite(v)) sample.push(v);
  }
  sample.sort((a, b) => a - b);
  const v = sample[Math.min(sample.length - 1, Math.floor(quantile * (sample.length - 1)))];
  return v > 0 ? v : 1;
}

/** Signed volume (positive when triangles wind counter-clockwise seen from outside). */
export function signedVolume(positions: ArrayLike<number>, index: ArrayLike<number>): number {
  let v = 0;
  const triCount = Math.floor(index.length / 3);
  for (let t = 0; t < triCount; t++) {
    const a = 3 * index[3 * t], b = 3 * index[3 * t + 1], c = 3 * index[3 * t + 2];
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

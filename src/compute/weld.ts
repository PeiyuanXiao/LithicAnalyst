/**
 * Turn a triangle soup (STL, OBJ after parsing) into an indexed mesh by merging
 * vertices with bit-identical coordinates. Shared corners in these formats are
 * written identically, so exact matching is both correct and fast (O(n)).
 */
export function weldExact(soup: Float32Array): { positions: Float32Array; index: Uint32Array } {
  const n = Math.floor(soup.length / 3);
  const bits = new Uint32Array(soup.buffer, soup.byteOffset, n * 3);
  let size = 1;
  while (size < n * 2) size <<= 1;
  const mask = size - 1;
  const table = new Int32Array(size).fill(-1);
  const outBits = new Uint32Array(n * 3);
  const index = new Uint32Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    let x = bits[3 * i], y = bits[3 * i + 1], z = bits[3 * i + 2];
    if (x === 0x80000000) x = 0; // -0 → +0
    if (y === 0x80000000) y = 0;
    if (z === 0x80000000) z = 0;
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
    for (;;) {
      const slot = table[h];
      if (slot === -1) {
        table[h] = count;
        outBits[3 * count] = x;
        outBits[3 * count + 1] = y;
        outBits[3 * count + 2] = z;
        index[i] = count++;
        break;
      }
      if (outBits[3 * slot] === x && outBits[3 * slot + 1] === y && outBits[3 * slot + 2] === z) {
        index[i] = slot;
        break;
      }
      h = (h + 1) & mask;
    }
  }
  const positions = new Float32Array(outBits.buffer.slice(0, count * 12));
  return { positions, index };
}

/** Drop triangles whose corners are not three distinct vertices. */
export function removeDegenerateTriangles(index: Uint32Array): Uint32Array {
  let keep = 0;
  const out = new Uint32Array(index.length);
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    if (a === b || b === c || a === c) continue;
    out[keep++] = a;
    out[keep++] = b;
    out[keep++] = c;
  }
  return keep === index.length ? index : out.slice(0, keep);
}

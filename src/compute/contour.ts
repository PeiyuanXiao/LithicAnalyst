/**
 * Outlines of a mask (marching squares): closed polylines around the pixels
 * whose value is at least `threshold`, in pixel coordinates (pixel centres at
 * i + 0.5). The mask is treated as surrounded by empty pixels, so every
 * outline closes.
 */
export function traceOutlines(mask: ArrayLike<number>, width: number, height: number, threshold = 128): Array<Array<[number, number]>> {
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < width && y < height ? mask[y * width + x] : 0);
  const inside = (x: number, y: number) => at(x, y) >= threshold;
  // a crossing on the edge between two pixel centres, interpolated on the values
  const cross = (x0: number, y0: number, x1: number, y1: number): [number, number] => {
    const a = at(x0, y0), b = at(x1, y1);
    const t = a === b ? 0.5 : Math.min(1, Math.max(0, (threshold - a) / (b - a)));
    return [x0 + 0.5 + t * (x1 - x0), y0 + 0.5 + t * (y1 - y0)];
  };
  const key = (p: [number, number]) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  // segments, directed so that the inside is on the left
  const next = new Map<string, { to: [number, number]; from: [number, number] }>();
  for (let y = -1; y < height; y++)
    for (let x = -1; x < width; x++) {
      const tl = inside(x, y), tr = inside(x + 1, y), br = inside(x + 1, y + 1), bl = inside(x, y + 1);
      const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = () => cross(x, y, x + 1, y);
      const right = () => cross(x + 1, y, x + 1, y + 1);
      const bottom = () => cross(x, y + 1, x + 1, y + 1);
      const left = () => cross(x, y, x, y + 1);
      const segs: Array<[[number, number], [number, number]]> = [];
      switch (code) {
        case 1: segs.push([left(), bottom()]); break;
        case 2: segs.push([bottom(), right()]); break;
        case 3: segs.push([left(), right()]); break;
        case 4: segs.push([right(), top()]); break;
        case 5: segs.push([left(), top()], [right(), bottom()]); break;
        case 6: segs.push([bottom(), top()]); break;
        case 7: segs.push([left(), top()]); break;
        case 8: segs.push([top(), left()]); break;
        case 9: segs.push([top(), bottom()]); break;
        case 10: segs.push([top(), right()], [bottom(), left()]); break;
        case 11: segs.push([top(), right()]); break;
        case 12: segs.push([right(), left()]); break;
        case 13: segs.push([right(), bottom()]); break;
        case 14: segs.push([bottom(), left()]); break;
      }
      for (const [a, b] of segs) next.set(key(a), { from: a, to: b });
    }
  const loops: Array<Array<[number, number]>> = [];
  while (next.size) {
    const [startKey, first] = next.entries().next().value as [string, { from: [number, number]; to: [number, number] }];
    next.delete(startKey);
    const loop: Array<[number, number]> = [first.from];
    let cur = first.to;
    for (;;) {
      const k = key(cur);
      if (k === startKey) break;
      const seg = next.get(k);
      if (!seg) break;
      next.delete(k);
      loop.push(cur);
      cur = seg.to;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** Ramer–Douglas–Peucker simplification of a closed polyline (keeps points further than `tolerance` from the simplified line). */
export function simplifyLoop(loop: Array<[number, number]>, tolerance: number): Array<[number, number]> {
  if (loop.length < 4) return loop;
  const keep = new Uint8Array(loop.length);
  const dist = (p: [number, number], a: [number, number], b: [number, number]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  // split the loop at its first point and the point furthest from it
  let far = 0;
  for (let i = 1; i < loop.length; i++) if (dist(loop[i], loop[0], loop[0]) > dist(loop[far], loop[0], loop[0])) far = i;
  const stack: Array<[number, number]> = [
    [0, far],
    [far, loop.length],
  ];
  keep[0] = keep[far] = 1;
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const a = loop[i], b = loop[j % loop.length];
    let best = -1, bd = tolerance;
    for (let k = i + 1; k < j; k++) {
      const d = dist(loop[k], a, b);
      if (d > bd) {
        bd = d;
        best = k;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i, best], [best, j]);
    }
  }
  return loop.filter((_, i) => keep[i]);
}

/** Signed area of a closed 2D polyline (positive when counter-clockwise in a y-up frame). */
export function signedArea(loop: ReadonlyArray<readonly [number, number]>): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function insideLoop(p: readonly [number, number], loop: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i], b = loop[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/**
 * Group closed loops into filled shapes with holes (even-odd nesting): a loop
 * inside an even number of others is an outline, one inside an odd number is
 * a hole of the smallest outline around it.
 */
export function nestLoops(loops: Array<Array<[number, number]>>): Array<{ outer: Array<[number, number]>; holes: Array<Array<[number, number]>> }> {
  const order = loops.map((l, i) => ({ l, i, area: Math.abs(signedArea(l)) })).filter((x) => x.l.length >= 3 && x.area > 0).sort((a, b) => b.area - a.area);
  const depth = order.map((x) => order.filter((y) => y !== x && y.area > x.area && insideLoop(x.l[0], y.l)).length);
  const shapes: Array<{ outer: Array<[number, number]>; holes: Array<Array<[number, number]>>; area: number }> = [];
  order.forEach((x, k) => {
    if (depth[k] % 2 === 0) shapes.push({ outer: x.l, holes: [], area: x.area });
  });
  order.forEach((x, k) => {
    if (depth[k] % 2 === 0) return;
    const host = shapes.filter((s) => s.area > x.area && insideLoop(x.l[0], s.outer)).sort((a, b) => a.area - b.area)[0];
    host?.holes.push(x.l);
  });
  return shapes.map(({ outer, holes }) => ({ outer, holes }));
}

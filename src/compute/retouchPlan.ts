import type { Vec3 } from '../core/types';
import type { RetouchPiece } from './retouchAngle';
import { across, FACE_DORSAL, FACE_VENTRAL, INVASIVE_BOUNDARY, OUTLINE_BINS, penetrationAt, rowOf, type SegmentFrame, type SegmentOutline } from './retouchIndex';
import { runSync, YIELD_EVERY, type Steps } from './steps';

/**
 * What the retouch mode draws of the plan: on the model, the lines of the sixteen segments as level lines of the surface;
 * on the page, the outline, those lines and the retouch regions projected onto the plan.
 */

/** Where a surface crosses a level of `values` (one per vertex), as line pieces: x, y, z of both ends of each. `keep`: which triangles count. */
export function* isoLinesSteps(positions: ArrayLike<number>, index: ArrayLike<number>, values: ArrayLike<number>, level: number, keep?: (t: number) => boolean): Steps<number[]> {
  const p = positions;
  const out: number[] = [];
  const tris = Math.floor(index.length / 3);
  const cross = (a: number, b: number) => {
    const s = (level - values[a]) / (values[b] - values[a]);
    out.push(p[3 * a] + s * (p[3 * b] - p[3 * a]), p[3 * a + 1] + s * (p[3 * b + 1] - p[3 * a + 1]), p[3 * a + 2] + s * (p[3 * b + 2] - p[3 * a + 2]));
  };
  for (let t = 0; t < tris; t++) {
    if (t % YIELD_EVERY === 0) yield;
    const a = index[3 * t], b = index[3 * t + 1], c = index[3 * t + 2];
    // a vertex on the level counts as above it, so every crossing is a proper one
    const sa = values[a] >= level, sb = values[b] >= level, sc = values[c] >= level;
    if ((sa === sb && sb === sc) || (keep && !keep(t))) continue;
    if (sa !== sb) cross(a, b);
    if (sb !== sc) cross(b, c);
    if (sc !== sa) cross(c, a);
  }
  return out;
}

export const isoLines = (positions: ArrayLike<number>, index: ArrayLike<number>, values: ArrayLike<number>, level: number): number[] => runSync(isoLinesSteps(positions, index, values, level));

/** The lines of the segments on the model, as line pieces (flat lists, in the coordinates of the positions). */
export interface SegmentLines {
  /** Between the rows. */
  rows: Float32Array;
  /** Between left and right, in rows 2–4. */
  mids: Float32Array;
  /** Between the outer zone and the inner: closed round each face. */
  bounds: Float32Array;
}

export interface SegmentLinesInput {
  positions: ArrayLike<number>;
  index: ArrayLike<number>;
  /** The part of the flake each triangle lies in (`FACE_…`). */
  faceOf: ArrayLike<number>;
  frame: SegmentFrame;
  outline: SegmentOutline;
}

/** Row by row: the segments' lines on the dorsal and ventral faces. Each is a level line of its own field over the vertices. */
export function* segmentLinesSteps(input: SegmentLinesInput): Steps<SegmentLines> {
  const { positions: p, index, faceOf, frame, outline } = input;
  const n = Math.floor(p.length / 3);
  const { origin: o, x: X, y: Y } = frame;
  const onFace = (t: number) => faceOf[t] === FACE_DORSAL || faceOf[t] === FACE_VENTRAL;
  const ys = new Float32Array(n), offMid = new Float32Array(n), reach = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (i % YIELD_EVERY === 0) yield;
    const dx = p[3 * i] - o[0], dy = p[3 * i + 1] - o[1], dz = p[3 * i + 2] - o[2];
    const x = dx * X[0] + dy * X[1] + dz * X[2], y = dx * Y[0] + dy * Y[1] + dz * Y[2];
    ys[i] = y;
    offMid[i] = x - across(outline, y).mid;
    reach[i] = penetrationAt(outline, x, y);
  }
  /** A piece's row, by its middle. */
  const rowOfPiece = (q: readonly number[], at: number): number => {
    const dx = (q[at] + q[at + 3]) / 2 - o[0], dy = (q[at + 1] + q[at + 4]) / 2 - o[1], dz = (q[at + 2] + q[at + 5]) / 2 - o[2];
    return rowOf(outline, dx * Y[0] + dy * Y[1] + dz * Y[2]);
  };
  /** Only the pieces in these rows. */
  const inRows = (q: readonly number[], rows: readonly number[]): number[] => {
    const out: number[] = [];
    for (let at = 0; at + 5 < q.length; at += 6) if (rows.includes(rowOfPiece(q, at))) out.push(q[at], q[at + 1], q[at + 2], q[at + 3], q[at + 4], q[at + 5]);
    return out;
  };
  const rows: number[] = [];
  for (let k = 1; k <= 4; k++) for (const v of yield* isoLinesSteps(p, index, ys, outline.y0 + (k * outline.L) / 5, onFace)) rows.push(v);
  const mids = inRows(yield* isoLinesSteps(p, index, offMid, 0, onFace), [1, 2, 3]);
  const bounds = yield* isoLinesSteps(p, index, reach, INVASIVE_BOUNDARY, onFace);
  return { rows: Float32Array.from(rows), mids: Float32Array.from(mids), bounds: Float32Array.from(bounds) };
}

// ---------------------------------------------------------------- on the page

export type P2 = [number, number];

/** A notch of the outline this many cells wide or less is drawn closed. */
const DRAWN_NOTCH_CELLS = 3;

/** One side of the outline with its narrow notches closed: a cell takes what the line between cells on either side of it reaches, if that is further out. */
function closedNotches(cells: Float64Array, outward: 1 | -1): Float64Array {
  const out = Float64Array.from(cells);
  const n = cells.length;
  for (let i = 0; i < n; i++) {
    let reach = outward * cells[i];
    for (let a = Math.max(0, i - DRAWN_NOTCH_CELLS); a < i; a++) {
      for (let b = i + 1; b <= Math.min(n - 1, i + DRAWN_NOTCH_CELLS); b++) {
        reach = Math.max(reach, outward * (cells[a] + ((cells[b] - cells[a]) * (i - a)) / (b - a)));
      }
    }
    out[i] = outward * reach;
  }
  return out;
}

/**
 * The outline as it is drawn. A cell holds the furthest vertex that falls into it: where the rim's vertices are further apart than the cells, a cell
 * between two of them holds one further in, and the line would be a saw. The indices are worked out on the outline as it is.
 */
export function drawnOutline(o: SegmentOutline): SegmentOutline {
  return { ...o, xL: closedNotches(o.xL, -1), xR: closedNotches(o.xR, 1), yTop: closedNotches(o.yTop, 1), yBot: closedNotches(o.yBot, -1) };
}

/** The plan's lines and segments, in its own coordinates. */
export interface PlanShape {
  /** Up the left side, down the right. */
  outline: P2[];
  /** Between the rows. */
  rows: Array<[P2, P2]>;
  /** Up the middle of rows 2–4. */
  mid: P2[];
  /** Between the outer zone and the inner: closed; more than one only where a notch splits an end. */
  bounds: P2[][];
  segments: Array<{ segment: number; at: P2; polygon: P2[] }>;
}

const CELLS_PER_ROW = OUTLINE_BINS / 5;

/** Where a field crosses a level over a grid of these columns and rows, as closed lines: what lies on the grid's border counts as below the level. */
function levelRings(xs: readonly number[], ys: readonly number[], field: (x: number, y: number) => number, level: number): P2[][] {
  const w = xs.length, h = ys.length, n = w * h;
  const values = new Float64Array(n);
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) values[j * w + i] = field(xs[i], ys[j]);
  // a crossed edge of the grid, by its two nodes, is joined to the other crossed edge of each of its two triangles
  const joined = new Map<number, number[]>();
  const edge = (a: number, b: number) => (a < b ? a * n + b : b * n + a);
  const triangle = (a: number, b: number, c: number) => {
    const crossed: number[] = [];
    if (values[a] >= level !== values[b] >= level) crossed.push(edge(a, b));
    if (values[b] >= level !== values[c] >= level) crossed.push(edge(b, c));
    if (values[c] >= level !== values[a] >= level) crossed.push(edge(c, a));
    if (crossed.length !== 2) return;
    for (const [from, to] of [crossed, [crossed[1], crossed[0]]]) {
      const list = joined.get(from);
      if (list) list.push(to);
      else joined.set(from, [to]);
    }
  };
  for (let j = 0; j + 1 < h; j++)
    for (let i = 0; i + 1 < w; i++) {
      const a = j * w + i;
      triangle(a, a + 1, a + w + 1);
      triangle(a, a + w + 1, a + w);
    }
  const pointOn = (e: number): P2 => {
    const a = Math.floor(e / n), b = e - a * n;
    const s = (level - values[a]) / (values[b] - values[a]);
    const [xa, ya, xb, yb] = [xs[a % w], ys[Math.floor(a / w)], xs[b % w], ys[Math.floor(b / w)]];
    return [xa + s * (xb - xa), ya + s * (yb - ya)];
  };
  const rings: P2[][] = [];
  const seen = new Set<number>();
  for (const start of joined.keys()) {
    if (seen.has(start)) continue;
    const ring: P2[] = [];
    let from = -1, at = start;
    do {
      seen.add(at);
      ring.push(pointOn(at));
      const [one, two] = joined.get(at)!;
      const next = one === from ? two : one;
      from = at;
      at = next;
    } while (at !== start);
    rings.push(ring);
  }
  return rings;
}

/** The shape on the plan from the outline's cells. */
export function planShape(o: SegmentOutline): PlanShape {
  // (the first and last cells' points at the very ends, so that the outline reaches them)
  const yOf = (i: number) => (i === 0 ? o.y0 : i === OUTLINE_BINS - 1 ? o.y0 + o.L : o.y0 + ((i + 0.5) * o.L) / OUTLINE_BINS);
  const mid = (i: number) => (o.xL[i] + o.xR[i]) / 2;
  const half = (i: number) => (o.xR[i] - o.xL[i]) / 2;
  const up = (from: number, to: number, x: (i: number) => number): P2[] => {
    const out: P2[] = [];
    for (let i = from; i < to; i++) out.push([x(i), yOf(i)]);
    return out;
  };
  const outline = [...up(0, OUTLINE_BINS, (i) => o.xL[i]), ...up(0, OUTLINE_BINS, (i) => o.xR[i]).reverse()];
  const rows: Array<[P2, P2]> = [];
  for (let k = 1; k <= 4; k++) {
    const i = k * CELLS_PER_ROW;
    const y = o.y0 + (k * o.L) / 5;
    rows.push([[o.xL[i], y], [o.xR[i], y]]);
  }
  const middle = [CELLS_PER_ROW, 4 * CELLS_PER_ROW] as const;
  const nodes = (from: number, span: number) => Array.from({ length: OUTLINE_BINS + 1 }, (_, i) => from + (i * span) / OUTLINE_BINS);
  const bounds = levelRings(nodes(o.xMin, o.xMax - o.xMin), nodes(o.y0, o.L), (x, y) => penetrationAt(o, x, y), INVASIVE_BOUNDARY);
  // a segment's number stands clear of the line between its zones, which runs through its middle
  const inner = 0.35;
  const whole = (row: number, segment: number) => {
    const from = row * CELLS_PER_ROW, to = from + CELLS_PER_ROW;
    const c = from + Math.round((row === 0 ? 1 - inner : inner) * CELLS_PER_ROW);
    return { segment, at: [mid(c), yOf(c)] as P2, polygon: [...up(from, to, (i) => o.xL[i]), ...up(from, to, (i) => o.xR[i]).reverse()] };
  };
  const parted = (row: number, segment: number, right: boolean) => {
    const from = row * CELLS_PER_ROW, to = from + CELLS_PER_ROW;
    const c = from + CELLS_PER_ROW / 2;
    const polygon = right ? [...up(from, to, mid), ...up(from, to, (i) => o.xR[i]).reverse()] : [...up(from, to, (i) => o.xL[i]), ...up(from, to, mid).reverse()];
    return { segment, at: [mid(c) + (right ? inner : -inner) * half(c), yOf(c)] as P2, polygon };
  };
  const segments = [whole(0, 1)];
  for (let row = 1; row <= 3; row++) segments.push(parted(row, 2 * row, false), parted(row, 2 * row + 1, true));
  segments.push(whole(4, 8));
  return { outline, rows, mid: up(middle[0], middle[1], mid), bounds, segments };
}

/** The retouch regions of one layer on one face, on the plan: closed loops round them. */
export interface PlanLoops {
  face: 'dorsal' | 'ventral';
  layer: number;
  loops: P2[][];
}

export interface PlanRegionsInput {
  positions: ArrayLike<number>;
  index: ArrayLike<number>;
  faceOf: ArrayLike<number>;
  pieceOfFace: ArrayLike<number>;
  pieces: ReadonlyMap<number, RetouchPiece>;
  frame: SegmentFrame;
}

/** The borders of the retouch regions, projected: far fewer points than their triangles, whatever the size of the scan. */
export function* planRegionsSteps(input: PlanRegionsInput): Steps<PlanLoops[]> {
  const { positions: p, index, faceOf, pieceOfFace, pieces, frame } = input;
  const n = Math.floor(p.length / 3);
  const tris = Math.floor(index.length / 3);
  const groups = new Map<string, { face: 'dorsal' | 'ventral'; layer: number; edges: Set<number> }>();
  for (let t = 0; t < tris; t++) {
    if (t % YIELD_EVERY === 0) yield;
    const piece = pieces.get(pieceOfFace[t]);
    const f = faceOf[t];
    if (!piece || (f !== FACE_DORSAL && f !== FACE_VENTRAL)) continue;
    const key = `${f}|${piece.layer}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { face: f === FACE_DORSAL ? 'dorsal' : 'ventral', layer: piece.layer, edges: new Set() }));
    const a = index[3 * t], b = index[3 * t + 1], c = index[3 * t + 2];
    g.edges.add(a * n + b);
    g.edges.add(b * n + c);
    g.edges.add(c * n + a);
  }
  const flat = (v: number): P2 => {
    const q: Vec3 = [p[3 * v] - frame.origin[0], p[3 * v + 1] - frame.origin[1], p[3 * v + 2] - frame.origin[2]];
    return [q[0] * frame.x[0] + q[1] * frame.x[1] + q[2] * frame.x[2], q[0] * frame.y[0] + q[1] * frame.y[1] + q[2] * frame.y[2]];
  };
  const out: PlanLoops[] = [];
  for (const g of groups.values()) {
    yield;
    // an edge whose other way round is not in the group lies on its border
    const next = new Map<number, number[]>();
    let seen = 0;
    for (const e of g.edges) {
      if (++seen % YIELD_EVERY === 0) yield;
      const a = Math.floor(e / n), b = e - a * n;
      if (g.edges.has(b * n + a)) continue;
      const list = next.get(a);
      if (list) list.push(b);
      else next.set(a, [b]);
    }
    const loops: P2[][] = [];
    for (const start of next.keys()) {
      if (++seen % YIELD_EVERY === 0) yield;
      for (let v: number | undefined = next.get(start)?.pop(), from = start; v !== undefined; ) {
        const loop: P2[] = [flat(from), flat(v)];
        // on round, until the line comes back or stops
        while (v !== start) {
          const list: number[] | undefined = next.get(v);
          const w: number | undefined = list?.pop();
          if (w === undefined) break;
          loop.push(flat(w));
          v = w;
        }
        loops.push(loop);
        from = start;
        v = next.get(start)?.pop();
      }
    }
    out.push({ face: g.face, layer: g.layer, loops });
  }
  return out.sort((a, b) => a.layer - b.layer);
}

export const planRegions = (input: PlanRegionsInput): PlanLoops[] => runSync(planRegionsSteps(input));

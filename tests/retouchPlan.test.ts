import { describe, expect, it } from 'vitest';
import { buildEdges, signedVolume } from '../src/compute/meshGeometry';
import { retouchSections, sectionAtStation, type RetouchPiece } from '../src/compute/retouchAngle';
import { FACE_DORSAL, FACE_NONE, FACE_VENTRAL, penetrationAt, removedVolumeCurveSteps, retouchIndices, segmentAt, segmentFrame, segmentOutlineSteps, stationFaces, type RetouchIndexInput, type SegmentFrame } from '../src/compute/retouchIndex';
import { drawnOutline, isoLines, planRegions, planShape, segmentLinesSteps, type P2 } from '../src/compute/retouchPlan';
import { runSync } from '../src/compute/steps';
import { defaultRetouchSettings, type Vec3 } from '../src/core/types';
import { planDrawing, primsMarkup, PRINT_PALETTE, PX_PER_MM, SCREEN_PALETTE, sectionDrawing, sectionModel, svgFile } from '../src/render/retouchDrawing';
import { retouchPrism, type Mesh, type RetouchPrismKind } from './meshes';

/** A flat grid, x in [0, n], y in [0, n], unit squares. */
function grid(n: number): Mesh {
  const pos: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pos.push(i, j, 0);
  const v = (i: number, j: number) => j * (n + 1) + i;
  const idx: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) idx.push(v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j), v(i + 1, j + 1), v(i, j + 1));
  return { positions: new Float32Array(pos), index: new Uint32Array(idx) };
}

describe('level lines', () => {
  const m = grid(4);
  const xs = Float32Array.from({ length: 25 }, (_, i) => m.positions[3 * i]);
  it('in a triangle, by its corners: all at the level, as long as the surface is across', () => {
    const line = isoLines(m.positions, m.index, xs, 2.5);
    expect(line.length % 6).toBe(0);
    let total = 0;
    for (let i = 0; i < line.length; i += 6) {
      expect(line[i]).toBeCloseTo(2.5, 5);
      expect(line[i + 3]).toBeCloseTo(2.5, 5);
      total += Math.hypot(line[i + 3] - line[i], line[i + 4] - line[i + 1]);
    }
    expect(total).toBeCloseTo(4, 5);
  });
  it('a vertex on the level counts as above it: one line, no doubles', () => {
    const line = isoLines(m.positions, m.index, xs, 2);
    let total = 0;
    for (let i = 0; i < line.length; i += 6) total += Math.hypot(line[i + 3] - line[i], line[i + 4] - line[i + 1]);
    expect(total).toBeCloseTo(4, 5);
  });
  it('off the surface: none', () => {
    expect(isoLines(m.positions, m.index, xs, 9)).toEqual([]);
  });
});

/** The plate of the invasiveness test: x in [−10, 10], y in [0, 40], z in [0, 2], top and bottom only. */
function plate(): { m: Mesh; faceOf: Uint8Array } {
  const nx = 40, ny = 80;
  const pos: number[] = [];
  const v = (z: number, i: number, j: number) => z * (nx + 1) * (ny + 1) + j * (nx + 1) + i;
  for (const z of [0, 2]) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) pos.push(-10 + i / 2, j / 2, z);
  const idx: number[] = [];
  const face: number[] = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      idx.push(v(1, i, j), v(1, i + 1, j), v(1, i + 1, j + 1), v(1, i, j), v(1, i + 1, j + 1), v(1, i, j + 1));
      face.push(FACE_DORSAL, FACE_DORSAL);
      idx.push(v(0, i, j), v(0, i + 1, j + 1), v(0, i + 1, j), v(0, i, j), v(0, i, j + 1), v(0, i + 1, j + 1));
      face.push(FACE_VENTRAL, FACE_VENTRAL);
    }
  return { m: { positions: new Float32Array(pos), index: new Uint32Array(idx) }, faceOf: Uint8Array.from(face) };
}

const PLATE_FRAME: SegmentFrame = { kind: 'technical', origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], y0: 0, y1: 40 };

describe('the lines of the segments', () => {
  const { m, faceOf } = plate();
  const outline = runSync(segmentOutlineSteps(m.positions, PLATE_FRAME));
  const lines = runSync(segmentLinesSteps({ positions: m.positions, index: m.index, faceOf, frame: PLATE_FRAME, outline }));
  const pieces = (a: Float32Array): Array<[number, number, number, number]> => {
    const out: Array<[number, number, number, number]> = [];
    for (let i = 0; i < a.length; i += 6) out.push([a[i], a[i + 1], a[i + 3], a[i + 4]]);
    return out;
  };
  const length = (a: Array<[number, number, number, number]>) => a.reduce((s, p) => s + Math.hypot(p[2] - p[0], p[3] - p[1]), 0);

  it('between the rows: at every fifth of the length, across both faces', () => {
    const r = pieces(lines.rows);
    for (const p of r) {
      expect([8, 16, 24, 32].some((y) => Math.abs(p[1] - y) < 1e-3)).toBe(true);
      expect(Math.abs(p[1] - p[3])).toBeLessThan(1e-3);
    }
    expect(length(r)).toBeCloseTo(4 * 20 * 2, 1);
  });
  it('the middle: down rows 2–4 only', () => {
    const r = pieces(lines.mids);
    for (const p of r) {
      expect(Math.abs(p[0])).toBeLessThan(1e-3);
      expect(Math.min(p[1], p[3])).toBeGreaterThanOrEqual(8 - 1e-3);
      expect(Math.max(p[1], p[3])).toBeLessThanOrEqual(32 + 1e-3);
    }
    expect(length(r)).toBeCloseTo(24 * 2, 0);
  });
  it('between the outer zone and the inner: a closed line half way in from the sides and the ends, on each face', () => {
    const r = pieces(lines.bounds);
    for (const p of r) {
      expect(Math.abs(penetrationAt(outline, p[0], p[1]) - 0.5)).toBeLessThan(0.03);
      expect(Math.abs(penetrationAt(outline, p[2], p[3]) - 0.5)).toBeLessThan(0.03);
    }
    // x = ±5 from y = 4 to y = 36, y = 4 and y = 36 from x = −5 to x = 5 (the corners cut within a cell of the mesh)
    expect(Math.abs(length(r) - 2 * (2 * 32 + 2 * 10))).toBeLessThan(2);
    // every end of a piece is the end of another: no loose ends
    const ends = new Map<string, number>();
    for (const p of r) for (const key of [`${p[0].toFixed(3)},${p[1].toFixed(3)}`, `${p[2].toFixed(3)},${p[3].toFixed(3)}`]) ends.set(key, (ends.get(key) ?? 0) + 1);
    expect([...ends.values()].every((n) => n % 2 === 0)).toBe(true);
  });
  it('only on the two faces', () => {
    const none = runSync(segmentLinesSteps({ positions: m.positions, index: m.index, faceOf: new Uint8Array(faceOf.length), frame: PLATE_FRAME, outline }));
    expect([none.rows.length, none.mids.length, none.bounds.length]).toEqual([0, 0, 0]);
  });
});

describe('the plan', () => {
  const { m, faceOf } = plate();
  const outline = runSync(segmentOutlineSteps(m.positions, PLATE_FRAME));
  const shape = planShape(drawnOutline(outline));

  it('the outline, up the left and down the right; the rows, the middle, the zones', () => {
    const xs = shape.outline.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(-10, 5);
    expect(Math.max(...xs)).toBeCloseTo(10, 5);
    expect(shape.outline.slice(0, 200).every((p) => p[0] < 0)).toBe(true);
    expect(shape.outline[0][1]).toBeLessThan(shape.outline[199][1]);
    expect(shape.rows.map((r) => r[0][1])).toEqual([8, 16, 24, 32]);
    expect(shape.rows[0][0][0]).toBeCloseTo(-10, 5);
    expect(shape.rows[0][1][0]).toBeCloseTo(10, 5);
    expect(shape.mid.every((p) => Math.abs(p[0]) < 1e-3 && p[1] > 8 && p[1] < 32)).toBe(true);
  });

  it('the line between the zones: one closed ring, on p = 0.5, joined to the sides at both ends', () => {
    expect(shape.bounds.length).toBe(1);
    const ring = shape.bounds[0];
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(-5, 1);
    expect(Math.max(...xs)).toBeCloseTo(5, 1);
    expect(Math.min(...ys)).toBeCloseTo(4, 1);
    expect(Math.max(...ys)).toBeCloseTo(36, 1);
    for (const p of ring) expect(Math.abs(penetrationAt(outline, p[0], p[1]) - 0.5)).toBeLessThan(0.03);
    // each step of it is short: it has no gaps, and it comes round to its start
    ring.forEach((p, i) => {
      const q = ring[(i + 1) % ring.length];
      expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(0.5);
    });
    // on past the end rows' limits, the sides stay where they are
    expect(ring.some((p) => Math.abs(Math.abs(p[0]) - 5) < 1e-3 && p[1] > 33)).toBe(true);
    expect(ring.some((p) => Math.abs(Math.abs(p[0]) - 5) < 1e-3 && p[1] < 7)).toBe(true);
  });

  it('a notch in the end: the line follows it, and it is the same level line as what is measured', () => {
    const notched = { ...outline, yTop: outline.yTop.map((v, i) => (i > 80 && i < 120 ? 34 : v)) };
    const ring = planShape(notched).bounds.flat();
    expect(Math.max(...ring.filter((p) => Math.abs(p[0]) < 1).map((p) => p[1]))).toBeCloseTo(33, 0);
    expect(Math.max(...ring.map((p) => p[1]))).toBeCloseTo(36, 0);
  });

  it('how far in: from the sides; in the end rows also from the end, and the two run on across the rows', () => {
    expect(penetrationAt(outline, 0, 20)).toBeCloseTo(1, 6);
    expect(penetrationAt(outline, -7, 20)).toBeCloseTo(0.3, 6);
    expect(penetrationAt(outline, 0, 38)).toBeCloseTo(0.25, 6);
    expect(penetrationAt(outline, -9, 38)).toBeCloseTo(0.1, 6);
    expect(penetrationAt(outline, 0, 2)).toBeCloseTo(0.25, 6);
    expect(penetrationAt(outline, 9, 2)).toBeCloseTo(0.1, 6);
    // on either side of a row's line, the same
    for (const y of [8, 32]) expect(penetrationAt(outline, -7, y + 1e-6)).toBeCloseTo(penetrationAt(outline, -7, y - 1e-6), 3);
  });

  it('eight segments, where segmentAt says they are', () => {
    expect(shape.segments.map((s) => s.segment)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const at = (n: number) => shape.segments.find((s) => s.segment === n)!.at;
    expect(at(1)[1]).toBeCloseTo(5.2, 0);
    expect(at(8)[1]).toBeCloseTo(34.8, 0);
    expect(at(2)[0]).toBeCloseTo(-3.5, 3);
    expect(at(3)[0]).toBeCloseTo(3.5, 3);
    expect(at(4)[1]).toBeCloseTo(20, 0);
    // each number in its own segment, in the inner zone, clear of the line between the zones
    for (const s of shape.segments) {
      expect(segmentAt(outline, s.at[0], s.at[1])).toBe(s.segment);
      expect(penetrationAt(outline, s.at[0], s.at[1])).toBeGreaterThan(0.55);
    }
  });

  it('a saw of a rim, when drawn, is the rim; a wide notch stays', () => {
    const saw = { ...outline, xR: outline.xR.map((v, i) => (i % 3 ? v - 3 : v)), xL: outline.xL.map((v) => v) };
    const drawn = drawnOutline(saw);
    expect(Math.min(...Array.from(drawn.xR).slice(3, 197))).toBeCloseTo(10, 5);
    const notch = { ...outline, xR: outline.xR.map((v, i) => (i > 80 && i < 120 ? v - 3 : v)) };
    expect(drawnOutline(notch).xR[100]).toBeCloseTo(7, 5);
    // what is measured is left alone
    expect(saw.xR[1]).toBeCloseTo(7, 5);
  });

  it('the retouch regions: loops round each layer on each face', () => {
    const pieceOfFace = new Uint32Array(faceOf.length);
    const tris = m.index.length / 3;
    for (let t = 0; t < tris; t++) {
      const cx = (m.positions[3 * m.index[3 * t]] + m.positions[3 * m.index[3 * t + 1]] + m.positions[3 * m.index[3 * t + 2]]) / 3;
      const cy = (m.positions[3 * m.index[3 * t] + 1] + m.positions[3 * m.index[3 * t + 1] + 1] + m.positions[3 * m.index[3 * t + 2] + 1]) / 3;
      if (cx < -5 && cy > 10 && cy < 20) pieceOfFace[t] = faceOf[t] === FACE_DORSAL ? 1 : 2;
      if (cx > 5 && cy > 25 && cy < 30) pieceOfFace[t] = faceOf[t] === FACE_DORSAL ? 3 : 0;
    }
    const pieces = new Map<number, RetouchPiece>([[1, { region: 'A', layer: 1 }], [2, { region: 'B', layer: 2 }], [3, { region: 'C', layer: 1 }]]);
    const loops = planRegions({ positions: m.positions, index: m.index, faceOf, pieceOfFace, pieces, frame: PLATE_FRAME });
    expect(loops.map((l) => [l.layer, l.face, l.loops.length])).toEqual([[1, 'dorsal', 2], [2, 'ventral', 1]]);
    const area = (ring: readonly P2[]) => {
      let s = 0;
      ring.forEach((p, i) => {
        const q = ring[(i + 1) % ring.length];
        s += p[0] * q[1] - q[0] * p[1];
      });
      return Math.abs(s) / 2;
    };
    expect(loops[0].loops.map(area).sort((a, b) => a - b)).toEqual([25, 50]);
    expect(area(loops[1].loops[0])).toBeCloseTo(50, 5);
  });

  const drawing = (face: 'dorsal' | 'ventral', extra: Partial<Parameters<typeof planDrawing>[0]> = {}) =>
    planDrawing({ shape, loops: [], face, station: { at: [-10, 20], index: 7 }, longest: null, highlight: null, tag: 'Technical axis', palette: PRINT_PALETTE, unit: 'mm', width: 300, height: 400, ...extra });
  const textAt = (d: ReturnType<typeof drawing>, text: string) => d.prims.find((p) => p.kind === 'text' && p.text === text) as { x: number; y: number } | undefined;

  it('the proximal end down and X to the right, the ventral face not mirrored', () => {
    const d = drawing('dorsal');
    expect(textAt(d, '1')!.y).toBeGreaterThan(textAt(d, '8')!.y);
    expect(textAt(d, '3')!.x).toBeGreaterThan(textAt(d, '2')!.x);
    const v = drawing('ventral');
    expect(textAt(v, '1')).toBeUndefined();
    expect(textAt(v, '11')!.x).toBeCloseTo(textAt(d, '3')!.x, 6);
    expect(textAt(v, '9')!.y).toBeCloseTo(textAt(d, '1')!.y, 6);
  });
  it('from the page to the plan and back', () => {
    const d = drawing('dorsal');
    const [x, y] = d.toPage([3, 25]);
    const back = d.toPlan(x, y);
    expect(back[0]).toBeCloseTo(3, 6);
    expect(back[1]).toBeCloseTo(25, 6);
    expect(d.toPage([0, 40])[1]).toBeLessThan(d.toPage([0, 0])[1]);
  });
  it('a segment marked, on its own face only', () => {
    const ids = (d: ReturnType<typeof drawing>) => d.prims.flatMap((p) => (p.kind === 'path' && p.id ? [p.id] : []));
    expect(ids(drawing('dorsal', { highlight: 4 }))).toContain('retouch-plan-highlight');
    expect(ids(drawing('ventral', { highlight: 4 }))).not.toContain('retouch-plan-highlight');
    expect(ids(drawing('ventral', { highlight: 12 }))).toContain('retouch-plan-highlight');
  });
  it('to scale, it has a size on paper; with no unit, no scale bar', () => {
    const d = drawing('dorsal', { pxPerUnit: PX_PER_MM });
    expect(d.widthMm).toBeCloseTo(20 * 1.16, 3);
    // (with room for the scale bar under it)
    expect(d.heightMm).toBeCloseTo(40 * 1.16 + 28 / PX_PER_MM, 3);
    expect(svgFile(d, 'x')).toMatch(/width="23\.2mm" height="53\.81mm"/);
    const plain = drawing('dorsal', { unit: null });
    expect(plain.widthMm).toBeNull();
    expect(plain.prims.some((p) => p.id === 'retouch-plan-scale')).toBe(false);
    expect(d.prims.some((p) => p.id === 'retouch-plan-scale')).toBe(true);
  });
  it('for a publication: white under everything, and no variable of the page', () => {
    const svg = svgFile(drawing('dorsal', { pxPerUnit: PX_PER_MM }), 'x');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).not.toContain('var(--');
    expect(primsMarkup(drawing('dorsal', { palette: SCREEN_PALETTE }).prims, 'x')).toContain('var(--ink)');
  });
});

// ------------------------------------------------------------ the section

const edge = (): Vec3[] => Array.from({ length: 61 }, (_, i) => [4, 5 + i / 2, 0]);
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function prismInput(kind: RetouchPrismKind) {
  const m = retouchPrism(kind);
  const faceOf = new Uint8Array(m.side.length);
  const pieceOf = new Uint32Array(m.side.length);
  m.side.forEach((s, t) => {
    faceOf[t] = s === 'AR' || s === 'RC' || s === 'CF' || s === 'AC' ? FACE_DORSAL : s === null ? FACE_NONE : FACE_VENTRAL;
    pieceOf[t] = s === 'AR' ? 1 : s === 'RvA' ? 2 : 0;
  });
  const pieces = new Map<number, RetouchPiece>();
  if (kind !== 'inverse') pieces.set(1, { region: 'R1', layer: 1 });
  if (kind === 'bifacial' || kind === 'inverse') pieces.set(2, { region: 'R2', layer: 1 });
  const e = buildEdges(m.index, m.positions.length / 3);
  let s = 0;
  for (let i = 0; i < e.v0.length; i++) {
    const a = 3 * e.v0[i], b = 3 * e.v1[i];
    s += Math.hypot(m.positions[a] - m.positions[b], m.positions[a + 1] - m.positions[b + 1], m.positions[a + 2] - m.positions[b + 2]);
  }
  const meanEdge = s / e.v0.length;
  const angleInput = { positions: m.positions, index: m.index, points: edge(), closed: false, unit: 'mm', meanEdge, pieceOfFace: pieceOf, pieces };
  const sec = retouchSections(angleInput)!;
  const frame = segmentFrame({ positions: m.positions, index: m.index, faceOf, settings: defaultRetouchSettings(), matrix: identity, morph: null, specimenFrame: null });
  const input: RetouchIndexInput = { positions: m.positions, index: m.index, faceOf, pieceOfFace: pieceOf, pieces, curves: [{ curveId: 'C1', edge: true, closed: false, length: sec.length, stations: sec.result.stations, sections: sec.sections }], unit: 'mm', meanEdge, volume: Math.abs(signedVolume(m.positions, m.index)), fitLength: null, frame };
  return { m, faceOf, pieceOf, pieces, meanEdge, angleInput, sec, input, result: retouchIndices(input) };
}

describe('the section on the page', () => {
  const T30 = Math.tan(Math.PI / 6);
  const model = (kind: RetouchPrismKind, k: number, layer: number | null = null) => {
    const p = prismInput(kind);
    const section = p.sec.sections[k]!;
    const detail = p.result.details.find((d) => d.station === k)!;
    return sectionModel(section, detail, stationFaces(section, p.faceOf, p.pieceOf, p.pieces, p.meanEdge), layer);
  };
  const near = (a: readonly number[], b: readonly number[], within = 1e-3) => {
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(within);
  };

  it('A at the origin, the ventral line along u away from the edge, the dorsal side up', () => {
    const m = model('unifacial', 10);
    near(m.A0!, [-4, 0]);
    near(m.R[0], [4, 8 * T30]);
    near(m.C!, [16, 20 * T30]);
    near(m.T![0], [16, 20 * T30]);
    near(m.T![1], [16, 0]);
    near(m.t![0], [4, 8 * T30]);
    near(m.t![1], [4, 0]);
    expect(m.fits.map((f) => [f.face, Math.round(f.length * 1000) / 1000])).toEqual([['dorsal', 5], ['ventral', 5]]);
    // the fitted stretches run on from R and A, away from the edge
    near(m.fits[0].points[0], [4, 8 * T30]);
    near(m.fits[1].points[0], [0, 0]);
    expect(m.fits[1].points[m.fits[1].points.length - 1][0]).toBeCloseTo(5, 3);
    // the lines go on to where they meet
    for (const l of m.lines) near(l[1], [-4, 0]);
    // the whole section is closed and has the polygon's corners on it
    expect(m.section.closed).toBe(true);
    const whole = m.wholeBox;
    expect(whole.u0).toBeCloseTo(0, 3);
    expect(whole.u1).toBeCloseTo(36, 3);
    expect(whole.v1).toBeCloseTo(20 * T30, 3);
  });

  it('the missing area is what was measured', () => {
    const m = model('unifacial', 10);
    let s = 0;
    m.missing!.forEach((p, i) => {
      const q = m.missing![(i + 1) % m.missing!.length];
      s += p[0] * q[1] - q[0] * p[1];
    });
    expect(Math.abs(s) / 2).toBeCloseTo(9.2376, 2);
  });

  it('the frame: A0, A, the stretches, C, t and T; the whole section apart', () => {
    const m = model('unifacial', 10);
    expect(m.box.u0).toBeCloseTo(-4, 3);
    expect(m.box.u1).toBeCloseTo(16, 3);
    expect(m.box.v0).toBeCloseTo(0, 3);
    expect(m.box.v1).toBeCloseTo(20 * T30, 3);
  });

  it('bifacial: the runs on both sides, no t, no T, and no C without a ridge', () => {
    const m = model('bifacial', 10);
    expect(m.runs.length).toBe(2);
    expect(m.t).toBeNull();
    expect(m.T).toBeNull();
    expect(m.C).toBeNull();
    expect(m.R.length).toBe(2);
    expect(m.fits[0].face).toBe('dorsal');
    // u along the ventral line, away from the edge: its stretch ends further out along u than it starts
    const v = m.fits[1].points;
    expect(v[v.length - 1][0]).toBeGreaterThan(v[0][0]);
  });

  it('inverse: t over the inner end of the retouch, from the dorsal surface to the ventral line; T at the top', () => {
    const m = model('inverse', 10);
    // the page's u runs along the ventral line: A is 2 above it, and the retouch ends on it
    expect(m.R.length).toBe(1);
    expect(m.fits.map((f) => f.face)).toEqual(['dorsal', 'ventral']);
    const [top, foot] = m.t!;
    expect(Math.hypot(top[0] - foot[0], top[1] - foot[1])).toBeCloseTo(5, 2);
    near(foot, m.R[0]);
    expect(top[1]).toBeGreaterThan(foot[1]);
    expect(Math.abs(top[0] - foot[0])).toBeLessThan(1e-3);
    expect(Math.hypot(m.T![0][0] - m.T![1][0], m.T![0][1] - m.T![1][1])).toBeCloseTo(14, 2);
    near(m.C!, m.T![0]);
  });

  it('a layer shown: where it ends, and as far along the other side', () => {
    const m = model('unifacial', 10, 1);
    near(m.overlay!.Pk, [4, 8 * T30]);
    near(m.overlay!.Q!, [Math.hypot(4, 8 * T30), 0]);
    expect(model('unifacial', 10, 3).overlay).toBeNull();
  });

  it('a station with no retouch of its own: the section alone, A to the far end along u', () => {
    const p = prismInput('flat');
    const section = sectionAtStation({ ...p.angleInput, pieces: new Map() }, 10)!;
    expect(section.runs).toEqual([[], []]);
    const m = sectionModel(section, null, stationFaces(section, p.faceOf, p.pieceOf, new Map(), p.meanEdge));
    expect(m.fits).toEqual([]);
    expect(m.missing).toBeNull();
    near([m.box.u0, m.box.v0], [m.wholeBox.u0, m.wholeBox.v0]);
    // the far corner lies on the u axis
    expect(Math.abs(m.section.points.reduce((best, q) => (Math.hypot(q[0], q[1]) > Math.hypot(best[0], best[1]) ? q : best))[1])).toBeLessThan(1e-3);
  });

  it('the same section cut when it is asked for', () => {
    const p = prismInput('unifacial');
    const kept = p.sec.sections[10]!;
    const now = sectionAtStation(p.angleInput, 10)!;
    expect(now.A[1]).toBeCloseTo(kept.A[1], 9);
    expect(now.ways[0].length).toBeCloseTo(kept.ways[0].length, 6);
    expect(now.runs).toEqual(kept.runs);
    expect(sectionAtStation(p.angleInput, 99)).toBeNull();
  });

  it('the drawing: every part, at the margin the frame asks for; on white for a publication', () => {
    const m = model('unifacial', 10);
    const d = sectionDrawing(m, { palette: PRINT_PALETTE, whole: false, minWidth: 5, unit: 'mm', width: 400, height: 300 });
    const ids = d.prims.flatMap((p) => (p.id ? [p.id] : []));
    for (const id of ['retouch-section-outline', 'retouch-section-missing', 'retouch-section-run-0', 'retouch-section-fit-0', 'retouch-section-fit-1', 'retouch-section-line-0', 'retouch-section-line-1', 'retouch-section-a', 'retouch-section-a0', 'retouch-section-r-0', 'retouch-section-c', 'retouch-section-t', 'retouch-section-T', 'retouch-section-scale']) expect(ids).toContain(id);
    for (const l of ['A', 'A₀', 'R', 'C', 't', 'T', 'w']) expect(ids).toContain(`retouch-section-label-${l}`);
    const markup = primsMarkup(d.prims, 'p');
    expect(markup).toContain('<pattern');
    expect(markup).not.toContain('var(--');
    // the frame takes in 20 units across and 11.5 up with 15 % round them
    const scale = Math.min(400 / (20 * 1.3), 300 / (11.547 * 1.3));
    const a0 = d.prims.find((p) => p.id === 'retouch-section-a0') as { x: number };
    expect(a0.x).toBeCloseTo(200 - 10 * scale, 1);
    // to scale: a size on paper, from the frame
    const paper = sectionDrawing(m, { palette: PRINT_PALETTE, whole: false, minWidth: 5, unit: 'mm', width: 400, height: 300, pxPerUnit: PX_PER_MM });
    expect(paper.widthMm).toBeCloseTo(20 * 1.3, 3);
    // (with room for the letters over it and the scale bar under it)
    expect(paper.heightMm).toBeCloseTo(11.547 * 1.3 + (14 + 28) / PX_PER_MM, 2);
    // the narrowest it goes
    const small = sectionDrawing({ ...m, box: { u0: 0, u1: 1, v0: 0, v1: 1 } }, { palette: PRINT_PALETTE, whole: false, minWidth: 5, unit: null, width: 400, height: 300, pxPerUnit: PX_PER_MM });
    expect(small.widthMm).toBeCloseTo(5 * 1.3, 3);
    expect(small.prims.some((p) => p.id === 'retouch-section-scale')).toBe(false);
  });
});

describe('the volume removed along a range of fitted lengths', () => {
  it('as the indices have it at each; where they have none, none', () => {
    const p = prismInput('unifacial');
    const curve = runSync(removedVolumeCurveSteps(p.input, [2, 5, 10, 30]));
    expect(curve.map((c) => c.length)).toEqual([2, 5, 10, 30]);
    for (const c of curve.slice(0, 3)) expect(Math.abs(c.removed! - 277.13)).toBeLessThan(2.8);
    expect(curve[3].removed).toBeNull();
    const none = prismInput('flat');
    expect(runSync(removedVolumeCurveSteps(none.input, [5]))[0].removed).toBeNull();
    const empty = prismInput('unifacial');
    expect(runSync(removedVolumeCurveSteps({ ...empty.input, pieces: new Map() }, [5]))[0].removed).toBeNull();
  });
  it('the longest stretch: the chord and its depth on the plan', () => {
    const { result } = prismInput('unifacial');
    expect(result.longest?.curveId).toBe('C1');
    expect(result.longest?.a[1]).toBeCloseTo(5, 3);
    expect(result.longest?.b[1]).toBeCloseTo(35, 3);
    expect(result.segmentStations[0].length).toBe(31);
  });
});

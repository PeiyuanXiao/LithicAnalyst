import { describe, expect, it } from 'vitest';
import { EPA_DISTANCES_MM, flakeMeasures, FLAKE_MEASURES, morphDimensions, type FlakeMeasure, type FlakeResult } from '../src/compute/flake';
import { arcAngle, boxHint, flakeHint, noduleHint, sharpHint, splitHint, stationsHint, wholeModelHint, type HintArc, type HintDots, type HintFaces, type HintLine, type HintPrim, type MeasureHint } from '../src/compute/measureHint';
import { buildEdges, surfaceArea, signedVolume } from '../src/compute/meshGeometry';
import { frameMeasures, surfaceMeasures } from '../src/compute/measure';
import { splitByLoopSteps, splitByPlaneSteps, type SplitParts } from '../src/compute/split';
import { runSync } from '../src/compute/steps';
import { technicalFrame } from '../src/compute/technicalFrame';
import type { SpecimenFrame, Vec3 } from '../src/core/types';
import { box, flakeT1, mapped, rigid, sphere, T1, type Mesh } from './meshes';

const TOLERANCE = 1e-9;
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(TOLERANCE);

const sub = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const size = (a: readonly number[]) => Math.hypot(a[0], a[1], a[2]);
const lengthOf = (l: HintLine): number => {
  let s = 0;
  for (let i = 1; i < l.points.length; i++) s += size(sub(l.points[i], l.points[i - 1]));
  return s;
};

const line = (h: readonly HintPrim[], part: string): HintLine => {
  const p = h.find((x) => x.kind === 'line' && x.part === part);
  if (!p) throw new Error(`no line ${part}`);
  return p as HintLine;
};
const arcOf = (h: readonly HintPrim[]): HintArc => h.find((x) => x.kind === 'arc') as HintArc;
const dots = (h: readonly HintPrim[], part: string, role?: string): Vec3[] => h.filter((x): x is HintDots => x.kind === 'dots' && x.part === part && (!role || x.role === role)).flatMap((d) => [...d.points]);

const meanEdge = (m: Mesh): number => {
  const e = buildEdges(m.index, m.positions.length / 3);
  let s = 0;
  for (let i = 0; i < e.v0.length; i++) s += size(sub([m.positions[3 * e.v0[i]], m.positions[3 * e.v0[i] + 1], m.positions[3 * e.v0[i] + 2]], [m.positions[3 * e.v1[i]], m.positions[3 * e.v1[i] + 1], m.positions[3 * e.v1[i] + 2]]));
  return s / e.v0.length;
};

/** The triangles of T1's platform. */
function platformOf(m: Mesh, f: (p: Vec3) => Vec3): { faces: Uint32Array; area: number } {
  const a = f(T1.P), b = f(T1.E), c = f(T1.ends[1]);
  const u = sub(b, a), v = sub(c, a);
  const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const pt = (w: number): Vec3 => [m.positions[3 * w], m.positions[3 * w + 1], m.positions[3 * w + 2]];
  const on = (w: number) => Math.abs(dot(sub(pt(w), a), n)) / size(n) < 1e-3;
  const faces: number[] = [];
  let area = 0;
  for (let t = 0; t < m.index.length / 3; t++) {
    const [x, y, z] = [m.index[3 * t], m.index[3 * t + 1], m.index[3 * t + 2]];
    if (!on(x) || !on(y) || !on(z)) continue;
    faces.push(t);
    area += triangleArea(pt(x), pt(y), pt(z));
  }
  return { faces: Uint32Array.from(faces), area };
}

function triangleArea(a: Vec3, b: Vec3, c: Vec3): number {
  const u = sub(b, a), v = sub(c, a);
  return 0.5 * size([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
}

/** T1 annotated, moved and turned, its positions relative to an offset as the app holds them. */
function measured(): { r: FlakeResult; m: Mesh; offset: Vec3 } {
  const f = rigid([1, 2, -0.5], 73, [120, -40, 15]);
  const m = mapped(flakeT1(), f);
  const offset: Vec3 = [120, -40, 15];
  const local: Mesh = { positions: m.positions.map((x, i) => x - offset[i % 3]), index: m.index };
  const edge = meanEdge(m);
  const fr = technicalFrame({ positions: m.positions, index: m.index, meanEdge: edge }, f(T1.P), f(T1.A));
  if (!fr.ok) throw new Error('no frame');
  const plat = platformOf(m, f);
  const r = flakeMeasures({ positions: local.positions, index: local.index, offset, matrix: fr.matrix, P: f(T1.P), ends: T1.ends.map(f), platformFaces: plat.faces, platformArea: plat.area, unit: 'mm', meanEdge: edge, morph: morphDimensions(local.positions) });
  return { r, m, offset };
}

describe('what the hints draw comes back to the numbers', () => {
  const { r, m, offset } = measured();
  const hint = (k: FlakeMeasure): MeasureHint => {
    const h = flakeHint(k, r, 'mm');
    if (!h) throw new Error(`no hint for ${k}`);
    return h;
  };
  const v = r.measures;

  it('every measure of the annotated flake has one', () => {
    for (const k of FLAKE_MEASURES) expect(v[k], k).not.toBeNull();
    for (const k of FLAKE_MEASURES) expect(flakeHint(k, r, 'mm'), k).not.toBeNull();
  });

  it('technical length, width and thickness: the three lines, the box, the axis, the vertices that reached them', () => {
    for (const k of ['tech_length', 'tech_width', 'tech_thickness'] as const) {
      const h = hint(k);
      close(lengthOf(line(h, 'length')), v.tech_length!);
      close(lengthOf(line(h, 'width')), v.tech_width!);
      close(lengthOf(line(h, 'thickness')), v.tech_thickness!);
      expect(line(h, k.slice(5)).role).toBe('current');
      for (const other of ['length', 'width', 'thickness'].filter((s) => s !== k.slice(5))) expect(line(h, other).role).toBe('other');
      expect(line(h, k.slice(5)).label).toMatch(/ mm$/);
      // from P along +Y, to the largest Y
      const axis = line(h, 'axis');
      close(size(sub(axis.points[0], r.construction.tech!.origin)), 0);
      close(lengthOf(axis), v.tech_length!);
      // twelve edges: four of each side's length
      const edges = line(h, 'box');
      expect(edges.segments).toBe(true);
      expect(edges.points).toHaveLength(24);
      const sizes: number[] = [];
      for (let i = 0; i < 24; i += 2) sizes.push(size(sub(edges.points[i + 1], edges.points[i])));
      for (const want of [v.tech_width!, v.tech_length!, v.tech_thickness!]) expect(sizes.filter((s) => Math.abs(s - want) < TOLERANCE)).toHaveLength(4);
    }
    const c = r.construction.tech!;
    const [x, y, z] = c.axes;
    close(dot(sub(c.extremes.yMax, c.origin), y), v.tech_length!);
    close(dot(sub(c.extremes.xMax, c.extremes.xMin), x), v.tech_width!);
    close(dot(sub(c.extremes.zMax, c.extremes.zMin), z), v.tech_thickness!);
    expect(dots(hint('tech_length'), 'extremes', 'current')).toEqual([c.extremes.yMax]);
    expect(dots(hint('tech_width'), 'extremes', 'current')).toEqual([c.extremes.xMin, c.extremes.xMax]);
  });

  it('morphological length, width and thickness: the farthest pair, then the lines across', () => {
    const h = hint('morph_width');
    close(lengthOf(line(h, 'length')), v.morph_length!);
    close(lengthOf(line(h, 'width')), v.morph_width!);
    close(lengthOf(line(h, 'thickness')), v.morph_thickness!);
    expect(line(h, 'width').role).toBe('current');
    const c = r.construction.morph!;
    // the pair are vertices, and as far apart as said
    close(size(sub(c.length[1], c.length[0])), v.morph_length!);
    expect(dots(hint('morph_length'), 'extremes', 'current')).toEqual([...c.length]);
    // the lines lie across the length, and across each other
    const u = sub(c.length[1], c.length[0]), w = sub(c.width[1], c.width[0]), t = sub(c.thickness[1], c.thickness[0]);
    expect(Math.abs(dot(u, w)) / (size(u) * size(w))).toBeLessThan(1e-9);
    expect(Math.abs(dot(u, t)) / (size(u) * size(t))).toBeLessThan(1e-9);
    expect(Math.abs(dot(w, t)) / (size(w) * size(t))).toBeLessThan(1e-9);
    // the vertices reach as far across as the lines say
    close(Math.abs(dot(sub(c.widthVertices[1], c.widthVertices[0]), w)) / size(w), v.morph_width!);
    close(Math.abs(dot(sub(c.thicknessVertices[1], c.thicknessVertices[0]), t)) / size(t), v.morph_thickness!);
  });

  it('the angle of the two axes: from one point, the arc between them', () => {
    const h = hint('morph_tech_angle_deg');
    const tech = line(h, 'technical-axis'), morph = line(h, 'morphological-axis');
    expect(tech.points[0]).toEqual(morph.points[0]);
    close(arcAngle(arcOf(h))!, v.morph_tech_angle_deg!);
    expect(arcOf(h).at).toEqual(tech.points[0]);
    close(size(sub(arcOf(h).from, r.construction.angle!.tech)), 0);
    expect(arcOf(h).label).toBe(`${v.morph_tech_angle_deg!.toFixed(1)}°`);
  });

  it('the platform\'s width and depth: the straight line and the way over the surface, the ends as dots', () => {
    for (const [chord, path, a, b] of [['platform_width_chord', 'platform_width_path', ...r.construction.width!.ends], ['platform_depth_chord', 'platform_depth_path', r.construction.depth!.P, r.construction.depth!.E]] as Array<[FlakeMeasure, FlakeMeasure, Vec3, Vec3]>) {
      const h = hint(chord);
      close(lengthOf(line(h, 'chord')), v[chord]!);
      close(lengthOf(line(h, 'path')), v[path]!);
      expect(line(h, 'chord').role).toBe('current');
      expect(line(h, 'path').role).toBe('other');
      expect(line(hint(path), 'path').role).toBe('current');
      expect(dots(h, 'ends')).toEqual([a, b]);
    }
  });

  it('the platform\'s area: the triangles of the platform, seen through the model', () => {
    const [f] = hint('platform_area') as HintFaces[];
    expect(f.through).toBe(true);
    const faces = f.faces as Uint32Array;
    const pt = (w: number): Vec3 => [m.positions[3 * w], m.positions[3 * w + 1], m.positions[3 * w + 2]];
    let area = 0;
    for (const t of faces) area += triangleArea(pt(m.index[3 * t]), pt(m.index[3 * t + 1]), pt(m.index[3 * t + 2]));
    close(area, v.platform_area!);
  });

  it('EPA, each distance and method: the section, P and Q, the lines or the chord, the arc', () => {
    const p = r.construction.profile!;
    EPA_DISTANCES_MM.forEach((d, i) => {
      for (const method of ['3pt', '2ln'] as const) {
        const key = `epa_${method}_${d}mm` as FlakeMeasure;
        const h = hint(key);
        close(arcAngle(arcOf(h))!, v[key]!);
        expect(arcOf(h).at).toEqual(p.E);
        expect(line(h, 'section').points).toBe(p.section);
        expect(line(h, 'platform-line').points).toBe(p.platformLine);
        expect(dots(h, 'points')).toEqual([p.P, p.E, p.q[i]]);
        if (method === '3pt') expect(line(h, 'to-q').points).toEqual([p.E, p.q[i]]);
        else {
          expect(line(h, 'chord').points).toBe(p.chords[i]);
          close(lengthOf(line(h, 'chord')), 0.5);
        }
        expect(dots(h, 'other-distances')).toHaveLength(2);
      }
    });
  });

  it('IPA: the platform line, the line of the ventral face, the arc', () => {
    const h = hint('ipa');
    close(arcAngle(arcOf(h))!, v.ipa!);
    const p = r.construction.profile!;
    expect(line(h, 'ventral').points).toBe(p.ventral);
    // the arc's sides run along the two lines
    const onPlatform = sub(line(h, 'platform-line').points[1], line(h, 'platform-line').points[0]);
    const onVentral = sub(line(h, 'ventral-line').points[1], line(h, 'ventral-line').points[0]);
    expect(Math.abs(dot(onPlatform, arcOf(h).from)) / size(onPlatform)).toBeCloseTo(1, 9);
    expect(Math.abs(dot(onVentral, arcOf(h).to)) / size(onVentral)).toBeCloseTo(1, 9);
  });

  it('positions relative to an offset: all in original coordinates', () => {
    const at = r.construction.tech!.extremes.yMax;
    // it is a vertex of the mesh as given in original coordinates
    let best = Infinity;
    for (let i = 0; i < m.positions.length; i += 3) best = Math.min(best, size(sub([m.positions[i], m.positions[i + 1], m.positions[i + 2]], at)));
    expect(best).toBeLessThan(1e-4);
    expect(size(offset)).toBeGreaterThan(0);
    close(size(sub(r.construction.depth!.P, r.geometry.P!)), 0);
  });

  it('an empty value draws nothing', () => {
    const empty: FlakeResult = flakeMeasures({ positions: m.positions, index: m.index, matrix: null, P: null, ends: [], platformFaces: null, platformArea: null, unit: 'mm', meanEdge: 1, morph: null });
    for (const k of FLAKE_MEASURES) expect(flakeHint(k, empty, 'mm')).toBeNull();
    // with the axis and no platform: the box, and nothing of the platform
    const fr = technicalFrame({ positions: flakeT1().positions, index: flakeT1().index, meanEdge: meanEdge(flakeT1()) }, T1.P, T1.A);
    if (!fr.ok) throw new Error('no frame');
    const noPlatform = flakeMeasures({ positions: flakeT1().positions, index: flakeT1().index, matrix: fr.matrix, P: T1.P, ends: [], platformFaces: null, platformArea: null, unit: 'mm', meanEdge: 1, morph: null });
    expect(flakeHint('tech_length', noPlatform, 'mm')).not.toBeNull();
    expect(flakeHint('morph_length', noPlatform, 'mm')).toBeNull();
    for (const k of ['platform_area', 'platform_width_chord', 'epa_3pt_1mm', 'ipa'] as const) expect(flakeHint(k, noPlatform, 'mm')).toBeNull();
    // no unit: no EPA, the rest stands
    const f = rigid([0, 0, 1], 0, [0, 0, 0]);
    const plat = platformOf(flakeT1(), f);
    const noUnit = flakeMeasures({ positions: flakeT1().positions, index: flakeT1().index, matrix: fr.matrix, P: T1.P, ends: T1.ends, platformFaces: plat.faces, platformArea: plat.area, unit: '', meanEdge: meanEdge(flakeT1()), morph: null });
    expect(flakeHint('epa_3pt_2mm', noUnit, '')).toBeNull();
    expect(flakeHint('platform_depth_chord', noUnit, '')).not.toBeNull();
    expect(line(flakeHint('platform_depth_chord', noUnit, '')!, 'chord').label).not.toMatch(/mm/);
  });
});

describe('the other measures', () => {
  it('surface area and volume: the whole model, whose measures they are', () => {
    const m = sphere(10, 3);
    const base = surfaceMeasures(m.positions, m.index);
    close(surfaceArea(m.positions, m.index), base.surfaceArea);
    close(Math.abs(signedVolume(m.positions, m.index)), base.volume!);
    expect(wholeModelHint()).toEqual([{ kind: 'faces', part: 'model', tint: 'current', faces: 'all', through: false }]);
  });

  it('a core\'s length, width and thickness: the box along the frame, and three lines of those lengths', () => {
    const m = mapped(box([40, 20, 10], 4), rigid([1, -1, 2], 33, [5, 6, 7]));
    const offset: Vec3 = [5, 6, 7];
    const local = m.positions.map((x, i) => x - offset[i % 3]);
    const base = surfaceMeasures(local, m.index);
    const along: SpecimenFrame = { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], source: 'view' };
    for (const frame of [null, along]) {
      const { auto, box: b } = frameMeasures(local, base, frame, offset);
      const h = boxHint('width', b, auto, 'mm');
      close(lengthOf(line(h, 'length')), auto.length);
      close(lengthOf(line(h, 'width')), auto.width);
      close(lengthOf(line(h, 'thickness')), auto.thickness);
      expect(line(h, 'width').role).toBe('current');
      expect(line(h, 'length').role).toBe('other');
      const edges = line(h, 'box');
      const sizes: number[] = [];
      for (let i = 0; i < 24; i += 2) sizes.push(size(sub(edges.points[i + 1], edges.points[i])));
      for (const want of [auto.length, auto.width, auto.thickness]) expect(sizes.filter((s) => Math.abs(s - want) < TOLERANCE).length).toBeGreaterThanOrEqual(4);
    }
  });

  it('the split by a plane: the plane drawn is the one split by, each triangle on its side, the two exchanged', () => {
    const cube = box([2, 2, 2], 4);
    const offset: Vec3 = [10, 20, 30];
    const s = runSync(splitByPlaneSteps(cube.positions, cube.index, [0, 0, 0.5], [0, 0, 1]));
    expect(s.upper).toBeCloseTo(2, 9);
    expect(s.parts.kind).toBe('plane');
    const h = splitHint(s.parts, false, offset, 10);
    const circle = line(h, 'split-plane');
    expect(circle.closed).toBe(true);
    for (const p of circle.points) close(p[2], 30.5);
    const faces = (part: string) => [...((h.find((x) => x.kind === 'faces' && x.part === part) as HintFaces).faces as Uint32Array)];
    // a triangle goes with the side holding more of its corners
    const above = (t: number) => [0, 1, 2].filter((k) => cube.positions[3 * cube.index[3 * t + k] + 2] >= 0.5).length;
    expect(faces('upper').length + faces('lower').length).toBe(cube.index.length / 3);
    for (const t of faces('upper')) expect(above(t)).toBeGreaterThanOrEqual(2);
    for (const t of faces('lower')) expect(above(t)).toBeLessThan(2);
    // swapped: the same drawing with the two sides exchanged
    const swapped = splitHint(s.parts, true, offset, 10);
    expect([...((swapped.find((x) => x.kind === 'faces' && x.part === 'upper') as HintFaces).faces as Uint32Array)]).toEqual(faces('lower'));
  });

  it('the split along a curve: the chain of mesh edges, and the volumes summed over the two sides give the numbers', () => {
    const cube = box([2, 2, 2], 4);
    const vc = cube.positions.length / 3;
    const edges = buildEdges(cube.index, vc);
    const z = (w: number) => cube.positions[3 * w + 2];
    const ring: number[] = [];
    for (let e = 0; e < edges.v0.length; e++) if (z(edges.v0[e]) === 0.5 && z(edges.v1[e]) === 0.5) ring.push(edges.v0[e], edges.v1[e]);
    const s = runSync(splitByLoopSteps(cube.positions, cube.index, edges, ring, [0, 0, 1]))!;
    const parts = s.parts as Extract<SplitParts, { kind: 'loop' }>;
    const tet = (t: number) => {
      const pt = (w: number) => sub([cube.positions[3 * w], cube.positions[3 * w + 1], cube.positions[3 * w + 2]], parts.reference);
      const [a, b, c] = [pt(cube.index[3 * t]), pt(cube.index[3 * t + 1]), pt(cube.index[3 * t + 2])];
      return (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    };
    let upper = 0, lower = 0;
    parts.upper.forEach((on, t) => {
      if (on) upper += tet(t);
      else lower += tet(t);
    });
    close(Math.abs(upper), s.upper);
    close(Math.abs(lower), s.lower);
    const h = splitHint(s.parts, false, [1, 1, 1], 10);
    const chain = line(h, 'split-curve');
    expect(chain.segments).toBe(true);
    expect(chain.points).toHaveLength(ring.length);
    for (const p of chain.points) close(p[2], 1.5);
  });

  it('what the results keep is the volumes only', () => {
    const cube = box([2, 2, 2], 2);
    const s = runSync(splitByPlaneSteps(cube.positions, cube.index, [0, 0, 0], [0, 0, 1]));
    expect(Object.keys(s).sort()).toEqual(['lower', 'parts', 'ratio', 'upper']);
  });

  it('a curve of edge angles: the curve and as many stations as the row says', () => {
    const pts: Vec3[] = [[0, 0, 0], [10, 0, 0]];
    const stations = [0, 2, 4, 6].map((x) => ({ point: [x, 0, 0] as Vec3 }));
    const h = stationsHint({ points: pts, closed: false }, [...stations, { point: null }]);
    expect(line(h, 'curve').points).toBe(pts);
    expect(dots(h, 'stations')).toHaveLength(4);
  });

  it('the sharp stretches: run by run, the value on the longest', () => {
    const pts: Vec3[] = [[0, 0, 0], [20, 0, 0]];
    const stations = Array.from({ length: 11 }, (_, k) => ({ point: [2 * k, 0, 0] as Vec3 }));
    const mask = stations.map((_, k) => k < 2 || (k >= 4 && k <= 8));
    const h = sharpHint({ points: pts, closed: false }, stations, { mask, length: 12 }, 'mm');
    const runs = h.filter((x): x is HintLine => x.kind === 'line' && x.part === 'sharp');
    expect(runs.map(lengthOf)).toEqual([2, 8]);
    expect(runs[1].label).toBe('12.000 mm');
    expect(runs[0].label).toBeUndefined();
  });

  it('the sphere of the cortex: a radius of that length from its centre', () => {
    const fit = { center: [1, 2, 3] as Vec3, radius: 40 };
    const h = noduleHint(fit, 'mm');
    close(lengthOf(line(h, 'radius')), 40);
    expect(line(h, 'radius').points[0]).toEqual(fit.center);
    for (const c of h.filter((x): x is HintLine => x.kind === 'line' && x.part === 'sphere')) for (const p of c.points) close(size(sub(p, fit.center)), 40);
  });
});

import { describe, expect, it } from 'vitest';
import { BSA_LEVEL_DEFAULT_MM, BSA_MIN_PROMINENCE, bsaSettingsOf, bulb, planeCoords, proximalPlane, referencePlane, surfaceOver } from '../src/compute/bulb';
import { compareObservers } from '../src/compute/agreement';
import { batchSpecimen, iccCsv, type BatchProject } from '../src/io/batch';
import { AGREEMENT_FLAKE_MEASURES, emptyFlakeMeasures, flakeMeasures, FLAKE_PROXIMAL_COLUMNS, type FlakeInput, type FlakeMeasures, type FlakeResult } from '../src/compute/flake';
import { flakeHint, type HintArc, type MeasureHint } from '../src/compute/measureHint';
import { setBsaEnds, setBsaLevel } from '../src/core/actions';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import { flakesCsv } from '../src/io/csv';
import { buildEdges, meshTopology, signedVolume } from '../src/compute/meshGeometry';
import { frameMatrix } from '../src/core/frame';
import type { Vec3 } from '../src/core/types';
import { flakeT8, T8, t8Bulb, t8Dorsal, T8_RETOUCH, type Mesh } from './meshes';
import { IPA_BAND_END, IPA_BAND_FALLBACK_START } from '../src/compute/ipa';

const deg = (r: number) => (r * 180) / Math.PI;
const m = flakeT8(true);
const n = m.positions.length / 3;
const edges = buildEdges(m.index, n);
const meanEdge = (() => {
  let s = 0;
  for (let i = 0; i < edges.v0.length; i++) {
    const a = 3 * edges.v0[i], b = 3 * edges.v1[i];
    s += Math.hypot(m.positions[a] - m.positions[b], m.positions[a + 1] - m.positions[b + 1], m.positions[a + 2] - m.positions[b + 2]);
  }
  return s / edges.v0.length;
})();
const IDENTITY = frameMatrix({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], origin: [0, 0, 0] });
/** The two platform ends: on the platform's top edge, 6 mm either side. */
const ENDS: [Vec3, Vec3] = [[-6, 0, t8Dorsal(6)], [6, 0, t8Dorsal(6)]];

function platformArea(): number {
  let a = 0;
  for (const t of m.platform) {
    const p = [0, 1, 2].map((j) => [0, 1, 2].map((k) => m.positions[3 * m.index[3 * t + j] + k]));
    const u = p[1].map((x, k) => x - p[0][k]), w = p[2].map((x, k) => x - p[0][k]);
    a += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
  }
  return a;
}

function run(o: Partial<FlakeInput> = {}): FlakeResult {
  return flakeMeasures({
    positions: m.positions,
    index: m.index,
    matrix: IDENTITY,
    P: [0, 0, 0],
    ends: ENDS,
    platformFaces: m.platform,
    platformArea: platformArea(),
    unit: 'mm',
    meanEdge,
    morph: null,
    ventralFaces: m.ventral,
    bsa: { level: BSA_LEVEL_DEFAULT_MM, ends: null },
    edges,
    ...o,
  });
}

// ------------------------------------------------------------ what T8 should give, from its functions alone

/** The ventral surface's height (z) at (x, y). */
const surfaceZ = (x: number, y: number) => -t8Bulb(Math.hypot(x, y), deg(Math.atan2(x, y)));

/**
 * The BSA's reference near P (32b): the plane its robust fit within 10 mm of P comes to once the bulb is left out, the flat ventral face
 * under the bulb, z = 0 (z = αx + βy + γ, all three nought).
 */
const PLANE = { alpha: 0, beta: 0, gamma: 0 };
const NORM = Math.hypot(PLANE.alpha, PLANE.beta, 1);
/** The height over that plane, outward (away from the dorsal face). */
const heightAt = (x: number, y: number) => (PLANE.alpha * x + PLANE.beta * y + PLANE.gamma - surfaceZ(x, y)) / NORM;
const heightPolar = (r: number, p: number) => heightAt(r * Math.sin((p * Math.PI) / 180), r * Math.cos((p * Math.PI) / 180));

/** The bulb's extent round P at a level: the farthest angles each way at which the height reaches it. */
function bulbSpread(level: number): { right: number; left: number } {
  const edge = (sign: number) => {
    let best = 0;
    for (let r = 0.005; r < T8.Rb; r += 0.005) {
      if (heightPolar(r, 0) < level) continue;
      let lo = 0, hi = sign * T8.phi2;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        if (heightPolar(r, mid) >= level) lo = mid;
        else hi = mid;
      }
      if (Math.abs(lo) > Math.abs(best)) best = lo;
    }
    return best;
  };
  return { right: edge(1), left: edge(-1) };
}

/** The bulb's top: along φ = 0, where the height is greatest. */
const APEX = (() => {
  let best = { r: 0, h: -Infinity };
  for (let r = 0; r < T8.Rb; r += 0.0005) {
    const h = heightPolar(r, 0);
    if (h > best.h) best = { r, h };
  }
  return best;
})();

/** The vertical interval of the strip w wide from P to the top: the range of the heights over it. */
function viOf(w: number): number {
  let hi = -Infinity, lo = Infinity;
  for (let y = 0; y <= APEX.r; y += 0.005)
    for (let x = -w / 2; x <= w / 2 + 1e-12; x += 0.005) {
      const h = heightAt(x, y);
      hi = Math.max(hi, h);
      lo = Math.min(lo, h);
    }
  return hi - lo;
}

/** The ventral profile in the section x = 0 from P: the point at arc length s. */
function profileAt(s: number): Vec3 {
  const dy = 1e-5;
  let y = 0, z = 0, len = 0;
  while (len < s) {
    const z1 = -t8Bulb(y + dy, 0);
    const step = Math.hypot(dy, z1 - z);
    if (len + step >= s) {
      const f = (s - len) / step;
      return [0, y + f * dy, z + f * (z1 - z)];
    }
    len += step;
    y += dy;
    z = z1;
  }
  return [0, y, z];
}
const angleOf = (u: Vec3, v: Vec3) => deg(Math.acos((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v))));

describe('T8, the bulb', () => {
  it('is closed and outward', () => {
    expect(meshTopology(m.index, n).closed).toBe(true);
    expect(signedVolume(m.positions, m.index)).toBeGreaterThan(0);
    expect(m.ventral.length + m.platform.length + m.dorsal.length).toBe(m.index.length / 3);
  });

  const r = run();

  it('the ventral surface over a place of the plane (an end let go with Shift): there, on the face; none off the face', () => {
    const plane = referencePlane(m.positions, m.index, m.ventral, [0, 0, -1], [0, 1, 0])!;
    for (const X of [[1, 2, 0], [-3, 5, 0], [0.3, 0.4, 0], [6, 9, 0]] as Vec3[]) {
      const [u, v] = planeCoords(plane, X);
      const p = surfaceOver(m.positions, m.index, m.ventral, plane, u, v)!;
      const [pu, pv] = planeCoords(plane, p);
      expect(Math.abs(pu - u) + Math.abs(pv - v)).toBeLessThan(1e-9);
      expect(Math.abs(p[2] + t8Bulb(Math.hypot(p[0], p[1]), deg(Math.atan2(p[0], p[1]))))).toBeLessThan(0.01);
    }
    // behind the platform there is no ventral face
    const [u, v] = planeCoords(plane, [0, -5, 0]);
    expect(surfaceOver(m.positions, m.index, m.ventral, plane, u, v)).toBeNull();
  });

  it('PSIA: the angle at P between the lines to the platform ends (±0.01°)', () => {
    expect(r.measures.psia).toBeCloseTo(angleOf(ENDS[0], ENDS[1]), 2);
    expect(Math.abs(r.measures.psia! - angleOf(ENDS[0], ENDS[1]))).toBeLessThan(0.01);
    expect(r.construction.psia).toEqual({ P: [0, 0, 0], ends: ENDS });
  });

  it('the bulb angle at 1 mm, three points and two lines, from the platform line (P to E, here +Z) toward the distal end (±1°)', () => {
    const Q = profileAt(1);
    const three = angleOf([0, 0, 1], Q);
    const a = profileAt(0.75), b = profileAt(1.25);
    const two = angleOf([0, 0, 1], [b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    expect(three).toBeGreaterThan(100);
    expect(three).toBeLessThan(150);
    expect(Math.abs(r.measures.bulb_angle_3pt_1mm! - three)).toBeLessThan(1);
    expect(Math.abs(r.measures.bulb_angle_2ln_1mm! - two)).toBeLessThan(1);
    // its points, for the profile panel and the hint
    expect(r.geometry.bulbAt).toEqual([0, 0, 0]);
    expect(Math.hypot(...(r.geometry.bulbQ as Vec3).map((x, i) => x - Q[i]))).toBeLessThan(0.02);
    expect(r.geometry.bulbChord).not.toBeNull();
  });

  it('the reference plane: the ventral face\'s near P, the bulb left out (z = 0), its normal away from the dorsal side', () => {
    const p = r.construction.plane!;
    const want: Vec3 = [PLANE.alpha / NORM, PLANE.beta / NORM, -1 / NORM];
    expect(angleOf(p.normal, want)).toBeLessThan(0.05);
    expect(Math.abs(p.point[2])).toBeLessThan(0.01);
    // fitted within min(10 mm, half the length) of P; the face is smooth: its noise is small (the bulb's faint foot), far under the bulb
    expect(r.bsaReference!.radius).toBeCloseTo(Math.min(10, 0.5 * r.measures.tech_length!), 9);
    expect(r.bsaReference!.noise).toBeLessThan(0.01);
    expect(p.normal[2]).toBeLessThan(0);
    // +Y laid on it, and X across
    expect(angleOf(p.y, [0, 1, 0])).toBeLessThan(0.5);
    expect(angleOf(p.x, [1, 0, 0])).toBeLessThan(0.5);
  });

  it('BSA: the angle at P between the ends of the bulb\'s outline at 0.1 mm (±2°)', () => {
    const spread = bulbSpread(0.1);
    expect(spread.right).toBeGreaterThan(25);
    expect(Math.abs(r.measures.bsa! - (spread.right - spread.left))).toBeLessThan(2);
    const b = r.construction.bulb!;
    expect(b.moved).toBe(false);
    expect(b.contour.length).toBeGreaterThan(0);
    // the ends lie on either side of the axis, left (−X) first
    expect(b.ends![0][0]).toBeLessThan(0);
    expect(b.ends![1][0]).toBeGreaterThan(0);
    expect(b.ends).toEqual(b.autoEnds);
  });

  it('the bulb\'s top, and the vertical intervals of the three strips (±0.01 mm)', () => {
    const top = r.construction.bulb!.apex!;
    expect(Math.abs(Math.hypot(top[0], top[1]) - APEX.r)).toBeLessThan(0.1);
    const vi = [r.measures.vi_0_5mm, r.measures.vi_1_0mm, r.measures.vi_1_5mm];
    [0.5, 1, 1.5].forEach((w, i) => expect(Math.abs(vi[i]! - viOf(w))).toBeLessThan(0.01));
    // the strips: their corners, their highest and lowest samples
    const strips = r.construction.bulb!.vi!;
    expect(strips.map((s) => s.width)).toEqual([0.5, 1, 1.5]);
    expect(Math.hypot(strips[2].corners[0][0] - strips[2].corners[3][0], strips[2].corners[0][1] - strips[2].corners[3][1])).toBeCloseTo(1.48, 1);
    expect(strips.every((s) => s.high && s.low && s.value !== null)).toBe(true);
  });

  it('the mesh round P: the mean length of the edges within 2 mm', () => {
    const seen = new Set<string>();
    let sum = 0, count = 0;
    const near = (v: number) => Math.hypot(m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]) <= 2;
    for (let t = 0; t < m.index.length / 3; t++)
      for (let j = 0; j < 3; j++) {
        const a = m.index[3 * t + j], b = m.index[3 * t + ((j + 1) % 3)];
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (seen.has(key) || !near(a) || !near(b)) continue;
        seen.add(key);
        sum += Math.hypot(m.positions[3 * a] - m.positions[3 * b], m.positions[3 * a + 1] - m.positions[3 * b + 1], m.positions[3 * a + 2] - m.positions[3 * b + 2]);
        count++;
      }
    expect(r.measures.pop_mesh_edge).toBeCloseTo(sum / count, 9);
    // the same without the list of edges, from the triangles as wound
    expect(run({ edges: null }).measures.pop_mesh_edge).toBeCloseTo(sum / count, 9);
  });

  it('without a unit: no bulb angle, BSA, VI or mesh resolution, and why; PSIA stands', () => {
    const x = run({ unit: '' });
    expect(x.measures.psia).not.toBeNull();
    for (const k of ['bulb_angle_3pt_1mm', 'bulb_angle_2ln_1mm', 'bsa', 'vi_0_5mm', 'vi_1_0mm', 'vi_1_5mm', 'pop_mesh_edge'] as const) {
      expect(x.measures[k]).toBeNull();
      expect(x.reasons[k]).toBe('no_unit');
    }
    // the plane needs no unit: shading by height has it
    expect(x.construction.plane).not.toBeNull();
  });

  it('no ventral face: no BSA and no VI (no_ventral); fewer than two ends: no PSIA (no_ends); no axis: none (no_axis)', () => {
    const x = run({ ventralFaces: null });
    for (const k of ['bsa', 'vi_0_5mm', 'vi_1_0mm', 'vi_1_5mm'] as const) {
      expect(x.measures[k]).toBeNull();
      expect(x.reasons[k]).toBe('no_ventral');
    }
    expect(x.construction.plane).toBeNull();
    const y = run({ ends: [ENDS[0]] });
    expect(y.measures.psia).toBeNull();
    expect(y.reasons.psia).toBe('no_ends');
    const z = run({ P: null, matrix: null });
    for (const k of ['psia', 'bsa', 'bulb_angle_3pt_1mm', 'pop_mesh_edge'] as const) expect(z.reasons[k]).toBe('no_axis');
  });

  it('a level above the bulb\'s top: no bulb (no_bulb)', () => {
    const x = run({ bsa: { level: 0.95, ends: null } });
    expect(x.measures.bsa).toBeNull();
    expect(x.reasons.bsa).toBe('no_bulb');
    expect(x.reasons.vi_1_0mm).toBe('no_bulb');
  });

  it('ends set by hand: the BSA is theirs whatever the level; the top and the strips follow the level', () => {
    const ends = r.construction.bulb!.autoEnds!;
    // one moved a little toward the axis
    const moved: [Vec3, Vec3] = [[ends[0][0] * 0.8, ends[0][1], ends[0][2]], ends[1]];
    const a = run({ bsa: { level: 0.1, ends: moved } });
    const b = run({ bsa: { level: 0.2, ends: moved } });
    expect(a.construction.bulb!.moved).toBe(true);
    expect(a.measures.bsa).toBeLessThan(r.measures.bsa!);
    expect(b.measures.bsa).toBeCloseTo(a.measures.bsa!, 9);
    // the outline follows the level; the top is the bulb's, one peak at both levels
    expect(JSON.stringify(b.construction.bulb!.contour)).not.toBe(JSON.stringify(a.construction.bulb!.contour));
    expect(b.construction.bulb!.apex).toEqual(a.construction.bulb!.apex);
    expect(b.construction.bulb!.ends).toEqual(moved);
    // without them, the level moves the ends too
    expect(run({ bsa: { level: 0.2, ends: null } }).measures.bsa).not.toBeCloseTo(r.measures.bsa!, 3);
    // a level above the top: no bulb, so nothing, ends or no ends (32b: the index is of a bulb)
    const c = run({ bsa: { level: 0.95, ends: moved } });
    expect(c.measures.bsa).toBeNull();
    expect(c.reasons.bsa).toBe('no_bulb');
    expect(c.measures.vi_1_0mm).toBeNull();
    expect(c.construction.bulb!.apex).toBeNull();
  });

  it('the reference plane alone, and the bulb with it', () => {
    const near = proximalPlane(m.positions, m.index, m.ventral, null, [0, 0, 0], 10, [0, 0, -1], [0, 1, 0])!;
    const b = bulb({ positions: m.positions, index: m.index, faces: m.ventral, plane: near.plane, P: [0, 0, 0], mm: 1, level: 0.1, ends: null, noise: near.noise });
    expect(b.bsa).toBeCloseTo(r.measures.bsa!, 9);
    // the bulb was left out of the fit: none of its triangles near the top are among those fitted
    const fitted = new Set(near.fitted);
    const top = b.apex!;
    expect(Array.from(m.ventral).filter((t) => fitted.has(t)).every((t) => [0, 1, 2].some((k) => Math.hypot(m.positions[3 * m.index[3 * t + k]] - top[0], m.positions[3 * m.index[3 * t + k] + 1] - top[1]) > 0.5))).toBe(true);
    // from P on the plane: the bulb runs distally from it, on both sides of the axis
    expect(b.extent!.v0).toBeLessThan(0.01);
    expect(b.extent!.v1).toBeGreaterThan(5);
    expect(b.extent!.u0).toBeLessThan(-1);
    expect(b.extent!.u1).toBeGreaterThan(1);
  });

  it('the columns of flakes.csv end with the proximal measures', () => {
    expect(FLAKE_PROXIMAL_COLUMNS).toEqual(['psia', 'bulb_angle_3pt_1mm', 'bulb_angle_2ln_1mm', 'bsa', 'bsa_level_mm', 'bsa_ends_moved', 'vi_0_5mm', 'vi_1_0mm', 'vi_1_5mm', 'pop_mesh_edge']);
  });
});

describe('the BSA\'s settings', () => {
  const flakeStore = () => {
    const s = new ProjectStore(emptyProject());
    s.state.specimen.type = 'flake';
    return s;
  };

  it('the level: a step, in range, one undo step while typing; the default leaves the key out', () => {
    const s = flakeStore();
    expect(bsaSettingsOf(s.state.flake)).toEqual({ level: 0.1, ends: null });
    setBsaLevel(s, 0.2);
    setBsaLevel(s, 0.25);
    setBsaLevel(s, 0.256);
    expect(s.state.flake.bsa).toEqual({ level: 0.26, ends: null });
    setBsaLevel(s, 7);
    expect(s.state.flake.bsa!.level).toBe(1);
    setBsaLevel(s, -3);
    expect(s.state.flake.bsa!.level).toBe(-1);
    s.history.undo();
    expect(s.state.flake.bsa).toBeUndefined();
    expect(s.history.canUndo).toBe(false);
  });

  it('the ends: kept as set, back to the outline\'s by reset; each an undo step', () => {
    const s = flakeStore();
    const ends: [Vec3, Vec3] = [[-1, 2, 0], [1, 2, 0]];
    setBsaEnds(s, ends);
    expect(s.state.flake.bsa).toEqual({ level: 0.1, ends });
    setBsaLevel(s, 0.3);
    setBsaEnds(s, null);
    expect(s.state.flake.bsa).toEqual({ level: 0.3, ends: null });
    s.history.undo();
    expect(s.state.flake.bsa!.ends).toEqual(ends);
  });

  it('the project file keeps them; a file from before has the default', () => {
    const s = flakeStore();
    setBsaLevel(s, -0.05);
    setBsaEnds(s, [[-1, 2, 0.5], [1, 2, 0.5]]);
    const file = JSON.parse(JSON.stringify(serializeProject(s.state, 'test')));
    expect(file.flake.bsa).toEqual({ level: -0.05, ends: [[-1, 2, 0.5], [1, 2, 0.5]] });
    expect(parseProjectFile(file).flake.bsa).toEqual(s.state.flake.bsa);
    delete file.flake.bsa;
    expect(bsaSettingsOf(parseProjectFile(file).flake)).toEqual({ level: BSA_LEVEL_DEFAULT_MM, ends: null });
    // a file always has them, the default too
    expect(JSON.parse(JSON.stringify(serializeProject(flakeStore().state, 'test'))).flake.bsa).toEqual({ level: 0.1, ends: null });
    // out of range, brought into it; ends that are not two points, dropped
    expect(parseProjectFile({ ...file, flake: { ...file.flake, bsa: { level: 4, ends: [[1, 2]] } } }).flake.bsa).toEqual({ level: 1, ends: null });
  });

  it('flakes.csv: the level and whether the ends were moved, among the proximal columns', () => {
    const s = flakeStore();
    const measures = { ...emptyFlakeMeasures(), psia: 120.5, bsa: 96.4, vi_1_0mm: 0.31 };
    const csv = () => {
      const [head, row] = flakesCsv(s.state, measures, { excelBom: false }).trim().split('\n').map((l) => l.split(','));
      return Object.fromEntries(head.map((k, i) => [k, row[i]]));
    };
    expect(csv()).toMatchObject({ psia: '120.5', bsa: '96.4', bsa_level_mm: '0.1', bsa_ends_moved: 'false', vi_1_0mm: '0.31', vi_0_5mm: '', pop_mesh_edge: '' });
    setBsaLevel(s, 0.15);
    setBsaEnds(s, [[0, 0, 0], [1, 1, 1]]);
    expect(csv()).toMatchObject({ bsa_level_mm: '0.15', bsa_ends_moved: 'true' });
    // a file from before the proximal measures: the columns, empty
    expect(flakesCsv(s.state, { tech_length: 3 } as Partial<FlakeMeasures>, { excelBom: false }).trim().split('\n')[1].split(',').slice(-10)).toEqual(['', '', '', '', '0.15', 'true', '', '', '', '']);
  });
});

/** The bulb's far end at a level: the largest y where the height over the plane reaches it (the bump is one piece). */
function bulbEnd(level: number): number {
  let far = 0;
  for (let r = 0.0025; r < T8.Rb; r += 0.0025)
    for (let p = -T8.phi2; p <= T8.phi2; p += 0.05) if (heightPolar(r, p) >= level) far = Math.max(far, r * Math.cos((p * Math.PI) / 180));
  return far;
}

/** Another T8 measured as T8 is (the frame, P, the ends, its platform and ventral face). */
function runOn(mesh: ReturnType<typeof flakeT8>, o: Partial<FlakeInput> = {}): FlakeResult {
  return run({ positions: mesh.positions, index: mesh.index, platformFaces: mesh.platform, ventralFaces: mesh.ventral, edges: buildEdges(mesh.index, mesh.positions.length / 3), ...o });
}

describe('IPA on T8: the plane of a band of the ventral face (32a)', () => {
  // the platform is the plane y = 0 (its line P→E is +Z), the ventral face below the bulb z = 0 (+Y): 90° between them
  const r = run();

  it('the angle between the platform and the flat ventral face (±0.2°)', () => {
    expect(Math.abs(r.measures.ipa! - 90)).toBeLessThan(0.2);
    expect(r.reasons.ipa).toBeUndefined();
  });

  it('the band: from the bulb\'s far end (within a ring, 0.2 mm, of where the height falls below the level) to 0.75 of the length', () => {
    const band = r.ipaBand!;
    expect(band.fallback).toBe(false);
    const end = bulbEnd(BSA_LEVEL_DEFAULT_MM);
    // the far end is a vertex, on a ring inside the outline
    expect(band.from).toBeLessThanOrEqual(end + 1e-6);
    expect(end - band.from).toBeLessThan(0.2 + 0.01);
    expect(band.to).toBeCloseTo(IPA_BAND_END * r.measures.tech_length!, 9);
    expect(band.area).toBeGreaterThan(0);
    // what was fitted and what left out: the bulb's triangles among the latter
    const c = r.construction.ipa!;
    expect(c.fitted.length).toBeGreaterThan(0);
    const bulbFaces = Array.from(c.excluded).filter((t) => [0, 1, 2].every((k) => Math.hypot(m.positions[3 * m.index[3 * t + k]], m.positions[3 * m.index[3 * t + k] + 1]) < 1));
    expect(bulbFaces.length).toBeGreaterThan(0);
    // the line on the section: in the plane x = 0, along +Y, over the band
    expect(Math.abs(c.line[0][0]) + Math.abs(c.line[1][0])).toBeLessThan(1e-9);
    expect(c.line[0][1]).toBeCloseTo(band.from, 6);
    expect(c.line[1][1]).toBeCloseTo(band.to, 6);
    expect(angleOf(c.dir, [0, 1, 0])).toBeLessThan(0.2);
    // the profile panel's marks: on the section's ventral side, at the band's two ends
    expect(r.geometry.ipaFrom![1]).toBeCloseTo(band.from, 6);
    expect(r.geometry.ipaTo![1]).toBeCloseTo(band.to, 6);
    expect(r.geometry.ipaLine).toEqual(c.line);
  });

  it('a raised level moves the band\'s start with the bulb\'s end', () => {
    const higher = run({ bsa: { level: 0.3, ends: null } });
    expect(higher.ipaBand!.from).toBeLessThan(r.ipaBand!.from);
    expect(bulbEnd(0.3) - higher.ipaBand!.from).toBeLessThan(0.2 + 0.01);
    expect(Math.abs(higher.measures.ipa! - 90)).toBeLessThan(0.2);
  });

  it('retouch in the band, slanted: left out, the angle stands (±0.2°); taken in, it does not', () => {
    const t = flakeT8(true, null, { retouch: true });
    expect(t.retouch.length).toBeGreaterThan(100);
    const left = runOn(t, { leftOutFaces: t.retouch });
    expect(Math.abs(left.measures.ipa! - 90)).toBeLessThan(0.2);
    // every retouched triangle in the band is among those left out
    const excluded = new Set(left.construction.ipa!.excluded);
    const inBand = Array.from(t.retouch).filter((f) => {
      const y = [0, 1, 2].reduce((s, k) => s + t.positions[3 * t.index[3 * f + k] + 1], 0) / 3;
      return y >= left.ipaBand!.from && y <= left.ipaBand!.to;
    });
    expect(inBand.length).toBeGreaterThan(0);
    for (const f of inBand) expect(excluded.has(f)).toBe(true);
    // the control: the same with the patch taken in
    const taken = runOn(t);
    expect(Math.abs(taken.measures.ipa! - 90)).toBeGreaterThan(1);
    expect(T8_RETOUCH.y1).toBeLessThanOrEqual(IPA_BAND_END * T8.R);
  });

  it('a ripple and a few sharp bumps in the band: the angle stands (±0.3°), and the bumps are trimmed', () => {
    const t = flakeT8(true, null, { ripple: true });
    const x = runOn(t);
    expect(Math.abs(x.measures.ipa! - 90)).toBeLessThan(0.3);
    expect(x.ipaBand!.trimmed).toBeGreaterThan(0);
  });

  it('no unit: no bulb, so the band starts at 0.25 of the length, and says so', () => {
    const x = run({ unit: '' });
    expect(x.ipaBand!.fallback).toBe(true);
    expect(x.ipaBand!.from).toBeCloseTo(IPA_BAND_FALLBACK_START * x.measures.tech_length!, 9);
    expect(Math.abs(x.measures.ipa! - 90)).toBeLessThan(0.2);
  });

  it('a band all retouch: too little of it (band_too_small)', () => {
    const x = run({ leftOutFaces: m.ventral });
    expect(x.measures.ipa).toBeNull();
    expect(x.reasons.ipa).toBe('band_too_small');
    expect(x.ipaBand!.area).toBe(0);
    expect(x.construction.ipa).toBeNull();
  });

  it('a level that leaves the bulb open (32b): no bulb to start from, the band from 0.25 of the length', () => {
    const x = run({ bsa: { level: -0.01, ends: null } });
    expect(x.reasons.bsa).toBe('bulb_open');
    expect(x.ipaBand!.fallback).toBe(true);
    expect(x.ipaBand!.from).toBeCloseTo(IPA_BAND_FALLBACK_START * x.measures.tech_length!, 9);
    expect(Math.abs(x.measures.ipa! - 90)).toBeLessThan(0.2);
  });

  it('no ventral face: none (no_ventral)', () => {
    const x = run({ ventralFaces: null });
    expect(x.measures.ipa).toBeNull();
    expect(x.reasons.ipa).toBe('no_ventral');
    expect(x.ipaBand).toBeNull();
  });
});

describe('the proximal measures made robust (32b)', () => {
  const r = run();
  /** A square grid, `step` apart, `half` either side: z = f(x, y), seen as a ventral face from below (outward −Z). */
  function grid(half: number, step: number, f: (x: number, y: number) => number): Mesh & { faces: Uint32Array } {
    const n = Math.round((2 * half) / step);
    const pos: number[] = [], idx: number[] = [];
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n; j++) {
        const x = -half + j * step, y = -half + i * step;
        pos.push(x, y, f(x, y));
      }
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const a = i * (n + 1) + j, b = a + 1, c = a + n + 1, d = c + 1;
        // wound so the normal is −Z
        idx.push(a, c, b, b, c, d);
      }
    return { positions: new Float32Array(pos), index: new Uint32Array(idx), faces: Uint32Array.from({ length: idx.length / 3 }, (_, t) => t) };
  }

  it('the robust fit: a tilted plane with a bump 0.3 mm high and noise; its normal within 0.2°', () => {
    // the plane z = 0.1 x − 0.05 y; the bump 3 mm across, 0.3 mm outward (−z); noise ±0.02 mm, the same each time
    const noise = (x: number, y: number) => {
      const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      return 0.02 * (2 * (s - Math.floor(s)) - 1);
    };
    const g = grid(10, 0.25, (x, y) => 0.1 * x - 0.05 * y - 0.3 * Math.exp(-((x - 2) ** 2 + (y - 3) ** 2) / (2 * 1.5 ** 2)) + noise(x, y));
    const want: Vec3 = [0.1, -0.05, -1];
    const near = proximalPlane(g.positions, g.index, g.faces, null, [0, 0, 0], 10, [0, 0, -1], [0, 1, 0])!;
    expect(angleOf(near.plane.normal, want)).toBeLessThan(0.2);
    // fitted by area alone, the bump would tilt it farther
    const plain = referencePlane(g.positions, g.index, g.faces, [0, 0, -1], [0, 1, 0])!;
    expect(angleOf(plain.normal, want)).toBeGreaterThan(angleOf(near.plane.normal, want));
    // the noise: about the noise's (uniform ±0.02: σ ≈ 0.0115), not the bump's
    expect(near.noise).toBeGreaterThan(0.008);
    expect(near.noise).toBeLessThan(0.02);
  });

  it('a ventral face bent and twisted beyond 10 mm: the BSA and VI as without (±2°, ±0.01 mm)', () => {
    const bent = flakeT8(true, null, { bend: true });
    const x = runOn(bent);
    // the whole face's plane is far off the proximal one; the proximal one is not
    const whole = referencePlane(bent.positions, bent.index, bent.ventral, [0, 0, -1], [0, 1, 0])!;
    expect(angleOf(whole.normal, [0, 0, -1])).toBeGreaterThan(2);
    expect(angleOf(x.construction.plane!.normal, [0, 0, -1])).toBeLessThan(0.05);
    const spread = bulbSpread(0.1);
    expect(Math.abs(x.measures.bsa! - (spread.right - spread.left))).toBeLessThan(2);
    [0.5, 1, 1.5].forEach((w, i) => expect(Math.abs([x.measures.vi_0_5mm, x.measures.vi_1_0mm, x.measures.vi_1_5mm][i]! - viOf(w))).toBeLessThan(0.01));
  });

  // a narrow platform (|x| ≤ 3 mm), its ends at its corners on the dorsal edge, P on the ventral face away from the platform's edge
  const narrow = flakeT8(true, null, { platformHalfWidth: 3 });
  const corners: [Vec3, Vec3] = [[-3, 0, t8Dorsal(3)], [3, 0, t8Dorsal(3)]];
  const offPlatform = (d: number) => runOn(narrow, { P: [0, d, -t8Bulb(d, 0)], ends: corners, platformArea: 1 });

  it('a narrow platform, P 0.8 mm from it: everything, the depth from S at the platform\'s edge', () => {
    const x = offPlatform(0.8);
    for (const k of ['platform_area', 'platform_width_chord', 'platform_width_path', 'platform_depth_chord', 'platform_depth_path', 'epa_3pt_1mm', 'epa_2ln_1mm', 'bulb_angle_3pt_1mm', 'bulb_angle_2ln_1mm', 'ipa'] as const) expect(x.measures[k], k).not.toBeNull();
    // S: where the section meets the platform's edge, (0, 0, 0); E the dorsal edge above it: the depth T8.D
    expect(Math.hypot(...x.construction.depth!.S)).toBeLessThan(1e-6);
    expect(x.measures.platform_depth_chord).toBeCloseTo(T8.D, 6);
    expect(Math.abs(x.measures.platform_depth_path! - T8.D)).toBeLessThan(0.01);
    expect(x.measures.platform_width_chord).toBeCloseTo(6, 6);
    // the bulb angle's vertex is S as well
    expect(x.construction.profile!.bulbAt).toEqual(x.construction.depth!.S);
  });

  it('P 1.5 mm from it: nothing taken on the section (pop_off_platform); the area and width stand', () => {
    const x = offPlatform(1.5);
    for (const k of ['platform_depth_chord', 'platform_depth_path', 'epa_3pt_1mm', 'epa_2ln_3mm', 'bulb_angle_3pt_1mm', 'bulb_angle_2ln_1mm', 'ipa'] as const) {
      expect(x.measures[k], k).toBeNull();
      expect(x.reasons[k], k).toBe('pop_off_platform');
    }
    expect(x.measures.platform_area).not.toBeNull();
    expect(x.measures.platform_width_chord).toBeCloseTo(6, 6);
    expect(x.measures.platform_width_path).not.toBeNull();
  });

  it('a flat ventral face with noise-level relief: no bulb (no_bulb), also where the level lets the noise through; the bulb angle and IPA stand, its band from 0.25', () => {
    const flat = flakeT8(true, null, { flat: true, noise: 0.02 });
    for (const level of [BSA_LEVEL_DEFAULT_MM, 0.01]) {
      const x = runOn(flat, { bsa: { level, ends: null } });
      for (const k of ['bsa', 'vi_0_5mm', 'vi_1_0mm', 'vi_1_5mm'] as const) {
        expect(x.measures[k], k).toBeNull();
        expect(x.reasons[k], k).toBe('no_bulb');
      }
      expect(x.measures.bulb_angle_3pt_1mm).not.toBeNull();
      expect(x.measures.bulb_angle_2ln_1mm).not.toBeNull();
      expect(Math.abs(x.measures.ipa! - 90)).toBeLessThan(0.5);
      expect(x.ipaBand!.fallback).toBe(true);
      expect(x.ipaBand!.from).toBeCloseTo(IPA_BAND_FALLBACK_START * x.measures.tech_length!, 9);
      // the noise as measured: about that of a uniform ±0.02 (σ ≈ 0.0115); the outline at 0.01 lies within it
      expect(x.bsaReference!.noise).toBeGreaterThan(0.005);
      expect(x.bsaReference!.noise * BSA_MIN_PROMINENCE).toBeGreaterThan(0.02);
    }
  });

  it('a bulb joined to a lip along the platform\'s edge: not closed at the sides (bulb_open), though it has an outline and ends; ends set by hand give the angle', () => {
    const t = flakeT8(true, null, { open: true });
    const x = runOn(t);
    expect(x.measures.bsa).toBeNull();
    expect(x.reasons.bsa).toBe('bulb_open');
    expect(x.reasons.vi_1_0mm).toBe('bulb_open');
    // its ends, from the outline, lie far round toward the platform's edge (the angle would be near 180°): there to be moved
    const b = x.construction.bulb!;
    expect(b.autoEnds).not.toBeNull();
    const flat = (q: Vec3): Vec3 => [q[0], q[1], 0];
    expect(angleOf(flat(b.autoEnds![0]), flat(b.autoEnds![1]))).toBeGreaterThan(150);
    // not a bulb for IPA either: its band from 0.25
    expect(x.ipaBand!.fallback).toBe(true);
    // (−4, 3) and (4, 3) lie off the bulb and the lip: on the flat face, z = 0
    const set = runOn(t, { bsa: { level: BSA_LEVEL_DEFAULT_MM, ends: [[-4, 3, 0], [4, 3, 0]] } });
    expect(set.measures.bsa).toBeCloseTo(angleOf([-4, 3, 0], [4, 3, 0]), 1);
    expect(set.measures.vi_1_0mm).not.toBeNull();
  });

  it('a level that leaves the bulb open at the sides: no BSA (bulb_open); ends set by hand give it back', () => {
    const open = run({ bsa: { level: -0.01, ends: null } });
    for (const k of ['bsa', 'vi_0_5mm', 'vi_1_0mm', 'vi_1_5mm'] as const) {
      expect(open.measures[k], k).toBeNull();
      expect(open.reasons[k], k).toBe('bulb_open');
    }
    const ends = r.construction.bulb!.autoEnds!;
    const set = run({ bsa: { level: -0.01, ends } });
    expect(set.measures.bsa).toBeCloseTo(r.measures.bsa!, 9);
    expect(set.measures.vi_1_0mm).not.toBeNull();
  });
});

describe('the hints of the proximal measures', () => {
  const r = run();
  const arcOf = (h: MeasureHint) => h.find((p): p is HintArc => p.kind === 'arc')!;
  const arcDeg = (a: HintArc) => angleOf(a.from, a.to);

  it('PSIA, the bulb angle and the BSA: their arcs are their values', () => {
    for (const k of ['psia', 'bulb_angle_3pt_1mm', 'bulb_angle_2ln_1mm', 'bsa'] as const) {
      const h = flakeHint(k, r, 'mm')!;
      expect(h, k).not.toBeNull();
      expect(arcDeg(arcOf(h))).toBeCloseTo(r.measures[k]!, 6);
    }
  });

  it('the BSA: the reference plane as a disc round P as far as it was fitted, the outline, the ends', () => {
    const h = flakeHint('bsa', r, 'mm')!;
    const patch = h.find((p) => p.kind === 'patch')!;
    const b = r.construction.bulb!;
    expect(patch.kind === 'patch' && patch.points.length).toBe(64);
    for (const q of patch.kind === 'patch' ? patch.points : []) {
      expect(Math.hypot(q[0] - b.P0[0], q[1] - b.P0[1], q[2] - b.P0[2])).toBeCloseTo(b.radius, 6);
      expect(Math.abs(planeCoords(b.plane, q)[2])).toBeLessThan(1e-6);
    }
    expect(h.filter((p) => p.part === 'outline').length).toBe(r.construction.bulb!.contour.length);
    const ends = h.find((p) => p.part === 'ends');
    expect(ends?.kind === 'dots' && ends.points).toEqual(r.construction.bulb!.ends);
  });

  it('a vertical interval: its strip, its highest and lowest samples, as far apart in height as its value', () => {
    const b = r.construction.bulb!;
    for (const [i, k] of (['vi_0_5mm', 'vi_1_0mm', 'vi_1_5mm'] as const).entries()) {
      const h = flakeHint(k, r, 'mm')!;
      const strip = h.find((p) => p.part === 'strip');
      expect(strip?.kind === 'line' && strip.points).toEqual(b.vi![i].corners);
      const hl = h.find((p) => p.part === 'high-low');
      if (hl?.kind !== 'dots') throw new Error('no dots');
      const [hi, lo] = hl.points;
      const height = (q: Vec3) => (q[0] - b.plane.point[0]) * b.plane.normal[0] + (q[1] - b.plane.point[1]) * b.plane.normal[1] + (q[2] - b.plane.point[2]) * b.plane.normal[2];
      expect(height(hi) - height(lo)).toBeCloseTo(r.measures[k]!, 9);
    }
  });

  it('the mesh round P: the edges counted', () => {
    const h = flakeHint('pop_mesh_edge', r, 'mm')!;
    const e = h.find((p) => p.part === 'edges');
    expect(e?.kind === 'line' && e.segments && e.points.length % 2 === 0 && e.points.length > 10).toBe(true);
  });

  it('nothing for an empty value', () => {
    const x = run({ unit: '' });
    for (const k of ['bsa', 'vi_1_0mm', 'bulb_angle_3pt_1mm', 'pop_mesh_edge'] as const) expect(flakeHint(k, x, '')).toBeNull();
  });
});

describe('flake measures between observers', () => {
  // a second observer put P 0.4 mm to the side and the ends a little apart
  const a = run();
  const b = run({ P: [0.4, 0, 0], ends: [[-6.2, 0, t8Dorsal(6.2)], ENDS[1]] });
  const flakeState = (annotator: string) => {
    const s = new ProjectStore(emptyProject());
    s.state.specimen.type = 'flake';
    s.state.specimen.annotator = annotator;
    return s.state;
  };
  const measuresOf = (r: FlakeResult) => Object.fromEntries(AGREEMENT_FLAKE_MEASURES.map((k) => [k, r.measures[k]]));

  it('their differences are rows of the agreement table, those that are no measures are not', () => {
    expect(a.measures.psia).not.toBeCloseTo(b.measures.psia!, 3);
    const rows = compareObservers(
      [
        { label: 'A', state: flakeState('A'), planes: [], faces: null, measures: measuresOf(a) },
        { label: 'B', state: flakeState('B'), planes: [], faces: null, measures: measuresOf(b) },
      ],
      { gate: 5, faceArea: null },
    );
    const diff = (k: string) => rows.find((r) => r.itemType === 'measurement' && r.itemKey === k)?.value;
    expect(diff('psia')).toBeCloseTo(b.measures.psia! - a.measures.psia!, 9);
    for (const k of ['bulb_angle_3pt_1mm', 'bsa', 'vi_1_0mm']) expect(diff(k)).toBeDefined();
    for (const k of ['bsa_level_mm', 'bsa_ends_moved', 'pop_mesh_edge']) expect(diff(k)).toBeUndefined();
  });

  it('icc.csv: the stored measures of every observer, on two specimens or more', () => {
    const auto = { frame: 'principal' as const, length: 1, width: 1, thickness: 1, surfaceArea: 1, volume: 1, closed: true };
    const project = (annotator: string, r: FlakeResult, path: string): BatchProject => ({ path, state: flakeState(annotator), derived: { flake: { measures: r.measures } }, appVersion: 'x' });
    const specimen = (file: string, ra: FlakeResult, rb: FlakeResult) => {
      const ps = [project('A', ra, `${file}.A.json`), project('B', rb, `${file}.B.json`)];
      return batchSpecimen(file, { project: ps[0], measures: { auto, vertices: null, box: null } }, ps.map((p) => ({ project: p, measures: { auto, vertices: null, box: null } })));
    };
    const c = run({ P: [-0.3, 0, 0] });
    const csv = iccCsv([specimen('one.ply', a, b), specimen('two.ply', c, a)])!;
    const measures = csv.trim().split('\n').slice(1).map((l) => l.split(',')[0]);
    for (const k of ['psia', 'bulb_angle_3pt_1mm', 'bulb_angle_2ln_1mm', 'bsa', 'vi_0_5mm', 'vi_1_0mm', 'vi_1_5mm']) expect(measures).toContain(k);
    expect(measures).not.toContain('pop_mesh_edge');
    expect(measures).not.toContain('bsa_level_mm');
  });
});

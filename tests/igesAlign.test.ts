import { describe, expect, it } from 'vitest';
import { applyPlacement, axisRotation, endDistances, fitPairs, headerFactor, icpSteps, IGES_IMPORT, judgeUnits, kabsch, meshSurfaceSteps, placeArrows, placementOf, residualOf, startPlacement, toleranceOf, type Placement, type Segment, type SurfaceQuery } from '../src/compute/igesAlign';
import { signedVolume } from '../src/compute/curvature';
import { runSync } from '../src/compute/steps';
import type { Vec3 } from '../src/core/types';
import { igesUnitMm, readIges } from '../src/io/iges';
import { ellipsoid, type Mesh } from './meshes';
import { sampleIges } from './igesFiles';

/** A test body far from the origin, as the user's scans: an ellipsoid with three different axes, its middle at z = 480 (mm). */
const OFFSET: Vec3 = [12, -7, 480];
const body = ellipsoid(14, 11, 9, 48, 64);

function surfaceOf(m: Mesh, offset: Vec3 = OFFSET): SurfaceQuery {
  return runSync(meshSurfaceSteps(m.positions, m.index, offset, signedVolume(m.positions, m.index) < 0 ? -1 : 1));
}

const surface = surfaceOf(body);
const vertex = (i: number): Vec3 => [body.positions[3 * i] + OFFSET[0], body.positions[3 * i + 1] + OFFSET[1], body.positions[3 * i + 2] + OFFSET[2]];
const nVertices = body.positions.length / 3;

/** Segments between vertices of the body (so their ends lie on it), spread over it. */
function segmentsOn(count: number, seed = 1): Segment[] {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: count }, () => {
    const a = Math.floor(rand() * nVertices);
    return { start: vertex(a), end: vertex((a + 3 + Math.floor(rand() * 5)) % nVertices) };
  });
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const scaled = (segments: Segment[], k: number): Segment[] => segments.map((x) => ({ start: x.start.map((v) => v * k) as Vec3, end: x.end.map((v) => v * k) as Vec3 }));

describe('the unit of IGES vectors', () => {
  it('takes them as they are when they lie on a model in millimetres although the header says centimetres', () => {
    const segments = segmentsOn(10);
    const read = readIges(sampleIges(segments.map((x) => [x.start, x.end])));
    const factor = headerFactor(igesUnitMm(read.units), 'mm');
    expect(factor).toBe(10);
    const j = judgeUnits(read.segments, factor, surface);
    expect(j.factor).toBe(1);
    expect(j.aligned).toBe(true);
    expect(j.residual.max).toBeLessThan(1e-6);
    // ten times larger they would not fit the model
    expect(j.guesses.find((g) => g.factor === 10)?.sensible).toBe(false);
  });

  it('takes the header’s centimetres when the vectors are in centimetres and the model in millimetres', () => {
    const cm = scaled(segmentsOn(10), 0.1);
    const j = judgeUnits(cm, headerFactor(10, 'mm'), surface);
    expect(j.factor).toBe(10);
    expect(j.aligned).toBe(true);
  });

  it('is not aligned when the vectors are moved, and the preview then starts in the model’s box', () => {
    const moved = segmentsOn(10).map((x) => ({ start: [x.start[0] + 100, x.start[1], x.start[2]] as Vec3, end: [x.end[0] + 100, x.end[1], x.end[2]] as Vec3 }));
    const j = judgeUnits(moved, null, surface);
    expect(j.aligned).toBe(false);
    const t = startPlacement(moved, 1, surface);
    const ends = moved.flatMap((x) => [applyPlacement(t, x.start), applyPlacement(t, x.end)]);
    const mid = [0, 1, 2].map((k) => ends.reduce((s, p) => s + p[k], 0) / ends.length);
    mid.forEach((v, k) => expect(v).toBeCloseTo((surface.min[k] + surface.max[k]) / 2, 9));
  });

  it('a unit not stated counts as the millimetre', () => {
    expect(headerFactor(10, '')).toBe(10);
    expect(headerFactor(25.4, 'cm')).toBeCloseTo(2.54, 12);
    expect(headerFactor(null, 'mm')).toBeNull();
  });
});

describe('placing the vectors by pairs', () => {
  const R0 = axisRotation([0, 0, 1], 0.3);
  const current: Placement = { scale: 1, rotation: R0, translation: [5, 6, 7] };

  it('one pair moves the set only, so that it meets', () => {
    const t = fitPairs([{ from: [1, 2, 3], to: [40, 50, 60] }], current);
    expect(t.rotation).toEqual(R0);
    expect(dist(applyPlacement(t, [1, 2, 3]), [40, 50, 60])).toBeLessThan(1e-12);
  });

  it('two pairs line up the direction between them', () => {
    const pairs = [
      { from: [0, 0, 0] as Vec3, to: [10, 10, 10] as Vec3 },
      { from: [4, 0, 0] as Vec3, to: [10, 13, 14] as Vec3 },
    ];
    const t = fitPairs(pairs, current);
    const d = [0, 1, 2].map((k) => applyPlacement(t, [4, 0, 0])[k] - applyPlacement(t, [0, 0, 0])[k]);
    const l = Math.hypot(...d);
    expect(d.map((v) => v / l)).toEqual([0, 0.6, 0.8].map((v) => expect.closeTo(v, 12)));
    // the middle of the two meets the middle of their places
    const mid = [0, 1, 2].map((k) => (applyPlacement(t, [0, 0, 0])[k] + applyPlacement(t, [4, 0, 0])[k]) / 2);
    expect(mid).toEqual([10, 11.5, 12].map((v) => expect.closeTo(v, 12)));
  });

  it('three pairs find a known rigid placement exactly (Kabsch), with the scale of the unit kept', () => {
    const truth: Placement = { scale: 10, rotation: axisRotation([0.48, -0.6, 0.64], 1.234), translation: [120.5, -33.25, 478] };
    const from: Vec3[] = [
      [1.2, 0.3, -0.4],
      [-0.7, 2.1, 0.5],
      [0.4, -1.3, 1.9],
    ];
    const t = fitPairs(
      from.map((p) => ({ from: p, to: applyPlacement(truth, p) })),
      placementOf(10),
    );
    expect(t.scale).toBe(10);
    t.rotation.forEach((v, i) => expect(Math.abs(v - truth.rotation[i])).toBeLessThan(1e-9));
    t.translation.forEach((v, i) => expect(Math.abs(v - truth.translation[i])).toBeLessThan(1e-9));
    // never a mirror
    const k = kabsch(from, from.map((p) => [-p[0], p[1], p[2]] as Vec3));
    const r = k.rotation;
    const det = r[0] * (r[4] * r[8] - r[5] * r[7]) - r[1] * (r[3] * r[8] - r[5] * r[6]) + r[2] * (r[3] * r[7] - r[4] * r[6]);
    expect(det).toBeCloseTo(1, 12);
  });
});

describe('the automatic fit (point-to-plane ICP)', () => {
  const segments = segmentsOn(30, 7);
  const points = segments.flatMap((x) => [x.start, x.end]);
  const centre: Vec3 = [(surface.min[0] + surface.max[0]) / 2, (surface.min[1] + surface.max[1]) / 2, (surface.min[2] + surface.max[2]) / 2];
  /** A turn of 8° about the middle of the body and a move of 3 mm. */
  function offStart(): Placement {
    const r = axisRotation([0.36, 0.48, 0.8], (8 * Math.PI) / 180);
    const turned = applyPlacement({ scale: 1, rotation: r, translation: [0, 0, 0] }, centre);
    const move: Vec3 = [3 / Math.sqrt(3), 3 / Math.sqrt(3), 3 / Math.sqrt(3)];
    return { scale: 1, rotation: r, translation: [centre[0] - turned[0] + move[0], centre[1] - turned[1] + move[1], centre[2] - turned[2] + move[2]] };
  }

  it('brings the ends back onto the body within 0.05 mm of where they belong', () => {
    const start = offStart();
    expect(Math.max(...points.map((p) => dist(applyPlacement(start, p), p)))).toBeGreaterThan(3);
    const r = runSync(icpSteps(points, start, surface));
    expect(Math.max(...points.map((p) => dist(applyPlacement(r.placement, p), p)))).toBeLessThan(0.05);
    expect(r.rounds).toBeLessThanOrEqual(IGES_IMPORT.ICP_MAX_ROUNDS);
    expect(residualOf(endDistances(segments, r.placement, surface)).median).toBeLessThan(toleranceOf(surface));
  });

  it('still does with a fifth of the ends off the surface (where the model was cut away)', () => {
    // every fifth end 4 mm out along the normal
    const withOutliers = points.map((p, i) => {
      if (i % 5) return p;
      const n = surface.closest(p)!.normal;
      return [p[0] + 4 * n[0], p[1] + 4 * n[1], p[2] + 4 * n[2]] as Vec3;
    });
    const r = runSync(icpSteps(withOutliers, offStart(), surface));
    const inliers = points.filter((_, i) => i % 5);
    expect(Math.max(...inliers.map((p) => dist(applyPlacement(r.placement, p), p)))).toBeLessThan(0.05);
  });
});

describe('the arrows put on the surface', () => {
  it('puts each end on its nearest surface point, the normal outward at the middle, and marks those far off', () => {
    const segments = segmentsOn(4, 3);
    const far = { start: segments[3].start, end: [segments[3].end[0], segments[3].end[1], segments[3].end[2] + 30] as Vec3 };
    const placed = placeArrows([...segments.slice(0, 3), far], placementOf(1), surface);
    expect(placed).toHaveLength(4);
    expect(placed.map((a) => a.review)).toEqual([false, false, false, true]);
    for (const a of placed) {
      expect(surface.closest(a.start)!.distance).toBeLessThan(1e-6);
      expect(surface.closest(a.end)!.distance).toBeLessThan(1e-6);
      // outward: away from the middle of the body
      const mid = [0, 1, 2].map((k) => (a.start[k] + a.end[k]) / 2 - (surface.min[k] + surface.max[k]) / 2);
      expect(mid[0] * a.normal[0] + mid[1] * a.normal[1] + mid[2] * a.normal[2]).toBeGreaterThan(0);
    }
    expect(dist(placed[0].start, segments[0].start)).toBeLessThan(1e-6);
  });
});

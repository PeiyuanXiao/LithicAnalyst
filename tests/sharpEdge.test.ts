import { describe, expect, it } from 'vitest';
import type { EdgeAngleResult } from '../src/compute/edgeAngle';
import { ruleValues, sharpOfCurve, sharpSegments, suggestThreshold } from '../src/compute/sharpEdge';
import { addCurve, setSharpEdge, setCurveAttribute } from '../src/core/actions';
import { parseProjectFile, parseSharpEdge, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import type { Vec3 } from '../src/core/types';
import { edgeSharpCsv } from '../src/io/csv';

const positions = (n: number, step = 1) => Array.from({ length: n }, (_, k) => k * step);
/** n stations, `low` degrees on the given ranges of stations, else `high`. */
const profile = (n: number, ranges: Array<[number, number]>, low = 30, high = 80): number[] => Array.from({ length: n }, (_, k) => (ranges.some(([a, b]) => k >= a && k <= b) ? low : high));

describe('sharp stretches', () => {
  it('an open curve: the stations at or under the threshold, by position', () => {
    const r = sharpSegments(profile(41, [[10, 25]]), positions(41), false, 40, 45, 'mm');
    expect(r.segments).toEqual([{ start: 10, end: 25, length: 15 }]);
    expect(r.length).toBe(15);
    expect(r.mask.filter(Boolean).length).toBe(16);
    expect(r.mask[9]).toBe(false);
    expect(r.mask[10]).toBe(true);
    // exactly the threshold counts
    expect(sharpSegments(profile(41, [[10, 25]]), positions(41), false, 40, 30, 'mm').length).toBe(15);
    expect(sharpSegments(profile(41, [[10, 25]]), positions(41), false, 40, 29.9, 'mm').segments).toEqual([]);
  });

  it('short gaps are filled, longer ones part the stretches', () => {
    // a gap of two stations (2 mm), and one of three
    const a = sharpSegments(profile(41, [[5, 14], [17, 25]]), positions(41), false, 40, 45, 'mm');
    expect(a.segments).toEqual([{ start: 5, end: 25, length: 20 }]);
    const b = sharpSegments(profile(41, [[5, 14], [18, 25]]), positions(41), false, 40, 45, 'mm');
    expect(b.segments).toEqual([{ start: 5, end: 14, length: 9 }, { start: 18, end: 25, length: 7 }]);
    expect(b.length).toBe(16);
  });

  it('short stretches do not count; nor do those between no station and the end of an open curve fill up', () => {
    const r = sharpSegments(profile(41, [[5, 7], [20, 30]]), positions(41), false, 40, 45, 'mm');
    expect(r.segments).toEqual([{ start: 20, end: 30, length: 10 }]);
    expect(r.mask[6]).toBe(false);
    // two stations from the end: the end is no gap
    expect(sharpSegments(profile(41, [[10, 38]]), positions(41), false, 40, 45, 'mm').segments).toEqual([{ start: 10, end: 38, length: 28 }]);
  });

  it('a station without a value is not sharp', () => {
    const v: Array<number | null> = profile(21, [[0, 20]]);
    for (let k = 8; k <= 12; k++) v[k] = null;
    expect(sharpSegments(v, positions(21), false, 20, 45, 'mm').segments).toEqual([{ start: 0, end: 7, length: 7 }, { start: 13, end: 20, length: 7 }]);
  });

  it('round a closed curve a stretch goes on past the start; a curve all sharp is one stretch', () => {
    const r = sharpSegments(profile(40, [[0, 5], [30, 39]]), positions(40), true, 40, 45, 'mm');
    expect(r.segments).toEqual([{ start: 30, end: 5, length: 15 }]);
    expect(r.length).toBe(15);
    const all = sharpSegments(profile(40, [[0, 39]]), positions(40), true, 40, 45, 'mm');
    expect(all.segments).toEqual([{ start: 0, end: 40, length: 40 }]);
    expect(sharpSegments(profile(40, []), positions(40), true, 40, 45, 'mm').segments).toEqual([]);
    // a gap across the start is a gap too
    expect(sharpSegments(profile(40, [[1, 38]]), positions(40), true, 40, 45, 'mm').segments).toEqual([{ start: 0, end: 40, length: 40 }]);
  });

  it('the lengths in millimetres, whatever the coordinate unit', () => {
    // centimetres: a station every 0.1, the gap of two stations is 2 mm
    const r = sharpSegments(profile(41, [[5, 14], [17, 25]]), positions(41, 0.1), false, 4, 45, 'cm');
    expect(r.segments.length).toBe(1);
    expect(r.segments[0].length).toBeCloseTo(2, 8);
  });

  it('by the rule: its method and distance, and nothing without a threshold', () => {
    const result: EdgeAngleResult = {
      distances: [2, 5, 10],
      length: 9,
      stations: positions(10).map((p) => ({ position: p, point: [p, 0, 0] as Vec3, three_points: [20, 40, 60], two_lines: [25, 45, 65] })),
    };
    expect(ruleValues(result, { method: 'two_lines', distance: 5, threshold: 1 })[0]).toBe(45);
    expect(sharpOfCurve(result, false, { method: 'three_points', distance: 2, threshold: null }, 'mm')).toBeNull();
    expect(sharpOfCurve(result, false, { method: 'three_points', distance: 2, threshold: 30 }, 'mm')!.length).toBe(9);
    expect(sharpOfCurve(result, false, { method: 'three_points', distance: 10, threshold: 30 }, 'mm')!.length).toBe(0);
  });
});

describe('the suggested threshold', () => {
  /** Values spread evenly over a range. */
  const spread = (lo: number, hi: number, n: number) => Array.from({ length: n }, (_, k) => lo + ((hi - lo) * k) / (n - 1));
  /** A bell around a mean: the normal quantiles of even steps (Box–Muller of a fixed grid would be no simpler). */
  const bell = (mean: number, sd: number, n: number) =>
    Array.from({ length: n }, (_, k) => {
      const p = (k + 0.5) / n;
      const t = Math.sqrt(-2 * Math.log(Math.min(p, 1 - p)));
      const z = t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t);
      return mean + sd * (p < 0.5 ? -z : z);
    });

  it('angles of two kinds: a value between them', () => {
    const v = suggestThreshold([...bell(30, 4, 300), ...bell(75, 5, 200)])!;
    expect(v).toBeGreaterThan(42);
    expect(v).toBeLessThan(62);
  });

  it('one kind far outnumbering the other: still between them', () => {
    const v = suggestThreshold([...bell(30, 3, 300), ...bell(80, 3, 40)])!;
    expect(v).toBeGreaterThan(38);
    expect(v).toBeLessThan(72);
  });

  it('angles of one kind have no threshold: a bell, an even spread, about the same value', () => {
    expect(suggestThreshold(bell(50, 12, 400))).toBeNull();
    expect(suggestThreshold(spread(20, 90, 400))).toBeNull();
    expect(suggestThreshold(bell(24.4, 0.02, 200))).toBeNull();
    expect(suggestThreshold(new Array<number>(50).fill(30))).toBeNull();
  });

  it('too few to tell', () => {
    expect(suggestThreshold([])).toBeNull();
    expect(suggestThreshold([10, 80, 10])).toBeNull();
  });

  it('is the same whatever the order', () => {
    const v = [...bell(30, 4, 100), ...bell(75, 5, 100)];
    expect(suggestThreshold([...v].reverse())).toBe(suggestThreshold(v));
  });
});

describe('the rule in the project', () => {
  const shape = () => {
    const pts: Vec3[] = [[0, 0, 0], [40, 0, 0]];
    return { anchors: pts, points: pts, anchorIndex: [0, 1], closed: false };
  };

  it('three points at 2 mm, and no threshold until the user sets one; one undo step', () => {
    const s = new ProjectStore(emptyProject());
    expect(s.state.sharpEdge).toEqual({ method: 'three_points', distance: 2, threshold: null });
    setSharpEdge(s, { threshold: 45 });
    setSharpEdge(s, { distance: 5 });
    expect(s.state.sharpEdge).toEqual({ method: 'three_points', distance: 5, threshold: 45 });
    s.history.undo();
    expect(s.state.sharpEdge.distance).toBe(2);
    s.history.undo();
    expect(s.state.sharpEdge.threshold).toBeNull();
  });

  it('goes through the project file; what is not understood takes its default', () => {
    const s = new ProjectStore(emptyProject());
    setSharpEdge(s, { method: 'two_lines', distance: 10, threshold: 52.5 });
    const file = JSON.parse(JSON.stringify(serializeProject(s.state, '0.2.0')));
    expect(file.sharpEdge).toEqual({ method: 'two_lines', distance: 10, threshold: 52.5 });
    expect(parseProjectFile(file).sharpEdge).toEqual({ method: 'two_lines', distance: 10, threshold: 52.5 });
    delete file.sharpEdge;
    expect(parseProjectFile(file).sharpEdge).toEqual({ method: 'three_points', distance: 2, threshold: null });
    expect(parseSharpEdge({ method: 'x', distance: 3, threshold: 'y' })).toEqual({ method: 'three_points', distance: 2, threshold: null });
  });

  it('edge_sharp.csv: a row per stretch, the distance in the coordinate unit; the derived results hold them', () => {
    const s = new ProjectStore(emptyProject());
    const c = addCurve(s, shape());
    setCurveAttribute(s, c.id, 'type', 'edge');
    const stations = positions(41).map((p) => ({ position: p, point: [p, 0, 0] as Vec3, three_points: [p >= 10 && p <= 20 ? 30 : 80, 50, 60], two_lines: [80, 50, 60] }));
    const curves = [{ curveId: c.id, distances: [2, 5, 10], length: 40, stations }];
    const header = 'specimen_id,curve_id,method,distance,threshold_deg,segment,start_position,end_position,length';
    // no threshold: no rows
    expect(edgeSharpCsv(s.state, curves, { excelBom: false }).trim()).toBe(header);
    expect(serializeProject(s.state, '0.2.0', { measurements: null, vertices: null, edgeAngles: curves }).derived.sharpEdge).toBeNull();
    setSharpEdge(s, { threshold: 45 });
    expect(edgeSharpCsv(s.state, curves, { excelBom: false }).trim().split('\n')).toEqual([header, ',C1,three_points,2,45,1,10,20,10']);
    const derived = serializeProject(s.state, '0.2.0', { measurements: null, vertices: null, edgeAngles: curves }).derived.sharpEdge!;
    expect(derived.rule.threshold).toBe(45);
    expect(derived.parameters.SHARP_MIN_RUN_MM).toBe(3);
    expect(derived.curves).toEqual([{ curveId: c.id, length: 10, segments: [{ start: 10, end: 20, length: 10 }] }]);
  });
});

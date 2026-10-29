import { describe, expect, it } from 'vitest';
import { angleBetween, assign, cohenKappa, compareObservers, curveDistance, fleissKappa, icc21, summarize, type ObserverData } from '../src/compute/agreement';
import { addCurve, addLandmark, addMeasurement, addScarVector, addSemilandmarkSet, setCurveAttribute, setRelation, setScarAttribute } from '../src/core/actions';
import { ProjectStore } from '../src/core/store';
import type { Vec3 } from '../src/core/types';

describe('assignment', () => {
  it('finds the cheapest pairs, also for rectangular matrices and with a limit', () => {
    expect(assign([[4, 1, 3], [2, 0, 5], [3, 2, 2]])).toEqual([1, 0, 2]);
    // 3 rows, 2 columns: one row stays unmatched
    expect(assign([[1, 9], [9, 1], [2, 2]])).toEqual([0, 1, -1]);
    expect(assign([[1, 2, 0.5]])).toEqual([2]);
    // nothing within the limit
    expect(assign([[5, 6], [7, 8]], 4)).toEqual([-1, -1]);
    // the limit keeps the far pair apart instead of forcing it
    expect(assign([[1, 100], [100, 50]], 10)).toEqual([0, -1]);
    expect(assign([])).toEqual([]);
  });
});

describe('agreement statistics', () => {
  it('Cohen: 50 items, 20 yes/yes, 15 no/no, 5 yes/no, 10 no/yes → κ = 0.4', () => {
    const pairs: Array<[string, string]> = [
      ...Array<[string, string]>(20).fill(['y', 'y']),
      ...Array<[string, string]>(15).fill(['n', 'n']),
      ...Array<[string, string]>(5).fill(['y', 'n']),
      ...Array<[string, string]>(10).fill(['n', 'y']),
    ];
    const k = cohenKappa(pairs);
    expect(k.n).toBe(50);
    expect(k.agreement).toBeCloseTo(0.7, 12);
    expect(k.kappa).toBeCloseTo(0.4, 12);
    // weights count like repeated items
    const w = cohenKappa([['y', 'y'], ['n', 'n'], ['y', 'n'], ['n', 'y']], [20, 15, 5, 10]);
    expect(w.kappa).toBeCloseTo(0.4, 12);
    expect(Number.isNaN(cohenKappa([['a', 'a'], ['a', 'a']]).kappa)).toBe(true);
  });

  it('Fleiss: the 10 × 14 example of Fleiss (1971) as given on Wikipedia → κ ≈ 0.210', () => {
    const table = [
      [0, 0, 0, 0, 14],
      [0, 2, 6, 4, 2],
      [0, 0, 3, 5, 6],
      [0, 3, 9, 2, 0],
      [2, 2, 8, 1, 1],
      [7, 7, 0, 0, 0],
      [3, 2, 6, 3, 0],
      [2, 5, 3, 2, 2],
      [6, 5, 2, 1, 0],
      [0, 2, 2, 3, 7],
    ];
    const items = table.map((row) => row.flatMap((n, c) => Array<string>(n).fill(String(c))));
    const k = fleissKappa(items);
    expect(k.agreement).toBeCloseTo(0.378, 3);
    expect(k.kappa).toBeCloseTo(0.21, 2);
    // two raters: same as Scott's π
    expect(fleissKappa([['a', 'a'], ['b', 'b']]).kappa).toBeCloseTo(1, 12);
  });

  it('ICC(2,1): Shrout & Fleiss (1979), 6 targets × 4 judges → 0.29', () => {
    const data = [
      [9, 2, 5, 8],
      [6, 1, 3, 2],
      [8, 4, 6, 8],
      [7, 1, 2, 6],
      [10, 5, 6, 9],
      [6, 2, 4, 7],
    ];
    expect(icc21(data)).toBeCloseTo(0.29, 2);
    expect(icc21([[1, 2]])).toBeNaN();
  });

  it('curve distances and angles', () => {
    const a = { points: [[0, 0, 0], [10, 0, 0]] as Vec3[], closed: false };
    const b = { points: [[0, 1, 0], [10, 1, 0]] as Vec3[], closed: false };
    expect(curveDistance(a, b)).toEqual({ mean: 1, hausdorff: 1 });
    // a longer curve: its extra stretch is 5 away at most
    const c = { points: [[0, 0, 0], [15, 0, 0]] as Vec3[], closed: false };
    expect(curveDistance(a, c).hausdorff).toBeCloseTo(5, 9);
    expect(angleBetween([1, 0, 0], [0, 2, 0])).toBeCloseTo(90, 12);
  });
});

describe('comparing observers', () => {
  const arrow = (s: ProjectStore, start: Vec3, end: Vec3) => addScarVector(s, { start, end, startNormal: [0, 0, 1], endNormal: [0, 0, 1] });
  const observer = (label: string, s: ProjectStore, measures: Record<string, number | null> = {}): ObserverData => ({ label, state: s.state, planes: [], faces: null, measures });

  it('compares the termination like the completeness, over the scars both observers judged', () => {
    const a = new ProjectStore(), b = new ProjectStore(), c = new ProjectStore();
    const ys = [0, 20, 40, 60];
    const [sa, sb, sc] = [a, b, c].map((s) => ys.map((y) => arrow(s, [0, y, 0], [10, y, 0])));
    // A: feather, hinge, step, (none) · B: feather, step, (none), hinge · C: feather, hinge, step, hinge
    const set = (s: ProjectStore, list: typeof sa, codes: Array<string | null>) => codes.forEach((v, i) => v && setScarAttribute(s, list[i].id, 'termination', v));
    set(a, sa, ['feather', 'hinge', 'step', null]);
    set(b, sb, ['feather', 'step', null, 'hinge']);
    set(c, sc, ['feather', 'hinge', 'step', 'hinge']);
    const rows = compareObservers([observer('A', a), observer('B', b), observer('C', c)], { gate: 5, faceArea: null });
    const get = (metric: string, x: string, y: string) => rows.find((r) => r.itemType === 'scar_attribute' && r.itemKey === 'termination' && r.metric === metric && r.a === x && r.b === y)?.value;
    // A–B: only S1 and S2 are judged by both; they agree on one
    expect(get('n_items', 'A', 'B')).toBe(2);
    expect(get('agreement', 'A', 'B')).toBeCloseTo(0.5, 12);
    expect(get('cohen_kappa', 'A', 'B')).toBeCloseTo(cohenKappa([['feather', 'feather'], ['hinge', 'step']]).kappa, 12);
    // A–C: three judged by both, all the same
    expect([get('n_items', 'A', 'C'), get('agreement', 'A', 'C')]).toEqual([3, 1]);
    // all three: only S1 and S2 are judged by everyone
    expect(get('n_items', 'all', '')).toBe(2);
  });

  it('matches arrows by their ends and compares their directions, attributes and relations', () => {
    const a = new ProjectStore(), b = new ProjectStore(), c = new ProjectStore();
    const [a1, a2, a3] = [arrow(a, [0, 0, 0], [10, 0, 0]), arrow(a, [0, 20, 0], [10, 20, 0]), arrow(a, [50, 50, 0], [60, 50, 0])];
    // B drew the same two scars in the other order, slightly off, plus one far away
    const [b2, b1] = [arrow(b, [0, 21, 0], [10, 20, 0]), arrow(b, [0, 0, 0], [10, 10, 0])];
    arrow(b, [-80, 0, 0], [-90, 0, 0]);
    setScarAttribute(a, a1.id, 'completeness', 'point_complete');
    setScarAttribute(b, b1.id, 'completeness', 'point_complete');
    setScarAttribute(a, a2.id, 'completeness', 'both_missing');
    setScarAttribute(b, b2.id, 'completeness', 'bulb_complete');
    setRelation(a, a2.id, a1.id, 'a_cuts_b');
    setRelation(b, b2.id, b1.id, 'a_cuts_b');
    setRelation(a, a3.id, a1.id, 'indeterminate');
    arrow(c, [0, 0, 0], [10, 0, 0]);
    arrow(c, [0, 20, 0], [10, 20, 0]);

    const rows = compareObservers([observer('A', a, { length: 40 }), observer('B', b, { length: 41.5 }), observer('C', c)], { gate: 5, faceArea: null });
    const get = (type: string, key: string, metric: string, x = 'A', y = 'B') => rows.find((r) => r.itemType === type && r.itemKey === key && r.metric === metric && r.a === x && r.b === y)?.value;
    expect(get('arrow', 'S1|S2', 'angle_deg')).toBeCloseTo(45, 9);
    expect(get('arrow', 'S1|S2', 'end_distance')).toBeCloseTo(10, 9);
    expect(get('arrow', 'S2|S1', 'start_distance')).toBeCloseTo(1, 9);
    expect([get('arrow', 'all', 'matched'), get('arrow', 'all', 'unmatched_a'), get('arrow', 'all', 'unmatched_b')]).toEqual([2, 1, 1]);
    expect(get('scar_attribute', 'completeness', 'agreement')).toBeCloseTo(0.5, 12);
    expect(get('scar_attribute', 'completeness', 'n_items')).toBe(2);
    // the "cannot tell" relation involves an unmatched scar: only S2 cuts S1 counts, and both agree
    expect([get('relation', 'all', 'agreement'), get('relation', 'all', 'n_items')]).toEqual([1, 1]);
    expect(get('measurement', 'length', 'difference')).toBeCloseTo(1.5, 12);
    // three observers: Fleiss on the scars all of them share
    expect(rows.find((r) => r.a === 'all' && r.itemKey === 'completeness' && r.metric === 'n_items')?.value).toBe(2);
    expect(rows.filter((r) => r.a === 'A' && r.b === 'C' && r.itemType === 'arrow' && r.metric === 'angle_deg').map((r) => r.value)).toEqual([0, 0]);

    // nobody judged both terminations of a pair (A's S2 is NA by its completeness, B's is not filled in)
    expect(get('scar_attribute', 'termination', 'n_items')).toBeUndefined();

    const sum = summarize(rows);
    const angles = sum.find((r) => r.itemType === 'arrow' && r.metric === 'angle_deg' && r.a === 'A' && r.b === 'B')!;
    expect(angles.n).toBe(2);
    expect(angles.mean).toBeCloseTo((45 + angleBetween([10, -1, 0], [10, 0, 0])) / 2, 9);
    expect(angles.max).toBeCloseTo(45, 9);
  });

  it('matches curves of one type, landmarks by name, semilandmarks by set and number, measurements by label', () => {
    const a = new ProjectStore(), b = new ProjectStore();
    const line = (y: number): Vec3[] => [[0, y, 0], [10, y, 0]];
    const shape = (pts: Vec3[]) => ({ anchors: pts, points: pts, anchorIndex: [0, pts.length - 1], closed: false });
    const ca = addCurve(a, shape(line(0)));
    const cb = addCurve(b, shape(line(0.5)));
    const other = addCurve(b, shape(line(0.2)));
    setCurveAttribute(b, other.id, 'type', 'ridge');
    setCurveAttribute(a, ca.id, 'type', 'edge');
    setCurveAttribute(b, cb.id, 'type', 'edge');
    addLandmark(a, [0, 0, 0], 'apex');
    addLandmark(b, [3, 4, 0], 'apex');
    addLandmark(b, [9, 9, 9], 'base');
    addSemilandmarkSet(a, ca.id, 3);
    addSemilandmarkSet(b, cb.id, 3);
    addMeasurement(a, { type: 'distance', points: [[0, 0, 0], [3, 4, 0]] });
    addMeasurement(b, { type: 'distance', points: [[0, 0, 0], [6, 8, 0]] });
    const rows = compareObservers([observer('A', a), observer('B', b)], { gate: 2, faceArea: null });
    const get = (type: string, key: string, metric: string) => rows.find((r) => r.itemType === type && r.itemKey === key && r.metric === metric)?.value;
    // the ridge curve is closer, but of another type
    expect(get('curve', 'C1|C1', 'mean_distance')).toBeCloseTo(0.5, 9);
    expect(get('curve', 'C1|C1', 'hausdorff')).toBeCloseTo(0.5, 9);
    expect([get('curve', 'all', 'matched'), get('curve', 'all', 'unmatched_b')]).toEqual([1, 1]);
    expect(get('landmark', 'apex', 'distance')).toBe(5);
    expect(get('landmark', 'base', 'distance')).toBeUndefined();
    expect(rows.filter((r) => r.itemType === 'semilandmark').map((r) => [r.itemKey, +r.value.toFixed(9)])).toEqual([
      ['SL1_1', 0.5],
      ['SL1_2', 0.5],
      ['SL1_3', 0.5],
    ]);
    expect(get('measurement', 'M1', 'difference')).toBe(5);
  });

  it('compares regions per triangle: IoU, Dice and type agreement', () => {
    const a = new ProjectStore(), b = new ProjectStore();
    // four triangles of areas 1, 1, 2, 4; A: cortex, cortex, scar(R1), scar(R2); B: cortex, joint, scar(R1), scar(R1)
    const area = [1, 1, 2, 4];
    const obs = (label: string, s: ProjectStore, type: number[], region: number[]): ObserverData => ({ label, state: s.state, planes: [], faces: { type: Uint8Array.from(type), region: Int32Array.from(region) }, measures: {} });
    for (const s of [a, b]) for (let i = 0; i < 2; i++) s.history.execute({ labelKey: 'x', createdAt: 0, apply: () => s._insertRegion({ id: `${s === a ? 'a' : 'b'}${i}`, label: `R${i + 1}`, seed: [0, 0, 0], type: 'scar', scarId: null, createdAt: '', modifiedAt: '' }), revert: () => {} });
    const rows = compareObservers([obs('A', a, [2, 2, 1, 1], [0, 0, 0, 1]), obs('B', b, [2, 3, 1, 1], [0, 1, 0, 0])], { gate: 1, faceArea: area });
    const get = (key: string, metric: string, type = 'region') => rows.find((r) => r.itemType === type && r.itemKey === key && r.metric === metric)?.value;
    expect(get('cortex', 'iou')).toBeCloseTo(0.5, 12);
    expect(get('cortex', 'dice')).toBeCloseTo(2 / 3, 12);
    expect(get('scar', 'iou')).toBe(1);
    expect(get('joint', 'iou')).toBe(0);
    // A's R2 (area 4) overlaps B's R1 most; A's R1 is then left without a partner
    expect(get('R2|R1', 'iou')).toBeCloseTo(4 / 6, 12);
    expect(get('R1|R1', 'iou')).toBeUndefined();
    expect(get('all', 'agreement', 'region_type')).toBeCloseTo(7 / 8, 12);
    expect(get('all', 'area', 'region_type')).toBe(8);
  });
});

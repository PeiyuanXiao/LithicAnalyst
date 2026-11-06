import { describe, expect, it } from 'vitest';
import { platformEndsOf } from '../src/compute/measuredLine';
import { addCurve, addCurveOfType, addLandmark, addSemilandmarkSet, deleteCurve, deleteLandmark, moveLandmark, placePlatformEnd, setCurveAttribute, setCurveShape, setSpecimenType, updateSemilandmarkSet, withPlatformEnds } from '../src/core/actions';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import type { ProjectState, SpecimenInfo, Vec3 } from '../src/core/types';

/** A polyline through these corners, a point every `step`. */
function through(corners: Vec3[], closed: boolean, step = 1): Vec3[] {
  const out: Vec3[] = [];
  const stops = closed ? [...corners, corners[0]] : corners;
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i], b = stops[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n]);
  }
  if (!closed) out.push(stops[stops.length - 1]);
  return out;
}

const L: Vec3 = [-15, 0, 0], R: Vec3 = [15, 0, 0], FL: Vec3 = [-15, 60, 0], FR: Vec3 = [15, 60, 0];
const OUTLINE = through([L, R, [15, -2, 10], [-15, -2, 10]], true);
const OPEN = through([L, FL, FR, R], false);
const CLOSED = through([L, FL, FR, R], true);

const curve = (type: string, points: Vec3[], closed: boolean) => ({ points, closed, attributes: { type } });
const outline = () => curve('platform_outline', OUTLINE, true);
const near = (a: Vec3, b: Vec3, within = 1e-9) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= within;
const sameEnds = (found: Vec3[], expected: Vec3[], within = 1e-9) => {
  expect(found).toHaveLength(expected.length);
  for (const e of expected) expect(found.some((p) => near(p, e, within))).toBe(true);
};

describe('where the edge meets the platform outline', () => {
  it('an open edge with its ends on the outline: those two points', () => {
    sameEnds(platformEndsOf([outline(), curve('edge', OPEN, false)]), [L, R]);
  });

  it('an open edge stopping a little short: the points of the outline nearest its ends', () => {
    const short = through([[-15, 3, 0], FL, FR, [15, 3, 0]], false);
    sameEnds(platformEndsOf([outline(), curve('edge', short, false)]), [L, R]);
    const aside = through([[-10, 2, 0], [-10, 60, 0], [10, 60, 0], [10, 2, 0]], false);
    sameEnds(platformEndsOf([outline(), curve('edge', aside, false)]), [[-10, 0, 0], [10, 0, 0]]);
  });

  it('an open edge too far from the outline: none', () => {
    const far = through([[-15, 12, 0], FL, FR, [15, 12, 0]], false);
    expect(platformEndsOf([outline(), curve('edge', far, false)])).toEqual([]);
  });

  it('only one end reaching it: that one', () => {
    const one = through([L, FL, FR, [15, 12, 0]], false);
    sameEnds(platformEndsOf([outline(), curve('edge', one, false)]), [L]);
  });

  it('a closed edge, along the inner or the outer rim, or going on along the platform: where it leaves the outline', () => {
    sameEnds(platformEndsOf([outline(), curve('edge', CLOSED, true)]), [L, R]);
    const backOver = through([[-15, -2, 10], FL, FR, [15, -2, 10]], true);
    sameEnds(platformEndsOf([outline(), curve('edge', backOver, true)]), [[-15, -2, 10], [15, -2, 10]]);
    const onPast = through([[0, 0, 0], L, FL, FR, R, [0, 0, 0]], false);
    sameEnds(platformEndsOf([outline(), curve('edge', onPast, false)]), [L, R]);
  });

  it('a closed edge not meeting the outline: none', () => {
    const away = through([[-10, 20, 0], [-10, 50, 0], [10, 50, 0], [10, 20, 0]], true);
    expect(platformEndsOf([outline(), curve('edge', away, true)])).toEqual([]);
  });

  it('two edges: the two points furthest apart', () => {
    const left = through([L, FL], false), right = through([R, FR], false);
    sameEnds(platformEndsOf([outline(), curve('edge', left, false), curve('edge', right, false)]), [L, R]);
    const inner = through([[5, 0, 0], [5, 30, 0]], false);
    sameEnds(platformEndsOf([outline(), curve('edge', left, false), curve('edge', right, false), curve('edge', inner, false)]), [L, R]);
  });

  it('nothing without a closed outline or an edge', () => {
    expect(platformEndsOf([curve('edge', OPEN, false)])).toEqual([]);
    expect(platformEndsOf([outline()])).toEqual([]);
    expect(platformEndsOf([{ ...outline(), closed: false }, curve('edge', OPEN, false)])).toEqual([]);
    expect(platformEndsOf([outline(), curve('scar_boundary', OPEN, false)])).toEqual([]);
  });

  it('needs no unit: only the curves', () => {
    const scaled = (p: Vec3[]): Vec3[] => p.map((q) => [q[0] * 0.1, q[1] * 0.1, q[2] * 0.1]);
    sameEnds(platformEndsOf([curve('platform_outline', scaled(OUTLINE), true), curve('edge', scaled(OPEN), false)]), [[-1.5, 0, 0], [1.5, 0, 0]], 1e-6);
  });
});

/** As a curve of a project: a closed one has three anchors at least, or a file reads it as open. */
const shape = (points: Vec3[], closed: boolean) => {
  const anchorIndex = closed ? [0, Math.floor(points.length / 3), Math.floor((2 * points.length) / 3)] : [0, points.length - 1];
  return { anchors: anchorIndex.map((i) => points[i]), points, anchorIndex, closed };
};

const storeOf = (type: SpecimenInfo['type'] = 'flake') => {
  const st = emptyProject();
  st.specimen = { ...st.specimen, type, unit: 'mm' };
  return new ProjectStore(st);
};
const endsOf = (s: ProjectStore) => s.state.landmarks.filter((l) => l.code === 'platform_end');
const withBoth = () => {
  const s = storeOf();
  const o = addCurveOfType(s, shape(OUTLINE, true), 'platform_outline');
  const e = addCurveOfType(s, shape(OPEN, false), 'edge');
  return { s, o, e };
};

describe('a flake\'s platform ends follow its curves', () => {
  it('come with the edge and the outline, in either order, in the step of the curve', () => {
    const { s } = withBoth();
    expect(endsOf(s).map((l) => l.auto)).toEqual([true, true]);
    sameEnds(endsOf(s).map((l) => l.point), [L, R]);

    const other = storeOf();
    addCurveOfType(other, shape(OPEN, false), 'edge');
    expect(endsOf(other)).toEqual([]);
    addCurveOfType(other, shape(OUTLINE, true), 'platform_outline');
    sameEnds(endsOf(other).map((l) => l.point), [L, R]);
    other.history.undo();
    expect(endsOf(other)).toEqual([]);
    expect(other.state.curves).toHaveLength(1);
    other.history.redo();
    expect(endsOf(other)).toHaveLength(2);
  });

  it('come when a curve gets its type, and go when it loses it', () => {
    const s = storeOf();
    addCurveOfType(s, shape(OUTLINE, true), 'platform_outline');
    const e = addCurve(s, shape(OPEN, false));
    expect(endsOf(s)).toEqual([]);
    setCurveAttribute(s, e.id, 'type', 'edge');
    expect(endsOf(s)).toHaveLength(2);
    setCurveAttribute(s, e.id, 'type', 'scar_boundary');
    expect(endsOf(s)).toEqual([]);
  });

  it('follow the edge when it changes, keeping their ids', () => {
    const { s, e } = withBoth();
    const ids = endsOf(s).map((l) => l.id);
    setCurveShape(s, e.id, shape(through([[-10, 0, 0], [-10, 60, 0], [10, 60, 0], [10, 0, 0]], false), false));
    expect(endsOf(s).map((l) => l.id)).toEqual(ids);
    sameEnds(endsOf(s).map((l) => l.point), [[-10, 0, 0], [10, 0, 0]]);
    // the step takes both back
    s.history.undo();
    sameEnds(endsOf(s).map((l) => l.point), [L, R]);
    expect(s.curve(e.id)!.points[0]).toEqual(L);
  });

  it('go with the edge or the outline', () => {
    const { s, e, o } = withBoth();
    deleteCurve(s, e.id);
    expect(endsOf(s)).toEqual([]);
    s.history.undo();
    expect(endsOf(s)).toHaveLength(2);
    deleteCurve(s, o.id);
    expect(endsOf(s)).toEqual([]);
  });

  it('a new outline: to where the edge meets that', () => {
    const { s, o } = withBoth();
    const wider = through([[-15, 0, 0], [15, 0, 0], [15, -4, 12], [-15, -4, 12]], true);
    addCurveOfType(s, shape(wider, true), 'platform_outline');
    expect(s.curve(o.id)).toBeUndefined();
    sameEnds(endsOf(s).map((l) => l.point), [L, R]);
  });

  it('moved by hand, it stays there; the other goes on following', () => {
    const { s, e } = withBoth();
    const left = endsOf(s).find((l) => l.point[0] < 0)!, right = endsOf(s).find((l) => l.point[0] > 0)!;
    moveLandmark(s, left.id, [-12, 0, 0]);
    expect(s.landmark(left.id)!.auto).toBeUndefined();
    setCurveShape(s, e.id, shape(through([[-10, 0, 0], [-10, 60, 0], [10, 60, 0], [10, 0, 0]], false), false));
    expect(s.landmark(left.id)!.point).toEqual([-12, 0, 0]);
    expect(near(s.landmark(right.id)!.point, [10, 0, 0])).toBe(true);
    expect(endsOf(s)).toHaveLength(2);
    // undone, it follows again
    s.history.undo();
    s.history.undo();
    expect(s.landmark(left.id)!.auto).toBe(true);
    expect(near(s.landmark(left.id)!.point, L)).toBe(true);
  });

  it('its delete takes one moved by hand back to following; one following stays', () => {
    const { s } = withBoth();
    const left = endsOf(s).find((l) => l.point[0] < 0)!;
    deleteLandmark(s, left.id);
    expect(endsOf(s)).toHaveLength(2);
    expect(s.history.canUndo).toBe(true);
    moveLandmark(s, left.id, [-12, 0, 0]);
    deleteLandmark(s, left.id);
    const back = s.landmark(left.id)!;
    expect(back.auto).toBe(true);
    expect(near(back.point, L)).toBe(true);
    expect(endsOf(s)).toHaveLength(2);
    s.history.undo();
    expect(s.landmark(left.id)!.point).toEqual([-12, 0, 0]);
  });

  it('what refers to one that goes loses it, one that moves keeps it', () => {
    const { s, e } = withBoth();
    const end = endsOf(s)[0];
    const set = addSemilandmarkSet(s, e.id);
    updateSemilandmarkSet(s, set.id, { startLandmarkId: end.id });
    setCurveShape(s, e.id, shape(through([[-10, 0, 0], [-10, 60, 0], [10, 60, 0], [10, 0, 0]], false), false));
    expect(s.state.semilandmarks[0].startLandmarkId).toBe(end.id);
    setCurveShape(s, e.id, shape(through([[-10, 30, 0], [-10, 60, 0], [10, 60, 0], [10, 30, 0]], false), false));
    expect(endsOf(s)).toEqual([]);
    expect(s.state.semilandmarks[0].startLandmarkId).toBeNull();
  });

  it('ends placed by hand, as in an earlier file, are not touched, and none is added beside them', () => {
    const s = storeOf();
    addCurveOfType(s, shape(OUTLINE, true), 'platform_outline');
    placePlatformEnd(s, [-14.9, 0, 0]);
    placePlatformEnd(s, [14.9, 0, 0]);
    const before = endsOf(s).map((l) => l.point);
    addCurveOfType(s, shape(OPEN, false), 'edge');
    expect(endsOf(s).map((l) => l.point)).toEqual(before);
    expect(endsOf(s).every((l) => !l.auto)).toBe(true);
  });

  it('one placed by hand takes the place nearest it; the other is found', () => {
    const s = storeOf();
    addCurveOfType(s, shape(OUTLINE, true), 'platform_outline');
    placePlatformEnd(s, [12, 0, 0]);
    addCurveOfType(s, shape(OPEN, false), 'edge');
    expect(endsOf(s)).toHaveLength(2);
    const found = endsOf(s).find((l) => l.auto)!;
    expect(near(found.point, L)).toBe(true);
  });

  it('own landmarks and the point of percussion stay out of it', () => {
    const { s } = withBoth();
    const own = addLandmark(s, [0, 30, 0]);
    moveLandmark(s, own.id, [1, 30, 0]);
    expect(s.landmark(own.id)!.auto).toBeUndefined();
    deleteLandmark(s, own.id);
    expect(s.landmark(own.id)).toBeUndefined();
  });

  it('on a core nothing; turned into a flake they come, in the step of the turning', () => {
    const s = storeOf('core');
    addCurveOfType(s, shape(OUTLINE, true), 'platform_outline');
    addCurveOfType(s, shape(OPEN, false), 'edge');
    expect(endsOf(s)).toEqual([]);
    setSpecimenType(s, 'flake');
    expect(endsOf(s)).toHaveLength(2);
    s.history.undo();
    expect(endsOf(s)).toEqual([]);
    expect(s.state.specimen.type).toBe('core');
    setSpecimenType(s, 'flake');
    // back to a core they stay in the file, hidden
    setSpecimenType(s, 'core');
    expect(endsOf(s)).toHaveLength(2);
  });

  it('are kept with their mark in the file', () => {
    const { s } = withBoth();
    const left = endsOf(s).find((l) => l.point[0] < 0)!;
    moveLandmark(s, left.id, [-12, 0, 0]);
    const again = parseProjectFile(JSON.parse(JSON.stringify(serializeProject(s.state as ProjectState, 'x'))));
    expect(again.landmarks.filter((l) => l.code === 'platform_end').map((l) => l.auto)).toEqual([undefined, true]);
    // an own landmark cannot say it follows anything
    const file = JSON.parse(JSON.stringify(serializeProject(s.state as ProjectState, 'x')));
    file.annotations.landmarks.push({ id: 'x', name: 'LM', point: [0, 0, 0], auto: true });
    expect(parseProjectFile(file).landmarks.find((l) => l.id === 'x')!.auto).toBeUndefined();
  });

  it('a file from before they followed the curves gets them when it is opened, and one with its own keeps those', () => {
    const none = storeOf();
    addCurve(none, { ...shape(OUTLINE, true), attributes: { type: 'platform_outline' } });
    addCurve(none, { ...shape(OPEN, false), attributes: { type: 'edge' } });
    const file = parseProjectFile(JSON.parse(JSON.stringify(serializeProject(none.state as ProjectState, 'x'))));
    expect(file.landmarks).toEqual([]);
    const opened = withPlatformEnds(file);
    sameEnds(opened.landmarks.map((l) => l.point), [L, R]);
    expect(opened.landmarks.every((l) => l.auto)).toBe(true);

    const own = storeOf();
    addCurve(own, { ...shape(OUTLINE, true), attributes: { type: 'platform_outline' } });
    placePlatformEnd(own, [-14.9, 0, 0]);
    placePlatformEnd(own, [14.9, 0, 0]);
    addCurve(own, { ...shape(OPEN, false), attributes: { type: 'edge' } });
    const kept = withPlatformEnds(parseProjectFile(JSON.parse(JSON.stringify(serializeProject(own.state as ProjectState, 'x')))));
    expect(kept.landmarks.map((l) => l.point)).toEqual([[-14.9, 0, 0], [14.9, 0, 0]]);
    expect(kept.landmarks.every((l) => !l.auto)).toBe(true);
  });
});

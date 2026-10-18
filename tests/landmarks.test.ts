import { describe, expect, it } from 'vitest';
import { arcLengths, landmarkTable, nearestArc, pointAtArc, sampleCurve } from '../src/compute/landmarks';
import { addCurve, addLandmark, addSemilandmarkSet, deleteCurve, deleteLandmark, moveLandmark, renameLandmark, reorderLandmark, setCurveShape, updateSemilandmarkSet, updateSpecimen } from '../src/core/actions';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import type { Vec3 } from '../src/core/types';
import { landmarksCsv, landmarksFcsv, landmarksTps, slidersCsv } from '../src/io/landmarks';

/** A polyline along x from 0 to 10 with uneven spacing. */
const line: Vec3[] = [[0, 0, 0], [1, 0, 0], [4, 0, 0], [4.5, 0, 0], [10, 0, 0]];
/** A square of side 4 (perimeter 16), closed. */
const square: Vec3[] = [[0, 0, 0], [4, 0, 0], [4, 4, 0], [0, 4, 0]];
const xs = (pts: Vec3[]) => pts.map((p) => +p[0].toFixed(9));

const shape = (points: Vec3[], closed: boolean) => ({ anchors: [points[0], points[points.length - 1]], points, anchorIndex: [0, points.length - 1], closed });

describe('equal arc-length sampling', () => {
  it('measures and walks a polyline', () => {
    expect(arcLengths(line, false)).toEqual([0, 1, 4, 4.5, 10]);
    expect(arcLengths(square, true)).toEqual([0, 4, 8, 12, 16]);
    expect(pointAtArc(line, false, arcLengths(line, false), 7)).toEqual([7, 0, 0]);
    expect(pointAtArc(square, true, arcLengths(square, true), 18)).toEqual([2, 0, 0]);
    expect(nearestArc(square, true, arcLengths(square, true), [-1, 1, 3])).toBeCloseTo(15, 12);
  });

  it('includes the ends of an open curve, and leaves out the landmarks it runs between', () => {
    expect(xs(sampleCurve({ points: line, closed: false }, 5, null, null)!.points)).toEqual([0, 2.5, 5, 7.5, 10]);
    // between landmarks at x = 2 and x = 8 (off the curve: their nearest points count)
    const s = sampleCurve({ points: line, closed: false }, 2, { id: 'a', point: [2, 1, 0] }, { id: 'b', point: [8, 0, -3] })!;
    expect(xs(s.points)).toEqual([4, 6]);
    expect([s.before, s.after, s.loop]).toEqual(['a', 'b', false]);
    // the curve drawn the other way: the points still run from the start landmark to the end one
    const back = sampleCurve({ points: [...line].reverse(), closed: false }, 2, { id: 'a', point: [2, 0, 0] }, { id: 'b', point: [8, 0, 0] })!;
    expect(xs(back.points)).toEqual([4, 6]);
    // one landmark: to the farther end, which is included
    expect(xs(sampleCurve({ points: line, closed: false }, 4, { id: 'a', point: [8, 0, 0] }, null)!.points)).toEqual([6, 4, 2, 0]);
    expect(xs(sampleCurve({ points: line, closed: false }, 1, null, null)!.points)).toEqual([5]);
    expect(sampleCurve({ points: [[1, 1, 1], [1, 1, 1]], closed: false }, 3, null, null)).toBeNull();
  });

  it('goes once round a closed curve', () => {
    const loop = sampleCurve({ points: square, closed: true }, 8, null, null)!;
    expect(loop.loop).toBe(true);
    expect(loop.points.map((p) => p.map((v) => +v.toFixed(9)))).toEqual([[0, 0, 0], [2, 0, 0], [4, 0, 0], [4, 2, 0], [4, 4, 0], [2, 4, 0], [0, 4, 0], [0, 2, 0]]);
    // from one landmark back to it, the landmark itself left out
    const one = sampleCurve({ points: square, closed: true }, 3, { id: 'a', point: [4, 0, 0] }, null)!;
    expect(one.points.map((p) => p.map((v) => +v.toFixed(9)))).toEqual([[4, 4, 0], [0, 4, 0], [0, 0, 0]]);
    expect([one.before, one.after]).toEqual(['a', 'a']);
    // from one landmark to another, in the drawing direction
    const two = sampleCurve({ points: square, closed: true }, 1, { id: 'a', point: [4, 0, 0] }, { id: 'b', point: [0, 4, 0] })!;
    expect(two.points).toEqual([[4, 4, 0]]);
  });
});

describe('landmark table, sliders and exports', () => {
  function project() {
    const s = new ProjectStore(emptyProject());
    updateSpecimen(s, { id: 'LB 3' });
    const c = addCurve(s, shape(line, false));
    const sq = addCurve(s, shape(square, true));
    const a = addLandmark(s, [2, 0, 0]);
    const b = addLandmark(s, [8, 0, 0], 'tip, distal');
    const set1 = addSemilandmarkSet(s, c.id, 2);
    updateSemilandmarkSet(s, set1.id, { startLandmarkId: a.id, endLandmarkId: b.id });
    const set2 = addSemilandmarkSet(s, sq.id, 4);
    return { s, c, sq, a, b, set1, set2 };
  }

  it('numbers fixed landmarks first, then each set; sliders use those numbers', () => {
    const { s } = project();
    const t = landmarkTable(s.state);
    expect(t.rows.map((r) => [r.index, r.name, r.kind, r.setId])).toEqual([
      [1, 'LM1', 'fixed', ''],
      [2, 'tip, distal', 'fixed', ''],
      [3, 'SL1_1', 'curve', 'SL1'],
      [4, 'SL1_2', 'curve', 'SL1'],
      [5, 'SL2_1', 'curve', 'SL2'],
      [6, 'SL2_2', 'curve', 'SL2'],
      [7, 'SL2_3', 'curve', 'SL2'],
      [8, 'SL2_4', 'curve', 'SL2'],
    ]);
    // SL1 slides between LM1 and the second landmark; SL2 goes round its loop
    expect(t.sliders).toEqual([
      [1, 3, 4],
      [3, 4, 2],
      [8, 5, 6],
      [5, 6, 7],
      [6, 7, 8],
      [7, 8, 5],
    ]);
    expect(slidersCsv(t)).toBe('before,slider,after\n1,3,4\n3,4,2\n8,5,6\n5,6,7\n6,7,8\n7,8,5\n');
    // an open curve without landmarks: its end points do not slide
    const open = new ProjectStore();
    addSemilandmarkSet(open, addCurve(open, shape(line, false)).id, 4);
    expect(landmarkTable(open.state).sliders).toEqual([
      [1, 2, 3],
      [2, 3, 4],
    ]);
  });

  it('writes TPS, Slicer markups and the long CSV in the same order', () => {
    const { s } = project();
    const t = landmarkTable(s.state);
    expect(landmarksTps(s.state, t)).toBe('LM3=8\n2 0 0\n8 0 0\n4 0 0\n6 0 0\n0 0 0\n4 0 0\n4 4 0\n0 4 0\nID=LB 3\n');
    const fcsv = landmarksFcsv(t).split('\n');
    expect(fcsv.slice(0, 3)).toEqual(['# Markups fiducial file version = 4.11', '# CoordinateSystem = LPS', '# columns = id,x,y,z,ow,ox,oy,oz,vis,sel,lock,label,desc,associatedNodeID']);
    expect(fcsv[3]).toBe('1,2,0,0,0,0,0,1,1,1,0,LM1,,');
    expect(fcsv[4]).toBe('2,8,0,0,0,0,0,1,1,1,0,"tip, distal",,');
    expect(fcsv[5]).toBe('3,4,0,0,0,0,0,1,1,1,0,SL1_1,SL1,');
    expect(fcsv).toHaveLength(3 + 8 + 1);
    const csv = landmarksCsv(s.state, t, { excelBom: false }).split('\n');
    expect(csv[0]).toBe('specimen_id,index,name,kind,set_id,x,y,z');
    expect(csv[2]).toBe('LB 3,2,"tip, distal",fixed,,8,0,0');
    expect(csv[8]).toBe('LB 3,8,SL2_4,curve,SL2,0,4,0');
  });

  it('follow the curve and the landmarks; undo; save and read back', () => {
    const { s, c, a, b, set1, sq } = project();
    // the curve changes: the semilandmarks follow
    setCurveShape(s, c.id, shape(line.map((p) => [p[0], 1, 0] as Vec3), false));
    expect(landmarkTable(s.state).sets[0].points.map((p) => p[1])).toEqual([1, 1]);
    moveLandmark(s, a.id, [0, 0, 0]);
    expect(xs(landmarkTable(s.state).sets[0].points)).toEqual([8 / 3, 16 / 3].map((v) => +v.toFixed(9)));
    s.history.undo();
    s.history.undo();
    expect(xs(landmarkTable(s.state).sets[0].points)).toEqual([4, 6]);
    // renaming merges into one step; reordering changes the numbers
    renameLandmark(s, a.id, 'b');
    renameLandmark(s, a.id, 'base');
    expect(s.state.landmarks[0].name).toBe('base');
    s.history.undo();
    expect(s.state.landmarks[0].name).toBe('LM1');
    reorderLandmark(s, b.id, 0);
    expect(landmarkTable(s.state).rows.slice(0, 2).map((r) => r.name)).toEqual(['tip, distal', 'LM1']);
    expect(landmarkTable(s.state).sliders[0]).toEqual([2, 3, 4]);
    // deleting a landmark frees the set's end; deleting the curve leaves the set without points
    deleteLandmark(s, b.id);
    expect(s.semilandmarkSet(set1.id)!.endLandmarkId).toBeNull();
    s.history.undo();
    expect(s.semilandmarkSet(set1.id)!.endLandmarkId).toBe(b.id);
    deleteCurve(s, sq.id);
    expect(landmarkTable(s.state).sets[1]).toMatchObject({ valid: false, points: [] });
    s.history.undo();
    expect(updateSemilandmarkSet(s, set1.id, { count: 0 })).toBeUndefined();
    expect(s.semilandmarkSet(set1.id)!.count).toBe(2);

    const file = JSON.parse(JSON.stringify(serializeProject(s.state, '0.2.0')));
    const back = parseProjectFile(file);
    expect([back.landmarks, back.semilandmarks]).toEqual([s.state.landmarks, s.state.semilandmarks]);
    expect([back.nextLandmarkNumber, back.nextSemilandmarkNumber]).toEqual([2, 3]);
    expect(file.derived.landmarks.rows).toHaveLength(8);
    expect(file.derived.landmarks.sliders).toEqual(landmarkTable(s.state).sliders);
    file.annotations.semilandmarks[0].startLandmarkId = 'gone';
    expect(parseProjectFile(file).semilandmarks[0].startLandmarkId).toBeNull();
    delete file.annotations.landmarks[0].point;
    expect(() => parseProjectFile(file)).toThrow(/Landmark 1 needs a numeric "point"/);
  });
});

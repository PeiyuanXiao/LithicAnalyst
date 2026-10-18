import { describe, expect, it } from 'vitest';
import { vertexPca } from '../src/compute/meshGeometry';
import { computePlane, planeFrame, resampleCurve } from '../src/compute/planes';
import { addCurve, addPlane, addScarVector, deleteScar, flipPlane, setPlaneCurve, setPlaneExclusion, setPlaneMethod, setScarAttribute } from '../src/core/actions';
import { assembleCurve } from '../src/core/curveGeometry';
import { computeDerived } from '../src/core/derived';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { ProjectStore } from '../src/core/store';
import type { Vec3 } from '../src/core/types';
import { planesCsv } from '../src/io/csv';
import { box, moved } from './meshes';

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const apply = (m: number[], p: Vec3): Vec3 => [0, 1, 2].map((r) => m[4 * r] * p[0] + m[4 * r + 1] * p[1] + m[4 * r + 2] * p[2] + m[4 * r + 3]) as Vec3;
const N: Vec3 = [0, 0, 1];

/** A tilted plane through (300, −40, 12) with normal ∝ (−0.3, 0.2, 1), and two in-plane directions. */
const NORMAL = unit([-0.3, 0.2, 1]);
const U = unit([1, 0, 0.3]);
const V: Vec3 = [NORMAL[1] * U[2] - NORMAL[2] * U[1], NORMAL[2] * U[0] - NORMAL[0] * U[2], NORMAL[0] * U[1] - NORMAL[1] * U[0]];
const C: Vec3 = [300, -40, 12];
const onPlane = (a: number, b: number, h = 0): Vec3 => [0, 1, 2].map((k) => C[k] + a * U[k] + b * V[k] + h * NORMAL[k]) as Vec3;

describe('curve resampling', () => {
  it('spaces points evenly along open and closed lines', () => {
    const line: Vec3[] = [[0, 0, 0], [1, 0, 0], [10, 0, 0]];
    expect(resampleCurve(line, false, 2.5).map((p) => p[0])).toEqual([0, 2.5, 5, 7.5, 10]);
    const square: Vec3[] = [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]];
    const pts = resampleCurve(square, true, 1);
    expect(pts).toHaveLength(8);
    expect(pts[7]).toEqual([0, 1, 0]);
  });
});

describe('fitted planes', () => {
  it('scar starts: recover a known plane, honour the completeness filter, and orient the normal by upHint', () => {
    const s = new ProjectStore();
    const starts = [onPlane(0, 0), onPlane(5, 0), onPlane(0, 5), onPlane(-4, 3), onPlane(3, -6)];
    for (const p of starts) addScarVector(s, { start: p, end: [p[0] + 1, p[1], p[2]], startNormal: N, endNormal: N });
    // an outlier, marked as both ends missing
    const out = addScarVector(s, { start: onPlane(1, 1, 30), end: onPlane(2, 1, 30), startNormal: N, endNormal: N });
    setScarAttribute(s, out.id, 'completeness', 'both_missing');
    const plane = addPlane(s, 'scar_starts', [0, 0, -1]);

    let r = computePlane(s.plane(plane.id)!, s.state, null);
    expect(r.inputCount).toBe(6);
    expect(Math.abs(dot(r.normal!, NORMAL))).toBeLessThan(0.999);

    setPlaneExclusion(s, plane.id, 'both_missing', true);
    r = computePlane(s.plane(plane.id)!, s.state, null);
    expect(r.inputCount).toBe(5);
    expect(dot(r.normal!, NORMAL)).toBeCloseTo(-1, 9); // upHint points down
    const mean = starts.reduce<number[]>((a, p) => a.map((x, k) => x + p[k] / starts.length), [0, 0, 0]);
    r.center!.forEach((x, k) => expect(x).toBeCloseTo(mean[k], 9));

    flipPlane(s, plane.id);
    r = computePlane(s.plane(plane.id)!, s.state, null);
    expect(dot(r.normal!, NORMAL)).toBeCloseTo(1, 9);
    s.history.undo();
    expect(dot(computePlane(s.plane(plane.id)!, s.state, null).normal!, NORMAL)).toBeCloseTo(-1, 9);

    // fewer than three points: invalid
    const few = new ProjectStore();
    addScarVector(few, { start: [0, 0, 0], end: [1, 0, 0], startNormal: N, endNormal: N });
    addScarVector(few, { start: [0, 1, 0], end: [1, 1, 0], startNormal: N, endNormal: N });
    const p2 = addPlane(few, 'scar_starts', N);
    expect(computePlane(p2, few.state, null)).toMatchObject({ valid: false, center: null, normal: null, matrix: null, inputCount: 2 });
  });

  it('scar directions: the plane most parallel to all of them', () => {
    const s = new ProjectStore();
    // directions in a band around the plane (each tilted out of it a little, alternately)
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 8;
      const d = [0, 1, 2].map((i) => Math.cos(a) * U[i] + Math.sin(a) * V[i] + (k % 2 ? 0.05 : -0.05) * NORMAL[i]) as Vec3;
      const start = onPlane(k, -k);
      addScarVector(s, { start, end: [start[0] + 3 * d[0], start[1] + 3 * d[1], start[2] + 3 * d[2]], startNormal: N, endNormal: N });
    }
    const p = addPlane(s, 'scar_directions', NORMAL);
    const r = computePlane(p, s.state, null);
    expect(r.valid).toBe(true);
    expect(dot(r.normal!, NORMAL)).toBeCloseTo(1, 3);

    // all parallel: invalid
    const par = new ProjectStore();
    addScarVector(par, { start: [0, 0, 0], end: [1, 0, 0], startNormal: N, endNormal: N });
    addScarVector(par, { start: [0, 5, 0], end: [-2, 5, 0], startNormal: N, endNormal: N });
    expect(computePlane(addPlane(par, 'scar_directions', N), par.state, null).valid).toBe(false);
  });

  it('curves: an open arc of a tilted circle is enough, and the plane follows its inputs', () => {
    const s = new ProjectStore();
    const arc: Vec3[] = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * (Math.PI / 3); // a 60° arc of radius 20
      arc.push(onPlane(20 * Math.cos(a), 20 * Math.sin(a)));
    }
    const { points, anchorIndex } = assembleCurve([arc], false);
    const c = addCurve(s, { anchors: [arc[0], arc[40]], points, anchorIndex, closed: false });
    const p = addPlane(s, 'curves', NORMAL);
    expect(computePlane(s.plane(p.id)!, s.state, null).valid).toBe(false);
    setPlaneCurve(s, p.id, c.id, true);
    const r = computePlane(s.plane(p.id)!, s.state, null);
    expect(r.valid).toBe(true);
    expect(dot(r.normal!, NORMAL)).toBeCloseTo(1, 9);
    expect(r.inputCount).toBeGreaterThan(200);

    // switching the method recomputes from other inputs
    setPlaneMethod(s, p.id, 'scar_starts');
    expect(computePlane(s.plane(p.id)!, s.state, null).valid).toBe(false);
    s.history.undo();
    expect(computePlane(s.plane(p.id)!, s.state, null).valid).toBe(true);
  });

  it('all vertices: the vertex PCA plane, with a frame that maps the centre to the origin and the normal to +Z', () => {
    const m = moved(box([40, 20, 10], 4), [100, 200, 300]);
    const pca = vertexPca(m.positions);
    const s = new ProjectStore();
    const p = addPlane(s, 'all_vertices', [0.1, 0.2, 1]);
    const r = computePlane(p, s.state, pca);
    expect(dot(r.normal!, [0, 0, 1])).toBeCloseTo(1, 9);
    r.center!.forEach((x, k) => expect(x).toBeCloseTo([100, 200, 300][k], 4));
    const M = r.matrix!;
    apply(M, r.center!).forEach((x) => expect(x).toBeCloseTo(0, 9));
    const tip = apply(M, [r.center![0] + r.normal![0], r.center![1] + r.normal![1], r.center![2] + r.normal![2]]);
    tip.forEach((x, k) => expect(x).toBeCloseTo([0, 0, 1][k], 9));
    // +X is the first principal axis (the box's x), positive; rows are orthonormal and right-handed
    expect(M.slice(0, 3).map((x) => +x.toFixed(9))).toEqual([1, 0, 0]);
    expect(M.slice(4, 7).map((x) => +x.toFixed(9))).toEqual([0, 1, 0]);
    expect(M.slice(12)).toEqual([0, 0, 0, 1]);
    expect(computePlane(p, s.state, null).valid).toBe(false);
  });

  it('the frame uses the second axis when the first lies along the normal', () => {
    const M = planeFrame([0, 0, 0], [1, 0, 0], [[-1, 0, 0], [0, 0.6, -0.8], [0, 0.8, 0.6]]);
    // the second axis, turned so that its largest component (z) is positive
    expect(M.slice(0, 3).map((x) => +x.toFixed(9) + 0)).toEqual([0, -0.6, 0.8]);
    // largest component positive
    const M2 = planeFrame([0, 0, 0], [0, 0, 1], [[-0.8, 0.6, 0], [0.6, 0.8, 0], [0, 0, 1]]);
    expect(M2.slice(0, 3).map((x) => +x.toFixed(9))).toEqual([0.8, -0.6, 0]);
  });

  it('are saved with their inputs, recomputed into derived, and exported', () => {
    const s = new ProjectStore();
    const starts = [onPlane(0, 0), onPlane(5, 0), onPlane(0, 5)];
    const ids = starts.map((p) => addScarVector(s, { start: p, end: [p[0] + 1, p[1], p[2]], startNormal: N, endNormal: N }).id);
    const p = addPlane(s, 'scar_starts', NORMAL);
    addPlane(s, 'curves', NORMAL);
    const file = JSON.parse(JSON.stringify(serializeProject(s.state, '0.2.0')));
    expect(parseProjectFile(file).planes).toEqual(s.state.planes);
    expect(file.derived.planes.map((x: { label: string; valid: boolean }) => [x.label, x.valid])).toEqual([
      ['P1', true],
      ['P2', false],
    ]);
    // inputs change → derived changes
    deleteScar(s, ids[2]);
    expect(computeDerived(s.state).planes[0].valid).toBe(false);
    s.history.undo();

    const csv = planesCsv(s.state, computeDerived(s.state).planes, { excelBom: false }).trimEnd().split('\n');
    expect(csv[0]).toBe(
      'specimen_id,plane_id,method,center_x,center_y,center_z,normal_x,normal_y,normal_z,m00,m01,m02,m03,m10,m11,m12,m13,m20,m21,m22,m23,m30,m31,m32,m33',
    );
    const row = csv[1].split(',');
    expect(row.slice(1, 3)).toEqual([p.label, 'scar_starts']);
    expect(Number(row[6])).toBeCloseTo(NORMAL[0], 5);
    expect(row.slice(-4)).toEqual(['0', '0', '0', '1']);
    expect(csv[2]).toBe(',P2,curves' + ','.repeat(22));
  });
});

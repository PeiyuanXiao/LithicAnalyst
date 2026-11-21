import { describe, expect, it } from 'vitest';
import { autoMeasurements, frameMeasures, surfaceMeasures, surfaceMeasuresSteps } from '../src/compute/measure';
import { runSliced } from '../src/compute/steps';
import { addMeasurement, deleteMeasurement, updateSpecimen } from '../src/core/actions';
import { computeDerived } from '../src/core/derived';
import { angleDeg, measurementValue } from '../src/core/measurements';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import type { Vec3 } from '../src/core/types';
import { manualMeasurementsCsv, measurementsCsv } from '../src/io/csv';
import { box, ellipsoid, mapped, moved, rigid, sphere } from './meshes';

describe('automatic measurements', () => {
  /**
   * A box 40 × 20 × 10 (half sizes 20, 10, 5). Length: its longest distance, a space diagonal, √(40² + 20² + 10²) = √2100.
   * Width: seen along that diagonal u = (4, 2, 1)/√21 the box is a hexagon, symmetric about its centre, so its widest is twice its
   * farthest corner: |P(p)|² = |p|² − (p·u)² with |p|² = 525 for every corner and the smallest |p·u| off the diagonal = 55/√21
   * (the corner (20, −10, −5)), so width = 2√(525 − 3025/21) = 2√(8000/21) = (80/21)√105 ≈ 39.036. That corner's direction in the
   * plane is w = (5, −8, −4)/√105; across both, t = u × w = (0, 1, −2)/√5, on which the corners reach ±(10 + 10)/√5:
   * thickness = 40/√5 = 8√5 ≈ 17.889.
   */
  const BOX = { length: Math.sqrt(2100), width: (80 / 21) * Math.sqrt(105), thickness: 8 * Math.sqrt(5) };

  it('measure a box: the longest measure and the widths across it, area, volume', () => {
    const b = moved(box([40, 20, 10], 5), [1000, -500, 200]);
    const base = surfaceMeasures(b.positions, b.index);
    expect(base.topology.closed).toBe(true);
    const m = autoMeasurements(b.positions, base).auto;
    expect(m.length).toBeCloseTo(BOX.length, 6);
    expect(m.width).toBeCloseTo(BOX.width, 6);
    expect(m.thickness).toBeCloseTo(BOX.thickness, 6);
    expect(m.surfaceArea).toBeCloseTo(2800, 2);
    expect(m.volume!).toBeCloseTo(8000, 1);
    expect(m.closed).toBe(true);
    // how they were taken: the line of each, as long as its value, in original coordinates (offset added)
    const r = autoMeasurements(b.positions, base, [1, 2, 3]);
    const span = (p: [Vec3, Vec3]) => Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]);
    expect(span(r.construction!.length)).toBeCloseTo(BOX.length, 6);
    expect(span(r.construction!.width)).toBeCloseTo(BOX.width, 6);
    expect(span(r.construction!.thickness)).toBeCloseTo(BOX.thickness, 6);
    const mid = r.construction!.length.map((p) => p[0]).reduce((a, x) => a + x, 0) / 2;
    expect(mid).toBeCloseTo(1000 + 1, 6);
  });

  it('measure an ellipsoid of half axes a > b > c as 2a, 2b and 2c', () => {
    const [a, b, c] = [30, 18, 7];
    const e = ellipsoid(a, b, c);
    const m = autoMeasurements(e.positions, surfaceMeasures(e.positions, e.index)).auto;
    // (a mesh of 96 × 128 rows and columns: within 0.2 %)
    expect(Math.abs(m.length / (2 * a) - 1)).toBeLessThan(0.002);
    expect(Math.abs(m.width / (2 * b) - 1)).toBeLessThan(0.002);
    expect(Math.abs(m.thickness / (2 * c) - 1)).toBeLessThan(0.002);
  });

  it('take no frame: the same with a specimen frame set or not, and however the model is turned', () => {
    const b = box([40, 20, 10], 2);
    const base = surfaceMeasures(b.positions, b.index);
    // as the project stores them: without a frame, and with one tilted 45° about Z (that turns the box of the volumetric
    // configuration, not the dimensions)
    const c = Math.SQRT1_2;
    const tilted = { matrix: [c, -c, 0, 0, c, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], source: 'test' };
    const stored = (frame: typeof tilted | null) => {
      const s = new ProjectStore(emptyProject());
      updateSpecimen(s, { id: 'box', frame });
      const box = frameMeasures(b.positions, base, frame).box;
      return { measurements: serializeProject(s.state, 'test', { measurements: autoMeasurements(b.positions, base).auto, vertices: null, box }).derived.measurements, box };
    };
    const none = stored(null), framed = stored(tilted);
    expect(framed.measurements).toEqual(none.measurements);
    expect(framed.box.max).not.toEqual(none.box.max);
    const plain = autoMeasurements(b.positions, base).auto;
    expect(none.measurements).toEqual(plain);
    // the model itself turned and moved: the same dimensions
    const turned = mapped(b, rigid([1, 2, 3], 37, [5, -4, 9]));
    const t = autoMeasurements(turned.positions, surfaceMeasures(turned.positions, turned.index)).auto;
    expect(t.length).toBeCloseTo(plain.length, 4);
    expect(t.width).toBeCloseTo(plain.width, 4);
    expect(t.thickness).toBeCloseTo(plain.thickness, 4);
  });

  it('approach the sphere values', async () => {
    const s = sphere(5, 4);
    const base = await runSliced(surfaceMeasuresSteps(s.positions, s.index), 1);
    const m = autoMeasurements(s.positions, base).auto;
    expect(m.surfaceArea / (4 * Math.PI * 25)).toBeCloseTo(1, 1);
    expect(m.volume! / ((4 / 3) * Math.PI * 125)).toBeCloseTo(1, 1);
    expect(m.length / 10).toBeCloseTo(1, 2);
  });

  it('leave volume-based values empty for an open mesh; no frame column', () => {
    const open = box([2, 2, 2], 4, ['+z']);
    const m = autoMeasurements(open.positions, surfaceMeasures(open.positions, open.index)).auto;
    expect(m.closed).toBe(false);
    expect(m.surfaceArea).toBeCloseTo(20, 6);
    expect(m.volume).toBeNull();
    const st = emptyProject();
    st.specimen.id = 'open';
    const [head, row] = measurementsCsv(st, m, { excelBom: false }).split('\n');
    expect(head.split(',')).not.toContain('frame');
    expect(head.split(',').slice(0, 5)).toEqual(['specimen_id', 'unit', 'length', 'width', 'thickness']);
    const cells = row.split(',');
    expect(cells.slice(0, 2)).toEqual(['open', 'mm']);
    expect(Number(cells[2])).toBeCloseTo(Math.sqrt(12), 3);
    expect(cells.slice(5)).toEqual(['20', '', 'false', '', '', '', '', '', '', '', '']);
  });
});

describe('manual measurements', () => {
  const pts: Vec3[] = [
    [0, 0, 0],
    [3, 4, 0],
    [3, 4, 12],
  ];

  it('compute distances, path lengths and angles', () => {
    const s = new ProjectStore();
    const d = addMeasurement(s, { type: 'distance', points: [pts[0], pts[1]] });
    const g = addMeasurement(s, { type: 'geodesic', points: [pts[0], pts[2]], path: pts });
    const a = addMeasurement(s, { type: 'angle', points: [[1, 0, 0], [0, 0, 0], [0, 2, 0]] });
    expect(s.state.measurements.map((m) => m.label)).toEqual(['M1', 'M2', 'M3']);
    expect(measurementValue(d)).toBe(5);
    expect(measurementValue(g)).toBe(17);
    expect(measurementValue(a)).toBeCloseTo(90, 12);
    expect(angleDeg([1, 0, 0], [0, 0, 0], [1, 1, 0])).toBeCloseTo(45, 12);
    expect(angleDeg([1, 0, 0], [0, 0, 0], [-1, 0, 0])).toBeCloseTo(180, 12);
    // a path is only kept for geodesics
    expect(addMeasurement(s, { type: 'distance', points: [pts[0], pts[1]], path: pts }).path).toBeNull();
  });

  it('undo, redo, save and read back, and export', () => {
    const s = new ProjectStore(emptyProject());
    updateSpecimen(s, { id: 'LB-1' });
    const d = addMeasurement(s, { type: 'distance', points: [pts[0], pts[1]] });
    addMeasurement(s, { type: 'geodesic', points: [pts[0], pts[2]], path: pts });
    addMeasurement(s, { type: 'angle', points: [[1, 0, 0], [0, 0, 0], [0, 2, 0]] });
    deleteMeasurement(s, d.id);
    expect(s.state.measurements.map((m) => m.label)).toEqual(['M2', 'M3']);
    s.history.undo();
    expect(s.state.measurements.map((m) => m.label)).toEqual(['M1', 'M2', 'M3']);
    s.history.undo();
    expect(s.state.nextMeasureNumber).toBe(3);
    s.history.redo();
    expect(s.state.nextMeasureNumber).toBe(4);

    const file = JSON.parse(JSON.stringify(serializeProject(s.state, '0.2.0')));
    const back = parseProjectFile(file);
    expect(back.measurements).toEqual(s.state.measurements);
    expect(back.nextMeasureNumber).toBe(4);
    expect(file.derived.manualMeasurements.map((m: { label: string; value: number; unit: string }) => [m.label, m.value, m.unit])).toEqual([
      ['M1', 5, 'mm'],
      ['M2', 17, 'mm'],
      ['M3', 90, 'deg'],
    ]);
    expect(file.derived.measurements).toBeNull();

    expect(manualMeasurementsCsv(s.state, { excelBom: false })).toBe(
      'specimen_id,measure_id,type,value,unit,p1_x,p1_y,p1_z,p2_x,p2_y,p2_z,p3_x,p3_y,p3_z\n' +
        'LB-1,M1,distance,5,mm,0,0,0,3,4,0,,,\n' +
        'LB-1,M2,geodesic,17,mm,0,0,0,3,4,12,,,\n' +
        'LB-1,M3,angle,90,deg,1,0,0,0,0,0,0,2,0\n',
    );
    expect(computeDerived(s.state).manualMeasurements).toHaveLength(3);
  });

  it('rejects measurements with the wrong number of points', () => {
    const s = new ProjectStore();
    addMeasurement(s, { type: 'angle', points: [[1, 0, 0], [0, 0, 0], [0, 2, 0]] });
    const file = JSON.parse(JSON.stringify(serializeProject(s.state, '0.2.0')));
    file.annotations.measurements[0].points.pop();
    expect(() => parseProjectFile(file)).toThrow(/Measurement 1 needs 3/);
    file.annotations.measurements[0].type = 'area';
    expect(() => parseProjectFile(file)).toThrow(/unknown type/);
  });
});

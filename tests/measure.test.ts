import { describe, expect, it } from 'vitest';
import { autoMeasurements, surfaceMeasures, surfaceMeasuresSteps } from '../src/compute/measure';
import { runSliced } from '../src/compute/steps';
import { addMeasurement, deleteMeasurement, updateSpecimen } from '../src/core/actions';
import { computeDerived } from '../src/core/derived';
import { angleDeg, measurementValue } from '../src/core/measurements';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import type { Vec3 } from '../src/core/types';
import { manualMeasurementsCsv, measurementsCsv } from '../src/io/csv';
import { box, moved, sphere } from './meshes';

describe('automatic measurements', () => {
  it('measure a box: dimensions on the principal axes, area, volume and shape indices', () => {
    const b = moved(box([40, 20, 10], 5), [1000, -500, 200]);
    const base = surfaceMeasures(b.positions, b.index);
    expect(base.topology.closed).toBe(true);
    const m = autoMeasurements(b.positions, base, null);
    expect(m.frame).toBe('principal');
    expect(m.length).toBeCloseTo(40, 3);
    expect(m.width).toBeCloseTo(20, 3);
    expect(m.thickness).toBeCloseTo(10, 3);
    expect(m.surfaceArea).toBeCloseTo(2800, 2);
    expect(m.volume!).toBeCloseTo(8000, 1);
    // A / V^(2/3) = 2800 / 400
    expect(m.surfaceToVolumeRatio!).toBeCloseTo(7, 4);
    expect(m.wadellSphericity!).toBeCloseTo((Math.cbrt(Math.PI) * Math.pow(48000, 2 / 3)) / 2800, 4);
    expect(m.closed).toBe(true);
  });

  it('approach the sphere values and use the specimen frame when there is one', async () => {
    const s = sphere(5, 4);
    const base = await runSliced(surfaceMeasuresSteps(s.positions, s.index), 1);
    const m = autoMeasurements(s.positions, base, null);
    expect(m.wadellSphericity!).toBeCloseTo(1, 2);
    expect(m.surfaceToVolumeRatio! / Math.cbrt(36 * Math.PI)).toBeCloseTo(1, 2);

    // a box turned 90° in the frame: length along the frame's Y = the box's X
    const b = box([40, 20, 10], 2);
    const frame = { matrix: [0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], source: 'test' };
    const f = autoMeasurements(b.positions, surfaceMeasures(b.positions, b.index), frame);
    expect([f.frame, f.length, f.width, f.thickness]).toEqual(['specimen', 40, 20, 10]);
    // a frame tilted 45° about Z: the box's diagonal extents
    const c = Math.SQRT1_2;
    const tilted = { matrix: [c, -c, 0, 0, c, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], source: 'test' };
    const g = autoMeasurements(b.positions, surfaceMeasures(b.positions, b.index), tilted);
    expect(g.length).toBeCloseTo(60 * c, 5);
    expect(g.width).toBeCloseTo(60 * c, 5);
  });

  it('leave volume-based values empty for an open mesh', () => {
    const open = box([2, 2, 2], 4, ['+z']);
    const m = autoMeasurements(open.positions, surfaceMeasures(open.positions, open.index), null);
    expect(m.closed).toBe(false);
    expect(m.surfaceArea).toBeCloseTo(20, 6);
    expect([m.volume, m.surfaceToVolumeRatio, m.wadellSphericity]).toEqual([null, null, null]);
    const st = emptyProject();
    st.specimen.id = 'open';
    expect(measurementsCsv(st, m, { excelBom: false }).split('\n')[1]).toBe('open,mm,principal,2,2,2,20,,,,false,,,,,,,,,,');
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

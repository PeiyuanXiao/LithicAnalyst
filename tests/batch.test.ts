import { describe, expect, it } from 'vitest';
import { autoMeasurements, surfaceMeasures } from '../src/compute/measure';
import { addLandmark, addScarVector, updateSpecimen } from '../src/core/actions';
import { emptyProject, ProjectStore } from '../src/core/store';
import { batchOutputs, iccCsv, mergeCsv, type BatchSpecimen } from '../src/io/batch';
import { projectNameFor } from '../src/io/workspace';
import { box } from './meshes';

function specimen(id: string, size: [number, number, number], observers: Record<string, Record<string, number>> = {}, arrows = 0): BatchSpecimen {
  const s = new ProjectStore(emptyProject());
  updateSpecimen(s, { id });
  for (let i = 0; i < arrows; i++) addScarVector(s, { start: [i, 0, 0], end: [i, 1, 0], startNormal: [0, 0, 1], endNormal: [0, 0, 1] });
  if (arrows) addLandmark(s, [0, 0, 0], 'apex');
  const b = box(size, 2);
  return {
    state: s.state,
    auto: autoMeasurements(b.positions, surfaceMeasures(b.positions, b.index), null),
    planes: [],
    regions: [],
    regionTotals: null,
    nodule: null,
    split: null,
    observers: new Map(Object.entries(observers)),
  };
}

describe('batch outputs', () => {
  it('merge CSV texts under one header', () => {
    expect(mergeCsv(['﻿a,b\n1,2\n', 'a,b\n3,4\n', 'a,b\n'], false)).toBe('a,b\n1,2\n3,4\n');
    expect(mergeCsv(['a\n1\n'], true)).toBe('﻿a\n1\n');
  });

  it('one measurement row per specimen; kinds without rows are left out', () => {
    const out = batchOutputs([specimen('A', [40, 20, 10], {}, 2), specimen('B', [30, 20, 10])], { excelBom: false });
    expect(out.map((f) => f.suffix)).toEqual(['measurements.csv', 'scar_vectors.csv', 'landmarks.csv', 'landmarks.tps']);
    const rows = out[0].text.trim().split('\n');
    expect(rows).toHaveLength(3);
    expect(rows[1].startsWith('A,mm,principal,40,20,10,')).toBe(true);
    expect(rows[2].startsWith('B,mm,principal,30,20,10,')).toBe(true);
    expect(out[1].text.trim().split('\n')).toHaveLength(3);
    expect(out[3].text).toBe('LM3=1\n0 0 0\nID=A\n');
  });

  it('ICC(2,1) over the specimens every observer measured', () => {
    // Shrout & Fleiss (1979): 6 specimens × 4 observers → 0.29; a seventh specimen lacks one observer
    const data = [
      [9, 2, 5, 8],
      [6, 1, 3, 2],
      [8, 4, 6, 8],
      [7, 1, 2, 6],
      [10, 5, 6, 9],
      [6, 2, 4, 7],
    ];
    const specimens = data.map((row, i) => specimen(`S${i}`, [3, 2, 1], Object.fromEntries(row.map((v, k) => [`J${k + 1}`, { length: v }]))));
    specimens.push(specimen('S6', [3, 2, 1], { J1: { length: 1 }, J2: { length: 2 } }));
    const csv = iccCsv(specimens)!.split('\n');
    expect(csv[0]).toBe('measure,n_specimens,n_raters,icc');
    const [m, n, k, icc] = csv[1].split(',');
    expect([m, n, k]).toEqual(['length', '6', '4']);
    expect(Number(icc)).toBeCloseTo(0.29, 2);
    // one observer: no ICC
    expect(iccCsv([specimen('X', [1, 1, 1], { J1: { length: 1 } }), specimen('Y', [1, 1, 1], { J1: { length: 2 } })])).toBeNull();
  });

  it('keeps the project next to its model', () => {
    expect(projectNameFor('LB-1.ply')).toBe('LB-1.lithicanalyst.json');
    expect(projectNameFor('a.b.stl')).toBe('a.b.lithicanalyst.json');
  });
});

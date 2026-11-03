import { describe, expect, it } from 'vitest';
import { addScarVector, setScarAttribute, updateSpecimen } from '../src/core/actions';
import { parseProjectFile, ProjectFileError, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import type { Scar } from '../src/core/types';
import { scarVectorCsv } from '../src/io/csv';

/** A project file as written by 0.1.0 (format 1, no curves). */
function v1File(): Record<string, unknown> {
  return {
    format: 'lithicanalyst-project',
    formatVersion: 1,
    app: { name: 'LithicAnalyst', version: '0.1.0' },
    savedAt: '2026-10-15T20:45:00.000Z',
    specimen: { id: 'LB-1023', annotator: 'PX', unit: 'mm', notes: 'core' },
    mesh: {
      fileName: 'LB-1023.ply',
      format: 'ply',
      fileSize: 1234,
      sha256: 'ab12',
      vertexCount: 10,
      triangleCount: 16,
      bboxMin: [0, 0, 0],
      bboxMax: [40, 30, 20],
    },
    annotations: {
      scarVectors: [
        {
          id: '6f0c1c2e-6b0e-4d3f-9a7e-3a1f2b9c8d10',
          label: 'S1',
          start: [12.734, -3.118, 9.905],
          end: [2.051, 1.877, 11.402],
          startNormal: [0, 0, 1],
          endNormal: [0, 0.6, 0.8],
          attributes: { completeness: 'bulb_truncated', certainty: 'probable', note: 'hinge, "step"' },
          createdAt: '2026-10-15T20:31:02.114Z',
          modifiedAt: '2026-10-15T20:31:40.551Z',
        },
        {
          id: '0d1c2b3a-4f5e-4d6c-8b7a-9e8f7a6b5c4d',
          label: 'S3',
          start: [1, 2, 3],
          end: [4, 5, 6],
          startNormal: [1, 0, 0],
          endNormal: [1, 0, 0],
          attributes: { completeness: 'point_complete', certainty: 'certain', note: '' },
          createdAt: '2026-10-15T20:32:00.000Z',
          modifiedAt: '2026-10-15T20:32:00.000Z',
        },
      ],
    },
    nextLabelNumber: 4,
    createdAt: '2026-10-15T20:30:00.000Z',
    modifiedAt: '2026-10-15T20:32:00.000Z',
  };
}

/** The same with curves (format 1 as written after curves were added). */
function v1FileWithCurves(): Record<string, unknown> {
  const f = v1File();
  (f.annotations as Record<string, unknown>).curves = [
    {
      id: '0b8e6d1a-2f3c-4c55-9d1e-7a0c4b9e2f11',
      label: 'C2',
      anchors: [[0, 0, 0], [2, 0, 0], [4, 0, 0]],
      points: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0]],
      anchorIndex: [0, 2, 4],
      closed: false,
      attributes: { type: 'ridge', note: 'dorsal' },
      createdAt: '2026-10-15T20:41:12.502Z',
      modifiedAt: '2026-10-15T20:43:05.007Z',
    },
  ];
  f.nextCurveNumber = 3;
  return f;
}

const roundTrip = (raw: unknown) => {
  const first = parseProjectFile(raw);
  const saved = JSON.parse(JSON.stringify(serializeProject(first, '0.2.0')));
  return { first, saved, second: parseProjectFile(saved) };
};

const NO_RELATIONS = { cycles: [], cycleEdges: [], sequenceConflicts: [], orderConflicts: [], unassigned: [], count: 0, direct: [] };

describe('project file format 2', () => {
  it('reads 0.1.0 files (scarVectors) as scars with a vector, and saves them as format 2', () => {
    for (const make of [v1File, v1FileWithCurves]) {
      const raw = make();
      const { first, saved, second } = roundTrip(raw);
      const old = (raw.annotations as { scarVectors: Array<Record<string, unknown>> }).scarVectors;
      // fields added since (the termination) come in not filled in
      expect(first.scars).toEqual(
        old.map(({ start, end, startNormal, endNormal, ...rest }) => ({ ...rest, attributes: { termination: null, ...(rest.attributes as object) }, vector: { start, end, startNormal, endNormal } })),
      );
      expect(first.specimen).toEqual({ ...(raw.specimen as object), frame: null, type: 'core' });
      expect(first.nextLabelNumber).toBe(4);
      expect(saved.formatVersion).toBe(2);
      expect(saved.annotations.scarVectors).toBeUndefined();
      expect(saved.annotations.scars).toHaveLength(2);
      expect(saved.derived).toEqual({ measurements: null, vertices: null, manualMeasurements: [], planes: [], regions: [], regionTotals: null, nodule: null, split: null, relations: NO_RELATIONS, landmarks: { rows: [], sliders: [], sets: [] }, configuration: null, flake: null, edgeAngles: null, retouchAngles: null, sharpEdge: null, gm: null });
      // read → save → read again: nothing changes
      expect(second).toEqual(first);
    }
    const { first } = roundTrip(v1FileWithCurves());
    expect(first.curves.map((c) => [c.label, c.attributes])).toEqual([['C2', { type: 'ridge', note: 'dorsal' }]]);
    expect(first.nextCurveNumber).toBe(3);
    expect(roundTrip(v1File()).first.curves).toEqual([]);
  });

  it('writes the arrow CSV of migrated files with the termination not filled in', () => {
    const csv = scarVectorCsv(parseProjectFile(v1File()), { excelBom: false });
    expect(csv).toBe(
      'specimen_id,scar_id,start_x,start_y,start_z,end_x,end_y,end_z,length,completeness,termination,certainty,note,platform_face,flaking_surface,unit,tech_angle_deg\n' +
        `LB-1023,S1,12.734,-3.118,9.905,2.051,1.877,11.402,${Math.round(Math.hypot(10.683, 4.995, 1.497) * 1e6) / 1e6},bulb_truncated,,probable,"hinge, ""step""",,,mm,\n` +
        `LB-1023,S3,1,2,3,4,5,6,${Math.round(Math.sqrt(27) * 1e6) / 1e6},point_complete,,certain,,,,mm,\n`,
    );
  });

  it('reads files without a termination as not filled in, and the new completeness code', () => {
    const file = v1File() as { annotations: { scarVectors: Array<{ attributes: Record<string, unknown> }> } };
    file.annotations.scarVectors[1].attributes.completeness = 'proximal_missing';
    const st = parseProjectFile(file);
    expect(st.scars.map((s) => [s.attributes.completeness, s.attributes.termination])).toEqual([
      ['bulb_truncated', null],
      ['proximal_missing', null],
    ]);
    const again = parseProjectFile(JSON.parse(JSON.stringify(serializeProject(st, '0.2.0'))));
    expect(again.scars.map((s) => s.attributes)).toEqual(st.scars.map((s) => s.attributes));
  });

  it('stores scars without a direction, and leaves them out of the arrow CSV', () => {
    const s = new ProjectStore(emptyProject());
    updateSpecimen(s, { id: 'X' });
    const a = addScarVector(s, { start: [0, 0, 0], end: [3, 4, 0], startNormal: [0, 0, 1], endNormal: [0, 0, 1] });
    setScarAttribute(s, a.id, 'completeness', 'both_missing');
    const file = JSON.parse(JSON.stringify(serializeProject(s.state, '0.2.0')));
    const areaOnly: Scar = { ...file.annotations.scars[0], id: 'area-only', label: 'S2', vector: null };
    file.annotations.scars.push(areaOnly);
    const { first, second } = roundTrip(file);
    expect(first.scars.map((x) => [x.label, x.vector === null])).toEqual([
      ['S1', false],
      ['S2', true],
    ]);
    expect(second).toEqual(first);
    const rows = scarVectorCsv(first, { excelBom: false }).trimEnd().split('\n');
    expect(rows).toEqual([rows[0], 'X,S1,0,0,0,3,4,0,5,both_missing,na,certain,,,,mm,']);
  });

  it('keeps the specimen frame and rejects a malformed one', () => {
    const s = new ProjectStore(emptyProject());
    const matrix = [0, 1, 0, -5, -1, 0, 0, 2, 0, 0, 1, 0.5, 0, 0, 0, 1];
    updateSpecimen(s, { frame: { matrix, source: 'view' } });
    const file = JSON.parse(JSON.stringify(serializeProject(s.state, '0.2.0')));
    expect(file.specimen.frame).toEqual({ matrix, source: 'view' });
    expect(parseProjectFile(file).specimen.frame).toEqual({ matrix, source: 'view' });
    s.history.undo();
    expect(s.state.specimen.frame).toBeNull();

    file.specimen.frame = { matrix: matrix.slice(0, 12), source: 'view' };
    expect(() => parseProjectFile(file)).toThrow(ProjectFileError);
  });

  it('ignores stored derived results on reading', () => {
    const file = JSON.parse(JSON.stringify(serializeProject(parseProjectFile(v1File()), '0.2.0')));
    file.derived = { stale: 42 };
    expect(serializeProject(parseProjectFile(file), '0.2.0').derived).toEqual({ measurements: null, vertices: null, manualMeasurements: [], planes: [], regions: [], regionTotals: null, nodule: null, split: null, relations: NO_RELATIONS, landmarks: { rows: [], sliders: [], sets: [] }, configuration: null, flake: null, edgeAngles: null, retouchAngles: null, sharpEdge: null, gm: null });
  });

  it('rejects a scar vector without coordinates', () => {
    const file = v1File();
    delete ((file.annotations as { scarVectors: Array<Record<string, unknown>> }).scarVectors[0] as Record<string, unknown>).end;
    expect(() => parseProjectFile(file)).toThrow(/Scar 1/);
  });
});

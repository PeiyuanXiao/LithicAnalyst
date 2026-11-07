import { describe, expect, it } from 'vitest';
import { autoMeasurements, frameMeasures, surfaceMeasures } from '../src/compute/measure';
import { annotationStatus } from '../src/core/annotationStatus';
import { setSpecimenType } from '../src/core/actions';
import { hasEdgeAngles, hasVolumeSplit, measuresEdgeAngle, SPECIMEN_TYPES, type SpecimenType } from '../src/core/fields';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import type { ProjectState, Vec3 } from '../src/core/types';
import { batchOutputs, batchSpecimen, type BatchProject } from '../src/io/batch';
import { box } from './meshes';

const RIM: Vec3[] = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]];
const T = '2026-11-01T00:00:00.000Z';

/** A project as an older version wrote it for a specimen of this type: edge angles, working edges, a split, and what was stored of them. */
function oldFile(type: SpecimenType): ReturnType<typeof serializeProject> {
  const st: ProjectState = {
    ...emptyProject(),
    curves: [
      { id: 'rim', label: 'C1', anchors: RIM, points: RIM, anchorIndex: [0, 1, 2, 3], closed: true, edgeAngle: true, attributes: { type: 'core_edge', note: '' }, createdAt: T, modifiedAt: T },
      { id: 'other', label: 'C2', anchors: RIM, points: RIM, anchorIndex: [0, 1, 2, 3], closed: true, attributes: { type: type === 'flake' ? 'edge' : 'core_edge', note: '' }, createdAt: T, modifiedAt: T },
    ],
    workingEdges: [{ id: 'e1', label: 'E1', name: 'left', curveId: 'rim', start: RIM[0], end: RIM[2], createdAt: T, modifiedAt: T }],
    nextWorkingEdgeNumber: 2,
    split: { source: 'curve', id: 'rim', upHint: [0, 0, 1], swap: true },
    sharpEdge: { method: 'three_points', distance: 2, threshold: 45 },
  };
  st.specimen = { ...st.specimen, id: type, type, unit: 'mm' };
  return serializeProject(st, '0.1.0');
}

const STORED = {
  regions: [],
  regionTotals: null,
  nodule: null,
  split: { upper: 3, lower: 1, ratio: 3 },
  edgeAngles: { curves: [{ curveId: 'rim', distances: [2], length: 40, stations: [{ position: 0, point: [0, 0, 0], three_points: [30], two_lines: [31] }] }] },
  retouchAngles: { curves: [{ curveId: 'rim', distances: [2], length: 40, stations: [{ position: 0, point: [0, 0, 0], stretches: [{ region: 'r', layer: 1, side: 'dorsal', three_points: [10], two_lines: [11], layer_face: 12 }] }] }] },
  workingEdges: { edges: [{ id: 'e1', label: 'E1', name: 'left', curveId: 'rim', start_position: 0, end_position: 20, length: 20 }] },
};

/** The summary export of one specimen whose file stored all that. */
function exported(type: SpecimenType): Array<{ suffix: string; text: string }> {
  const state = parseProjectFile(JSON.parse(JSON.stringify(oldFile(type))));
  const b = box([40, 20, 10], 2);
  const measures = { auto: autoMeasurements(b.positions, surfaceMeasures(b.positions, b.index), null), vertices: null, box: frameMeasures(b.positions, surfaceMeasures(b.positions, b.index), null).box };
  const project: BatchProject = { path: `LithicAnalyst/projects/${type}.json`, state, derived: STORED, appVersion: '0.1.0' };
  return batchOutputs([batchSpecimen(`${type}.ply`, { project, measures }, [{ project, measures }])], { excelBom: false });
}

const cell = (csv: string, column: string): string => {
  const [head, row] = csv.trim().split('\n');
  return row.split(',')[head.split(',').indexOf(column)];
};

describe('what each type of specimen has', () => {
  it('edge angles and working edges a flake, the volume split a core', () => {
    expect(SPECIMEN_TYPES.filter(hasEdgeAngles)).toEqual(['flake']);
    expect(SPECIMEN_TYPES.filter(hasVolumeSplit)).toEqual(['core']);
  });

  for (const type of ['core', 'generic', 'flake'] as const) {
    it(`a ${type} read from an older file and written again keeps all of it`, () => {
      const before = oldFile(type);
      const state = parseProjectFile(JSON.parse(JSON.stringify(before)));
      const after = serializeProject(state, '0.1.0');
      expect(after.annotations.curves.map((c) => c.edgeAngle)).toEqual([true, undefined]);
      expect(after.workingEdges).toEqual(before.workingEdges);
      expect(after.nextWorkingEdgeNumber).toBe(2);
      expect(after.split).toEqual({ source: 'curve', id: 'rim', upHint: [0, 0, 1], swap: true });
      expect(after.sharpEdge).toEqual({ method: 'three_points', distance: 2, threshold: 45 });
    });
  }

  it('on another type and back: nothing is lost, and what a core measured shows on a flake', () => {
    const store = new ProjectStore(parseProjectFile(JSON.parse(JSON.stringify(oldFile('core')))));
    const data = () => JSON.stringify([store.state.curves, store.state.workingEdges, store.state.split, store.state.sharpEdge]);
    const start = data();
    const measured = () => store.state.curves.filter((c) => measuresEdgeAngle(c, store.state.specimen.type)).map((c) => c.id);
    expect(measured()).toEqual([]);
    setSpecimenType(store, 'generic');
    expect(data()).toBe(start);
    expect(measured()).toEqual([]);
    setSpecimenType(store, 'flake');
    expect(data()).toBe(start);
    // the curve the user asked for, and a core's edge, measured by default
    expect(measured()).toEqual(['rim', 'other']);
    setSpecimenType(store, 'core');
    expect(data()).toBe(start);
    expect(measured()).toEqual([]);
  });

  it('the status of a core or a generic specimen asks nothing of what they do not have', () => {
    const items = (type: SpecimenType) => annotationStatus({ ...emptyProject(), specimen: { ...emptyProject().specimen, type } }).items.map((i) => i.key);
    expect(items('core')).toEqual(['unit', 'scar_arrows', 'core_edge']);
    expect(items('generic')).toEqual(['unit']);
  });
});

describe('the summary export by type', () => {
  it('a core: its split in the shared table, no file of edge angles or working edges, whatever the project stored', () => {
    const out = exported('core');
    const names = out.map((f) => f.suffix);
    for (const name of ['edge_angles.csv', 'retouch_angles.csv', 'edge_sharp.csv', 'working_edges.csv']) expect(names).not.toContain(name);
    const m = out.find((f) => f.suffix === 'measurements.csv')!.text;
    expect(cell(m, 'volume_upper')).toBe('3');
    expect(cell(m, 'volume_ratio')).toBe('3');
  });

  it('a generic specimen: the same columns, its split left empty, and no such file', () => {
    const out = exported('generic');
    const names = out.map((f) => f.suffix);
    for (const name of ['edge_angles.csv', 'retouch_angles.csv', 'edge_sharp.csv', 'working_edges.csv']) expect(names).not.toContain(name);
    const core = exported('core').find((f) => f.suffix === 'measurements.csv')!.text;
    const m = out.find((f) => f.suffix === 'measurements.csv')!.text;
    expect(m.split('\n')[0]).toBe(core.split('\n')[0]);
    for (const c of ['volume_upper', 'volume_lower', 'volume_ratio']) expect(cell(m, c)).toBe('');
  });

  it('a flake: its edge angles and working edges, and its split left empty', () => {
    const out = exported('flake');
    const names = out.map((f) => f.suffix);
    for (const name of ['edge_angles.csv', 'edge_sharp.csv', 'working_edges.csv']) expect(names).toContain(name);
    const m = out.find((f) => f.suffix === 'measurements.csv')!.text;
    for (const c of ['volume_upper', 'volume_lower', 'volume_ratio']) expect(cell(m, c)).toBe('');
  });
});

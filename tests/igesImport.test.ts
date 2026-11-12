import { describe, expect, it } from 'vitest';
import { addScarVector, importScars, moveEndpoint, setScarAttribute } from '../src/core/actions';
import { parseProjectFile, PROJECT_FORMAT_VERSION, serializeProject } from '../src/core/schema';
import { ProjectStore } from '../src/core/store';
import { scarsToCheck, scarSources, type ImportRecord } from '../src/core/types';
import { scarVectorCsv } from '../src/io/csv';
import { classify, igesFor } from '../src/io/workspace';

const record: Omit<ImportRecord, 'arrows' | 'review' | 'date'> = {
  kind: 'iges-scars',
  file: 'stone01.igs',
  sha256: 'ab'.repeat(32),
  unitsFlag: 10,
  unitsName: 'CM',
  scale: 1,
  transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  pairs: [{ from: [1, 2, 3], to: [1.5, 2, 3] }],
  residual: { median: 0.01, p90: 0.02, max: 0.5 },
};

const arrows = [
  { start: [0, 0, 0] as [number, number, number], end: [3, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number], review: false },
  { start: [0, 1, 0] as [number, number, number], end: [3, 1, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number], review: true },
];

describe('importing scar vectors', () => {
  it('adds the arrows after those there are, numbered on, with the record of the import, in one undo step', () => {
    const s = new ProjectStore();
    addScarVector(s, { start: [5, 5, 5], end: [6, 5, 5], startNormal: [0, 0, 1], endNormal: [0, 0, 1] });
    const r = importScars(s, arrows, record);
    expect(s.state.scars.map((x) => x.label)).toEqual(['S1', 'S2', 'S3']);
    expect(s.state.scars[1].vector).toEqual({ start: [0, 0, 0], end: [3, 0, 0], startNormal: [0, 0, 1], endNormal: [0, 0, 1] });
    expect(s.state.nextLabelNumber).toBe(4);
    expect(s.state.imports).toHaveLength(1);
    expect(r.arrows).toEqual(s.state.scars.slice(1).map((x) => x.id));
    expect(r.review).toEqual([s.state.scars[2].id]);
    expect([...scarsToCheck(s.state)]).toEqual([s.state.scars[2].id]);
    s.history.undo();
    expect(s.state.scars).toHaveLength(1);
    expect(s.state.imports).toEqual([]);
    expect(s.state.nextLabelNumber).toBe(2);
    s.history.redo();
    expect(s.state.scars).toHaveLength(3);
    expect(s.state.imports).toHaveLength(1);
  });

  it('an arrow to check is no longer once it is edited', () => {
    const s = new ProjectStore();
    importScars(s, arrows, record, '2026-11-10T10:00:00.000Z');
    const id = s.state.scars[1].id;
    expect(scarsToCheck(s.state).has(id)).toBe(true);
    setScarAttribute(s, id, 'certainty', 'probable');
    expect(scarsToCheck(s.state).has(id)).toBe(false);
    s.history.undo();
    expect(scarsToCheck(s.state).has(id)).toBe(true);
    moveEndpoint(s, id, 'end', [4, 1, 0], [0, 0, 1]);
    expect(scarsToCheck(s.state).size).toBe(0);
  });

  it('writes the record into the project file (format 3) and reads it back; a file of format 2 has none', () => {
    const s = new ProjectStore();
    importScars(s, arrows, record);
    const file = serializeProject(s.state, 'test');
    expect(file.formatVersion).toBe(3);
    expect(PROJECT_FORMAT_VERSION).toBe(3);
    const back = parseProjectFile(JSON.parse(JSON.stringify(file)));
    expect(back.imports).toEqual(s.state.imports);
    const old = { ...JSON.parse(JSON.stringify(file)), formatVersion: 2 };
    delete old.imports;
    expect(parseProjectFile(old).imports).toEqual([]);
    expect(parseProjectFile(old).scars).toHaveLength(2);
  });

  it('puts where an imported arrow came from in the last column of scar_vectors.csv', () => {
    const s = new ProjectStore();
    addScarVector(s, { start: [5, 5, 5], end: [6, 5, 5], startNormal: [0, 0, 1], endNormal: [0, 0, 1] });
    importScars(s, arrows, record);
    const rows = scarVectorCsv(s.state, { excelBom: false }).trim().split('\n');
    expect(rows[0].split(',').at(-1)).toBe('source');
    expect(rows.slice(1).map((l) => l.split(',').at(-1))).toEqual(['', 'iges:stone01.igs', 'iges:stone01.igs']);
    expect(scarSources(s.state).size).toBe(2);
  });
});

describe('IGES files in a folder', () => {
  it('are listed apart, and found by the model of the same name in its folder', () => {
    expect(classify('site1/stone01.igs')).toBe('iges');
    expect(classify('site1/stone01.IGES')).toBe('iges');
    expect(classify('LithicAnalyst/exports/x/stone01.igs')).toBeNull();
    const list = ['site1/stone01.IGS', 'site1/stone02.iges', 'site2/stone01.igs'];
    expect(igesFor('site1/stone01.ply', list)).toBe('site1/stone01.IGS');
    expect(igesFor('site2/stone01.stl', list)).toBe('site2/stone01.igs');
    expect(igesFor('site2/stone02.ply', list)).toBeNull();
  });
});

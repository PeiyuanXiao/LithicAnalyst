import { describe, expect, it } from 'vitest';
import {
  addScarVector,
  deleteScarVector,
  moveEndpoint,
  setScarAttribute,
  setScarLabel,
  updateSpecimen,
} from '../src/core/actions';
import { defaultAttributes, numberKeyField, SCAR_FIELDS } from '../src/core/fields';
import { parseProjectFile, ProjectFileError, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import type { Vec3 } from '../src/core/types';
import { scarVectorCsv } from '../src/io/csv';

const N: Vec3 = [0, 0, 1];
const add = (s: ProjectStore, a: Vec3, b: Vec3) => addScarVector(s, { start: a, end: b, startNormal: N, endNormal: N });

describe('fields', () => {
  it('records the five completeness categories, settable with keys 1–5', () => {
    const f = numberKeyField()!;
    expect(f.key).toBe('completeness');
    expect(f.options!.map((o) => o.value)).toEqual([
      'point_complete',
      'bulb_complete',
      'point_truncated',
      'bulb_truncated',
      'both_missing',
    ]);
    expect(f.options!.map((o) => o.label.zh)).toEqual([
      '可见打击点+尾端完整',
      '可见负向打击泡+尾端完整',
      '可见打击点+尾端缺失',
      '可见负向打击泡+尾端缺失',
      '两端缺失',
    ]);
    expect(defaultAttributes()).toEqual({ completeness: 'point_complete', certainty: 'certain', note: '' });
  });
});

describe('commands and undo', () => {
  it('numbers arrows and undoes additions', () => {
    const s = new ProjectStore();
    add(s, [0, 0, 0], [1, 0, 0]);
    add(s, [0, 1, 0], [1, 1, 0]);
    expect(s.state.scarVectors.map((a) => a.label)).toEqual(['S1', 'S2']);
    s.history.undo();
    expect(s.state.scarVectors.length).toBe(1);
    expect(s.state.nextLabelNumber).toBe(2);
    add(s, [0, 2, 0], [1, 2, 0]);
    expect(s.state.scarVectors[1].label).toBe('S2');
    expect(s.history.canRedo).toBe(false);
  });

  it('restores a deleted arrow at its original position', () => {
    const s = new ProjectStore();
    add(s, [0, 0, 0], [1, 0, 0]);
    const b = add(s, [0, 1, 0], [1, 1, 0]);
    add(s, [0, 2, 0], [1, 2, 0]);
    deleteScarVector(s, b.id);
    expect(s.state.scarVectors.map((x) => x.label)).toEqual(['S1', 'S3']);
    s.history.undo();
    expect(s.state.scarVectors.map((x) => x.label)).toEqual(['S1', 'S2', 'S3']);
  });

  it('moves endpoints, renames, and merges quick note edits into one step', () => {
    const s = new ProjectStore();
    const a = add(s, [0, 0, 0], [3, 0, 0]);
    moveEndpoint(s, a.id, 'end', [5, 1, 0], [0, 1, 0]);
    expect(s.arrow(a.id)!.end).toEqual([5, 1, 0]);
    expect(s.arrow(a.id)!.endNormal).toEqual([0, 1, 0]);
    s.history.undo();
    expect(s.arrow(a.id)!.end).toEqual([3, 0, 0]);
    setScarLabel(s, a.id, 'S1a');
    expect(s.arrow(a.id)!.label).toBe('S1a');
    setScarAttribute(s, a.id, 'note', 'r');
    setScarAttribute(s, a.id, 'note', 'ri');
    setScarAttribute(s, a.id, 'note', 'rip');
    expect(s.arrow(a.id)!.attributes.note).toBe('rip');
    s.history.undo();
    expect(s.arrow(a.id)!.attributes.note).toBe('');
    setScarAttribute(s, a.id, 'completeness', 'bulb_complete');
    setScarAttribute(s, a.id, 'completeness', 'bulb_truncated');
    s.history.undo();
    expect(s.arrow(a.id)!.attributes.completeness).toBe('bulb_complete');
  });

  it('notifies subscribers', () => {
    const s = new ProjectStore();
    const kinds: string[] = [];
    s.subscribe((c) => kinds.push(c.kind));
    add(s, [0, 0, 0], [1, 0, 0]);
    updateSpecimen(s, { id: 'core-7' });
    expect(kinds).toEqual(['arrows', 'specimen']);
  });
});

function sampleStore(): ProjectStore {
  const s = new ProjectStore(emptyProject());
  updateSpecimen(s, { id: 'LB-1023', unit: 'mm' });
  s.setMesh({
    fileName: 'LB-1023.ply',
    format: 'ply',
    fileSize: 10,
    sha256: 'abc',
    vertexCount: 3,
    triangleCount: 1,
    bboxMin: [0, 0, 0],
    bboxMax: [1, 1, 1],
  });
  const a = add(s, [10, 0, 0], [30, 0, 0]);
  const b = add(s, [0, 5, 0], [0, 12, 1]);
  setScarAttribute(s, a.id, 'note', 'step "hinge", maybe\nrecheck');
  setScarAttribute(s, b.id, 'completeness', 'bulb_truncated');
  return s;
}

describe('project file', () => {
  it('round-trips through JSON', () => {
    const s = sampleStore();
    const json = JSON.parse(JSON.stringify(serializeProject(s.state, '0.1.0')));
    expect(json.format).toBe('lithicanalyst-project');
    const back = parseProjectFile(json);
    expect(back.scarVectors).toEqual(s.state.scarVectors);
    expect(back.specimen).toEqual(s.state.specimen);
    expect(back.nextLabelNumber).toBe(3);
  });

  it('rejects other files and newer formats with a clear message', () => {
    expect(() => parseProjectFile({ hello: 1 })).toThrow(ProjectFileError);
    const file = serializeProject(sampleStore().state, '0.1.0') as unknown as Record<string, unknown>;
    file.formatVersion = 9;
    expect(() => parseProjectFile(file)).toThrow(/newer version/);
  });

  it('fills missing attributes with defaults', () => {
    const file = serializeProject(sampleStore().state, '0.1.0');
    delete (file.annotations.scarVectors[1].attributes as Record<string, unknown>).certainty;
    expect(parseProjectFile(JSON.parse(JSON.stringify(file))).scarVectors[1].attributes.certainty).toBe('certain');
  });
});

describe('CSV export', () => {
  it('writes one row per arrow with codes and escaped text', () => {
    const s = sampleStore();
    const csv = scarVectorCsv(s.state, { excelBom: false });
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe(
      ['specimen_id', 'scar_id', 'start_x', 'start_y', 'start_z', 'end_x', 'end_y', 'end_z', 'length', ...SCAR_FIELDS.map((f) => f.key), 'unit'].join(','),
    );
    expect(lines[0]).toBe('specimen_id,scar_id,start_x,start_y,start_z,end_x,end_y,end_z,length,completeness,certainty,note,unit');
    expect(lines[1].startsWith('LB-1023,S1,10,0,0,30,0,0,20,point_complete,certain,"step ""hinge"", maybe')).toBe(true);
    expect(csv).toContain(',bulb_truncated,certain,,mm');
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(scarVectorCsv(s.state, { excelBom: true }).charCodeAt(0)).toBe(0xfeff);
  });
});

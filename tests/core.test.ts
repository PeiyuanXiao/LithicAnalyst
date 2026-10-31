import { describe, expect, it } from 'vitest';
import {
  addCurve,
  addScarVector,
  deleteCurve,
  deleteScar,
  moveEndpoint,
  setCurveAttribute,
  setCurveLabel,
  setCurveShape,
  setScarAttribute,
  setScarLabel,
  updateSpecimen,
} from '../src/core/actions';
import { assembleCurve, curveLength, curveSegments, isValidShape, midPointIndex } from '../src/core/curveGeometry';
import { CURVE_FIELDS, customValue, defaultAttributes, defaultCurveAttributes, fieldLocked, isCustomValue, numberKeyField, offeredOptions, SCAR_FIELDS, shiftNumberKeyField, TERMINATION_MISSING, withAttribute } from '../src/core/fields';
import { parseProjectFile, ProjectFileError, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import type { Vec3 } from '../src/core/types';
import { curveCsv, scarVectorCsv } from '../src/io/csv';

const N: Vec3 = [0, 0, 1];
const add = (s: ProjectStore, a: Vec3, b: Vec3) => addScarVector(s, { start: a, end: b, startNormal: N, endNormal: N });

describe('fields', () => {
  it('records the six completeness categories, settable with keys 1–6', () => {
    const f = numberKeyField()!;
    expect(f.key).toBe('completeness');
    expect(f.options!.map((o) => o.value)).toEqual([
      'point_complete',
      'bulb_complete',
      'proximal_missing',
      'point_truncated',
      'bulb_truncated',
      'both_missing',
    ]);
    expect(f.options!.map((o) => o.label.zh)).toEqual([
      '可见打击点+尾端完整',
      '可见负向打击泡+尾端完整',
      '打击点缺失+尾端完整',
      '可见打击点+尾端缺失',
      '可见负向打击泡+尾端缺失',
      '两端缺失',
    ]);
    expect(f.options![2]).toMatchObject({ short: { zh: '仅尾端', en: 'Term. only' }, label: { en: 'Proximal end missing + termination' } });
    // the termination is not judged yet on a new scar
    expect(defaultAttributes()).toEqual({ completeness: 'point_complete', termination: null, certainty: 'certain', note: '' });
  });

  it('records the termination, settable with Shift + 1–5', () => {
    const f = shiftNumberKeyField()!;
    expect(f.key).toBe('termination');
    expect(f.options!.map((o) => [o.value, o.label.zh, o.label.en])).toEqual([
      ['feather', '羽状', 'Feather'],
      ['step', '阶梯状', 'Step'],
      ['hinge', '铰链状', 'Hinge'],
      ['overshot', '过击', 'Overshot'],
      ['na', '缺失', 'NA'],
    ]);
  });

  it('a completeness without a termination sets it to NA and locks it; one with a termination clears an NA', () => {
    const base = defaultAttributes();
    expect(withAttribute(base, 'termination', 'hinge')).toMatchObject({ completeness: 'point_complete', termination: 'hinge' });
    for (const c of TERMINATION_MISSING) {
      const truncated = withAttribute({ ...base, termination: 'hinge' }, 'completeness', c)!;
      expect(truncated.termination).toBe('na');
      expect(fieldLocked(truncated, 'termination')).toBe(true);
      expect(withAttribute(truncated, 'termination', 'feather')).toBeNull();
      // back to a termination: not judged yet
      expect(withAttribute(truncated, 'completeness', 'proximal_missing')).toMatchObject({ completeness: 'proximal_missing', termination: null });
    }
    // a judged termination stays when the completeness keeps a termination
    expect(withAttribute({ ...base, termination: 'step' }, 'completeness', 'bulb_complete')!.termination).toBe('step');
    expect(fieldLocked(base, 'termination')).toBe(false);
  });

  it('changes the completeness and the termination in one undo step', () => {
    const s = new ProjectStore();
    const a = add(s, [0, 0, 0], [1, 0, 0]);
    setScarAttribute(s, a.id, 'termination', 'feather');
    setScarAttribute(s, a.id, 'completeness', 'both_missing');
    expect(s.scar(a.id)!.attributes).toMatchObject({ completeness: 'both_missing', termination: 'na' });
    // locked: Shift + number keys change nothing
    setScarAttribute(s, a.id, 'termination', 'step');
    expect(s.scar(a.id)!.attributes.termination).toBe('na');
    s.history.undo();
    expect(s.scar(a.id)!.attributes).toMatchObject({ completeness: 'point_complete', termination: 'feather' });
    setScarAttribute(s, a.id, 'completeness', 'point_truncated');
    setScarAttribute(s, a.id, 'completeness', 'bulb_complete');
    expect(s.scar(a.id)!.attributes.termination).toBeNull();
  });
});

describe('commands and undo', () => {
  it('numbers arrows and undoes additions', () => {
    const s = new ProjectStore();
    add(s, [0, 0, 0], [1, 0, 0]);
    add(s, [0, 1, 0], [1, 1, 0]);
    expect(s.state.scars.map((a) => a.label)).toEqual(['S1', 'S2']);
    s.history.undo();
    expect(s.state.scars.length).toBe(1);
    expect(s.state.nextLabelNumber).toBe(2);
    add(s, [0, 2, 0], [1, 2, 0]);
    expect(s.state.scars[1].label).toBe('S2');
    expect(s.history.canRedo).toBe(false);
  });

  it('restores a deleted arrow at its original position', () => {
    const s = new ProjectStore();
    add(s, [0, 0, 0], [1, 0, 0]);
    const b = add(s, [0, 1, 0], [1, 1, 0]);
    add(s, [0, 2, 0], [1, 2, 0]);
    deleteScar(s, b.id);
    expect(s.state.scars.map((x) => x.label)).toEqual(['S1', 'S3']);
    s.history.undo();
    expect(s.state.scars.map((x) => x.label)).toEqual(['S1', 'S2', 'S3']);
  });

  it('moves endpoints, renames, and merges quick note edits into one step', () => {
    const s = new ProjectStore();
    const a = add(s, [0, 0, 0], [3, 0, 0]);
    moveEndpoint(s, a.id, 'end', [5, 1, 0], [0, 1, 0]);
    expect(s.scar(a.id)!.vector!.end).toEqual([5, 1, 0]);
    expect(s.scar(a.id)!.vector!.endNormal).toEqual([0, 1, 0]);
    s.history.undo();
    expect(s.scar(a.id)!.vector!.end).toEqual([3, 0, 0]);
    setScarLabel(s, a.id, 'S1a');
    expect(s.scar(a.id)!.label).toBe('S1a');
    setScarAttribute(s, a.id, 'note', 'r');
    setScarAttribute(s, a.id, 'note', 'ri');
    setScarAttribute(s, a.id, 'note', 'rip');
    expect(s.scar(a.id)!.attributes.note).toBe('rip');
    s.history.undo();
    expect(s.scar(a.id)!.attributes.note).toBe('');
    setScarAttribute(s, a.id, 'completeness', 'bulb_complete');
    setScarAttribute(s, a.id, 'completeness', 'bulb_truncated');
    s.history.undo();
    expect(s.scar(a.id)!.attributes.completeness).toBe('bulb_complete');
  });

  it('notifies subscribers', () => {
    const s = new ProjectStore();
    const kinds: string[] = [];
    s.subscribe((c) => kinds.push(c.kind));
    add(s, [0, 0, 0], [1, 0, 0]);
    updateSpecimen(s, { id: 'core-7' });
    expect(kinds).toEqual(['scars', 'specimen']);
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
    expect(back.scars).toEqual(s.state.scars);
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
    delete (file.annotations.scars[1].attributes as Record<string, unknown>).certainty;
    expect(parseProjectFile(JSON.parse(JSON.stringify(file))).scars[1].attributes.certainty).toBe('certain');
  });
});

describe('CSV export', () => {
  it('writes one row per arrow with codes and escaped text', () => {
    const s = sampleStore();
    const csv = scarVectorCsv(s.state, { excelBom: false });
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe(
      ['specimen_id', 'scar_id', 'start_x', 'start_y', 'start_z', 'end_x', 'end_y', 'end_z', 'length', ...SCAR_FIELDS.map((f) => f.key), 'platform_face', 'flaking_surface', 'unit'].join(','),
    );
    expect(lines[0]).toBe('specimen_id,scar_id,start_x,start_y,start_z,end_x,end_y,end_z,length,completeness,termination,certainty,note,platform_face,flaking_surface,unit');
    // the termination: empty until judged; NA once the completeness says it is missing
    expect(lines[1].startsWith('LB-1023,S1,10,0,0,30,0,0,20,point_complete,,certain,"step ""hinge"", maybe')).toBe(true);
    expect(csv).toContain(',bulb_truncated,na,certain,,,,mm');
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(scarVectorCsv(s.state, { excelBom: true }).charCodeAt(0)).toBe(0xfeff);
  });
});

// ---------------------------------------------------------------- curves

/** An open curve along the x axis with anchors at x = 0, 2, 5 (unit steps). */
function lineShape() {
  const seg = (a: number, b: number): Vec3[] => Array.from({ length: b - a + 1 }, (_, i) => [a + i, 0, 0] as Vec3);
  const segments = [seg(0, 2), seg(2, 5)];
  const { points, anchorIndex } = assembleCurve(segments, false);
  return { anchors: [[0, 0, 0], [2, 0, 0], [5, 0, 0]] as Vec3[], points, anchorIndex, closed: false };
}

/** A closed square loop 0→1→2→3 (side 2), anchors at three corners. */
function loopShape() {
  const A: Vec3 = [0, 0, 0], B: Vec3 = [2, 0, 0], C: Vec3 = [2, 2, 0], D: Vec3 = [0, 2, 0];
  const segments: Vec3[][] = [[A, [1, 0, 0], B], [B, C], [C, D, A]];
  const { points, anchorIndex } = assembleCurve(segments, true);
  return { anchors: [A, B, C], points, anchorIndex, closed: true };
}

describe('curve geometry', () => {
  it('assembles segments and splits them back', () => {
    const open = lineShape();
    expect(open.points.map((p) => p[0])).toEqual([0, 1, 2, 3, 4, 5]);
    expect(open.anchorIndex).toEqual([0, 2, 5]);
    expect(curveSegments(open).map((s) => s.map((p) => p[0]))).toEqual([[0, 1, 2], [2, 3, 4, 5]]);
    expect(curveLength(open)).toBe(5);
    expect(midPointIndex(open.points)).toBe(3);
    expect(isValidShape(open)).toBe(true);

    const loop = loopShape();
    expect(loop.points.length).toBe(5); // first point not repeated
    expect(loop.anchorIndex).toEqual([0, 2, 3]);
    const segs = curveSegments(loop);
    expect(segs.length).toBe(3);
    expect(segs[2][segs[2].length - 1]).toEqual([0, 0, 0]);
    expect(assembleCurve(segs, true)).toEqual({ points: loop.points, anchorIndex: loop.anchorIndex });
    expect(curveLength(loop)).toBe(8);
    expect(isValidShape(loop)).toBe(true);
    expect(isValidShape({ ...loop, anchors: loop.anchors.slice(0, 2), anchorIndex: [0, 2] })).toBe(false);
  });
});

describe('curves in the project', () => {
  it('labels, edits and undoes curves', () => {
    const s = new ProjectStore();
    const kinds: string[] = [];
    s.subscribe((c) => kinds.push(c.kind));
    const c1 = addCurve(s, lineShape());
    const c2 = addCurve(s, loopShape());
    expect(s.state.curves.map((c) => c.label)).toEqual(['C1', 'C2']);
    expect(c1.attributes).toEqual(defaultCurveAttributes());
    expect(kinds).toEqual(['curves', 'curves']);
    // arrows keep their own numbering
    add(s, [0, 0, 0], [1, 0, 0]);
    expect(s.state.scars[0].label).toBe('S1');

    setCurveAttribute(s, c1.id, 'type', 'edge');
    setCurveAttribute(s, c1.id, 'note', 'r');
    setCurveAttribute(s, c1.id, 'note', 'ret');
    setCurveLabel(s, c1.id, 'E1');
    expect(s.curve(c1.id)!.attributes).toEqual({ type: 'edge', note: 'ret' });
    s.history.undo(); // label
    s.history.undo(); // note (merged)
    expect(s.curve(c1.id)!.attributes.note).toBe('');
    expect(s.curve(c1.id)!.label).toBe('C1');

    const moved = lineShape();
    moved.anchors[1] = [2, 1, 0];
    moved.points[2] = [2, 1, 0];
    setCurveShape(s, c1.id, moved);
    expect(s.curve(c1.id)!.points[2]).toEqual([2, 1, 0]);
    s.history.undo();
    expect(s.curve(c1.id)!.points[2]).toEqual([2, 0, 0]);

    deleteCurve(s, c1.id);
    expect(s.state.curves.map((c) => c.label)).toEqual(['C2']);
    s.history.undo();
    expect(s.state.curves.map((c) => c.id)).toEqual([c1.id, c2.id]);
    // keys 1–4 the offered types, 5 the user's own text; the older codes are read but not offered
    const type = numberKeyField(CURVE_FIELDS)!;
    expect(offeredOptions(type).map((o) => o.value)).toEqual(['scar_boundary', 'core_edge', 'cortex', 'joint']);
    expect(type.options!.filter((o) => o.legacy).map((o) => o.value)).toEqual(['edge', 'ridge', 'other']);
    expect(type.allowCustom).toBe(true);
    expect(addCurve(s, lineShape()).attributes.type).toBe('');
  });

  it("takes the user's own curve type: trimmed, a preset's code when it names one", () => {
    const type = CURVE_FIELDS.find((f) => f.key === 'type')!;
    expect(customValue(type, '  retouch  ')).toBe('retouch');
    expect(customValue(type, '石核边缘')).toBe('core_edge');
    expect(customValue(type, 'joint surface')).toBe('joint');
    expect(customValue(type, 'CORE_EDGE')).toBe('core_edge');
    // an older code is the user's text now (it is not offered)
    expect(customValue(type, 'Ridge')).toBe('Ridge');
    expect([isCustomValue(type, 'retouch'), isCustomValue(type, 'ridge'), isCustomValue(type, 'cortex'), isCustomValue(type, '')]).toEqual([true, false, false, false]);
  });

  it('round-trips curves through the project file and reads files without them', () => {
    const s = sampleStore();
    const c = addCurve(s, loopShape());
    setCurveAttribute(s, c.id, 'type', 'scar_boundary');
    const json = JSON.parse(JSON.stringify(serializeProject(s.state, '0.2.0')));
    const back = parseProjectFile(json);
    expect(back.curves).toEqual(s.state.curves);
    expect(back.nextCurveNumber).toBe(2);
    expect(back.scars).toEqual(s.state.scars);

    delete json.annotations.curves;
    delete json.nextCurveNumber;
    const old = parseProjectFile(json);
    expect(old.curves).toEqual([]);
    expect(old.nextCurveNumber).toBe(1);
  });

  it('keeps a curve whose anchors are damaged, and rejects one without points', () => {
    const s = sampleStore();
    addCurve(s, lineShape());
    const file = JSON.parse(JSON.stringify(serializeProject(s.state, '0.2.0')));
    file.annotations.curves[0].anchorIndex = [0, 99];
    const back = parseProjectFile(file).curves[0];
    expect(back.anchorIndex).toEqual([0, 5]);
    expect(back.anchors).toEqual([[0, 0, 0], [5, 0, 0]]);
    file.annotations.curves[0].points = [[0, 0, 0]];
    expect(() => parseProjectFile(file)).toThrow(/Curve 1/);
  });

  it('exports one CSV row per curve point', () => {
    const s = sampleStore();
    const open = addCurve(s, lineShape());
    setCurveAttribute(s, open.id, 'type', 'ridge');
    addCurve(s, loopShape());
    const lines = curveCsv(s.state, { excelBom: false }).trimEnd().split('\n');
    expect(lines[0]).toBe('specimen_id,curve_id,point_index,x,y,z,arc_length,anchor,closed,length,type,note,unit');
    expect(lines.length).toBe(1 + 6 + 5);
    expect(lines[1]).toBe('LB-1023,C1,0,0,0,0,0,true,false,5,ridge,,mm');
    expect(lines[2]).toBe('LB-1023,C1,1,1,0,0,1,false,false,5,ridge,,mm');
    expect(lines[6]).toBe('LB-1023,C1,5,5,0,0,5,true,false,5,ridge,,mm');
    // a new curve's type is not filled in; the user's own text is written as typed
    expect(lines[7]).toBe('LB-1023,C2,0,0,0,0,0,true,true,8,,,mm');
    setCurveAttribute(s, s.state.curves[1].id, 'type', 'retouch, inverse');
    expect(curveCsv(s.state, { excelBom: false }).split('\n')[7]).toBe('LB-1023,C2,0,0,0,0,0,true,true,8,"retouch, inverse",,mm');
    expect(curveCsv(s.state, { excelBom: true }).charCodeAt(0)).toBe(0xfeff);
  });
});

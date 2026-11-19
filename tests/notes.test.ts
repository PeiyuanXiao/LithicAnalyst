import { describe, expect, it } from 'vitest';
import { landmarkTable } from '../src/compute/landmarks';
import { addCurve, addLandmark, addRegion, addScarVector, addSemilandmarkSet, addWorkingEdge, setLandmarkNote, setRegionNote, setScarAttribute, setWorkingEdgeNote, updateSpecimen } from '../src/core/actions';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import type { Vec3 } from '../src/core/types';
import { regionsCsv, scarVectorCsv, workingEdgesCsv } from '../src/io/csv';
import { landmarksCsv } from '../src/io/landmarks';

const line: Vec3[] = Array.from({ length: 41 }, (_, i) => [i, 0, 0]);
const plain = { excelBom: false };

/** A flake with a region, a landmark, a curve measured and a working edge on it. */
function scene() {
  const store = new ProjectStore(emptyProject());
  store.state.specimen.type = 'flake';
  store.state.specimen.id = 'A1';
  const c = addCurve(store, { anchors: [line[0], line[40]], points: line, anchorIndex: [0, 40], closed: false, attributes: { type: 'edge' } });
  const r = addRegion(store, [1, 1, 1], 'cortex', null);
  const l = addLandmark(store, [2, 0, 0]);
  const e = addWorkingEdge(store, { curveId: c.id, start: [0, 0, 0], end: [10, 0, 0] }).edge!;
  return { store, c, r, l, e };
}

/** Type a text one letter after another, as the input box does. */
const type = (text: string, set: (v: string) => void) => {
  for (let i = 1; i <= text.length; i++) set(text.slice(0, i));
};

describe('notes on regions, landmarks and working edges', () => {
  it('new ones have none', () => {
    const { store } = scene();
    expect(store.state.regions[0].note).toBe('');
    expect(store.state.landmarks[0].note).toBe('');
    expect(store.state.workingEdges[0].note).toBe('');
  });

  it('typing one is one step; undo gives the empty note back, redo the whole text', () => {
    const { store, r, l, e } = scene();
    type('weathered', (v) => setRegionNote(store, r.id, v));
    type('tip, "worn"', (v) => setLandmarkNote(store, l.id, v));
    type('used', (v) => setWorkingEdgeNote(store, e.id, v));
    expect(store.region(r.id)?.note).toBe('weathered');
    expect(store.landmark(l.id)?.note).toBe('tip, "worn"');
    expect(store.workingEdge(e.id)?.note).toBe('used');
    store.history.undo();
    expect(store.workingEdge(e.id)?.note).toBe('');
    store.history.undo();
    expect(store.landmark(l.id)?.note).toBe('');
    store.history.undo();
    expect(store.region(r.id)?.note).toBe('');
    store.history.redo();
    expect(store.region(r.id)?.note).toBe('weathered');
    // the working edge's name and note are steps of their own
    store.history.redo();
    store.history.redo();
    expect(store.history.canRedo).toBe(false);
  });

  it('the project file keeps them; a file from before has none', () => {
    const { store, r, l, e } = scene();
    setRegionNote(store, r.id, 'a');
    setLandmarkNote(store, l.id, 'b');
    setWorkingEdgeNote(store, e.id, 'c');
    const file = JSON.parse(JSON.stringify(serializeProject(store.state, 'test')));
    expect(file.annotations.regions[0].note).toBe('a');
    const back = parseProjectFile(file);
    expect(back.regions).toEqual(store.state.regions);
    expect(back.landmarks).toEqual(store.state.landmarks);
    expect(back.workingEdges).toEqual(store.state.workingEdges);
    // written before notes on these: no key at all
    for (const x of [file.annotations.regions[0], file.annotations.landmarks[0], file.workingEdges[0]]) delete x.note;
    const old = parseProjectFile(file);
    expect([old.regions[0].note, old.landmarks[0].note, old.workingEdges[0].note]).toEqual(['', '', '']);
  });

  it('the exports: the last column of regions.csv, landmarks.csv (the fixed landmarks only) and working_edges.csv', () => {
    const { store, c, r, l, e } = scene();
    setRegionNote(store, r.id, 'cortex, rolled');
    setLandmarkNote(store, l.id, 'apex');
    setWorkingEdgeNote(store, e.id, 'notch');
    addSemilandmarkSet(store, c.id, 3);
    const st = store.state;
    const regions = regionsCsv(st, [{ id: r.id, label: r.label, type: 'cortex', scarId: null, area: 4, conflict: false, parent: null, retouchLayer: null }], plain).trim().split('\n');
    expect(regions[0].endsWith(',retouch_layer,note')).toBe(true);
    expect(regions[1]).toBe('A1,R1,cortex,,4,mm,,,"cortex, rolled"');
    const lm = landmarksCsv(st, landmarkTable(st), plain).trim().split('\n');
    expect(lm[0]).toBe('specimen_id,index,name,kind,set_id,x,y,z,note');
    expect(lm[1]).toBe('A1,1,LM1,fixed,,2,0,0,apex');
    expect(lm.slice(2).every((x) => x.includes(',curve,') && x.endsWith(','))).toBe(true);
    const row = { id: e.id, label: e.label, name: '', curveId: c.id, start_position: 0, end_position: 10, length: 10, sharp_length: null, retouched_length: null, retouch_perimeter: null, retouch_perimeter_dorsal: null, retouch_perimeter_ventral: null, removed_volume: null, erp: null, erp_filled_share: null, giur: null, giur_stations: null, edge_curvature: null, edge_curvature_chord: null, edge_curvature_depth: null };
    const edges = workingEdgesCsv(st, [row], [], plain).trim().split('\n');
    expect(edges[0].endsWith(',edge_angle_2ln_10mm,note')).toBe(true);
    expect(edges[1].endsWith(',,,,,,,notch')).toBe(true);
  });
});

describe('a generic specimen\'s arrows', () => {
  it('have a note, written in scar_vectors.csv; the scar attributes stay empty', () => {
    const store = new ProjectStore(emptyProject());
    updateSpecimen(store, { type: 'generic' });
    const a = addScarVector(store, { start: [0, 0, 0], end: [1, 0, 0], startNormal: [0, 0, 1], endNormal: [0, 0, 1] });
    setScarAttribute(store, a.id, 'note', 'flake? no');
    const [head, row] = scarVectorCsv(store.state, plain).trim().split('\n').map((x) => x.split(','));
    const at = (k: string) => row[head.indexOf(k)];
    expect(at('note')).toBe('flake? no');
    expect(at('completeness')).toBe('');
    expect(at('certainty')).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { platformSides, landmarkTable } from '../src/compute/landmarks';
import { emptyFlakeMeasures, FLAKE_MEASURES } from '../src/compute/flake';
import { addCurve, addLandmark, addScarVector, deleteCurve, deleteLandmark, deleteTechnicalAxis, moveLandmark, placePlatformEnd, renameLandmark, setCurveAttribute, setRegionType, setSpecimenType, setTechnicalAxis, updateSpecimen } from '../src/core/actions';
import { keyedOptions, numberKeyField, offeredOptions, REGION_FIELDS } from '../src/core/fields';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import type { Vec3 } from '../src/core/types';
import { batchOutputs, type BatchSpecimen } from '../src/io/batch';
import { flakesCsv, scarVectorCsv } from '../src/io/csv';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const n: Vec3 = [0, 0, -1];
const axis = { start: [0, 0, 0] as Vec3, end: [0, 40, 0] as Vec3, startNormal: n, endNormal: n, matrix: identity, failure: null };
const shape = (closed: boolean) => {
  const pts: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
  return closed ? { anchors: pts, points: pts, anchorIndex: [0, 1, 2, 3], closed: true } : { anchors: [pts[0], pts[3]], points: pts, anchorIndex: [0, 3], closed: false };
};

function flakeStore(): ProjectStore {
  const s = new ProjectStore(emptyProject());
  setSpecimenType(s, 'flake');
  return s;
}

describe('the type of specimen', () => {
  it('a file without one reads as a core', () => {
    const file = JSON.parse(JSON.stringify(serializeProject(emptyProject(), '0.1.0')));
    delete file.specimen.type;
    delete file.flake;
    const st = parseProjectFile(file);
    expect(st.specimen.type).toBe('core');
    expect(st.flake).toEqual({ axis: null, otherFrame: null });
  });
  it('switching keeps the other type\'s data, each with its own frame, in one undo step', () => {
    const s = new ProjectStore(emptyProject());
    const coreFrame = { matrix: identity.map((x, i) => (i === 3 ? 5 : x)), source: 'view' };
    updateSpecimen(s, { frame: coreFrame });
    s.history.clear();
    setSpecimenType(s, 'flake');
    expect(s.state.specimen.frame).toBeNull();
    expect(s.state.flake.otherFrame).toEqual(coreFrame);
    setTechnicalAxis(s, axis);
    addScarVector(s, { start: [0, 0, 0], end: [0, 1, 0], startNormal: n, endNormal: n });
    expect(s.state.specimen.frame?.source).toBe('technical_axis');
    setSpecimenType(s, 'core');
    expect(s.state.specimen.frame).toEqual(coreFrame);
    expect(s.state.flake.axis).not.toBeNull();
    expect(s.state.scars.length).toBe(1);
    setSpecimenType(s, 'flake');
    expect(s.state.specimen.frame?.source).toBe('technical_axis');
    s.history.undo();
    expect(s.state.specimen.type).toBe('core');
    expect(s.state.specimen.frame).toEqual(coreFrame);
    s.history.redo();
    expect(s.state.specimen.type).toBe('flake');
  });
  it('a flake\'s frame leaves the core\'s corrections alone', () => {
    const s = new ProjectStore(emptyProject());
    s.state.configuration.roles.front = 'flaking';
    setSpecimenType(s, 'flake');
    setTechnicalAxis(s, axis);
    updateSpecimen(s, { frame: null });
    expect(s.state.configuration.roles.front).toBe('flaking');
  });
  it('round trip of a flake', () => {
    const s = flakeStore();
    setTechnicalAxis(s, axis);
    placePlatformEnd(s, [5, 0, 0]);
    const c = addCurve(s, shape(true));
    setCurveAttribute(s, c.id, 'type', 'platform_outline');
    const again = parseProjectFile(JSON.parse(JSON.stringify(serializeProject(s.state, '0.1.0'))));
    expect(again.specimen.type).toBe('flake');
    expect(again.flake.axis?.matrix).toEqual(identity);
    expect(again.landmarks.map((l) => l.code)).toEqual(['pop', 'platform_end']);
    expect(again.regions).toMatchObject([{ type: 'platform', auto: true }]);
  });
});

describe('types offered', () => {
  it('curve types and keys by the type of specimen', () => {
    const f = numberKeyField(REGION_FIELDS)!;
    expect(offeredOptions(f, 'core').map((o) => o.value)).toEqual(['scar', 'cortex', 'joint', 'damage']);
    expect(offeredOptions(f, 'flake').map((o) => o.value)).toEqual(['scar', 'cortex', 'joint', 'damage', 'platform']);
    expect(keyedOptions(f, 'flake').length).toBe(5);
  });
});

describe('the technical axis', () => {
  it('brings the point of percussion, which follows it and cannot be moved or deleted alone', () => {
    const s = flakeStore();
    setTechnicalAxis(s, axis);
    const pop = s.state.landmarks[0];
    expect(pop).toMatchObject({ code: 'pop', name: 'pop', point: [0, 0, 0] });
    moveLandmark(s, pop.id, [9, 9, 9]);
    renameLandmark(s, pop.id, 'x');
    deleteLandmark(s, pop.id);
    expect(s.state.landmarks[0]).toMatchObject({ point: [0, 0, 0], name: 'pop' });
    // replaced: one axis, one point, moved along
    setTechnicalAxis(s, { ...axis, start: [1, 1, 0] });
    expect(s.state.landmarks.filter((l) => l.code === 'pop').length).toBe(1);
    expect(s.state.landmarks[0].point).toEqual([1, 1, 0]);
    // in one step
    s.history.undo();
    expect(s.state.landmarks[0].point).toEqual([0, 0, 0]);
    expect(s.state.flake.axis?.start).toEqual([0, 0, 0]);
    expect(s.state.specimen.frame?.source).toBe('technical_axis');
  });
  it('without a frame: the specimen frame goes back to none, the arrow stays', () => {
    const s = flakeStore();
    setTechnicalAxis(s, axis);
    setTechnicalAxis(s, { ...axis, matrix: null, failure: 'few' });
    expect(s.state.specimen.frame).toBeNull();
    expect(s.state.flake.axis?.failure).toBe('few');
  });
  it('a frame set by hand stays when the axis gives none, or goes', () => {
    const s = flakeStore();
    setTechnicalAxis(s, axis);
    const hand = { matrix: identity, source: 'view' };
    updateSpecimen(s, { frame: hand });
    setTechnicalAxis(s, { ...axis, matrix: null, failure: 'short' });
    expect(s.state.specimen.frame).toEqual(hand);
    deleteTechnicalAxis(s);
    expect(s.state.specimen.frame).toEqual(hand);
    expect(s.state.flake.axis).toBeNull();
    expect(s.state.landmarks).toEqual([]);
  });
  it('deleted: back to the principal axes, one undo step brings everything back', () => {
    const s = flakeStore();
    setTechnicalAxis(s, axis);
    deleteTechnicalAxis(s);
    expect(s.state.specimen.frame).toBeNull();
    expect(s.state.landmarks).toEqual([]);
    s.history.undo();
    expect(s.state.specimen.frame?.source).toBe('technical_axis');
    expect(s.state.landmarks.length).toBe(1);
  });
});

describe('the platform', () => {
  it('one outline: a new one replaces the old in one step, the region comes and goes with it', () => {
    const s = flakeStore();
    const a = addCurve(s, shape(true)), b = addCurve(s, shape(true));
    setCurveAttribute(s, a.id, 'type', 'platform_outline');
    expect(s.state.regions).toMatchObject([{ type: 'platform', auto: true }]);
    setCurveAttribute(s, b.id, 'type', 'platform_outline');
    expect(s.state.curves.map((c) => c.id)).toEqual([b.id]);
    expect(s.state.regions.length).toBe(1);
    s.history.undo();
    expect(s.state.curves.map((c) => [c.id, c.attributes.type])).toEqual([[a.id, 'platform_outline'], [b.id, '']]);
    s.history.redo();
    deleteCurve(s, b.id);
    expect(s.state.regions).toEqual([]);
    s.history.undo();
    expect(s.state.regions.length).toBe(1);
    setCurveAttribute(s, b.id, 'type', 'edge');
    expect(s.state.regions).toEqual([]);
  });
  it('a type given by hand makes the region the user\'s, at the place given', () => {
    const s = flakeStore();
    const a = addCurve(s, shape(true));
    setCurveAttribute(s, a.id, 'type', 'platform_outline');
    const [r] = s.state.regions;
    setRegionType(s, r.id, 'cortex', null, [7, 7, 7]);
    expect(s.state.regions[0]).toMatchObject({ type: 'cortex', seed: [7, 7, 7] });
    expect(s.state.regions[0].auto).toBeUndefined();
    s.history.undo();
    expect(s.state.regions[0].auto).toBe(true);
  });
  it('at most two ends; a third moves the nearer; named by their side of the frame', () => {
    const s = flakeStore();
    setTechnicalAxis(s, axis);
    placePlatformEnd(s, [12, 0, 0]);
    placePlatformEnd(s, [-15, 0, 0]);
    placePlatformEnd(s, [15, 0, 0]);
    const ends = s.state.landmarks.filter((l) => l.code === 'platform_end');
    expect(ends.map((l) => l.point[0])).toEqual([15, -15]);
    const sides = platformSides(identity, s.state.landmarks);
    expect(sides).toEqual({ left: ends[1].id, right: ends[0].id });
    const table = landmarkTable(s.state);
    expect(table.rows.map((x) => x.name)).toEqual(['pop', 'platform_right', 'platform_left']);
    // one end, without an axis: by the name it was given
    expect(platformSides(null, s.state.landmarks)).toEqual({ left: null, right: null });
    expect(platformSides(identity, ends.slice(0, 1))).toEqual({ left: null, right: ends[0].id });
    expect(platformSides(identity, ends.slice(1))).toEqual({ left: ends[1].id, right: null });
  });
  it('a core shows and exports none of the flake\'s landmarks', () => {
    const s = flakeStore();
    setTechnicalAxis(s, axis);
    addLandmark(s, [1, 2, 3], 'apex');
    setSpecimenType(s, 'core');
    expect(landmarkTable(s.state).rows.map((r) => r.name)).toEqual(['apex']);
    expect(s.state.landmarks.length).toBe(2);
  });
});

describe('the exports of a flake', () => {
  it('flakes.csv: its columns in order, empty without a value', () => {
    const s = flakeStore();
    updateSpecimen(s, { id: 'F1' });
    const m = emptyFlakeMeasures();
    m.tech_length = 60;
    m.ipa = 101.25;
    setTechnicalAxis(s, axis);
    const [head, row] = flakesCsv(s.state, m, { excelBom: false }).trim().split('\n');
    expect(head).toBe(`specimen_id,unit,frame_source,${FLAKE_MEASURES.join(',')}`);
    expect(head.split(',').slice(3)).toEqual(['tech_length', 'tech_width', 'tech_thickness', 'morph_length', 'morph_width', 'morph_thickness', 'morph_tech_angle_deg', 'platform_width_chord', 'platform_width_path', 'platform_depth_chord', 'platform_depth_path', 'platform_area', 'epa_3pt_1mm', 'epa_3pt_2mm', 'epa_3pt_3mm', 'epa_2ln_1mm', 'epa_2ln_2mm', 'epa_2ln_3mm', 'ipa']);
    expect(row.split(',')[0]).toBe('F1');
    expect(row.split(',')[1]).toBe('mm');
    expect(row.split(',')[2]).toBe('technical_axis');
    expect(row.split(',')[3]).toBe('60');
    expect(row.split(',').at(-1)).toBe('101.25');
    expect(row.split(',').length).toBe(head.split(',').length);
    expect(flakesCsv(new ProjectStore(emptyProject()).state, null, { excelBom: true }).charCodeAt(0)).toBe(0xfeff);
  });
  it('scar_vectors.csv: the angle in the frame for a flake, nothing for a core', () => {
    const s = flakeStore();
    setTechnicalAxis(s, axis);
    addScarVector(s, { start: [0, 0, 0], end: [-3, 0, 0], startNormal: n, endNormal: n });
    expect(scarVectorCsv(s.state, { excelBom: false }).trim().split('\n')[1].split(',').at(-1)).toBe('90');
    setSpecimenType(s, 'core');
    expect(scarVectorCsv(s.state, { excelBom: false }).trim().split('\n')[1].split(',').at(-1)).toBe('');
  });
  it('the summary: flakes.csv only of flakes', () => {
    const make = (id: string, type: 'core' | 'flake'): BatchSpecimen => {
      const s = new ProjectStore(emptyProject());
      updateSpecimen(s, { id });
      setSpecimenType(s, type);
      const m = emptyFlakeMeasures();
      m.tech_length = 10;
      return { file: `${id}.ply`, state: s.state, auto: { frame: 'principal', length: 1, width: 1, thickness: 1, surfaceArea: 1, volume: 1, closed: true }, planes: [], configuration: null, regions: [], regionTotals: null, nodule: null, split: null, flake: type === 'flake' ? m : null, observers: new Map() };
    };
    const files = batchOutputs([make('A', 'core'), make('B', 'flake'), make('C', 'flake')], { excelBom: false });
    const flakes = files.find((f) => f.suffix === 'flakes.csv')!.text.trim().split('\n');
    expect(flakes.slice(1).map((l) => l.split(',')[0])).toEqual(['B', 'C']);
    expect(batchOutputs([make('A', 'core')], { excelBom: false }).some((f) => f.suffix === 'flakes.csv')).toBe(false);
  });
});


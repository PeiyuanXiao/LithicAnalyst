import { describe, expect, it } from 'vitest';
import { planeMethodsOf } from '../src/compute/planes';
import { addScarVector, addCurve, addCurveOfType, addRegion, setRegionType, setSpecimenType, updateSpecimen, setScarAttribute } from '../src/core/actions';
import { CURVE_FIELDS, customValue, GENERIC_REGION_TYPE, isBoundaryCurve, isCustomValue, isUpperRegion, keyedOptions, layerCurves, measuresEdgeAngle, offeredOptions, REGION_FIELDS, SPECIMEN_TYPES } from '../src/core/fields';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import type { ProjectState, SpecimenInfo, Vec3 } from '../src/core/types';
import { arrowColorModeOf } from '../src/render/arrowLayer';
import { batchOutputs, batchSpecimen } from '../src/io/batch';
import { scarVectorCsv } from '../src/io/csv';

const curveField = CURVE_FIELDS[0];
const regionField = REGION_FIELDS[0];
const P: Vec3 = [1, 2, 3];
const SHAPE = { anchors: [[0, 0, 0], [1, 0, 0]] as Vec3[], points: [[0, 0, 0], [1, 0, 0]] as Vec3[], anchorIndex: [0, 1], closed: false };
const VECTOR = { start: [0, 0, 0] as Vec3, end: [1, 0, 0] as Vec3, startNormal: [0, 0, 1] as Vec3, endNormal: [0, 0, 1] as Vec3 };

const storeOf = (type: SpecimenInfo['type']): ProjectStore => {
  const st = emptyProject();
  st.specimen = { ...st.specimen, type };
  return new ProjectStore(st);
};
const FRAME = (id: string): NonNullable<SpecimenInfo['frame']> => ({ matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], source: id });

describe('the generic type of specimen', () => {
  it('is a type a file can say, and is kept', () => {
    expect(SPECIMEN_TYPES).toEqual(['core', 'flake', 'generic']);
    const st = storeOf('generic').state as ProjectState;
    expect(parseProjectFile(JSON.parse(JSON.stringify(serializeProject(st, 'x')))).specimen.type).toBe('generic');
  });

  it('offers custom alone for the types of curves and regions, number key 1', () => {
    for (const f of [curveField, regionField]) {
      expect(offeredOptions(f, 'generic')).toEqual([]);
      expect(keyedOptions(f, 'generic')).toEqual(['custom']);
    }
    // the others keep their presets
    expect(keyedOptions(curveField, 'core').length).toBeGreaterThan(1);
    expect(keyedOptions(regionField, 'flake').length).toBeGreaterThan(1);
  });

  it('takes the text as typed, a preset\'s label or code too', () => {
    expect(customValue(curveField, '  suture ', 'generic')).toBe('suture');
    expect(customValue(curveField, '石皮', 'generic')).toBe('石皮');
    expect(customValue(curveField, '石皮', 'core')).toBe('cortex');
    // a code from another type is still read and shown as what it is
    expect(isCustomValue(curveField, 'cortex')).toBe(false);
    expect(isCustomValue(curveField, 'suture')).toBe(true);
    expect(isCustomValue(regionField, GENERIC_REGION_TYPE)).toBe(true);
  });

  it('cuts its one layer of regions along all the curves', () => {
    const curves = ['edge', 'core_edge', 'platform_outline', 'suture', ''].map((type) => ({ id: type, attributes: { type } }));
    const generic = layerCurves(curves, 'generic');
    expect(generic.lower.map((c) => c.id)).toEqual(['edge', 'core_edge', 'platform_outline', 'suture', '']);
    expect(generic.upper).toEqual([]);
    for (const c of curves) expect(isBoundaryCurve(c.attributes.type, 'generic')).toBe(false);
    for (const t of ['flaking_surface', 'platform', 'ventral', 'dorsal']) {
      expect(isUpperRegion(t, 'generic')).toBe(false);
      expect(isUpperRegion(t, 'flake')).toBe(true);
    }
    // the others as they were
    expect(layerCurves(curves, 'flake').upper.map((c) => c.id)).toEqual(['edge', 'platform_outline']);
    expect(layerCurves(curves, 'core').upper.map((c) => c.id)).toEqual(['core_edge']);
    expect(layerCurves(curves, 'core').lower).toHaveLength(5);
  });

  it('fits planes by all the vertices, curves or regions', () => {
    expect(planeMethodsOf('generic')).toEqual(['all_vertices', 'curves', 'region']);
    expect(planeMethodsOf('core')).toEqual(['all_vertices', 'scar_directions', 'scar_starts', 'curves']);
    expect(planeMethodsOf('flake')).toEqual(['curves', 'region']);
  });

  it('measures no edge angles, as a core does not: they are a flake\'s, whatever a curve says', () => {
    for (const specimen of ['generic', 'core'] as const) {
      for (const type of ['edge', 'core_edge', 'suture']) expect(measuresEdgeAngle({ attributes: { type } }, specimen)).toBe(false);
      expect(measuresEdgeAngle({ edgeAngle: true, attributes: { type: 'suture' } }, specimen)).toBe(false);
    }
    expect(measuresEdgeAngle({ attributes: { type: 'edge' } }, 'flake')).toBe(true);
    // what a core measured shows when it has become a flake
    expect(measuresEdgeAngle({ attributes: { type: 'core_edge' } }, 'flake')).toBe(true);
    expect(measuresEdgeAngle({ edgeAngle: true, attributes: { type: 'suture' } }, 'flake')).toBe(true);
    expect(measuresEdgeAngle({ edgeAngle: false, attributes: { type: 'edge' } }, 'flake')).toBe(false);
    expect(measuresEdgeAngle({ attributes: { type: 'suture' } }, 'flake')).toBe(false);
  });

  it('colours arrows by nothing a generic specimen does not have', () => {
    expect(arrowColorModeOf('completeness', 'generic')).toBe('uniform');
    expect(arrowColorModeOf('sequence', 'generic')).toBe('uniform');
    expect(arrowColorModeOf('direction', 'generic')).toBe('direction');
    expect(arrowColorModeOf('completeness', 'core')).toBe('completeness');
  });

  it('makes no scar for a region, whatever its text says', () => {
    const generic = storeOf('generic');
    const r = addRegion(generic, P, GENERIC_REGION_TYPE, null);
    expect(r).toMatchObject({ type: GENERIC_REGION_TYPE, scarId: null });
    setRegionType(generic, r.id, 'scar', null);
    expect(generic.region(r.id)).toMatchObject({ type: 'scar', scarId: null });
    expect(generic.state.scars).toEqual([]);
    expect(addRegion(generic, P, 'scar', null).scarId).toBeNull();
    expect(generic.state.scars).toEqual([]);
    // a core's scar region still has its scar
    const core = storeOf('core');
    expect(addRegion(core, P, 'scar', null).scarId).not.toBeNull();
    expect(core.state.scars).toHaveLength(1);
  });
});

describe('switching a specimen to generic and back', () => {
  it('keeps every annotation, and undo takes one step', () => {
    const store = storeOf('core');
    addCurve(store, { ...SHAPE, attributes: { type: 'core_edge' } });
    const a = addScarVector(store, VECTOR);
    setScarAttribute(store, a.id, 'completeness', 'bulb_complete');
    const before = JSON.stringify([store.state.curves, store.state.scars]);
    setSpecimenType(store, 'generic');
    expect(store.state.specimen.type).toBe('generic');
    expect(JSON.stringify([store.state.curves, store.state.scars])).toBe(before);
    setSpecimenType(store, 'flake');
    setSpecimenType(store, 'generic');
    setSpecimenType(store, 'core');
    expect(JSON.stringify([store.state.curves, store.state.scars])).toBe(before);
    store.history.undo();
    expect(store.state.specimen.type).toBe('generic');
  });

  it('shares its frame with the core, and a flake keeps its own', () => {
    const store = storeOf('core');
    updateSpecimen(store, { frame: FRAME('core frame') }, false);
    setSpecimenType(store, 'generic');
    expect(store.state.specimen.frame?.source).toBe('core frame');
    setSpecimenType(store, 'flake');
    expect(store.state.specimen.frame).toBeNull();
    updateSpecimen(store, { frame: FRAME('flake frame') }, false);
    setSpecimenType(store, 'generic');
    expect(store.state.specimen.frame?.source).toBe('core frame');
    setSpecimenType(store, 'core');
    expect(store.state.specimen.frame?.source).toBe('core frame');
    setSpecimenType(store, 'flake');
    expect(store.state.specimen.frame?.source).toBe('flake frame');
  });
});

describe('what a generic specimen exports', () => {
  const auto = { frame: 'principal' as const, length: 1, width: 1, thickness: 1, surfaceArea: 1, volume: 1, closed: true };
  const specimen = (store: ProjectStore, file: string) => batchSpecimen(file, { project: { path: `${file}.json`, state: store.state as ProjectState, derived: {}, appVersion: 'x' }, measures: { auto, vertices: null, box: { min: [0, 0, 0], max: [1, 1, 1], axes: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }, source: 'principal' } as never } }, []);

  it('leaves the scar attributes of its arrows empty, the columns kept', () => {
    const store = storeOf('core');
    const a = addScarVector(store, VECTOR);
    setScarAttribute(store, a.id, 'completeness', 'bulb_complete');
    const core = scarVectorCsv(store.state, { excelBom: false }).trim().split('\n');
    setSpecimenType(store, 'generic');
    const generic = scarVectorCsv(store.state, { excelBom: false }).trim().split('\n');
    expect(generic[0]).toBe(core[0]);
    const column = core[0].split(',').indexOf('completeness');
    expect(core[1].split(',')[column]).toBe('bulb_complete');
    expect(generic[1].split(',')[column]).toBe('');
    expect(generic[1].split(',')[1]).toBe(a.label);
    expect(generic[1].split(',').length).toBe(core[0].split(',').length);
  });

  it('has no configuration, and the summary has none of the files of the other types', () => {
    const generic = storeOf('generic');
    generic.state.specimen.id = 'g';
    addCurveOfType(generic, SHAPE, 'suture');
    addScarVector(generic, VECTOR);
    expect(serializeProject(generic.state as ProjectState, 'x').derived.configuration).toBeNull();
    const s = specimen(generic, 'g.ply');
    expect(s.configuration).toBeNull();
    expect(s.flake).toBeNull();
    const names = batchOutputs([s], { excelBom: false }).map((f) => f.suffix);
    for (const name of ['flakes.csv', 'configuration.csv', 'flaking_surfaces.csv', 'relations.csv', 'series.csv', 'edge_sharp.csv', 'retouch_angles.csv']) expect(names).not.toContain(name);
    for (const name of ['measurements.csv', 'curves.csv', 'scar_vectors.csv']) expect(names).toContain(name);
  });

  it('takes the type of its curves in one step that undo takes back', () => {
    const store = storeOf('flake');
    const steps = () => store.history.canUndo;
    expect(steps()).toBe(false);
    const c = addCurveOfType(store, SHAPE, 'platform_outline');
    expect(c.attributes.type).toBe('platform_outline');
    expect(store.state.regions.map((r) => [r.type, r.auto])).toEqual([['platform', true]]);
    // a new outline in place of the old
    const d = addCurveOfType(store, SHAPE, 'platform_outline');
    expect(store.state.curves.map((x) => x.id)).toEqual([d.id]);
    store.history.undo();
    expect(store.state.curves.map((x) => x.id)).toEqual([c.id]);
    store.history.undo();
    expect(store.state.curves).toEqual([]);
    expect(store.state.regions).toEqual([]);
    expect(steps()).toBe(false);
  });
});

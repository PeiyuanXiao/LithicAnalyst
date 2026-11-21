import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { biconePolar, biconeRefOf, biconeVolumes, computeBicone, coreConfiguration, defaultUpHint, edgeCurves, soleEdgeCurve } from '../src/compute/bicone';
import { meshTopology } from '../src/compute/meshGeometry';
import type { VolumeSplit } from '../src/compute/split';
import { runSync } from '../src/compute/steps';
import { symmetryMeshSteps, symmetrySteps, symmetryValues, type SymmetryComputed } from '../src/compute/symmetry';
import { addCurve, addScarVector, addSymmetry, deleteSymmetry, setBiconeRole, setConfigModel, setConfigRole, swapBicone, updateSpecimen, useBiconeCurve } from '../src/core/actions';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { ProjectStore } from '../src/core/store';
import type { ProjectState, Vec3 } from '../src/core/types';
import { configurationCsv, flakingSurfacesCsv, scarVectorCsv } from '../src/io/csv';
import { biconeOutline, biconeSize, fitOutline } from '../src/render/biconeShape';
import { bicone } from './meshes';

const R = 30, UP = 10, DOWN = 20, SEG = 96;
const mesh = bicone(R, UP, DOWN, SEG, 6);
const point = (v: number): Vec3 => [mesh.positions[3 * v], mesh.positions[3 * v + 1], mesh.positions[3 * v + 2]];
const rim = Array.from({ length: SEG }, (_, j) => point(mesh.rim + j));

/** The sides of the rim's symmetry reference, A toward +z (as the app parts them along a closed curve), before any swap. */
function rimSymmetry(m = mesh): Required<SymmetryComputed> {
  const chain: number[] = [];
  for (let j = 0; j < SEG; j++) chain.push(m.rim + j, m.rim + ((j + 1) % SEG));
  const closed = meshTopology(m.index, m.positions.length / 3).closed;
  const sm = runSync(symmetryMeshSteps(m.positions, m.index, closed));
  return runSync(symmetrySteps(sm, { plane: { point: [0, 0, 0], normal: [0, 0, 1] }, chain, closed }));
}
const rim0 = rimSymmetry();

/** The bicone's volumes as the app gives them: its reference's sides, as its `swap` has them. */
const volumesOf = (state: Readonly<ProjectState>): VolumeSplit | null => {
  const ref = biconeRefOf(state);
  return ref ? biconeVolumes(state, [symmetryValues(ref, rim0, [0, 0, 0])]) : null;
};
const rimSplit = (): VolumeSplit => ({ upper: rim0.sides.volumes![0], lower: rim0.sides.volumes![1], ratio: rim0.sides.volumes![0] / rim0.sides.volumes![1] });

/** A point on the upper or lower cone at angle `t` and `rho` of the radius from the axis. */
const onCone = (t: number, rho: number, upper: boolean): Vec3 => [rho * R * Math.cos(t), rho * R * Math.sin(t), (upper ? UP : -DOWN) * (1 - rho)];

/** A scar from the rim toward the apex, at angle `t`. */
const scarAt = (store: ProjectStore, t: number, upper: boolean) =>
  addScarVector(store, { start: onCone(t, 1, upper), end: onCone(t, 0.4, upper), startNormal: [Math.cos(t), Math.sin(t), 0], endNormal: [0, 0, upper ? 1 : -1] });

/** A specimen with a symmetry reference on a closed curve on the rim (A toward +z), configured as a bicone on it. */
function setup() {
  const store = new ProjectStore();
  updateSpecimen(store, { id: 'B1' });
  const curve = addCurve(store, { anchors: [rim[0], rim[32], rim[64]], points: rim, anchorIndex: [0, 32, 64], closed: true, attributes: { type: 'core_edge' } });
  useBiconeCurve(store, curve.id, [0, 0, 1]);
  const volumes = () => volumesOf(store.state);
  return { store, volumes, result: () => computeBicone(store.state, volumes())! };
}

describe('choosing the curve', () => {
  const curve = (id: string, closed: boolean, type: string) => ({ id, closed, attributes: { type } });

  it('lists closed curves with core edges first, and names one when it goes without saying', () => {
    const a = curve('a', true, 'cortex'), b = curve('b', true, 'core_edge'), c = curve('c', false, 'core_edge'), d = curve('d', true, '');
    expect(edgeCurves([a, b, c, d]).map((x) => x.id)).toEqual(['b', 'a', 'd']);
    // no closed curve; the only one; the only core edge; none of them says
    expect(soleEdgeCurve([c])).toBeNull();
    expect(soleEdgeCurve([a, c])).toBe(a);
    expect(soleEdgeCurve([a, b, c, d])).toBe(b);
    expect(soleEdgeCurve([a, d])).toBeNull();
    expect(soleEdgeCurve([b, curve('e', true, 'core_edge')])).toBeNull();
  });

  it('points up to the side with more scars, by their ends; when even, toward the viewer', () => {
    const { store } = setup();
    const above: Vec3 = [0, 0, 1], below: Vec3 = [0, 0, -1];
    const up = (view: Vec3) => defaultUpHint(rim, store.state.scars, view)[2];
    // no scars, or as many on each side: the view
    expect(up(above)).toBe(1);
    expect(up(below)).toBe(-1);
    scarAt(store, 0, true);
    scarAt(store, 1, false);
    expect(up(above)).toBe(1);
    expect(up(below)).toBe(-1);
    // more below, whatever the view
    scarAt(store, 2, false);
    expect(up(above)).toBeCloseTo(-1, 6);
    expect(up(below)).toBeCloseTo(-1, 6);
    // more above
    scarAt(store, 3, true);
    scarAt(store, 4, true);
    expect(up(below)).toBeCloseTo(1, 6);
  });

  it('finds or makes the curve’s symmetry reference and sets the model in one step that undo takes back whole', () => {
    const store = new ProjectStore();
    const curve = addCurve(store, { anchors: [rim[0], rim[32], rim[64]], points: rim, anchorIndex: [0, 32, 64], closed: true, attributes: { type: 'core_edge' } });
    addSymmetry(store, { kind: 'plane', planeId: 'p' }, [0, 0, 1]);
    useBiconeCurve(store, curve.id, [0, 0, 1]);
    const made = store.state.symmetry[1];
    expect(made).toMatchObject({ label: 'S2', source: { kind: 'curve', curveId: curve.id }, upHint: [0, 0, 1], swap: false });
    expect(store.state.configuration).toMatchObject({ model: 'bicone', biconeRef: made.id });
    store.history.undo();
    expect(store.state.symmetry.map((s) => s.source.kind)).toEqual(['plane']);
    expect(store.state.configuration).toMatchObject({ model: 'box', biconeRef: null });
    store.history.redo();
    expect(store.state.configuration).toMatchObject({ model: 'bicone', biconeRef: made.id });
    // back to the box: the reference stays; the curve again: the same reference, none made anew
    setConfigModel(store, 'box');
    expect(store.state.configuration.biconeRef).toBe(made.id);
    useBiconeCurve(store, curve.id, [0, 0, -1]);
    expect(store.state.symmetry).toHaveLength(2);
    expect(store.state.configuration).toMatchObject({ model: 'bicone', biconeRef: made.id });
    // the reference deleted: the bicone lets go of it in the same step
    deleteSymmetry(store, made.id);
    expect(store.state.configuration.biconeRef).toBeNull();
    store.history.undo();
    expect(store.state.configuration.biconeRef).toBe(made.id);
  });
});

describe('bicone', () => {
  it('takes the base from the reference’s curve and the heights from its volumes; swapped, they change places', () => {
    const { store, result } = setup();
    scarAt(store, 0, true);
    const r = result();
    // a regular 96-gon: within 0.1 % of the circle
    expect(Math.abs(r.area / (Math.PI * R * R) - 1)).toBeLessThan(0.001);
    expect(r.radius).toBeCloseTo(Math.sqrt(r.area / Math.PI), 9);
    expect(r.upperHeight).toBeCloseTo(UP, 4);
    expect(r.lowerHeight).toBeCloseTo(DOWN, 4);
    r.centre.forEach((x) => expect(Math.abs(x)).toBeLessThan(1e-6));
    expect(r.plane.normal[2]).toBeCloseTo(1, 9);
    expect(r.cones.map((c) => [c.cone, c.side, c.scars])).toEqual([['upper', 'positive', 1], ['lower', 'negative', 0]]);

    swapBicone(store);
    const s = result();
    expect(s.upperHeight).toBeCloseTo(DOWN, 4);
    expect(s.lowerHeight).toBeCloseTo(UP, 4);
    expect(s.plane.normal[2]).toBeCloseTo(-1, 9);
    // the scar's end is on the +z cone, now the lower one
    expect(s.scars[0].cone).toBe('lower');
    expect(s.cones.map((c) => [c.cone, c.side, c.scars])).toEqual([['upper', 'negative', 0], ['lower', 'positive', 1]]);

    // a correction stays with its physical side (the +z cone)
    setBiconeRole(store, 'positive', 'none');
    expect(result().cones.map((c) => [c.cone, c.role])).toEqual([['upper', 'none'], ['lower', 'none']]);
    swapBicone(store);
    expect(result().cones.map((c) => [c.cone, c.autoRole, c.role])).toEqual([['upper', 'flaking', 'none'], ['lower', 'none', 'none']]);
  });

  it('is unifacial with scars on one cone, bifacial on both, unifacial again with one cone set unflaked', () => {
    const { store, result } = setup();
    for (const t of [0, 1, 2, 3]) scarAt(store, t, true);
    let r = result();
    expect(r.facialCharacter).toBe('unifacial');
    expect(r.surfaces).toEqual([{ id: 'F1', cone: 'upper', scarIds: store.state.scars.map((s) => s.id) }]);
    for (const t of [0.5, 2.5]) scarAt(store, t, false);
    r = result();
    expect(r.facialCharacter).toBe('bifacial');
    expect(r.surfaces.map((s) => [s.id, s.cone, s.scarIds.length])).toEqual([['F1', 'upper', 4], ['F2', 'lower', 2]]);
    expect(r.scars.map((s) => s.surface)).toEqual(['F1', 'F1', 'F1', 'F1', 'F2', 'F2']);
    setBiconeRole(store, 'negative', 'none');
    r = result();
    expect(r.facialCharacter).toBe('unifacial');
    expect(r.scars.map((s) => s.surface)).toEqual(['F1', 'F1', 'F1', 'F1', null, null]);
    // only the upper cone set unflaked: the lower is F1
    setBiconeRole(store, 'negative', null);
    setBiconeRole(store, 'positive', 'none');
    expect(result().surfaces.map((s) => [s.id, s.cone])).toEqual([['F1', 'lower']]);
  });

  it('maps a point on the rim to ρ̂ = 1 and one at the centre to ρ̂ ≈ 0', () => {
    const { store, result } = setup();
    scarAt(store, 0, true);
    const r = result();
    const polar = biconePolar(r, rim);
    expect(polar(rim[10]).rho).toBeCloseTo(1, 6);
    // beyond the rim (a start a little outside): still 1
    expect(polar([31, 0, 0]).rho).toBe(1);
    expect(polar([0, 0, 5]).rho).toBeLessThan(1e-6);
    // halfway out at a vertex's angle: 0.5
    const t = (2 * Math.PI * 10) / SEG;
    expect(polar([15 * Math.cos(t), 15 * Math.sin(t), 4]).rho).toBeCloseTo(0.5, 6);
    // angles turn the same way as the rim, a quarter turn apart
    const a = polar(rim[0]).theta, b = polar(rim[24]).theta;
    expect(Math.abs(Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))) - Math.PI / 2)).toBeLessThan(1e-6);
  });

  it('has no result without the volumes of a closed mesh', () => {
    const { store } = setup();
    scarAt(store, 0, true);
    // the bicone without its lower apex: open, so its reference has no volumes
    const open = { ...mesh, index: mesh.index.slice(0, mesh.index.length - 3 * SEG) };
    expect(meshTopology(open.index, open.positions.length / 3).closed).toBe(false);
    expect(meshTopology(mesh.index, mesh.positions.length / 3).closed).toBe(true);
    const openSides = rimSymmetry(open);
    expect(openSides.sides.volumes).toBeNull();
    expect(openSides.sides.volumeReason).toBe('not_closed');
    expect(biconeVolumes(store.state, [symmetryValues(biconeRefOf(store.state)!, openSides, [0, 0, 0])])).toBeNull();
    expect(computeBicone(store.state, null)).toBeNull();
    // no reference on a curve, or no arrows: none either
    deleteSymmetry(store, store.state.symmetry[0].id);
    expect(computeBicone(store.state, rimSplit())).toBeNull();
    // the box model still needs its box
    setConfigModel(store, 'box');
    expect(coreConfiguration(store.state, null, rimSplit())).toBeNull();
  });

  it('round-trips through the project file; a file’s old split becomes S1 with the same bicone; a change of orientation keeps its corrections', () => {
    const { store } = setup();
    scarAt(store, 0, true);
    swapBicone(store);
    setBiconeRole(store, 'negative', 'flaking');
    setConfigRole(store, 'front', 'platform');
    const ref = biconeRefOf(store.state)!;
    const file = serializeProject(store.state, 'test', { measurements: null, vertices: null, symmetry: [symmetryValues(ref, rim0, [0, 0, 0])] });
    expect(file.symmetry[0]).toMatchObject({ label: 'S1', swap: true });
    expect(file.configuration).toMatchObject({ model: 'bicone', biconeRef: ref.id, bicone: { roles: { negative: 'flaking' } } });
    expect(file.derived.configuration).toMatchObject({ model: 'bicone', frame: 'principal', facialCharacter: 'bifacial' });
    expect(file.derived.symmetry!.refs[0]).toMatchObject({ id: ref.id, volumeA: rim0.sides.volumes![1], volumeB: rim0.sides.volumes![0] });
    const back = parseProjectFile(JSON.parse(JSON.stringify(file)));
    expect(back.symmetry).toEqual(store.state.symmetry);
    expect(back.configuration).toEqual(store.state.configuration);
    expect(back.nextSymmetryNumber).toBe(2);
    // a file of before stage 34: its upper / lower split becomes S1, which the bicone stands on, and the bicone is the same
    const raw = JSON.parse(JSON.stringify(file));
    delete raw.symmetry;
    delete raw.nextSymmetryNumber;
    delete raw.configuration.biconeRef;
    raw.split = { source: 'curve', id: store.state.curves[0].id, upHint: [0, 0, 1], swap: true };
    const migrated = parseProjectFile(raw);
    expect(migrated.symmetry).toHaveLength(1);
    expect(migrated.symmetry[0]).toMatchObject({ label: 'S1', note: '', source: { kind: 'curve', curveId: store.state.curves[0].id }, upHint: [0, 0, 1], swap: true });
    expect(migrated.configuration.biconeRef).toBe(migrated.symmetry[0].id);
    expect(migrated.nextSymmetryNumber).toBe(2);
    expect(computeBicone(migrated, volumesOf(migrated))).toEqual(computeBicone(store.state, volumesOf(store.state)));
    // a plane's split: S1 on the plane, no bicone reference; no split: none
    const byPlane = parseProjectFile({ ...raw, split: { source: 'plane', id: 'p1', upHint: [0, 1, 0] } });
    expect(byPlane.symmetry[0]).toMatchObject({ source: { kind: 'plane', planeId: 'p1' }, upHint: [0, 1, 0], swap: false });
    expect(byPlane.configuration.biconeRef).toBeNull();
    expect(parseProjectFile({ ...raw, split: null }).symmetry).toEqual([]);
    // a reference of a source not understood is left out; one that is: kept (stage 34's `optimize` let go)
    const odd = JSON.parse(JSON.stringify(file));
    odd.symmetry.push({ id: 'x', label: 'S9', source: { kind: 'sphere' } }, { id: 'y', label: 'S8', source: { kind: 'frame', frame: 'specimen', axis: 'y' }, optimize: true });
    const kept = parseProjectFile(odd);
    expect(kept.symmetry.map((s) => s.id)).toEqual([ref.id, 'y']);
    expect(kept.symmetry[1]).toMatchObject({ source: { kind: 'frame', frame: 'specimen', axis: 'y' }, swap: false, note: '' });
    expect(kept.symmetry[1]).not.toHaveProperty('optimize');
    expect(kept.nextSymmetryNumber).toBe(9);
    // older files: the box, no bicone corrections
    delete raw.configuration.model;
    delete raw.configuration.bicone;
    const old = parseProjectFile(raw);
    expect(old.configuration.model).toBe('box');
    expect(old.configuration.bicone).toEqual({ roles: {} });
    // a new orientation clears the corrections by face only
    updateSpecimen(store, { frame: { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], source: 'view' } }, false);
    expect(store.state.configuration).toMatchObject({ roles: {}, model: 'bicone', bicone: { roles: { negative: 'flaking' } } });
  });

  it('exports the model, and the cones as flaking surfaces', () => {
    const { store, result } = setup();
    scarAt(store, 0, true);
    scarAt(store, 1, false);
    setBiconeRole(store, 'negative', 'none');
    const r = result();
    const opts = { excelBom: false };
    expect(configurationCsv(store.state, r, opts)).toBe('specimen_id,model,frame,facial_character,flaking_surface_relation,platform_relation,polarity\nB1,bicone,principal,unifacial,,,\n');
    setBiconeRole(store, 'negative', null);
    const both = result();
    expect(flakingSurfacesCsv(store.state, both, opts)).toBe(
      'specimen_id,surface_id,faces,platforms,also_platform,n_scars,surface_type,exploitation_axis\nB1,F1,upper,,,1,,\nB1,F2,lower,,,1,,\n',
    );
    const rows = scarVectorCsv(store.state, opts, both).trim().split('\n');
    expect(rows.slice(1).map((l) => l.split(',').slice(-5, -2).join(','))).toEqual([',F1,mm', ',F2,mm']);
    // without a result (no volumes): the model still
    expect(configurationCsv(store.state, null, opts).split('\n')[1]).toBe('B1,bicone,,,,,');
  });
});

describe('framing the sketch by the outline', () => {
  const view = { right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), dir: new THREE.Vector3(0, 0, 1), tanV: Math.tan((13 * Math.PI) / 180), aspect: 300 / 160 };
  const tanH = view.tanV * view.aspect;
  const W = 0.85, H = 0.92;
  const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
  /** The points' bounds on the canvas (−1 to 1), the camera standing as fitted. */
  const bounds = (points: THREE.Vector3[], f: { x: number; y: number; distance: number }) => {
    const sx = points.map((p) => (p.x - f.x) / ((f.distance - p.z) * tanH)), sy = points.map((p) => (p.y - f.y) / ((f.distance - p.z) * view.tanV));
    return { left: Math.min(...sx), right: Math.max(...sx), top: Math.max(...sy), bottom: Math.min(...sy) };
  };

  it('takes the share of the width or of the height, whichever comes first', () => {
    // all at one depth, so no perspective: 2 wide on a canvas wider than high
    expect(fitOutline([v(-1, 0), v(1, 0), v(0, 0.1), v(0, -0.1)], view, W, H).distance).toBeCloseTo(1 / (W * tanH), 6);
    expect(fitOutline([v(-1, 0), v(1, 0), v(0, 1), v(0, -1)], view, W, H).distance).toBeCloseTo(1 / (H * view.tanV), 6);
  });

  it('centres what is off centre, also nearer the camera', () => {
    const f = fitOutline([v(-1, -3), v(3, 1)], view, W, H);
    expect(f.x).toBeCloseTo(1, 6);
    expect(f.y).toBeCloseTo(-1, 6);
    const near = [v(0, 2, 1), v(0, 0, -1), v(1, 1, 0), v(-1, 1, 0)];
    const b = bounds(near, fitOutline(near, view, W, H));
    expect(b.top + b.bottom).toBeCloseTo(0, 6);
    expect(b.left + b.right).toBeCloseTo(0, 6);
  });

  it('keeps the distance it is given, and then only centres', () => {
    const points = [v(-1, -2), v(1, 0)];
    const f = fitOutline(points, view, W, H, 50);
    expect(f.distance).toBe(50);
    expect(f.y).toBeCloseTo(-1, 6);
    expect(fitOutline(points, view, W, H, 0.001).distance).toBeCloseTo(1 / (H * view.tanV), 6);
  });

  // from a flat discoid to one cone twelve times the other, and a tall spindle
  for (const [radius, upperHeight, lowerHeight] of [[30, 5, 5], [30, 10, 30], [30, 8, 48], [25, 5, 60], [10, 40, 40]]) {
    it(`a bicone of radius ${radius}, heights ${upperHeight} and ${lowerHeight} stays inside and centred however it is turned`, () => {
      const s = biconeSize({ radius, upperHeight, lowerHeight });
      const outline = biconeOutline(s, s.radius);
      const home = fitOutline(outline, view, W, H).distance;
      const q = new THREE.Quaternion();
      let leastShare = 1;
      for (let a = 0; a < 12; a++)
        for (let b = 0; b < 12; b++) {
          q.setFromEuler(new THREE.Euler((a * Math.PI) / 6, (b * Math.PI) / 6, (a * b * Math.PI) / 18));
          const turned = outline.map((p) => p.clone().applyQuaternion(q));
          const f = fitOutline(turned, view, W, H, home);
          // never drawn larger than in the default view
          expect(f.distance).toBeGreaterThanOrEqual(home);
          const o = bounds(turned, f);
          expect(o.right).toBeLessThanOrEqual(W + 1e-3);
          expect(o.top).toBeLessThanOrEqual(H + 1e-3);
          expect(o.left + o.right).toBeCloseTo(0, 3);
          expect(o.top + o.bottom).toBeCloseTo(0, 3);
          leastShare = Math.min(leastShare, home / f.distance);
        }
      // only as much smaller as it must be: a diameter-limited shape seen face on loses the width it had to spare
      expect(leastShare).toBeGreaterThan(0.45);
    });
  }
});

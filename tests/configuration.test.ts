import { describe, expect, it } from 'vitest';
import { computeConfiguration, emptyCorrections, faceRelation, joinKey, placeScar, type ConfigBox, type ConfigurationResult } from '../src/compute/configuration';
import { frameMeasures, surfaceMeasures } from '../src/compute/measure';
import { addScarVector, resetConfigFace, setConfigAxis, setConfigJoin, setConfigPolarity, setConfigRole, setConfigSurfaceType, updateSpecimen } from '../src/core/actions';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { ProjectStore } from '../src/core/store';
import { configurationCsv, flakingSurfacesCsv, scarVectorCsv } from '../src/io/csv';
import type { ConfigCorrections, Scar, Vec3 } from '../src/core/types';
import { box as boxMesh } from './meshes';

/** An axis-aligned box centred at the origin, in the specimen frame (X, Y, Z = the model's axes). */
const box = (size: Vec3): ConfigBox => ({
  frame: 'specimen',
  axes: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  min: size.map((s) => -s / 2) as Vec3,
  max: size.map((s) => s / 2) as Vec3,
});

let n = 0;
/** A scar with an arrow from `start` to `end` on a surface with normal `normal`. */
const scar = (start: Vec3, end: Vec3, normal: Vec3): Scar => {
  n++;
  return { id: `s${n}`, label: `S${n}`, vector: { start, end, startNormal: normal, endNormal: normal }, attributes: {}, createdAt: '', modifiedAt: '' };
};

const FRONT: Vec3 = [0, 0, 1], BACK: Vec3 = [0, 0, -1], RIGHT: Vec3 = [1, 0, 0];

const config = (scars: Scar[], b: ConfigBox, c: Partial<ConfigCorrections> = {}): ConfigurationResult => computeConfiguration(scars, { ...emptyCorrections(), ...c }, b)!;

/** The seven traits (face names left out: they follow the orientation). */
const traits = (r: ConfigurationResult) => ({
  facial: r.facialCharacter,
  surfaces: r.surfaces.map((s) => s.faces.length),
  relation: r.flakingSurfaceRelation,
  platform: r.platformRelation,
  polarity: r.polarity,
  type: r.surfaces.map((s) => s.type),
  axis: r.surfaces.map((s) => s.axis),
});

// columnar core 36 × 60 × 24: three scars on the front, struck from the top
const columnBox = box([36, 60, 24]);
const columnFront = () => [-10, 0, 10].map((x) => scar([x, 29, 12], [x, 5, 12], FRONT));
const columnBack = () => [scar([0, -29, -12], [0, -5, -12], BACK)];

describe('volumetric configuration', () => {
  it('places a scar on the face its normal points to, struck from the adjacent face behind its start', () => {
    const s = scar([-10, 29, 12], [-10, 5, 12], FRONT);
    expect(placeScar(s.vector!, columnBox)).toEqual({ face: 'front', platform: 'top' });
    // the two normals are averaged
    const t = scar([17, 0, 11], [17, -20, 11], FRONT);
    t.vector!.endNormal = [1, 0, 0.2];
    t.vector!.startNormal = [1, 0, 0.6];
    expect(placeScar(t.vector!, columnBox).face).toBe('right');
    expect(faceRelation(['front', 'back'])).toBe('opposite');
    expect(faceRelation(['front', 'top'])).toBe('adjacent');
    expect(faceRelation(['front', 'back', 'top'])).toBe('mixed');
    expect(faceRelation(['front'])).toBeNull();
    expect(joinKey('right', 'front')).toBe('front|right');
  });

  it('columnar core, one face from the top: unifacial, single platform, unipolar, wide, long', () => {
    const r = config(columnFront(), columnBox);
    expect(r.faces.find((f) => f.face === 'front')).toMatchObject({ autoRole: 'flaking', role: 'flaking', scars: 3 });
    expect(r.faces.find((f) => f.face === 'top')).toMatchObject({ autoRole: 'platform', scars: 0 });
    expect(r.surfaces).toMatchObject([{ id: 'F1', faces: ['front'], mainFace: 'front', platforms: ['top'], centripetal: false }]);
    expect(traits(r)).toEqual({ facial: 'unifacial', surfaces: [1], relation: null, platform: 'single', polarity: 'unipolar_longitudinal', type: ['wide'], axis: ['long'] });
    expect(r.scars.every((s) => s.face === 'front' && s.platform === 'top' && s.surface === 'F1')).toBe(true);
    expect(r.thresholds).toEqual({ centripetalShare: 0.75, centripetalCos: 0.5, orthogonalToleranceDeg: 25, orthogonalShare: 0.75, wideRatio: 1.25, minNormalAcross: 0.2 });
  });

  it('adding the back from the bottom: bifacial, opposite, opposite platforms, bipolar opposed', () => {
    const r = config([...columnFront(), ...columnBack()], columnBox);
    expect(r.surfaces.map((s) => [s.id, s.faces, s.platforms])).toEqual([
      ['F1', ['front'], ['top']],
      ['F2', ['back'], ['bottom']],
    ]);
    expect(traits(r)).toMatchObject({ facial: 'bifacial', relation: 'opposite', platform: 'opposite', polarity: 'bipolar_opposed' });
  });

  it('discoid core, both faces worked from all round: peripheral, centripetal, wide, no axis', () => {
    const b = box([80, 76, 23]);
    const round = (z: number, normal: Vec3) => [
      scar([39, 0, z], [15, 0, z], normal),
      scar([-39, 0, z], [-15, 0, z], normal),
      scar([0, 37, z], [0, 12, z], normal),
      scar([0, -37, z], [0, -12, z], normal),
    ];
    const r = config([...round(11.5, FRONT), ...round(-11.5, BACK)], b);
    expect(r.surfaces.map((s) => [s.faces, s.platforms, s.centripetal])).toEqual([
      [['front'], ['left', 'right', 'top', 'bottom'], true],
      [['back'], ['left', 'right', 'top', 'bottom'], true],
    ]);
    expect(traits(r)).toEqual({
      facial: 'bifacial',
      surfaces: [1, 1],
      relation: 'opposite',
      platform: 'peripheral',
      polarity: 'multipolar_centripetal',
      type: ['wide', 'wide'],
      axis: ['na', 'na'],
    });
  });

  it('flaking round the core from one platform joins the faces; split by hand they are adjacent', () => {
    const scars = [scar([-10, 29, 12], [-10, 5, 12], FRONT), scar([18, 29, 0], [18, 5, 0], RIGHT)];
    const r = config(scars, columnBox);
    expect(r.joins).toEqual([{ faces: ['front', 'right'], auto: true, joined: true }]);
    expect(r.surfaces.map((s) => s.faces)).toEqual([['front', 'right']]);
    expect(traits(r)).toMatchObject({ facial: 'unifacial', platform: 'single', polarity: 'unipolar_longitudinal' });
    const split = config(scars, columnBox, { joins: { 'front|right': false } });
    expect(split.surfaces.map((s) => s.faces)).toEqual([['front'], ['right']]);
    expect(traits(split)).toMatchObject({ facial: 'bifacial', relation: 'adjacent' });
  });

  it('one face struck from the top and from the side: bipolar orthogonal', () => {
    const r = config([scar([0, 29, 12], [0, 5, 12], FRONT), scar([17, 0, 12], [-5, 0, 12], FRONT)], columnBox);
    expect(r.surfaces[0].platforms).toEqual(['right', 'top']);
    expect(traits(r)).toMatchObject({ facial: 'unifacial', platform: 'adjacent', polarity: 'bipolar_orthogonal' });
    // two platforms on different axes: no exploitation axis
    expect(r.surfaces[0].axis).toBe('na');
  });

  it('three platforms: orthogonal or multidirectional removals; the polarity can be set by hand', () => {
    const b = box([80, 24, 40]);
    // starts near the ends of the edges, parallel to the axes (not toward the centre)
    const parallel = [
      scar([-34, 11, 20], [-34, -6, 20], FRONT),
      scar([34, 11, 20], [34, -6, 20], FRONT),
      scar([-34, -11, 20], [-34, 6, 20], FRONT),
      scar([34, -11, 20], [34, 6, 20], FRONT),
      scar([-39, 8, 20], [-20, 8, 20], FRONT),
    ];
    const r = config(parallel, b);
    expect(r.surfaces[0]).toMatchObject({ platforms: ['left', 'top', 'bottom'], centripetal: false });
    expect(traits(r)).toMatchObject({ platform: 'peripheral', polarity: 'multipolar_orthogonal' });
    const oblique = [
      scar([-34, 11, 20], [-40, 1, 20], FRONT),
      scar([34, 11, 20], [40, 1, 20], FRONT),
      scar([-34, -11, 20], [-40, -1, 20], FRONT),
      scar([34, -11, 20], [40, -1, 20], FRONT),
      scar([-39, 8, 20], [-29, -2, 20], FRONT),
    ];
    const m = config(oblique, b);
    expect(m.autoPolarity).toBe('multipolar_multidirectional');
    const fixed = config(oblique, b, { polarity: 'multipolar_centripetal' });
    expect([fixed.autoPolarity, fixed.polarity]).toEqual(['multipolar_multidirectional', 'multipolar_centripetal']);
  });

  it('a cube: the surface type is unclear', () => {
    const r = config([scar([0, 24, 25], [0, 0, 25], FRONT)], box([50, 50, 50]));
    expect(r.surfaces[0].type).toBe('unclear');
  });

  it('without a frame the principal axes give the same traits as the oriented box', () => {
    // the columnar core turned about an oblique axis and moved; its scars turned with it
    const mesh = boxMesh([36, 60, 24], 4);
    const axis = [1, 2, 3].map((x) => x / Math.hypot(1, 2, 3));
    const a = 0.7, c = Math.cos(a), s = Math.sin(a);
    const R = [0, 1, 2].map((i) => [0, 1, 2].map((j) => c * (i === j ? 1 : 0) + (1 - c) * axis[i] * axis[j] + s * [[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]][i][j]));
    const turn = (p: Vec3): Vec3 => R.map((row) => row[0] * p[0] + row[1] * p[1] + row[2] * p[2]) as Vec3;
    const shift: Vec3 = [100, -40, 7];
    const move = (p: Vec3): Vec3 => turn(p).map((x, k) => x + shift[k]) as Vec3;
    const positions = new Float32Array(mesh.positions.length);
    for (let i = 0; i < positions.length; i += 3) positions.set(move([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]), i);
    // the measurer works on positions relative to an offset, as the app does
    const local = positions.map((x, i) => x - shift[i % 3]);
    const base = surfaceMeasures(local, mesh.index);
    const { box: b } = frameMeasures(local, base, null, shift);
    expect(b.frame).toBe('principal');
    expect([0, 1, 2].map((k) => b.max[k] - b.min[k])).toEqual([expect.closeTo(36, 4), expect.closeTo(60, 4), expect.closeTo(24, 4)]);
    const moved = (list: Scar[]) =>
      list.map((x) => ({ ...x, vector: { start: move(x.vector!.start), end: move(x.vector!.end), startNormal: turn(x.vector!.startNormal), endNormal: turn(x.vector!.endNormal) } }));
    for (const list of [columnFront(), [...columnFront(), ...columnBack()]]) expect(traits(config(moved(list), b))).toEqual(traits(config(list, columnBox)));
  });

  it('is null without arrows or without a box', () => {
    expect(computeConfiguration([], emptyCorrections(), columnBox)).toBeNull();
    expect(computeConfiguration(columnFront(), emptyCorrections(), null)).toBeNull();
    // every face unexploited by hand: no flaking surface, no traits
    const none = config(columnFront(), columnBox, { roles: { front: 'none' } });
    expect([none.surfaces.length, none.facialCharacter, none.platformRelation, none.polarity]).toEqual([0, null, null, null]);
    expect(none.scars[0].surface).toBeNull();
  });
});

describe('scars at the edge of a platform', () => {
  // a frustum on the Y axis, wider at the top (radius 25) than at the bottom (15), 60 high
  const frustumBox = box([50, 60, 50]);
  const radius = (y: number) => 15 + (10 * (y + 30)) / 60;
  const unit = (v: Vec3): Vec3 => v.map((x) => x / Math.hypot(...v)) as Vec3;
  const at = (deg: number, y: number): Vec3 => {
    const a = (deg * Math.PI) / 180;
    return [radius(y) * Math.sin(a), y, radius(y) * Math.cos(a)];
  };
  /** The side's outward normal (tilted down, the side leaning in toward the bottom). */
  const side = (deg: number): Vec3 => {
    const a = (deg * Math.PI) / 180;
    return unit([Math.sin(a), -10 / 60, Math.cos(a)]);
  };
  // half way round, from the top: starts on the rim (normal tilted 45° toward +Y) or half way down
  const around = [-70, -35, 0, 35, 70];
  const fromRim = () =>
    around.map((deg) => {
      const s = scar(at(deg, 30), at(deg, 0), side(deg));
      s.vector!.startNormal = unit([Math.sin((deg * Math.PI) / 180), 1, Math.cos((deg * Math.PI) / 180)]);
      return s;
    });
  const fromMiddle = () => around.map((deg) => scar(at(deg, 0), at(deg, -20), side(deg)));
  // small scars on the top, struck in from the edge of the front and of the right
  const onTop = () => [scar([0, 30, 23], [0, 30, 12], [0, 1, 0]), scar([23, 30, 0], [12, 30, 0], [0, 1, 0])].map((s) => ((s.vector!.startNormal = unit(s.vector!.start.map((x, k) => (k === 1 ? 1 : x / 23)) as Vec3)), s));

  it('a frustum worked half way round from the top rim: unifacial, one surface, single platform, unipolar', () => {
    const r = config(fromRim(), frustumBox);
    expect(r.scars.map((s) => [s.face, s.platform])).toEqual([
      ['left', 'top'],
      ['front', 'top'],
      ['front', 'top'],
      ['front', 'top'],
      ['right', 'top'],
    ]);
    expect(r.surfaces.map((s) => [s.faces, s.platforms, s.alsoPlatform])).toEqual([[['front', 'left', 'right'], ['top'], false]]);
    expect(traits(r)).toMatchObject({ facial: 'unifacial', platform: 'single', polarity: 'unipolar_longitudinal' });
  });

  it('the platform follows the arrow, not where it starts (a missing point of percussion)', () => {
    const r = config(fromMiddle(), frustumBox);
    expect(r.scars.every((s) => s.platform === 'top')).toBe(true);
    expect(traits(r)).toMatchObject({ facial: 'unifacial', platform: 'single', polarity: 'unipolar_longitudinal' });
  });

  it('scars on the platform make it both; set as a platform by hand, the scars it bears make no platforms', () => {
    const scars = [...fromRim(), ...onTop()];
    const r = config(scars, frustumBox);
    expect(r.scars.slice(-2).map((s) => [s.face, s.platform])).toEqual([
      ['top', 'front'],
      ['top', 'right'],
    ]);
    expect(r.faces.find((f) => f.face === 'top')).toMatchObject({ autoRole: 'both', role: 'both' });
    expect(r.surfaces.map((s) => [s.faces, s.alsoPlatform])).toEqual([
      [['front', 'left', 'right'], true],
      [['top'], true],
    ]);
    const fixed = config(scars, frustumBox, { roles: { top: 'platform' } });
    expect(fixed.faces.find((f) => f.face === 'front')).toMatchObject({ autoRole: 'flaking', role: 'flaking' });
    expect(fixed.faces.find((f) => f.face === 'top')).toMatchObject({ autoRole: 'both', role: 'platform' });
    expect(fixed.surfaces.map((s) => [s.faces, s.platforms, s.alsoPlatform])).toEqual([[['front', 'left', 'right'], ['top'], false]]);
    expect(traits(fixed)).toMatchObject({ facial: 'unifacial', platform: 'single', polarity: 'unipolar_longitudinal' });
  });

  it('with both normals along the arrow, the end normal decides', () => {
    expect(placeScar(scar([0, 0, 12], [0, -10, 12], [0, -1, 0]).vector!, columnBox).face).toBe('bottom');
  });
});

describe('corrections of the volumetric configuration', () => {
  const setup = () => {
    const store = new ProjectStore();
    for (const s of [...columnFront(), scar([18, 29, 0], [18, 5, 0], RIGHT)]) addScarVector(store, { ...s.vector! });
    const result = () => computeConfiguration(store.state.scars, store.state.configuration, columnBox)!;
    return { store, result };
  };

  it('roles, joins, type, axis and polarity take effect and undo', () => {
    const { store, result } = setup();
    expect(result().surfaces.map((s) => s.faces)).toEqual([['front', 'right']]);
    setConfigJoin(store, 'right', 'front', false);
    expect(store.state.configuration.joins).toEqual({ 'front|right': false });
    expect(result().surfaces.length).toBe(2);
    store.history.undo();
    expect(result().surfaces.length).toBe(1);
    // a face set as a flaking surface by hand, without scars, has no platform
    setConfigRole(store, 'back', 'flaking');
    const r = result();
    expect(r.faces.find((f) => f.face === 'back')).toMatchObject({ autoRole: 'none', role: 'flaking' });
    expect(r.surfaces.find((s) => s.faces.includes('back'))).toMatchObject({ platforms: [], scarIds: [], axis: 'na' });
    expect(r.facialCharacter).toBe('bifacial');
    // type and axis go to every face of the surface; its value is the first face's
    setConfigSurfaceType(store, 'right', 'narrow', ['front', 'right']);
    setConfigAxis(store, 'right', 'short', ['front', 'right']);
    expect(store.state.configuration.surfaceType).toEqual({ front: 'narrow', right: 'narrow' });
    expect(result().surfaces[0]).toMatchObject({ autoType: 'wide', type: 'narrow', autoAxis: 'long', axis: 'short' });
    setConfigPolarity(store, 'bipolar_orthogonal');
    expect([result().autoPolarity, result().polarity]).toEqual(['unipolar_longitudinal', 'bipolar_orthogonal']);
    // reset: the face's role, the surface's type and axis, the joins with it
    setConfigJoin(store, 'front', 'right', true);
    resetConfigFace(store, 'front', ['front', 'right']);
    expect(store.state.configuration).toEqual({ roles: { back: 'flaking' }, joins: {}, surfaceType: {}, axis: {}, polarity: 'bipolar_orthogonal', model: 'box', bicone: { roles: {} } });
  });

  it('a new orientation clears the corrections by face in the same step; undo brings them back', () => {
    const { store } = setup();
    setConfigRole(store, 'top', 'both');
    setConfigJoin(store, 'front', 'right', false);
    setConfigPolarity(store, 'bipolar_opposed');
    const before = structuredClone(store.state.configuration);
    // other specimen fields leave them
    expect(updateSpecimen(store, { notes: 'x' }, false)).toBe(false);
    expect(store.state.configuration).toEqual(before);
    const frame = { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], source: 'view' };
    expect(updateSpecimen(store, { frame }, false)).toBe(true);
    expect(store.state.configuration).toEqual({ roles: {}, joins: {}, surfaceType: {}, axis: {}, polarity: 'bipolar_opposed', model: 'box', bicone: { roles: {} } });
    store.history.undo();
    expect(store.state.specimen.frame).toBeNull();
    expect(store.state.configuration).toEqual(before);
    store.history.redo();
    expect(store.state.configuration.roles).toEqual({});
    // turning in small steps (merged): cleared once, one undo step restores everything
    store.history.undo();
    updateSpecimen(store, { frame }, true);
    updateSpecimen(store, { frame: { ...frame, matrix: [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } }, true);
    store.history.undo();
    expect(store.state.configuration).toEqual(before);
    // clearing the frame is a new orientation too
    setConfigRole(store, 'top', 'both');
    updateSpecimen(store, { frame }, false);
    setConfigRole(store, 'top', 'both');
    expect(updateSpecimen(store, { frame: null }, false)).toBe(true);
    expect(store.state.configuration.roles).toEqual({});
  });

  it('round-trips through the project file; older files have none', () => {
    const { store } = setup();
    setConfigRole(store, 'back', 'platform');
    setConfigJoin(store, 'front', 'right', false);
    setConfigSurfaceType(store, 'front', 'wide');
    setConfigAxis(store, 'front', 'short');
    setConfigPolarity(store, 'multipolar_orthogonal');
    const file = serializeProject(store.state, 'test', { measurements: null, vertices: null, box: columnBox });
    expect(file.configuration).toEqual(store.state.configuration);
    expect(file.derived.configuration).toMatchObject({ frame: 'specimen', min: [-18, -30, -12], max: [18, 30, 12], polarity: 'multipolar_orthogonal' });
    expect(parseProjectFile(JSON.parse(JSON.stringify(file))).configuration).toEqual(store.state.configuration);
    // unknown faces and codes are dropped
    const raw = JSON.parse(JSON.stringify(file));
    raw.configuration = { roles: { front: 'flaking', side: 'flaking', top: 'edge' }, joins: { 'right|front': true, 'front|back': true, 'front|top': 1 }, polarity: 'radial' };
    expect(parseProjectFile(raw).configuration).toEqual({ roles: { front: 'flaking' }, joins: {}, surfaceType: {}, axis: {}, polarity: null, model: 'box', bicone: { roles: {} } });
    delete raw.configuration;
    expect(parseProjectFile(raw).configuration).toEqual(emptyCorrections());
    // no box (mesh not measured): no derived configuration
    expect(serializeProject(store.state, 'test').derived.configuration).toBeNull();
  });
});

describe('configuration CSV', () => {
  it('one row per specimen, one per flaking surface, and two columns of the arrow CSV', () => {
    const store = new ProjectStore();
    updateSpecimen(store, { id: 'C1' });
    for (const s of [...columnFront(), ...columnBack()]) addScarVector(store, { ...s.vector! });
    const r = computeConfiguration(store.state.scars, store.state.configuration, columnBox);
    const opts = { excelBom: false };
    expect(configurationCsv(store.state, r, opts)).toBe(
      'specimen_id,model,frame,facial_character,flaking_surface_relation,platform_relation,polarity\nC1,box,specimen,bifacial,opposite,opposite,bipolar_opposed\n',
    );
    expect(flakingSurfacesCsv(store.state, r, opts)).toBe(
      'specimen_id,surface_id,faces,platforms,also_platform,n_scars,surface_type,exploitation_axis\nC1,F1,front,top,false,3,wide,long\nC1,F2,back,bottom,false,1,wide,long\n',
    );
    const rows = scarVectorCsv(store.state, opts, r).trim().split('\n');
    expect(rows[0].endsWith(',note,platform_face,flaking_surface,unit,tech_angle_deg')).toBe(true);
    expect(rows.slice(1).map((l) => l.split(',').slice(-4, -1).join(','))).toEqual(['top,F1,mm', 'top,F1,mm', 'top,F1,mm', 'bottom,F2,mm']);
    // without a configuration (no mesh measured): the values are empty
    expect(configurationCsv(store.state, null, opts).split('\n')[1]).toBe('C1,box,,,,,');
    expect(scarVectorCsv(store.state, opts).split('\n')[1].endsWith(',,,mm,')).toBe(true);
  });
});

describe('box of the volumetric configuration', () => {
  it('comes from the pass that measures length, width and thickness, in original coordinates', () => {
    const mesh = boxMesh([36, 60, 24], 2);
    const base = surfaceMeasures(mesh.positions, mesh.index);
    // a frame turned a quarter on the page: X along the model's −Y, Y along its X
    const frame = { matrix: [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], source: 'view' };
    const { auto, box: b } = frameMeasures(mesh.positions, base, frame, [5, 0, 0]);
    expect([auto.length, auto.width, auto.thickness]).toEqual([36, 60, 24]);
    expect(b).toEqual({
      frame: 'specimen',
      axes: [
        [0, -1, 0],
        [1, 0, 0],
        [0, 0, 1],
      ],
      min: [-30, -13, -12],
      max: [30, 23, 12],
    });
    // the principal box is right-handed: X = Y × Z
    const p = frameMeasures(mesh.positions, base, null).box;
    const [x, y, z] = p.axes;
    const cross = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
    cross.forEach((v, k) => expect(v).toBeCloseTo(x[k], 9));
  });
});

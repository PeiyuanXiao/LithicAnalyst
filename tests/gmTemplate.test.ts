import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { gmAnchorRows, gmListTotal, gmMissingInputs, gmPoints, gmTotal, type GmResult } from '../src/compute/gm';
import { anchorsHashOf, FLAKE_TEMPLATE_PATCHES, gmCacheKey, gmConfigSummary, gmInUse, gmManifest, gmStanding, GM_TEMPLATE_PARAMETERS, layPatch, regionsHashOf, sameGmConfig, usesTemplate } from '../src/compute/gmTemplate';
import { buildEdges } from '../src/compute/meshGeometry';
import { gmOfProjectSteps, projectLayersSteps, regionSourceOf } from '../src/compute/projectRegions';
import { runSync } from '../src/compute/steps';
import { triangleBvhSteps } from '../src/compute/triangleBvh';
import { addCurve, addLandmark, addRegion, addSemilandmarkSet, deleteRegion, placePlatformEnd, setCurveAttribute, setGmConfig, setSpecimenType, setTechnicalAxis } from '../src/core/actions';
import { annotationStatus } from '../src/core/annotationStatus';
import { frameMatrix } from '../src/core/frame';
import { parseGmConfig, parseProjectFile, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import { defaultGmConfig, GM_CONFIG_VERSION, type GmConfig, type MeshInfo, type ProjectState, type Vec3 } from '../src/core/types';
import { gmOutputs, type BatchSpecimen } from '../src/io/batch';
import { gmCurvesCsv, gmLandmarksCsv, gmModelsCsv, gmOutlines, gmOutlinesCsv, gmSmvectorCsv, gmSurfacesCsv, gmSurpCsv, landmarksCsv, landmarksFcsv, landmarksTps } from '../src/io/landmarks';
import { GM_CONFIG_FILE, SHARP_EDGE_FILE, workspaceFromFiles } from '../src/io/workspace';
import { flakeT1, mapped, rigid, T1, type Mesh } from './meshes';

const shape = (points: Vec3[], closed: boolean) => ({ anchors: points, points, anchorIndex: points.map((_, i) => i), closed });
const gap = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const meshInfo = (sha256: string): MeshInfo => ({ fileName: `${sha256}.ply`, format: 'ply', fileSize: 1, sha256, vertexCount: 1, triangleCount: 1, bboxMin: [0, 0, 0], bboxMax: [1, 1, 1] });
const storeOn = (sha256: string): ProjectStore => new ProjectStore({ ...emptyProject(), mesh: meshInfo(sha256) });

/** What a specimen's points need of its mesh. */
type Surface = Pick<Mesh, 'index'> & { positions: ArrayLike<number> };

/** A dome over a disc (a closed mesh, in doubles: the checks below go finer than a float's step at this size): a rim at z = 0, a top face and a bottom face between which it is split. In rings and spokes, fine enough to carry a few hundred points. */
function dome(f: (p: Vec3) => Vec3 = (p) => p): Surface & { rim: Vec3[] } {
  const rings = 24, spokes = 72, R = 30, H = 8;
  const positions: number[] = [];
  const index: number[] = [];
  const add = (p: Vec3) => positions.push(...f(p));
  const top = (r: number, a: number): Vec3 => [r * Math.cos(a), r * Math.sin(a), H * (1 - (r / R) ** 2)];
  const under = (r: number, a: number): Vec3 => [r * Math.cos(a), r * Math.sin(a), -0.5 * H * (1 - (r / R) ** 2)];
  // the top: the pole, rings out to the rim; the rim is shared; the bottom: rings in to its pole
  add(top(0, 0));
  for (let i = 1; i <= rings; i++) for (let j = 0; j < spokes; j++) add(top((R * i) / rings, (2 * Math.PI * j) / spokes));
  for (let i = rings - 1; i >= 1; i--) for (let j = 0; j < spokes; j++) add(under((R * i) / rings, (2 * Math.PI * j) / spokes));
  add(under(0, 0));
  const at = (ring: number, j: number) => 1 + (ring - 1) * spokes + ((j + spokes) % spokes);
  const last = 2 * rings - 1;
  for (let j = 0; j < spokes; j++) index.push(0, at(1, j), at(1, j + 1));
  for (let i = 1; i < last; i++) for (let j = 0; j < spokes; j++) {
    index.push(at(i, j), at(i + 1, j), at(i + 1, j + 1));
    index.push(at(i, j), at(i + 1, j + 1), at(i, j + 1));
  }
  const pole = positions.length / 3 - 1;
  for (let j = 0; j < spokes; j++) index.push(pole, at(last, j + 1), at(last, j));
  const rim: Vec3[] = Array.from({ length: spokes }, (_, j) => f(top(R, (2 * Math.PI * j) / spokes)));
  return { positions: Float64Array.from(positions), index: Uint32Array.from(index), rim };
}

const onTop = (x: number, y: number, f: (p: Vec3) => Vec3): Vec3 => f([x, y, 8 * (1 - (x * x + y * y) / 900)]);

/** A generic specimen on the dome: four landmarks, the rim as a closed curve through them, a region on either side of it. */
function domeProject(m: ReturnType<typeof dome>, f: (p: Vec3) => Vec3, sha: string, config: Partial<GmConfig> = {}): ProjectStore {
  const s = storeOn(sha);
  setSpecimenType(s, 'generic');
  const names: Array<[string, number]> = [['east', 0], ['north', 18], ['west', 36], ['south', 54]];
  for (const [name, j] of names) addLandmark(s, m.rim[j], name);
  // the two poles, off the plane of the rim
  addLandmark(s, f([0, 0, 8]), 'top');
  addLandmark(s, f([0, 0, -4]), 'bottom');
  const c = addCurve(s, shape(m.rim, true));
  setCurveAttribute(s, c.id, 'type', 'rim');
  addRegion(s, onTop(1, 1, f), 'cap', null);
  addRegion(s, f([1, 1, -0.5 * 8 * (1 - 2 / 900)]), 'base', null);
  setGmConfig(s, {
    landmarks: names.map(([name]) => ({ name })),
    curves: [{ curveType: 'rim', count: 25, closed: true, start: 'east', via: 'north' }],
    patches: [{ regionType: 'cap', count: 60 }, { regionType: 'base', count: 40 }],
    ...config,
  });
  return s;
}

const edgesOf = (m: Surface) => buildEdges(m.index, m.positions.length / 3);
const layersOf = (st: ProjectState, m: Surface, o: Vec3 = [0, 0, 0]) => runSync(projectLayersSteps(st, { positions: m.positions, index: m.index, offset: o }));

/** Lay the points of the configuration on this specimen: it is the template. */
function makeTemplate(s: ProjectStore, m: Surface, seed = 1): void {
  const st = s.state;
  const source = regionSourceOf(st, layersOf(st, m), m.positions, m.index, new Map());
  const patches = st.gm.patches.map((p, i) => {
    const f = source.find(p.regionType);
    if ('reason' in f) throw new Error(f.reason);
    const laid = layPatch(m.positions, m.index, edgesOf(m), f.faces, p.count, seed + i);
    if (!laid) throw new Error('too small');
    return { regionType: p.regionType, points: laid.points };
  });
  const anchors = gmAnchorRows(st).rows.map((r) => r.point);
  setGmConfig(s, { template: { file: 'template.ply', sha256: st.mesh!.sha256, seed, patches, anchors, anchorsHash: anchorsHashOf(anchors), regionsHash: regionsHashOf(st) } });
}

const pointsOf = (st: ProjectState, m: Surface, available = true): GmResult => runSync(gmOfProjectSteps(st, { positions: m.positions, index: m.index, offset: [0, 0, 0] }, available));

/** A smooth bend of the whole thing. */
const bend = (p: Vec3): Vec3 => [p[0] + 0.03 * p[1] * Math.sin(p[1] / 25), p[1] + 2 * Math.sin(p[0] / 40), p[2] + 0.002 * p[0] * p[0]];
const stretchAndTurn = (p: Vec3): Vec3 => rigid([1, 2, 3], 30, [5, -7, 11])([1.2 * p[0], p[1], p[2]]);

describe('laying the points', () => {
  const m = dome();
  const edges = edgesOf(m);
  const capFaces = () => {
    const out: number[] = [];
    for (let t = 0; 3 * t < m.index.length; t++) if ([0, 1, 2].every((k) => m.positions[3 * m.index[3 * t + k] + 2] >= -1e-6)) out.push(t);
    return Uint32Array.from(out);
  };

  it('the same seed, the same points; another seed, others', () => {
    const a = layPatch(m.positions, m.index, edges, capFaces(), 80, 1)!;
    const b = layPatch(m.positions, m.index, edges, capFaces(), 80, 1)!;
    const c = layPatch(m.positions, m.index, edges, capFaces(), 80, 2)!;
    expect(a.points).toEqual(b.points);
    expect(a.points).not.toEqual(c.points);
  });

  it('as many as asked for, each on a triangle of the region, as far from its boundary as asked', () => {
    for (const count of [GM_TEMPLATE_PARAMETERS.PATCH_MIN, 100, 400]) {
      const faces = capFaces();
      const laid = layPatch(m.positions, m.index, edges, faces, count, 7)!;
      expect(laid.points).toHaveLength(count);
      const inside = new Set(faces);
      const R = 30;
      for (const p of laid.points) {
        expect(inside.has(p.face)).toBe(true);
        expect(p.bary[0] + p.bary[1] + p.bary[2]).toBeCloseTo(1, 9);
        // the point is where its triangle and place say
        const at: Vec3 = [0, 1, 2].map((k) => p.bary[0] * m.positions[3 * m.index[3 * p.face] + k] + p.bary[1] * m.positions[3 * m.index[3 * p.face + 1] + k] + p.bary[2] * m.positions[3 * m.index[3 * p.face + 2] + k]) as Vec3;
        expect(gap(at, p.point)).toBeLessThan(1e-5);
        // the boundary of the cap is the circle r = R at z = 0
        const toRim = R - Math.hypot(p.point[0], p.point[1]);
        expect(Math.hypot(toRim, p.point[2])).toBeGreaterThanOrEqual(GM_TEMPLATE_PARAMETERS.BOUNDARY_SHARE * laid.spacing - 1e-3);
      }
      expect(laid.spacing).toBeCloseTo(Math.sqrt(laid.area / count), 9);
    }
  });

  it('evenly: no two much nearer than the spacing the area gives', () => {
    const laid = layPatch(m.positions, m.index, edges, capFaces(), 100, 3)!;
    let least = Infinity;
    laid.points.forEach((p, i) => laid.points.forEach((q, j) => {
      if (i < j) least = Math.min(least, gap(p.point, q.point));
    }));
    expect(least).toBeGreaterThan(0.6 * laid.spacing);
  });

  it('a region narrower than the margin holds no points, and says so', () => {
    const ring = capFaces().filter((t) => [0, 1, 2].every((k) => Math.hypot(m.positions[3 * m.index[3 * t + k]], m.positions[3 * m.index[3 * t + k] + 1]) > 28.7));
    expect(ring.length).toBeGreaterThan(0);
    expect(layPatch(m.positions, m.index, edges, ring, GM_TEMPLATE_PARAMETERS.PATCH_MIN, 1)).toBeNull();
  });
});

describe('the configuration', () => {
  it('a folder\'s own settings are there to read when it is opened, and are no model or project of it', async () => {
    const file = (path: string, text: string) => Object.defineProperty(new File([text], path.split('/').pop()!), 'webkitRelativePath', { value: `dig/${path}` });
    const ws = workspaceFromFiles([file('a.ply', 'x'), file(GM_CONFIG_FILE, '{"a":1}'), file(SHARP_EDGE_FILE, '{"b":2}'), file('LithicAnalyst/other.json', '{}'), file('LithicAnalyst/projects/a.ply.lithicanalyst.json', '{}')])!;
    expect(ws.meshes).toEqual(['a.ply']);
    expect(ws.projects).toEqual(['LithicAnalyst/projects/a.ply.lithicanalyst.json']);
    expect(await ws.exists(GM_CONFIG_FILE)).toBe(true);
    expect(await (await ws.read(GM_CONFIG_FILE)).text()).toBe('{"a":1}');
    expect(await (await ws.read(SHARP_EDGE_FILE)).text()).toBe('{"b":2}');
    await expect(ws.read('LithicAnalyst/other.json')).rejects.toThrow();
  });

  it('reads an older file as it was: the grid, empty lists, this version', () => {
    const old = { fixed: { pop: true, platform_left: false, platform_right: true }, edge: { on: true, points: 12 }, platformOutline: { on: false, points: 5 }, ventral: { on: true, rows: 2, cols: 3 }, dorsal: { on: true, rows: 1, cols: 1 }, platform: { on: false, rows: 1, cols: 1 } };
    const c = parseGmConfig(old);
    expect(c).toEqual({ ...defaultGmConfig(), ...old });
    expect(c.version).toBe(GM_CONFIG_VERSION);
    expect(c.surfaceMethod).toBe('grid');
  });

  it('keeps the lists, the method and the template through a file, in their order', () => {
    const m = dome();
    const s = domeProject(m, (p) => p, 'aaa');
    makeTemplate(s, m);
    const again = parseProjectFile(JSON.parse(JSON.stringify(serializeProject(s.state, '0.1.0'))));
    expect(again.gm).toEqual(s.state.gm);
    expect(again.gm.patches.map((p) => p.regionType)).toEqual(['cap', 'base']);
    expect(again.gm.curves[0]).toEqual({ curveType: 'rim', count: 25, closed: true, start: 'east', via: 'north' });
    // the results keep how many points were laid, not the points again
    const derived = serializeProject(s.state, '0.1.0', { measurements: null, vertices: null, gm: pointsOf(s.state, m) }).derived.gm!;
    expect(derived.config.template).toMatchObject({ file: 'template.ply', seed: 1, points: 100 });
    expect('patches' in derived.config.template!).toBe(false);
  });

  it('a count out of its range takes the default; what makes no sense goes', () => {
    const c = parseGmConfig({ patches: [{ regionType: 'a', count: 5 }, { regionType: 'b', count: 99999 }, { regionType: 'c', count: 300 }], template: { file: 'x', patches: 'no', anchors: [] }, landmarks: 'no', curves: [null, 7] });
    expect(c.patches.map((p) => p.count)).toEqual([GM_TEMPLATE_PARAMETERS.PATCH_DEFAULT, GM_TEMPLATE_PARAMETERS.PATCH_DEFAULT, 300]);
    expect(c.template).toBeNull();
    expect(c.landmarks).toEqual([]);
    expect(c.curves).toEqual([]);
  });

  it('counts: a curve\'s ends are single points, a loop\'s two ends one', () => {
    const c: GmConfig = { ...defaultGmConfig(), landmarks: [{ name: 'a' }, { name: 'b' }], curves: [{ curveType: 'x', count: 10, start: 'a', end: 'b' }, { curveType: 'y', count: 8, closed: true, start: 'a', via: 'b' }, { curveType: 'z', count: 5, start: 'c', end: 'a' }], patches: [{ regionType: 'r', count: 100 }] };
    // a, b; c (new); 8 + 6 + 3 between; the patch
    expect(gmListTotal(c)).toBe(3 + 8 + 6 + 3 + 100);
    expect(gmTotal({ ...defaultGmConfig(), surfaceMethod: 'template', patches: FLAKE_TEMPLATE_PATCHES() })).toBe(3 + 48 + 24 + 332);
  });

  it('stored points stand by the same configuration, however its fields were written', () => {
    const c: GmConfig = { ...defaultGmConfig(), landmarks: [{ name: 'a' }], curves: [{ curveType: 'x', count: 5, closed: true, start: 'a', via: 'b' }], patches: [{ regionType: 'r', count: 10 }] };
    const written = JSON.parse(JSON.stringify(gmConfigSummary(c)));
    expect(sameGmConfig(written, c)).toBe(true);
    expect(sameGmConfig(written, { ...c, curves: [{ count: 5, curveType: 'x', via: 'b', start: 'a', closed: true }] })).toBe(true);
    expect(sameGmConfig(written, { ...c, patches: [{ regionType: 'r', count: 11 }] })).toBe(false);
    expect(sameGmConfig(written, { ...c, surfaceMethod: 'template' })).toBe(false);
    const laid = { file: 'a.ply', sha256: 'x', seed: 1, patches: [], anchors: [], anchorsHash: '', regionsHash: '' };
    expect(sameGmConfig(gmConfigSummary({ ...c, template: laid }), { ...c, template: { ...laid, seed: 2 } })).toBe(false);
    expect(gmStanding(null)).toEqual({ done: false, flagged: 0 });
    expect(gmStanding({ complete: true })).toEqual({ done: true, flagged: 0 });
    expect(gmStanding({ complete: true, flagged: [3, 4] })).toEqual({ done: false, flagged: 2 });
  });

  it('a result saved before the lists has the grid\'s fields alone, and is compared by those', () => {
    const d = defaultGmConfig();
    const { fixed, edge, platformOutline, ventral, dorsal, platform } = d;
    const old = JSON.parse(JSON.stringify({ fixed, edge, platformOutline, ventral, dorsal, platform }));
    expect(sameGmConfig(old, d)).toBe(true);
    expect(sameGmConfig(old, { ...d, platform: { on: true, rows: 7, cols: 10 } })).toBe(false);
    expect(sameGmConfig(old, { ...d, surfaceMethod: 'template' })).toBe(false);
    expect(sameGmConfig(old, { ...d, patches: [{ regionType: 'r', count: 10 }] })).toBe(false);
  });

  it('which is in use, and how the surfaces go', () => {
    const d = defaultGmConfig();
    expect(gmInUse(d, 'core')).toBe(false);
    expect(gmInUse(d, 'generic')).toBe(false);
    expect(gmInUse(d, 'flake')).toBe(false);
    expect(gmInUse({ ...d, patches: [{ regionType: 'a', count: 10 }] }, 'generic')).toBe(true);
    expect(gmInUse({ ...d, surfaceMethod: 'template' }, 'flake')).toBe(true);
    expect(gmInUse({ ...d, edge: { on: true, points: 9 } }, 'flake')).toBe(true);
    expect(usesTemplate(d, 'flake')).toBe(false);
    expect(usesTemplate(d, 'generic')).toBe(true);
    expect(usesTemplate({ ...d, surfaceMethod: 'template' }, 'flake')).toBe(true);
    expect(gmManifest(d, false)).toEqual({ surfaceMethod: 'grid', configVersion: GM_CONFIG_VERSION, template: null, seed: null });
    expect(gmManifest(d, true).surfaceMethod).toBe('template');
    expect(gmConfigSummary(d).template).toBeNull();
  });
});

describe('a specimen by the lists', () => {
  const f = (p: Vec3) => p;

  it('the rows in the order of the configuration: landmarks, a loop that goes by the via and closes on its start, the patches', () => {
    const m = dome();
    const s = domeProject(m, f, 'aaa');
    makeTemplate(s, m);
    const r = pointsOf(s.state, m);
    expect(r.complete).toBe(true);
    expect(r.method).toBe('template');
    expect(r.rows.slice(0, 4).map((x) => [x.name, x.kind])).toEqual([['east', 'fixed'], ['north', 'fixed'], ['west', 'fixed'], ['south', 'fixed']]);
    const curve = r.rows.filter((x) => x.kind === 'curve');
    expect(curve).toHaveLength(23);
    expect(curve.map((x) => x.name)).toEqual(curve.map(() => 'rim'));
    expect(curve.map((x) => x.setIndex)).toEqual(curve.map((_, i) => i + 1));
    // from east toward north: the first point after the start lies on the +y side
    expect(curve[0].point[1]).toBeGreaterThan(0);
    // equally spaced, round to the start
    const pts = [r.rows[0].point, ...curve.map((x) => x.point), r.rows[0].point];
    const steps = pts.slice(1).map((p, i) => gap(p, pts[i]));
    for (const d of steps) expect(d).toBeCloseTo(steps[0], 1);
    // the sliding definition goes round, ends on the start, and the start does not slide
    expect(r.curves[0][0]).toBe(1);
    expect(r.curves[r.curves.length - 1][2]).toBe(1);
    expect(r.curves.map((c) => c[1])).not.toContain(1);
    expect(r.surfaces).toHaveLength(100);
    expect(r.rows.filter((x) => x.kind === 'surface').map((x) => x.name)).toEqual([...new Array(60).fill('cap'), ...new Array(40).fill('base')]);
  });

  it('the way round is by the via: by south it goes the other way', () => {
    const m = dome();
    const s = domeProject(m, f, 'aaa', { curves: [{ curveType: 'rim', count: 25, closed: true, start: 'east', via: 'south' }], patches: [] });
    const r = pointsOf(s.state, m);
    expect(r.rows.filter((x) => x.kind === 'curve')[0].point[1]).toBeLessThan(0);
  });

  it('an open curve from one landmark to another, on the shorter way, its ends the landmarks themselves', () => {
    const m = dome();
    const s = domeProject(m, f, 'aaa', { curves: [{ curveType: 'rim', count: 7, start: 'east', end: 'north' }], patches: [] });
    const r = pointsOf(s.state, m);
    expect(r.rows).toHaveLength(4 + 5);
    expect(r.curves).toEqual([[1, 5, 6], [5, 6, 7], [6, 7, 8], [7, 8, 9], [8, 9, 2]]);
    expect(gmOutlines(r.curves)).toEqual([[1, 5, 6, 7, 8, 9, 2]]);
    for (const x of r.rows.slice(4)) expect(x.point[0] > 0 && x.point[1] > 0).toBe(true);
  });

  it('an end landmark not itself listed is written once, where it is first needed', () => {
    const m = dome();
    const s = domeProject(m, f, 'aaa', { landmarks: [{ name: 'east' }], curves: [{ curveType: 'rim', count: 3, start: 'east', end: 'west' }, { curveType: 'rim', count: 3, start: 'west', end: 'east' }], patches: [] });
    const r = pointsOf(s.state, m);
    expect(r.rows.map((x) => x.name)).toEqual(['east', 'rim', 'rim', 'rim']);
    expect(r.curves).toEqual([[1, 2, 3], [3, 4, 1]]);
  });

  it('what lacks is written as missing, and says what by name; every specimen has the same rows', () => {
    const m = dome();
    const full = domeProject(m, f, 'aaa');
    makeTemplate(full, m);
    const n = pointsOf(full.state, m).rows.length;
    const s = storeOn('bbb');
    setSpecimenType(s, 'generic');
    setGmConfig(s, full.state.gm);
    addLandmark(s, m.rim[0], 'east');
    const r = pointsOf(s.state, m);
    expect(r.complete).toBe(false);
    expect(r.rows).toHaveLength(n);
    expect(r.rows[0].missing).toBeUndefined();
    expect(r.rows[1].missing).toBe(true);
    expect(r.missing).toEqual(expect.arrayContaining(['landmark_missing', 'curve_missing', 'too_few_anchors']));
    expect(r.details).toEqual(expect.arrayContaining([{ code: 'landmark_missing', name: 'north' }, { code: 'curve_missing', name: 'rim' }]));
    expect(gmMissingInputs(s.state)).toEqual(expect.arrayContaining(['landmark_missing', 'curve_missing']));
    // NA in the coordinates, and in every file alike
    const csv = gmLandmarksCsv(s.state, r, { excelBom: false }).trim().split('\n');
    expect(csv[0]).toBe('specimen_id,index,name,kind,set_id,x,y,z,set_index,flagged');
    expect(csv[2].split(',').slice(5, 8)).toEqual(['NA', 'NA', 'NA']);
    expect(landmarksTps(s.state, r).split('\n')[2]).toBe('NA NA NA');
    expect(landmarksFcsv(r).split('\n')[4].split(',').slice(1, 4)).toEqual(['NA', 'NA', 'NA']);
  });

  it('two of a kind cannot be told apart: the item is left out, and says why', () => {
    const m = dome();
    const s = domeProject(m, f, 'aaa', { patches: [] });
    addLandmark(s, m.rim[9], 'east');
    const c = addCurve(s, shape(m.rim.slice(0, 10), true));
    setCurveAttribute(s, c.id, 'type', 'rim');
    const r = pointsOf(s.state, m);
    expect(r.details).toEqual(expect.arrayContaining([{ code: 'landmark_ambiguous', name: 'east' }, { code: 'curve_ambiguous', name: 'rim' }]));
    expect(r.rows[0].missing).toBe(true);
  });
});

describe('passing the points on', () => {
  const same = (p: Vec3) => p;

  it('the codes: no template, too few anchors, a region missing or doubled, the template gone or stale', () => {
    const m = dome();
    const t = domeProject(m, same, 'aaa');
    expect(pointsOf(t.state, m).missing).toContain('no_template');
    makeTemplate(t, m);
    const other = () => {
      const s = domeProject(m, same, 'bbb');
      setGmConfig(s, { template: t.state.gm.template });
      return s;
    };
    expect(pointsOf(other().state, m, false).missing).toContain('template_missing');
    // the template itself is not affected: its points are as laid
    expect(pointsOf(t.state, m, false).complete).toBe(true);

    const few = domeProject(m, same, 'bbb', { landmarks: [{ name: 'east' }, { name: 'north' }, { name: 'west' }], curves: [] });
    setGmConfig(few, { template: t.state.gm.template });
    expect(pointsOf(few.state, m).missing).toContain('template_stale');
    const lacking = other();
    expect(pointsOf({ ...lacking.state, landmarks: lacking.state.landmarks.slice(0, 2), curves: [] }, m).missing).toContain('too_few_anchors');

    const noRegion = other();
    deleteRegion(noRegion, noRegion.state.regions.find((r) => r.type === 'base')!.id);
    const r1 = pointsOf(noRegion.state, m);
    expect(r1.missing).toContain('region_missing');
    expect(r1.details).toContainEqual({ code: 'region_missing', name: 'base' });
    // the patch it has is there, the other written as missing
    expect(r1.rows.filter((x) => x.name === 'cap' && !x.missing)).toHaveLength(60);
    expect(r1.rows.filter((x) => x.name === 'base' && x.missing)).toHaveLength(40);

    const two = other();
    // a second curve parts the cap: two pieces of one type
    const inner = addCurve(two, shape(Array.from({ length: 24 }, (_, j) => onTop(15 * Math.cos((2 * Math.PI * j) / 24), 15 * Math.sin((2 * Math.PI * j) / 24), same)), true));
    setCurveAttribute(two, inner.id, 'type', 'ring');
    addRegion(two, onTop(20, 0, same), 'cap', null);
    expect(pointsOf(two.state, m).details).toContainEqual({ code: 'region_ambiguous', name: 'cap' });

    // the configuration changed since it was laid
    const changed = other();
    setGmConfig(changed, { patches: [{ regionType: 'cap', count: 61 }, { regionType: 'base', count: 40 }] });
    expect(pointsOf(changed.state, m).missing).toContain('template_stale');
  });

  it('a stretched and turned copy, its landmarks and regions with it: the points go exactly the same way, none flagged', () => {
    const lists = { landmarks: ['east', 'north', 'west', 'south', 'top', 'bottom'].map((name) => ({ name })), curves: [] };
    const t = dome();
    const template = domeProject(t, same, 'aaa', lists);
    makeTemplate(template, t);
    const m = dome(stretchAndTurn);
    const s = domeProject(m, stretchAndTurn, 'bbb', lists);
    setGmConfig(s, { template: template.state.gm.template });
    const r = pointsOf(s.state, m);
    expect(r.complete).toBe(true);
    expect(r.flagged).toEqual([]);
    const laid = template.state.gm.template!.patches.flatMap((p) => p.points);
    const carried = r.rows.filter((x) => x.kind === 'surface');
    expect(carried).toHaveLength(laid.length);
    carried.forEach((x, i) => expect(gap(x.point, stretchAndTurn(laid[i].point))).toBeLessThan(1e-6));
  });

  it('a curve among the anchors is spaced evenly on each specimen, so not an affine copy: near, still none flagged', () => {
    const t = dome();
    const template = domeProject(t, same, 'aaa');
    makeTemplate(template, t);
    const m = dome(stretchAndTurn);
    const s = domeProject(m, stretchAndTurn, 'bbb');
    setGmConfig(s, { template: template.state.gm.template });
    const r = pointsOf(s.state, m);
    expect(r.complete).toBe(true);
    expect(r.flagged).toEqual([]);
    const laid = template.state.gm.template!.patches.flatMap((p) => p.points);
    r.rows.filter((x) => x.kind === 'surface').forEach((x, i) => expect(gap(x.point, stretchAndTurn(laid[i].point))).toBeLessThan(2));
  });

  it('a smoothly bent copy: every point on its region, none flagged', () => {
    const t = dome();
    const template = domeProject(t, same, 'aaa');
    makeTemplate(template, t);
    const m = dome(bend);
    const s = domeProject(m, bend, 'bbb');
    setGmConfig(s, { template: template.state.gm.template });
    const r = pointsOf(s.state, m);
    expect(r.complete).toBe(true);
    expect(r.flagged).toEqual([]);
    const layers = layersOf(s.state, m);
    const source = regionSourceOf(s.state, layers, m.positions, m.index, new Map());
    for (const type of ['cap', 'base']) {
      const found = source.find(type);
      if ('reason' in found) throw new Error(found.reason);
      const tree = runSync(triangleBvhSteps(m.positions, m.index, found.faces));
      for (const x of r.rows.filter((q) => q.kind === 'surface' && q.name === type)) expect(tree.closest(x.point)!.distance).toBeLessThan(1e-4);
    }
    // the other side of the rim is another region: the two lie apart
    const up = r.rows.filter((x) => x.name === 'cap').map((x) => x.point);
    expect(Math.min(...up.map((p) => p[2] - bend([p[0], p[1], 0])[2]))).toBeGreaterThan(-1);
  });

  it('a point sent far off its region is flagged, never moved or left out', () => {
    const t = dome();
    const template = domeProject(t, same, 'aaa');
    makeTemplate(template, t);
    // the anchors as ever, the regions cut far down: a little patch for all those points
    const s = domeProject(t, same, 'bbb');
    setGmConfig(s, { template: template.state.gm.template });
    const inner = addCurve(s, shape(Array.from({ length: 24 }, (_, j) => onTop(5 * Math.cos((2 * Math.PI * j) / 24), 5 * Math.sin((2 * Math.PI * j) / 24), same)), true));
    setCurveAttribute(s, inner.id, 'type', 'ring');
    const r = pointsOf(s.state, t);
    expect(r.flagged!.length).toBeGreaterThan(10);
    expect(r.complete).toBe(true);
    for (const n of r.flagged!) expect(r.rows[n - 1].flagged).toBe(true);
    expect(r.rows.filter((x) => x.name === 'cap')).toHaveLength(60);
    // the check says so in the status, and in the table
    const status = annotationStatus(s.state, null, r).items.find((i) => i.key === 'gm')!;
    expect(status).toMatchObject({ done: false, optional: true, flagged: r.flagged!.length });
    const csv = gmLandmarksCsv(s.state, r, { excelBom: false }).trim().split('\n').slice(1);
    expect(csv.filter((l) => l.endsWith(',1'))).toHaveLength(r.flagged!.length);
  });

  it('the status has no GM until points are asked for, and it does not count', () => {
    const s = new ProjectStore(emptyProject());
    setSpecimenType(s, 'generic');
    expect(annotationStatus(s.state).items.map((i) => i.key)).toEqual(['unit']);
    setGmConfig(s, { landmarks: [{ name: 'a' }] });
    const st = annotationStatus(s.state, null, { complete: true });
    expect(st.items.map((i) => i.key)).toEqual(['unit', 'gm']);
    expect(st.items[1]).toMatchObject({ done: true, optional: true });
    expect(st.total).toBe(1);
  });

  it('what a stored result was made from: another template point, anchor, region or mesh, and it no longer stands', () => {
    const m = dome();
    const s = domeProject(m, same, 'aaa');
    makeTemplate(s, m);
    const key = gmCacheKey(s.state);
    expect(gmCacheKey(s.state)).toBe(key);
    const t = s.state.gm.template!;
    const moved = structuredClone(t);
    moved.patches[0].points[0].point[0] += 1;
    setGmConfig(s, { template: moved });
    const afterPoint = gmCacheKey(s.state);
    expect(afterPoint).not.toBe(key);
    setGmConfig(s, { template: t });
    expect(gmCacheKey(s.state)).toBe(key);
    const anchors = structuredClone(t);
    anchors.anchors[0][0] += 1;
    setGmConfig(s, { template: anchors });
    expect(gmCacheKey(s.state)).not.toBe(key);
    setGmConfig(s, { template: t });
    addLandmark(s, m.rim[5], 'more');
    expect(gmCacheKey(s.state)).not.toBe(key);
    expect(gmCacheKey({ ...s.state, landmarks: s.state.landmarks.slice(0, -1) })).toBe(key);
    expect(gmCacheKey({ ...s.state, landmarks: s.state.landmarks.slice(0, -1), mesh: meshInfo('other') })).not.toBe(key);
    setGmConfig(s, { patches: [{ regionType: 'cap', count: 61 }, { regionType: 'base', count: 40 }] });
    expect(gmCacheKey(s.state)).not.toBe(key);
  });
});

describe('a flake by a template', () => {
  /** T1 as a flake: moved by `f`, with its axis, outline, ends, edge, and the regions they make. */
  function flake(f: (p: Vec3) => Vec3, sha: string) {
    const m = mapped(flakeT1(0.5), f);
    const s = storeOn(sha);
    setSpecimenType(s, 'flake');
    const o = f([0, 0, 0]);
    const dir = (a: Vec3): Vec3 => {
      const b = f(a);
      return [b[0] - o[0], b[1] - o[1], b[2] - o[2]];
    };
    const unit = (v: Vec3): Vec3 => {
      const l = Math.hypot(...v);
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    setTechnicalAxis(s, { start: o, end: f(T1.A), startNormal: unit(dir([0, 0, 1])), endNormal: unit(dir([0, 0, 1])), matrix: frameMatrix({ origin: o, x: unit(dir([1, 0, 0])), y: unit(dir([0, 1, 0])), z: unit(dir([0, 0, 1])) }), failure: null });
    const corner = (x: number, k: number): Vec3 => f([x, -2 * k, 10 * k]);
    const c = addCurve(s, shape([f([-15, 0, 0]), f([0, 0, 0]), f([15, 0, 0]), corner(15, 1), corner(-15, 1)], true));
    setCurveAttribute(s, c.id, 'type', 'platform_outline');
    for (const x of [-15, 15]) placePlatformEnd(s, f([x, 0, 0]));
    const e = addCurve(s, shape(([[-15, 0, 0], [-15, 60, 0], [15, 60, 0], [15, 0, 0]] as Vec3[]).map(f), false));
    setCurveAttribute(s, e.id, 'type', 'edge');
    return { m, s };
  }

  it('its anchors are the fixed landmarks and the curves, its patches on its faces and platform; a turned copy gets them', () => {
    const same = (p: Vec3) => p;
    const a = flake(same, 'aaa');
    setGmConfig(a.s, { surfaceMethod: 'template', patches: [{ regionType: 'ventral', count: 30 }, { regionType: 'dorsal', count: 30 }, { regionType: 'platform', count: 12 }] });
    expect(a.s.state.regions.map((r) => r.type).sort()).toEqual(['dorsal', 'platform', 'ventral']);
    makeTemplate(a.s, a.m);
    const own = pointsOf(a.s.state, a.m);
    expect(own.complete).toBe(true);
    expect(own.method).toBe('template');
    const rows = gmAnchorRows(a.s.state).rows;
    expect(rows.slice(0, 3).map((r) => r.name)).toEqual(['pop', 'platform_left', 'platform_right']);
    // 3 fixed, 48 and 3 × 8 between their ends
    expect(rows).toHaveLength(3 + 48 + 24);
    // named by what they are, for taking a part in R
    expect(new Set(rows.filter((r) => r.kind === 'curve').map((r) => r.name))).toEqual(new Set(['edge', 'platform_left_pop', 'platform_pop_right', 'platform_right_left']));
    expect(own.rows.filter((r) => r.kind === 'surface').map((r) => r.name)).toEqual([...new Array(30).fill('ventral'), ...new Array(30).fill('dorsal'), ...new Array(12).fill('platform')]);

    const turn = rigid([1, -2, 1], 50, [100, 20, -5]);
    const b = flake(turn, 'bbb');
    setGmConfig(b.s, { surfaceMethod: 'template', patches: a.s.state.gm.patches, template: a.s.state.gm.template });
    const r = pointsOf(b.s.state, b.m);
    expect(r.complete).toBe(true);
    expect(r.flagged).toEqual([]);
    const laid = a.s.state.gm.template!.patches.flatMap((p) => p.points);
    r.rows.filter((x) => x.kind === 'surface').forEach((x, i) => expect(gap(x.point, turn(laid[i].point))).toBeLessThan(1e-3));
  }, 30_000);

  it('by the grid nothing changes: the exports are those of before, to the byte', () => {
    const m = flakeT1();
    const s = new ProjectStore(emptyProject());
    s.state.specimen.id = 'golden';
    setSpecimenType(s, 'flake');
    setTechnicalAxis(s, { start: [0, 0, 0], end: T1.A, startNormal: [0, 0, 1], endNormal: [0, 0, 1], matrix: frameMatrix({ origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }), failure: null });
    const corner = (x: number, k: number): Vec3 => [x, -2 * k, 10 * k];
    const o = addCurve(s, shape([[-15, 0, 0], [0, 0, 0], [15, 0, 0], corner(15, 1), corner(-15, 1)], true));
    setCurveAttribute(s, o.id, 'type', 'platform_outline');
    for (const x of [-15, 15]) placePlatformEnd(s, [x, 0, 0]);
    const e = addCurve(s, shape([[-15, 0, 0], [-15, 60, 0], [15, 60, 0], [15, 0, 0]], false));
    setCurveAttribute(s, e.id, 'type', 'edge');
    addLandmark(s, [0, 30, 0], 'mid');
    const c = addCurve(s, shape([[-5, 10, 0], [5, 10, 0], [5, 20, 0]], false));
    addSemilandmarkSet(s, c.id);
    const platformFaces: number[] = [];
    for (let t = 0; 3 * t < m.index.length; t++) {
      const ids = [m.index[3 * t], m.index[3 * t + 1], m.index[3 * t + 2]];
      if (ids.every((v) => Math.abs(m.positions[3 * v + 2] + 5 * m.positions[3 * v + 1]) < 1e-3)) platformFaces.push(t);
    }
    const r = gmPoints(s.state, { positions: m.positions, index: m.index, platformFaces });
    const h = (x: string) => createHash('sha256').update(x).digest('hex');
    // the hashes of these files as the code before the template made them
    expect(r.complete).toBe(true);
    expect(r.rows).toHaveLength(GOLDEN.rows);
    expect(h(landmarksTps(s.state, r))).toBe(GOLDEN.tps);
    expect(h(landmarksFcsv(r))).toBe(GOLDEN.fcsv);
    expect(h(gmLandmarksCsv(s.state, r, { excelBom: false }))).toBe(GOLDEN.csv);
    expect(gmLandmarksCsv(s.state, r, { excelBom: false })).toBe(landmarksCsv(s.state, r, { excelBom: false }));
    expect(h(gmCurvesCsv(r))).toBe(GOLDEN.curves);
    expect(h(gmSurfacesCsv(r))).toBe(GOLDEN.surfaces);
  });
});

describe('the exports by a template', () => {
  const same = (p: Vec3) => p;
  const specimen = (s: ProjectStore, r: GmResult, id: string): BatchSpecimen => {
    s.state.specimen.id = id;
    return { file: `site/${id}.ply`, state: s.state, gm: { config: gmConfigSummary(s.state.gm), ...r }, auto: null as never, planes: [], configuration: null, regions: [], regionTotals: null, nodule: null, split: null, flake: null, edgeAngles: [], retouchAngles: [], observers: new Map() };
  };

  it('the sliding definitions say the same points as the kind in the table, for geomorph and for Morpho', () => {
    const m = dome();
    const t = domeProject(m, same, 'aaa');
    makeTemplate(t, m);
    const r = pointsOf(t.state, m);
    const rows = r.rows;
    for (const [before, slide, after] of r.curves) {
      expect(rows[slide - 1].kind).toBe('curve');
      for (const n of [before, after]) expect(['curve', 'fixed']).toContain(rows[n - 1].kind);
    }
    expect(gmSmvectorCsv(r).trim().split('\n').slice(1).map(Number)).toEqual(r.curves.map((c) => c[1]));
    for (const n of gmSurpCsv(r).trim().split('\n').slice(1).map(Number)) expect(rows[n - 1].kind).toBe('surface');
    expect(gmSurpCsv(r)).toBe(gmSurfacesCsv(r));
    expect(r.surfaces).toEqual(rows.flatMap((x) => (x.kind === 'surface' ? [x.index] : [])));
    // one outline, closed on its start, every slider in it
    const lines = gmOutlines(r.curves);
    expect(lines).toHaveLength(1);
    expect(lines[0][0]).toBe(lines[0][lines[0].length - 1]);
    expect(lines[0].slice(1, -1)).toEqual(r.curves.map((c) => c[1]));
    expect(gmOutlinesCsv(r).split('\n')[0]).toBe('outline,index');
    expect(gmModelsCsv([{ id: 'a', file: 'site/a.ply' }])).toBe('specimen_id,model\na,site/a.ply\n');
  });

  it('a summary: a specimen with something missing in it as NA, one with nothing listed instead; the Morpho files once', () => {
    const m = dome();
    const t = domeProject(m, same, 'aaa');
    makeTemplate(t, m);
    const full = specimen(t, pointsOf(t.state, m), 'full');
    const partial = domeProject(m, same, 'bbb');
    setGmConfig(partial, { template: t.state.gm.template });
    deleteRegion(partial, partial.state.regions.find((r) => r.type === 'base')!.id);
    const some = specimen(partial, pointsOf(partial.state, m), 'partial');
    const none = storeOn('ccc');
    setSpecimenType(none, 'generic');
    setGmConfig(none, t.state.gm);
    const nothing = specimen(none, pointsOf(none.state, m), 'nothing');
    const out = gmOutputs([full, some, nothing], { excelBom: false });
    expect(out.files.map((f) => f.suffix)).toEqual(['gm_landmarks.csv', 'gm_landmarks.tps', 'gm_curves.csv', 'gm_smvector.csv', 'gm_outlines.csv', 'gm_surfaces.csv', 'gm_surp.csv', 'gm_models.csv']);
    expect(out.skipped.map((x) => x.id)).toEqual(['nothing']);
    expect(out.incomplete).toEqual([{ file: 'site/partial.ply', id: 'partial', missing: ['region_missing'] }]);
    const csv = out.files[0].text.trim().split('\n');
    expect(csv).toHaveLength(1 + 2 * full.gm!.rows.length);
    expect(csv.filter((l) => l.startsWith('partial,') && l.includes(',NA,NA,NA,'))).toHaveLength(40);
    expect(out.files.find((f) => f.suffix === 'gm_models.csv')!.text).toBe('specimen_id,model\nfull,site/full.ply\npartial,site/partial.ply\n');
  });
});

/** The hashes of a flake's exports by the grid, taken with the code as it stood before the template. */
const GOLDEN = {
  rows: 418,
  tps: '644b969c50d6bc75d663ca0912e205f8214fbe6dd7ee89159fdf34e52619abf4',
  fcsv: '4c67ec3b43606a622a62480add3dce75635a4e920129be869504218bd021534b',
  csv: 'd790c1aa585a8d8fb229ccda6a4f4e17a88c105015ad21a4adec4c2843e835ac',
  curves: '85298007a28dce54368f16b9453cd77495bf77acf207fa22523c1760779ce6a5',
  surfaces: '7efe63fadc2213983ce233d5d673b888b842774f0656d0503bdf5e583f2340ca',
};

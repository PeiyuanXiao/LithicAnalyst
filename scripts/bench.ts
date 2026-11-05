// Rough timing of the heavy steps, outside the browser (a slice of the app's work on the main thread is
// at most what is shown as "longest"; design principle 10 asks for about 100 ms).
// Usage: npm run bench                     a generated core of about 2 million triangles
//        npm run bench -- 500000           of this many triangles
//        npm run bench -- path/to/mesh.ply loading steps on a file
import { readFileSync } from 'node:fs';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { computeBicone } from '../src/compute/bicone';
import { completeLoopSteps, COMPLETE_ANCHOR_STEP_DEG, COMPLETE_STEP_DEG } from '../src/compute/completeLoop';
import { computeConfiguration, emptyCorrections } from '../src/compute/configuration';
import type { CurvatureService } from '../src/compute/curvatureService';
import { buildAdjacency, meanCurvature, robustAbsRange, smoothField } from '../src/compute/curvature';
import { frameMeasures, surfaceMeasuresSteps } from '../src/compute/measure';
import { fitPlane } from '../src/compute/meshGeometry';
import { edgeAnglesSteps } from '../src/compute/edgeAngle';
import { gmSteps } from '../src/compute/gm';
import { retouchAnglesSteps, retouchSectionsSteps } from '../src/compute/retouchAngle';
import { FACE_DORSAL, FACE_VENTRAL, retouchIndexSteps, segmentFrameSteps, segmentOutlineSteps } from '../src/compute/retouchIndex';
import { flakeMeasuresSteps, morphDimensionsSteps, techDimensionsSteps } from '../src/compute/flake';
import { crossSectionAt, lineNear, sectionByPlane } from '../src/compute/meshSection';
import { regionPlaneSteps } from '../src/compute/planes';
import { regionPathSteps } from '../src/compute/regionPath';
import { technicalFrameSteps } from '../src/compute/technicalFrame';
import { frameAxes } from '../src/core/frame';
import { bvhPlaneCandidates, bvhRayCandidates } from '../src/render/bvhPlane';
import { polylineEdgesSteps, regionsSteps } from '../src/compute/regions';
import { splitByLoopSteps } from '../src/compute/split';
import { runSync, type Steps } from '../src/compute/steps';
import { emptyProject } from '../src/core/store';
import { defaultRetouchSettings, type Curve, type ProjectState, type Scar, type Vec3 } from '../src/core/types';
import { buildLoadedMesh } from '../src/io/loadMesh';
import { SurfaceSnap } from '../src/tools/surfaceSnap';

const rows: Array<{ label: string; total: number; longest: number }> = [];

/** Run a computation in steps: its total time and the longest stretch between two yields. */
function steps<T>(label: string, s: Steps<T>): T {
  const t0 = performance.now();
  let last = t0, longest = 0;
  for (;;) {
    const r = s.next();
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
    if (r.done) {
      rows.push({ label, total: now - t0, longest });
      return r.value;
    }
  }
}

/** A computation that runs at once: all of it blocks. */
function once<T>(label: string, f: () => T): T {
  const t0 = performance.now();
  const v = f();
  const total = performance.now() - t0;
  rows.push({ label, total, longest: total });
  return v;
}

function report(): void {
  const width = Math.max(...rows.map((r) => r.label.length));
  console.log(`${'step'.padEnd(width)}  total ms  longest ms`);
  for (const r of rows) console.log(`${r.label.padEnd(width)}  ${r.total.toFixed(0).padStart(8)}  ${r.longest.toFixed(0).padStart(10)}${r.longest > 100 ? '  > 100' : ''}`);
}

async function benchFile(file: string): Promise<void> {
  const buf = readFileSync(file);
  const g = once('parse', () => new PLYLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer));
  const loaded = once('normals + BVH', () =>
    buildLoadedMesh({
      positions: new Float32Array(g.getAttribute('position').array),
      index: new Uint32Array(g.index!.array),
      colors: null,
      fileName: file,
      format: 'ply',
      fileSize: buf.byteLength,
      sha256: 'bench',
    }),
  );
  const pos = loaded.geometry.getAttribute('position').array as Float32Array;
  const nor = loaded.geometry.getAttribute('normal').array as Float32Array;
  const idx = loaded.geometry.index!.array as Uint32Array;
  const adj = once('adjacency', () => buildAdjacency(idx, pos.length / 3));
  const k = await meanCurvature(pos, nor, adj, 1);
  await smoothField(k, adj, 2);
  report();
}

/**
 * A core about `triangles` faces large: a sphere's grid flattened along z, with
 * undulations, a sharp ridge round the equator (ring `edge` of the grid), so
 * closed, with an edge to split along and to go round.
 */
function generatedCore(triangles: number) {
  const n = Math.round(Math.sqrt(triangles / 2));
  const lat = 2 * Math.round(n / 2), lon = n;
  const R = 30;
  const positions = new Float32Array(3 * (2 + (lat - 1) * lon));
  const point = (i: number, j: number): Vec3 => {
    const a = (Math.PI * i) / lat, b = (2 * Math.PI * j) / lon;
    const r = R * (1 + 0.02 * Math.sin(7 * b) * Math.sin(5 * a) + 0.01 * Math.sin(23 * b + 3 * a) + 0.12 * Math.exp(-Math.abs(a - Math.PI / 2) / 0.06));
    return [r * Math.sin(a) * Math.cos(b), r * Math.sin(a) * Math.sin(b), 0.6 * r * Math.cos(a)];
  };
  const vertex = (i: number, j: number) => 1 + (i - 1) * lon + ((j + lon) % lon);
  positions.set(point(0, 0), 0);
  for (let i = 1; i < lat; i++) for (let j = 0; j < lon; j++) positions.set(point(i, j), 3 * vertex(i, j));
  const south = 1 + (lat - 1) * lon;
  positions.set(point(lat, 0), 3 * south);
  const index = new Uint32Array(6 * lon * (lat - 1));
  let k = 0;
  for (let j = 0; j < lon; j++) {
    index.set([0, vertex(1, j), vertex(1, j + 1)], k);
    index.set([south, vertex(lat - 1, j + 1), vertex(lat - 1, j)], k + 3);
    k += 6;
  }
  for (let i = 1; i + 1 < lat; i++)
    for (let j = 0; j < lon; j++) {
      index.set([vertex(i, j), vertex(i + 1, j), vertex(i + 1, j + 1), vertex(i, j), vertex(i + 1, j + 1), vertex(i, j + 1)], k);
      k += 6;
    }
  return { positions, index, lat, lon, vertex };
}

async function benchGenerated(triangles: number): Promise<void> {
  const mesh = generatedCore(triangles);
  const count = mesh.positions.length / 3;
  console.log(`${mesh.index.length / 3} triangles, ${count} vertices\n`);
  const loaded = buildLoadedMesh({ positions: mesh.positions, index: mesh.index, colors: null, fileName: 'generated', format: 'ply', fileSize: 0, sha256: 'bench' });
  const pos = loaded.geometry.getAttribute('position').array as Float32Array;
  const nor = loaded.geometry.getAttribute('normal').array as Float32Array;
  const idx = loaded.geometry.index!.array as Uint32Array;
  const o = loaded.offset;

  const base = steps('measure pass (area, volume, edges, topology)', surfaceMeasuresSteps(pos, idx));
  // ① the box comes with length, width and thickness
  const measured = once('1 box range (frameMeasures)', () => frameMeasures(pos, base, null, o));

  // what tracing needs: curvature and the ridge fields, as the curve tool prepares them
  const adj = buildAdjacency(idx, count);
  const raw = await meanCurvature(pos, nor, adj, loaded.orientationSign);
  const service = { adjacency: async () => adj, field: async () => ({ field: raw, range: robustAbsRange(raw, 0.96) }) } as unknown as CurvatureService;
  const snap = new SurfaceSnap(loaded, service, () => 0);
  const t0 = performance.now();
  await snap.prepare('ridge');
  rows.push({ label: 'ridge fields (strength, cost)', total: performance.now() - t0, longest: performance.now() - t0 });

  // the core's edge: the ridge round the equator
  const ring = Array.from({ length: mesh.lon }, (_, j) => mesh.vertex(mesh.lat / 2, j));
  const rim = ring.map((v) => snap.point(v));
  const third = Math.floor(ring.length / 3);
  const curve: Curve = { id: 'rim', label: 'C1', anchors: [rim[0], rim[third], rim[2 * third]], points: rim, anchorIndex: [0, third, 2 * third], closed: true, attributes: { type: 'core_edge', note: '' }, createdAt: '', modifiedAt: '' };

  // ② 50 scars with arrows on the upper half, from near the edge toward the pole
  const scars: Scar[] = Array.from({ length: 50 }, (_, s) => {
    const j = Math.floor((s * mesh.lon) / 50);
    const a = snap.point(mesh.vertex(Math.floor(mesh.lat * 0.45), j)), b = snap.point(mesh.vertex(Math.floor(mesh.lat * 0.3), j));
    return { id: `s${s}`, label: `S${s + 1}`, vector: { start: a, end: b, startNormal: snap.normal(mesh.vertex(Math.floor(mesh.lat * 0.45), j)), endNormal: snap.normal(mesh.vertex(Math.floor(mesh.lat * 0.3), j)) }, attributes: {}, createdAt: '', modifiedAt: '' };
  });
  once('2 computeConfiguration, 50 arrows', () => computeConfiguration(scars, emptyCorrections(), measured.box));

  // ③ the split along the closed curve, as the app does it
  const fit = fitPlane(rim)!;
  const search = snap.search(3);
  const chain = steps(
    '3a curve to mesh edges (polylineEdges)',
    polylineEdgesSteps(rim, true, (p) => snap.nearestVertex(p), base.edges, (a, b) => {
      if (!search) return null;
      search.start(a, null);
      return search.reach(b) ? search.path(b) : null;
    }),
  );
  const volumes = steps('3b volume split (splitByLoop)', splitByLoopSteps(pos, idx, base.edges, chain, fit.normal))!;
  console.log(`upper ${volumes.upper.toFixed(0)}, lower ${volumes.lower.toFixed(0)}`);

  // ④ the bicone on it
  const state: ProjectState = { ...emptyProject(), scars, curves: [curve], split: { source: 'curve', id: 'rim', upHint: [0, 0, 1], swap: false } };
  once(`4 computeBicone (${rim.length} curve points)`, () => computeBicone(state, volumes));

  // ⑤ a third of the edge carried round to its start
  const part = ring.slice(0, third + 1);
  const res = steps(
    '5a complete loop (completeLoopSteps)',
    completeLoopSteps({
      positions: pos,
      adjacency: adj,
      strength: snap.strength('ridge'),
      cost: snap.cost('ridge'),
      points: part.map((v): Vec3 => [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]]),
      first: part[0],
      last: part[part.length - 1],
      stepDeg: COMPLETE_STEP_DEG,
      anchorStepDeg: COMPLETE_ANCHOR_STEP_DEG,
    }),
  );
  if (!res.ok) throw new Error(`complete loop failed: ${res.reason}`);
  console.log(`completed with ${res.anchors.length} anchors`);
  // the worst case for tracing: no ridge to follow, the shortest way between far-apart stops
  const plain = steps(
    '5c the same without a ridge field',
    completeLoopSteps({
      positions: pos,
      adjacency: adj,
      strength: null,
      cost: null,
      points: part.map((v): Vec3 => [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]]),
      first: part[0],
      last: part[part.length - 1],
      stepDeg: COMPLETE_STEP_DEG,
      anchorStepDeg: COMPLETE_ANCHOR_STEP_DEG,
    }),
  );
  if (plain.ok) console.log(`without a ridge: ${plain.anchors.length} anchors`);
  steps(
    '5b pull the traced stretches taut (refine)',
    (function* () {
      for (const c of res.chains) {
        snap.refine(c, 'ridge');
        yield;
      }
    })(),
  );

  // ⑥ a flake: the frame, the dimensions, the sections and the paths on a piece of the surface
  const P = snap.point(mesh.vertex(Math.floor(mesh.lat * 0.6), 0));
  const A = snap.point(mesh.vertex(Math.floor(mesh.lat * 0.9), 0));
  const frameResult = steps('6a technical frame (strip along the axis)', technicalFrameSteps({ positions: pos, index: idx, offset: o, orientationSign: loaded.orientationSign, meanEdge: base.meanEdge }, P, A));
  if (!frameResult.ok) throw new Error(`no frame: ${frameResult.reason}`);
  const axes = frameAxes(frameResult.matrix);
  const frame = { ...axes, origin: [axes.origin[0] - o[0], axes.origin[1] - o[1], axes.origin[2] - o[2]] as Vec3 };
  const morph = steps('6b morphological dimensions (convex hull)', morphDimensionsSteps(pos));
  const tech = steps('6c technical dimensions', techDimensionsSteps(pos, frame));
  const candidates = bvhPlaneCandidates(loaded.geometry);
  const section = once('6d longitudinal section (BVH)', () => lineNear(sectionByPlane(pos, idx, frame.origin, frame.x, candidates), [P[0] - o[0], P[1] - o[1], P[2] - o[2]]));
  once('6e one cross-section (BVH): at most once a frame', () => crossSectionAt(pos, idx, frame, tech.tech_length * 0.5, candidates));
  once('6f the same over all the triangles', () => crossSectionAt(pos, idx, frame, tech.tech_length * 0.5, null));
  // a platform: the triangles of about 2 % of the surface around P
  const faces: number[] = [];
  const r2 = (0.1 * loaded.diagonal) ** 2;
  for (let t = 0; t < idx.length / 3; t++) {
    const v = 3 * idx[3 * t];
    if ((pos[v] - frame.origin[0]) ** 2 + (pos[v + 1] - frame.origin[1]) ** 2 + (pos[v + 2] - frame.origin[2]) ** 2 < r2) faces.push(t);
  }
  const platformFaces = Uint32Array.from(faces);
  const s0 = snap.point(idx[3 * faces[0]]), s1 = snap.point(idx[3 * faces[faces.length - 1]]);
  console.log(`platform stand-in: ${faces.length} triangles, section ${section?.points.length ?? 0} points, hull length ${morph?.length.toFixed(1)}`);
  steps('6g shortest path within the region', regionPathSteps(pos, idx, platformFaces, [s0[0] - o[0], s0[1] - o[1], s0[2] - o[2]], [s1[0] - o[0], s1[1] - o[1], s1[2] - o[2]]));
  steps('6h plane of a region', regionPlaneSteps(pos, idx, platformFaces, o));
  steps('6i all the flake measures', flakeMeasuresSteps({ positions: pos, index: idx, offset: o, matrix: frameResult.matrix, P, ends: [], platformFaces, platformArea: 1, unit: 'mm', meanEdge: base.meanEdge, morph, candidates }));

  // ⑦ the edge angles along the core's edge
  const edgeLength = rim.reduce((s, p, i) => s + Math.hypot(p[0] - rim[(i + 1) % rim.length][0], p[1] - rim[(i + 1) % rim.length][1], p[2] - rim[(i + 1) % rim.length][2]), 0);
  const angles = steps(`7 edge angles along ${edgeLength.toFixed(0)} mm`, edgeAnglesSteps({ positions: pos, index: idx, offset: o, points: rim, closed: true, unit: 'mm', meanEdge: base.meanEdge, candidates }));
  console.log(`${angles?.stations.length ?? 0} stations`);

  // ⑧ the retouch layers along it: both sides of the edge a layer, as far as the whole section
  const rimPart = runSync(regionsSteps(pos, idx, base.edges, runSync(polylineEdgesSteps(rim, true, (p) => snap.nearestVertex(p), base.edges, (a, b) => {
    if (!search) return null;
    search.start(a, null);
    return search.reach(b) ? search.path(b) : null;
  }))));
  const layered = new Map(Array.from({ length: rimPart.count }, (_, c) => [c, { region: `R${c}`, layer: 1 }] as const));
  const layers = steps(`8 retouch layers along ${edgeLength.toFixed(0)} mm (${rimPart.count} pieces)`, retouchAnglesSteps({ positions: pos, index: idx, offset: o, points: rim, closed: true, unit: 'mm', meanEdge: base.meanEdge, candidates, pieceOfFace: rimPart.region, pieces: layered }));
  console.log(`${layers?.stations.filter((s) => s.stretches.length).length ?? 0} stations with a layer`);

  // ⑨ the points for geometric morphometrics, by the default configuration: the core's edge as the edge and as the outline, the platform stand-in as the platform
  const ended = (x: Vec3, code: 'pop' | 'platform_end', i: number) => ({ id: `${code}${i}`, name: code, code, point: x, createdAt: '', modifiedAt: '' });
  const gmState: ProjectState = {
    ...emptyProject(),
    specimen: { ...emptyProject().specimen, type: 'flake' },
    landmarks: [ended(P, 'pop', 0), ended(rim[0], 'platform_end', 1), ended(rim[third], 'platform_end', 2)],
    curves: [{ ...curve, attributes: { type: 'edge' } }, { ...curve, id: 'outline', attributes: { type: 'platform_outline' } }],
    flake: { axis: { id: 'axis', start: P, end: A, startNormal: [0, 0, 1], endNormal: [0, 0, 1], matrix: frameResult.matrix, failure: null, createdAt: '', modifiedAt: '' }, otherFrame: null },
  };
  const gmResult = steps('9 points for geometric morphometrics', gmSteps(gmState, { positions: pos, index: idx, offset: o, platformFaces, candidates: bvhRayCandidates(loaded.geometry) }));
  console.log(`${gmResult.rows.length} points, complete: ${gmResult.complete}, missing: ${gmResult.missing.join() || 'nothing'}`);

  // ⑩ the retouch indices: a band of retouch above the edge, the upper half the dorsal face, the lower half the ventral
  const bandRing = Array.from({ length: mesh.lon }, (_, j) => mesh.vertex(Math.floor(mesh.lat * 0.45), j));
  const bandEdges = bandRing.flatMap((v, j) => [v, bandRing[(j + 1) % bandRing.length]]);
  const banded = runSync(regionsSteps(pos, idx, base.edges, [...chain, ...bandEdges]));
  const inBand = mesh.vertex(Math.floor(mesh.lat * 0.47), 0);
  let bandFace = 0;
  while (idx[3 * bandFace] !== inBand && idx[3 * bandFace + 1] !== inBand && idx[3 * bandFace + 2] !== inBand) bandFace++;
  const bandPieces = new Map([[banded.region[bandFace], { region: 'R1', layer: 1 }]]);
  const faceOf = Uint8Array.from(rimPart.region, (c) => (c === rimPart.region[bandFace] ? FACE_DORSAL : FACE_VENTRAL));
  const sections = steps(`10a retouch layers, keeping the sections, along ${edgeLength.toFixed(0)} mm`, retouchSectionsSteps({ positions: pos, index: idx, offset: o, points: rim, closed: true, unit: 'mm', meanEdge: base.meanEdge, candidates, pieceOfFace: banded.region, pieces: bandPieces }))!;
  const planFrame = steps('10b the plan: the longest axis, the dorsal normal', segmentFrameSteps({ positions: pos, index: idx, offset: o, orientationSign: loaded.orientationSign, faceOf, settings: defaultRetouchSettings(), matrix: null, morph, specimenFrame: null }));
  const outline = planFrame.frame ? steps('10c the plan: its outline', segmentOutlineSteps(pos, planFrame.frame)) : null;
  const retouchInput = { positions: pos, index: idx, offset: o, faceOf, pieceOfFace: banded.region, pieces: bandPieces, curves: [{ curveId: 'rim', edge: true, closed: true, length: sections.length, stations: sections.result.stations, sections: sections.sections }], unit: 'mm', meanEdge: base.meanEdge, volume: base.volume, frame: planFrame, outline };
  const indices = steps('10d the retouch indices', retouchIndexSteps({ ...retouchInput, fitLength: null }));
  steps('10e again at another fitted length (no new sections)', retouchIndexSteps({ ...retouchInput, fitLength: 8 }));
  const sectionPoints = sections.sections.reduce((n, s) => n + (s ? s.ways[0].points.length : 0), 0);
  console.log(`${indices.indices.stations.length} retouched stations (${sectionPoints} section points kept), ERP ${indices.indices.erp?.toFixed(3)}, GIUR ${indices.indices.giur?.toFixed(3)}, invasiveness ${indices.indices.invasiveness}, empty: ${JSON.stringify(indices.reasons)}`);
  console.log('');
  report();
}

const arg = process.argv[2];
if (arg && !/^\d+$/.test(arg)) await benchFile(arg);
else await benchGenerated(arg ? Number(arg) : 2_000_000);

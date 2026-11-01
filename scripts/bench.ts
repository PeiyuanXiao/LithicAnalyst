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
import { polylineEdgesSteps } from '../src/compute/regions';
import { splitByLoopSteps } from '../src/compute/split';
import type { Steps } from '../src/compute/steps';
import { emptyProject } from '../src/core/store';
import type { Curve, ProjectState, Scar, Vec3 } from '../src/core/types';
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
  console.log('');
  report();
}

const arg = process.argv[2];
if (arg && !/^\d+$/.test(arg)) await benchFile(arg);
else await benchGenerated(arg ? Number(arg) : 2_000_000);

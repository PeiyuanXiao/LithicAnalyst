// Rough timing of the heavy steps on a mesh file, outside the browser.
// Usage: npx tsx scripts/bench.ts path/to/mesh.ply
import { readFileSync } from 'node:fs';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { buildAdjacency, meanCurvature, smoothField } from '../src/compute/curvature';
import { buildLoadedMesh } from '../src/io/loadMesh';

const file = process.argv[2];
if (!file) throw new Error('Pass a .ply file');
const buf = readFileSync(file);
const t = (label: string, t0: number) => console.log(`${label}: ${(performance.now() - t0).toFixed(0)} ms`);

let t0 = performance.now();
const g = new PLYLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
t('parse', t0);
t0 = performance.now();
const loaded = buildLoadedMesh({
  positions: new Float32Array(g.getAttribute('position').array),
  index: new Uint32Array(g.index!.array),
  colors: null,
  fileName: file,
  format: 'ply',
  fileSize: buf.byteLength,
  sha256: 'bench',
});
t(`normals + BVH (${loaded.info.triangleCount} triangles)`, t0);
const pos = loaded.geometry.getAttribute('position').array as Float32Array;
const nor = loaded.geometry.getAttribute('normal').array as Float32Array;
const idx = loaded.geometry.index!.array as Uint32Array;
t0 = performance.now();
const adj = buildAdjacency(idx, pos.length / 3);
t('adjacency', t0);
t0 = performance.now();
const k = await meanCurvature(pos, nor, adj, 1);
t('curvature', t0);
t0 = performance.now();
await smoothField(k, adj, 2);
t('smoothing ×2', t0);

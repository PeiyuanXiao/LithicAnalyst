import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { signedVolume } from '../compute/curvature';
import { sha256Hex } from '../compute/hash';
import { removeDegenerateTriangles, weldExact, weldIndexed } from '../compute/weld';
import type { MeshFormat, MeshInfo, Vec3 } from '../core/types';

// Fast ray picking on large scans.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/**
 * A mesh ready for display. Geometry positions are stored relative to `offset`
 * (the bounding-box centre) to keep float32 precision for scans with large
 * coordinates; the THREE.Mesh is placed at `offset`, so world coordinates in
 * the scene equal the original file coordinates.
 */
export interface LoadedMesh {
  geometry: THREE.BufferGeometry;
  offset: Vec3;
  info: MeshInfo;
  /** Per-vertex scan colours (linear RGB), if the file had them. */
  scanColors: Float32Array | null;
  /** +1 if triangles face outward (positive volume), −1 if inward. */
  orientationSign: number;
  diagonal: number;
}

export class MeshLoadError extends Error {
  constructor(readonly code: 'unsupported' | 'empty' | 'pointcloud' | 'parse', message: string) {
    super(message);
  }
}

export const SUPPORTED_EXTENSIONS = ['ply', 'stl', 'obj'] as const;

export function extensionOf(name: string): string {
  const m = /\.([^.]+)$/.exec(name.toLowerCase());
  return m ? m[1] : '';
}

/** Read and parse a mesh file (positions in original coordinates, indexed). */
export async function readMeshFile(file: File, onStage?: (stage: string) => Promise<void> | void): Promise<RawMesh> {
  const ext = extensionOf(file.name);
  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext))
    throw new MeshLoadError('unsupported', `Unsupported file type ".${ext}".`);
  await onStage?.('reading');
  const buffer = await file.arrayBuffer();
  await onStage?.('hashing');
  const sha256 = await sha256Hex(buffer);
  await onStage?.('parsing');

  let positions: Float32Array;
  let index: Uint32Array | null = null;
  let colors: Float32Array | null = null;

  try {
    if (ext === 'ply') {
      const g = new PLYLoader().parse(buffer);
      positions = new Float32Array(g.getAttribute('position').array as ArrayLike<number>);
      if (g.index) index = new Uint32Array(g.index.array as ArrayLike<number>);
      const c = g.getAttribute('color');
      if (c && c.count === positions.length / 3) colors = new Float32Array(c.array as ArrayLike<number>);
      if (!index) {
        if (positions.length % 9 !== 0 || positions.length === 0)
          throw new MeshLoadError('pointcloud', 'This PLY file has no faces (point cloud).');
        const w = weldExact(positions);
        positions = w.positions;
        index = w.index;
        colors = null;
      } else {
        // some writers give every face vertices of its own: join the faces at coincident corners
        const w = weldIndexed(positions, index, colors);
        positions = w.positions;
        index = removeDegenerateTriangles(w.index);
        colors = w.colors;
      }
    } else if (ext === 'stl') {
      const g = new STLLoader().parse(buffer);
      const w = weldExact(new Float32Array(g.getAttribute('position').array as ArrayLike<number>));
      positions = w.positions;
      index = w.index;
    } else {
      const text = new TextDecoder().decode(buffer);
      const group = new OBJLoader().parse(text);
      const parts: Float32Array[] = [];
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry) {
          const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
          parts.push(new Float32Array(g.getAttribute('position').array as ArrayLike<number>));
        }
      });
      const total = parts.reduce((s, p) => s + p.length, 0);
      const soup = new Float32Array(total);
      let o = 0;
      for (const p of parts) {
        soup.set(p, o);
        o += p.length;
      }
      const w = weldExact(soup);
      positions = w.positions;
      index = w.index;
    }
  } catch (e) {
    if (e instanceof MeshLoadError) throw e;
    throw new MeshLoadError('parse', `Could not read the file: ${(e as Error).message}`);
  }

  return {
    positions,
    index: index!,
    colors,
    fileName: file.name,
    format: ext as MeshFormat,
    fileSize: file.size,
    sha256,
  };
}

export interface RawMesh {
  /** Positions in original coordinates. */
  positions: Float32Array;
  index: Uint32Array;
  colors: Float32Array | null;
  fileName: string;
  format: MeshFormat;
  fileSize: number;
  sha256: string;
}

/**
 * The mesh as the app measures it: positions relative to the bounding-box
 * centre (float precision for large coordinates) and the triangles without
 * degenerate ones (a copy: the BVH build reorders the index in place).
 */
export function centredMesh(raw: RawMesh): { positions: Float32Array; index: Uint32Array; offset: Vec3; min: Vec3; max: Vec3 } {
  const cleaned = removeDegenerateTriangles(raw.index);
  const index = cleaned === raw.index ? cleaned.slice() : cleaned;
  const n = raw.positions.length / 3;
  if (n < 3 || index.length < 3) throw new MeshLoadError('empty', 'The file contains no triangles.');

  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const v = raw.positions[3 * i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  if (!min.every(Number.isFinite) || !max.every(Number.isFinite))
    throw new MeshLoadError('parse', 'The file contains invalid coordinates.');
  const offset: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const local = new Float32Array(raw.positions.length);
  for (let i = 0; i < n; i++) {
    local[3 * i] = raw.positions[3 * i] - offset[0];
    local[3 * i + 1] = raw.positions[3 * i + 1] - offset[1];
    local[3 * i + 2] = raw.positions[3 * i + 2] - offset[2];
  }
  return { positions: local, index, offset, min, max };
}

export function buildLoadedMesh(raw: RawMesh): LoadedMesh {
  const { positions: local, index, offset, min, max } = centredMesh(raw);
  const n = local.length / 3;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(local, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.computeBoundsTree();

  const vol = signedVolume(local, index);
  const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);

  return {
    geometry,
    offset,
    scanColors: raw.colors,
    orientationSign: vol < 0 ? -1 : 1,
    diagonal,
    info: {
      fileName: raw.fileName,
      format: raw.format,
      fileSize: raw.fileSize,
      sha256: raw.sha256,
      vertexCount: n,
      triangleCount: index.length / 3,
      bboxMin: min,
      bboxMax: max,
    },
  };
}

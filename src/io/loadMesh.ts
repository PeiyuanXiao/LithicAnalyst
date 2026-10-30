import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { signedVolume } from '../compute/curvature';
import type { MeshInfo, Vec3 } from '../core/types';
import { centredMesh, type RawMesh } from './readMesh';

export { centredMesh, extensionOf, MeshLoadError, readMeshFile, SUPPORTED_EXTENSIONS, type RawMesh } from './readMesh';

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

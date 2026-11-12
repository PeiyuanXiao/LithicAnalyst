import * as THREE from 'three';
import { INTERSECTED, NOT_INTERSECTED, type HitPointInfo, type MeshBVH } from 'three-mesh-bvh';
import { faceNormal, type SurfaceQuery } from '../compute/igesAlign';
import type { Vec3 } from '../core/types';
import type { RayCandidates } from '../compute/gm';
import type { PlaneCandidates } from '../compute/meshSection';

/** The triangles a line may cross, from the mesh's BVH (null without one: the line then looks at all of them). */
export function bvhRayCandidates(geometry: THREE.BufferGeometry): RayCandidates | null {
  const bvh = geometry.boundsTree as unknown as MeshBVH | undefined;
  if (!bvh) return null;
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere!;
  const ray = new THREE.Ray();
  const at = new THREE.Vector3();
  return (origin, direction, visit) => {
    // the whole line, either way: from beyond the mesh
    const back = sphere.center.distanceTo(at.set(origin[0], origin[1], origin[2])) + sphere.radius + 1;
    ray.origin.set(origin[0] - direction[0] * back, origin[1] - direction[1] * back, origin[2] - direction[2] * back);
    ray.direction.set(direction[0], direction[1], direction[2]);
    bvh.shapecast({
      intersectsBounds: (box) => (ray.intersectsBox(box) ? INTERSECTED : NOT_INTERSECTED),
      intersectsRange: (offset, count) => {
        for (let t = offset; t < offset + count; t++) visit(t);
        return false;
      },
    });
  };
}

/** The triangles a plane may cut, from the mesh's BVH (null without one: the section then looks at all of them). */
export function bvhPlaneCandidates(geometry: THREE.BufferGeometry): PlaneCandidates | null {
  const bvh = geometry.boundsTree as unknown as MeshBVH | undefined;
  if (!bvh) return null;
  const plane = new THREE.Plane();
  const n = new THREE.Vector3();
  const p = new THREE.Vector3();
  const sphere = new THREE.Sphere();
  return (point, normal, visit, within) => {
    plane.setFromNormalAndCoplanarPoint(n.set(normal[0], normal[1], normal[2]), p.set(point[0], point[1], point[2]));
    if (within) sphere.set(new THREE.Vector3(within.center[0], within.center[1], within.center[2]), within.radius);
    bvh.shapecast({
      intersectsBounds: (box) => (plane.intersectsBox(box) && (!within || sphere.intersectsBox(box)) ? INTERSECTED : NOT_INTERSECTED),
      intersectsRange: (offset, count) => {
        for (let t = offset; t < offset + count; t++) visit(t);
        return false;
      },
    });
  };
}

/**
 * The model's surface for the nearest point (original coordinates), from the mesh's BVH: `offset` is where its positions start,
 * `sign` +1 when its triangles face outward. Null without a BVH.
 */
export function bvhSurface(geometry: THREE.BufferGeometry, offset: Vec3, sign: number, min: Vec3, max: Vec3): SurfaceQuery | null {
  const bvh = geometry.boundsTree as unknown as MeshBVH | undefined;
  if (!bvh || !geometry.index) return null;
  const positions = geometry.getAttribute('position').array as ArrayLike<number>;
  const index = geometry.index.array as ArrayLike<number>;
  const q = new THREE.Vector3();
  const hit = {} as HitPointInfo;
  return {
    min: [...min] as Vec3,
    max: [...max] as Vec3,
    closest: (p) => {
      const h = bvh.closestPointToPoint(q.set(p[0] - offset[0], p[1] - offset[1], p[2] - offset[2]), hit);
      if (!h || h.faceIndex < 0) return null;
      return { point: [h.point.x + offset[0], h.point.y + offset[1], h.point.z + offset[2]], normal: faceNormal(positions, index, h.faceIndex, sign), distance: h.distance };
    },
  };
}

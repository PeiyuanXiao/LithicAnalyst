import * as THREE from 'three';
import { INTERSECTED, NOT_INTERSECTED, type MeshBVH } from 'three-mesh-bvh';
import type { PlaneCandidates } from '../compute/meshSection';

/** The triangles a plane may cut, from the mesh's BVH (null without one: the section then looks at all of them). */
export function bvhPlaneCandidates(geometry: THREE.BufferGeometry): PlaneCandidates | null {
  const bvh = geometry.boundsTree as unknown as MeshBVH | undefined;
  if (!bvh) return null;
  const plane = new THREE.Plane();
  const n = new THREE.Vector3();
  const p = new THREE.Vector3();
  return (point, normal, visit) => {
    plane.setFromNormalAndCoplanarPoint(n.set(normal[0], normal[1], normal[2]), p.set(point[0], point[1], point[2]));
    bvh.shapecast({
      intersectsBounds: (box) => (plane.intersectsBox(box) ? INTERSECTED : NOT_INTERSECTED),
      intersectsRange: (offset, count) => {
        for (let t = offset; t < offset + count; t++) visit(t);
        return false;
      },
    });
  };
}

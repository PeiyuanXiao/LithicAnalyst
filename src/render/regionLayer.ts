import * as THREE from 'three';
import type { RegionType, Vec3 } from '../core/types';

export const REGION_COLORS: Record<Exclude<RegionType, 'scar'>, string> = {
  cortex: '#d9a441',
  joint: '#4f9fd6',
  damage: '#9a9a9a',
};

/** Scar regions are told apart by scar (its number picks the colour). */
const SCAR_PALETTE = ['#e4572e', '#29a36a', '#8e5cd9', '#e8b10e', '#2b8ac4', '#d84f9b', '#6aa84f', '#c97b2a'];

export function regionColor(type: RegionType, scarLabel: string | null): string {
  if (type !== 'scar') return REGION_COLORS[type];
  const n = Number(/(\d+)$/.exec(scarLabel ?? '')?.[1] ?? 1);
  return SCAR_PALETTE[(Math.max(1, n) - 1) % SCAR_PALETTE.length];
}

export interface RegionPaint {
  /** Piece of surface (component of the partition). */
  component: number;
  color: string;
  selected: boolean;
}

/**
 * Translucent colour over the surface regions: one mesh per coloured piece,
 * sharing the scan's vertex buffer. It sits in the scene (not the annotation
 * overlay) so figures can include it.
 */
export class RegionLayer {
  readonly group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    this.group.name = 'regions';
    scene.add(this.group);
  }

  /** `region[t]` is the piece of triangle t; `position` the scan's (re-centred) vertices at `offset`. */
  sync(position: THREE.BufferAttribute | null, index: ArrayLike<number> | null, region: Uint32Array | null, paints: RegionPaint[], offset: Vec3): void {
    this.clear();
    if (!position || !index || !region || !paints.length) return;
    this.group.position.set(offset[0], offset[1], offset[2]);
    this.group.updateMatrixWorld(true);
    const wanted = new Map(paints.map((p) => [p.component, p]));
    const lists = new Map<number, number[]>();
    for (let t = 0; t < region.length; t++) {
      const c = region[t];
      if (!wanted.has(c)) continue;
      let l = lists.get(c);
      if (!l) lists.set(c, (l = []));
      l.push(index[3 * t], index[3 * t + 1], index[3 * t + 2]);
    }
    for (const [c, idx] of lists) {
      const p = wanted.get(c)!;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', position);
      g.setIndex(idx);
      const m = new THREE.MeshBasicMaterial({
        color: p.color,
        transparent: true,
        opacity: p.selected ? 0.62 : 0.42,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = 3;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  clear(): void {
    for (const m of this.meshes) {
      m.geometry.setIndex(null);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      this.group.remove(m);
    }
    this.meshes = [];
  }
}

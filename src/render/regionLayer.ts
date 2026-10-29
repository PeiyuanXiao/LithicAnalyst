import * as THREE from 'three';
import type { Region, RegionType, Scar, Vec3 } from '../core/types';
import { UNASSIGNED_COLOR } from './sequenceColor';

/** No yellow among them: yellow means selected. */
export const REGION_COLORS: Record<Exclude<RegionType, 'scar'>, string> = {
  cortex: '#a0673a',
  joint: '#4f9fd6',
  damage: '#9a9a9a',
};

/** Scar regions are told apart by scar (its number picks the colour). */
const SCAR_PALETTE = ['#e4572e', '#29a36a', '#8e5cd9', '#17a2b8', '#2b8ac4', '#d84f9b', '#6aa84f', '#c97b2a'];

export function regionColor(type: RegionType, scarLabel: string | null): string {
  if (type !== 'scar') return REGION_COLORS[type];
  const n = Number(/(\d+)$/.exec(scarLabel ?? '')?.[1] ?? 1);
  return SCAR_PALETTE[(Math.max(1, n) - 1) % SCAR_PALETTE.length];
}

/** A region's colour; with sequence colours (scar id → colour), scar regions take their scar's. */
export function regionColorOf(r: Pick<Region, 'type' | 'scarId'>, scars: readonly Scar[], sequences: Map<string, string> | null): string {
  if (r.type === 'scar' && sequences) return (r.scarId && sequences.get(r.scarId)) || UNASSIGNED_COLOR;
  return regionColor(r.type, r.scarId ? scars.find((s) => s.id === r.scarId)?.label ?? null : null);
}

export interface RegionPaint {
  /** Piece of surface (component of the partition). */
  component: number;
  color: string;
  selected: boolean;
  /** Fainter than the others (e.g. a scar in no sequence while sequences are being made). */
  faded?: boolean;
}

/**
 * Translucent colour over the surface regions: one mesh per coloured piece,
 * sharing the scan's vertex buffer. It sits in the scene (not the annotation
 * overlay) so figures can include it.
 */
export class RegionLayer {
  readonly group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private figureStyle = false;
  /** Fainter colours (the measure mode); applies from the next sync. */
  dimmed = false;

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
      const common = { depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };
      // in the view the colour multiplies the shading, so the relief of the scars shows through
      const tint = new THREE.Color(1, 1, 1).lerp(new THREE.Color(p.color), p.selected ? 0.72 : this.dimmed || p.faded ? 0.2 : 0.5);
      const view = new THREE.MeshBasicMaterial({ ...common, color: tint, transparent: true, blending: THREE.MultiplyBlending, premultipliedAlpha: true });
      // figures keep the plain translucent colour
      const figure = new THREE.MeshBasicMaterial({ ...common, color: p.color, transparent: true, opacity: p.selected ? 0.62 : 0.42 });
      const mesh = new THREE.Mesh(g, this.figureStyle ? figure : view);
      mesh.userData = { view, figure };
      mesh.renderOrder = 3;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  /** Draw the colours as figures show them (plain translucent) instead of multiplied onto the shading. */
  useFigureStyle(on: boolean): void {
    this.figureStyle = on;
    for (const m of this.meshes) m.material = on ? m.userData.figure : m.userData.view;
  }

  clear(): void {
    for (const m of this.meshes) {
      m.geometry.setIndex(null);
      m.geometry.dispose();
      (m.userData.view as THREE.Material).dispose();
      (m.userData.figure as THREE.Material).dispose();
      this.group.remove(m);
    }
    this.meshes = [];
  }
}

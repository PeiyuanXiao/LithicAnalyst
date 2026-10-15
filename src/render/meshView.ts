import * as THREE from 'three';
import type { LoadedMesh } from '../io/loadMesh';

export type ShadingMode = 'plain' | 'scan' | 'curvature';

const STONE = new THREE.Color().setRGB(0.78, 0.77, 0.74, THREE.SRGBColorSpace);

/** The scan's appearance: material, shading mode and colour attributes. */
export class MeshView {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  private mode: ShadingMode = 'plain';
  private curvatureColors: Float32Array | null = null;

  constructor(readonly loaded: LoadedMesh) {
    this.material = new THREE.MeshStandardMaterial({
      color: STONE,
      roughness: 0.62,
      metalness: 0,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.mesh = new THREE.Mesh(loaded.geometry, this.material);
    this.mesh.name = 'scan';
  }

  get shading(): ShadingMode {
    return this.mode;
  }

  get hasScanColors(): boolean {
    return !!this.loaded.scanColors;
  }

  setRoughness(r: number): void {
    this.material.roughness = r;
  }

  setCurvatureColors(colors: Float32Array | null): void {
    this.curvatureColors = colors;
    if (this.mode === 'curvature') this.apply();
  }

  setShading(mode: ShadingMode): void {
    if (mode === 'scan' && !this.loaded.scanColors) mode = 'plain';
    this.mode = mode;
    this.apply();
  }

  private apply(): void {
    const g = this.loaded.geometry;
    const data = this.mode === 'scan' ? this.loaded.scanColors : this.mode === 'curvature' ? this.curvatureColors : null;
    if (data) {
      const attr = g.getAttribute('color') as THREE.BufferAttribute | undefined;
      if (attr && attr.array.length === data.length) {
        (attr.array as Float32Array).set(data);
        attr.needsUpdate = true;
      } else {
        g.setAttribute('color', new THREE.BufferAttribute(data.slice(), 3));
      }
      this.material.vertexColors = true;
      this.material.color.set(0xffffff);
    } else {
      this.material.vertexColors = false;
      this.material.color.copy(STONE);
    }
    this.material.needsUpdate = true;
  }

  dispose(): void {
    this.loaded.geometry.disposeBoundsTree?.();
    this.loaded.geometry.dispose();
    this.material.dispose();
  }
}

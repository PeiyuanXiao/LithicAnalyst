import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Vec3 } from '../core/types';
import { lineMaterial } from './curveLayer';
import type { Viewer } from './viewer';

/** A white core with a dark outline (not yellow: yellow means selected). */
const CORE = '#ffffff';
const OUTLINE = '#141a18';

/**
 * Dashed lines along the borders of scars whose relation has not been judged
 * yet (the relation tool shows them). Each line is a chain of points on the
 * surface, in original coordinates.
 */
export class BorderLayer {
  readonly group = new THREE.Group();
  private lines: Line2[] = [];
  private geometries: LineGeometry[] = [];
  private key = '';

  /** `solid`: a whole line in place of the dashes (the profile panel's ring). */
  constructor(
    private readonly viewer: Viewer,
    private readonly solid = false,
  ) {
    this.group.name = 'borders';
    viewer.overlay.add(this.group);
  }

  /** The lines drawn are those named `key`. */
  shows(key: string): boolean {
    return key === this.key;
  }

  /** `key` names what the chains show (nothing is rebuilt while it stays the same); `origin` is subtracted for float precision on the GPU. */
  sync(key: string, chains: Vec3[][], origin: Vec3): void {
    if (key === this.key) return;
    this.clear();
    this.key = key;
    this.group.position.set(origin[0], origin[1], origin[2]);
    const d = this.viewer.diagonal;
    const dash: [number, number] | undefined = this.solid ? undefined : [d * 0.008, d * 0.006];
    for (const chain of chains) {
      if (chain.length < 2) continue;
      const flat = new Float32Array(chain.length * 3);
      chain.forEach((p, i) => {
        flat[3 * i] = p[0] - origin[0];
        flat[3 * i + 1] = p[1] - origin[1];
        flat[3 * i + 2] = p[2] - origin[2];
      });
      const g = new LineGeometry();
      g.setPositions(flat);
      this.geometries.push(g);
      const outline = new Line2(g, lineMaterial(OUTLINE, 4.6, { halo: true, dash }));
      const core = new Line2(g, lineMaterial(CORE, 2, { dash }));
      outline.renderOrder = 12;
      core.renderOrder = 13;
      for (const l of [outline, core]) {
        l.computeLineDistances();
        l.frustumCulled = false;
        this.lines.push(l);
        this.group.add(l);
      }
    }
    this.viewer.requestRender();
  }

  clear(): void {
    if (!this.key && !this.lines.length) return;
    for (const l of this.lines) {
      (l.material as LineMaterial).dispose();
      this.group.remove(l);
    }
    for (const g of this.geometries) g.dispose();
    this.lines = [];
    this.geometries = [];
    this.key = '';
    this.viewer.requestRender();
  }
}

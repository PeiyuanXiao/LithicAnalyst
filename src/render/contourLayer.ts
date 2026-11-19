import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import * as THREE from 'three';
import type { Vec3 } from '../core/types';
import { lineMaterial } from './curveLayer';
import type { Viewer } from './viewer';

/** The lines of equal height over the shading by height: thin and dark, and one line thicker (the BSA's level). */
const CONTOUR = { color: '#1b2320', thin: 1, thick: 2.6, opacity: 0.55 };

/**
 * Lines of equal height on the model, while it is shaded by height. They lie on the surface and are hidden where it hides them, as the
 * curves are. Segments in the mesh's coordinates (relative to `origin`), by twos.
 */
export class ContourLayer {
  readonly group = new THREE.Group();
  private owned: Array<{ dispose: () => void }> = [];
  private counted = { thin: 0, thick: 0 };

  constructor(private readonly viewer: Viewer) {
    this.group.name = 'contours';
    viewer.overlay.add(this.group);
  }

  sync(thin: Float32Array, thick: Float32Array | null, origin: Vec3): void {
    this.clear();
    this.group.position.set(origin[0], origin[1], origin[2]);
    const add = (segments: Float32Array, width: number) => {
      if (segments.length < 6) return 0;
      const g = new LineSegmentsGeometry().setPositions(segments);
      const m: LineMaterial = lineMaterial(CONTOUR.color, width, { opacity: CONTOUR.opacity });
      this.owned.push(g, m);
      const lines = new LineSegments2(g, m);
      lines.frustumCulled = false;
      this.group.add(lines);
      return segments.length / 6;
    };
    this.counted = { thin: add(thin, CONTOUR.thin), thick: thick ? add(thick, CONTOUR.thick) : 0 };
    this.viewer.requestRender();
  }

  clear(): void {
    for (const c of [...this.group.children]) this.group.remove(c);
    for (const o of this.owned) o.dispose();
    this.owned = [];
    this.counted = { thin: 0, thick: 0 };
    this.viewer.requestRender();
  }

  /** How many segments are drawn (for tests). */
  counts(): { thin: number; thick: number; shown: boolean } {
    return { ...this.counted, shown: this.group.visible };
  }
}

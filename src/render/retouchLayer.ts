import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { SegmentLines } from '../compute/retouchPlan';
import type { Vec3 } from '../core/types';
import { CURVE_COLORS, lineMaterial } from './curveLayer';
import type { Viewer } from './viewer';

/** The current station and what is restored: the shell's accent. */
const ACCENT = '#e8a33a';
/** The lines of the segments: dark, with the boundary of the outer zone in the accent. */
const SEGMENT_LINE = '#1f2422';

type Lines = Line2 | LineSegments2;

/** A set of lines that can be replaced as a whole. */
class LineSet {
  readonly group = new THREE.Group();
  private items: Lines[] = [];
  private key = '';

  constructor(parent: THREE.Object3D) {
    parent.add(this.group);
  }

  shows(key: string): boolean {
    return this.key === key;
  }

  add(item: Lines): void {
    item.frustumCulled = false;
    this.items.push(item);
    this.group.add(item);
  }

  replace(key: string, origin: Vec3): void {
    this.clear();
    this.key = key;
    this.group.position.set(origin[0], origin[1], origin[2]);
  }

  clear(): void {
    for (const l of this.items) {
      (l.material as LineMaterial).dispose();
      l.geometry.dispose();
      this.group.remove(l);
    }
    this.items = [];
    this.key = '';
  }
}

const flat = (chain: readonly Vec3[]): Float32Array => {
  const out = new Float32Array(chain.length * 3);
  chain.forEach((p, i) => out.set(p, 3 * i));
  return out;
};

/**
 * What the retouch mode draws on the model: the current station's section and its point on the edge, the original edge
 * where the stations give one, and the lines of the segments. Everything is in the mesh's own coordinates.
 */
export class RetouchLayer {
  readonly group = new THREE.Group();
  private readonly station: LineSet;
  private readonly edge: LineSet;
  private readonly segments: LineSet;
  private readonly marker: THREE.Mesh;
  private markerAt: Vec3 | null = null;

  constructor(private readonly viewer: Viewer) {
    this.group.name = 'retouch';
    viewer.overlay.add(this.group);
    this.segments = new LineSet(this.group);
    this.edge = new LineSet(this.group);
    this.station = new LineSet(this.group);
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false, transparent: true }));
    this.marker.renderOrder = 20;
    this.marker.visible = false;
    this.group.add(this.marker);
  }

  /** The current station: the section's lines, and the point on the edge. */
  syncStation(key: string, chains: readonly Vec3[][], A: Vec3 | null, origin: Vec3): void {
    if (!this.station.shows(key)) {
      this.station.replace(key, origin);
      for (const chain of chains) {
        if (chain.length < 2) continue;
        const g = new LineGeometry();
        g.setPositions(flat(chain));
        const halo = new Line2(g, lineMaterial(CURVE_COLORS.halo, 3.2, { halo: true }));
        const core = new Line2(g, lineMaterial(ACCENT, 1.4));
        halo.renderOrder = 16;
        core.renderOrder = 17;
        this.station.add(halo);
        this.station.add(core);
      }
    }
    this.markerAt = A ? [A[0] + origin[0], A[1] + origin[1], A[2] + origin[2]] : null;
    this.marker.visible = !!A;
    if (A) {
      this.marker.position.set(this.markerAt![0], this.markerAt![1], this.markerAt![2]);
      this.marker.scale.setScalar(this.viewer.diagonal * 0.007);
    }
    this.viewer.requestRender();
  }

  /** The original edge: dashed, one line per unbroken run of stations. */
  syncEdge(key: string, chains: readonly Vec3[][], origin: Vec3): void {
    if (this.edge.shows(key)) return;
    this.edge.replace(key, origin);
    const d = this.viewer.diagonal;
    for (const chain of chains) {
      if (chain.length < 2) continue;
      const g = new LineGeometry();
      g.setPositions(flat(chain));
      const line = new Line2(g, lineMaterial(ACCENT, 2, { dash: [d * 0.008, d * 0.006] }));
      line.computeLineDistances();
      line.renderOrder = 15;
      this.edge.add(line);
    }
    this.viewer.requestRender();
  }

  /** The lines of the segments, as line pieces. */
  syncSegments(key: string, lines: SegmentLines | null, origin: Vec3): void {
    if (this.segments.shows(key)) return;
    this.segments.replace(key, origin);
    if (lines) {
      const pieces = (positions: Float32Array, color: string, width: number) => {
        if (positions.length < 6) return;
        const g = new LineSegmentsGeometry();
        g.setPositions(positions);
        const l = new LineSegments2(g, lineMaterial(color, width));
        l.renderOrder = 11;
        this.segments.add(l);
      };
      pieces(lines.rows, SEGMENT_LINE, 1.1);
      pieces(lines.mids, SEGMENT_LINE, 1.1);
      pieces(lines.bounds, ACCENT, 1.4);
    }
    this.viewer.requestRender();
  }

  /** Where the point on the edge is (original coordinates; null: none). */
  stationPoint(): Vec3 | null {
    return this.markerAt;
  }

  /** How many line objects the three sets hold (for tests). */
  counts(): { station: number; edge: number; segments: number } {
    return { station: this.station.group.children.length, edge: this.edge.group.children.length, segments: this.segments.group.children.length };
  }

  clear(): void {
    this.station.clear();
    this.edge.clear();
    this.segments.clear();
    this.marker.visible = false;
    this.markerAt = null;
    this.viewer.requestRender();
  }
}

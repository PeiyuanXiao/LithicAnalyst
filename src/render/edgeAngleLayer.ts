import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Vec3 } from '../core/types';
import { CURVE_COLORS, HALO, lineMaterial, WIDTH_SELECTED } from './curveLayer';
import type { Viewer } from './viewer';

/** One hue from light (small angles) to dark (large); no yellow: yellow means selected. */
export const EDGE_ANGLE_RAMP = ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];

/** Angles closer than this (degrees) are drawn in one colour: the ramp would make a pattern of the mesh's noise. */
export const EDGE_ANGLE_FLAT_DEG = 1;

/** The sharp stretches and the rest. */
export const SHARP_COLORS = { sharp: '#1c5cab', other: '#b4b3ab' };

/** How a value is drawn. */
export type EdgePaint = (value: number, out: THREE.Color) => THREE.Color;

const stops = EDGE_ANGLE_RAMP.map((c) => new THREE.Color(c));

/** The ramp's colour at t in [0, 1]. */
function rampColor(t: number, out: THREE.Color): THREE.Color {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return out.copy(stops[i]).lerp(stops[i + 1], x - i);
}

/** The ramp between `lo` and `hi`; the middle of it when they are too close to tell apart. */
export function rampPaint(lo: number, hi: number): EdgePaint {
  const span = hi - lo < EDGE_ANGLE_FLAT_DEG ? 0 : hi - lo;
  return (v, out) => rampColor(span > 0 ? (v - lo) / span : 0.5, out);
}

/** 1: sharp, 0: not. */
export const sharpPaint: EdgePaint = (v, out) => out.set(v > 0 ? SHARP_COLORS.sharp : SHARP_COLORS.other);

/**
 * A curve coloured by its edge angle, broken where a station has no value.
 * Screen-space lines with a dark halo, as the curves are; in original coordinates.
 */
export class EdgeAngleLayer {
  readonly group = new THREE.Group();
  private lines: Line2[] = [];
  private geometries: LineGeometry[] = [];

  constructor(private readonly viewer: Viewer) {
    this.group.name = 'edge-angles';
    viewer.overlay.add(this.group);
  }

  /** `stations`: the points of the curve, each with its value (`valuesAlongCurve`). `origin` is subtracted for float precision on the GPU. */
  sync(stations: ReadonlyArray<{ point: Vec3 | null; value: number | null }>, closed: boolean, origin: Vec3, paint: EdgePaint): void {
    this.clear();
    this.group.position.set(origin[0], origin[1], origin[2]);
    // runs of stations with a value; a closed curve's last run goes on into its first
    const runs: Array<typeof stations[number][]> = [];
    let run: Array<typeof stations[number]> = [];
    for (const s of stations) {
      if (s.point && s.value !== null) run.push(s);
      else {
        if (run.length) runs.push(run);
        run = [];
      }
    }
    if (run.length) runs.push(run);
    const first = stations[0], last = stations[stations.length - 1];
    if (closed && runs.length && first?.point && first.value !== null && last?.point && last.value !== null) {
      if (runs.length === 1) runs[0] = [...runs[0], first];
      else runs[0] = [...runs.pop()!, ...runs[0]];
    }
    const c = new THREE.Color();
    for (const stretch of runs) {
      if (stretch.length < 2) continue;
      const pos = new Float32Array(stretch.length * 3), col = new Float32Array(stretch.length * 3);
      stretch.forEach((s, i) => {
        pos.set([s.point![0] - origin[0], s.point![1] - origin[1], s.point![2] - origin[2]], 3 * i);
        paint(s.value!, c);
        col.set([c.r, c.g, c.b], 3 * i);
      });
      const g = new LineGeometry();
      g.setPositions(pos);
      g.setColors(col);
      this.geometries.push(g);
      const halo = new Line2(g, lineMaterial(CURVE_COLORS.halo, WIDTH_SELECTED + 1 + HALO, { halo: true }));
      const coreMaterial = lineMaterial('#ffffff', WIDTH_SELECTED + 1);
      coreMaterial.vertexColors = true;
      const core = new Line2(g, coreMaterial);
      halo.renderOrder = 14;
      core.renderOrder = 15;
      for (const l of [halo, core]) {
        l.frustumCulled = false;
        this.lines.push(l);
        this.group.add(l);
      }
    }
    this.viewer.requestRender();
  }

  clear(): void {
    if (!this.lines.length) return;
    for (const l of this.lines) {
      (l.material as LineMaterial).dispose();
      this.group.remove(l);
    }
    for (const g of this.geometries) g.dispose();
    this.lines = [];
    this.geometries = [];
    this.viewer.requestRender();
  }
}

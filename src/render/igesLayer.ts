import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Vec3 } from '../core/types';
import type { Viewer } from './viewer';

/**
 * The colours of vectors being imported, in no other use among the data's (arrows, curves, landmarks, planes, sequences): a
 * clear lime, and a red orange for an arrow with an end far from the surface.
 */
export const IGES_COLORS = { preview: '#a6e22e', warn: '#ff5a1f', halo: '#141a18', paired: '#ffffff' };

/** Sizes in CSS pixels, the same at any zoom. */
const LINE_PX = 2.5;
const HALO_PX = 2;
const DOT_PX = 9;
const HOT_DOT_PX = 14;
const OPACITY = 0.8;
/** The head: this share of the arrow's length, at most this many pixels. */
const HEAD_SHARE = 0.25;
const HEAD_MAX_PX = 16;
/** Over everything else, without a depth test. */
const ORDER = { halo: 60, line: 61, head: 62, dots: 63 };

export interface PreviewArrow {
  start: Vec3;
  end: Vec3;
  warn: boolean;
}

function dotsMaterial(size: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { size: { value: size } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    vertexColors: true,
    vertexShader: /* glsl */ `
      uniform float size;
      attribute vec3 ring;
      varying vec3 vColor;
      varying vec3 vRing;
      void main() {
        vColor = color;
        vRing = ring;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying vec3 vRing;
      void main() {
        float r = length(gl_PointCoord * 2.0 - 1.0);
        if (r > 1.0) discard;
        gl_FragColor = vec4(r > 0.62 ? vRing : vColor, 0.95);
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * Draws the vectors being imported over the model (in the overlay, so figures leave them out): a line with a halo and a head at the
 * end for each, a dot at each end to take hold of. The end in hand is larger, the ends placed by the user have a white ring.
 */
export class IgesLayer {
  readonly group = new THREE.Group();
  private owned: Array<{ dispose: () => void }> = [];
  private things: THREE.Object3D[] = [];
  private shown = { arrows: 0, warned: 0 };

  constructor(private readonly viewer: Viewer) {
    this.group.name = 'iges-preview';
    viewer.overlay.add(this.group);
  }

  private line(flat: number[], color: string, width: number, opacity: number, order: number): void {
    const g = new LineSegmentsGeometry().setPositions(flat);
    const m = new LineMaterial({ color: new THREE.Color(color), linewidth: width, transparent: true, opacity, depthTest: false, depthWrite: false });
    const l = new LineSegments2(g, m);
    l.frustumCulled = false;
    l.renderOrder = order;
    this.owned.push(g, m);
    this.things.push(l);
    this.group.add(l);
  }

  /** `hot`: the end in hand or under the pointer (2 × arrow + 0 for its start, 1 for its end); `paired`: the ends the user placed. */
  show(arrows: readonly PreviewArrow[], origin: Vec3, hot: number | null = null, paired: ReadonlySet<number> = new Set()): void {
    this.clear();
    this.group.position.set(origin[0], origin[1], origin[2]);
    const local = (p: Vec3): number[] => [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
    for (const warn of [false, true]) {
      const flat: number[] = [];
      for (const a of arrows) if (a.warn === warn) flat.push(...local(a.start), ...local(a.end));
      if (!flat.length) continue;
      this.line(flat, IGES_COLORS.halo, LINE_PX + HALO_PX, 0.55, ORDER.halo);
      this.line(flat, warn ? IGES_COLORS.warn : IGES_COLORS.preview, LINE_PX, OPACITY, ORDER.line);
    }
    // heads: cones as long as a share of the arrow, never larger on the screen than HEAD_MAX_PX
    const cone = new THREE.ConeGeometry(0.4, 1, 16).translate(0, -0.5, 0);
    this.owned.push(cone);
    const mats = new Map<string, THREE.MeshBasicMaterial>();
    const up = new THREE.Vector3(0, 1, 0);
    for (const a of arrows) {
      const s = new THREE.Vector3(...a.start), e = new THREE.Vector3(...a.end);
      const dir = e.clone().sub(s);
      const len = dir.length();
      if (len === 0) continue;
      const size = Math.min(HEAD_SHARE * len, HEAD_MAX_PX * this.viewer.worldPerPixel(e));
      const color = a.warn ? IGES_COLORS.warn : IGES_COLORS.preview;
      let m = mats.get(color);
      if (!m) {
        m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: OPACITY, depthTest: false, depthWrite: false });
        mats.set(color, m);
        this.owned.push(m);
      }
      const head = new THREE.Mesh(cone, m);
      head.position.set(...(local(a.end) as [number, number, number]));
      head.quaternion.setFromUnitVectors(up, dir.divideScalar(len));
      head.scale.setScalar(size);
      head.renderOrder = ORDER.head;
      head.frustumCulled = false;
      this.things.push(head);
      this.group.add(head);
    }
    // the ends, the one in hand larger
    const ratio = this.viewer.renderer.getPixelRatio();
    for (const big of [false, true]) {
      const pos: number[] = [], col: number[] = [], ring: number[] = [];
      arrows.forEach((a, i) =>
        [a.start, a.end].forEach((p, k) => {
          const id = 2 * i + k;
          if ((id === hot) !== big) return;
          pos.push(...local(p));
          col.push(...new THREE.Color(a.warn ? IGES_COLORS.warn : IGES_COLORS.preview).toArray());
          ring.push(...new THREE.Color(paired.has(id) ? IGES_COLORS.paired : IGES_COLORS.halo).toArray());
        }),
      );
      if (!pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('ring', new THREE.Float32BufferAttribute(ring, 3));
      const m = dotsMaterial((big ? HOT_DOT_PX : DOT_PX) * ratio);
      this.owned.push(g, m);
      const points = new THREE.Points(g, m);
      points.frustumCulled = false;
      points.renderOrder = ORDER.dots;
      this.things.push(points);
      this.group.add(points);
    }
    this.shown = { arrows: arrows.length, warned: arrows.filter((a) => a.warn).length };
    this.viewer.requestRender();
  }

  clear(): void {
    for (const t of this.things) this.group.remove(t);
    for (const o of this.owned) o.dispose();
    this.things = [];
    this.owned = [];
    this.shown = { arrows: 0, warned: 0 };
    this.viewer.requestRender();
  }

  /** What is drawn, for the tests. */
  counts(): { arrows: number; warned: number } {
    return { ...this.shown };
  }
}

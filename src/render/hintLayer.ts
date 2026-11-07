import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { HintArc, HintDots, HintFaces, HintLine, HintRole, MeasureHint } from '../compute/measureHint';
import type { Vec3 } from '../core/types';
import { EASE, VIEW_MOTION } from './easing';
import type { Viewer } from './viewer';

/** Widths and sizes in CSS pixels, the same at any zoom. */
const LINE_PX: Record<HintRole, number> = { current: 2.5, other: 1.5 };
const HALO_PX = 2;
const DOT_PX: Record<HintRole, number> = { current: 8, other: 6 };
/** A dark edge, so the accent holds on a light surface as on a dark one. */
const HALO = '#141a18';
const HALO_OPACITY = 0.55;
/** The grey's edge is fainter: it should read as grey, not as the edge. */
const OTHER_HALO_OPACITY = 0.45;
const FACE_OPACITY = { current: 0.36, upper: 0.3, lower: 0.4 };
/** The lower side of a split: a light slate beside the accent. */
const LOWER_TINT = '#a9c3da';
/** A label on an angle stands off to the side, or it would cover a small arc. */
const ARC_LABEL_CENTER: [number, number] = [-0.2, 1.3];

/** Above the regions (2, 3) and the curves (10, 11); all of it without a depth test. */
const ORDER = { faces: 5, halo: 40, line: 41, dots: 42 };

/** The colours, from the theme: the current item, the others' neutral grey, and the edge that keeps the grey apart from what it lies on. */
export interface HintColors {
  current: string;
  other: string;
  otherHalo: string;
}

function dotsMaterial(color: string, ring: string, size: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, ring: { value: new THREE.Color(ring) }, size: { value: size }, fade: { value: 1 } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float size;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform vec3 ring;
      uniform float fade;
      void main() {
        float r = length(gl_PointCoord * 2.0 - 1.0);
        if (r > 1.0) discard;
        gl_FragColor = vec4(r > 0.7 ? ring : color, fade);
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * Draws a measure's hint (`compute/measureHint.ts`) over the model: lines of a constant width on the screen, dots, arcs, values at the middle of
 * the lines. Nothing of it is picked, and the labels let the pointer through. In the overlay, so figures do not show it.
 */
export class HintLayer {
  readonly group = new THREE.Group();
  private things: THREE.Object3D[] = [];
  private labels: CSS2DObject[] = [];
  /** Materials and geometries made for the hint shown. */
  private owned: Array<{ dispose: () => void }> = [];
  private counted = { lines: 0, dots: 0, arcs: 0, faces: 0, labels: 0 };
  /** Each material's opacity as a share of its own (it fades in). */
  private fades: Array<(f: number) => void> = [];
  /** Counts the hints shown: a fade belongs to the one it began with. */
  private shown = 0;

  constructor(private readonly viewer: Viewer) {
    this.group.name = 'measure-hint';
    viewer.overlay.add(this.group);
  }

  /**
   * `origin`: where the mesh's coordinates start; subtracted for float precision on the GPU. `position`, `index`: the mesh's, shared.
   * `fadeIn`: it comes into view (another measure than the one drawn), and fades in; drawn again for the same one, it is there at once.
   */
  show(hint: MeasureHint, colors: HintColors, origin: Vec3, position: THREE.BufferAttribute, index: THREE.BufferAttribute, fadeIn = false): void {
    this.clear();
    const mine = ++this.shown;
    this.group.position.set(origin[0], origin[1], origin[2]);
    for (const prim of hint) {
      if (prim.kind === 'line') this.line(prim, colors, origin);
      else if (prim.kind === 'arc') this.arc(prim, colors, origin);
      else if (prim.kind === 'dots') this.dots(prim, colors, origin);
      else this.faces(prim, colors, position, index);
    }
    if (fadeIn) {
      for (const l of this.labels) l.element.classList.add('is-fading-in');
      const fades = this.fades;
      this.viewer.tween(VIEW_MOTION.HINT_FADE_MS, (k) => {
        // (one cleared or replaced meanwhile: its materials are gone)
        if (mine !== this.shown) return;
        const f = k >= 1 ? 1 : EASE(k);
        for (const fn of fades) fn(f);
      });
    }
    this.viewer.requestRender();
  }

  /** A material that fades in with the rest: its opacity as a share of `base`. */
  private fading(m: THREE.Material, base: number): void {
    this.fades.push((f) => (m.opacity = base * f));
  }

  private local(points: readonly Vec3[], origin: Vec3): number[] {
    const out: number[] = [];
    for (const p of points) out.push(p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]);
    return out;
  }

  private lineMaterial(color: string, width: number, opacity = 1): LineMaterial {
    const m = new LineMaterial({ color: new THREE.Color(color), linewidth: width, transparent: true, opacity, depthTest: false, depthWrite: false });
    this.owned.push(m);
    this.fading(m, opacity);
    return m;
  }

  private addLine(flat: number[], segments: boolean, role: HintRole, colors: HintColors): void {
    const make = (material: LineMaterial) => {
      if (segments) {
        const g = new LineSegmentsGeometry().setPositions(flat);
        this.owned.push(g);
        return new LineSegments2(g, material);
      }
      const g = new LineGeometry();
      g.setPositions(flat);
      this.owned.push(g);
      return new Line2(g, material);
    };
    const current = role === 'current';
    const halo = make(this.lineMaterial(current ? HALO : colors.otherHalo, LINE_PX[role] + HALO_PX, current ? HALO_OPACITY : OTHER_HALO_OPACITY));
    const core = make(this.lineMaterial(current ? colors.current : colors.other, LINE_PX[role]));
    halo.renderOrder = ORDER.halo;
    core.renderOrder = ORDER.line;
    for (const l of [halo, core]) {
      l.frustumCulled = false;
      this.things.push(l);
      this.group.add(l);
    }
  }

  private line(prim: HintLine, colors: HintColors, origin: Vec3): void {
    const points = prim.closed && prim.points.length > 2 ? [...prim.points, prim.points[0]] : prim.points;
    if (points.length < 2) return;
    this.addLine(this.local(points, origin), !!prim.segments, prim.role, colors);
    this.counted.lines++;
    if (prim.label && prim.labelAt) this.label(prim.label, prim.labelAt, prim.role, origin);
  }

  private arc(prim: HintArc, colors: HintColors, origin: Vec3): void {
    if (prim.points.length < 2) return;
    this.addLine(this.local(prim.points, origin), false, prim.role, colors);
    this.counted.arcs++;
    if (prim.label && prim.labelAt) this.label(prim.label, prim.labelAt, prim.role, origin, ARC_LABEL_CENTER);
  }

  private dots(prim: HintDots, colors: HintColors, origin: Vec3): void {
    if (!prim.points.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.local(prim.points, origin)), 3));
    const current = prim.role === 'current';
    const material = dotsMaterial(current ? colors.current : colors.other, current ? HALO : colors.otherHalo, DOT_PX[prim.role] * this.viewer.renderer.getPixelRatio());
    this.owned.push(g, material);
    this.fades.push((f) => (material.uniforms.fade.value = f));
    const points = new THREE.Points(g, material);
    points.frustumCulled = false;
    points.renderOrder = ORDER.dots;
    this.things.push(points);
    this.group.add(points);
    this.counted.dots++;
  }

  private faces(prim: HintFaces, colors: HintColors, position: THREE.BufferAttribute, index: THREE.BufferAttribute): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', position);
    if (prim.faces === 'all') g.setIndex(index);
    else {
      const list = prim.faces;
      const idx = new Uint32Array(3 * list.length);
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        idx[3 * i] = index.getX(3 * t);
        idx[3 * i + 1] = index.getX(3 * t + 1);
        idx[3 * i + 2] = index.getX(3 * t + 2);
      }
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    const material = new THREE.MeshBasicMaterial({
      color: prim.tint === 'lower' ? LOWER_TINT : colors.current,
      transparent: true,
      opacity: FACE_OPACITY[prim.tint],
      depthWrite: false,
      depthTest: !prim.through,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.fading(material, FACE_OPACITY[prim.tint]);
    // (the mesh's buffers stay: only what was made here goes)
    this.owned.push(material, { dispose: () => (g.setIndex(null), g.deleteAttribute('position'), g.dispose()) });
    const mesh = new THREE.Mesh(g, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = ORDER.faces;
    this.things.push(mesh);
    this.group.add(mesh);
    this.counted.faces++;
  }

  private label(text: string, at: Vec3, role: HintRole, origin: Vec3, center?: [number, number]): void {
    const el = document.createElement('div');
    el.className = `hint-label hint-label-${role}`;
    el.textContent = text;
    const label = new CSS2DObject(el);
    label.position.set(at[0] - origin[0], at[1] - origin[1], at[2] - origin[2]);
    if (center) label.center.set(center[0], center[1]);
    this.labels.push(label);
    this.group.add(label);
    this.counted.labels++;
  }

  clear(): void {
    this.fades = [];
    if (!this.things.length && !this.labels.length) return;
    this.shown++;
    for (const t of this.things) this.group.remove(t);
    for (const l of this.labels) {
      l.element.remove();
      this.group.remove(l);
    }
    for (const o of this.owned) o.dispose();
    this.things = [];
    this.labels = [];
    this.owned = [];
    this.counted = { lines: 0, dots: 0, arcs: 0, faces: 0, labels: 0 };
    this.viewer.requestRender();
  }

  /** What is drawn now, for the tests. */
  counts(): { lines: number; dots: number; arcs: number; faces: number; labels: number } {
    return { ...this.counted };
  }
}

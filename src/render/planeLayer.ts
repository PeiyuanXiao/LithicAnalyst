import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Polyline } from '../compute/meshGeometry';
import { planeShape, roundedRectOutline, type PlaneShape, type PlaneShapeInput } from '../compute/planeShape';
import type { PlaneResult } from '../compute/planes';
import type { Plane, Vec3 } from '../core/types';
import { CurveVisual } from './curveLayer';
import { EASE } from './easing';
import type { Viewer } from './viewer';

/** One colour per plane, by its number (P1, P2, …); no yellow (it means selected). */
export const PLANE_COLORS = ['#ff8a3d', '#2ec4b6', '#3a86ff', '#9b8cff', '#ff6fa8', '#7bd389'];

/** Where a plane cuts the model: thinner than curves, with a thinner dark outline. */
const SECTION_WIDTH = 1.6;
const SECTION_WIDTH_SELECTED = 2.4;
const SECTION_HALO = 1.2;

export function planeColor(label: string): string {
  const n = Number(/(\d+)$/.exec(label)?.[1] ?? 1);
  return PLANE_COLORS[(Math.max(1, n) - 1) % PLANE_COLORS.length];
}

/** How a plane is drawn: not selected, selected, and in the present mode (a figure: no selection). */
export type PlaneLook = 'idle' | 'selected' | 'figure';

/** The opacities of the fill, the outline, the grid and the normal in each look (0: not drawn). */
export const PLANE_LOOKS: Record<PlaneLook, { fill: number; edge: number; grid: number; normal: number }> = {
  idle: { fill: 0.06, edge: 0.5, grid: 0, normal: 0 },
  selected: { fill: 0.12, edge: 0.95, grid: 0.28, normal: 1 },
  figure: { fill: 0.1, edge: 0.9, grid: 0.25, normal: 0 },
};

/** Widths on the screen (px), the normal's end, the fade between looks and the corners' segments. */
export const PLANE_STYLE = { EDGE_PX: 1.2, GRID_PX: 1, NORMAL_PX: 1.5, DOT_PX: 6, FADE_MS: 150, CORNER_SEGMENTS: 12 } as const;

/** Fill, grid, outline, normal, then the section (CurveVisual: 10, 11). */
const ORDER = { fill: 5, grid: 6, edge: 7, normal: 8 };

/** A line of a constant width on the screen, in the plane's colour, translucent; it writes no depth (no flicker against the fill). */
function planeLine(width: number): LineMaterial {
  return new LineMaterial({ color: 0xffffff, linewidth: width, transparent: true, opacity: 1, depthWrite: false });
}

/** A round dot of a constant size on the screen. */
function dotMaterial(size: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color() }, size: { value: size }, opacity: { value: 1 } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float size;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float opacity;
      void main() {
        if (length(gl_PointCoord * 2.0 - 1.0) > 1.0) discard;
        gl_FragColor = vec4(color, opacity);
        #include <colorspace_fragment>
      }`,
  });
}

const flatten = (points: readonly Vec3[], origin: Vec3): number[] => points.flatMap((p) => [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]]);

/** What a plane's drawing shows now: its shape, and the opacities (between two looks while it fades). */
export interface PlaneStyleInfo {
  center: Vec3;
  u: Vec3;
  halfWidth: number;
  halfHeight: number;
  radius: number;
  /** Grid lines drawn (0: none). */
  gridLines: number;
  fill: number;
  edge: number;
  grid: number;
  normal: boolean;
  look: PlaneLook | null;
  from: PlaneShape['from'];
}

/**
 * A plane on screen (fitted planes, and the symmetry references' planes): a rounded rectangle fitted to its section
 * (`compute/planeShape.ts`), translucent, with a thin outline; selected, a sparse grid and its normal as a slim line ending in a dot;
 * and where it cuts the model.
 */
export class PlaneVisual {
  readonly root = new THREE.Group();
  private readonly fill: THREE.Mesh;
  private readonly edge: Line2;
  private readonly grid: LineSegments2;
  private readonly normalLine: Line2;
  private readonly dot: THREE.Points;
  private sections: CurveVisual[] = [];
  private sectionKey: Polyline[] | null = null;
  private shape: PlaneShape | null = null;
  private shapeKey = '';
  private shapeLines: PlaneShapeInput['lines'] = null;
  private look: PlaneLook | null = null;
  /** The opacities drawn now. */
  private now = { fill: 0, edge: 0, grid: 0, normal: 0 };
  /** Counts the fades: a step belongs to the one it began with. */
  private fading = 0;

  constructor(private readonly viewer: Viewer | null) {
    this.fill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    this.edge = new Line2(new LineGeometry(), planeLine(PLANE_STYLE.EDGE_PX));
    this.grid = new LineSegments2(new LineSegmentsGeometry(), planeLine(PLANE_STYLE.GRID_PX));
    this.normalLine = new Line2(new LineGeometry(), planeLine(PLANE_STYLE.NORMAL_PX));
    this.dot = new THREE.Points(new THREE.BufferGeometry(), dotMaterial(PLANE_STYLE.DOT_PX * (viewer?.renderer.getPixelRatio() ?? 1)));
    this.fill.renderOrder = ORDER.fill;
    this.grid.renderOrder = ORDER.grid;
    this.edge.renderOrder = ORDER.edge;
    this.normalLine.renderOrder = ORDER.normal;
    this.dot.renderOrder = ORDER.normal;
    for (const o of [this.fill, this.edge, this.grid, this.normalLine, this.dot]) o.frustumCulled = false;
    this.root.add(this.fill, this.grid, this.edge, this.normalLine, this.dot);
    this.root.visible = false;
  }

  /**
   * Its rounded rectangle, from the plane, its section (or a curve's points) and the model's box; made anew only when they change
   * (the section arriving changes it at once, without a fade).
   */
  setShape(input: PlaneShapeInput, origin: Vec3): void {
    const key = JSON.stringify([input.point, input.normal, input.box, input.frameX, origin]);
    if (key === this.shapeKey && input.lines === this.shapeLines) return;
    this.shapeKey = key;
    this.shapeLines = input.lines;
    const s = planeShape(input);
    this.shape = s;
    this.root.visible = !!s;
    if (!s) return;
    // the fill: a fan from the centre round the outline
    const outline = roundedRectOutline(s, PLANE_STYLE.CORNER_SEGMENTS);
    const pos = new Float32Array(3 * (outline.length + 1));
    pos.set(flatten([s.center, ...outline], origin));
    const idx: number[] = [];
    for (let i = 1; i <= outline.length; i++) idx.push(0, i, i === outline.length ? 1 : i + 1);
    const fill = new THREE.BufferGeometry();
    fill.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    fill.setIndex(idx);
    this.fill.geometry.dispose();
    this.fill.geometry = fill;
    const edge = new LineGeometry();
    edge.setPositions(flatten([...outline, outline[0]], origin));
    this.edge.geometry.dispose();
    this.edge.geometry = edge;
    const grid = new LineSegmentsGeometry();
    if (s.grid.length) grid.setPositions(flatten(s.grid.flat(), origin));
    this.grid.geometry.dispose();
    this.grid.geometry = grid;
    const tip: Vec3 = [s.center[0] + s.normalLength * s.normal[0], s.center[1] + s.normalLength * s.normal[1], s.center[2] + s.normalLength * s.normal[2]];
    const normal = new LineGeometry();
    normal.setPositions(flatten([s.center, tip], origin));
    this.normalLine.geometry.dispose();
    this.normalLine.geometry = normal;
    const dot = new THREE.BufferGeometry();
    dot.setAttribute('position', new THREE.BufferAttribute(new Float32Array(flatten([tip], origin)), 3));
    this.dot.geometry.dispose();
    this.dot.geometry = dot;
    this.apply(this.now);
  }

  setColor(color: string): void {
    const c = new THREE.Color(color);
    (this.fill.material as THREE.MeshBasicMaterial).color.copy(c);
    for (const l of [this.edge, this.grid, this.normalLine]) (l.material as LineMaterial).color.copy(c);
    (this.dot.material as THREE.ShaderMaterial).uniforms.color.value.copy(c);
  }

  /**
   * Another look: its opacities fade there in PLANE_STYLE.FADE_MS (the interface's easing), frames drawn only meanwhile; at once when
   * `animate` is false, while the view is dragged, or with reduced motion (`Viewer.tween`).
   */
  setLook(look: PlaneLook, animate: boolean): void {
    if (look === this.look) return;
    const from = { ...this.now }, to = PLANE_LOOKS[look];
    this.look = look;
    const mine = ++this.fading;
    if (!animate || !this.viewer || this.viewer.pressed) {
      this.apply(to);
      this.viewer?.requestRender();
      return;
    }
    this.viewer.tween(PLANE_STYLE.FADE_MS, (k) => {
      if (mine !== this.fading) return;
      const f = k >= 1 ? 1 : EASE(k);
      this.apply({ fill: from.fill + (to.fill - from.fill) * f, edge: from.edge + (to.edge - from.edge) * f, grid: from.grid + (to.grid - from.grid) * f, normal: from.normal + (to.normal - from.normal) * f });
    });
  }

  private apply(o: { fill: number; edge: number; grid: number; normal: number }): void {
    this.now = { ...o };
    (this.fill.material as THREE.MeshBasicMaterial).opacity = o.fill;
    (this.edge.material as LineMaterial).opacity = o.edge;
    (this.grid.material as LineMaterial).opacity = o.grid;
    (this.normalLine.material as LineMaterial).opacity = o.normal;
    (this.dot.material as THREE.ShaderMaterial).uniforms.opacity.value = o.normal;
    this.grid.visible = o.grid > 1e-3 && !!this.shape?.grid.length;
    this.normalLine.visible = this.dot.visible = o.normal > 1e-3;
  }

  setSections(lines: Polyline[] | null, color: string, selected: boolean, origin: Vec3): void {
    if (lines === this.sectionKey) {
      for (const s of this.sections) s.style(color, selected ? SECTION_WIDTH_SELECTED : SECTION_WIDTH, false, 1, SECTION_HALO);
      return;
    }
    this.sectionKey = lines;
    for (const s of this.sections) {
      s.dispose();
      this.root.remove(s.root);
    }
    this.sections = (lines ?? []).map((l) => {
      const v = new CurveVisual(false);
      v.setPoints(l.points, l.closed, origin);
      v.style(color, selected ? SECTION_WIDTH_SELECTED : SECTION_WIDTH, false, 1, SECTION_HALO);
      this.root.add(v.root);
      return v;
    });
  }

  /** What is drawn now (tests). */
  info(): PlaneStyleInfo | null {
    const s = this.shape;
    if (!s) return null;
    return {
      center: s.center,
      u: s.u,
      halfWidth: s.halfWidth,
      halfHeight: s.halfHeight,
      radius: s.radius,
      gridLines: this.grid.visible ? s.grid.length : 0,
      fill: this.now.fill,
      edge: this.now.edge,
      grid: this.now.grid,
      normal: this.normalLine.visible,
      look: this.look,
      from: s.from,
    };
  }

  dispose(): void {
    this.fading++;
    for (const o of [this.fill, this.edge, this.grid, this.normalLine, this.dot]) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    for (const s of this.sections) s.dispose();
  }
}

/** Draws fitted planes (measure and present modes). */
export class PlaneLayer {
  readonly group = new THREE.Group();
  private visuals = new Map<string, PlaneVisual>();
  private origin: Vec3 = [0, 0, 0];

  constructor(private readonly viewer: Viewer) {
    this.group.name = 'planes';
    viewer.overlay.add(this.group);
  }

  setOrigin(origin: Vec3): void {
    this.origin = [origin[0], origin[1], origin[2]];
    this.group.position.set(origin[0], origin[1], origin[2]);
    this.group.updateMatrixWorld(true);
  }

  /**
   * `present`: the present mode (no selection: the figure's look). `bbox`: the model's bounding box (original coordinates), for a
   * plane whose section is not there; `sections`: the section of the model by each plane (when computed); `frameX`: the specimen
   * frame's x axis, the direction of a round section's rectangle.
   */
  sync(
    planes: readonly Plane[],
    results: PlaneResult[],
    selected: string | null,
    shown: boolean,
    present: boolean,
    bbox: { min: Vec3; max: Vec3 } | null,
    sections: (id: string) => Polyline[] | null,
    frameX: Vec3 | null,
  ): void {
    this.group.visible = shown;
    const seen = new Set<string>();
    for (const r of results) {
      const plane = planes.find((p) => p.id === r.id);
      if (!plane || !plane.visible || !r.valid || !bbox) continue;
      seen.add(r.id);
      let v = this.visuals.get(r.id);
      const fresh = !v;
      if (!v) {
        v = new PlaneVisual(this.viewer);
        this.visuals.set(r.id, v);
        this.group.add(v.root);
      }
      const isSel = r.id === selected;
      const color = planeColor(r.label);
      const lines = sections(r.id);
      v.setShape({ point: r.center!, normal: r.normal!, lines, box: bbox, frameX }, this.origin);
      v.setColor(color);
      // (a plane that comes into view is there as it is; selecting one, or letting it go, fades)
      v.setLook(present ? 'figure' : isSel ? 'selected' : 'idle', !fresh && shown);
      v.setSections(lines, color, isSel && !present, this.origin);
    }
    for (const [id, v] of this.visuals) {
      if (!seen.has(id)) {
        v.dispose();
        this.group.remove(v.root);
        this.visuals.delete(id);
      }
    }
    this.viewer.requestRender();
  }

  /** What a plane's drawing shows now (tests); null when it is not drawn. */
  info(id: string): PlaneStyleInfo | null {
    return this.group.visible ? (this.visuals.get(id)?.info() ?? null) : null;
  }

  clearAll(): void {
    for (const v of this.visuals.values()) {
      v.dispose();
      this.group.remove(v.root);
    }
    this.visuals.clear();
  }
}

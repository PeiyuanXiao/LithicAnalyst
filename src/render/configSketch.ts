import * as THREE from 'three';
import type { Line2 } from 'three/examples/jsm/lines/Line2.js';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { isBicone, type BiconeResult, type CoreConfiguration } from '../compute/bicone';
import type { ConfigurationResult } from '../compute/configuration';
import type { BiconeCone, ConfigFace } from '../core/fields';
import type { Scar, Vec3 } from '../core/types';
import type { ConfigPick } from '../ui/appApi';
import { arrowPath, biconeArrows, biconeGeometries, biconeOutline, biconeSize, fitOutline, onCone, rimPoints, type BiconeArrow, type BiconeSize } from './biconeShape';
import { edgeBand, edgeMidlines, faceCentre, faceNormal, facesViewer, fatLine, GROUP_FACES, radiusOf, readPalette, roleColor, roundedBox, shapeSize, sketchArrows, type ConfigPalette, type SketchArrow } from './configShape';

/** Opacity of a face of each role (both = a flaking surface, with a platform band). */
const FACE_OPACITY = { flaking: 0.35, both: 0.35, platform: 0.3, none: 0.12 } as const;
/** A picked cone is drawn this much more opaque. */
const PICKED_CONE = 0.15;
const BAND_OPACITY = 0.6;
/** Arrows float this far off their face (share of the longest side). */
const HOVER = 0.025;
/** Shaft radius (share of the longest side); the head is this many shaft radii wide, its length a share of the arrow (at most HEAD_MAX of the longest side). */
const SHAFT = 0.006;
const HEAD_WIDTH = 2.6;
const HEAD_SHARE = 0.18;
const HEAD_MAX = 0.05;
/** Arrows on faces turned away are seen through the box; scars on faces that are no flaking surface are not counted. */
const BACK_ARROW_OPACITY = 0.3;
const UNCOUNTED_OPACITY = 0.45;
const SHADOW_OPACITY = 0.18;
/** Where shadows fall on a face (box coordinates): down, to the right and back. */
const SHADOW_CAST = new THREE.Vector3(0.45, -1, -0.35).normalize();
/** From the front, the right and above: the default view of the box (double click). */
const HOME = new THREE.Vector3(1, 0.8, 1.5).normalize();
/** From the front, about 35° above the base: the default view of the bicone. */
const HOME_BICONE = new THREE.Vector3(0, Math.sin(THREE.MathUtils.degToRad(35)), Math.cos(THREE.MathUtils.degToRad(35)));
/** The bicone's width takes at most this share of the canvas, its height at most OUTLINE_HEIGHT (as large as that in its default view). */
const OUTLINE_WIDTH = 0.85;
const OUTLINE_HEIGHT = 0.92;
/** The bicone's rim and apexes are rounded this much (share of the radius). */
const RIM_ROUND = 0.06;
const APEX_ROUND = 0.12;
/** The base's rim is drawn a little plainer than the box's edges. */
const RIM_WIDTH = 1.6;
const RIM_SEEN = 0.6;
const RIM_BEHIND = 0.2;
const RIM_SEGMENTS = 36;
const ASPECT = 330 / 210;
/** The bicone is wide and low: so is its canvas. */
const ASPECT_BICONE = 300 / 160;
/** A click this close to an arrow (CSS pixels) picks its scar. */
const PICK_PX = 6;

/** The arrows of one face, counted or not: one instanced mesh per part. */
interface ArrowBucket {
  face: ConfigFace;
  counted: boolean;
  arrows: SketchArrow[];
  parts: THREE.InstancedMesh[];
  shadow: THREE.InstancedMesh;
}

/** One arrow on a cone: its own mesh (shaft, tail and head merged) and shadow, and the cone's normal at its middle. */
interface ConeArrow {
  arrow: BiconeArrow;
  mesh: THREE.Mesh;
  shadow: THREE.Mesh;
  normal: THREE.Vector3;
}

/** A soft dark ellipse, the shadow under a floating arrow. */
function shadowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const arrowMaterial = (opacity: number, vertexColors = false) =>
  new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, vertexColors });

/** Arrow materials seen / through the shape × counted / not. */
const arrowMaterials = (vertexColors: boolean) => ({
  front: [arrowMaterial(1, vertexColors), arrowMaterial(UNCOUNTED_OPACITY, vertexColors)],
  back: [arrowMaterial(BACK_ARROW_OPACITY, vertexColors), arrowMaterial(BACK_ARROW_OPACITY * UNCOUNTED_OPACITY, vertexColors)],
});

const isCone = (p: ConfigPick | null): p is BiconeCone => p === 'upper' || p === 'lower';

/**
 * The volumetric configuration as a small 3D sketch (floating panel): a
 * transparent rounded box in the model's proportions, its faces coloured by
 * role, or for the bicone two cones on one base; and one arrow floating over
 * its face or cone for every scar with an arrow. Drawn only when it changes or
 * is turned (its own small canvas, not the main loop). Drag turns it, a double
 * click or another model goes back to the default view, a click on an arrow
 * picks its scar, elsewhere on a face (or cone) the face.
 */
export class ConfigSketch {
  readonly canvas: HTMLCanvasElement;
  /** A face or cone was clicked. */
  onPick: (face: ConfigPick) => void = () => {};
  /** An arrow was clicked. */
  onPickScar: (id: string) => void = () => {};
  /** How many times it was drawn. */
  renders = 0;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(26, ASPECT, 0.05, 50);
  private readonly root = new THREE.Group();
  private palette: ConfigPalette = readPalette();
  private shape: THREE.Group | null = null;
  private front: THREE.Mesh | null = null;
  private edges: Array<{ faces: [ConfigFace, ConfigFace]; line: Line2 }> = [];
  private buckets: ArrowBucket[] = [];
  /** The bicone: each cone (its near side, for picking, and its two materials), its arrows, and the rim seen and behind. */
  private cones: Array<{ cone: BiconeCone; front: THREE.Mesh; mats: THREE.MeshStandardMaterial[]; opacity: number }> = [];
  private coneArrows: ConeArrow[] = [];
  private rim: { seen: Line2; behind: Line2; radius: number } | null = null;
  private drawn: BiconeSize | null = null;
  /** Each drawn arrow as lifted (a line over its face, or a path over its cone) and the outward normal under its middle. */
  private lifted = new Map<string, { points: THREE.Vector3[]; normal: THREE.Vector3 }>();
  private result: CoreConfiguration | null = null;
  private scars: readonly Scar[] = [];
  private curve: readonly Vec3[] | null = null;
  private selected: ConfigPick | null = null;
  private selectedScar: string | null = null;
  private key = '';
  /** The model drawn last (kept while there is nothing to draw): another one starts from its default view. */
  private model: 'box' | 'bicone' | null = null;
  private readonly shadowMap = shadowTexture();
  private readonly mats = {
    ...arrowMaterials(false),
    shadow: [SHADOW_OPACITY, SHADOW_OPACITY * UNCOUNTED_OPACITY].map((opacity) => new THREE.MeshBasicMaterial({ map: this.shadowMap, color: 0x000000, transparent: true, opacity, depthWrite: false })),
  };
  /** The bicone's arrows are single meshes, coloured by their vertices. */
  private readonly coneMats = arrowMaterials(true);
  private readonly unit = {
    shaft: new THREE.CylinderGeometry(1, 1, 1, 14),
    tail: new THREE.SphereGeometry(1, 14, 8),
    head: new THREE.ConeGeometry(1, 1, 20),
    shadow: new THREE.PlaneGeometry(1, 1),
  };
  private drag: { x: number; y: number; moved: boolean } | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'config-sketch';
    this.canvas.id = 'config-sketch';
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setClearColor(0x000000, 0);
    } catch {
      this.renderer = null;
    }
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-1.2, 2, 1.5);
    this.camera.add(key);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.5), this.camera, this.root);
    this.home();
    this.wire();
    // the panel's width (also when it is first shown or opened)
    new ResizeObserver(() => this.resize()).observe(this.canvas);
  }

  /**
   * What to draw: the configuration (null: nothing), the scars, the selected face or cone, the
   * selected scar, and (for the bicone) the points of the curve its base is on.
   */
  set(result: CoreConfiguration | null, scars: readonly Scar[], selected: ConfigPick | null, selectedScar: string | null, curve: readonly Vec3[] | null = null): void {
    this.result = result;
    this.scars = scars;
    this.selected = selected;
    const model = isBicone(result) ? 'bicone' : result ? 'box' : this.model;
    if (model !== this.model) {
      this.model = model;
      this.root.quaternion.identity();
    }
    const arrows = scars.filter((s) => s.vector).map((s) => [s.id, s.vector!.start, s.vector!.end]);
    let key = '';
    if (isBicone(result))
      key = JSON.stringify(['bicone', result.radius, result.upperHeight, result.lowerHeight, result.plane, result.reference, result.cones.map((c) => c.role), result.scars, arrows]);
    else if (result) key = JSON.stringify(['box', result.min, result.max, result.axes, result.faces.map((f) => f.role), result.scars, arrows]);
    if (key !== this.key || (isBicone(result) && curve !== this.curve)) {
      this.key = key;
      this.curve = curve;
      this.selectedScar = selectedScar;
      this.build();
      this.resize();
    } else if (selectedScar !== this.selectedScar) {
      this.selectedScar = selectedScar;
      this.paintArrows();
    }
    this.render();
  }

  /** The theme changed: take its colours. */
  repaint(): void {
    this.palette = readPalette();
    this.build();
    this.render();
  }

  /** Back to the default view: the box from the front, the right and above (+Y up); the bicone from the front, a little above. */
  home(): void {
    this.root.quaternion.identity();
    this.frameOutline();
    this.render();
  }

  /** Arrows drawn (one per scar with an arrow). */
  arrowCount(): number {
    return this.lifted.size;
  }

  /** Where a face's centre (or a point halfway up a cone, on the side toward the viewer) is on the page; null when it faces away or nothing is drawn. */
  faceCentreClient(face: ConfigPick): { x: number; y: number } | null {
    const r = this.result;
    if (!r || !this.shape) return null;
    const toCamera = this.toCamera();
    if (isBicone(r)) {
      if (!isCone(face) || !this.drawn) return null;
      const across = new THREE.Vector2(toCamera.x, toCamera.z);
      if (across.lengthSq() < 1e-6) across.set(0, 1);
      across.setLength(0.5 * this.drawn.radius);
      const c = onCone(this.drawn, face, across.x, across.y);
      return c.normal.dot(toCamera) > 1e-6 ? this.client(c.point) : null;
    }
    if (isCone(face) || !facesViewer(face, toCamera)) return null;
    return this.client(faceCentre(face, shapeSize(r, 0.2)));
  }

  /** The bicone's width on the page, as it is turned now (null without a bicone). */
  outlineWidth(): number | null {
    const rim = this.rim;
    if (!rim) return null;
    const xs = rimPoints(rim.radius).map((p) => this.client(p).x);
    return Math.max(...xs) - Math.min(...xs);
  }

  /** The bicone's whole outline on the page, as it is turned now (null without a bicone). */
  outlineBox(): { left: number; right: number; top: number; bottom: number } | null {
    if (!this.rim || !this.drawn) return null;
    const ps = biconeOutline(this.drawn, this.rim.radius).map((p) => this.client(p));
    return { left: Math.min(...ps.map((p) => p.x)), right: Math.max(...ps.map((p) => p.x)), top: Math.min(...ps.map((p) => p.y)), bottom: Math.max(...ps.map((p) => p.y)) };
  }

  /** Where the middle of a scar's arrow is on the page (null when it is not drawn or faces away). */
  arrowClient(id: string): { x: number; y: number } | null {
    const a = this.lifted.get(id);
    if (!a || a.normal.dot(this.toCamera()) <= 1e-6) return null;
    return this.client(midpoint(a.points));
  }

  /**
   * Fit the canvas to the room it gets: as wide as its wrapper, as high as the
   * shape's aspect asks for when the panel has the room, less when it has not.
   */
  resize(): void {
    const wrap = this.canvas.parentElement;
    const w = wrap?.clientWidth ?? 0;
    if (!this.renderer || !wrap || w <= 0) return;
    wrap.style.flexBasis = `${Math.round(w / (isBicone(this.result) ? ASPECT_BICONE : ASPECT))}px`;
    const h = wrap.clientHeight;
    const now = this.renderer.getSize(new THREE.Vector2());
    if (h > 0 && (now.x !== w || now.y !== h)) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      // the bicone is framed by its outline on this canvas
      this.frameOutline();
    }
    // also when it is shown again (what changed while it was folded was not drawn)
    this.render();
  }

  render(): void {
    const r = this.renderer;
    if (!r || !this.canvas.isConnected || this.canvas.clientWidth === 0) return;
    this.root.updateMatrixWorld(true);
    // what faces the viewer is drawn plainly; what is behind, through the shape
    const toCamera = this.toCamera();
    for (const e of this.edges) {
      const m = e.line.material as LineMaterial;
      const sel = !!this.selected && !isCone(this.selected) && e.faces.includes(this.selected);
      const seen = e.faces.some((f) => facesViewer(f, toCamera));
      m.color.copy(sel ? this.palette.accent : this.palette.ink);
      m.opacity = sel ? 1 : seen ? 0.45 : 0.15;
      m.linewidth = sel ? 2.4 : 1.2;
    }
    for (const b of this.buckets) {
      const seen = facesViewer(b.face, toCamera);
      const mat = (seen ? this.mats.front : this.mats.back)[b.counted ? 0 : 1];
      for (const p of b.parts) {
        p.material = mat;
        p.renderOrder = seen ? 0 : 1;
      }
      b.shadow.visible = seen;
    }
    this.renderBicone(toCamera);
    r.render(this.scene, this.camera);
    this.renders++;
  }

  dispose(): void {
    this.clearShape();
    for (const g of Object.values(this.unit)) g.dispose();
    for (const m of [...this.mats.front, ...this.mats.back, ...this.mats.shadow, ...this.coneMats.front, ...this.coneMats.back]) m.dispose();
    this.shadowMap.dispose();
    this.renderer?.dispose();
  }

  /** The bicone's view-dependent parts: the arrows seen or through the cones, the rim's near and far half, the picked cone. */
  private renderBicone(toCamera: THREE.Vector3): void {
    for (const a of this.coneArrows) {
      const seen = a.normal.dot(toCamera) > 1e-6;
      a.mesh.material = (seen ? this.coneMats.front : this.coneMats.back)[a.arrow.counted ? 0 : 1];
      a.mesh.renderOrder = seen ? 0 : 1;
      a.shadow.visible = seen;
    }
    for (const c of this.cones) for (const m of c.mats) m.opacity = c.opacity + (this.selected === c.cone ? PICKED_CONE : 0);
    const rim = this.rim;
    if (!rim) return;
    // the near half faces the viewer (seen from straight above or below, all of it does)
    const across = Math.hypot(toCamera.x, toCamera.z);
    const mid = Math.atan2(toCamera.z, toCamera.x);
    const picked = isCone(this.selected);
    const halves = [
      [rim.seen, mid - Math.PI / 2, RIM_SEEN],
      [rim.behind, mid + Math.PI / 2, across > 0.05 ? RIM_BEHIND : RIM_SEEN],
    ] as const;
    for (const [line, from, opacity] of halves) {
      setLinePoints(line, rimPoints(rim.radius, from, from + Math.PI, RIM_SEGMENTS));
      const m = line.material as LineMaterial;
      m.color.copy(picked ? this.palette.accent : this.palette.ink);
      m.opacity = picked ? 1 : opacity;
      m.linewidth = picked ? 2.4 : RIM_WIDTH;
    }
  }

  /** From the shape's centre toward the eye, in its own coordinates. */
  private toCamera(): THREE.Vector3 {
    return this.camera.position.clone().applyQuaternion(this.root.quaternion.clone().invert()).normalize();
  }

  /** A point of the sketch (its own coordinates) on the page. */
  private client(p: THREE.Vector3): { x: number; y: number } {
    this.root.updateMatrixWorld(true);
    const v = this.root.localToWorld(p.clone()).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  private clearShape(): void {
    if (!this.shape) return;
    this.root.remove(this.shape);
    const keep = new Set<unknown>([...Object.values(this.unit), ...this.mats.front, ...this.mats.back, ...this.mats.shadow, ...this.coneMats.front, ...this.coneMats.back]);
    this.shape.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!(o instanceof THREE.Mesh) && !(o as Line2).isLine2) return;
      if (!keep.has(m.geometry)) m.geometry.dispose();
      for (const x of Array.isArray(m.material) ? m.material : [m.material]) if (!keep.has(x)) x.dispose();
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    this.shape = null;
    this.front = null;
    this.edges = [];
    this.buckets = [];
    this.cones = [];
    this.coneArrows = [];
    this.rim = null;
    this.drawn = null;
    this.lifted.clear();
  }

  private build(): void {
    this.clearShape();
    const res = this.result;
    if (!res) return;
    if (isBicone(res)) this.buildBicone(res);
    else this.buildBox(res);
  }

  /** Point the camera from `dir` at the centre, far enough to see a sphere of radius `reach` however the shape is turned. */
  private frame(dir: THREE.Vector3, reach: number): void {
    this.camera.position.copy(dir).multiplyScalar((reach / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.02);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
  }

  private buildBox(res: ConfigurationResult): void {
    const p = this.palette;
    const size = shapeSize(res, 0.2);
    const radius = radiusOf(size, 0.12);
    const shape = new THREE.Group();
    const geometry = roundedBox(size, radius);
    const roleOf = (f: ConfigFace) => res.faces.find((x) => x.face === f)!.role;
    // inside first, then the near side, neither writing depth: every face shows through
    const faceMats = (side: THREE.Side) =>
      GROUP_FACES.map((f) => new THREE.MeshStandardMaterial({ color: roleColor(p, roleOf(f)), transparent: true, opacity: FACE_OPACITY[roleOf(f)], depthWrite: false, side, roughness: 0.6, metalness: 0 }));
    const back = new THREE.Mesh(geometry, faceMats(THREE.BackSide));
    back.renderOrder = 0;
    const front = new THREE.Mesh(geometry.clone(), faceMats(THREE.FrontSide));
    front.renderOrder = 2;
    shape.add(back, front);
    this.front = front;
    // a flaking surface that is also a platform: the platform's colour along its edges
    for (const f of GROUP_FACES.filter((x) => roleOf(x) === 'both')) {
      const band = new THREE.Mesh(edgeBand(f, size, radius, 0.002), new THREE.MeshStandardMaterial({ color: p.platform, transparent: true, opacity: BAND_OPACITY, depthWrite: false, side: THREE.DoubleSide, roughness: 0.6, metalness: 0 }));
      band.renderOrder = 2;
      shape.add(band);
    }
    for (const e of edgeMidlines(size, radius)) {
      const line = fatLine(e.points, 1.2);
      line.renderOrder = 3;
      shape.add(line);
      this.edges.push({ faces: e.faces, line });
    }
    this.buildArrows(shape, sketchArrows(res, this.scars, size, radius), Math.max(size.x, size.y, size.z));
    this.root.add(shape);
    this.shape = shape;
    this.paintArrows();
    // the whole box in view however it is turned
    this.frame(HOME, 0.5 * size.length() + HOVER + 0.02);
  }

  /**
   * The bicone: two transparent cones on a round base in the proportions of the
   * model (each at least a tenth of the radius high), coloured by role, the rim
   * drawn in ink; an arrow along its cone for every scar.
   */
  private buildBicone(res: BiconeResult): void {
    const p = this.palette;
    const s = biconeSize(res);
    this.drawn = s;
    const shape = new THREE.Group();
    const geo = biconeGeometries(s, RIM_ROUND * s.radius, APEX_ROUND * s.radius);
    for (const cone of ['upper', 'lower'] as const) {
      const role = res.cones.find((c) => c.cone === cone)!.role;
      const opacity = FACE_OPACITY[role];
      const mats = [THREE.BackSide, THREE.FrontSide].map(
        (side) => new THREE.MeshStandardMaterial({ color: role === 'flaking' ? p.flaking : p.none, transparent: true, opacity, depthWrite: false, side, roughness: 0.6, metalness: 0 }),
      );
      const g = cone === 'upper' ? geo.upper : geo.lower;
      const back = new THREE.Mesh(g, mats[0]);
      back.renderOrder = 0;
      const front = new THREE.Mesh(g.clone(), mats[1]);
      front.renderOrder = 2;
      shape.add(back, front);
      this.cones.push({ cone, front, mats, opacity });
    }
    // two half circles, moved round to face the viewer each time it is drawn
    const seen = fatLine(rimPoints(geo.rim, 0, Math.PI, RIM_SEGMENTS), RIM_WIDTH), behind = fatLine(rimPoints(geo.rim, Math.PI, 2 * Math.PI, RIM_SEGMENTS), RIM_WIDTH);
    seen.renderOrder = behind.renderOrder = 3;
    seen.frustumCulled = behind.frustumCulled = false;
    shape.add(seen, behind);
    this.rim = { seen, behind, radius: geo.rim };
    const curve = this.curve ?? [];
    if (curve.length >= 3) this.buildConeArrows(shape, biconeArrows(res, curve, this.scars, s));
    this.root.add(shape);
    this.shape = shape;
    this.paintArrows();
    this.frameOutline();
  }

  /**
   * The bicone framed by its outline as projected now: centred however it is turned,
   * as large as in its default view, and smaller only as far as it must be to stay
   * inside the canvas. The camera moves sideways and back; it never turns.
   */
  private frameOutline(): void {
    if (!this.drawn || !this.rim) return;
    const dir = HOME_BICONE;
    const view = { right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, dir.z, -dir.y), dir, tanV: Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)), aspect: this.camera.aspect };
    const outline = biconeOutline(this.drawn, this.rim.radius);
    const { distance } = fitOutline(outline, view, OUTLINE_WIDTH, OUTLINE_HEIGHT);
    for (const p of outline) p.applyQuaternion(this.root.quaternion);
    const fit = fitOutline(outline, view, OUTLINE_WIDTH, OUTLINE_HEIGHT, distance);
    const centre = new THREE.Vector3().addScaledVector(view.right, fit.x).addScaledVector(view.up, fit.y);
    this.camera.position.copy(centre).addScaledVector(dir, fit.distance);
    this.camera.lookAt(centre);
    this.camera.updateMatrixWorld();
  }

  /**
   * The arrows, floating over their faces: round shaft and tail, cone head, and
   * a shadow on the face beside each. One instanced mesh per part, face and
   * whether the scars count, however many scars there are.
   */
  private buildArrows(shape: THREE.Group, arrows: SketchArrow[], longest: number): void {
    const groups = new Map<string, SketchArrow[]>();
    for (const a of arrows) {
      const k = `${a.face}|${a.counted}`;
      groups.set(k, [...(groups.get(k) ?? []), a]);
    }
    const r = SHAFT * longest, headR = HEAD_WIDTH * r, hover = HOVER * longest;
    const Y = new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3();
    for (const list of groups.values()) {
      const { face, counted } = list[0];
      const n = faceNormal(face);
      const mat = this.mats.front[counted ? 0 : 1];
      const parts = [this.unit.shaft, this.unit.tail, this.unit.head].map((g) => new THREE.InstancedMesh(g, mat, list.length));
      const shadow = new THREE.InstancedMesh(this.unit.shadow, this.mats.shadow[counted ? 0 : 1], list.length);
      list.forEach((a, i) => {
        const start = a.start.clone().addScaledVector(n, hover), end = a.end.clone().addScaledVector(n, hover);
        this.lifted.set(a.id, { points: [start, end], normal: n });
        const dir = end.clone().sub(start);
        const length = dir.length();
        dir.normalize();
        const headLen = headLength(length, headR, longest);
        const shaftLen = length - headLen;
        q.setFromUnitVectors(Y, dir);
        parts[0].setMatrixAt(i, m.compose(pos.copy(start).addScaledVector(dir, shaftLen / 2), q, s.set(r, shaftLen, r)));
        parts[1].setMatrixAt(i, m.compose(start, q, s.set(r, r, r)));
        parts[2].setMatrixAt(i, m.compose(pos.copy(start).addScaledVector(dir, shaftLen + headLen / 2), q, s.set(headR, headLen, headR)));
        // the shadow lies on the face, drawn out along the arrow, cast away from the light (upper left, in front): beside the arrow, it reads as floating
        const across = new THREE.Vector3().crossVectors(n, dir);
        const sq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, across, n));
        const cast = SHADOW_CAST.clone().addScaledVector(n, -SHADOW_CAST.dot(n));
        if (cast.lengthSq() > 1e-6) cast.normalize().multiplyScalar(0.8 * hover);
        const centre = a.start.clone().lerp(a.end, 0.5).addScaledVector(n, 0.003).add(cast);
        shadow.setMatrixAt(i, m.compose(centre, sq, s.set(length * 1.1, 8 * r, 1)));
      });
      shadow.renderOrder = 4;
      for (const p of parts) {
        p.instanceMatrix.needsUpdate = true;
        p.computeBoundingSphere();
      }
      shape.add(...parts, shadow);
      this.buckets.push({ face, counted, arrows: list, parts, shadow });
    }
  }

  /**
   * The bicone's arrows, each bent along its cone: a tube up to the head, a
   * round tail, a cone head along the path's last stretch (merged into one mesh),
   * and a soft shadow lying on the cone beside it.
   */
  private buildConeArrows(shape: THREE.Group, arrows: BiconeArrow[]): void {
    const s = this.drawn!;
    const r = SHAFT, headR = HEAD_WIDTH * r, hover = HOVER;
    const Y = new THREE.Vector3(0, 1, 0);
    for (const a of arrows) {
      const path = arrowPath(s, a, hover);
      const pts = path.points;
      const lengths = [0];
      for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + pts[i].distanceTo(pts[i - 1]));
      const length = lengths[lengths.length - 1];
      if (!(length > 0)) continue;
      const headLen = headLength(length, headR, 1);
      // the shaft ends where the head begins
      const cutAt = length - headLen;
      const k = Math.max(1, lengths.findIndex((l) => l >= cutAt));
      const cut = pts[k - 1].clone().lerp(pts[k], (cutAt - lengths[k - 1]) / Math.max(1e-12, lengths[k] - lengths[k - 1]));
      const shaft = [...pts.slice(0, k), cut];
      const end = pts[pts.length - 1];
      const dir = end.clone().sub(cut).normalize();
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(shaft), Math.max(2, shaft.length * 2), r, 10, false);
      const tail = new THREE.SphereGeometry(r, 14, 8).translate(pts[0].x, pts[0].y, pts[0].z);
      const head = new THREE.ConeGeometry(headR, headLen, 20).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, dir));
      head.translate(cut.x + (dir.x * headLen) / 2, cut.y + (dir.y * headLen) / 2, cut.z + (dir.z * headLen) / 2);
      const parts = [tube, tail, head];
      const merged = mergeGeometries(parts)!;
      for (const g of parts) g.dispose();
      merged.setAttribute('color', new THREE.BufferAttribute(new Float32Array(merged.getAttribute('position').count * 3).fill(1), 3));
      const mesh = new THREE.Mesh(merged, this.coneMats.front[a.counted ? 0 : 1]);
      const mid = Math.floor(pts.length / 2);
      const normal = path.normals[mid].clone();
      this.lifted.set(a.id, { points: pts, normal });
      const shadow = new THREE.Mesh(shadowRibbon(path.surface, path.normals, 8 * r, 0.8 * hover), this.mats.shadow[a.counted ? 0 : 1]);
      shadow.renderOrder = 4;
      shape.add(mesh, shadow);
      this.coneArrows.push({ arrow: a, mesh, shadow, normal });
    }
  }

  /** Ink, the selected scar's arrow in the selection colour. */
  private paintArrows(): void {
    for (const b of this.buckets)
      for (const p of b.parts) {
        b.arrows.forEach((a, i) => p.setColorAt(i, a.id === this.selectedScar ? this.palette.accent : this.palette.ink));
        if (p.instanceColor) p.instanceColor.needsUpdate = true;
      }
    for (const a of this.coneArrows) {
      const c = a.arrow.id === this.selectedScar ? this.palette.accent : this.palette.ink;
      const attr = a.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      for (let i = 0; i < attr.count; i++) attr.setXYZ(i, c.r, c.g, c.b);
      attr.needsUpdate = true;
    }
  }

  /** The scar whose arrow is nearest the click within a few pixels (those in front first). */
  private pickScarAt(clientX: number, clientY: number): string | null {
    const toCamera = this.toCamera();
    let best: { id: string; d: number; seen: boolean } | null = null;
    for (const [id, a] of this.lifted) {
      let d = Infinity;
      let p = this.client(a.points[0]);
      for (let i = 1; i < a.points.length; i++) {
        const q = this.client(a.points[i]);
        const dx = q.x - p.x, dy = q.y - p.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? THREE.MathUtils.clamp(((clientX - p.x) * dx + (clientY - p.y) * dy) / len2, 0, 1) : 0;
        d = Math.min(d, Math.hypot(clientX - p.x - t * dx, clientY - p.y - t * dy));
        p = q;
      }
      const seen = a.normal.dot(toCamera) > 1e-6;
      if (d > PICK_PX) continue;
      if (!best || (seen && !best.seen) || (seen === best.seen && d < best.d)) best = { id, d, seen };
    }
    return best?.id ?? null;
  }

  private pickAt(clientX: number, clientY: number): ConfigPick | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    if (this.cones.length) {
      const hit = ray.intersectObjects(this.cones.map((c) => c.front), false)[0];
      return hit ? (this.cones.find((c) => c.front === hit.object)?.cone ?? null) : null;
    }
    if (!this.front) return null;
    const hit = ray.intersectObject(this.front, false)[0];
    return hit?.face ? (GROUP_FACES[hit.face.materialIndex] ?? null) : null;
  }

  private wire(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.drag = { x: e.clientX, y: e.clientY, moved: false };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      d.x = e.clientX;
      d.y = e.clientY;
      // turn about the screen's vertical and horizontal
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const q = new THREE.Quaternion().setFromAxisAngle(up, dx * 0.012).multiply(new THREE.Quaternion().setFromAxisAngle(right, dy * 0.012));
      this.root.quaternion.premultiply(q);
      this.frameOutline();
      this.render();
    });
    const end = (e: PointerEvent) => {
      const d = this.drag;
      this.drag = null;
      if (!d || d.moved || e.type === 'pointercancel') return;
      const scar = this.pickScarAt(e.clientX, e.clientY);
      if (scar) return this.onPickScar(scar);
      const face = this.pickAt(e.clientX, e.clientY);
      if (face) this.onPick(face);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('dblclick', () => this.home());
  }
}

/** The head's length: a share of the arrow, at least a little longer than it is wide, at most a share of the longest side and of the arrow. */
const headLength = (length: number, headR: number, longest: number) => Math.min(Math.max(HEAD_SHARE * length, 1.8 * headR), HEAD_MAX * longest, 0.6 * length);

/** Move a fat line's points in place (the same number of points it was made with). */
function setLinePoints(line: Line2, points: THREE.Vector3[]): void {
  const data = (line.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data;
  const arr = data.array as Float32Array;
  for (let i = 0; i + 1 < points.length && 6 * i + 5 < arr.length; i++) {
    const a = points[i], b = points[i + 1];
    arr.set([a.x, a.y, a.z, b.x, b.y, b.z], 6 * i);
  }
  data.needsUpdate = true;
}

/** The point halfway along a polyline (by its points). */
function midpoint(points: THREE.Vector3[]): THREE.Vector3 {
  if (points.length === 2) return points[0].clone().lerp(points[1], 0.5);
  return points[Math.floor(points.length / 2)].clone();
}

/**
 * A soft shadow under an arrow on a curved surface: a ribbon `width` wide along
 * the arrow's path on the surface (just off it), moved `cast` away from the
 * light within the surface; the shadow texture runs along and across it.
 */
function shadowRibbon(surface: THREE.Vector3[], normals: THREE.Vector3[], width: number, cast: number): THREE.BufferGeometry {
  const n = surface.length;
  const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = surface[Math.min(n - 1, i + 1)].clone().sub(surface[Math.max(0, i - 1)]).normalize();
    const side = new THREE.Vector3().crossVectors(normals[i], t).setLength(width / 2);
    const away = SHADOW_CAST.clone().addScaledVector(normals[i], -SHADOW_CAST.dot(normals[i]));
    if (away.lengthSq() > 1e-6) away.setLength(cast);
    const c = surface[i].clone().addScaledVector(normals[i], 0.003).add(away);
    for (const [k, sign] of [[0, -1], [1, 1]] as const) {
      const p = c.clone().addScaledVector(side, sign);
      pos.set([p.x, p.y, p.z], (2 * i + k) * 3);
      uv.set([i / (n - 1), k], (2 * i + k) * 2);
    }
    if (i > 0) idx.push(2 * i - 2, 2 * i - 1, 2 * i + 1, 2 * i - 2, 2 * i + 1, 2 * i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

import * as THREE from 'three';
import type { Line2 } from 'three/examples/jsm/lines/Line2.js';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { ConfigurationResult } from '../compute/configuration';
import type { ConfigFace } from '../core/fields';
import type { Scar } from '../core/types';
import { edgeBand, edgeMidlines, faceCentre, faceNormal, facesViewer, fatLine, GROUP_FACES, radiusOf, readPalette, roleColor, roundedBox, shapeSize, sketchArrows, type ConfigPalette, type SketchArrow } from './configShape';

/** Opacity of a face of each role (both = a flaking surface, with a platform band). */
const FACE_OPACITY = { flaking: 0.35, both: 0.35, platform: 0.3, none: 0.12 } as const;
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
/** From the front, the right and above: the default view (double click). */
const HOME = new THREE.Vector3(1, 0.8, 1.5).normalize();
const ASPECT = 330 / 210;
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

const arrowMaterial = (opacity: number) =>
  new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });

/**
 * The volumetric configuration as a small 3D sketch (floating panel): a
 * transparent rounded box in the model's proportions, its faces coloured by
 * role, and one arrow floating over its face for every scar with an arrow.
 * Drawn only when it changes or is turned (its own small canvas, not the main
 * loop). Drag turns it, a double click goes back to the default view, a click
 * on an arrow picks its scar, elsewhere on a face the face.
 */
export class ConfigSketch {
  readonly canvas: HTMLCanvasElement;
  /** A face was clicked. */
  onPick: (face: ConfigFace) => void = () => {};
  /** An arrow was clicked. */
  onPickScar: (id: string) => void = () => {};
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(26, ASPECT, 0.05, 50);
  private readonly root = new THREE.Group();
  private palette: ConfigPalette = readPalette();
  private shape: THREE.Group | null = null;
  private front: THREE.Mesh | null = null;
  private edges: Array<{ faces: [ConfigFace, ConfigFace]; line: Line2 }> = [];
  private buckets: ArrowBucket[] = [];
  private lifted = new Map<string, { face: ConfigFace; start: THREE.Vector3; end: THREE.Vector3 }>();
  private result: ConfigurationResult | null = null;
  private scars: readonly Scar[] = [];
  private selected: ConfigFace | null = null;
  private selectedScar: string | null = null;
  private key = '';
  private readonly shadowMap = shadowTexture();
  // seen / through the box × counted / not
  private readonly mats = {
    front: [arrowMaterial(1), arrowMaterial(UNCOUNTED_OPACITY)],
    back: [arrowMaterial(BACK_ARROW_OPACITY), arrowMaterial(BACK_ARROW_OPACITY * UNCOUNTED_OPACITY)],
    shadow: [SHADOW_OPACITY, SHADOW_OPACITY * UNCOUNTED_OPACITY].map((opacity) => new THREE.MeshBasicMaterial({ map: this.shadowMap, color: 0x000000, transparent: true, opacity, depthWrite: false })),
  };
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

  /** What to draw: the configuration (null: nothing), the scars, the selected face and the selected scar. */
  set(result: ConfigurationResult | null, scars: readonly Scar[], selected: ConfigFace | null, selectedScar: string | null): void {
    this.result = result;
    this.scars = scars;
    this.selected = selected;
    const arrows = scars.filter((s) => s.vector).map((s) => [s.id, s.vector!.start, s.vector!.end]);
    const key = result ? JSON.stringify([result.min, result.max, result.axes, result.faces.map((f) => f.role), result.scars, arrows]) : '';
    if (key !== this.key) {
      this.key = key;
      this.selectedScar = selectedScar;
      this.build();
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

  /** Back to the view from the front, the right and above (+Y up). */
  home(): void {
    this.root.quaternion.identity();
    this.render();
  }

  /** Arrows drawn (one per scar with an arrow). */
  arrowCount(): number {
    return this.lifted.size;
  }

  /** Where a face's centre is on the page (null when it faces away or nothing is drawn). */
  faceCentreClient(face: ConfigFace): { x: number; y: number } | null {
    if (!this.result || !this.shape || !facesViewer(face, this.toCamera())) return null;
    return this.client(faceCentre(face, shapeSize(this.result, 0.2)));
  }

  /** Where the middle of a scar's arrow is on the page (null when it is not drawn or faces away). */
  arrowClient(id: string): { x: number; y: number } | null {
    const a = this.lifted.get(id);
    if (!a || !facesViewer(a.face, this.toCamera())) return null;
    return this.client(a.start.clone().lerp(a.end, 0.5));
  }

  /** Fit the canvas to its width (the height follows the aspect). */
  resize(): void {
    const w = this.canvas.parentElement?.clientWidth ?? 0;
    if (!this.renderer || w <= 0) return;
    const h = Math.round(w / ASPECT);
    const now = this.renderer.getSize(new THREE.Vector2());
    if (now.x !== w || now.y !== h) {
      this.renderer.setSize(w, h, false);
      this.canvas.style.height = `${h}px`;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    // also when it is shown again (what changed while it was folded was not drawn)
    this.render();
  }

  render(): void {
    const r = this.renderer;
    if (!r || !this.canvas.isConnected || this.canvas.clientWidth === 0) return;
    this.root.updateMatrixWorld(true);
    // what faces the viewer is drawn plainly; what is behind, through the box
    const toCamera = this.toCamera();
    for (const e of this.edges) {
      const m = e.line.material as LineMaterial;
      const sel = !!this.selected && e.faces.includes(this.selected);
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
    r.render(this.scene, this.camera);
  }

  dispose(): void {
    this.clearShape();
    for (const g of Object.values(this.unit)) g.dispose();
    for (const m of [...this.mats.front, ...this.mats.back, ...this.mats.shadow]) m.dispose();
    this.shadowMap.dispose();
    this.renderer?.dispose();
  }

  /** From the box's centre toward the eye, in box coordinates. */
  private toCamera(): THREE.Vector3 {
    return this.camera.position.clone().applyQuaternion(this.root.quaternion.clone().invert()).normalize();
  }

  /** A point of the sketch (box coordinates) on the page. */
  private client(p: THREE.Vector3): { x: number; y: number } {
    this.root.updateMatrixWorld(true);
    const v = this.root.localToWorld(p.clone()).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  private clearShape(): void {
    if (!this.shape) return;
    this.root.remove(this.shape);
    const keep = new Set<unknown>([...Object.values(this.unit), ...this.mats.front, ...this.mats.back, ...this.mats.shadow]);
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
    this.lifted.clear();
  }

  private build(): void {
    this.clearShape();
    const res = this.result;
    if (!res) return;
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
    const reach = 0.5 * size.length() + HOVER + 0.02;
    this.camera.position.copy(HOME).multiplyScalar((reach / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.02);
    this.camera.lookAt(0, 0, 0);
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
        this.lifted.set(a.id, { face, start, end });
        const dir = end.clone().sub(start);
        const length = dir.length();
        dir.normalize();
        const headLen = Math.min(Math.max(HEAD_SHARE * length, 1.8 * headR), HEAD_MAX * longest, 0.6 * length);
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

  /** Ink, the selected scar's arrow in the selection colour. */
  private paintArrows(): void {
    for (const b of this.buckets)
      for (const p of b.parts) {
        b.arrows.forEach((a, i) => p.setColorAt(i, a.id === this.selectedScar ? this.palette.accent : this.palette.ink));
        if (p.instanceColor) p.instanceColor.needsUpdate = true;
      }
  }

  /** The scar whose arrow is nearest the click within a few pixels (those in front first). */
  private pickScarAt(clientX: number, clientY: number): string | null {
    const toCamera = this.toCamera();
    let best: { id: string; d: number; seen: boolean } | null = null;
    for (const [id, a] of this.lifted) {
      const p = this.client(a.start), q = this.client(a.end);
      const dx = q.x - p.x, dy = q.y - p.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? THREE.MathUtils.clamp(((clientX - p.x) * dx + (clientY - p.y) * dy) / len2, 0, 1) : 0;
      const d = Math.hypot(clientX - p.x - t * dx, clientY - p.y - t * dy);
      const seen = facesViewer(a.face, toCamera);
      if (d > PICK_PX) continue;
      if (!best || (seen && !best.seen) || (seen === best.seen && d < best.d)) best = { id, d, seen };
    }
    return best?.id ?? null;
  }

  private pickAt(clientX: number, clientY: number): ConfigFace | null {
    if (!this.front) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(this.front, false)[0];
    return hit?.face ? GROUP_FACES[hit.face.materialIndex] ?? null : null;
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

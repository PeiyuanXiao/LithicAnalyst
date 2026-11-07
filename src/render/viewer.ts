import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Vec3 } from '../core/types';

export type NavMode = 'select' | 'draw';

export interface SurfaceHit {
  /** World point = original mesh coordinates. */
  point: THREE.Vector3;
  /** Unit face normal, oriented toward the viewer. */
  normal: THREE.Vector3;
  faceIndex: number;
  distance: number;
}

/** Length of a camera transition (H, views along a plane or the specimen frame, focusing an item). */
const TRANSITION_MS = 280;

const easeInOutCubic = (k: number): number => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface CameraPose {
  target: THREE.Vector3;
  distance: number;
  orientation: THREE.Quaternion;
}

/** A short animation of something drawn: `step` gets the share of its time gone by (0 to 1). */
interface Tween {
  start: number;
  ms: number;
  step: (k: number) => void;
}

/**
 * Scene, camera, renderer and navigation. Knows nothing about scars or the
 * project; layers and tools sit on top of it.
 */
export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly labelRenderer: CSS2DRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(28, 1, 0.01, 1000);
  readonly controls: TrackballControls;
  /** Holds the scan. */
  readonly meshRoot = new THREE.Group();
  /** Holds annotation visuals (arrows, gizmos). */
  readonly overlay = new THREE.Group();
  mesh: THREE.Mesh | null = null;
  diagonal = 100;
  center = new THREE.Vector3();

  private dirty = true;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private cameraListeners = new Set<() => void>();
  private frameListeners = new Set<() => void>();
  private renderListeners = new Set<() => void>();
  private readonly resizeObserver: ResizeObserver;
  private navMode: NavMode = 'select';
  private navOverride = false;
  private rafId = 0;
  /** A camera move in progress: from where, to where, since when. */
  private transition: { start: number; from: CameraPose; to: CameraPose & { position: THREE.Vector3; up: THREE.Vector3 } } | null = null;
  /** Animations of what is drawn; frames are drawn every frame only while one runs. */
  private tweens = new Set<Tween>();

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // transparent: the view's background is the container's (CSS, follows the theme)
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.className = 'viewport-canvas';
    this.renderer.domElement.setAttribute('aria-label', '3D view');
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'viewport-labels';
    container.appendChild(this.labelRenderer.domElement);

    this.scene.add(this.meshRoot, this.overlay);
    this.raycaster.firstHitOnly = true;

    this.controls = new TrackballControls(this.camera, this.renderer.domElement);
    this.controls.rotateSpeed = 3.2;
    this.controls.panSpeed = 0.9;
    this.controls.staticMoving = true;
    this.controls.noZoom = true; // replaced by zoom-to-cursor below
    this.controls.keys = ['', '', '']; // free A/S/D for our shortcuts
    this.controls.addEventListener('change', () => this.cameraChanged());
    this.applyMouseButtons();

    this.renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
    container.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    // a press on the view takes the camera over from a transition, and what was coming in is there at once
    container.addEventListener(
      'pointerdown',
      (e) => {
        if ((e.target as Element | null)?.closest?.('.viewport-ui')) return;
        this.stopTransition();
        this.finishTweens();
      },
      { capture: true },
    );

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    const loop = (now: number) => {
      this.rafId = requestAnimationFrame(loop);
      if (this.transition) this.stepTransition(now);
      if (this.tweens.size) this.stepTweens(now);
      this.controls.update();
      for (const fn of this.frameListeners) fn();
      if (this.dirty) this.renderNow();
    };
    loop(performance.now());
  }

  /** Draw a frame now (the theme changed: the new colours are on screen before the next frame). */
  renderNow(): void {
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
    for (const fn of this.renderListeners) fn();
  }

  /**
   * Animate something drawn for `ms`: `step` gets 0 to 1 each frame, and 1 at the end (also when a press on the view or
   * `finishTweens` ends it early). With reduced motion it gets 1 at once. Frames are drawn each frame only meanwhile.
   */
  tween(ms: number, step: (k: number) => void): void {
    if (reducedMotion() || ms <= 0) {
      step(1);
      this.requestRender();
      return;
    }
    this.tweens.add({ start: performance.now(), ms, step });
    step(0);
    this.requestRender();
  }

  /** Every animation at its end (a press on the view, a figure about to be drawn). */
  finishTweens(): void {
    if (!this.tweens.size) return;
    const all = [...this.tweens];
    this.tweens.clear();
    for (const tw of all) tw.step(1);
    this.requestRender();
  }

  get tweening(): boolean {
    return this.tweens.size > 0;
  }

  private stepTweens(now: number): void {
    for (const tw of [...this.tweens]) {
      const k = Math.min(1, Math.max(0, (now - tw.start) / tw.ms));
      if (k >= 1) this.tweens.delete(tw);
      tw.step(k);
    }
    this.dirty = true;
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }

  requestRender(): void {
    this.dirty = true;
  }

  onCameraChange(fn: () => void): () => void {
    this.cameraListeners.add(fn);
    return () => this.cameraListeners.delete(fn);
  }

  /** Called after each render, once the labels are in place. */
  onAfterRender(fn: () => void): () => void {
    this.renderListeners.add(fn);
    return () => this.renderListeners.delete(fn);
  }

  /** Called every animation frame before rendering (cheap work only). */
  onFrame(fn: () => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  setMesh(mesh: THREE.Mesh, offset: Vec3, diagonal: number): void {
    if (this.mesh) this.meshRoot.remove(this.mesh);
    this.mesh = mesh;
    mesh.position.set(offset[0], offset[1], offset[2]);
    mesh.updateMatrixWorld(true);
    this.meshRoot.add(mesh);
    this.diagonal = diagonal > 0 ? diagonal : 1;
    this.center.set(offset[0], offset[1], offset[2]);
    this.controls.maxDistance = this.diagonal * 30;
    this.controls.minDistance = this.diagonal * 0.002;
    this.fitView(new THREE.Vector3(0.35, -0.55, 0.76).normalize(), new THREE.Vector3(0, 0, 1));
  }

  /** Take the model out of the view (it is closed). */
  clearMesh(): void {
    this.stopTransition();
    if (this.mesh) this.meshRoot.remove(this.mesh);
    this.mesh = null;
    this.requestRender();
  }

  /**
   * Frame the whole model, looking from `towardViewer` (direction from model to camera);
   * `animate`: move there in a short transition (none when the system asks for reduced motion).
   */
  fitView(towardViewer?: THREE.Vector3, up?: THREE.Vector3, center: THREE.Vector3 = this.center, distance?: number, animate = false): void {
    const dir = (towardViewer ?? this.camera.position.clone().sub(this.controls.target)).clone().normalize();
    if (!Number.isFinite(dir.x) || dir.lengthSq() === 0) dir.set(0, 0, 1);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const fitHeight = (this.diagonal * 0.5) / Math.sin(fov / 2);
    const fitWidth = fitHeight / Math.max(0.5, this.camera.aspect);
    const dist = distance ?? Math.max(fitHeight, fitWidth) * 1.05;
    const target = center.clone();
    const position = center.clone().addScaledVector(dir, dist);
    let camUp = this.camera.up.clone();
    if (up) {
      // make "up" perpendicular to the view direction
      const u = up.clone().sub(dir.clone().multiplyScalar(up.dot(dir)));
      if (u.lengthSq() > 1e-8) camUp = u.normalize();
    }
    this.moveCamera(position, target, camUp, animate);
  }

  /** The whole model from the current direction (the H key). */
  viewAll(animate = false): void {
    this.fitView(undefined, undefined, this.center, undefined, animate);
  }

  /** Look along −towardViewer at `center` with the given up vector. */
  viewFrom(towardViewer: Vec3, up: Vec3, center?: Vec3, distance?: number, animate = false): void {
    const c = center ? new THREE.Vector3(center[0], center[1], center[2]) : this.center;
    this.fitView(new THREE.Vector3(...towardViewer), new THREE.Vector3(...up), c, distance, animate);
  }

  /** Put the camera at `position` looking at `target`, at once or in a transition. */
  private moveCamera(position: THREE.Vector3, target: THREE.Vector3, up: THREE.Vector3, animate: boolean): void {
    this.stopTransition();
    if (animate && !reducedMotion()) {
      const orientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(position, target, up));
      this.transition = {
        start: performance.now(),
        from: { target: this.controls.target.clone(), distance: this.currentDistance(), orientation: this.camera.quaternion.clone() },
        to: { target, distance: position.distanceTo(target), orientation, position, up },
      };
      this.requestRender();
      return;
    }
    this.controls.target.copy(target);
    this.camera.position.copy(position);
    this.camera.up.copy(up);
    this.camera.lookAt(this.controls.target);
    this.cameraChanged();
  }

  /**
   * One frame of the transition: the centre and the distance move linearly, the
   * orientation along the shortest rotation (slerp), eased in and out.
   */
  private stepTransition(now: number): void {
    const tr = this.transition!;
    const k = Math.min(1, Math.max(0, (now - tr.start) / TRANSITION_MS));
    if (k >= 1) {
      this.transition = null;
      this.controls.target.copy(tr.to.target);
      this.camera.position.copy(tr.to.position);
      this.camera.up.copy(tr.to.up);
      this.camera.lookAt(this.controls.target);
      this.cameraChanged();
      return;
    }
    const e = easeInOutCubic(k);
    const q = new THREE.Quaternion().slerpQuaternions(tr.from.orientation, tr.to.orientation, e);
    const target = tr.from.target.clone().lerp(tr.to.target, e);
    const distance = tr.from.distance + (tr.to.distance - tr.from.distance) * e;
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(q), distance);
    this.camera.up.set(0, 1, 0).applyQuaternion(q);
    this.camera.quaternion.copy(q);
    this.cameraChanged();
  }

  /** End a transition where it is (the user took over the camera). */
  stopTransition(): void {
    this.transition = null;
  }

  get transitioning(): boolean {
    return this.transition !== null;
  }

  currentDistance(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  setRotationCenter(p: THREE.Vector3): void {
    this.stopTransition();
    const delta = p.clone().sub(this.controls.target);
    this.controls.target.add(delta);
    this.camera.position.add(delta);
    this.cameraChanged();
  }

  setNavMode(mode: NavMode): void {
    this.navMode = mode;
    this.applyMouseButtons();
  }

  /** While true (Space held), the left button navigates even in draw mode. */
  setNavOverride(on: boolean): void {
    this.navOverride = on;
    this.applyMouseButtons();
  }

  private applyMouseButtons(): void {
    const leftRotates = this.navMode === 'select' || this.navOverride;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: leftRotates ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
    };
  }

  /** Direction from the rotation centre toward the camera. */
  towardViewer(): Vec3 {
    const d = this.camera.position.clone().sub(this.controls.target).normalize();
    return [d.x, d.y, d.z];
  }

  cameraUp(): Vec3 {
    return [this.camera.up.x, this.camera.up.y, this.camera.up.z];
  }

  setRayFromClient(clientX: number, clientY: number): THREE.Raycaster {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster;
  }

  pickSurface(clientX: number, clientY: number): SurfaceHit | null {
    if (!this.mesh) return null;
    const rc = this.setRayFromClient(clientX, clientY);
    const hits = rc.intersectObject(this.mesh, false);
    const h = hits[0];
    if (!h || !h.face) return null;
    const normal = h.face.normal.clone().transformDirection(this.mesh.matrixWorld).normalize();
    if (normal.dot(rc.ray.direction) > 0) normal.negate();
    return { point: h.point.clone(), normal, faceIndex: h.faceIndex ?? -1, distance: h.distance };
  }

  /** True if the mesh hides `p` from the camera. */
  isOccluded(p: THREE.Vector3, tolerance: number): boolean {
    if (!this.mesh) return false;
    const origin = this.camera.position;
    const dir = p.clone().sub(origin);
    const dist = dir.length();
    if (dist === 0) return false;
    this.raycaster.set(origin, dir.divideScalar(dist));
    this.raycaster.far = dist;
    const hits = this.raycaster.intersectObject(this.mesh, false);
    this.raycaster.far = Infinity;
    return hits.length > 0 && hits[0].distance < dist - tolerance;
  }

  /** World-space size of one screen pixel at the depth of `p`. */
  worldPerPixel(p: THREE.Vector3): number {
    const h = this.container.clientHeight || 1;
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const depth = Math.max(this.camera.near, p.clone().sub(this.camera.position).dot(dir));
    return (2 * depth * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / h;
  }

  /** Project a world point to client coordinates. */
  project(p: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = p.clone().project(this.camera);
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height,
      visible: v.z > -1 && v.z < 1,
    };
  }

  private onWheel(e: WheelEvent): void {
    // panels over the view scroll themselves
    if ((e.target as Element | null)?.closest?.('.viewport-ui')) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    const delta = THREE.MathUtils.clamp(e.deltaY * unit, -400, 400);
    const factor = Math.exp(delta * 0.0016);
    this.zoomAt(e.clientX, e.clientY, factor);
  }

  /** Dolly toward the point under the cursor (factor < 1 zooms in). */
  zoomAt(clientX: number, clientY: number, factor: number): void {
    this.stopTransition();
    const target = this.controls.target;
    const hit = this.pickSurface(clientX, clientY);
    let anchor: THREE.Vector3;
    if (hit) anchor = hit.point;
    else {
      const rc = this.setRayFromClient(clientX, clientY);
      const normal = this.camera.getWorldDirection(new THREE.Vector3());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, target);
      anchor = rc.ray.intersectPlane(plane, new THREE.Vector3()) ?? target.clone();
    }
    const camDist = this.camera.position.distanceTo(target);
    const newDist = camDist * factor;
    if (newDist < this.controls.minDistance || newDist > this.controls.maxDistance) return;
    this.camera.position.sub(anchor).multiplyScalar(factor).add(anchor);
    target.sub(anchor).multiplyScalar(factor).add(anchor);
    this.cameraChanged();
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.controls.handleResize();
    this.cameraChanged();
  }

  private cameraChanged(): void {
    // Tight near/far planes around the model keep depth precision for close inspection.
    const d = this.camera.position.distanceTo(this.center);
    const r = this.diagonal * 0.75;
    const near = Math.max(this.diagonal * 1e-4, d - r * 1.6, d * 0.002);
    const far = d + r * 2.5;
    if (Math.abs(near - this.camera.near) / near > 0.01 || Math.abs(far - this.camera.far) / far > 0.01) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
    this.dirty = true;
    for (const fn of this.cameraListeners) fn();
  }
}

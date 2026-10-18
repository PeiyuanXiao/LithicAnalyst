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

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
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

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      this.controls.update();
      for (const fn of this.frameListeners) fn();
      if (this.dirty) {
        this.dirty = false;
        this.renderer.render(this.scene, this.camera);
        this.labelRenderer.render(this.scene, this.camera);
        for (const fn of this.renderListeners) fn();
      }
    };
    loop();
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

  /** Called every animation frame before rendering (cheap work only). */
  /** Called after each render, once the labels are in place. */
  onAfterRender(fn: () => void): () => void {
    this.renderListeners.add(fn);
    return () => this.renderListeners.delete(fn);
  }

  onFrame(fn: () => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  setBackground(color: string): void {
    this.renderer.setClearColor(new THREE.Color(color), 1);
    this.requestRender();
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

  /** Frame the whole model, looking from `towardViewer` (direction from model to camera). */
  fitView(towardViewer?: THREE.Vector3, up?: THREE.Vector3, center: THREE.Vector3 = this.center, distance?: number): void {
    const dir = (towardViewer ?? this.camera.position.clone().sub(this.controls.target)).clone().normalize();
    if (!Number.isFinite(dir.x) || dir.lengthSq() === 0) dir.set(0, 0, 1);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const fitHeight = (this.diagonal * 0.5) / Math.sin(fov / 2);
    const fitWidth = fitHeight / Math.max(0.5, this.camera.aspect);
    const dist = distance ?? Math.max(fitHeight, fitWidth) * 1.05;
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, dist);
    if (up) {
      // make "up" perpendicular to the view direction
      const u = up.clone().sub(dir.clone().multiplyScalar(up.dot(dir)));
      if (u.lengthSq() > 1e-8) this.camera.up.copy(u.normalize());
    }
    this.camera.lookAt(this.controls.target);
    this.cameraChanged();
  }

  /** Look along −towardViewer at `center` with the given up vector. */
  viewFrom(towardViewer: Vec3, up: Vec3, center?: Vec3, distance?: number): void {
    const c = center ? new THREE.Vector3(center[0], center[1], center[2]) : this.center;
    this.fitView(new THREE.Vector3(...towardViewer), new THREE.Vector3(...up), c, distance);
  }

  currentDistance(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  setRotationCenter(p: THREE.Vector3): void {
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

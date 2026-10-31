import * as THREE from 'three';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { ConfigurationResult } from '../compute/configuration';
import type { ConfigFace } from '../core/fields';
import { edgeBand, edgeMidlines, faceCentre, facesViewer, fatLine, GROUP_FACES, radiusOf, readPalette, roleColor, roundedBox, shapeSize, type ConfigPalette } from './configShape';
import type { Viewer } from './viewer';

/**
 * The box of the volumetric configuration in the corner of the main view: it
 * turns with the camera (its pose is the box's axes as the camera sees them), its
 * faces coloured by role, the selected face outlined. A click on a face picks it.
 * Drawn by the main renderer into a corner viewport after each frame of the view
 * (no WebGL context of its own); a board under the canvas and a transparent
 * target over it make the panel.
 */
export class ViewCube {
  /** A face was clicked. */
  onPick: (face: ConfigFace) => void = () => {};
  /** The panel (under the canvas) and the click target (over it). */
  readonly board: HTMLElement;
  readonly hit: HTMLElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private readonly root = new THREE.Group();
  private palette: ConfigPalette = readPalette();
  private mesh: THREE.Mesh | null = null;
  private outline: THREE.Group | null = null;
  private result: ConfigurationResult | null = null;
  private selected: ConfigFace | null = null;
  private key = '';
  private shown = false;
  private readonly frameQ = new THREE.Quaternion();

  constructor(private readonly viewer: Viewer) {
    this.board = document.createElement('div');
    this.board.className = 'view-cube-board';
    this.board.hidden = true;
    this.hit = document.createElement('div');
    this.hit.className = 'viewport-ui view-cube-hit';
    this.hit.id = 'view-cube';
    this.hit.hidden = true;
    // painted before the canvas (which is transparent there), so the cube shows on the board
    viewer.container.insertBefore(this.board, viewer.renderer.domElement);
    viewer.container.append(this.hit);
    this.camera.position.set(0, 0, 5);
    this.camera.lookAt(0, 0, 0);
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(-1, 1.6, 2);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.9), key, this.root);
    viewer.onAfterRender(() => this.draw());
    let down: { x: number; y: number } | null = null;
    this.hit.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    });
    this.hit.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      down = null;
      const f = this.pickAt(e.clientX, e.clientY);
      if (f) this.onPick(f);
    });
  }

  /** What to show (null: nothing) and whether it is shown at all. */
  set(result: ConfigurationResult | null, selected: ConfigFace | null, shown: boolean): void {
    this.result = result;
    this.selected = selected;
    this.shown = shown && !!result;
    this.board.hidden = this.hit.hidden = !this.shown;
    const key = result ? JSON.stringify([result.min, result.max, result.faces.map((f) => f.role), selected]) : '';
    if (key !== this.key) {
      this.key = key;
      this.build();
    }
    if (result) {
      const [x, y, z] = result.axes.map((a) => new THREE.Vector3(...a));
      this.frameQ.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    }
    this.viewer.requestRender();
  }

  repaint(): void {
    this.palette = readPalette();
    this.build();
    this.viewer.requestRender();
  }

  /** Where a face's centre is on the page (null when it faces away or the cube is not shown). */
  faceCentreClient(face: ConfigFace): { x: number; y: number } | null {
    if (!this.shown || !this.result) return null;
    this.pose();
    if (!facesViewer(face, new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion.clone().invert()))) return null;
    const p = this.root.localToWorld(faceCentre(face, shapeSize(this.result, 0.45))).project(this.camera);
    const r = this.hit.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  /** The box's axes as the main camera sees them. */
  private pose(): void {
    this.root.quaternion.copy(this.viewer.camera.quaternion).invert().multiply(this.frameQ);
    this.root.updateMatrixWorld(true);
  }

  private build(): void {
    if (this.mesh) {
      this.root.remove(this.mesh);
      this.mesh.geometry.dispose();
      for (const m of this.mesh.material as THREE.Material[]) m.dispose();
      this.mesh = null;
    }
    if (this.outline) {
      this.root.remove(this.outline);
      this.outline.traverse((o) => {
        const l = o as THREE.Mesh;
        if (l.geometry) l.geometry.dispose();
        if (l.material) (l.material as THREE.Material).dispose();
      });
      this.outline = null;
    }
    const res = this.result;
    if (!res) return;
    // thin sides are kept thick enough to click
    const size = shapeSize(res, 0.45);
    const radius = radiusOf(size, 0.16);
    const mats = GROUP_FACES.map((f) => new THREE.MeshStandardMaterial({ color: roleColor(this.palette, res.faces.find((x) => x.face === f)!.role), roughness: 0.7, metalness: 0 }));
    this.mesh = new THREE.Mesh(roundedBox(size, radius, 4), mats);
    this.root.add(this.mesh);
    // the platform band of a face that is both, and the selected face's outline
    this.outline = new THREE.Group();
    this.root.add(this.outline);
    for (const f of GROUP_FACES.filter((x) => res.faces.find((y) => y.face === x)!.role === 'both'))
      this.outline.add(new THREE.Mesh(edgeBand(f, size, radius, 0.004), new THREE.MeshStandardMaterial({ color: this.palette.platform, roughness: 0.7, metalness: 0, side: THREE.DoubleSide })));
    if (this.selected) {
      for (const e of edgeMidlines(size, radius).filter((x) => x.faces.includes(this.selected!))) {
        const line = fatLine(e.points, 2.5);
        const m = line.material as LineMaterial;
        m.color.copy(this.palette.accent);
        m.transparent = false;
        m.depthWrite = true;
        // a little outside the surface, so the lines are not cut by it
        line.scale.setScalar(1.015);
        this.outline.add(line);
      }
    }
    const reach = 0.5 * size.length() * 1.06;
    Object.assign(this.camera, { left: -reach, right: reach, top: reach, bottom: -reach });
    this.camera.updateProjectionMatrix();
  }

  /** After each frame of the main view: the cube in its corner. */
  private draw(): void {
    if (!this.shown || !this.mesh) return;
    const r = this.viewer.renderer;
    const canvas = r.domElement.getBoundingClientRect();
    const box = this.hit.getBoundingClientRect();
    if (box.width <= 0 || canvas.width <= 0) return;
    const x = box.left - canvas.left, y = canvas.bottom - box.bottom;
    this.pose();
    const autoClear = r.autoClear;
    r.autoClear = false;
    r.setScissorTest(true);
    r.setScissor(x, y, box.width, box.height);
    r.setViewport(x, y, box.width, box.height);
    // the board shows through where the cube is not
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    r.setScissorTest(false);
    r.setViewport(0, 0, canvas.width, canvas.height);
    r.setScissor(0, 0, canvas.width, canvas.height);
    r.autoClear = autoClear;
  }

  private pickAt(clientX: number, clientY: number): ConfigFace | null {
    if (!this.mesh) return null;
    this.pose();
    const rect = this.hit.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(this.mesh, false)[0];
    return hit?.face ? GROUP_FACES[hit.face.materialIndex] ?? null : null;
  }
}

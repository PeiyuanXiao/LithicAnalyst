import * as THREE from 'three';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { isBicone, type BiconeResult, type CoreConfiguration } from '../compute/bicone';
import type { ConfigurationResult } from '../compute/configuration';
import type { BiconeCone } from '../core/fields';
import type { ConfigPick } from '../ui/appApi';
import { biconeAxes, biconeGeometries, biconeSize, onCone } from './biconeShape';
import { edgeBand, edgeMidlines, faceCentre, facesViewer, fatLine, GROUP_FACES, radiusOf, readPalette, roleColor, roundedBox, shapeSize, type ConfigPalette } from './configShape';
import type { Viewer } from './viewer';

/** Each cone of the small bicone is at least this high, as a share of its radius (thick enough to click). */
const CONE_MIN_HEIGHT = 0.3;
/** The picked cone's outline: a slightly larger copy seen from inside, in the selection colour. */
const OUTLINE_SCALE = 1.08;

const isCone = (p: ConfigPick | null): p is BiconeCone => p === 'upper' || p === 'lower';

/**
 * The shape of the volumetric configuration in the corner of the main view:
 * the box, or for the bicone two cones on one base. It turns with the camera
 * (its pose is the box's axes, or the bicone's base, as the camera sees them),
 * coloured by role, the selected face or cone outlined. A click picks a face or
 * cone. Drawn by the main renderer into a corner viewport after each frame of
 * the view (no WebGL context of its own); a board under the canvas and a
 * transparent target over it make the panel.
 */
export class ViewCube {
  /** A face or cone was clicked. */
  onPick: (face: ConfigPick) => void = () => {};
  /** How many times it was drawn. */
  draws = 0;
  /** The panel (under the canvas) and the click target (over it). */
  readonly board: HTMLElement;
  readonly hit: HTMLElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private readonly root = new THREE.Group();
  /** The bicone as drawn (its outline is centred in each pose); null with the box. */
  private drawnCones: { rim: number; upper: number; lower: number } | null = null;
  private palette: ConfigPalette = readPalette();
  private mesh: THREE.Mesh | null = null;
  private cones: Array<{ cone: BiconeCone; mesh: THREE.Mesh }> = [];
  private outline: THREE.Group | null = null;
  private result: CoreConfiguration | null = null;
  private selected: ConfigPick | null = null;
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
  set(result: CoreConfiguration | null, selected: ConfigPick | null, shown: boolean): void {
    this.result = result;
    this.selected = selected;
    this.shown = shown && !!result;
    this.board.hidden = this.hit.hidden = !this.shown;
    let key = '';
    if (isBicone(result)) key = JSON.stringify(['bicone', result.radius, result.upperHeight, result.lowerHeight, result.cones.map((c) => c.role), selected]);
    else if (result) key = JSON.stringify(['box', result.min, result.max, result.faces.map((f) => f.role), selected]);
    if (key !== this.key) {
      this.key = key;
      this.build();
    }
    if (result) {
      const [x, y, z] = isBicone(result) ? biconeAxes(result) : result.axes.map((a) => new THREE.Vector3(...a));
      this.frameQ.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    }
    this.viewer.requestRender();
  }

  repaint(): void {
    this.palette = readPalette();
    this.build();
    this.viewer.requestRender();
  }

  /** Where a face's centre (or a point halfway up a cone, on its side toward the viewer) is on the page; null when it faces away or nothing is shown. */
  faceCentreClient(face: ConfigPick): { x: number; y: number } | null {
    const r = this.result;
    if (!this.shown || !r) return null;
    this.pose();
    const toCamera = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion.clone().invert());
    let p: THREE.Vector3;
    if (isBicone(r)) {
      if (!isCone(face)) return null;
      const s = biconeSize(r, CONE_MIN_HEIGHT);
      const across = new THREE.Vector2(toCamera.x, toCamera.z);
      if (across.lengthSq() < 1e-6) across.set(0, 1);
      const c = onCone(s, face, ...(across.setLength(0.5 * s.radius).toArray() as [number, number]));
      if (c.normal.dot(toCamera) <= 1e-6) return null;
      p = c.point;
    } else {
      if (isCone(face) || !facesViewer(face, toCamera)) return null;
      p = faceCentre(face, shapeSize(r, 0.45));
    }
    const v = this.root.localToWorld(p.clone()).project(this.camera);
    const rect = this.hit.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /** The shape's axes as the main camera sees them. */
  private pose(): void {
    this.root.quaternion.copy(this.viewer.camera.quaternion).invert().multiply(this.frameQ);
    // the bicone's outline in the middle of the corner: the rim's ellipse and the two apexes, as seen now
    const c = this.drawnCones;
    if (c) {
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(this.root.quaternion);
      const across = (k: number) => {
        const half = c.rim * Math.sqrt(Math.max(0, 1 - k * k));
        return (Math.max(half, c.upper * k, -c.lower * k) + Math.min(-half, c.upper * k, -c.lower * k)) / 2;
      };
      this.root.position.set(-across(axis.x), -across(axis.y), 0);
    } else this.root.position.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
  }

  private clear(): void {
    const drop = (o: THREE.Object3D) => {
      this.root.remove(o);
      o.traverse((x) => {
        const m = x as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) mat.dispose();
      });
    };
    if (this.mesh) drop(this.mesh);
    for (const c of this.cones) drop(c.mesh);
    if (this.outline) drop(this.outline);
    this.mesh = null;
    this.cones = [];
    this.outline = null;
    this.drawnCones = null;
  }

  private build(): void {
    this.clear();
    const res = this.result;
    if (!res) return;
    // the band of a face that is both, the outline of the selected face or cone
    this.outline = new THREE.Group();
    this.root.add(this.outline);
    const reach = isBicone(res) ? this.buildBicone(res) : this.buildBox(res);
    Object.assign(this.camera, { left: -reach, right: reach, top: reach, bottom: -reach });
    this.camera.updateProjectionMatrix();
  }

  private buildBox(res: ConfigurationResult): number {
    // thin sides are kept thick enough to click
    const size = shapeSize(res, 0.45);
    const radius = radiusOf(size, 0.16);
    const mats = GROUP_FACES.map((f) => new THREE.MeshStandardMaterial({ color: roleColor(this.palette, res.faces.find((x) => x.face === f)!.role), roughness: 0.7, metalness: 0 }));
    this.mesh = new THREE.Mesh(roundedBox(size, radius, 4), mats);
    this.root.add(this.mesh);
    for (const f of GROUP_FACES.filter((x) => res.faces.find((y) => y.face === x)!.role === 'both'))
      this.outline!.add(new THREE.Mesh(edgeBand(f, size, radius, 0.004), new THREE.MeshStandardMaterial({ color: this.palette.platform, roughness: 0.7, metalness: 0, side: THREE.DoubleSide })));
    const sel = this.selected;
    if (sel && !isCone(sel)) {
      for (const e of edgeMidlines(size, radius).filter((x) => x.faces.includes(sel))) {
        const line = fatLine(e.points, 2.5);
        const m = line.material as LineMaterial;
        m.color.copy(this.palette.accent);
        m.transparent = false;
        m.depthWrite = true;
        // a little outside the surface, so the lines are not cut by it
        line.scale.setScalar(1.015);
        this.outline!.add(line);
      }
    }
    return 0.5 * size.length() * 1.06;
  }

  /** Two opaque cones coloured by role; the picked one outlined (a larger copy seen from inside, behind it). */
  private buildBicone(res: BiconeResult): number {
    const s = biconeSize(res, CONE_MIN_HEIGHT);
    const geo = biconeGeometries(s, 0.08 * s.radius, 0.14 * s.radius, 48);
    for (const cone of ['upper', 'lower'] as const) {
      const role = res.cones.find((c) => c.cone === cone)!.role;
      const mesh = new THREE.Mesh(cone === 'upper' ? geo.upper : geo.lower, new THREE.MeshStandardMaterial({ color: role === 'flaking' ? this.palette.flaking : this.palette.none, roughness: 0.7, metalness: 0 }));
      this.root.add(mesh);
      this.cones.push({ cone, mesh });
      if (cone === this.selected) {
        // the copy closed by its base (facing away from the cone), so its inside shows all round
        const cap = new THREE.CircleGeometry(geo.rim, 48).rotateX(cone === 'upper' ? Math.PI / 2 : -Math.PI / 2);
        const shell = mergeGeometries([mesh.geometry.clone().deleteAttribute('uv'), cap.deleteAttribute('uv')].map((g) => g.toNonIndexed()))!;
        cap.dispose();
        const ring = new THREE.Mesh(shell, new THREE.MeshBasicMaterial({ color: this.palette.accent, side: THREE.BackSide }));
        ring.scale.setScalar(OUTLINE_SCALE);
        this.outline!.add(ring);
      }
    }
    // framed by its outline: centred in each pose, never wider or taller than this
    this.drawnCones = { rim: geo.rim, upper: s.upper, lower: s.lower };
    return Math.max(geo.rim, (s.upper + s.lower) / 2) * OUTLINE_SCALE * 1.06;
  }

  /** After each frame of the main view: the shape in its corner. */
  private draw(): void {
    if (!this.shown || (!this.mesh && !this.cones.length)) return;
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
    // the board shows through where the shape is not
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    this.draws++;
    r.setScissorTest(false);
    r.setViewport(0, 0, canvas.width, canvas.height);
    r.setScissor(0, 0, canvas.width, canvas.height);
    r.autoClear = autoClear;
  }

  private pickAt(clientX: number, clientY: number): ConfigPick | null {
    this.pose();
    const rect = this.hit.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    if (this.cones.length) {
      const hit = ray.intersectObjects(this.cones.map((c) => c.mesh), false)[0];
      return hit ? (this.cones.find((c) => c.mesh === hit.object)?.cone ?? null) : null;
    }
    if (!this.mesh) return null;
    const hit = ray.intersectObject(this.mesh, false)[0];
    return hit?.face ? (GROUP_FACES[hit.face.materialIndex] ?? null) : null;
  }
}

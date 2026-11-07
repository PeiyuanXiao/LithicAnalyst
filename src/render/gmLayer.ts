import * as THREE from 'three';
import type { Vec3 } from '../core/types';
import { dotLimitsPx, dotWorldDiameter } from './landmarkSize';
import type { Viewer } from './viewer';

/** A neutral dot with a dark ring, to be seen on the mesh in both themes; no yellow: yellow means selected. */
const FILL = new THREE.Color('#f1f0ea');
const RING = new THREE.Color('#34342f');

/** The ring round a point the check flagged, and how much larger it makes the dot. */
const FLAG = new THREE.Color('#e8a33a');
const FLAG_SCALE = 1.7;

/**
 * A specimen's semilandmarks: small dots of the semilandmarks' size (`dotDiameterPx`, worked out per point in the shader). They lie on the surface and can be
 * hidden by it; moved a little toward the camera, further than the curves are, so that neither the triangle they lie on nor a curve covers them. A flagged one has an amber ring.
 */
export class GmLayer {
  readonly group = new THREE.Group();
  private readonly points: THREE.Points;
  private readonly uniforms = {
    /** The dot's diameter on the model. */
    diameter: { value: 1 },
    /** CSS pixels per model unit, at a depth of one unit. */
    pxPerWorld: { value: 1 },
    minPx: { value: dotLimitsPx('semi')[0] },
    maxPx: { value: dotLimitsPx('semi')[1] },
    /** Device pixels per CSS pixel. */
    ratio: { value: 1 },
    flagScale: { value: FLAG_SCALE },
    fill: { value: FILL },
    ring: { value: RING },
    flag: { value: FLAG },
  };

  constructor(private readonly viewer: Viewer) {
    this.group.name = 'gm-points';
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        uniform float diameter;
        uniform float pxPerWorld;
        uniform float minPx;
        uniform float maxPx;
        uniform float ratio;
        uniform float flagScale;
        attribute float flagged;
        varying float vFlagged;
        void main() {
          vec4 at = modelViewMatrix * vec4(position, 1.0);
          float px = clamp(diameter * pxPerWorld / -at.z, minPx, maxPx);
          at.xyz *= 0.995;
          gl_Position = projectionMatrix * at;
          gl_PointSize = px * ratio * (flagged > 0.5 ? flagScale : 1.0);
          vFlagged = flagged;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 fill;
        uniform vec3 ring;
        uniform vec3 flag;
        uniform float flagScale;
        varying float vFlagged;
        void main() {
          float r = length(gl_PointCoord * 2.0 - 1.0);
          if (r > 1.0) discard;
          // a flagged dot is the plain one with the ring around it
          float k = vFlagged > 0.5 ? flagScale : 1.0;
          vec3 c = vFlagged > 0.5 && r * k > 1.0 ? flag : (r * k > 0.62 ? ring : fill);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 16;
    this.group.add(this.points);
    viewer.overlay.add(this.group);
    // (a resize counts as a change of the camera)
    viewer.onCameraChange(() => this.fit());
    this.fit();
  }

  /** What the sizes on the screen depend on, as the view is now. */
  private fit(): void {
    const v = this.viewer;
    this.uniforms.diameter.value = dotWorldDiameter('semi', v.diagonal);
    this.uniforms.pxPerWorld.value = (v.container.clientHeight || 1) / (2 * Math.tan(THREE.MathUtils.degToRad(v.camera.fov) / 2));
    this.uniforms.ratio.value = v.renderer.getPixelRatio();
  }

  /** `origin` is subtracted for float precision on the GPU; `flagged`: which of the points have the ring. */
  sync(points: readonly Vec3[], origin: Vec3, flagged: readonly boolean[] = []): void {
    this.fit();
    this.group.position.set(origin[0], origin[1], origin[2]);
    const flat = new Float32Array(points.length * 3);
    points.forEach((p, i) => flat.set([p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]], 3 * i));
    this.points.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(flat, 3));
    g.setAttribute('flagged', new THREE.BufferAttribute(Float32Array.from(points, (_, i) => (flagged[i] ? 1 : 0)), 1));
    this.points.geometry = g;
    this.viewer.requestRender();
  }

  /** What is on the view (for the tests). */
  counts(): { shown: boolean; points: number; flagged: number } {
    const flags = this.points.geometry.getAttribute('flagged');
    return { shown: this.group.visible, points: flags?.count ?? 0, flagged: flags ? (Array.from(flags.array as Float32Array).filter((v) => v > 0.5).length) : 0 };
  }
}

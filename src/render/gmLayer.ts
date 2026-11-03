import * as THREE from 'three';
import type { Vec3 } from '../core/types';
import type { Viewer } from './viewer';

/** A neutral dot with a dark ring, to be seen on the mesh in both themes; no yellow: yellow means selected. */
const FILL = new THREE.Color('#f1f0ea');
const RING = new THREE.Color('#34342f');

/**
 * A flake's semilandmarks: small dots of a constant size on the screen. They lie on the surface and can be hidden by it;
 * moved a little toward the camera, further than the curves are, so that neither the triangle they lie on nor a curve covers them.
 */
export class GmLayer {
  readonly group = new THREE.Group();
  private readonly points: THREE.Points;

  constructor(private readonly viewer: Viewer) {
    this.group.name = 'gm-points';
    const material = new THREE.ShaderMaterial({
      uniforms: { size: { value: 6 * window.devicePixelRatio }, fill: { value: FILL }, ring: { value: RING } },
      vertexShader: /* glsl */ `
        uniform float size;
        void main() {
          vec4 at = modelViewMatrix * vec4(position, 1.0);
          at.xyz *= 0.995;
          gl_Position = projectionMatrix * at;
          gl_PointSize = size;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 fill;
        uniform vec3 ring;
        void main() {
          float r = length(gl_PointCoord * 2.0 - 1.0);
          if (r > 1.0) discard;
          gl_FragColor = vec4(r > 0.62 ? ring : fill, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 16;
    this.group.add(this.points);
    viewer.overlay.add(this.group);
  }

  /** `origin` is subtracted for float precision on the GPU. */
  sync(points: readonly Vec3[], origin: Vec3): void {
    this.group.position.set(origin[0], origin[1], origin[2]);
    const flat = new Float32Array(points.length * 3);
    points.forEach((p, i) => flat.set([p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]], 3 * i));
    this.points.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(flat, 3));
    this.points.geometry = g;
    this.viewer.requestRender();
  }
}

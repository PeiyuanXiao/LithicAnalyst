import * as THREE from 'three';

export interface LightSettings {
  /** Direction the light comes from, measured on screen: 0° = right, 90° = top, 135° = upper left. */
  azimuthDeg: number;
  /** 90° = straight from the viewer (flat), small values = grazing (raking) light. */
  elevationDeg: number;
  /** Strength of the directional key light. */
  keyIntensity: number;
  /** Strength of the soft fill light. */
  fillIntensity: number;
}

export const DEFAULT_LIGHT: LightSettings = {
  azimuthDeg: 135,
  elevationDeg: 35,
  keyIntensity: 2.6,
  fillIntensity: 0.55,
};

/**
 * The light from a point of a disc round the viewer's axis (the view under the L key, the light
 * ball): x right, y up, 1 at the rim. The direction it lies in is the azimuth; the height falls from
 * 90° at the centre to 5° (raking) at the rim, and stays there beyond it.
 */
export function lightFromDisc(x: number, y: number): { azimuthDeg: number; elevationDeg: number } {
  return { azimuthDeg: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360, elevationDeg: 90 - 85 * Math.min(1, Math.hypot(x, y)) };
}

/** Where on that disc a light is (the inverse of lightFromDisc). */
export function discFromLight(azimuthDeg: number, elevationDeg: number): { x: number; y: number } {
  const r = (90 - elevationDeg) / 85;
  const a = (azimuthDeg * Math.PI) / 180;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

/**
 * Key light fixed relative to the viewer (as a lamp on the desk would be), so
 * turning the specimen moves the relief under a constant light — the usual way
 * of reading ripples and negative bulbs.
 */
export class LightRig {
  readonly key = new THREE.DirectionalLight(0xffffff, DEFAULT_LIGHT.keyIntensity);
  readonly fill = new THREE.HemisphereLight(0xf4f6f8, 0x5a5f66, DEFAULT_LIGHT.fillIntensity);
  readonly settings: LightSettings = { ...DEFAULT_LIGHT };
  private readonly tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    scene.add(this.key, this.key.target, this.fill);
  }

  set(patch: Partial<LightSettings>): void {
    Object.assign(this.settings, patch);
    this.key.intensity = this.settings.keyIntensity;
    this.fill.intensity = this.settings.fillIntensity;
  }

  /** Call before each render. */
  update(camera: THREE.Camera, target: THREE.Vector3, distance: number): void {
    const az = THREE.MathUtils.degToRad(this.settings.azimuthDeg);
    const el = THREE.MathUtils.degToRad(this.settings.elevationDeg);
    // camera space: x right, y up, z toward the viewer
    this.tmp.set(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el));
    this.tmp.applyQuaternion(camera.quaternion);
    this.key.position.copy(target).addScaledVector(this.tmp, distance);
    this.key.target.position.copy(target);
    this.key.target.updateMatrixWorld();
    // hemisphere "sky" follows the viewer's up direction
    this.fill.position.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion));
  }
}

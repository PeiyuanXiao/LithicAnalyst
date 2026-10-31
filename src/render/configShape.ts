import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { FACE_AXIS, type ConfigurationResult } from '../compute/configuration';
import { CONFIG_FACES, type ConfigFace, type ConfigRole } from '../core/fields';

/**
 * What the configuration sketch (floating panel) and the view cube share: a rounded
 * box in the proportions of the model's box, coloured by the role of each face,
 * the midlines of its rounded edges, and the colours (CSS tokens of the theme).
 * Box coordinates: X, Y, Z of the configuration box, the longest side 1.
 */

/** The faces of BoxGeometry's groups, in order (+X, −X, +Y, −Y, +Z, −Z). */
export const GROUP_FACES: readonly ConfigFace[] = ['right', 'left', 'top', 'bottom', 'front', 'back'];

export interface ConfigPalette {
  flaking: THREE.Color;
  platform: THREE.Color;
  none: THREE.Color;
  ink: THREE.Color;
  accent: THREE.Color;
}

/** The theme's colours (read again when the theme changes). */
export function readPalette(): ConfigPalette {
  const s = getComputedStyle(document.documentElement);
  const c = (name: string, fallback: string) => new THREE.Color(s.getPropertyValue(name).trim() || fallback);
  return {
    flaking: c('--cfg-flaking', '#7d9a86'),
    platform: c('--cfg-platform', '#d6bf8e'),
    none: c('--cfg-none', '#c9c6bc'),
    ink: c('--ink', '#23211c'),
    accent: c('--accent-line', '#a8670f'),
  };
}

/** A face is drawn as a flaking surface when it is one (also as a platform), else as a platform, else unexploited. */
export const roleColor = (p: ConfigPalette, role: ConfigRole): THREE.Color => (role === 'flaking' || role === 'both' ? p.flaking : role === 'platform' ? p.platform : p.none);

/** The box's sides with the longest 1 and none shorter than `minRatio` (a drawing, not a measurement). */
export function shapeSize(r: Pick<ConfigurationResult, 'min' | 'max'>, minRatio: number): THREE.Vector3 {
  const s = [0, 1, 2].map((k) => Math.max(0, r.max[k] - r.min[k]));
  const top = Math.max(...s) || 1;
  const [x, y, z] = s.map((v) => Math.max(minRatio, v / top));
  return new THREE.Vector3(x, y, z);
}

export const radiusOf = (size: THREE.Vector3, share: number): number => share * Math.min(size.x, size.y, size.z);

export function roundedBox(size: THREE.Vector3, radius: number, segments = 5): THREE.BufferGeometry {
  return new RoundedBoxGeometry(size.x, size.y, size.z, segments, radius);
}

/** Outward unit normal of a face. */
export function faceNormal(f: ConfigFace): THREE.Vector3 {
  const [a, side] = FACE_AXIS[f];
  return new THREE.Vector3().setComponent(a, side);
}

/** Centre of a face (on its flat part). */
export const faceCentre = (f: ConfigFace, size: THREE.Vector3): THREE.Vector3 => faceNormal(f).multiplyScalar(size.getComponent(FACE_AXIS[f][0]) / 2);

/**
 * The twelve edges, each along the middle of its rounded fillet, meeting at the
 * corners on the corner's diagonal; with the two faces it joins.
 */
export function edgeMidlines(size: THREE.Vector3, radius: number): Array<{ faces: [ConfigFace, ConfigFace]; points: THREE.Vector3[] }> {
  const half = size.clone().multiplyScalar(0.5);
  const out: Array<{ faces: [ConfigFace, ConfigFace]; points: THREE.Vector3[] }> = [];
  const faceOf = (axis: number, side: number) => CONFIG_FACES.find((f) => FACE_AXIS[f][0] === axis && FACE_AXIS[f][1] === side)!;
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, c = (a + 2) % 3;
    for (const sb of [1, -1])
      for (const sc of [1, -1]) {
        const points: THREE.Vector3[] = [];
        const across = new THREE.Vector3().setComponent(b, sb).setComponent(c, sc).normalize();
        for (const end of [-1, 1]) {
          // the corner's sphere: from its diagonal to where the fillet begins (or back)
          const centre = new THREE.Vector3()
            .setComponent(a, end * (half.getComponent(a) - radius))
            .setComponent(b, sb * (half.getComponent(b) - radius))
            .setComponent(c, sc * (half.getComponent(c) - radius));
          const diagonal = new THREE.Vector3().setComponent(a, end).setComponent(b, sb).setComponent(c, sc).normalize();
          const arc: THREE.Vector3[] = [];
          for (let k = 0; k <= 4; k++) arc.push(centre.clone().addScaledVector(diagonal.clone().lerp(across, k / 4).normalize(), radius));
          points.push(...(end < 0 ? arc : arc.reverse()));
        }
        out.push({ faces: [faceOf(b, sb), faceOf(c, sc)], points });
      }
  }
  return out;
}

export function fatLine(points: THREE.Vector3[], width: number): Line2 {
  const g = new LineGeometry();
  g.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
  const m = new LineMaterial({ linewidth: width, transparent: true, depthWrite: false });
  const line = new Line2(g, m);
  line.computeLineDistances();
  return line;
}

/** The face's outward normal points to the camera (`toCamera`: from the box toward the eye, box coordinates). */
export const facesViewer = (f: ConfigFace, toCamera: THREE.Vector3): boolean => faceNormal(f).dot(toCamera) > 1e-6;

/** The two box axes in a face (u, w with u × w along the face's axis). */
const inFace = (f: ConfigFace): [number, number] => {
  const a = FACE_AXIS[f][0];
  return [(a + 1) % 3, (a + 2) % 3];
};

/**
 * A band along the four edges of a face, inside its flat part, `share` of the
 * face's shorter side wide (a face that is a flaking surface and a platform:
 * the platform's colour round the flaking surface's). Lifted `lift` off the face.
 */
export function edgeBand(face: ConfigFace, size: THREE.Vector3, radius: number, lift: number, share = 0.08): THREE.BufferGeometry {
  const [a, side] = FACE_AXIS[face];
  const [u, w] = inFace(face);
  const hu = Math.max(0, size.getComponent(u) / 2 - radius), hw = Math.max(0, size.getComponent(w) / 2 - radius);
  const width = share * Math.min(size.getComponent(u), size.getComponent(w));
  const iu = Math.max(0, hu - width), iw = Math.max(0, hw - width);
  const V = (x: number, y: number) => new THREE.Vector2(x, y);
  const shape = new THREE.Shape([V(-hu, -hw), V(hu, -hw), V(hu, hw), V(-hu, hw)]);
  shape.holes.push(new THREE.Path([V(-iu, -iw), V(-iu, iw), V(iu, iw), V(iu, -iw)]));
  const g = new THREE.ShapeGeometry(shape);
  const e = (k: number) => new THREE.Vector3().setComponent(k, 1);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(e(u), e(w), e(a)).setPosition(e(a).multiplyScalar(side * (size.getComponent(a) / 2 + lift))));
  return g;
}

/** One scar's arrow on the sketch: on the flat part of its face (box coordinates of the sketch, not lifted). */
export interface SketchArrow {
  id: string;
  face: ConfigFace;
  /** Its face is a flaking surface (the scar counts). */
  counted: boolean;
  start: THREE.Vector3;
  end: THREE.Vector3;
}

/** Margin kept from the fillet, as a share of the face along each axis. */
const ARROW_MARGIN = 0.06;
/** Shortest arrow drawn, as a share of the face's shorter side. */
const ARROW_MIN = 0.08;

/**
 * Every scar with an arrow, put on its face: its ends in box coordinates scaled
 * to [−1, 1] and laid on the sketch's box (the face's own axis at the face), kept
 * on the face's flat part with a margin; one too short after that is drawn at
 * the shortest length, the same way.
 */
export function sketchArrows(r: Pick<ConfigurationResult, 'axes' | 'min' | 'max' | 'scars'>, scars: ReadonlyArray<{ id: string; vector?: { start: readonly number[]; end: readonly number[] } | null }>, size: THREE.Vector3, radius: number): SketchArrow[] {
  const placed = new Map(r.scars.map((s) => [s.id, s]));
  const half = size.clone().multiplyScalar(0.5);
  const toSketch = (p: readonly number[], face: ConfigFace): THREE.Vector3 => {
    const q = new THREE.Vector3();
    for (let k = 0; k < 3; k++) {
      const a = r.axes[k];
      const x = p[0] * a[0] + p[1] * a[1] + p[2] * a[2];
      const span = r.max[k] - r.min[k];
      q.setComponent(k, (span > 0 ? (2 * (x - r.min[k])) / span - 1 : 0) * half.getComponent(k));
    }
    const [a, side] = FACE_AXIS[face];
    return q.setComponent(a, side * half.getComponent(a));
  };
  const out: SketchArrow[] = [];
  for (const s of scars) {
    const p = placed.get(s.id);
    if (!p || !s.vector) continue;
    const [u, w] = inFace(p.face);
    const start = toSketch(s.vector.start, p.face), end = toSketch(s.vector.end, p.face);
    const raw = end.clone().sub(start);
    const limit = (k: number) => Math.max(0, half.getComponent(k) - radius - ARROW_MARGIN * size.getComponent(k));
    for (const k of [u, w])
      for (const q of [start, end]) q.setComponent(k, THREE.MathUtils.clamp(q.getComponent(k), -limit(k), limit(k)));
    const shortest = ARROW_MIN * Math.min(size.getComponent(u), size.getComponent(w));
    if (start.distanceTo(end) < shortest) {
      const dir = end.clone().sub(start);
      if (dir.lengthSq() < 1e-12) dir.copy(raw);
      if (dir.lengthSq() < 1e-12) dir.setComponent(u, 1);
      dir.normalize().multiplyScalar(shortest / 2);
      const mid = start.clone().add(end).multiplyScalar(0.5);
      start.copy(mid).sub(dir);
      end.copy(mid).add(dir);
      // back onto the flat part, as a whole
      for (const k of [u, w]) {
        const lo = Math.min(start.getComponent(k), end.getComponent(k)), hi = Math.max(start.getComponent(k), end.getComponent(k));
        const shift = hi > limit(k) ? limit(k) - hi : lo < -limit(k) ? -limit(k) - lo : 0;
        start.setComponent(k, start.getComponent(k) + shift);
        end.setComponent(k, end.getComponent(k) + shift);
      }
    }
    out.push({ id: s.id, face: p.face, counted: p.surface !== null, start, end });
  }
  return out;
}

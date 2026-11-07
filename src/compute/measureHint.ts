import { fmtQuantity, quantityUnit, type Quantity } from '../core/format';
import type { Vec3 } from '../core/types';
import type { ConfigBox } from './configuration';
import { angleDeg, EPA_DISTANCES_MM, type FlakeMeasure, type FlakeResult, type MorphConstruction, type ProfileConstruction, type TechConstruction } from './flake';
import type { SphereFit } from './sphere';
import type { SplitParts } from './split';

/**
 * What the measure mode draws to show how a number was made. Only what the measuring functions returned (their
 * `construction`, the box, the split's parts, the stations) goes in, turned into lines, dots, arcs and pieces of surface; nothing is measured again.
 * No three.js: `render/hintLayer.ts` draws these, the tests read them.
 */

/** How the hints look, apart from the theme's colours. */
export const MEASURE_HINT_PARAMETERS = {
  /** How long the pointer stays on a row before its hint is drawn, in ms. */
  HOVER_MS: 150,
  /** Points of an arc. */
  ARC_SEGMENTS: 32,
  /** An angle's arc, as a share of its shorter side. */
  ARC_SHARE: 0.35,
  /** The arrow head of the technical axis, as a share of its length. */
  AXIS_HEAD_SHARE: 0.06,
  /** The circle standing for a splitting plane, as a share of the model's diagonal. */
  SPLIT_DISC_SHARE: 0.55,
  /** Points of a circle. */
  CIRCLE_SEGMENTS: 96,
};

/** `current`: the measure the row is about; `other`: what else belongs to the drawing. */
export type HintRole = 'current' | 'other';

export interface HintLine {
  kind: 'line';
  /** What this is, for the tests. */
  part: string;
  role: HintRole;
  points: readonly Vec3[];
  /** The points go by twos (the edges of a box, a chain of mesh edges), not one after another. */
  segments?: boolean;
  closed?: boolean;
  /** The value, written at `labelAt`. */
  label?: string;
  labelAt?: Vec3;
}

export interface HintDots {
  kind: 'dots';
  part: string;
  role: HintRole;
  points: Vec3[];
}

export interface HintArc {
  kind: 'arc';
  part: string;
  role: HintRole;
  /** The vertex of the angle and the two unit directions: the angle between them is the value. */
  at: Vec3;
  from: Vec3;
  to: Vec3;
  /** The arc itself. */
  points: Vec3[];
  label?: string;
  labelAt?: Vec3;
}

/** Part of the surface, in the triangles of the mesh; `through`: shown even where the model hides it. */
export interface HintFaces {
  kind: 'faces';
  part: string;
  tint: 'current' | 'upper' | 'lower';
  faces: 'all' | ArrayLike<number>;
  through: boolean;
}

export type HintPrim = HintLine | HintDots | HintArc | HintFaces;
export type MeasureHint = HintPrim[];

const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const size = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit3 = (a: Vec3): Vec3 => {
  const l = size(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
const middle = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/** A value as the interface writes it, with its unit. */
function written(kind: Quantity, value: number, unit: string): string {
  const u = quantityUnit(kind, unit);
  return `${fmtQuantity(kind, value)}${u === '°' || !u ? u : ` ${u}`}`;
}

const dimension = (part: string, role: HintRole, a: Vec3, b: Vec3, kind: Quantity, value: number, unit: string): HintLine => ({ kind: 'line', part, role, points: [a, b], label: written(kind, value, unit), labelAt: middle(a, b) });

/** Halfway along a polyline. */
function halfway(points: readonly Vec3[]): Vec3 {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += size(sub(points[i], points[i - 1]));
  let left = total / 2;
  for (let i = 1; i < points.length; i++) {
    const l = size(sub(points[i], points[i - 1]));
    if (l >= left) return add(points[i - 1], sub(points[i], points[i - 1]), l > 0 ? left / l : 0);
    left -= l;
  }
  return points[points.length - 1];
}

/** The points of an arc from one unit direction to another, round the vertex. */
export function arcPoints(at: Vec3, from: Vec3, to: Vec3, radius: number): Vec3[] {
  const c = Math.max(-1, Math.min(1, dot(from, to)));
  const angle = Math.acos(c);
  const across = unit3(add(to, from, -c));
  const n = MEASURE_HINT_PARAMETERS.ARC_SEGMENTS;
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = (angle * k) / n;
    const d = add(add([0, 0, 0], from, Math.cos(t)), across, Math.sin(t));
    return add(at, d, radius);
  });
}

function angleArc(part: string, role: HintRole, at: Vec3, from: Vec3, to: Vec3, radius: number, value: number): HintArc {
  const points = arcPoints(at, from, to, radius);
  // the label a little outside the arc's middle
  const mid = points[Math.floor(points.length / 2)];
  return { kind: 'arc', part, role, at, from, to, points, label: written('angle', value, ''), labelAt: add(at, sub(mid, at), 1.25) };
}

// ---------------------------------------------------------------- a box

/** A box: its corners in the frame (x, y, z in min..max), put into original coordinates. */
interface HintBox {
  at: (x: number, y: number, z: number) => Vec3;
  min: Vec3;
  max: Vec3;
}

function boxEdges(b: HintBox, part: string): HintLine {
  const { min: l, max: h } = b;
  const points: Vec3[] = [];
  const edge = (p: [number, number, number], q: [number, number, number]) => points.push(b.at(...p), b.at(...q));
  for (const [y, z] of [[l[1], l[2]], [l[1], h[2]], [h[1], l[2]], [h[1], h[2]]]) edge([l[0], y, z], [h[0], y, z]);
  for (const [x, z] of [[l[0], l[2]], [l[0], h[2]], [h[0], l[2]], [h[0], h[2]]]) edge([x, l[1], z], [x, h[1], z]);
  for (const [x, y] of [[l[0], l[1]], [l[0], h[1]], [h[0], l[1]], [h[0], h[1]]]) edge([x, y, l[2]], [x, y, h[2]]);
  return { kind: 'line', part, role: 'other', points, segments: true };
}

type Side = 'length' | 'width' | 'thickness';

/** Three dimension lines along the box's edges, from one corner. */
function boxDimensions(b: HintBox, current: Side, values: Record<Side, number>, unit: string): HintLine[] {
  const { min: l, max: h } = b;
  const corner = b.at(h[0], l[1], h[2]);
  const role = (s: Side): HintRole => (s === current ? 'current' : 'other');
  const lines = {
    length: dimension('length', role('length'), corner, b.at(h[0], h[1], h[2]), 'length', values.length, unit),
    width: dimension('width', role('width'), b.at(l[0], l[1], h[2]), corner, 'length', values.width, unit),
    thickness: dimension('thickness', role('thickness'), b.at(h[0], l[1], l[2]), corner, 'length', values.thickness, unit),
  };
  // the current one is drawn last, over the others
  return (['length', 'width', 'thickness'] as const).filter((s) => s !== current).map((s) => lines[s]).concat(lines[current]);
}

const frameBox = (origin: Vec3, axes: readonly [Vec3, Vec3, Vec3], min: Vec3, max: Vec3): HintBox => ({
  min,
  max,
  at: (x, y, z) => add(add(add(origin, axes[0], x), axes[1], y), axes[2], z),
});

/** A core's or a generic specimen's length, width and thickness: the box along the specimen's frame and three lines. */
export function boxHint(current: Side, box: ConfigBox, values: Record<Side, number>, unit: string): MeasureHint {
  const b = frameBox([0, 0, 0], box.axes, box.min, box.max);
  return [boxEdges(b, 'box'), ...boxDimensions(b, current, values, unit)];
}

// ---------------------------------------------------------------- a flake

function techHint(current: Side, c: TechConstruction, values: Record<Side, number>, unit: string): MeasureHint {
  const b = frameBox(c.origin, c.axes, c.min, c.max);
  const [x, y] = c.axes;
  const reach = c.max[1];
  const tip = add(c.origin, y, reach);
  const head = reach * MEASURE_HINT_PARAMETERS.AXIS_HEAD_SHARE;
  const e = c.extremes;
  const reached = { length: [e.yMax], width: [e.xMin, e.xMax], thickness: [e.zMin, e.zMax] };
  return [
    boxEdges(b, 'box'),
    { kind: 'line', part: 'axis', role: 'other', points: [c.origin, tip] },
    { kind: 'line', part: 'axis-head', role: 'other', points: [add(add(tip, y, -head), x, head / 2), tip, add(add(tip, y, -head), x, -head / 2)] },
    ...boxDimensions(b, current, values, unit),
    { kind: 'dots', part: 'extremes', role: 'other', points: (['length', 'width', 'thickness'] as const).filter((s) => s !== current).flatMap((s) => reached[s]) },
    { kind: 'dots', part: 'extremes', role: 'current', points: reached[current] },
  ];
}

function morphHint(current: Side, c: MorphConstruction, values: Record<Side, number>, unit: string): MeasureHint {
  const role = (s: Side): HintRole => (s === current ? 'current' : 'other');
  const lines = {
    length: dimension('length', role('length'), c.length[0], c.length[1], 'length', values.length, unit),
    width: dimension('width', role('width'), c.width[0], c.width[1], 'length', values.width, unit),
    thickness: dimension('thickness', role('thickness'), c.thickness[0], c.thickness[1], 'length', values.thickness, unit),
  };
  const reached = { length: c.length, width: c.widthVertices, thickness: c.thicknessVertices };
  const others = (['length', 'width', 'thickness'] as const).filter((s) => s !== current);
  return [
    ...others.map((s) => lines[s]),
    lines[current],
    { kind: 'dots', part: 'extremes', role: 'other', points: others.flatMap((s) => reached[s]) },
    { kind: 'dots', part: 'extremes', role: 'current', points: [...reached[current]] },
  ];
}

/** The straight distance and the way over the surface between two points, one of them the measure; the points as dots. */
function chordAndPath(current: 'chord' | 'path', a: Vec3, b: Vec3, path: Vec3[] | null, chord: number | null, along: number | null, unit: string): MeasureHint {
  const out: MeasureHint = [];
  const line = chord !== null ? dimension('chord', current === 'chord' ? 'current' : 'other', a, b, 'length', chord, unit) : null;
  const way: HintLine | null = path && along !== null ? { kind: 'line', part: 'path', role: current === 'path' ? 'current' : 'other', points: path, label: written('length', along, unit), labelAt: halfway(path) } : null;
  // the current one last, over the other
  for (const l of current === 'chord' ? [way, line] : [line, way]) if (l) out.push(l);
  out.push({ kind: 'dots', part: 'ends', role: 'current', points: [a, b] });
  return out;
}

const sectionLine = (p: ProfileConstruction): HintLine => ({ kind: 'line', part: 'section', role: 'other', points: p.section, closed: p.closed });

/** EPA at one of its distances, by three points or by two lines. */
function epaHint(method: '3pt' | '2ln', i: number, p: ProfileConstruction, value: number): MeasureHint | null {
  const { lineDir, platformLine, E, P } = p;
  const Q = p.q[i], chord = p.chords[i];
  if (!lineDir || !platformLine || !Q) return null;
  const toPlatform: Vec3 = [-lineDir[0], -lineDir[1], -lineDir[2]];
  const others = p.q.filter((q, k): q is Vec3 => k !== i && !!q);
  const side = size(sub(Q, E));
  const radius = Math.min(side, size(sub(platformLine[0], platformLine[1]))) * MEASURE_HINT_PARAMETERS.ARC_SHARE;
  const out: MeasureHint = [sectionLine(p), { kind: 'dots', part: 'other-distances', role: 'other', points: others }, { kind: 'line', part: 'platform-line', role: 'current', points: platformLine }];
  if (method === '3pt') {
    out.push({ kind: 'line', part: 'to-q', role: 'current', points: [E, Q] });
    out.push(angleArc('arc', 'current', E, toPlatform, unit3(sub(Q, E)), radius, value));
  } else {
    if (!chord) return null;
    const dir = unit3(sub(chord[1], chord[0]));
    // the chord where it was taken, and its direction from E, where the angle is shown
    out.push({ kind: 'line', part: 'chord', role: 'current', points: chord });
    out.push({ kind: 'line', part: 'chord-direction', role: 'other', points: [E, add(E, dir, side)] });
    out.push(angleArc('arc', 'current', E, toPlatform, dir, radius, value));
  }
  out.push({ kind: 'dots', part: 'points', role: 'current', points: [P, E, Q] });
  return out;
}

/** Where two lines come closest; null when they are as good as parallel. */
function meeting(a: Vec3, u: Vec3, b: Vec3, v: Vec3): Vec3 | null {
  const c = dot(u, v);
  const den = 1 - c * c;
  if (den < 1e-9) return null;
  const w = sub(a, b);
  const s = (c * dot(v, w) - dot(u, w)) / den;
  return add(a, u, s);
}

function ipaHint(p: ProfileConstruction, value: number): MeasureHint | null {
  const { lineDir, ventralDir, platformLine, ventralLine } = p;
  if (!lineDir || !ventralDir || !platformLine || !ventralLine) return null;
  const at = meeting(platformLine[0], lineDir, ventralLine[0], ventralDir) ?? p.P;
  const side = Math.min(size(sub(platformLine[1], at)), size(sub(ventralLine[1], at)));
  return [
    sectionLine(p),
    ...(p.ventral ? [{ kind: 'line', part: 'ventral', role: 'other', points: p.ventral } as HintLine] : []),
    { kind: 'line', part: 'platform-line', role: 'current', points: [at, platformLine[1]] },
    { kind: 'line', part: 'ventral-line', role: 'current', points: [at, ventralLine[1]] },
    angleArc('arc', 'current', at, lineDir, ventralDir, side * MEASURE_HINT_PARAMETERS.ARC_SHARE, value),
    { kind: 'dots', part: 'points', role: 'other', points: [p.P, p.E] },
  ];
}

const EPA_KEY = /^epa_(3pt|2ln)_(\d+)mm$/;

/** The drawing of one of a flake's measures; null when it is empty, or what it was taken from is not known. */
export function flakeHint(key: FlakeMeasure, r: FlakeResult, unit: string): MeasureHint | null {
  const value = r.measures[key];
  if (value === null) return null;
  const c = r.construction;
  const m = r.measures;
  switch (key) {
    case 'tech_length':
    case 'tech_width':
    case 'tech_thickness':
      return c.tech && m.tech_length !== null && m.tech_width !== null && m.tech_thickness !== null ? techHint(key.slice(5) as Side, c.tech, { length: m.tech_length, width: m.tech_width, thickness: m.tech_thickness }, unit) : null;
    case 'morph_length':
    case 'morph_width':
    case 'morph_thickness':
      return c.morph && m.morph_length !== null && m.morph_width !== null && m.morph_thickness !== null ? morphHint(key.slice(6) as Side, c.morph, { length: m.morph_length, width: m.morph_width, thickness: m.morph_thickness }, unit) : null;
    case 'morph_tech_angle_deg': {
      const a = c.angle;
      if (!a) return null;
      return [
        { kind: 'line', part: 'technical-axis', role: 'current', points: [a.origin, add(a.origin, a.tech, a.reach)] },
        { kind: 'line', part: 'morphological-axis', role: 'current', points: [a.origin, add(a.origin, a.morph, a.reach)] },
        angleArc('arc', 'current', a.origin, a.tech, a.morph, a.reach * MEASURE_HINT_PARAMETERS.ARC_SHARE, value),
      ];
    }
    case 'platform_width_chord':
    case 'platform_width_path':
      return c.width ? chordAndPath(key.endsWith('chord') ? 'chord' : 'path', c.width.ends[0], c.width.ends[1], c.width.path, m.platform_width_chord, m.platform_width_path, unit) : null;
    case 'platform_depth_chord':
    case 'platform_depth_path':
      return c.depth ? chordAndPath(key.endsWith('chord') ? 'chord' : 'path', c.depth.P, c.depth.E, c.depth.path, m.platform_depth_chord, m.platform_depth_path, unit) : null;
    case 'platform_area':
      return c.platformFaces ? [{ kind: 'faces', part: 'platform', tint: 'current', faces: c.platformFaces, through: true }] : null;
    case 'ipa':
      return c.profile ? ipaHint(c.profile, value) : null;
    default: {
      const e = EPA_KEY.exec(key);
      if (!e || !c.profile) return null;
      const i = EPA_DISTANCES_MM.indexOf(Number(e[2]) as (typeof EPA_DISTANCES_MM)[number]);
      return i >= 0 ? epaHint(e[1] as '3pt' | '2ln', i, c.profile, value) : null;
    }
  }
}

// ---------------------------------------------------------------- others

/** The surface area or the volume: all of the model. */
export const wholeModelHint = (): MeasureHint => [{ kind: 'faces', part: 'model', tint: 'current', faces: 'all', through: false }];

/** The triangles on each side of a split, as lists. */
function splitFaces(flags: Uint8Array): { on: Uint32Array; off: Uint32Array } {
  let n = 0;
  for (let t = 0; t < flags.length; t++) if (flags[t]) n++;
  const on = new Uint32Array(n), off = new Uint32Array(flags.length - n);
  let a = 0, b = 0;
  for (let t = 0; t < flags.length; t++) {
    if (flags[t]) on[a++] = t;
    else off[b++] = t;
  }
  return { on, off };
}

/** A circle round a point in the plane across `normal`. */
function circle(centre: Vec3, normal: Vec3, radius: number): Vec3[] {
  const ref: Vec3 = Math.abs(normal[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  const u = unit3([normal[1] * ref[2] - normal[2] * ref[1], normal[2] * ref[0] - normal[0] * ref[2], normal[0] * ref[1] - normal[1] * ref[0]]);
  const v: Vec3 = [normal[1] * u[2] - normal[2] * u[1], normal[2] * u[0] - normal[0] * u[2], normal[0] * u[1] - normal[1] * u[0]];
  const n = MEASURE_HINT_PARAMETERS.CIRCLE_SEGMENTS;
  return Array.from({ length: n }, (_, k) => {
    const t = (2 * Math.PI * k) / n;
    return add(add(centre, u, radius * Math.cos(t)), v, radius * Math.sin(t));
  });
}

/**
 * The upper and lower volumes: what the split went along, and the two sides in two light colours. `parts` are in the mesh's
 * coordinates (relative to `offset`); `swap`: upper and lower are exchanged; `diagonal`: how large to draw a plane.
 */
export function splitHint(parts: SplitParts, swap: boolean, offset: Vec3, diagonal: number): MeasureHint {
  const { on, off } = splitFaces(parts.upper);
  const faces: MeasureHint = [
    { kind: 'faces', part: 'upper', tint: 'upper', faces: swap ? off : on, through: false },
    { kind: 'faces', part: 'lower', tint: 'lower', faces: swap ? on : off, through: false },
  ];
  if (parts.kind === 'plane') {
    const points = circle(add(parts.point, offset), parts.normal, diagonal * MEASURE_HINT_PARAMETERS.SPLIT_DISC_SHARE);
    return [...faces, { kind: 'line', part: 'split-plane', role: 'current', points, closed: true }];
  }
  return [...faces, { kind: 'line', part: 'split-curve', role: 'current', points: parts.segments.map((p) => add(p, offset)), segments: true }];
}

/** A curve measured for edge angles and its stations. */
export function stationsHint(line: { points: readonly Vec3[]; closed: boolean }, stations: ReadonlyArray<{ point: Vec3 | null }>): MeasureHint {
  return [
    { kind: 'line', part: 'curve', role: 'current', points: line.points, closed: line.closed },
    { kind: 'dots', part: 'stations', role: 'current', points: stations.flatMap((s) => (s.point ? [s.point] : [])) },
  ];
}

/** A curve's sharp stretches: the stations that count as sharp, run by run. */
export function sharpHint(line: { points: readonly Vec3[]; closed: boolean }, stations: ReadonlyArray<{ point: Vec3 | null }>, sharp: { mask: boolean[]; length: number }, unit: string): MeasureHint {
  const runs: Vec3[][] = [];
  let run: Vec3[] = [];
  sharp.mask.forEach((on, k) => {
    const p = stations[k]?.point;
    if (on && p) run.push(p);
    else {
      if (run.length) runs.push(run);
      run = [];
    }
  });
  if (run.length) runs.push(run);
  const longest = runs.reduce<Vec3[]>((b, r) => (r.length > b.length ? r : b), []);
  return [
    { kind: 'line', part: 'curve', role: 'other', points: line.points, closed: line.closed },
    ...runs.map((points): HintLine => (points === longest ? { kind: 'line', part: 'sharp', role: 'current', points, label: written('length', sharp.length, unit), labelAt: halfway(points) } : { kind: 'line', part: 'sharp', role: 'current', points })),
  ];
}

/** The sphere fitted to the cortex: three circles round it, and its radius. */
export function noduleHint(fit: Pick<SphereFit, 'center' | 'radius'>, unit: string): MeasureHint {
  const { center, radius } = fit;
  const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  return [
    ...axes.map((n): HintLine => ({ kind: 'line', part: 'sphere', role: 'other', points: circle(center, n, radius), closed: true })),
    dimension('radius', 'current', center, add(center, [1, 0, 0], radius), 'length', radius, unit),
    { kind: 'dots', part: 'centre', role: 'current', points: [center] },
  ];
}

/** The angle an arc shows (for tests). */
export const arcAngle = (a: HintArc): number | null => angleDeg(a.from, a.to);

import type { AutoMeasurements } from '../core/derived';
import type { SpecimenFrame, Vec3 } from '../core/types';
import type { ConfigBox } from './configuration';
import { buildEdgesSteps, meshTopologySteps, surfaceIntegralsSteps, surfacePca, vertexPcaSteps, type EdgeTable, type MeshTopology, type PrincipalAxes } from './meshGeometry';
import { runSync, YIELD_EVERY, type Steps } from './steps';

/** What the automatic measurements need from the mesh; computed once per mesh. */
export interface SurfaceMeasures {
  surfaceArea: number;
  /** Enclosed volume (absolute), or null when the mesh is not closed. */
  volume: number | null;
  topology: MeshTopology;
  /** Principal axes of the surface (area-weighted). */
  principal: PrincipalAxes;
  /** Principal axes of the vertices, every vertex counted once (the `all_vertices` plane and plane frames use it). */
  vertices: PrincipalAxes;
  /** Edge table, kept for plane sections. */
  edges: EdgeTable;
  /** Mean length of the mesh's edges. */
  meanEdge: number;
}

export function* surfaceMeasuresSteps(positions: ArrayLike<number>, index: ArrayLike<number>): Steps<SurfaceMeasures> {
  const integrals = yield* surfaceIntegralsSteps(positions, index);
  const vertexCount = Math.floor(positions.length / 3);
  const edges = yield* buildEdgesSteps(index, vertexCount);
  const topology = yield* meshTopologySteps(index, vertexCount, edges);
  const vertices = yield* vertexPcaSteps(positions);
  let sum = 0;
  const edgeCount = edges.v0.length;
  for (let e = 0; e < edgeCount; e++) {
    if (e % YIELD_EVERY === 0) yield;
    const a = 3 * edges.v0[e], b = 3 * edges.v1[e];
    sum += Math.hypot(positions[a] - positions[b], positions[a + 1] - positions[b + 1], positions[a + 2] - positions[b + 2]);
  }
  return {
    surfaceArea: integrals.area,
    volume: topology.closed ? Math.abs(integrals.volume) : null,
    topology,
    principal: surfacePca(integrals),
    vertices,
    edges,
    meanEdge: edgeCount ? sum / edgeCount : 0,
  };
}

export const surfaceMeasures = (positions: ArrayLike<number>, index: ArrayLike<number>): SurfaceMeasures =>
  runSync(surfaceMeasuresSteps(positions, index));

/** Lowest and highest value of the vertices along each of three directions. */
function* rangesSteps(positions: ArrayLike<number>, axes: readonly Vec3[]): Steps<{ lo: number[]; hi: number[] }> {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    if (i % YIELD_EVERY === 0) yield;
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    for (let k = 0; k < 3; k++) {
      const d = x * axes[k][0] + y * axes[k][1] + z * axes[k][2];
      if (d < lo[k]) lo[k] = d;
      if (d > hi[k]) hi[k] = d;
    }
  }
  return { lo, hi };
}

/** Range of the vertices along each of three directions. */
export function* extentsSteps(positions: ArrayLike<number>, axes: readonly Vec3[]): Steps<[number, number, number]> {
  const { lo, hi } = yield* rangesSteps(positions, axes);
  return [0, 1, 2].map((k) => (hi[k] >= lo[k] ? hi[k] - lo[k] : 0)) as [number, number, number];
}

/** Length, width and thickness along a frame, and the model's box in that frame. */
export interface FrameMeasures {
  auto: AutoMeasurements;
  box: ConfigBox;
}

/**
 * Length, width and thickness are the ranges of the model along three axes:
 * the specimen frame's Y, X and Z when one is set (rows of its matrix), else
 * the first, second and third principal axes of the surface. The same pass
 * gives the box of the volumetric configuration (X, Y, Z: the frame's, or the
 * first principal axis as Y, the third as Z and X = Y × Z). `offset`: the
 * positions are relative to it (the box is in original coordinates).
 */
export function* frameMeasuresSteps(positions: ArrayLike<number>, base: SurfaceMeasures, frame: SpecimenFrame | null, offset: Vec3 = [0, 0, 0]): Steps<FrameMeasures> {
  const m = frame?.matrix;
  const axes: Vec3[] = m
    ? [
        [m[4], m[5], m[6]],
        [m[0], m[1], m[2]],
        [m[8], m[9], m[10]],
      ]
    : base.principal.axes;
  const { lo, hi } = yield* rangesSteps(positions, axes);
  const [length, width, thickness] = [0, 1, 2].map((k) => (hi[k] >= lo[k] ? hi[k] - lo[k] : 0));
  // the measured axes are length (Y), width (X), thickness (Z): box axis k is measured axis
  // `from[k]`, turned round when `sign[k]` is −1 (principal axes: X = Y × Z, the second axis or its opposite)
  const [a1, a2, a3] = axes;
  const x: Vec3 = [a1[1] * a3[2] - a1[2] * a3[1], a1[2] * a3[0] - a1[0] * a3[2], a1[0] * a3[1] - a1[1] * a3[0]];
  const sign = m ? [1, 1, 1] : [x[0] * a2[0] + x[1] * a2[1] + x[2] * a2[2] < 0 ? -1 : 1, 1, 1];
  const from = [1, 0, 2];
  const boxAxes = from.map((i, k) => axes[i].map((c) => c * sign[k]) as Vec3) as [Vec3, Vec3, Vec3];
  const shift = boxAxes.map((a) => a[0] * offset[0] + a[1] * offset[1] + a[2] * offset[2]);
  const min = from.map((i, k) => (sign[k] > 0 ? lo[i] : -hi[i]) + shift[k]) as Vec3;
  const max = from.map((i, k) => (sign[k] > 0 ? hi[i] : -lo[i]) + shift[k]) as Vec3;
  return {
    auto: {
      frame: m ? 'specimen' : 'principal',
      length,
      width,
      thickness,
      surfaceArea: base.surfaceArea,
      volume: base.volume,
      closed: base.topology.closed,
    },
    box: { frame: m ? 'specimen' : 'principal', axes: boxAxes, min, max },
  };
}

export const frameMeasures = (positions: ArrayLike<number>, base: SurfaceMeasures, frame: SpecimenFrame | null, offset: Vec3 = [0, 0, 0]): FrameMeasures =>
  runSync(frameMeasuresSteps(positions, base, frame, offset));

export function* autoMeasurementsSteps(positions: ArrayLike<number>, base: SurfaceMeasures, frame: SpecimenFrame | null): Steps<AutoMeasurements> {
  return (yield* frameMeasuresSteps(positions, base, frame)).auto;
}

export const autoMeasurements = (positions: ArrayLike<number>, base: SurfaceMeasures, frame: SpecimenFrame | null): AutoMeasurements =>
  runSync(autoMeasurementsSteps(positions, base, frame));

import { shapeIndices, type AutoMeasurements } from '../core/derived';
import type { SpecimenFrame, Vec3 } from '../core/types';
import { buildEdgesSteps, meshTopology, surfaceIntegralsSteps, surfacePca, vertexPcaSteps, type EdgeTable, type MeshTopology, type PrincipalAxes } from './meshGeometry';
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
}

export function* surfaceMeasuresSteps(positions: ArrayLike<number>, index: ArrayLike<number>): Steps<SurfaceMeasures> {
  const integrals = yield* surfaceIntegralsSteps(positions, index);
  const vertexCount = Math.floor(positions.length / 3);
  const edges = yield* buildEdgesSteps(index, vertexCount);
  yield;
  const topology = meshTopology(index, vertexCount, edges);
  const vertices = yield* vertexPcaSteps(positions);
  return {
    surfaceArea: integrals.area,
    volume: topology.closed ? Math.abs(integrals.volume) : null,
    topology,
    principal: surfacePca(integrals),
    vertices,
    edges,
  };
}

export const surfaceMeasures = (positions: ArrayLike<number>, index: ArrayLike<number>): SurfaceMeasures =>
  runSync(surfaceMeasuresSteps(positions, index));

/** Range of the vertices along each of three directions. */
export function* extentsSteps(positions: ArrayLike<number>, axes: readonly Vec3[]): Steps<[number, number, number]> {
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
  return [0, 1, 2].map((k) => (hi[k] >= lo[k] ? hi[k] - lo[k] : 0)) as [number, number, number];
}

/**
 * Length, width and thickness are the ranges of the model along three axes:
 * the specimen frame's Y, X and Z when one is set (rows of its matrix), else
 * the first, second and third principal axes of the surface.
 */
export function* autoMeasurementsSteps(positions: ArrayLike<number>, base: SurfaceMeasures, frame: SpecimenFrame | null): Steps<AutoMeasurements> {
  const m = frame?.matrix;
  const axes: Vec3[] = m
    ? [
        [m[4], m[5], m[6]],
        [m[0], m[1], m[2]],
        [m[8], m[9], m[10]],
      ]
    : base.principal.axes;
  const [length, width, thickness] = yield* extentsSteps(positions, axes);
  return {
    frame: m ? 'specimen' : 'principal',
    length,
    width,
    thickness,
    surfaceArea: base.surfaceArea,
    volume: base.volume,
    ...shapeIndices(base.surfaceArea, base.volume),
    closed: base.topology.closed,
  };
}

export const autoMeasurements = (positions: ArrayLike<number>, base: SurfaceMeasures, frame: SpecimenFrame | null): AutoMeasurements =>
  runSync(autoMeasurementsSteps(positions, base, frame));

import type { PrincipalAxes } from '../compute/meshGeometry';
import { computePlane, type PlaneResult } from '../compute/planes';
import type { RegionResult, RegionTotals } from '../compute/regions';
import { relationResults, type RelationResults } from '../compute/relations';
import type { SphereFit } from '../compute/sphere';
import type { VolumeSplit } from '../compute/split';
import { measurementUnit, measurementValue } from './measurements';
import type { MeasureType, ProjectState } from './types';

/** Size and shape of the whole model, measured automatically when it is opened. */
export interface AutoMeasurements {
  /** Axes of length, width and thickness: the specimen frame (Y, X, Z) or the surface's principal axes (1st, 2nd, 3rd). */
  frame: 'specimen' | 'principal';
  length: number;
  width: number;
  thickness: number;
  surfaceArea: number;
  /** Null when the mesh is not closed (no hole filling). */
  volume: number | null;
  /** A / V^(2/3), dimensionless. */
  surfaceToVolumeRatio: number | null;
  /** Wadell sphericity π^(1/3) (6V)^(2/3) / A. */
  wadellSphericity: number | null;
  closed: boolean;
}

export interface ManualMeasurementValue {
  id: string;
  label: string;
  type: MeasureType;
  value: number;
  unit: string;
}

/**
 * Results computed from the annotations and the mesh (later features add
 * fitted planes, fitted spheres, volumes …). They are recomputed whenever their
 * inputs change; the project file stores the latest values next to the inputs
 * so external programs can read them without recomputing. On reading a file
 * the stored values are ignored and recomputed.
 */
export interface DerivedResults {
  /** Null until the mesh has been measured. */
  measurements: AutoMeasurements | null;
  manualMeasurements: ManualMeasurementValue[];
  planes: PlaneResult[];
  /** Surface regions found from their seeds (empty until the mesh is partitioned). */
  regions: RegionResult[];
  /** Areas by region type and the cortex ratio; null until the mesh is partitioned. */
  regionTotals: RegionTotals | null;
  /** Sphere fitted to the chosen cortex regions (null without cortex, or before the mesh is partitioned). */
  nodule: (SphereFit & { regions: string[] }) | null;
  /** Upper and lower volume (null without a split, a closed mesh, or a valid plane / closed curve). */
  split: VolumeSplit | null;
  /** Checks of the relations and sequences (scar ids), and the direct relations. */
  relations: RelationResults;
}

/** What derived results need from the mesh (null before it is measured). */
export interface MeshResults {
  measurements: AutoMeasurements | null;
  /** Principal axes of all vertices, original coordinates. */
  vertices: PrincipalAxes | null;
  regions?: { results: RegionResult[]; totals: RegionTotals } | null;
  nodule?: (SphereFit & { regions: string[] }) | null;
  split?: VolumeSplit | null;
}

/** Volume-based shape indices; null when the volume is unknown. */
export function shapeIndices(area: number, volume: number | null): { surfaceToVolumeRatio: number | null; wadellSphericity: number | null } {
  if (volume === null || !(volume > 0) || !(area > 0)) return { surfaceToVolumeRatio: null, wadellSphericity: null };
  return {
    surfaceToVolumeRatio: area / Math.pow(volume, 2 / 3),
    wadellSphericity: (Math.cbrt(Math.PI) * Math.pow(6 * volume, 2 / 3)) / area,
  };
}

export function computeDerived(state: Readonly<ProjectState>, mesh: MeshResults | null = null): DerivedResults {
  const auto = mesh?.measurements ?? null;
  return {
    measurements: auto ? { ...auto } : null,
    manualMeasurements: state.measurements.map((m) => ({
      id: m.id,
      label: m.label,
      type: m.type,
      value: measurementValue(m),
      unit: measurementUnit(m, state.specimen.unit),
    })),
    planes: state.planes.map((p) => computePlane(p, state, mesh?.vertices ?? null)),
    regions: mesh?.regions?.results ?? [],
    regionTotals: mesh?.regions?.totals ?? null,
    nodule: mesh?.nodule ?? null,
    split: mesh?.split ?? null,
    relations: relationResults(state),
  };
}

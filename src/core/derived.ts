import { coreConfiguration, type CoreConfiguration } from '../compute/bicone';
import type { ConfigBox } from '../compute/configuration';
import type { PrincipalAxes } from '../compute/meshGeometry';
import { computePlane, type PlaneResult } from '../compute/planes';
import type { RegionResult, RegionTotals } from '../compute/regions';
import { landmarkTable, type LandmarkTable } from '../compute/landmarks';
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
  /** Principal axes of all vertices (original coordinates; the `all_vertices` plane and the plane frames use them), null until measured. */
  vertices: PrincipalAxes | null;
  manualMeasurements: ManualMeasurementValue[];
  planes: PlaneResult[];
  /** Surface regions found from their seeds (empty until the mesh is partitioned). */
  regions: RegionResult[];
  /** Areas by region type and the cortex ratio; null until the mesh is partitioned. */
  regionTotals: RegionTotals | null;
  /** Sphere fitted to the chosen cortex regions (null without cortex, or before the mesh is partitioned). */
  nodule: (SphereFit & { regions: string[] }) | null;
  /** Upper and lower volume, exchanged when the split is swapped (null without a split, a closed mesh, or a valid plane / closed curve). */
  split: VolumeSplit | null;
  /** Checks of the relations and sequences (scar ids), and the direct relations. */
  relations: RelationResults;
  /** Every landmark in export order (fixed, then each set's semilandmarks), the sliders, and the sets' points. */
  landmarks: LandmarkTable;
  /** Volumetric configuration of the core by the box or the bicone model (null without arrows, before the mesh is measured, or for the bicone without a split by a closed curve). */
  configuration: CoreConfiguration | null;
}

/** What derived results need from the mesh (null before it is measured). */
export interface MeshResults {
  measurements: AutoMeasurements | null;
  /** Principal axes of all vertices, original coordinates. */
  vertices: PrincipalAxes | null;
  regions?: { results: RegionResult[]; totals: RegionTotals } | null;
  nodule?: (SphereFit & { regions: string[] }) | null;
  split?: VolumeSplit | null;
  /** The model's box along the specimen frame or the principal axes (volumetric configuration). */
  box?: ConfigBox | null;
}

export function computeDerived(state: Readonly<ProjectState>, mesh: MeshResults | null = null): DerivedResults {
  const auto = mesh?.measurements ?? null;
  return {
    measurements: auto ? { ...auto } : null,
    vertices: mesh?.vertices ? structuredClone(mesh.vertices) : null,
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
    landmarks: landmarkTable(state),
    configuration: coreConfiguration(state, mesh?.box ?? null, mesh?.split ?? null),
  };
}

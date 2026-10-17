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
}

/** Volume-based shape indices; null when the volume is unknown. */
export function shapeIndices(area: number, volume: number | null): { surfaceToVolumeRatio: number | null; wadellSphericity: number | null } {
  if (volume === null || !(volume > 0) || !(area > 0)) return { surfaceToVolumeRatio: null, wadellSphericity: null };
  return {
    surfaceToVolumeRatio: area / Math.pow(volume, 2 / 3),
    wadellSphericity: (Math.cbrt(Math.PI) * Math.pow(6 * volume, 2 / 3)) / area,
  };
}

export function computeDerived(state: Readonly<ProjectState>, auto: AutoMeasurements | null = null): DerivedResults {
  return {
    measurements: auto ? { ...auto } : null,
    manualMeasurements: state.measurements.map((m) => ({
      id: m.id,
      label: m.label,
      type: m.type,
      value: measurementValue(m),
      unit: measurementUnit(m, state.specimen.unit),
    })),
  };
}

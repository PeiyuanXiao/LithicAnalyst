import type { ProjectState } from './types';

/**
 * Results computed from the annotations (fitted planes, measurements, fitted
 * spheres, volumes …, added by later features). They are recomputed whenever
 * their inputs change; the project file stores the latest values next to the
 * inputs so external programs can read them without recomputing. On reading a
 * file the stored values are ignored and recomputed.
 */
export type DerivedResults = Record<string, unknown>;

export function computeDerived(_state: Readonly<ProjectState>): DerivedResults {
  return {};
}

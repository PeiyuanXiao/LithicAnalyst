import type { IpaBand } from '../compute/ipa';
import { biconeVolumes, coreConfiguration, type CoreConfiguration } from '../compute/bicone';
import type { ConfigBox } from '../compute/configuration';
import type { PrincipalAxes } from '../compute/meshGeometry';
import { EDGE_ANGLE_PARAMETERS, type EdgeAngleResult } from '../compute/edgeAngle';
import type { GmResult } from '../compute/gm';
import { gmConfigSummary, gmInUse } from '../compute/gmTemplate';
import type { RetouchAngleResult } from '../compute/retouchAngle';
import type { RetouchIndices } from '../compute/retouchIndex';
import { SHARP_EDGE_PARAMETERS, sharpOfCurve, type SharpSegment } from '../compute/sharpEdge';
import { FLAKE_PARAMETERS, type FlakeGeometry, type FlakeMeasures, type FlakeResult } from '../compute/flake';
import { WORKING_EDGE_PARAMETERS, type WorkingEdgeRow, type WorkingEdgesDerived } from '../compute/workingEdge';
import { MEASURED_LINE_PARAMETERS, measuredLine } from '../compute/measuredLine';
import { computePlane, type PlaneResult } from '../compute/planes';
import type { RegionResult, RegionTotals } from '../compute/regions';
import { landmarkTable, type LandmarkTable } from '../compute/landmarks';
import { relationResults, type RelationResults } from '../compute/relations';
import type { SphereFit } from '../compute/sphere';
import { SYMMETRY_PARAMETERS, type SymmetryDerived, type SymmetryValues } from '../compute/symmetry';
import { measurementUnit, measurementValue } from './measurements';
import type { MeasureType, ProjectState, SharpEdgeRule, Vec3 } from './types';

/**
 * Size and shape of the whole model, measured automatically when it is opened. Length, width and thickness whatever the
 * orientation (as a flake's morphological ones): the largest distance between two vertices, the largest width across it, the
 * range across both; the specimen frame does not change them.
 */
export interface AutoMeasurements {
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

/** What a flake's row of flakes.csv and its stored results hold. */
export interface FlakeDerived {
  /** The parameters they were measured with. */
  parameters: typeof FLAKE_PARAMETERS;
  /** Where the specimen frame came from (`technical_axis`, …), or `principal`. */
  frameSource: string;
  measures: FlakeMeasures;
  geometry: FlakeGeometry;
  /** IPA's band as fitted: technical Y from and to (coordinate units), the area fitted, whether it started at the fallback, the triangles trimmed; null: none was fitted. */
  ipaBand: IpaBand | null;
  /** The BSA's reference plane as fitted: its reach round P and the surface's robust deviation from it (coordinate units); null: none. */
  bsaReference: { radius: number; noise: number } | null;
}

/** One curve's edge angles. */
export type RetouchAngleCurve = RetouchAngleResult & { curveId: string };
export type GmDerived = GmResult & { config: ReturnType<typeof gmConfigSummary> };
export type EdgeAngleCurve = EdgeAngleResult & { curveId: string };

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
  /** Each symmetry reference's planes, sides and mirror deviation, and the parameters (null: no references, or not yet computed). */
  symmetry: SymmetryDerived | null;
  /** Checks of the relations and sequences (scar ids), and the direct relations. */
  relations: RelationResults;
  /** Every landmark in export order (fixed, then each set's semilandmarks), the sliders, and the sets' points. */
  landmarks: LandmarkTable;
  /** Volumetric configuration of the core by the box or the bicone model (null without arrows, before the mesh is measured, or for the bicone without the volumes of a symmetry reference on a closed curve). */
  configuration: CoreConfiguration | null;
  /** A flake's measurements (null for a core, or before they are computed). */
  flake: FlakeDerived | null;
  /** The edge angles of the curves measured, with their parameters (null: none). */
  edgeAngles: { parameters: typeof EDGE_ANGLE_PARAMETERS; curves: EdgeAngleCurve[] } | null;
  /** Edges that run along the platform outline: measured from `start` to `end`, not all round their curve. Absent when there are none. */
  measuredLines?: { parameters: typeof MEASURED_LINE_PARAMETERS; curves: Array<{ curveId: string; start: Vec3; end: Vec3 }> };
  /** The retouch layers along the curves measured (null: none). */
  retouchAngles: { curves: RetouchAngleCurve[] } | null;
  /** A flake's retouch indices (absent for a core, or before they are computed). */
  retouchIndices?: RetouchIndices;
  /** The sharp stretches of the curves measured, under the rule (null without a threshold, or without edge angles). */
  sharpEdge: { rule: SharpEdgeRule; parameters: typeof SHARP_EDGE_PARAMETERS; curves: Array<{ curveId: string; length: number; segments: SharpSegment[] }> } | null;
  /** A flake's points for geometric morphometrics, and the configuration they were made by (null for a core, or before they are computed). */
  gm: GmDerived | null;
  /** The working edges of the curves measured, and the whole of each curve without any (absent: nothing measured). */
  workingEdges?: WorkingEdgesDerived;
}

/** What derived results need from the mesh (null before it is measured). */
export interface MeshResults {
  measurements: AutoMeasurements | null;
  /** Principal axes of all vertices, original coordinates. */
  vertices: PrincipalAxes | null;
  regions?: { results: RegionResult[]; totals: RegionTotals } | null;
  nodule?: (SphereFit & { regions: string[] }) | null;
  /** The symmetry references' results, in the order of the references. */
  symmetry?: readonly SymmetryValues[] | null;
  /** The model's box along the specimen frame or the principal axes (volumetric configuration). */
  box?: ConfigBox | null;
  /** A flake's measurements. */
  flake?: FlakeResult | null;
  /** Each region plane's fit to its regions, by plane id. */
  regionFits?: ReadonlyMap<string, { centroid: Vec3; normal: Vec3; count: number }> | null;
  /** The curves' edge angles. */
  edgeAngles?: readonly EdgeAngleCurve[] | null;
  /** The retouch layers along them. */
  retouchAngles?: readonly RetouchAngleCurve[] | null;
  /** A flake's retouch indices. */
  retouchIndices?: RetouchIndices | null;
  /** A flake's points for geometric morphometrics. */
  gm?: GmResult | null;
  /** The working edges' rows. */
  workingEdges?: readonly WorkingEdgeRow[] | null;
}

/** Where the specimen frame came from, for flakes.csv. */
export const frameSource = (state: Pick<ProjectState, 'specimen'>): string => state.specimen.frame?.source ?? 'principal';

/** The sharp stretches of these curves under the project's rule; null without a threshold, or without edge angles. */
function sharpDerived(state: Readonly<ProjectState>, curves: readonly EdgeAngleCurve[]): DerivedResults['sharpEdge'] {
  const rule = state.sharpEdge;
  if (rule.threshold === null || !curves.length) return null;
  return {
    rule: { ...rule },
    parameters: SHARP_EDGE_PARAMETERS,
    curves: curves.flatMap((r) => {
      const c = state.curves.find((x) => x.id === r.curveId);
      const s = c ? sharpOfCurve(r, measuredLine(c, state).closed, rule, state.specimen.unit) : null;
      return s ? [{ curveId: r.curveId, length: s.length, segments: s.segments }] : [];
    }),
  };
}

/** The edges not measured along all of their curve, and where that part of them ends (nothing when there are none). */
function measuredLines(state: Readonly<ProjectState>): Pick<DerivedResults, 'measuredLines'> {
  const curves = state.curves.flatMap((c) => {
    const line = measuredLine(c, state);
    return line.points === c.points ? [] : [{ curveId: c.id, start: line.points[0], end: line.points[line.points.length - 1] }];
  });
  return curves.length ? { measuredLines: { parameters: MEASURED_LINE_PARAMETERS, curves } } : {};
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
    planes: state.planes.map((p) => computePlane(p, state, mesh?.vertices ?? null, mesh?.regionFits?.get(p.id) ?? null)),
    regions: mesh?.regions?.results ?? [],
    regionTotals: mesh?.regions?.totals ?? null,
    nodule: mesh?.nodule ?? null,
    symmetry: mesh?.symmetry?.length ? { parameters: SYMMETRY_PARAMETERS, refs: structuredClone([...mesh.symmetry]) } : null,
    relations: relationResults(state),
    landmarks: landmarkTable(state),
    configuration: state.specimen.type === 'core' ? coreConfiguration(state, mesh?.box ?? null, biconeVolumes(state, mesh?.symmetry)) : null,
    flake: state.specimen.type === 'flake' && mesh?.flake ? { parameters: FLAKE_PARAMETERS, frameSource: frameSource(state), measures: mesh.flake.measures, geometry: mesh.flake.geometry, ipaBand: mesh.flake.ipaBand, bsaReference: mesh.flake.bsaReference } : null,
    edgeAngles: mesh?.edgeAngles?.length ? { parameters: EDGE_ANGLE_PARAMETERS, curves: [...mesh.edgeAngles] } : null,
    retouchAngles: mesh?.retouchAngles?.length ? { curves: [...mesh.retouchAngles] } : null,
    ...(state.specimen.type === 'flake' && mesh?.retouchIndices ? { retouchIndices: mesh.retouchIndices } : {}),
    sharpEdge: sharpDerived(state, mesh?.edgeAngles ?? []),
    gm: mesh?.gm && (state.specimen.type === 'flake' || gmInUse(state.gm, state.specimen.type)) ? { config: structuredClone(gmConfigSummary(state.gm)), ...mesh.gm } : null,
    ...(mesh?.workingEdges?.length ? { workingEdges: { parameters: WORKING_EDGE_PARAMETERS, edges: [...mesh.workingEdges] } } : {}),
    ...measuredLines(state),
  };
}

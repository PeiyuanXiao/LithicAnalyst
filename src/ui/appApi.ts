import type { SnapMode } from '../compute/surfacePath';
import type { PlaneResult } from '../compute/planes';
import type { FigureLayout, FigureSettings } from '../render/figure';
import type { RegionResult, RegionTotals } from '../compute/regions';
import type { AutoMeasurements } from '../core/derived';
import type { ProjectStore } from '../core/store';
import type { Measurement, Vec3 } from '../core/types';
import type { ArrowDisplay } from '../render/arrowLayer';
import type { LightSettings } from '../render/lighting';
import type { ShadingMode } from '../render/meshView';
import type { Selection } from '../tools/selection';
import type { Feedback } from './feedback';

export type ViewportBackground = 'light' | 'dark';

/** Work modes; each shows only its own tools and sidebar sections ("compare" joins in 5.1). */
export const APP_MODES = ['annotate', 'measure', 'present'] as const;
export type AppMode = (typeof APP_MODES)[number];

export interface DisplaySettings {
  shading: ShadingMode;
  light: LightSettings;
  /** 0 = matte, 1 = glossy. */
  gloss: number;
  /** Smoothing passes for the curvature map (0–100). */
  curvScale: number;
  curvContrast: number;
  background: ViewportBackground;
  /** Arrow display; `labels` and `showHidden` apply to curves too. */
  arrows: ArrowDisplay;
  /** What traced curves are drawn toward. */
  curveSnap: SnapMode;
  /** Colour the surface regions. */
  regions: boolean;
  excelBom: boolean;
}

export type DisplayAspect = 'light' | 'shading' | 'curvature' | 'background' | 'arrows' | 'snap' | 'regions' | 'other';

/** What the sidebar panels may ask of the application. */
export interface AppApi {
  readonly store: ProjectStore;
  readonly selection: Selection;
  readonly display: DisplaySettings;
  readonly feedback: Feedback;
  readonly mode: AppMode;
  setDisplay(change: (d: DisplaySettings) => void, aspect: DisplayAspect): void;
  hasMesh(): boolean;
  hasScanColors(): boolean;
  curvatureBusy(): boolean;
  focusArrow(id: string): void;
  focusCurve(id: string): void;
  exportCsv(): void;
  exportCurvesCsv(): void;
  exportMeasurementsCsv(): void;
  exportManualMeasurementsCsv(): void;
  /** Null while the mesh is being measured (or without a mesh). */
  autoMeasurements(): AutoMeasurements | null;
  measuringBusy(): boolean;
  formatMeasurement(m: Measurement): string;
  planeResults(): PlaneResult[];
  addPlane(): void;
  viewAlongPlane(id: string): void;
  exportPlanesCsv(): void;
  /** Specimen frame: front view from the current view or a plane's normal; vertical from an arrow; turn on the page. */
  setFrameFromView(): void;
  setFrameFromPlane(id: string): void;
  setFrameVertical(scarId: string): void;
  /** `base`: the matrix to turn from (fine turning keeps turning the same start). */
  turnFrame(deg: number, base?: number[]): void;
  clearFrame(): void;
  viewFrame(): void;
  readonly figure: FigureSettings;
  setFigure(change: (f: FigureSettings) => void): void;
  /** Size of the figure with the current settings (null without a mesh). */
  figureLayout(): FigureLayout | null;
  exportFigure(format: 'png' | 'svg'): void;
  exportSection(id: string, format: 'png' | 'svg'): void;
  /** Surface regions as found on the mesh (null before it is partitioned). */
  regionInfo(): { results: RegionResult[]; totals: RegionTotals } | null;
  exportRegionsCsv(): void;
  setRegionType(id: string, type: string): void;
  volumeSplit(): import('../compute/split').VolumeSplit | null;
  /** Null before the mesh is measured. */
  meshClosed(): boolean | null;
  /** Direction toward the viewer (for orienting a curve's normal). */
  towardViewer(): Vec3;
  noduleFit(): (import('../compute/sphere').SphereFit & { regions: string[] }) | null;
  saveProject(): void;
  openProject(): void;
}

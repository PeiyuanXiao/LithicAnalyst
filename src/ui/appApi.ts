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

/** Work modes; each shows only its own tools and sidebar sections. */
export const APP_MODES = ['annotate', 'measure', 'present', 'compare'] as const;
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
  /** Show the Harris matrix panel (annotate mode). */
  harris: boolean;
  excelBom: boolean;
}

export type DisplayAspect = 'light' | 'shading' | 'curvature' | 'background' | 'arrows' | 'snap' | 'regions' | 'harris' | 'other';

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
  /** Null while the mesh is being measured (or without a mesh). */
  autoMeasurements(): AutoMeasurements | null;
  measuringBusy(): boolean;
  formatMeasurement(m: Measurement): string;
  planeResults(): PlaneResult[];
  addPlane(): void;
  viewAlongPlane(id: string): void;
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
  setRegionType(id: string, type: string): void;
  volumeSplit(): import('../compute/split').VolumeSplit | null;
  /** Null before the mesh is measured. */
  meshClosed(): boolean | null;
  /** Direction toward the viewer (for orienting a curve's normal). */
  towardViewer(): Vec3;
  noduleFit(): (import('../compute/sphere').SphereFit & { regions: string[] }) | null;
  /** Checks of the relations and sequences. */
  relationChecks(): import('../compute/relations').RelationChecks;
  /** Problem list opened (its scars are highlighted); `focus`: highlight only this problem's scars. */
  readonly problemsOpen: boolean;
  setProblems(open: boolean, focus?: number | null): void;
  problemFocus(): number | null;
  /** Landmarks in export order, sliders and semilandmark points (follows the curves). */
  landmarkTable(): import('../compute/landmarks').LandmarkTable;
  /** Landmark names carried over from the last specimen: the next one to use (null when used up), or null when not in use. */
  nameQueue(): { next: string | null } | null;
  /** The landmark names of the last specimen (empty when there are none). */
  previousNames(): string[];
  reuseNames(): void;
  skipName(): void;
  stopNames(): void;
  /** Compare mode: the open project first, then the project files read for comparison. */
  observerList(): Array<{ id: string; label: string; fileName: string; included: boolean; color: string; current: boolean }>;
  addObserverFiles(): void;
  setObserverIncluded(id: string, included: boolean): void;
  removeObserver(id: string): void;
  /** Largest distance for matching arrows and curves, in the specimen unit. */
  compareGate(): number;
  setCompareGate(v: number): void;
  agreementResult(): { rows: import('../compute/agreement').AgreementRow[]; summary: import('../compute/agreement').SummaryRow[] } | null;
  agreementBusy(): boolean;
  /** Show in 3D the pair of items that differ most in a metric (a row of the table); again to clear. */
  focusAgreement(itemType: string, metric: string, a: string, b: string): void;
  /** The row whose pair is shown (`type|metric|a|b`), or null. */
  agreementFocus(): string | null;
  /** The open folder: its models and which one is open (−1: none of them). */
  workspaceInfo(): { name: string; writable: boolean; meshes: string[]; index: number } | null;
  openWorkspaceMesh(i: number): Promise<void>;
  stepWorkspace(step: number): void;
  batchInfo(): { kind: 'measure' | 'figures'; done: number; total: number } | null;
  runBatch(kind: 'measure' | 'figures'): void;
  cancelBatch(): void;
  batchFormat: 'png' | 'svg';
  saveProject(): void;
  openProject(): void;
  openModel(): void;
  openFolder(): Promise<void>;
  /** The export dialog of the current mode's data files. */
  openExport(): void;
  /** The relation tool has its first scar and waits for the second. */
  relationPending(): boolean;
}

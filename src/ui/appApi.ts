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
import type { Popovers } from './popover';

/** Work modes; each shows only its own tools and sidebar sections. */
export const APP_MODES = ['annotate', 'measure', 'present', 'compare'] as const;
export type AppMode = (typeof APP_MODES)[number];

export interface DisplaySettings {
  shading: ShadingMode;
  /** Light direction and height (the fill light keeps its default). */
  light: LightSettings;
  /** Smoothing passes for the curvature map (0–100). */
  curvScale: number;
  curvContrast: number;
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

export type DisplayAspect = 'light' | 'shading' | 'curvature' | 'arrows' | 'snap' | 'regions' | 'harris' | 'other';

/** What the sidebar panels may ask of the application. */
export interface AppApi {
  readonly store: ProjectStore;
  readonly selection: Selection;
  readonly display: DisplaySettings;
  readonly feedback: Feedback;
  /** Menus and small panels: one open at a time. */
  readonly popovers: Popovers;
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
  /** Put the camera on the specimen frame (in a short transition). */
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
  /**
   * The open folder: its models (paths), which one is open (−1: none of them), which have a
   * project, and (read-only folder) how many edited models were not downloaded.
   */
  workspaceInfo(): { name: string; writable: boolean; meshes: string[]; index: number; started: boolean[]; undownloaded: number } | null;
  openWorkspaceMesh(i: number): Promise<void>;
  stepWorkspace(step: number): void;
  /** Open the next model without a project. */
  nextUnstarted(): void;
  /** Read-only folder: this session's projects as one ZIP. */
  downloadProjects(): Promise<void>;
  /** A batch run: progress, failures so far, paused (figures while the page is in the background), seconds left (null: not known yet). */
  batchInfo(): { kind: 'measure' | 'figures'; done: number; total: number; failed: number; paused: boolean; eta: number | null } | null;
  cancelBatch(): void;
  /** Figures: PNG and SVG render every model of the folder. */
  figureFolder: boolean;
  /** Compare mode: add the folder's other project files of this model. */
  addFolderObservers(): Promise<void>;
  saveProject(): void;
  openProject(): void;
  openFolder(): Promise<void>;
  /** The export dialog of the current mode's data files. */
  openExport(): void;
  /** The relation tool has its first scar and waits for the second. */
  relationPending(): boolean;
  /** The tool in use (null before the view is ready). */
  toolId(): string | null;
  /** Pairs of scars whose regions border on each other and have no relation recorded. */
  unjudgedPairs(): number;
  /** Turn the view to the next such border. */
  nextUnjudgedPair(): void;
}

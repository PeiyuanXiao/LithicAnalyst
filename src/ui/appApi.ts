import type { FlakeEmptyReason, FlakeMeasure } from '../compute/flake';
import type { GmResult } from '../compute/gm';
import type { RetouchAngleResult } from '../compute/retouchAngle';
import type { SharpResult } from '../compute/sharpEdge';
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
export const APP_MODES = ['annotate', 'measure', 'retouch', 'present', 'compare'] as const;
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
  /** Show the volumetric configuration panel and the view cube (annotate mode). */
  configuration: boolean;
  /** Show a flake's profile panel. */
  profile: boolean;
  /** Show a flake's semilandmarks for geometric morphometrics. */
  gmPoints: boolean;
  /** Show the surface semilandmarks of the open specimen. */
  gmSurface: boolean;
  /** The retouch mode's section and plan panels, the segments' lines and the original edge on the model. */
  retouchSection: boolean;
  retouchPlan: boolean;
  retouchLines: boolean;
  retouchEdge: boolean;
  excelBom: boolean;
}

export type DisplayAspect = 'retouch' | 'gm' | 'light' | 'shading' | 'curvature' | 'arrows' | 'snap' | 'regions' | 'harris' | 'configuration' | 'profile' | 'other';

/** What can be picked in the configuration: a face of the box or a cone of the bicone. */
export type ConfigPick = import('../core/fields').ConfigFace | import('../core/fields').BiconeCone;

/** Why the bicone shows nothing: its split is being computed, the mesh is not closed, or the split gives no volumes. */
export type ConfigStatus = 'computing' | 'not_closed' | 'split_invalid';

/** What the chart of edge angles shows. */
export type EdgeChartMethod = import('../compute/edgeAngle').EdgeAngleMethod | 'layer_face';

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
  /** The open model's type, or with none the module chosen (what the next model will be). */
  moduleType(): import('../core/fields').SpecimenType;
  /** The last change was the user's own (not a model or project opened, undo or redo): what it changed may flash. */
  userChanged(): boolean;
  hasScanColors(): boolean;
  curvatureBusy(): boolean;
  focusArrow(id: string): void;
  focusCurve(id: string): void;
  /** Null while the mesh is being measured (or without a mesh). */
  autoMeasurements(): AutoMeasurements | null;
  /** The row of a measure (`group:item`) the pointer is on, after a moment drawn on the model (null: none). */
  hoverHint(key: string | null): void;
  /** The row of a measure with the keyboard's focus: drawn at once. */
  focusHint(key: string | null): void;
  /** A click on such a row: fixed; again to let go. */
  pinHint(key: string): void;
  /** The rows were made anew: mark those shown and fixed. */
  paintHintRows(): void;
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
   * project and of which type (null: no project, or not read yet), and (read-only folder) how many edited models were not downloaded.
   */
  workspaceInfo(): { name: string; writable: boolean; meshes: string[]; index: number; started: boolean[]; types: Array<import('../core/fields').SpecimenType | null>; completion: Array<{ done: number; total: number } | null>; gm: Array<{ done: boolean; flagged: number } | null>; template: string | null; undownloaded: number } | null;
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
  /** Volumetric configuration by the box or the bicone (null without arrows, before the mesh is measured, or for the bicone without its split). */
  configuration(): import('../compute/bicone').CoreConfiguration | null;
  /** Why the bicone shows nothing (null: it shows, or the box is used). */
  configStatus(): ConfigStatus | null;
  /** The configuration panel's content changed: keep it inside the view. */
  fitConfigPanel(): void;
  /** Which way up a new split along this curve points: the side with more scars, when even toward the viewer. */
  splitUpHint(curveId: string): Vec3;
  /** Stand the bicone on this closed curve: the split along it and the model, in one step. */
  useEdgeCurve(curveId: string): void;
  /** The face (box) or cone (bicone) picked in the configuration panel or the view cube (null: none). */
  configFace(): ConfigPick | null;
  /** Pick a face or cone (null: none); `turn`: also turn the view to it. */
  selectConfigFace(face: ConfigPick | null, turn?: boolean): void;
  /** Carry an open curve round the model's edge until it closes. */
  completeLoop(id: string): void;
  /** A curve is being completed. */
  completingLoop(): boolean;
  /** The sketch of the configuration (its canvas goes into the panel). */
  configSketch(): import('../render/configSketch').ConfigSketch;
  /** A flake's measurements (null for a core, or before they are computed). */
  flakeMeasures(): import('../compute/flake').FlakeMeasures | null;
  /** The user's own values of a curve's or a region's field used so far: in this specimen and in the folder's project files already read. */
  customValues(field: import('../core/fields').FieldDef): string[];
  /** A flake's edge does not part its ventral and dorsal faces. */
  facesOpen(): boolean;
  /** A curve's edge angles (null: not measured, or not yet). */
  edgeAngleResult(curveId: string): import('../compute/edgeAngle').EdgeAngleResult | null;
  /** The method the chart and the colours show. */
  readonly edgeMethod: import('../compute/edgeAngle').EdgeAngleMethod;
  flakeEmptyReasons(): Partial<Record<FlakeMeasure, FlakeEmptyReason>> | null;
  gmResult(): GmResult | null;
  /** How the template stands (null: there is none). */
  gmTemplateInfo(): { file: string; seed: number; isThis: boolean; changed: boolean; missing: boolean } | null;
  /** What the folder holds to choose from in the lists of the configuration. */
  gmCandidates(): { landmarks: string[]; curves: string[]; regions: string[] };
  /** The open specimen as the template, its points laid (again, by another seed, when it is). */
  layGmTemplate(): Promise<void>;
  /** A template is being laid. */
  gmLayingNow(): boolean;
  retouchAngleResult(curveId: string): RetouchAngleResult | null;
  sharpOf(curveId: string): SharpResult | null;
  suggestSharpEdge(): Promise<void>;
  edgeSeries: string;
  setEdgeSeries(series: string): void;
  edgeColorMode: 'angle' | 'sharp';
  setEdgeColorMode(mode: 'angle' | 'sharp'): void;
  setEdgeMethod(method: import('../compute/edgeAngle').EdgeAngleMethod): void;
  /** A flake's retouch indices (null for a core, or before they are computed). */
  retouchResult(): import('../compute/retouchIndex').RetouchIndexResult | null;
  /** The current station of the retouch mode (null: no curve has stations). */
  retouchStationNow(): { curveId: string; station: number; position: number } | null;
  moveRetouchStation(curveId: string, k: number): void;
  /** To the station nearest a position along the curve. */
  moveRetouchPosition(curveId: string, position: number): void;
  /** Another curve: its station with the largest missing area. */
  useRetouchCurve(curveId: string): void;
  /** A row of the table of retouch regions: the middle of its stretch, and the region selected. */
  focusRetouchSegment(i: number): void;
  /** The fitted length while its slider is dragged (mm), nothing written yet; null: as stored. */
  previewFitLength(mm: number | null): void;
  /** The volume removed at a range of fitted lengths (null: not known yet). */
  retouchFitCurve(): Array<{ length: number; removed: number | null }> | null;
  /** A segment of the sixteen: shown on the plan, on its face; again to let go. */
  focusPlanSegment(segment: number): void;
  planMark(): number | null;
  /** The chart of the retouch layers: what it shows, on its own, apart from the measure mode's. */
  readonly retouchMethod: EdgeChartMethod;
  readonly retouchSeries: string;
  setRetouchMethod(method: EdgeChartMethod): void;
  setRetouchSeries(series: string): void;
  /** The working edges of the curves measured and the whole of each curve without any, with what is measured on them. */
  workingEdgeDetails(): import('../compute/workingEdge').WorkingEdgeDetail[];
  /** A curve's working edges along it, in order. */
  workingEdgesOn(curveId: string): Array<{ id: string; label: string; from: number; to: number; color: string }>;
  /** The label of the working edge a position along a curve lies in (empty: none). */
  workingEdgeAt(curveId: string, position: number): string;
  /** A retouched stretch of each curve measured that has no working edge: one each. */
  generateWorkingEdges(): void;
  /** The other stretch round a closed curve; says so when it cannot. */
  otherEdgeStretch(id: string): void;
  /** A row of the table of working edges: to its largest missing area, and drawn on the plan; again to let go. */
  focusWorkingEdge(id: string): void;
  /** The row picked (its id; null: none). */
  planEdge(): string | null;
}

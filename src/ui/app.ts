import * as THREE from 'three';
import { CurvatureService } from '../compute/curvatureService';
import { coreConfiguration, defaultUpHint, isBicone, type CoreConfiguration } from '../compute/bicone';
import { completeLoopSteps, COMPLETE_ANCHOR_STEP_DEG, COMPLETE_STEP_DEG, type CompleteFailure } from '../compute/completeLoop';
import type { ConfigBox } from '../compute/configuration';
import { autoMeasurements, frameMeasures, surfaceMeasuresSteps, type SurfaceMeasures } from '../compute/measure';
import { intersectPlaneSteps, type PrincipalAxes, type Polyline } from '../compute/meshGeometry';
import { MEASURED_LINE_PARAMETERS, measuredLine, type MeasuredLine } from '../compute/measuredLine';
import { bandPiecesSteps, mergePieces, retouchSideSteps, type RetouchSide } from '../compute/retouchBand';
import { computePlane, regionPlaneSteps, type PlaneResult } from '../compute/planes';
import { runSliced, runSync } from '../compute/steps';
import { SNAP_MODES, type SnapMode } from '../compute/surfacePath';
import { addWorkingEdge, deleteWorkingEdge, generateWorkingEdges, otherWorkingEdgeStretch, updateWorkingEdge, addLandmark, completeCurveLoop, withPlatformEnds, withRetouchCurvesKept, deleteTechnicalAxis, setGmConfig, setRegionRetouchLayer, setRetouchAxis, setRetouchFitLength, setRetouchFlip, setSharpEdge, placePlatformEnd, setSpecimenType, setTechnicalAxis, TECHNICAL_FRAME, setBiconeSplit, setConfigModel, setSplit, deleteLandmark, deleteSemilandmarkSet, addPlane, addRegion, addSequence, deleteCurve, deleteMeasurement, deletePlane, deleteRegion, deleteRelation, deleteScar, deleteSection, deleteSequence, relationBetween, setCurveAttribute, setRegionType, setRelation, setScarAttribute, setScarSequence, updateSpecimen } from '../core/actions';
import type { AutoMeasurements, GmDerived, MeshResults } from '../core/derived';
import { frameAxes, frameFromView, frameWithVertical, rotateFrame } from '../core/frame';
import { measurementUnit, measurementValue } from '../core/measurements';
import { annotationStatus, type StatusKey } from '../core/annotationStatus';
import { CURVE_FIELDS, GENERIC_REGION_TYPE, hasVolumeSplit, isBoundaryCurve, isCustomValue, isUpperRegion, keyedOptions, layerCurves, measuresEdgeAngle, numberKeyField, PLATFORM_OUTLINE, REGION_FIELDS, RETOUCH_LAYERS, SCAR_FIELDS, shiftNumberKeyField, SPECIMEN_TYPES, type ConfigFace, type FieldDef, type SpecimenType } from '../core/fields';
import { parseGmConfig, parseProjectFile, parseSharpEdge, serializeProject } from '../core/schema';
import { emptyProject, ProjectStore, type Change } from '../core/store';
import { hasVector, retouchSettingsOf, type RetouchAxisChoice, type Curve, type Measurement, type ProjectState, type RegionType, type Section, type GmConfig, type SharpEdgeRule, type TechnicalAxis, type Vec3 } from '../core/types';
import { autosaveAvailable, readAutosave, readPref, writeAutosave, writePref } from '../io/autosave';
import { configurationCsv, curveCsv, edgeAnglesCsv, edgeSharpCsv, invasivenessCsv, retouchAnglesCsv, retouchSectionsCsv, retouchSegmentsCsv, flakesCsv, flakingSurfacesCsv, manualMeasurementsCsv, measurementsCsv, planesCsv, regionsCsv, relationsCsv, scarVectorCsv, seriesCsv, workingEdgesCsv } from '../io/csv';
import { buildLoadedMesh, extensionOf, MeshLoadError, readMeshFile, type LoadedMesh } from '../io/loadMesh';
import { APP_DIR, GM_CONFIG_FILE, SHARP_EDGE_FILE, folderPicker, freshFolder, legacyProjectPathFor, projectPathFor, specimenIds, timeStamp, workspaceFromFiles, workspaceFromHandle, type DirectoryHandle, type Workspace } from '../io/workspace';
import { batchOutputs, gmOutputs, batchSpecimen, failuresCsv, manifestJson, savedMeasures, savedResultsUsable, type BatchFailure, type BatchProject, type BatchSpecimen, type Manifest, type ModelMeasures } from '../io/batch';
import { ProjectIndex, type IndexedProject } from '../io/projectIndex';
import { createMeasurer, type MeshMeasurer } from '../io/meshMeasurer';
import BatchWorker from '../io/batchWorker?worker&inline';
import { zipStored } from '../io/zip';
import { fileStem, initHostDownloads, saveFile, saveTextFile } from '../io/saveFile';
import { ArrowLayer, arrowColor, arrowColorModeOf, ARROW_COLORS, DEFAULT_ARROW_DISPLAY, type ArrowColorMode } from '../render/arrowLayer';
import { CurveLayer } from '../render/curveLayer';
import { MeasureLayer } from '../render/measureLayer';
import { PlaneLayer, planeColor } from '../render/planeLayer';
import { SectionLayer, sectionLoops2D } from '../render/sectionLayer';
import { SectionTool } from '../tools/sectionTool';
import { ClickTool } from '../tools/clickTool';
import { REGION_COLORS, RegionLayer, regionColorOf } from '../render/regionLayer';
import { checkRelations, harrisLayout, relationInputs, relationProblems, type HarrisLayout, type RelationChecks } from '../compute/relations';
import { harrisSvg, type HarrisStyle } from '../render/harris';
import { sequenceColors, sequenceSwatch } from '../render/sequenceColor';
import { RelationTool, type ScarPick } from '../tools/relationTool';
import { SequenceTool } from '../tools/sequenceTool';
import { chainEdges, scarBordersSteps, type ScarBorder } from '../compute/adjacency';
import { BorderLayer } from '../render/borderLayer';
import { arcLengths, landmarkName, landmarkTable, nearestArc, platformSides, pointAtArc, shownLandmarks, type LandmarkTable } from '../compute/landmarks';
import { FLAKE_PARAMETERS, flakeMeasuresSteps, morphDimensionsSteps, type FlakeMeasure, type FlakeMeasures, type FlakeResult, type MorphDimensions } from '../compute/flake';
import { EDGE_ANGLE_DISTANCES_MM, EDGE_ANGLE_PARAMETERS, edgeAnglesSteps, valuesAlongCurve, type EdgeAngleMethod, type EdgeAngleResult } from '../compute/edgeAngle';
import { gmAnchorRows, gmMissingInputs, gmSteps, type GmMissing, type GmResult } from '../compute/gm';
import { anchorsHashOf, gmCacheKey, gmConfigSummary, gmInUse, gmManifest, gmStanding, GM_TEMPLATE_PARAMETERS, layPatchSteps, regionsHashOf, sameGmConfig, usesTemplate } from '../compute/gmTemplate';
import { bandGroupsOf, inLowerLayer, regionSourceOf, upperComponentsOf } from '../compute/projectRegions';
import { TPS_PARAMETERS } from '../compute/tps';
import type { TriangleBvh } from '../compute/triangleBvh';
import { retouchSectionsSteps, sectionAtStation, type RetouchAngleResult, type RetouchPiece, type StationSection } from '../compute/retouchAngle';
import { drawnOutline, planRegionsSteps, planShape, segmentLinesSteps, type P2, type PlanLoops, type PlanShape, type SegmentLines } from '../compute/retouchPlan';
import { planDrawing, PRINT_PALETTE, PX_PER_MM, sectionDrawing, sectionModel, svgFile, type Drawing, type SectionModel } from '../render/retouchDrawing';
import { RetouchLayer } from '../render/retouchLayer';
import { WorkingEdgeLayer, workingEdgeColor, type DrawnEdge } from '../render/workingEdgeLayer';
import { StationTool } from '../tools/stationTool';
import { WorkingEdgeTool, type EdgePlace } from '../tools/workingEdgeTool';
import { clampedEnd, curveStretch, edgeAxis, ownerAt, placedEdges, pointOnCurve, workingEdgeDetails, WORKING_EDGE_MIN_MM, WORKING_EDGE_PARAMETERS, type WorkingEdgeDetail, type WorkingEdgeRefusal } from '../compute/workingEdge';
import { drawingPng, RetouchPlanPanel, RetouchSectionPanel, type PlanFace, type SectionReading } from './retouchPanels';
import { FACE_DORSAL, FACE_PLATFORM, FACE_VENTRAL, faceOfTrianglesSteps, onPlan, removedVolumeCurveSteps, RETOUCH_INDEX_PARAMETERS, retouchIndexSteps, segmentFrameSteps, segmentOutlineSteps, stationFaces, type RetouchCurve, type RetouchIndexInput, type RetouchIndexResult, type RetouchStationDetail, type RetouchStationRow, type SegmentFrameResult, type SegmentOutline } from '../compute/retouchIndex';
import { ruleValues, SHARP_EDGE_PARAMETERS, sharpOfCurve, suggestThreshold, type SharpResult } from '../compute/sharpEdge';
import { EDGE_ANGLE_FLAT_DEG, EDGE_ANGLE_RAMP, EdgeAngleLayer, rampPaint, SHARP_COLORS, sharpPaint } from '../render/edgeAngleLayer';
import { crossSectionAt, type CrossSection, type SectionLine } from '../compute/meshSection';
import { technicalFrameSteps } from '../compute/technicalFrame';
import { frameSource } from '../core/derived';
import { bvhPlaneCandidates, bvhRayCandidates } from '../render/bvhPlane';
import { ProfilePanel } from './profilePanel';
import { gmCurvesCsv, gmLandmarksCsv, gmModelsCsv, gmOutlinesCsv, gmSmvectorCsv, gmSurfacesCsv, gmSurpCsv, landmarksCsv, landmarksFcsv, landmarksTps, slidersCsv } from '../io/landmarks';
import { GmLayer } from '../render/gmLayer';
import { LANDMARK_COLORS, LandmarkLayer } from '../render/landmarkLayer';
import { declutterLabels } from '../render/labelLayout';
import { LandmarkTool } from '../tools/landmarkTool';
import { compareObservers, FACE_TYPES, summarize, type AgreementRow, type FaceLabels, type ObserverData, type SummaryRow } from '../compute/agreement';
import { uuid } from '../core/ids';
import { agreementCsv, agreementSummaryCsv } from '../io/csv';
import type { HitProvider } from '../tools/tool';
import { facesOfPiecesSteps, overPiecesSteps, pieceSeedSteps, joinOpenEndsSteps, JOIN_REACH_EDGES, polylineEdgesSteps, regionsSteps, resolveRegions, smallerPieceSteps, type Partition, type RegionResult, type RegionTotals } from '../compute/regions';
import { fitSphere, type SphereFit } from '../compute/sphere';
import { splitByLoopSteps, splitByPlaneSteps, swappedSplit, type SplitResult, type VolumeSplit } from '../compute/split';
import { boxHint, flakeHint, MEASURE_HINT_PARAMETERS, noduleHint, sharpHint, splitHint, stationsHint, wholeModelHint, type MeasureHint } from '../compute/measureHint';
import { HintLayer } from '../render/hintLayer';
import { assembleCurve, curveSegments } from '../core/curveGeometry';

/** What "Complete loop" says when it cannot. */
const COMPLETE_FAILURES: Record<CompleteFailure, string> = { short: 'toast.completeShort', edge: 'toast.completeEdge', loop: 'toast.completeLoop' };
import { fitPlane } from '../compute/meshGeometry';
import { DEFAULT_FIGURE, FigureError, figureLayout, FIGURE_VIEWS, renderFigure, viewAxes, type Figure, type FigureContext, type FigureLayout, type FigureSettings, type SectionDrawing } from '../render/figure';
import { ConfigSketch } from '../render/configSketch';
import { ViewCube } from '../render/viewCube';
import { curveColor } from '../render/curveLayer';
import { DEFAULT_LIGHT, LightRig } from '../render/lighting';
import { MeshView } from '../render/meshView';
import { Viewer, type SurfaceHit } from '../render/viewer';
import { DrawArrowTool } from '../tools/drawArrowTool';
import { DrawCurveTool } from '../tools/drawCurveTool';
import { MeasureTool } from '../tools/measureTool';
import { SelectTool } from '../tools/selectTool';
import { Selection } from '../tools/selection';
import { SurfaceSnap } from '../tools/surfaceSnap';
import type { EdgeEnd, ToolContext } from '../tools/tool';
import { ToolController } from '../tools/toolController';
import { APP_MODES, type AppApi, type AppMode, type EdgeChartMethod, type ConfigPick, type ConfigStatus, type DisplayAspect, type DisplaySettings } from './appApi';
import { fmtCount, fmtNum, fmtQuantity, mmPerUnit, quantityUnit, type Quantity } from '../core/format';
import { numRow, segmented, softSet, textRow, textValueRow } from './controls';
import { floatingPanel } from './floatingPanel';
import { Popovers, onViewport } from './popover';
import { clear, h, icon, icon20, ICONS, ICONS20 } from './dom';
import { Feedback } from './feedback';
import { BRAND, brandEl } from './brand';
import { getLang, htmlLang, langInfo, LANGS, onLangChange, setLang, t } from './i18n';
import { buildSidebar, type RefreshKind, type Sidebar } from './sidebar';
import { buildStartPage, type StartPage } from './startPage';
import { getTheme, onThemeChange, toggleTheme } from './theme';
import { tip, tips } from './tooltip';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** How near a curve the cursor must be for the working edge tool to take it. */
/** Below this width of the view the status pills are one pill with the count. */
const STATUS_COLLAPSE_PX = 720;
/** The status pills whose click asks for a curve of a type. */
const STATUS_CURVE_TYPES: Partial<Record<StatusKey, string>> = { edge: 'edge', platform_outline: PLATFORM_OUTLINE, core_edge: 'core_edge', retouch: 'retouch' };
const EDGE_PICK_PX = 12;
/** How near an end of a working edge a new end goes to that very point. */
const EDGE_SNAP_PX = 9;

/** Gloss of the surface (0 = matte, 1 = glossy); fixed, as is the fill light (DEFAULT_LIGHT). */
const GLOSS = 0.45;

const DEFAULT_DISPLAY: DisplaySettings = {
  shading: 'plain',
  light: { ...DEFAULT_LIGHT },
  curvScale: 2,
  curvContrast: 1,
  arrows: { ...DEFAULT_ARROW_DISPLAY },
  curveSnap: 'ridge',
  regions: true,
  harris: false,
  configuration: false,
  profile: false,
  gmPoints: false,
  gmSurface: false,
  retouchSection: true,
  retouchPlan: true,
  retouchLines: true,
  retouchEdge: true,
  excelBom: false,
};

/** Scars involved in a problem of the relation checks. */
const PROBLEM_COLOR = '#ff3b30';

/** One colour per observer in the compare mode. */
const OBSERVER_COLORS = ['#e0287d', '#1f9e89', '#3a7fd5', '#d62728', '#7b5cd6', '#c8611f', '#5a8f29', '#8a8f98'];

/** A project compared in the compare mode: the open one (`state` null) or one read from a file. */
interface Observer {
  id: string;
  /** Annotator, or the file name. */
  label: string;
  fileName: string;
  state: ProjectState | null;
  included: boolean;
  color: string;
  layers: { arrows: ArrowLayer; curves: CurveLayer; landmarks: LandmarkLayer } | null;
  /** Region of each triangle, and what it was computed from. */
  faces: { key: string; labels: FaceLabels | null; upper: FaceLabels | null } | null;
  table: LandmarkTable | null;
}

/** Arrow settings as saved, without the thickness earlier versions kept. */
function withoutThickness(arrows: Partial<DisplaySettings['arrows']> & { thickness?: unknown } = {}): Partial<DisplaySettings['arrows']> {
  const { thickness: _thickness, ...rest } = arrows;
  return rest;
}

function loadDisplay(): DisplaySettings {
  // settings of earlier versions that are no longer kept: the view's background (the theme
  // decides it now), gloss, the fill light and the arrows' thickness (fixed)
  const { background: _background, gloss: _gloss, ...saved } = readPref<Partial<DisplaySettings> & { background?: unknown; gloss?: unknown }>('display', {});
  return {
    ...DEFAULT_DISPLAY,
    ...saved,
    shading: saved.shading === 'curvature' ? 'curvature' : 'plain',
    curvScale: Math.max(0, Math.min(100, Math.round(saved.curvScale ?? DEFAULT_DISPLAY.curvScale))),
    light: { ...DEFAULT_LIGHT, ...(saved.light ?? {}), fillIntensity: DEFAULT_LIGHT.fillIntensity },
    arrows: { ...DEFAULT_ARROW_DISPLAY, ...withoutThickness(saved.arrows) },
    curveSnap: SNAP_MODES.includes(saved.curveSnap as SnapMode) ? (saved.curveSnap as SnapMode) : DEFAULT_DISPLAY.curveSnap,
  };
}

function loadFigure(): FigureSettings {
  const saved = readPref<Partial<FigureSettings>>('figure', {});
  const views = (saved.views ?? DEFAULT_FIGURE.views).filter((v) => FIGURE_VIEWS.includes(v));
  return {
    ...DEFAULT_FIGURE,
    ...saved,
    views,
    overlays: { ...DEFAULT_FIGURE.overlays, ...(saved.overlays ?? {}) },
    scale: [0.5, 1, 2].includes(saved.scale ?? 0) ? saved.scale! : DEFAULT_FIGURE.scale,
    dpi: [300, 600, 1200].includes(saved.dpi ?? 0) ? saved.dpi! : DEFAULT_FIGURE.dpi,
  };
}

function loadMode(): AppMode {
  const saved = readPref<string>('mode', 'annotate');
  return (APP_MODES as readonly string[]).includes(saved) ? (saved as AppMode) : 'annotate';
}

/** "3 arrows · 2 curves" for toasts and dialogs. */
function countsText(state: Readonly<ProjectState>): string {
  const arrows = state.scars.length, curves = state.curves.length, measures = state.measurements.length;
  const parts: string[] = [];
  if (arrows > 0 || (curves === 0 && measures === 0)) parts.push(t('count.arrows', { n: arrows }));
  if (curves > 0) parts.push(t('count.curves', { n: curves }));
  if (measures > 0) parts.push(t('count.measurements', { n: measures }));
  return parts.join(' · ');
}

/** A press this near a station's point takes it, in pixels. */
const STATION_REACH_PX = 24;
/** Where the volume removed is worked out for the small curve, mm. */
const FIT_CURVE_LENGTHS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Keys of the bar shown after recording a relation. */
const CHIP_KEYS: Record<string, 'ab' | 'reverse' | 'ind' | 'delete'> = {
  Digit1: 'ab',
  Numpad1: 'ab',
  Digit2: 'reverse',
  Numpad2: 'reverse',
  Digit3: 'ind',
  Numpad3: 'ind',
  Delete: 'delete',
  Backspace: 'delete',
};

/** Tool id, name, key and icon of the measuring tools. */
const MEASURE_TOOLS: Array<[string, string, string, string]> = [
  ['measure-distance', 'tool.distance', 'D', ICONS20.distance],
  ['measure-geodesic', 'tool.geodesic', 'G', ICONS20.geodesic],
  ['measure-angle', 'tool.angle', 'N', ICONS20.angle],
];

const MODE_ICONS: Record<AppMode, string> = {
  annotate: ICONS20.modeAnnotate,
  measure: ICONS20.modeMeasure,
  retouch: ICONS20.modeRetouch,
  present: ICONS20.modePresent,
  compare: ICONS20.modeCompare,
};

/** A row of tools of one work mode: radio buttons with an icon, the name (shown on the current one) and the key. */
type ToolRow = { el: HTMLElement; set: (v: string) => void };

/** Newell normal of a closed polyline (zero for a degenerate one). */
function loopNormal(points: Vec3[]): Vec3 {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [x, y, z];
}

const isTyping = (el: EventTarget | null): boolean => {
  const e = el as HTMLElement | null;
  if (!e || !e.tagName) return false;
  const tag = e.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = (e as HTMLInputElement).type;
    return !['checkbox', 'radio', 'range', 'button'].includes(type);
  }
  return e.isContentEditable;
};

export class App implements AppApi {
  readonly store = new ProjectStore();
  readonly selection = new Selection();
  readonly display: DisplaySettings = loadDisplay();
  readonly feedback: Feedback;
  mode: AppMode = loadMode();
  readonly figure: FigureSettings = loadFigure();

  private viewer: Viewer | null = null;
  private lights: LightRig | null = null;
  private arrows: ArrowLayer | null = null;
  private curves: CurveLayer | null = null;
  private measures: MeasureLayer | null = null;
  private planesLayer: PlaneLayer | null = null;
  private planes: PlaneResult[] = [];
  /** Where the model is cut by each plane and each section, keyed by their id; `key` is the plane it was cut by. */
  private cuts = new Map<string, { key: string; lines: Polyline[] | null }>();
  private sectionLayer: SectionLayer | null = null;
  private regionLayer: RegionLayer | null = null;
  /** Pieces of surface between the curves, and the regions found in them. */
  private partition: Partition | null = null;
  private partitionToken = 0;
  private regions: { results: RegionResult[]; totals: RegionTotals } | null = null;
  /** The piece of the lower layer holding each region's seed (−1: none, or an upper region). */
  private seedComponent: number[] = [];
  /** The upper layer: pieces between the boundary curves, the upper piece of each lower piece, and the piece of each upper region (−1: none, or a lower region). */
  private upper: { key: string; partition: Partition; over: Int32Array } | null = null;
  private upperComponent: number[] = [];
  /** The lower layer as the curves cut it, before each retouch band is made one piece. */
  private rawLower: { partition: Partition; over: Int32Array } | null = null;
  /** Where each retouch curve's band lies in it, by curve id. */
  private retouchBands = new Map<string, { pieces: number[]; area: number }>();
  private retouchSides = new Map<string, { key: string; side: RetouchSide | null }>();
  /** The piece of each region that follows a retouch curve, by region id. */
  private bandPiece = new Map<string, number>();
  private bandKey = '';
  private upperLayer: RegionLayer | null = null;
  private regionRoot: THREE.Group | null = null;
  /** The smaller piece along each platform outline, by the outline's points. */
  private outlineSeeds = new Map<string, Vec3 | null>();
  private conflictKey = '';
  private nodule: (SphereFit & { regions: string[] }) | null = null;
  private noduleMesh: THREE.Mesh | null = null;
  private split: VolumeSplit | null = null;
  private splitToken = 0;
  problemsOpen = false;
  private focusedProblem: number | null = null;
  private harrisEl: HTMLElement | null = null;
  /** The Harris panel was closed while the relation or sequence tool showed it: not again until the tool changes. */
  private harrisAutoOff = false;
  /** The sequence the sequence tool puts scars into. */
  private currentSequence: string | null = null;
  private sequenceBarEl: HTMLElement | null = null;
  /** Borders between scar regions (for the scars not judged yet), and the one "next pair" went to last. */
  private borders: ScarBorder[] = [];
  private bordersToken = 0;
  private borderCursor = -1;
  private borderLayer: BorderLayer | null = null;
  private landmarkLayer: LandmarkLayer | null = null;
  private landmarks: LandmarkTable = { rows: [], sliders: [], sets: [] };
  /** Landmark names carried over from the last specimen, and those skipped. */
  private names: { list: string[]; skipped: Set<string> } | null = null;
  private observers: Observer[] = [{ id: 'current', label: '', fileName: '', state: null, included: true, color: OBSERVER_COLORS[0], layers: null, faces: null, table: null }];
  private agreement: { rows: AgreementRow[]; summary: SummaryRow[] } | null = null;
  private agreementBusyFlag = false;
  private agreementStale = true;
  private agreementToken = 0;
  private agreementTimer = 0;
  /** What the numbers in FaceLabels stand for (the codes, then the observers' own texts). */
  private faceTypes: string[] = [...FACE_TYPES];
  private faceAreas: Float32Array | null = null;
  /** Largest distance for matching arrows and curves (null: a tenth of the model's diagonal). */
  private gate: number | null = null;
  /** The agreement row shown in 3D and the item it shows for each observer (by observer id). */
  private agreementFocused: { key: string; items: Map<string, string> } | null = null;
  private workspace: Workspace | null = null;
  /** The workspace model that is open (−1: none, or a model opened from elsewhere). */
  private wsIndex = -1;
  private folderSaveTimer = 0;
  /** Specimen ID of each model of the folder (by path), and the file names several models share. */
  private wsIds = new Map<string, string>();
  private wsDuplicates: Array<{ name: string; files: string[] }> = [];
  /** The folder's project files by model checksum (read the first time a batch or a comparison needs them). */
  private projectIndex: ProjectIndex | null = null;
  /** Read-only folder: the project of each model edited in this session (JSON), and those not downloaded since. */
  private sessionProjects = new Map<string, string>();
  private undownloaded = new Set<string>();
  private batch: { kind: 'measure' | 'figures'; done: number; total: number; failed: number; cancelled: boolean; started: number; pausedMs: number; pausedAt: number | null } | null = null;
  private batchTimer = 0;
  /** Figures: PNG and SVG render every model of the folder. */
  figureFolder = false;
  private harrisBody: HTMLElement | null = null;
  private tools: ToolController | null = null;
  private sidebar: Sidebar;

  private loaded: LoadedMesh | null = null;
  private meshView: MeshView | null = null;
  private curvature: CurvatureService | null = null;
  private surfaceSnap: SurfaceSnap | null = null;
  private curvToken = 0;
  private curvTimer = 0;
  private curvBusy = false;
  private pendingProject: ProjectState | null = null;
  private lastHover: SurfaceHit | null = null;
  private autosaveTimer = 0;
  private readonly autosaveOk = autosaveAvailable();
  private autosaveWarned = false;
  /** The last autosave could not be written (the browser's storage is full). */
  private autosaveFailed = false;
  /** Edits since the project file was last saved (downloaded): what a read-only folder would lose. */
  private unsaved = false;
  private closeItem: HTMLButtonElement | null = null;
  private occlusionDirty = true;
  private lastOcclusion = 0;
  private coordsQueued = false;

  // DOM
  private readonly appEl: HTMLElement;
  private header!: HTMLElement;
  private readonly viewportEl: HTMLElement;
  private readonly toolbarEl: HTMLElement;
  private readonly startPage: StartPage;
  private readonly startEl: HTMLElement;
  /** The ways to open something, in the middle of the empty view. */
  private readonly emptyEl: HTMLElement;
  private mainEl!: HTMLElement;
  /** A module has been chosen: the workspace shows, with or without a model. */
  private entered = false;
  private startOnScreen = false;
  private readonly statusEl: HTMLElement;
  private statusKey = '';
  /** A narrow view's pills are open because the pointer is over them. */
  private statusHovered = false;
  /** The type asked for the next curve drawn (a click on a status pill): view state, gone once a curve is drawn or the tool changes. */
  private nextCurveType: string | null = null;
  private readonly coordEl: HTMLElement;
  private readonly dropEl: HTMLElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private saveBtn!: HTMLButtonElement;
  private fileBtn!: HTMLButtonElement;
  private specimenBar!: HTMLElement;
  /** Open the specimen panel, with the unit in focus. */
  private openUnit: () => void = () => {};
  private specimenRefs: { id: HTMLInputElement; unit: HTMLSelectElement; type: HTMLSelectElement; annotator: HTMLInputElement | HTMLTextAreaElement; notes: HTMLInputElement | HTMLTextAreaElement; meta: HTMLElement; name: HTMLElement; unitText: HTMLElement; framePill: HTMLElement } | null = null;
  readonly popovers = new Popovers();
  private displayCtl: HTMLElement | null = null;
  private appModeSeg: ToolRow | null = null;
  private modeSeg: ToolRow | null = null;
  private snapSeg: ReturnType<typeof segmented> | null = null;
  private snapEl: HTMLElement | null = null;
  private measureSeg: ToolRow | null = null;
  private presentSeg: ToolRow | null = null;
  private toolSep: HTMLElement | null = null;
  private orientBtn: HTMLButtonElement | null = null;
  private themeBtn: HTMLButtonElement | null = null;
  private hoverTipTimer = 0;
  private measureBase: SurfaceMeasures | null = null;
  private auto: AutoMeasurements | null = null;
  private autoFrameKey = '';
  /** The model's box along the frame (from the pass that measures length, width and thickness), and the volumetric configuration. */
  private configBox: ConfigBox | null = null;
  private configResult: CoreConfiguration | null = null;
  /** The face (box) or cone (bicone) picked in the configuration panel or the view cube: the arrows elsewhere are drawn faded meanwhile. */
  private pickedFace: ConfigPick | null = null;
  /** The longest measure of a flake, once per mesh. */
  private flakeMorph: { loaded: LoadedMesh; value: MorphDimensions | null } | null = null;
  private flakeSection: { loaded: LoadedMesh; key: string; line: SectionLine | null } | null = null;
  /** A flake's measurements, and what the profile panel draws from them. */
  private flake: FlakeResult | null = null;
  private flakeToken = 0;
  private flakeTimer = 0;
  /** The specimen's type and unit as the flake was last measured with. */
  private specimenKey = '';
  /** Where the smaller piece along the platform outline lies, for the outline it was found from. */
  private platformAuto: { key: string; seed: Vec3 } | null = null;
  private platformToken = 0;
  /** Each region plane's fit to its regions, by plane id. */
  private regionFits = new Map<string, { centroid: Vec3; normal: Vec3; count: number }>();
  private regionFitToken = 0;
  private profilePanel: ProfilePanel | null = null;
  private profileEl: HTMLElement | null = null;
  private profileFit: (() => void) | null = null;
  /** The profile panel's section across, as a share of the technical length (a view state, never in the file). */
  private profileAt = 0.5;
  private profileCross: CrossSection | null = null;
  private profileFrame = 0;
  private ringLayer: BorderLayer | null = null;
  /** Each measured curve's edge angles, and what they were computed from. */
  private edgeResults = new Map<string, { key: string; result: EdgeAngleResult | null }>();
  private edgeToken = 0;
  private edgeTimer = 0;
  edgeMethod: EdgeAngleMethod = 'three_points';
  /** Which line the chart shows and the curve is coloured by: 'all', a distance (d2) or a layer (L1). */
  edgeSeries = 'all';
  edgeColorMode: 'angle' | 'sharp' = 'angle';
  private retouchResults = new Map<string, { key: string; result: RetouchAngleResult | null; sections: Array<StationSection | null>; length: number }>();
  private retouchTimer = 0;
  private retouchToken = 0;
  /** Counts the partitions made: the retouch layers go by the pieces. */
  private partitionVersion = 0;
  /** A flake's retouch indices, and what they were made from. */
  private retouchIndex: RetouchIndexResult | null = null;
  private retouchIndexKey = '';
  private retouchIndexTimer = 0;
  private retouchIndexToken = 0;
  /** The plan the segments lie on, kept while its inputs stay. */
  private retouchFrame: { key: string; frame: SegmentFrameResult; outline: SegmentOutline | null } | null = null;
  /** The part of the flake each triangle lies in, kept while the upper layer of regions stays. */
  private retouchFaces: { key: string; faces: Uint8Array } | null = null;
  /** The pieces in a retouch layer when the indices were last worked out. */
  private retouchPieces: ReadonlyMap<number, RetouchPiece> = new Map();
  private retouchLastInput: RetouchIndexInput | null = null;
  /** The key of the indices without the fitted length. */
  private retouchFitKey = '';
  /** The fitted length while its slider is dragged. */
  private fitPreview: number | null = null;
  /** The current station: view state, never in the file. */
  private retouchStation: { curveId: string; k: number } | null = null;
  /** It goes to where the missing area is largest until the user moves it. */
  private stationAuto = true;
  private stationQueued = 0;
  private stationCache: { key: string; section: StationSection | null } | null = null;
  retouchMethod: EdgeChartMethod = 'three_points';
  retouchSeries = 'all';
  private planFace: PlanFace = 'dorsal';
  private planMarked: number | null = null;
  private planShapeOf: { key: string; shape: PlanShape } | null = null;
  private planLoops: { key: string; loops: PlanLoops[] } | null = null;
  private segmentLines: { key: string; lines: SegmentLines } | null = null;
  private fitCurve: { key: string; points: Array<{ length: number; removed: number | null }> } | null = null;
  private retouchExtrasToken = 0;
  private retouchLayer: RetouchLayer | null = null;
  private sectionPanel: RetouchSectionPanel | null = null;
  private sectionEl: HTMLElement | null = null;
  private sectionFit: (() => void) | null = null;
  private planPanel: RetouchPlanPanel | null = null;
  private planEl: HTMLElement | null = null;
  private planFit: (() => void) | null = null;
  private edgeColorCurve: string | null = null;
  /** The folder's rule for a sharp edge (null: none yet, or no folder open). */
  private folderSharp: SharpEdgeRule | null = null;
  /** A flake's points for geometric morphometrics, and what they were made from. */
  private gm: GmResult | null = null;
  private gmDoneKey = '';
  /** The trees of the regions points are brought onto, while the pieces stay. */
  private gmTrees = new Map<string, TriangleBvh>();
  private gmTreesOf = -1;
  /** A template is being laid. */
  private gmLaying = false;
  private gmTimer = 0;
  private gmToken = 0;
  private gmLayer: GmLayer | null = null;
  private hintLayer: HintLayer | null = null;
  /** The row of a measure the pointer is on, the one with the keyboard's focus, the one fixed by a click (the first of them is drawn). */
  private hintHover: string | null = null;
  private hintFocus: string | null = null;
  private hintPinned: string | null = null;
  /** Just let go, with the pointer still on it: not drawn again until the pointer has left it. */
  private hintMuted: string | null = null;
  private hintTimer = 0;
  private hintShown: { key: string; hint: MeasureHint } | null = null;
  /** The folder's configuration of those points (null: none yet, or no folder open). */
  private folderGm: GmConfig | null = null;
  /** How the points of the folder's models came out in this session, by the configuration as it is: not all of them are saved, since nothing was edited. */
  private gmSeen = new Map<string, { done: boolean; flagged: number }>();
  private edgeLayer: EdgeAngleLayer | null = null;
  private workingEdgeLayer: WorkingEdgeLayer | null = null;
  /** The working edges' measures, while nothing they are made from has changed. */
  private edgeDetails: WorkingEdgeDetail[] | null = null;
  /** The row of the working edges drawn on the plan. */
  private planEdgeId: string | null = null;
  /** An end being dragged, and where it stands now. */
  private edgeDrag: { id: string; which: 'start' | 'end'; point: Vec3 } | null = null;
  private edgeLegend: HTMLElement | null = null;
  private edgeColorKey = '';
  /** The split as computed (before `swap`), for the plane or curve it was computed from. */
  private splitRaw: { key: string; value: SplitResult | null } | null = null;
  /** The split is being computed (the bicone waits for it). */
  private splitBusy = false;
  /** A curve being completed into a loop (its id). */
  private completing: string | null = null;
  private viewCube: ViewCube | null = null;
  private sketch: ConfigSketch | null = null;
  private configEl: HTMLElement | null = null;
  private configFit: (() => void) | null = null;
  private measureToken = 0;
  private readonly meshInput: HTMLInputElement;
  private readonly projectInput: HTMLInputElement;
  private readonly compareInput: HTMLInputElement;
  private readonly folderInput: HTMLInputElement;

  constructor(private readonly root: HTMLElement) {
    document.documentElement.lang = htmlLang();
    this.appEl = h('div', { class: 'app' });
    this.viewportEl = h('section', { class: 'viewport', id: 'viewport', 'data-mode': this.mode });
    this.toolbarEl = h('div', { class: 'viewport-ui vp-toolbar' });
    this.startPage = buildStartPage((type) => this.enterModule(type));
    this.startEl = this.startPage.el;
    this.emptyEl = h('div', { class: 'vp-empty', id: 'viewport-empty', hidden: true });
    this.statusEl = h('div', { class: 'viewport-ui status-pills', id: 'annotation-status', role: 'group', hidden: true });
    this.coordEl = h('span', { class: 'viewport-ui status-coords mono', id: 'status-coords' });
    this.dropEl = h('div', { class: 'drop-overlay', hidden: true }, icon(ICONS.open));
    this.meshInput = h('input', { type: 'file', accept: '.ply,.stl,.obj', hidden: true, id: 'file-mesh' }) as HTMLInputElement;
    this.projectInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, id: 'file-project' }) as HTMLInputElement;
    this.compareInput = h('input', { type: 'file', accept: '.json,application/json', multiple: true, hidden: true, id: 'file-compare' }) as HTMLInputElement;
    this.folderInput = h('input', { type: 'file', multiple: true, webkitdirectory: true, hidden: true, id: 'file-folder' }) as HTMLInputElement;
    this.feedback = new Feedback(this.appEl);
    this.sidebar = buildSidebar(this);
  }

  // ------------------------------------------------------------ startup

  async start(): Promise<void> {
    initHostDownloads();
    this.header = this.buildHeader();
    const main = h('main', { class: 'workspace' }, this.viewportEl, this.sidebar.el);
    this.mainEl = main;
    this.buildSidebarResizer(main);
    this.appEl.prepend(this.header, main);
    this.appEl.append(this.meshInput, this.projectInput, this.compareInput, this.folderInput);
    this.folderInput.addEventListener('change', () => {
      const ws = workspaceFromFiles([...(this.folderInput.files ?? [])]);
      this.folderInput.value = '';
      if (ws) void this.useWorkspace(ws);
    });
    this.compareInput.addEventListener('change', () => {
      const files = [...(this.compareInput.files ?? [])];
      this.compareInput.value = '';
      if (files.length) void this.addObservers(files);
    });
    this.root.append(this.appEl);

    try {
      this.viewer = new Viewer(this.viewportEl);
    } catch {
      this.viewportEl.append(h('div', { class: 'vp-error' }, h('p', {}, t('error.webgl'))));
      return;
    }
    const viewer = this.viewer;
    // corner marks of the view (decoration; not part of figures, which are rendered apart)
    const corners = (['tl', 'tr', 'bl', 'br'] as const).map((c) => h('span', { class: `vp-corner vp-corner-${c}`, 'aria-hidden': 'true' }));
    this.viewportEl.append(...corners, this.emptyEl, this.toolbarEl, this.statusEl, this.coordEl, this.dropEl);
    this.appEl.append(this.startEl);
    new ResizeObserver(() => this.fitStatus()).observe(this.viewportEl);
    this.statusEl.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'touch' || !this.statusEl.classList.contains('is-collapsed')) return;
      this.statusHovered = true;
      this.setStatusOpen(true);
    });
    this.statusEl.addEventListener('pointerleave', () => {
      if (!this.statusHovered) return;
      this.statusHovered = false;
      this.setStatusOpen(false);
    });
    this.lights = new LightRig(viewer.scene);
    this.lights.set(this.display.light);
    this.arrows = new ArrowLayer(viewer);
    this.arrows.onLabelClick = (id) => this.selection.set(id);
    this.curves = new CurveLayer(viewer);
    this.curves.onLabelClick = (id) => this.selection.set(id);
    this.measures = new MeasureLayer(viewer);
    this.measures.onLabelClick = (id) => this.selection.set(id);
    this.planesLayer = new PlaneLayer(viewer);
    this.sectionLayer = new SectionLayer(viewer);
    this.regionRoot = new THREE.Group();
    viewer.scene.add(this.regionRoot);
    this.upperLayer = new RegionLayer(this.regionRoot, true);
    this.regionLayer = new RegionLayer(this.regionRoot);
    this.landmarkLayer = new LandmarkLayer(viewer);
    this.landmarkLayer.onLabelClick = (id) => this.selection.set(id);
    this.borderLayer = new BorderLayer(viewer);
    this.ringLayer = new BorderLayer(viewer, true);
    this.edgeLayer = new EdgeAngleLayer(viewer);
    this.retouchLayer = new RetouchLayer(viewer);
    this.workingEdgeLayer = new WorkingEdgeLayer(viewer);
    this.workingEdgeLayer.onLabelClick = (id) => this.selection.set(id);
    this.gmLayer = new GmLayer(viewer);
    this.hintLayer = new HintLayer(viewer);
    this.edgeLegend = h('div', { class: 'viewport-ui edge-legend', id: 'edge-legend', hidden: true });
    this.viewportEl.append(this.edgeLegend);
    this.viewCube = new ViewCube(viewer);
    this.viewCube.onPick = (face) => this.selectConfigFace(face, true);

    viewer.onFrame(() => {
      this.lights!.update(viewer.camera, viewer.controls.target, viewer.diagonal * 3);
      if (this.occlusionDirty && performance.now() - this.lastOcclusion > 90) {
        this.occlusionDirty = false;
        this.lastOcclusion = performance.now();
        this.arrows?.updateOcclusion();
        this.curves?.updateOcclusion();
        this.workingEdgeLayer?.updateOcclusion();
        this.measures?.updateOcclusion();
        this.landmarkLayer?.updateOcclusion();
        // labels behind the surface give way in the layout: lay them out again
        viewer.requestRender();
      }
    });
    viewer.onCameraChange(() => {
      this.occlusionDirty = true;
    });
    // labels that would cover each other move apart (a few times a second while the view moves)
    let lastDeclutter = 0, declutterTimer = 0;
    viewer.onAfterRender(() => {
      clearTimeout(declutterTimer);
      const run = () => {
        lastDeclutter = performance.now();
        declutterLabels(viewer.labelRenderer.domElement);
      };
      if (performance.now() - lastDeclutter > 80) run();
      else declutterTimer = window.setTimeout(run, 90);
    });

    const ctx: ToolContext = {
      viewer,
      store: this.store,
      arrows: this.arrows,
      curves: this.curves,
      measures: this.measures,
      landmarks: this.landmarkLayer,
      selection: this.selection,
      snap: () => this.surfaceSnap,
      snapMode: () => this.display.curveSnap,
      notify: (key, tone) => this.feedback.toast(t(key), tone === 'warn' ? 'warn' : 'info'),
      changed: () => this.updateCursor(),
      editable: () => this.mode === 'annotate',
      hovered: (item) => this.hoverTip(item),
      takeNextCurveType: () => this.takeNextCurveType(),
      onPlatformOutline: (p) => this.onPlatformOutline(p),
      moveAxisEnd: (which, point, normal) => this.moveAxisEnd(which, point, normal),
      edgeEnds: {
        at: (x, y) => this.workingEdgeLayer?.handleAt(x, y, this.selection.id) ?? null,
        highlight: (end) => this.workingEdgeLayer?.highlight(end),
        drag: (end, x, y) => this.dragEdgeEnd(end, x, y),
        finish: (commit) => this.finishEdgeDrag(commit),
      },
    };
    this.tools = new ToolController(ctx, this.viewportEl);
    this.tools.register(new SelectTool(ctx));
    this.tools.register(new DrawArrowTool(ctx));
    this.tools.register(new DrawCurveTool(ctx));
    this.tools.register(new DrawArrowTool(ctx, { id: 'axis', snapStart: true, onFinish: (s, e) => this.drawAxis(s, e) }));
    for (const type of ['distance', 'geodesic', 'angle'] as const) this.tools.register(new MeasureTool(ctx, type));
    this.tools.register(new SectionTool(ctx, this.viewportEl, () => this.modelCentre()));
    this.tools.register(new ClickTool('region', (hit) => this.clickRegion(hit.point, hit.faceIndex)));
    this.tools.register(new StationTool((x, y, following) => this.placeStation(x, y, following)));
    this.tools.register(new WorkingEdgeTool({ locate: (x, y, curveId) => this.edgePlaceAt(x, y, curveId), preview: (first, over) => this.previewEdge(first, over), place: (curveId, start, end) => this.placeWorkingEdge(curveId, start, end) }, () => this.updateCursor()));
    this.tools.register(new LandmarkTool(ctx, this.landmarkLayer, (p) => this.placeLandmark(p), (l, p) => (l.code === 'platform_end' ? (this.onPlatformOutline(p) ?? l.point) : p)));
    this.tools.register(new RelationTool(ctx, (x, y, hit) => this.scarAt(x, y, hit), (a, b, at, from) => this.recordRelation(a, b, at, from)));
    this.tools.register(new SequenceTool((x, y, hit) => this.scarAt(x, y, hit), (id) => this.toggleInSequence(id)));
    this.tools.onHover = (hit) => {
      this.lastHover = hit;
      this.queueCoords();
    };
    this.tools.onLightAdjust = (az, el) => {
      this.setDisplay((d) => {
        d.light.azimuthDeg = Math.round(az);
        d.light.elevationDeg = Math.round(el);
      }, 'light');
      this.sidebar.refresh('display');
    };

    this.buildToolbar();
    this.buildEmptyView();
    this.buildHarrisPanel();
    this.buildConfigPanel();
    this.buildProfilePanel();
    this.buildRetouchPanels();
    this.buildDisplayControl();
    this.updateSpecimenBar();
    // the retouch mode belongs to flakes (the preference stays until a mode is chosen)
    if (this.mode === 'retouch' && !this.isFlake()) {
      this.mode = 'annotate';
      this.viewportEl.dataset.mode = this.mode;
      this.appModeSeg?.set(this.mode);
    }
    this.setTool(this.mode === 'retouch' ? 'station' : 'select');

    this.store.subscribe((c) => this.onStoreChange(c));
    this.store.history.onChange(() => this.updateUndoButtons());
    this.selection.onChange((id) => {
      // the relation's bar goes once something else is selected
      if (this.relationChip && id !== this.relationChip.id) this.relationChip.close();
      this.syncAnnotations();
      if (this.store.region(this.selection.id ?? '') || this.regions?.results.length) this.paintRegions();
      this.sidebar.refresh('selection');
      this.updateHarris();
      // the selected scar's arrow in the sketch
      this.syncConfigViews();
      this.updateCursor();
    });
    onLangChange(() => this.rebuildChrome());
    onThemeChange(() => {
      this.paintThemeButton();
      this.startPage.paint();
      // the configuration's colours are the theme's
      this.viewCube?.repaint();
      this.sketch?.repaint();
      this.refreshHint();
    });

    this.wireFiles();
    this.wireKeyboard();
    window.addEventListener('pagehide', () => this.flushAutosave());
    // a read-only folder keeps this session's edits in memory only: ask before they go
    window.addEventListener('beforeunload', (e) => {
      if (!this.lossOnLeaving()) return;
      e.preventDefault();
      e.returnValue = '';
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushAutosave();
    });
    this.exposeDebugApi();
    this.updateUndoButtons();
    this.updateMeshDependentUi();
  }

  // ------------------------------------------------------------ chrome

  /**
   * Top bar: the logo and the name, the specimen; the modes in the middle; File, Save, undo
   * and redo, language, appearance and shortcuts. Icon buttons have tooltips, no titles.
   */
  private buildHeader(): HTMLElement {
    const btn = (id: string, iconPath: string, label: string, onclick: () => void) =>
      h('button', { type: 'button', id, class: 'btn btn-quiet hdr-btn', onclick }, icon(iconPath), h('span', { class: 'btn-text' }, label)) as HTMLButtonElement;
    this.undoBtn = h('button', { type: 'button', class: 'icon-btn', id: 'btn-undo', 'aria-label': t('header.undo'), onclick: () => this.undo() }, icon(ICONS.undo)) as HTMLButtonElement;
    this.redoBtn = h('button', { type: 'button', class: 'icon-btn', id: 'btn-redo', 'aria-label': t('header.redo'), onclick: () => this.redo() }, icon(ICONS.redo)) as HTMLButtonElement;
    const history = (key: 'header.undo' | 'header.redo', what: string | null) => (what ? `${t(key)}: ${t(what)}` : t(key));
    tips.attach(this.undoBtn, () => ({ label: history('header.undo', this.store.history.undoLabelKey), key: 'Ctrl+Z' }));
    tips.attach(this.redoBtn, () => ({ label: history('header.redo', this.store.history.redoLabelKey), key: 'Ctrl+Shift+Z' }));
    this.saveBtn = btn('btn-save-project', ICONS.save, t('header.save'), () => this.saveProject());
    tip(this.saveBtn, t('header.saveProject'), 'Ctrl+S');
    // opening things: one menu
    const menu = h('div', { class: 'popover menu', id: 'file-menu', role: 'menu', hidden: true });
    this.fileBtn = h(
      'button',
      { type: 'button', id: 'btn-file', class: 'btn btn-quiet hdr-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': t('header.file'), onclick: () => this.popovers.toggle(this.fileBtn, menu) },
      icon(ICONS.file),
      h('span', { class: 'btn-text' }, t('header.file')),
      icon(ICONS.chevron),
    ) as HTMLButtonElement;
    tip(this.fileBtn, t('header.file'));
    const item = (id: string, iconPath: string, label: string, run: () => void) =>
      h('button', { type: 'button', id, class: 'menu-item', role: 'menuitem', onclick: () => (this.popovers.close(), run()) }, icon(iconPath), h('span', {}, label));
    // closing has no key: Ctrl+W would close the browser's tab
    this.closeItem = item('btn-close-model', ICONS.close, t('header.close'), () => void this.closeModel()) as HTMLButtonElement;
    this.closeItem.disabled = !this.hasMesh();
    menu.append(
      item('btn-open', ICONS.cube, t('header.openMesh'), () => this.meshInput.click()),
      item('btn-open-project', ICONS.project, t('header.openProject'), () => this.openProject()),
      item('btn-open-folder', ICONS.open, t('header.openFolder'), () => void this.openFolder()),
      h('hr', { class: 'menu-sep', 'aria-hidden': 'true' }),
      this.closeItem,
    );
    // languages, each named in itself; the current one checked
    const langMenu = h('div', { class: 'popover menu', id: 'lang-menu', role: 'menu', hidden: true });
    const langBtn = h(
      'button',
      { type: 'button', id: 'btn-lang', class: 'btn btn-quiet lang-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': t('header.language'), onclick: () => this.popovers.toggle(langBtn, langMenu) },
      icon(ICONS.lang),
      h('span', { class: 'lang-short' }, langInfo().short),
    ) as HTMLButtonElement;
    tip(langBtn, t('header.language'));
    for (const l of LANGS) {
      const check = icon(ICONS.check);
      check.classList.add('menu-check');
      langMenu.append(
        h('button', { type: 'button', id: `lang-${l.code}`, class: 'menu-item', role: 'menuitemradio', lang: htmlLang(l.code), 'aria-checked': String(l.code === getLang()), onclick: () => (this.popovers.close(), setLang(l.code)) }, check, h('span', {}, l.label)),
      );
    }
    // light / dark shell: the icon shows what a click switches to
    this.themeBtn = h('button', { type: 'button', class: 'icon-btn', id: 'btn-theme', onclick: () => toggleTheme() }) as HTMLButtonElement;
    tips.attach(this.themeBtn, () => ({ label: t(getTheme() === 'dark' ? 'theme.light' : 'theme.dark') }));
    this.paintThemeButton();
    const help = h('button', { type: 'button', class: 'icon-btn', id: 'btn-help', 'aria-label': t('header.help'), onclick: () => this.showHelp() }, icon(ICONS.help));
    tip(help, t('header.help'), '?');
    this.specimenBar = this.buildSpecimenBar();
    this.appModeSeg = this.buildModeSwitch();
    return h(
      'header',
      { class: 'topbar' },
      h(
        'div',
        { class: 'topbar-left' },
        h('div', { class: 'brand' }, brandEl(BRAND.logoSmall, 'brand-logo'), brandEl(BRAND.wordmark, 'brand-wm')),
        this.specimenBar,
      ),
      this.appModeSeg.el,
      h(
        'nav',
        { class: 'top-actions', 'aria-label': 'File' },
        h('div', { class: 'menu-wrap' }, this.fileBtn, menu),
        this.saveBtn,
        h('span', { class: 'hdr-sep', 'aria-hidden': 'true' }),
        this.undoBtn,
        this.redoBtn,
        h('span', { class: 'hdr-sep', 'aria-hidden': 'true' }),
        h('div', { class: 'menu-wrap' }, langBtn, langMenu),
        this.themeBtn,
        help,
      ),
    );
  }

  private paintThemeButton(): void {
    const b = this.themeBtn;
    if (!b) return;
    const dark = getTheme() === 'dark';
    clear(b);
    b.append(icon20(dark ? ICONS20.sun : ICONS20.moon));
    b.setAttribute('aria-label', t(dark ? 'theme.light' : 'theme.dark'));
  }

  /** The work modes: icon and name (the name drops in narrow windows), M cycles through them. */
  private buildModeSwitch(): ToolRow {
    const buttons = APP_MODES.map((m) => {
      const name = t(`appMode.${m}`);
      const b = h(
        'button',
        { type: 'button', class: 'mode-btn', role: 'radio', id: `app-mode-${m}`, 'data-value': m, 'aria-checked': String(m === this.mode), 'aria-label': name, onclick: () => this.setMode(m) },
        icon20(MODE_ICONS[m]),
        h('span', { class: 'mode-label' }, name),
      );
      tip(b, name, 'M');
      return b;
    });
    const el = h('div', { class: 'mode-switch', role: 'radiogroup', 'aria-label': t('appMode.label') }, ...buttons);
    return { el, set: (v) => buttons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === v))) };
  }

  /** The specimen in the top bar: one button (name and unit) opening a panel with all its details. */
  private buildSpecimenBar(): HTMLElement {
    const id = h('input', { id: 'specimen-id', class: 'ctl-text mono', type: 'text', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
    id.addEventListener('input', () => updateSpecimen(this.store, { id: id.value }));
    const unit = h(
      'select',
      { id: 'specimen-unit', class: 'ctl-select' },
      ...['mm', 'cm', 'm', 'in'].map((u) => h('option', { value: u }, u)),
      h('option', { value: '' }, t('unit.unknown')),
    ) as HTMLSelectElement;
    unit.addEventListener('change', () => {
      updateSpecimen(this.store, { unit: unit.value });
      writePref('unit', unit.value);
    });
    const head = h(
      'div',
      { class: 'spec-head' },
      h('div', { class: 'ctl' }, h('label', { class: 'ctl-label', for: 'specimen-id' }, t('field.specimenId')), id),
      h('div', { class: 'ctl' }, h('label', { class: 'ctl-label', for: 'specimen-unit' }, t('field.unit')), unit),
    );
    const type = h('select', { id: 'specimen-type', class: 'ctl-select' }, ...SPECIMEN_TYPES.map((x) => h('option', { value: x }, t(`specimen.type.${x}`)))) as HTMLSelectElement;
    type.addEventListener('change', () => {
      setSpecimenType(this.store, type.value as SpecimenType);
      // the next new specimen starts as this one
      writePref('specimenType', type.value);
    });
    const typeRow = h('div', { class: 'ctl' }, h('label', { class: 'ctl-label', for: 'specimen-type' }, t('field.specimenType')), type);
    const annotator = textRow('specimen-annotator', t('field.annotator'), '', (v) => {
      updateSpecimen(this.store, { annotator: v });
      writePref('annotator', v);
    });
    const notes = textRow('specimen-notes', t('field.notes'), '', (v) => updateSpecimen(this.store, { notes: v }), { multiline: true });
    const meta = h('dl', { class: 'num-grid', id: 'specimen-meta' });
    const panel = h('div', { class: 'popover spec-panel', id: 'specimen-panel', role: 'dialog', 'aria-label': t('sec.specimen'), hidden: true }, head, typeRow, annotator.el, notes.el, meta);
    const name = h('span', { class: 'spec-name', id: 'specimen-name' });
    const unitText = h('span', { class: 'spec-unit', id: 'specimen-unit-text' });
    const more = h('button', { type: 'button', class: 'spec-btn', id: 'specimen-more', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => this.popovers.toggle(more, panel) }, name, unitText, icon(ICONS.chevron));
    tip(more, t('sec.specimen'));
    const framePill = h('span', { class: 'pill spec-frame', id: 'frame-pill', hidden: true });
    tips.attach(framePill, () => {
      const f = this.store.state.flake.axis?.failure;
      return f ? { label: t(`axis.${f}`) } : null;
    });
    this.specimenRefs = { id, unit, type, annotator: annotator.input, notes: notes.input, meta, name, unitText, framePill };
    this.openUnit = () => {
      if (this.popovers.open !== panel) this.popovers.toggle(more, panel);
      unit.focus();
    };
    return h('div', { class: 'menu-wrap spec-bar', id: 'specimen-bar' }, more, panel, framePill);
  }

  private updateSpecimenBar(): void {
    const r = this.specimenRefs;
    if (!r) return;
    const st = this.store.state;
    this.specimenBar.hidden = !st.mesh;
    softSet(r.id, st.specimen.id);
    if (r.unit.value !== st.specimen.unit) r.unit.value = st.specimen.unit;
    r.type.value = st.specimen.type;
    // a flake's orientation: the technical axis, the principal axes before there is one, or why there is no frame
    const flake = st.specimen.type === 'flake';
    r.framePill.hidden = !flake;
    if (flake) {
      const failed = st.flake.axis?.failure;
      r.framePill.textContent = failed ? t('axis.noFrame') : st.specimen.frame?.source.startsWith(TECHNICAL_FRAME) ? t('frame.src.technical') : st.specimen.frame ? t('frame.src.other') : t('config.principal');
      r.framePill.classList.toggle('pill-warn', !!failed);
    }
    softSet(r.annotator, st.specimen.annotator);
    softSet(r.notes, st.specimen.notes);
    r.name.textContent = st.specimen.id || t('specimen.untitled');
    r.name.classList.toggle('is-untitled', !st.specimen.id);
    r.unitText.textContent = st.specimen.unit || t('unit.unknown');
    clear(r.meta);
    const m = st.mesh;
    if (m) {
      const [dt, dd] = textValueRow(t('mesh.file'), m.fileName);
      dd.title = `SHA-256 ${m.sha256}`;
      r.meta.append(dt, dd, ...numRow(t('mesh.vertices'), fmtCount(m.vertexCount), '', 'specimen-vertices'), ...numRow(t('mesh.triangles'), fmtCount(m.triangleCount), '', 'specimen-triangles'));
    }
  }

  /** The display settings: a button at the top right of the view and its panel. */
  private buildDisplayControl(): void {
    const panel = h('div', { class: 'popover display-panel', id: 'display-panel', hidden: true }, this.sidebar.displayEl);
    // the panel scrolls within the view, whichever way it opens
    const fit = () => {
      if (panel.hidden) return;
      panel.style.maxHeight = '';
      const vp = this.viewportEl.getBoundingClientRect(), b = button.getBoundingClientRect(), r = panel.getBoundingClientRect();
      const room = r.top >= b.bottom ? vp.bottom - r.top - 12 : b.top - vp.top - 18;
      if (r.height > room) panel.style.maxHeight = `${Math.max(120, room)}px`;
    };
    const button = h('button', { type: 'button', class: 'btn vp-btn', id: 'btn-display', 'aria-expanded': 'false', onclick: () => {
      this.popovers.toggle(button, panel);
      fit();
    } }, icon20(ICONS20.display), h('span', { class: 'btn-text' }, t('sec.display')));
    const el = h('div', { class: 'viewport-ui vp-display' }, button, panel);
    this.popovers.close();
    if (this.displayCtl) this.displayCtl.replaceWith(el);
    else this.viewportEl.append(el);
    this.displayCtl = el;
    el.hidden = !this.hasMesh();
  }

  private resizerEl: HTMLElement | null = null;

  /** Drag the sidebar's left edge to change its width (remembered). */
  private buildSidebarResizer(main: HTMLElement): void {
    // a narrow window keeps room for the 3D view whatever width was chosen
    const apply = (w: number) => main.style.setProperty('--sidebar-w', `min(${w}px, max(300px, 100vw - 480px))`);
    const saved = readPref<number>('sidebarWidth', 0);
    if (saved >= 300 && saved <= 640) apply(saved);
    const handle = h('div', { class: 'sidebar-resizer', role: 'separator', 'aria-orientation': 'vertical', title: t('sidebar.resize') });
    let width = 0;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('is-dragging');
    });
    handle.addEventListener('pointermove', (e) => {
      if (!handle.hasPointerCapture(e.pointerId)) return;
      width = Math.round(Math.max(300, Math.min(640, main.getBoundingClientRect().right - e.clientX)));
      apply(width);
    });
    const end = (e: PointerEvent) => {
      if (!handle.hasPointerCapture(e.pointerId)) return;
      handle.releasePointerCapture(e.pointerId);
      handle.classList.remove('is-dragging');
      if (width) writePref('sidebarWidth', width);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    main.append(handle);
    this.resizerEl = handle;
  }

  /** The tools of one work mode (`prefix` names their ids, e.g. `mode-draw`). */
  private toolRow(prefix: string, label: string, tools: Array<{ value: string; icon: string; name: string; key: string }>): ToolRow {
    const buttons = tools.map((tool) => {
      const b = h(
        'button',
        { type: 'button', class: 'tool-btn', role: 'radio', id: `${prefix}-${tool.value}`, 'data-value': tool.value, 'aria-checked': 'false', 'aria-label': `${tool.name} (${tool.key})`, onclick: () => this.setTool(tool.value) },
        icon20(tool.icon),
        h('span', { class: 'tool-name' }, tool.name),
        h('span', { class: 'tool-key', 'aria-hidden': 'true' }, tool.key),
      );
      tip(b, tool.name, tool.key);
      return b;
    });
    const el = h('div', { class: 'tool-group', role: 'radiogroup', 'aria-label': label }, ...buttons);
    const set = (v: string) => buttons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === v)));
    set(this.tools?.activeId ?? 'select');
    return { el, set };
  }

  private buildToolbar(): void {
    clear(this.toolbarEl);
    const select = { value: 'select', icon: ICONS20.select, name: t('mode.select'), key: 'V' };
    this.modeSeg = this.toolRow('mode', t('appMode.annotate'), [
      select,
      { value: 'axis', icon: ICONS20.axis, name: t('tool.axis'), key: 'T' },
      { value: 'draw', icon: ICONS20.arrow, name: t('mode.draw'), key: 'A' },
      { value: 'curve', icon: ICONS20.curve, name: t('mode.curve'), key: 'P' },
      { value: 'working-edge', icon: ICONS20.workingEdge, name: t('tool.workingEdge'), key: 'W' },
      { value: 'region', icon: ICONS20.region, name: t('tool.region'), key: 'R' },
      { value: 'relation', icon: ICONS20.relation, name: t('tool.relation'), key: 'B' },
      { value: 'sequence', icon: ICONS20.sequence, name: t('tool.sequence'), key: 'Q' },
      { value: 'landmark', icon: ICONS20.landmark, name: t('tool.landmark'), key: 'K' },
    ]);
    this.measureSeg = this.toolRow('measure-tool', t('appMode.measure'), [select, ...MEASURE_TOOLS.map(([value, key, k, ic]) => ({ value, icon: ic, name: t(key), key: k }))]);
    this.presentSeg = this.toolRow('present-tool', t('appMode.present'), [select, { value: 'section', icon: ICONS20.section, name: t('tool.section'), key: 'X' }]);
    this.snapSeg = segmented('snap', null, SNAP_MODES.map((m) => ({ value: m, label: t(`snap.${m}`) })), this.display.curveSnap, (v) =>
      this.setDisplay((d) => (d.curveSnap = v as SnapMode), 'snap'),
    );
    this.snapSeg.el.setAttribute('aria-label', t('snap.label'));
    this.snapEl = h('div', { class: 'tb-snap', id: 'snap-control' }, icon(ICONS.magnet), this.snapSeg.el);
    tip(this.snapEl, t('snap.label'), 'S');
    this.toolSep = h('span', { class: 'tb-sep', 'aria-hidden': 'true' });
    const fit = h('button', { type: 'button', class: 'tool-btn', id: 'btn-fit', 'aria-label': `${t('view.fit')} (H)`, onclick: () => this.viewer?.viewAll(true) }, icon20(ICONS20.fit), h('span', { class: 'tool-key', 'aria-hidden': 'true' }, 'H'));
    tip(fit, t('view.fit'), 'H');
    // a flake: the dorsal face toward the viewer, the platform down
    const orient = h('button', { type: 'button', class: 'tool-btn', id: 'btn-orient', 'aria-label': `${t('view.orient')} (F)`, onclick: () => this.orientToAxis() }, icon20(ICONS20.orient), h('span', { class: 'tool-key', 'aria-hidden': 'true' }, 'F')) as HTMLButtonElement;
    tips.attach(orient, () => ({ label: t(this.store.state.flake.axis?.matrix ? 'view.orient' : 'view.orientNone'), key: 'F' }));
    this.orientBtn = orient;
    this.toolbarEl.append(this.modeSeg.el, this.measureSeg.el, this.presentSeg.el, this.toolSep, fit, orient, this.snapEl);
    // the sequences, under the toolbar while the sequence tool is in use
    const bar = h('div', { class: 'viewport-ui vp-seqbar', id: 'sequence-bar', role: 'radiogroup', 'aria-label': t('sequence.title'), hidden: true });
    if (this.sequenceBarEl) this.sequenceBarEl.replaceWith(bar);
    else this.viewportEl.append(bar);
    this.sequenceBarEl = bar;
    this.updateToolbar();
  }

  /** Tools of the current work mode only (the compare mode has none, only the full view). */
  private updateToolbar(): void {
    const annotate = this.mode === 'annotate';
    if (this.modeSeg) {
      this.modeSeg.el.hidden = !annotate;
      // a flake's own tools
      const flake = this.isFlake();
      for (const id of ['mode-axis', 'mode-working-edge']) {
        const b = this.modeSeg.el.querySelector<HTMLElement>(`#${id}`);
        if (b) b.hidden = !flake;
      }
      // scars' relations: not on a generic specimen
      for (const id of ['mode-relation', 'mode-sequence']) {
        const b = this.modeSeg.el.querySelector<HTMLElement>(`#${id}`);
        if (b) b.hidden = this.isGeneric();
      }
    }
    if (this.measureSeg) this.measureSeg.el.hidden = this.mode !== 'measure';
    if (this.presentSeg) this.presentSeg.el.hidden = this.mode !== 'present';
    // the retouch mode belongs to flakes
    const modeBtn = this.header?.querySelector<HTMLElement>('#app-mode-retouch');
    if (modeBtn) modeBtn.hidden = !this.isFlake();
    // (the retouch mode has its one tool always on: no button for it)
    if (this.toolSep) this.toolSep.hidden = this.mode === 'compare' || this.mode === 'retouch';
    if (this.orientBtn) {
      this.orientBtn.hidden = !this.isFlake() || this.mode === 'compare';
      this.orientBtn.disabled = !this.store.state.flake.axis?.matrix;
    }
    if (this.snapEl) this.snapEl.hidden = !annotate || !['curve', 'landmark', 'axis'].includes(this.tools?.activeId ?? '');
    this.updateSequenceBar();
  }

  /** The sequence tool's bar: Q1, Q2 … with their colour and number of scars, the current one marked, then "+". */
  private updateSequenceBar(): void {
    const bar = this.sequenceBarEl;
    if (!bar) return;
    const shown = this.mode === 'annotate' && this.tools?.activeId === 'sequence' && this.hasMesh();
    bar.hidden = !shown;
    if (!shown) return;
    const seqs = this.store.state.sequences;
    if (!seqs.some((q) => q.id === this.currentSequence)) this.currentSequence = seqs[seqs.length - 1]?.id ?? null;
    clear(bar);
    seqs.forEach((q, i) => {
      const b = h(
        'button',
        { type: 'button', class: 'seq-chip', role: 'radio', 'data-id': q.id, 'aria-checked': String(q.id === this.currentSequence), 'aria-label': `${q.label} · ${t('sequence.members', { n: q.scarIds.length })}`, onclick: () => this.setCurrentSequence(q.id) },
        h('span', { class: 'chip', style: `--chip:${sequenceSwatch(i)}` }),
        h('span', { class: 'seq-chip-label mono' }, q.label),
        h('span', { class: 'seq-chip-count mono' }, String(q.scarIds.length)),
        i < 9 ? h('span', { class: 'tool-key', 'aria-hidden': 'true' }, String(i + 1)) : null,
      );
      tip(b, `${q.label} · ${t('sequence.members', { n: q.scarIds.length })}`, i < 9 ? String(i + 1) : undefined);
      bar.append(b);
    });
    const add = h('button', { type: 'button', class: 'seq-chip seq-add', id: 'sequence-bar-add', 'aria-label': `${t('sequence.new')} (N)`, onclick: () => this.newSequence() }, icon20(ICONS20.plus), h('span', { class: 'tool-key', 'aria-hidden': 'true' }, 'N'));
    tip(add, t('sequence.new'), 'N');
    bar.append(add);
    // just under the toolbar, which may have wrapped onto two lines
    bar.style.top = `${this.toolbarEl.offsetTop + this.toolbarEl.offsetHeight + 8}px`;
  }

  private setCurrentSequence(id: string): void {
    this.currentSequence = id;
    this.updateSequenceBar();
  }

  /** A new sequence (after the others), made current. */
  private newSequence(): void {
    if (!this.hasMesh()) return;
    this.currentSequence = addSequence(this.store).id;
    this.updateSequenceBar();
  }

  /** Sequence tool: a click puts the scar into the current sequence, or takes it out when it is there. */
  private toggleInSequence(scarId: string): void {
    const seqs = this.store.state.sequences;
    const q = seqs.find((x) => x.id === this.currentSequence) ?? null;
    if (!q) {
      // no sequence yet: the first click starts one
      this.currentSequence = addSequence(this.store, [scarId]).id;
      this.updateSequenceBar();
      return;
    }
    setScarSequence(this.store, scarId, q.scarIds.includes(scarId) ? null : q.id);
  }

  /** What a new specimen is: the card chosen on the start page (or the type last set), else what the last specimen was. */
  private newSpecimenType(fallback: SpecimenType = 'core'): SpecimenType {
    const pref = readPref<string>('specimenType', fallback);
    return SPECIMEN_TYPES.find((x) => x === pref) ?? fallback;
  }

  /** The empty view: open a model (or a folder, or a project); dropping a file works too. */
  private buildEmptyView(): void {
    clear(this.emptyEl);
    this.emptyEl.append(
      h('button', { type: 'button', class: 'btn btn-primary btn-lg', id: 'empty-open', onclick: () => this.meshInput.click() }, icon(ICONS.open), t('header.openMesh')),
      h(
        'div',
        { class: 'vp-empty-row' },
        h('button', { type: 'button', class: 'btn', id: 'empty-open-folder', onclick: () => void this.openFolder() }, t('header.openFolder')),
        h('button', { type: 'button', class: 'btn', id: 'empty-open-project', onclick: () => this.openProject() }, t('header.openProject')),
      ),
      h('span', { class: 'vp-empty-formats mono' }, 'PLY · STL · OBJ'),
    );
  }

  /** A card of the start page: what a new model will be, and on into the workspace. */
  private enterModule(type: SpecimenType): void {
    writePref('specimenType', type);
    this.entered = true;
    this.updateMeshDependentUi();
  }

  /** The start page until a module is chosen; a model dropped on it, or a folder open, leave it too. */
  private startShown(): boolean {
    return !this.entered && !this.hasMesh() && !this.workspace;
  }

  private updateStartPage(): void {
    const shown = this.startShown();
    this.startEl.hidden = !shown;
    // it has the whole window: nothing under it takes the focus, or the keys
    this.header.hidden = shown;
    this.mainEl.inert = shown;
    this.emptyEl.hidden = shown || this.hasMesh() || !!this.workspace;
    if (shown !== this.startOnScreen) {
      this.startOnScreen = shown;
      if (shown) this.startPage.show(this.newSpecimenType());
      else this.startPage.leave();
    }
    // a file dragged in is dropped on whichever is in front
    (shown ? this.startEl : this.viewportEl).append(this.dropEl);
  }

  /** What the specimen has of what it is annotated with, as pills over the view; a click goes to where it is made. */
  private updateStatus(): void {
    const el = this.statusEl;
    const st = this.store.state;
    if (!st.mesh) {
      el.hidden = true;
      this.statusKey = '';
      return;
    }
    // (regions not found yet count as not there)
    const status = annotationStatus(st, this.regions?.results ?? [], this.gm);
    const key = JSON.stringify([status.items, this.nextCurveType]);
    el.hidden = false;
    if (key === this.statusKey) return;
    const counted = this.statusKey.length > 0;
    this.statusKey = key;
    const armed = this.nextCurveType;
    clear(el);
    const toggle = h('button', { type: 'button', class: 'status-pill status-count mono', id: 'status-count', 'aria-expanded': String(el.classList.contains('is-open')), onclick: () => this.toggleStatus() }, `${status.done}/${status.total}`);
    el.append(toggle);
    for (const item of status.items) {
      const pill = h(
        'button',
        {
          type: 'button',
          class: `status-pill${item.optional ? ' is-optional' : ''}${armed && armed === STATUS_CURVE_TYPES[item.key] ? ' is-armed' : ''}`,
          id: `status-${item.key}`,
          'data-done': String(item.done),
          onclick: () => this.goToStatus(item.key),
        },
        h('span', { class: 'status-mark', 'aria-hidden': 'true' }, item.done ? '✓' : '○'),
        h('span', {}, t(`status.${item.key}`)),
      );
      tips.attach(pill, () => ({ label: item.flagged ? t('gm.flagged', { n: item.flagged }) : t(item.notApart ? 'status.why.faces.open' : item.notMeeting ? 'status.why.edge.open' : item.key === 'unit' && !this.isFlake() ? 'status.why.unit.plain' : `status.why.${item.key}`) }), 'above');
      el.append(pill);
    }
    this.fitStatus();
    // the folder's list says the same of the open model
    if (counted && this.workspace) this.sidebar.refresh('workspace');
  }

  /** A narrow view shows the count alone, the pills on hovering over it or clicking it. */
  private fitStatus(): void {
    const narrow = this.viewportEl.clientWidth < STATUS_COLLAPSE_PX;
    this.statusEl.classList.toggle('is-collapsed', narrow);
    if (!narrow) this.setStatusOpen(false);
  }

  private setStatusOpen(open: boolean): void {
    this.statusEl.classList.toggle('is-open', open);
    this.statusEl.querySelector('#status-count')?.setAttribute('aria-expanded', String(open));
  }

  /** (Open already while the pointer is over them: a click leaves them so.) */
  private toggleStatus(): void {
    if (!this.statusHovered) this.setStatusOpen(!this.statusEl.classList.contains('is-open'));
  }

  private takeNextCurveType(): string | null {
    const type = this.nextCurveType;
    this.nextCurveType = null;
    if (type) this.updateStatus();
    return type;
  }

  /** To the annotate mode and where the missing thing is made. */
  private goToStatus(key: StatusKey): void {
    this.setMode('annotate');
    // an edge not reaching the outline: that edge, to move its ends
    const st = this.store.state;
    if (key === 'edge' && annotationStatus(st, this.regions?.results ?? []).items.find((i) => i.key === 'edge')?.notMeeting) {
      this.setTool('select');
      this.selection.set(st.curves.find((c) => c.attributes.type === 'edge')?.id ?? null);
      return;
    }
    const curveType = STATUS_CURVE_TYPES[key];
    if (curveType) {
      this.setTool('curve');
      this.nextCurveType = curveType;
      this.updateStatus();
      return;
    }
    if (key === 'unit') return this.openUnit();
    if (key === 'axis') return this.setTool('axis');
    if (key === 'scar_arrows') return this.setTool('draw');
    if (key === 'gm') return this.sidebar.focusSection('gm');
    // the faces and the retouch regions
    this.setTool('region');
    this.sidebar.focusTool('region');
  }

  private rebuildChrome(): void {
    const newHeader = this.buildHeader();
    this.header.replaceWith(newHeader);
    this.header = newHeader;
    const newSidebar = buildSidebar(this);
    const scroll = this.sidebar.el.scrollTop;
    this.sidebar.el.replaceWith(newSidebar.el);
    this.sidebar = newSidebar;
    if (this.tools?.activeId) newSidebar.focusTool(this.tools.activeId);
    newSidebar.el.scrollTop = scroll;
    if (this.resizerEl) this.resizerEl.title = t('sidebar.resize');
    this.buildToolbar();
    this.startPage.paint();
    this.buildEmptyView();
    this.buildHarrisPanel();
    this.buildConfigPanel();
    this.buildProfilePanel();
    this.buildRetouchPanels();
    this.buildDisplayControl();
    this.updateSpecimenBar();
    this.statusKey = '';
    this.updateUndoButtons();
    this.updateMeshDependentUi();
    this.updateCursor();
    this.queueCoords();
  }

  private updateUndoButtons(): void {
    const hst = this.store.history;
    this.undoBtn.disabled = !hst.canUndo;
    this.redoBtn.disabled = !hst.canRedo;
  }

  private updateMeshDependentUi(): void {
    const has = this.hasMesh();
    this.updateStartPage();
    this.updateStatus();
    if (this.appModeSeg) this.appModeSeg.el.hidden = !has;
    this.toolbarEl.hidden = !has;
    this.saveBtn.disabled = !has;
    // (the empty view closes too, back to the choice of module)
    if (this.closeItem) this.closeItem.disabled = !has && !!this.workspace;
    // File stays quiet (without a model the main button is the view's "Open model"); with one, Save is the main button
    this.saveBtn.classList.toggle('btn-primary', has);
    this.saveBtn.classList.toggle('btn-quiet', !has);
    if (this.displayCtl) this.displayCtl.hidden = !has;
    this.updateSpecimenBar();
    this.sidebar.refresh('mesh');
    this.updateHarris();
    this.updateConfigPanel();
    this.updateProfile();
  }

  private updateCursor(): void {
    const tools = this.tools;
    if (!tools) return;
    const tool = tools.activeTool;
    let cursor = tool ? tool.cursor() : 'default';
    if (tools.navigating) cursor = 'grab';
    if (tools.adjustingLight) cursor = 'crosshair';
    this.viewportEl.style.cursor = cursor;
    // (the placing tools click through the labels)
    this.viewportEl.dataset.tool = tools.activeId ?? '';
    this.modeSeg?.set(tools.activeId ?? 'select');
    this.measureSeg?.set(tools.activeId ?? 'select');
    this.presentSeg?.set(tools.activeId ?? 'select');
    this.updateToolbar();
  }

  private queueCoords(): void {
    if (this.coordsQueued) return;
    this.coordsQueued = true;
    requestAnimationFrame(() => {
      this.coordsQueued = false;
      const hit = this.lastHover;
      const m = this.store.state.mesh;
      clear(this.coordEl);
      if (hit) {
        // three right-aligned columns of fixed width, so the reading does not jump
        const u = quantityUnit('coord', this.store.state.specimen.unit);
        for (const [k, v] of [['x', hit.point.x], ['y', hit.point.y], ['z', hit.point.z]] as const)
          this.coordEl.append(h('span', { class: 'coord-k' }, k), h('span', { class: 'coord-v' }, fmtQuantity('coord', v)));
        if (u) this.coordEl.append(h('span', { class: 'unit' }, ` ${u}`));
      } else if (m) {
        this.coordEl.textContent = t('status.mesh', { v: fmtCount(m.vertexCount), t: fmtCount(m.triangleCount) });
      }
    });
  }

  // ------------------------------------------------------------ state → view

  private onStoreChange(c: Change): void {
    const sel = this.selection.id;
    this.edgeDetails = null;
    if (sel && this.store.state.flake.axis?.id !== sel && !this.store.scar(sel) && !this.store.curve(sel) && !this.store.workingEdge(sel) && !this.store.measurement(sel) && !this.store.plane(sel) && !this.store.section(sel) && !this.store.region(sel) && !this.store.relation(sel) && !this.store.sequence(sel) && !this.store.landmark(sel) && !this.store.semilandmarkSet(sel))
      this.selection.set(null);
    if (['landmarks', 'curves', 'reset', 'specimen', 'flake'].includes(c.kind)) this.landmarks = landmarkTable(this.store.state);
    if (c.kind === 'landmarks') this.rememberLandmarkNames();
    if (c.kind === 'reset') this.names = null;
    if (['scars', 'relations', 'sequences', 'reset'].includes(c.kind)) {
      // the problem list closes once there is nothing in it
      const n = relationProblems(this.relationChecks()).length;
      if (n === 0) this.problemsOpen = false;
      if (this.focusedProblem !== null && this.focusedProblem >= n) this.focusedProblem = null;
      if (c.kind !== 'scars') this.paintRegions();
      this.updateHarris();
    }
    if (c.kind !== 'measurements' && c.kind !== 'specimen') this.updatePlanes();
    if (c.kind === 'sections' || c.kind === 'reset') this.updateSections();
    if (c.kind === 'curves' || c.kind === 'reset') this.updatePartition();
    // (a plane's regions: its fit)
    else if (c.kind === 'regions' || c.kind === 'scars' || c.kind === 'planes') this.resolveRegionsNow();
    if (c.kind === 'nodule') this.updateNodule();
    // only the swap of upper and lower changed: no need to compute the split again
    if (['split', 'planes', 'curves', 'scars', 'reset'].includes(c.kind)) this.updateSplit(c.kind === 'split');
    // the frame (specimen) changes the box: updateAuto below
    if (['scars', 'configuration', 'reset', 'specimen'].includes(c.kind)) this.updateConfiguration();
    if (c.kind === 'specimen' || c.kind === 'reset') {
      // the retouch mode belongs to flakes: a specimen turned into a core goes back to measuring, a core opened to annotating
      if (this.mode === 'retouch' && !this.isFlake()) this.setMode(c.kind === 'reset' ? 'annotate' : 'measure', c.kind !== 'reset');
      else if (c.kind === 'reset' && this.isFlake() && readPref<string>('mode', '') === 'retouch') this.setMode('retouch', false);
      this.updateToolbar();
      this.updateRetouch();
      // a flake's tools belong to flakes, the scars' relations not to a generic specimen
      if (!this.isFlake() && ['axis', 'working-edge'].includes(this.tools?.activeId ?? '')) this.setTool('select');
      if (this.isGeneric() && ['relation', 'sequence'].includes(this.tools?.activeId ?? '')) this.setTool('select');
      if (!this.isFlake() && this.tools) this.selection.set(this.store.landmark(this.selection.id ?? '')?.code || this.store.state.flake.axis?.id === this.selection.id || this.store.workingEdge(this.selection.id ?? '') ? null : this.selection.id);
      if (this.isGeneric() && this.selection.id && (this.store.relation(this.selection.id) || this.store.sequence(this.selection.id))) this.selection.set(null);
      this.paintRegions();
    }
    // technical axis, platform outline, platform region or ends: measured again
    // (of the specimen's details, its type and unit count)
    const specimenKey = `${this.store.state.specimen.type}|${this.store.state.specimen.unit}`;
    const specimenCounts = c.kind === 'specimen' && specimenKey !== this.specimenKey;
    // another specimen or another type: what was shown of a measure goes, fixed or not
    if (c.kind === 'reset' || (specimenCounts && !this.specimenKey.startsWith(`${this.store.state.specimen.type}|`))) this.clearHints();
    this.specimenKey = specimenKey;
    if (['flake', 'landmarks', 'regions', 'reset'].includes(c.kind) || specimenCounts) this.scheduleFlake();
    // a flake has a platform outline to follow, a core does not
    if (specimenCounts) {
      this.updatePartition();
      this.scheduleEdgeAngles();
      this.updateSplit();
    }
    if (c.kind === 'curves' || c.kind === 'reset') this.scheduleEdgeAngles();
    if (['flake', 'specimen', 'reset'].includes(c.kind)) this.scheduleRetouchIndices();
    if (c.kind === 'sharpEdge') this.keepFolderSharp();
    if (c.kind === 'gm') this.keepFolderGm();
    if (['gm', 'flake', 'landmarks', 'specimen', 'reset'].includes(c.kind)) this.scheduleGm();
    this.syncAnnotations();
    const map: Record<Change['kind'], RefreshKind> = { gm: 'landmarks', sharpEdge: 'edge', flake: 'flake', scars: 'arrows', curves: 'curves', workingEdges: 'curves', measurements: 'measurements', planes: 'planes', sections: 'sections', regions: 'regions', relations: 'relations', sequences: 'sequences', landmarks: 'landmarks', nodule: 'nodule', split: 'split', configuration: 'configuration', specimen: 'specimen', reset: 'all' };
    this.sidebar.refresh(map[c.kind]);
    if (c.kind === 'curves' || c.kind === 'reset') this.sidebar.refresh('landmarks');
    if (c.kind === 'workingEdges' || c.kind === 'curves' || c.kind === 'sharpEdge') {
      // what is measured on them, and what shows the station's
      this.sidebar.refresh('retouch');
      if (this.retouching()) {
        this.queueStation();
        this.drawPlan();
      }
    }
    if (c.kind === 'specimen') {
      this.sidebar.refresh('arrows');
      this.sidebar.refresh('curves');
      this.sidebar.refresh('measurements');
    }
    if (c.kind === 'flake') {
      this.updateSpecimenBar();
      this.updateToolbar();
    }
    if (c.kind === 'specimen' || c.kind === 'reset') {
      this.updateSpecimenBar();
      this.updateAuto();
      this.sidebar.refresh('figure');
      this.sidebar.refresh('workspace');
    }
    if (['scars', 'sequences', 'reset'].includes(c.kind)) this.updateSequenceBar();
    this.relationChip?.update();
    const wasUnsaved = this.unsaved;
    this.unsaved = c.kind !== 'reset';
    // a read-only folder: the first edit makes something to download
    if (this.unsaved && !wasUnsaved && this.workspace && !this.workspace.writable) this.sidebar.refresh('workspace');
    if (c.kind !== 'reset') {
      this.scheduleAutosave();
      this.scheduleFolderSave();
    }
    this.scheduleAgreement();
    this.queueCoords();
    this.updateStatus();
    this.refreshHint();
  }

  // ------------------------------------------------------------ how a measure was taken

  hoverHint(key: string | null): void {
    clearTimeout(this.hintTimer);
    if (key !== this.hintMuted) this.hintMuted = null;
    if (key === null || key === this.hintMuted) {
      if (this.hintHover === null) return;
      this.hintHover = null;
      this.syncHint();
      return;
    }
    if (key === this.hintHover) return;
    this.hintTimer = window.setTimeout(() => {
      this.hintHover = key;
      this.syncHint();
    }, MEASURE_HINT_PARAMETERS.HOVER_MS);
  }

  focusHint(key: string | null): void {
    if (key === this.hintFocus) return;
    this.hintFocus = key;
    this.syncHint();
  }

  pinHint(key: string): void {
    // (a click on a curve's row selects the curve: its colours and chart are what is wanted then)
    if (key.startsWith('edge:')) return;
    clearTimeout(this.hintTimer);
    if (this.hintPinned === key) {
      this.letGoOfPin();
      if (this.hintFocus === key) this.hintFocus = null;
    } else this.hintPinned = key;
    this.syncHint();
  }

  /** Esc: what is fixed goes. Whether there was anything to let go. */
  private unpinHint(): boolean {
    if (!this.hintPinned) return false;
    clearTimeout(this.hintTimer);
    this.letGoOfPin();
    this.syncHint();
    return true;
  }

  /** What is fixed goes, and with the pointer on its row it does not come straight back. */
  private letGoOfPin(): void {
    if (this.hintHover === this.hintPinned) {
      this.hintMuted = this.hintPinned;
      this.hintHover = null;
    }
    this.hintPinned = null;
  }

  private clearHints(): void {
    clearTimeout(this.hintTimer);
    this.hintHover = this.hintFocus = this.hintPinned = this.hintMuted = null;
    this.syncHint();
  }

  /** What it was drawn from changed: drawn again. */
  private refreshHint(): void {
    if (this.hintHover ?? this.hintFocus ?? this.hintPinned) this.syncHint();
  }

  /** What is asked for, drawn from what the measures returned; nothing where a value is empty. */
  private syncHint(): void {
    const layer = this.hintLayer, loaded = this.loaded;
    const key = this.hintHover ?? this.hintFocus ?? this.hintPinned;
    const hint = key && layer && loaded ? this.hintOf(key) : null;
    this.hintShown = key && hint ? { key, hint } : null;
    if (hint) {
      const css = getComputedStyle(document.documentElement);
      const colour = (name: string) => css.getPropertyValue(name).trim();
      layer!.show(hint, { current: colour('--accent'), other: colour('--hint-other'), otherHalo: colour('--hint-other-halo') }, loaded!.offset, loaded!.geometry.getAttribute('position') as THREE.BufferAttribute, loaded!.geometry.index!);
    } else layer?.clear();
    this.paintHintRows();
  }

  /** Which rows of measures are shown and fixed. */
  paintHintRows(): void {
    if (!this.sidebar) return;
    const shown = this.hintShown?.key ?? null;
    for (const el of this.sidebar.el.querySelectorAll<HTMLElement>('[data-hint]')) {
      el.classList.toggle('is-hinted', el.dataset.hint === shown);
      el.classList.toggle('is-pinned', el.dataset.hint === this.hintPinned);
    }
  }

  /** The drawing of a row of the measure mode (`group:item`). */
  private hintOf(key: string): MeasureHint | null {
    const loaded = this.loaded;
    if (this.mode !== 'measure' || !loaded) return null;
    const st = this.store.state;
    const unit = st.specimen.unit;
    const at = key.indexOf(':');
    const group = key.slice(0, at), item = key.slice(at + 1);
    const whole = (item === 'area' && !!this.auto) || (item === 'volume' && this.auto?.volume != null);
    switch (group) {
      case 'flake':
        if (item === 'area' || item === 'volume') return whole ? wholeModelHint() : null;
        return this.flake && this.isFlake() ? flakeHint(item as FlakeMeasure, this.flake, unit) : null;
      case 'auto': {
        if (item === 'area' || item === 'volume') return whole ? wholeModelHint() : null;
        const a = this.auto;
        return a && this.configBox ? boxHint(item as 'length' | 'width' | 'thickness', this.configBox, { length: a.length, width: a.width, thickness: a.thickness }, unit) : null;
      }
      case 'split': {
        const parts = this.split ? this.splitRaw?.value?.parts : null;
        return parts && this.viewer ? splitHint(parts, !!st.split?.swap, loaded.offset, this.viewer.diagonal) : null;
      }
      case 'edge': {
        const c = this.store.curve(item), r = this.edgeAngleResult(item);
        return c && r ? stationsHint(this.lineOf(c), r.stations) : null;
      }
      case 'sharp': {
        const c = this.store.curve(item), r = this.edgeAngleResult(item), s = this.sharpOf(item);
        return c && r && s ? sharpHint(this.lineOf(c), r.stations, s, unit) : null;
      }
      case 'nodule':
        return this.nodule ? noduleHint(this.nodule, unit) : null;
    }
    return null;
  }

  /** The sequence tool is in use: arrows and scar regions are coloured by sequence, the scars in none faded. */
  private sequencing(): boolean {
    return this.mode === 'annotate' && this.tools?.activeId === 'sequence';
  }

  /** Scars in no sequence (faded while sequencing). */
  private unsequenced(): Set<string> {
    const st = this.store.state;
    const inSeq = new Set(st.sequences.flatMap((q) => q.scarIds));
    return new Set(st.scars.filter((s) => !inSeq.has(s.id)).map((s) => s.id));
  }

  /** Scars not on the picked face or cone of the configuration (faded while it is picked), or null. */
  private offFace(): Set<string> | null {
    const r = this.configResult;
    const pick = this.pickedFace;
    if (!pick || !r || this.mode !== 'annotate') return null;
    const off = isBicone(r) ? r.scars.filter((s) => s.cone !== pick) : r.scars.filter((s) => s.face !== pick);
    return new Set(off.map((s) => s.id));
  }

  // ------------------------------------------------------------ volumetric configuration

  /** Recompute the configuration (cheap) from the scars, the corrections and the box or the volume split; show it in the panel, the sketch and the cube. */
  private updateConfiguration(): void {
    const st = this.store.state;
    // a core's: a flake's data do not go through it
    this.configResult = this.isCore() ? coreConfiguration(st, this.configBox, this.split) : null;
    // a face of the box with the bicone, or a cone with the box: let go
    if (this.pickedFace && !this.pickFits(this.pickedFace)) this.pickedFace = null;
    this.updateConfigPanel();
    this.sidebar.refresh('configuration');
  }

  /** A face with the box, a cone with the bicone. */
  private pickFits(pick: ConfigPick): boolean {
    const r = this.configResult;
    const cone = pick === 'upper' || pick === 'lower';
    return !!r && cone === isBicone(r);
  }

  configStatus(): ConfigStatus | null {
    const st = this.store.state;
    if (!this.isCore() || st.configuration.model !== 'bicone' || this.configResult || !this.hasMesh()) return null;
    if (!this.measureBase || this.splitBusy) return 'computing';
    return this.measureBase.topology.closed === false ? 'not_closed' : 'split_invalid';
  }

  splitUpHint(curveId: string): Vec3 {
    const c = this.store.curve(curveId);
    return defaultUpHint(c?.points ?? [], this.store.state.scars, this.towardViewer());
  }

  useEdgeCurve(curveId: string): void {
    const st = this.store.state;
    const c = this.store.curve(curveId);
    if (!c?.closed) return;
    const sp = st.split;
    if (sp?.source === 'curve' && sp.id === curveId) return setConfigModel(this.store, 'bicone');
    const split = { source: 'curve' as const, id: curveId, upHint: this.splitUpHint(curveId), swap: false };
    if (st.configuration.model === 'bicone') setSplit(this.store, split);
    else setBiconeSplit(this.store, split);
    // a plane's split has gone: say so, once
    if (sp?.source === 'plane') this.feedback.toast(t('split.replaced', { curve: c.label }), 'info', 4000);
  }

  /** The points of the closed curve the volume is split along (the bicone's base), or null. */
  private splitCurvePoints(): Vec3[] | null {
    const sp = this.store.state.split;
    return sp?.source === 'curve' ? (this.store.curve(sp.id)?.points ?? null) : null;
  }

  /** The configuration panel and the view cube are shown: switched on, in the annotate mode, with a scar with an arrow. */
  private configShown(): boolean {
    return this.display.configuration && this.mode === 'annotate' && this.hasMesh() && this.isCore() && this.store.state.scars.some(hasVector);
  }

  /** Show or hide the configuration panel (and the cube); hidden, it lets go of the picked face. */
  private updateConfigPanel(): void {
    const shown = this.configShown();
    const el = this.configEl;
    if (el) {
      const was = !el.hidden;
      el.hidden = !shown;
      if (shown && !was) this.configFit?.();
    }
    if (!shown && this.pickedFace) this.selectConfigFace(null);
    else this.syncConfigViews();
  }

  private syncConfigViews(): void {
    this.viewCube?.set(this.configResult, this.pickedFace, this.configShown());
    this.sketch?.set(this.configResult, this.store.state.scars, this.pickedFace, this.selectedScar(), this.splitCurvePoints());
  }

  /** The volumetric configuration's panel over the view (made as the Harris matrix's), holding the sidebar's configuration content. */
  private buildConfigPanel(): void {
    const panel = floatingPanel({
      id: 'config',
      title: t('sec.configuration'),
      pref: 'configPanel',
      area: this.viewportEl,
      extras: [this.sidebar.configPill],
      onClose: () => this.setDisplay((d) => (d.configuration = false), 'configuration'),
      // folded, it lets go of the picked face (the arrows come back)
      onFold: (folded) => {
        if (folded && this.pickedFace) this.selectConfigFace(null);
      },
    });
    panel.body.append(this.sidebar.configEl);
    if (this.configEl) this.configEl.replaceWith(panel.el);
    else this.viewportEl.append(panel.el);
    this.configEl = panel.el;
    this.configFit = panel.fit;
    this.updateConfigPanel();
  }

  configuration(): CoreConfiguration | null {
    return this.configResult;
  }

  configFace(): ConfigPick | null {
    return this.pickedFace;
  }

  fitConfigPanel(): void {
    this.configFit?.();
  }

  selectConfigFace(face: ConfigPick | null, turn = false): void {
    if (face && !this.pickFits(face)) return;
    this.pickedFace = face;
    if (face && turn) this.viewConfigFace(face);
    this.syncConfigViews();
    this.syncAnnotations();
    this.sidebar.refresh('configuration');
  }

  /**
   * Turn the view to a face of the box, square on, as the standard view of that side shows it;
   * to a cone of the bicone, along the normal of its base from that cone's side, with the base's reference up.
   */
  private viewConfigFace(pick: ConfigPick): void {
    const r = this.configResult;
    if (!r || !this.viewer) return;
    if (isBicone(r)) {
      const n = r.plane.normal;
      this.viewer.viewFrom(pick === 'lower' ? [-n[0], -n[1], -n[2]] : n, r.reference, undefined, undefined, true);
      return;
    }
    const [x, y, z] = r.axes;
    const { toward, up } = viewAxes(pick as ConfigFace, { x, y, z });
    this.viewer.viewFrom(toward, up, undefined, undefined, true);
  }

  completingLoop(): boolean {
    return this.completing !== null;
  }

  /**
   * Carry an open curve on round the model's edge until it closes ("Complete loop"): the outline
   * points snapped to the ridges and traced along them, one undo step; or a message why not,
   * with the curve left as it was.
   */
  completeLoop(id: string): void {
    const c = this.store.curve(id);
    const snap = this.surfaceSnap;
    const loaded = this.loaded;
    if (!c || c.closed || c.anchors.length < 3 || !snap || !loaded || this.completing) return;
    this.completing = id;
    this.sidebar.refresh('curves');
    const unchanged = () => this.surfaceSnap === snap && this.store.curve(id) === c;
    void (async () => {
      try {
        const ridge = await snap.prepare('ridge');
        if (!ridge && !(await snap.prepare('off'))) return;
        const adjacency = snap.adjacency();
        if (!adjacency || !unchanged()) return;
        const mode: SnapMode = ridge ? 'ridge' : 'off';
        const o = loaded.offset;
        const res = await runSliced(
          completeLoopSteps({
            positions: loaded.geometry.getAttribute('position').array as Float32Array,
            adjacency,
            strength: snap.strength(mode),
            cost: snap.cost(mode),
            points: c.points.map((p): Vec3 => [p[0] - o[0], p[1] - o[1], p[2] - o[2]]),
            first: snap.nearestVertex(c.anchors[0]),
            last: snap.nearestVertex(c.anchors[c.anchors.length - 1]),
            stepDeg: COMPLETE_STEP_DEG,
            anchorStepDeg: COMPLETE_ANCHOR_STEP_DEG,
          }),
        );
        if (!unchanged()) return;
        if (!res.ok) {
          this.feedback.toast(t(COMPLETE_FAILURES[res.reason]), 'warn', 4000);
          return;
        }
        // each traced stretch pulled taut, as the drawing tool does
        const added = await runSliced(
          (function* () {
            const out: Vec3[][] = [];
            for (const chain of res.chains) {
              out.push(snap.refine(chain, mode));
              yield;
            }
            return out;
          })(),
        );
        if (!unchanged()) return;
        const anchors = [...c.anchors, ...res.anchors.map((v) => snap.point(v))];
        const { points, anchorIndex } = assembleCurve([...curveSegments(c), ...added], true);
        const completion = res.anchors.length ? { method: 'outline' as const, firstAutoAnchor: c.anchors.length, stepDeg: COMPLETE_STEP_DEG, anchorStepDeg: COMPLETE_ANCHOR_STEP_DEG } : null;
        completeCurveLoop(this.store, id, { anchors, points, anchorIndex, closed: true }, completion);
      } finally {
        this.completing = null;
        this.sidebar.refresh('curves');
      }
    })();
  }

  customValues(f: FieldDef): string[] {
    // this specimen's first, then the other project files of the folder already read (none is read for this)
    const states = [this.store.state, ...(this.projectIndex?.all() ?? []).map((p) => p.state)];
    const values = REGION_FIELDS.includes(f) ? states.flatMap((s) => s.regions.map((r) => r.type)) : states.flatMap((s) => s.curves.map((c) => c.attributes[f.key]));
    return [...new Set(values.filter((v): v is string => isCustomValue(f, v)))];
  }

  configSketch(): ConfigSketch {
    if (!this.sketch) {
      this.sketch = new ConfigSketch();
      this.sketch.onPick = (face) => this.selectConfigFace(face, true);
      this.sketch.onPickScar = (id) => this.selection.set(id);
      this.sketch.set(this.configResult, this.store.state.scars, this.pickedFace, this.selectedScar(), this.splitCurvePoints());
    }
    return this.sketch;
  }

  private syncAnnotations(): void {
    const handles = this.tools?.activeId === 'select' && this.mode === 'annotate';
    // the measure mode is about measurements: annotations are drawn faded there
    const dim = this.mode === 'measure' || this.mode === 'retouch';
    if (this.arrows) this.arrows.dimmed = dim;
    if (this.curves) this.curves.dimmed = dim;
    if (this.landmarkLayer) this.landmarkLayer.dimmed = dim;
    const axis = this.isFlake() ? this.store.state.flake.axis : null;
    if (this.arrows) this.arrows.axis = axis ? { id: axis.id, label: t('tool.axis'), vector: axis } : null;
    this.arrows?.setHighlight(this.emphasis());
    // the user's own colour setting comes back when the sequence tool is left
    const sequencing = this.sequencing();
    if (this.arrows) this.arrows.faded = sequencing ? this.unsequenced() : this.offFace();
    this.arrows?.sync(this.store.state, this.selection.id, { ...this.display.arrows, colorMode: sequencing ? 'sequence' : this.arrowColorMode() }, handles);
    this.showBorders();
    this.syncEdgeColors();
    if (this.curves) this.curves.drawnElsewhere = this.edgeColorKey ? this.edgeColorCurve : null;
    this.curves?.sync(this.store.state, this.selection.id, this.display.arrows, handles);
    this.syncWorkingEdges();
    this.measures?.sync(this.store.state, this.selection.id, this.mode === 'measure', (m) => `${m.label}  ${this.formatMeasurement(m)}`);
    this.landmarkLayer?.sync(this.labelledLandmarks(), this.landmarks.sets, this.selection.id, this.display.arrows.labels, this.display.arrows.showHidden);
    const mesh = this.store.state.mesh;
    this.sectionLayer?.sync(this.store.state.sections, (id) => this.cuts.get(id)?.lines ?? null, this.selection.id, this.mode === 'present');
    this.applyClipping();
    this.planesLayer?.sync(
      this.store.state.planes,
      this.planes,
      this.selection.id,
      this.mode === 'measure' || (this.mode === 'present' && this.figure.overlays.planes),
      mesh ? { min: mesh.bboxMin, max: mesh.bboxMax } : null,
      (id) => this.cuts.get(id)?.lines ?? null,
    );
    this.syncCompare();
    this.applyLayerVisibility();
    this.occlusionDirty = true;
  }

  /**
   * Which annotation layers the view shows: the present mode follows the figure's overlay
   * switches; the compare mode draws each observer's annotations instead of the open project's.
   */
  private applyLayerVisibility(): void {
    const f = this.figure.overlays;
    const shown = (inFigure: boolean) => (this.mode === 'present' ? inFigure : this.mode !== 'compare');
    if (this.arrows) this.arrows.group.visible = shown(f.arrows);
    if (this.curves) this.curves.group.visible = shown(f.curves);
    if (this.workingEdgeLayer) this.workingEdgeLayer.group.visible = this.mode !== 'present' && this.mode !== 'compare';
    if (this.landmarkLayer) this.landmarkLayer.group.visible = shown(f.landmarks);
    if (this.regionRoot) this.regionRoot.visible = shown(f.regions);
    this.syncGmLayer();
    this.viewer?.requestRender();
  }

  setTool(wanted: string): void {
    // the retouch mode has its one tool
    const id = this.mode === 'retouch' ? 'station' : wanted === 'station' ? 'select' : wanted;
    const changed = id !== this.tools?.activeId;
    if (id !== 'curve' && this.nextCurveType) {
      this.nextCurveType = null;
      this.updateStatus();
    }
    if (changed) {
      this.sidebar.focusTool(id);
      this.relationChip?.close();
      this.harrisAutoOff = false;
    }
    this.tools?.setActive(id);
    this.syncAnnotations();
    this.updateCursor();
    if (changed) {
      // the sequence tool colours by sequence; the relation and sequence tools show the matrix
      this.paintRegions();
      this.updateHarris();
      this.sidebar.refresh('relations');
    }
  }

  /** Switch the work mode. The selection and the undo history are kept. */
  /** `remember`: as the mode to start in (a core sent out of the retouch mode leaves the preference standing). */
  setMode(mode: AppMode, remember = true): void {
    if (mode === this.mode) return;
    if (mode === 'retouch' && !this.isFlake()) return;
    // tools belong to their mode; an unfinished curve is kept (as on Esc)
    this.relationChip?.close();
    this.tools?.activeTool?.clearHover?.();
    this.mode = mode;
    this.clearHints();
    this.setTool(mode === 'retouch' ? 'station' : 'select');
    if (remember) writePref('mode', mode);
    // the picked face belongs to the annotate mode's panel; the panel and the cube show only there
    this.pickedFace = null;
    this.updateConfigPanel();
    this.updateProfile();
    if (mode === 'present') this.viewFrame(false);
    if (mode === 'compare' && this.agreementStale) this.scheduleAgreement();
    this.viewportEl.dataset.mode = mode;
    this.appModeSeg?.set(mode);
    this.updateToolbar();
    this.syncAnnotations();
    this.paintRegions();
    this.showNodule();
    this.updateHarris();
    if (mode === 'retouch') this.stationAuto = true;
    this.updateRetouch();
    this.syncGmLayer();
    this.sidebar.refresh('mode');
  }

  /** On through the modes shown. */
  private cycleMode(): void {
    const shown = APP_MODES.filter((m) => m !== 'retouch' || this.isFlake());
    this.setMode(shown[(shown.indexOf(this.mode) + 1) % shown.length]);
  }

  /** The curve tool re-evaluates what is under the cursor (snap mode or curvature scale changed). */
  private refreshCurveTool(): void {
    const tool = this.tools?.activeTool;
    if (tool instanceof DrawCurveTool) tool.refresh();
  }

  // ------------------------------------------------------------ AppApi

  setDisplay(change: (d: DisplaySettings) => void, aspect: DisplayAspect): void {
    change(this.display);
    writePref('display', this.display);
    switch (aspect) {
      case 'light':
        this.lights?.set(this.display.light);
        this.viewer?.requestRender();
        break;
      case 'shading':
        this.applyShading();
        this.sidebar.refresh('display');
        break;
      case 'curvature':
        // the scale slider can ask for up to 100 passes; wait until it settles
        clearTimeout(this.curvTimer);
        this.curvTimer = window.setTimeout(() => {
          if (this.display.shading === 'curvature') void this.updateCurvatureColors();
          // curves snap at the shading scale
          this.refreshCurveTool();
        }, 120);
        break;
      case 'arrows':
        this.syncAnnotations();
        this.paintRegions();
        this.sidebar.refresh('display');
        this.sidebar.refresh('arrows');
        this.sidebar.refresh('curves');
        break;
      case 'harris':
        this.updateHarris();
        this.sidebar.refresh('display');
        break;
      case 'configuration':
        this.updateConfigPanel();
        this.sidebar.refresh('display');
        break;
      case 'profile':
        this.updateProfile();
        this.sidebar.refresh('display');
        break;
      case 'gm':
        this.syncGmLayer();
        this.sidebar.refresh('display');
        break;
      case 'retouch':
        this.updateRetouch();
        this.sidebar.refresh('display');
        break;
      case 'snap':
        this.snapSeg?.set(this.display.curveSnap);
        this.refreshCurveTool();
        break;
      case 'regions':
        this.paintRegions();
        this.sidebar.refresh('display');
        break;
      default:
        break;
    }
  }

  private cycleSnap(): void {
    const i = SNAP_MODES.indexOf(this.display.curveSnap);
    const next = SNAP_MODES[(i + 1) % SNAP_MODES.length];
    this.setDisplay((d) => (d.curveSnap = next), 'snap');
  }

  hasMesh(): boolean {
    return !!this.store.state.mesh;
  }

  hasScanColors(): boolean {
    return !!this.loaded?.scanColors;
  }

  curvatureBusy(): boolean {
    return this.curvBusy;
  }

  focusArrow(id: string): void {
    const a = this.store.scar(id)?.vector;
    const v = this.viewer;
    if (!a || !v) return;
    this.selection.set(id);
    const mid: Vec3 = [(a.start[0] + a.end[0]) / 2, (a.start[1] + a.end[1]) / 2, (a.start[2] + a.end[2]) / 2];
    const n = [a.startNormal[0] + a.endNormal[0], a.startNormal[1] + a.endNormal[1], a.startNormal[2] + a.endNormal[2]];
    const ln = Math.hypot(n[0], n[1], n[2]);
    const toward: Vec3 = ln > 1e-6 ? [n[0] / ln, n[1] / ln, n[2] / ln] : v.towardViewer();
    const len = Math.hypot(a.end[0] - a.start[0], a.end[1] - a.start[1], a.end[2] - a.start[2]);
    v.viewFrom(toward, v.cameraUp(), mid, Math.max(len * 3.2, v.diagonal * 0.4), true);
  }

  focusCurve(id: string): void {
    const c = this.store.curve(id);
    const v = this.viewer;
    if (!c || !v || c.points.length < 2) return;
    this.selection.set(id);
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const p of c.points)
      for (let k = 0; k < 3; k++) {
        if (p[k] < min[k]) min[k] = p[k];
        if (p[k] > max[k]) max[k] = p[k];
      }
    const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const size = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    // a loop is seen best square-on; an open curve from the side its surface faces
    let dir: Vec3 = [0, 0, 0];
    if (c.closed) dir = loopNormal(c.points);
    const snap = this.surfaceSnap;
    if (snap && Math.hypot(...dir) < 1e-9) {
      const step = Math.max(1, Math.floor(c.points.length / 40));
      for (let i = 0; i < c.points.length; i += step) {
        const n = snap.normal(snap.nearestVertex(c.points[i]));
        dir = [dir[0] + n[0], dir[1] + n[1], dir[2] + n[2]];
      }
      if (Math.hypot(...dir) < 0.3 * Math.ceil(c.points.length / step)) dir = [0, 0, 0];
    }
    const cur = v.towardViewer();
    const len = Math.hypot(...dir);
    let toward: Vec3 = len > 1e-9 ? [dir[0] / len, dir[1] / len, dir[2] / len] : cur;
    if (c.closed && toward[0] * cur[0] + toward[1] * cur[1] + toward[2] * cur[2] < 0) toward = [-toward[0], -toward[1], -toward[2]];
    v.viewFrom(toward, v.cameraUp(), center, Math.max(size * 2.2, v.diagonal * 0.35), true);
  }

  private stem(): string {
    const st = this.store.state;
    return fileStem(st.specimen.id || (st.mesh ? st.mesh.fileName.replace(/\.[^.]+$/, '') : ''), 'specimen');
  }

  /** "12.345 mm" or "37.2°". */
  formatMeasurement(m: Measurement): string {
    const v = measurementValue(m);
    if (m.type === 'angle') return `${fmtQuantity('angle', v)}°`;
    const u = measurementUnit(m, this.store.state.specimen.unit);
    return `${fmtQuantity('length', v)}${u ? ` ${u}` : ''}`;
  }

  autoMeasurements(): AutoMeasurements | null {
    return this.auto;
  }

  planeResults(): PlaneResult[] {
    return this.planes;
  }

  addPlane(): void {
    if (!this.hasMesh() || !this.viewer) return;
    const p = addPlane(this.store, this.isFlake() ? 'curves' : 'all_vertices', this.viewer.towardViewer());
    this.selection.set(p.id);
  }

  /** Look straight at the plane, along its normal, with its +Y up. */
  viewAlongPlane(id: string): void {
    const r = this.planes.find((p) => p.id === id);
    if (!r?.valid || !this.viewer) return;
    const m = r.matrix!;
    this.viewer.viewFrom(r.normal!, [m[4], m[5], m[6]], r.center!, undefined, true);
  }

  /** Centre of the model's bounding box: the origin of specimen coordinates. */
  private modelCentre(): Vec3 | null {
    const m = this.store.state.mesh;
    return m ? [(m.bboxMin[0] + m.bboxMax[0]) / 2, (m.bboxMin[1] + m.bboxMax[1]) / 2, (m.bboxMin[2] + m.bboxMax[2]) / 2] : null;
  }

  /** `merge`: one undo step with the last change (fine turning), and no camera transition (it follows the slider). */
  private setFrame(matrix: number[] | null, source: string, merge = false): void {
    if (!matrix) return;
    if (updateSpecimen(this.store, { frame: { matrix: matrix.map((x) => Math.round(x * 1e9) / 1e9), source } }, merge)) this.feedback.toast(t('config.cleared'), 'info', 4000);
    this.viewFrame(!merge);
  }

  setFrameFromView(): void {
    const v = this.viewer;
    const c = this.modelCentre();
    if (!v || !c) return;
    this.setFrame(frameFromView(v.towardViewer(), v.cameraUp(), c), 'view');
  }

  setFrameFromPlane(id: string): void {
    const r = this.planes.find((p) => p.id === id);
    const v = this.viewer;
    const c = this.modelCentre();
    if (!r?.valid || !v || !c) return;
    // keep what is up on screen now, as far as the plane allows
    this.setFrame(frameFromView(r.normal!, v.cameraUp(), c) ?? frameFromView(r.normal!, [r.matrix![4], r.matrix![5], r.matrix![6]], c), `plane:${r.label}`);
  }

  setFrameVertical(scarId: string): void {
    const f = this.store.state.specimen.frame;
    const s = this.store.scar(scarId);
    if (!f || !s?.vector) return;
    const v = s.vector;
    const base = f.source.replace(/; vertical:.*$/, '');
    this.setFrame(frameWithVertical(f.matrix, [v.end[0] - v.start[0], v.end[1] - v.start[1], v.end[2] - v.start[2]]), `${base}; vertical:${s.label}`);
  }

  turnFrame(deg: number, base?: number[]): void {
    const f = this.store.state.specimen.frame;
    if (!f) return;
    // fine turning (from a fixed start) is one undo step; a turned technical frame says so
    const source = f.source === TECHNICAL_FRAME ? `${TECHNICAL_FRAME}; turned` : f.source;
    this.setFrame(rotateFrame(base ?? f.matrix, deg), source, !!base);
  }

  clearFrame(): void {
    if (this.store.state.specimen.frame && updateSpecimen(this.store, { frame: null }, false)) this.feedback.toast(t('config.cleared'), 'info', 4000);
  }

  /** Put the camera on the specimen frame: looking at the main face, +Y up (`animate`: in a short transition). */
  viewFrame(animate = true): void {
    const f = this.store.state.specimen.frame;
    if (!f || !this.viewer) return;
    const a = frameAxes(f.matrix);
    this.viewer.viewFrom(a.z, a.y, undefined, undefined, animate);
  }

  setFigure(change: (f: FigureSettings) => void): void {
    change(this.figure);
    writePref('figure', this.figure);
    this.sidebar.refresh('figure');
    // the present mode shows what the figure will show
    this.syncAnnotations();
  }

  private figureContext(): FigureContext | null {
    const v = this.viewer;
    const loaded = this.loaded;
    if (!v || !loaded || !v.mesh || !this.lights) return null;
    return {
      renderer: v.renderer,
      scene: v.scene,
      overlay: v.overlay,
      mesh: v.mesh,
      lights: this.lights,
      regions: this.regionRoot ?? undefined,
      positions: loaded.geometry.getAttribute('position').array as Float32Array,
      offset: loaded.offset,
      diagonal: loaded.diagonal,
    };
  }

  /** The specimen frame, or the current view when none is set. */
  private figureFrame(): number[] | null {
    const f = this.store.state.specimen.frame;
    if (f) return f.matrix;
    const v = this.viewer;
    const c = this.modelCentre();
    return v && c ? frameFromView(v.towardViewer(), v.cameraUp(), c) : null;
  }

  figureLayout(): FigureLayout | null {
    const ctx = this.figureContext();
    const frame = this.figureFrame();
    const sections = this.sectionDrawings(this.store.state.sections.filter((x) => x.inFigure));
    if (!ctx || !frame || (!this.figure.views.length && !sections.length)) return null;
    return figureLayout(ctx, frame, this.store.state.specimen.unit, this.figure, sections);
  }

  /** Render the figure with the current settings and annotations; `only`: just this section's drawing. */
  private makeFigure(only?: Section): Figure | null {
    const ctx = this.figureContext();
    const frame = this.figureFrame();
    if (!ctx || !frame) return null;
    const st = this.store.state;
    const visiblePlanes = st.planes.filter((p) => p.visible);
    const settings = only ? { ...this.figure, views: [] } : this.figure;
    this.applyClipping(false);
    this.regionLayer?.useFigureStyle(true);
    this.upperLayer?.useFigureStyle(true);
    try {
      return renderFigure(ctx, frame, st.specimen.unit, settings, {
        arrows: (() => {
          const mode = this.arrowColorMode();
          const seq = mode === 'sequence' ? sequenceColors(st.sequences) : null;
          return st.scars.flatMap((s) => (s.vector ? [{ ...s.vector, color: arrowColor(s, mode, seq) }] : []));
        })(),
        curves: st.curves.map((c) => ({ points: c.points, closed: c.closed, color: curveColor(c) })),
        planes: visiblePlanes.flatMap((p) => {
          const lines = this.cuts.get(p.id)?.lines;
          return lines ? [{ lines, color: planeColor(p.label) }] : [];
        }),
        landmarks: [
          ...shownLandmarks(st).map((l) => ({ point: l.point, color: LANDMARK_COLORS.fixed, fixed: true })),
          ...this.landmarks.sets.flatMap((q) => q.points.map((p) => ({ point: p, color: LANDMARK_COLORS.semi, fixed: false }))),
        ],
        sections: only ? this.sectionDrawings([only]) : this.sectionDrawings(st.sections.filter((x) => x.inFigure)),
      });
    } finally {
      this.regionLayer?.useFigureStyle(false);
      this.upperLayer?.useFigureStyle(false);
      this.applyClipping();
    }
  }

  private sectionDrawings(list: Section[]): SectionDrawing[] {
    return list.flatMap((sec) => {
      const lines = this.cuts.get(sec.id)?.lines;
      // drawn as seen from the side the section was drawn from: the viewer's side up
      const loops = lines ? sectionLoops2D(sec, lines).map((l) => l.map(([u, v]) => [u, -v] as [number, number])) : [];
      return loops.length ? [{ label: sec.label, loops, fill: sec.fill }] : [];
    });
  }

  /** Cut the model open in the present mode where sections ask for it (never while rendering figures). */
  private applyClipping(on = true): void {
    const mv = this.meshView;
    if (!mv) return;
    const planes = on && this.mode === 'present' ? SectionLayer.clipPlanes(this.store.state.sections).map((c) => c.plane) : [];
    mv.material.clippingPlanes = planes;
    this.viewer?.requestRender();
  }

  exportSection(id: string, format: 'png' | 'svg'): void {
    const sec = this.store.section(id);
    if (!sec || !this.hasMesh()) return;
    void (async () => {
      try {
        const fig = this.makeFigure(sec);
        if (!fig) return;
        const name = `${this.stem()}_section_${sec.label}.${format}`;
        if (format === 'png') {
          const outcome = await saveFile(name, await fig.png(), 'image/png');
          if (outcome === 'saved') this.feedback.toast(t('toast.saved', { name }));
        } else await this.save(name, await fig.svg(), 'image/svg+xml');
      } catch (e) {
        this.feedback.toast((e as Error).message, 'error');
      }
    })();
  }

  /** Where each section cuts the model (in slices). */
  private updateSections(): void {
    for (const sec of this.store.state.sections) this.cutModel(sec.id, sec.point, sec.normal);
    for (const id of [...this.cuts.keys()]) if (!this.store.plane(id) && !this.store.section(id)) this.cuts.delete(id);
    this.sidebar?.refresh('sections');
  }

  /** Compute (once per position) where the plane through `point` with `normal` cuts the model. */
  private cutModel(id: string, point: Vec3, normal: Vec3): void {
    const base = this.measureBase;
    const loaded = this.loaded;
    if (!base || !loaded) return;
    const key = JSON.stringify([point, normal]);
    if (this.cuts.get(id)?.key === key) return;
    this.cuts.set(id, { key, lines: null });
    const o = loaded.offset;
    const g = loaded.geometry;
    const local: Vec3 = [point[0] - o[0], point[1] - o[1], point[2] - o[2]];
    void runSliced(intersectPlaneSteps(g.getAttribute('position').array as Float32Array, g.index!.array as Uint32Array, local, normal, base.edges)).then((lines) => {
      const entry = this.cuts.get(id);
      if (!entry || entry.key !== key || this.loaded !== loaded) return;
      const shifted = lines.map((l) => ({ closed: l.closed, points: l.points.map((p) => [p[0] + o[0], p[1] + o[1], p[2] + o[2]] as Vec3) }));
      this.cuts.set(id, { key, lines: shifted });
      this.syncAnnotations();
      this.sidebar.refresh('sections');
    });
  }

  exportFigure(format: 'png' | 'svg'): void {
    // the whole folder: one figure per model, in a new figures folder
    if (this.figureFolder && this.workspace) {
      void this.batchFigures(format);
      return;
    }
    void (async () => {
      if (!this.hasMesh()) return;
      if (!this.store.state.specimen.frame) this.feedback.toast(t('figure.noFrame'), 'info', 3500);
      this.feedback.busy(t('figure.busy'), this.viewportEl);
      await nextFrame();
      try {
        const fig = this.makeFigure();
        if (!fig) return;
        const name = `${this.stem()}_figure.${format}`;
        if (format === 'png') {
          const outcome = await saveFile(name, await fig.png(), 'image/png');
          if (outcome === 'saved') this.feedback.toast(t('toast.saved', { name }));
        } else await this.save(name, await fig.svg(), 'image/svg+xml');
      } catch (e) {
        const msg = e instanceof FigureError && e.code === 'tooLarge' ? t('figure.tooLarge', { msg: e.message }) : (e as Error).message;
        this.feedback.toast(msg, 'error');
      } finally {
        this.feedback.busy(null);
        this.viewer?.requestRender();
      }
    })();
  }

  /** Principal axes of all vertices in original coordinates (the mesh keeps them re-centred). */
  private vertexAxes(): PrincipalAxes | null {
    const v = this.measureBase?.vertices;
    const o = this.loaded?.offset;
    if (!v || !o) return null;
    return { ...v, mean: [v.mean[0] + o[0], v.mean[1] + o[1], v.mean[2] + o[2]] };
  }

  private meshResults(): MeshResults {
    return { measurements: this.auto, vertices: this.vertexAxes(), regions: this.regions, nodule: this.nodule, split: this.split, box: this.configBox, flake: this.flake, regionFits: this.regionFits, edgeAngles: this.edgeAngleCurves(), retouchAngles: this.retouchAngleCurves(), retouchIndices: this.retouchIndex?.indices ?? null, gm: this.gm, workingEdges: this.workingEdgeDetails().map((d) => d.row) };
  }

  regionInfo(): { results: RegionResult[]; totals: RegionTotals } | null {
    return this.regions;
  }

  /** The triangle closest to a point (original coordinates), or −1. */
  private faceAt(p: Vec3): number {
    const loaded = this.loaded;
    const bvh = loaded?.geometry.boundsTree as unknown as { closestPointToPoint(q: THREE.Vector3, target: object): { faceIndex: number } | null } | undefined;
    if (!loaded || !bvh) return -1;
    const o = loaded.offset;
    return bvh.closestPointToPoint(new THREE.Vector3(p[0] - o[0], p[1] - o[1], p[2] - o[2]), {})?.faceIndex ?? -1;
  }

  private componentAt(p: Vec3): number {
    const f = this.faceAt(p);
    return this.partition && f >= 0 ? this.partition.region[f] : -1;
  }

  /** A scar whose arrow starts in this piece of surface and has no region yet. */
  private scarStartingIn(component: number): string | null {
    const st = this.store.state;
    const taken = new Set(st.regions.map((r) => r.scarId));
    return st.scars.find((s) => s.vector && !taken.has(s.id) && this.componentAt(s.vector.start) === component)?.id ?? null;
  }

  /** Region tool: select the region under the click, or start one there (a scar by default). */
  private clickRegion(point: THREE.Vector3, face: number): void {
    const part = this.partition;
    if (!part || face < 0) return;
    const c = part.region[face];
    const i = this.seedComponent.findIndex((x) => x === c);
    const existing = i >= 0 ? this.store.state.regions[i] : undefined;
    if (existing) {
      this.selection.set(existing.id);
      return;
    }
    // a part of the specimen not divided further: the part itself
    const up = this.upper?.partition;
    if (up) {
      const u = up.region[face];
      const j = this.upperComponent.indexOf(u);
      if (j >= 0 && Math.abs(up.areas[u] - part.areas[c]) <= 1e-9 * part.areas[c]) {
        this.selection.set(this.store.state.regions[j].id);
        return;
      }
    }
    const at: Vec3 = [point.x, point.y, point.z];
    const r = this.isGeneric() ? addRegion(this.store, at, GENERIC_REGION_TYPE, null) : addRegion(this.store, at, 'scar', this.scarStartingIn(c));
    this.selection.set(r.id);
  }

  setRegionType(id: string, type: string): void {
    this.setRegionTypeFor(id, type as RegionType);
  }

  private setRegionTypeFor(id: string, type: RegionType): void {
    const r = this.store.region(id);
    if (!r) return;
    // a region that followed other annotations stays where it is, the user's from now on
    const seed = r.auto ? (r.curveId ? this.bandSeed(this.store.state.regions.indexOf(r)) : this.autoRegionSeed(this.store.state.regions.indexOf(r))) : undefined;
    setRegionType(this.store, id, type, type === 'scar' ? this.scarStartingIn(this.componentAt(seed ?? r.seed)) : null, seed);
  }

  /** Where a region that follows a retouch curve lies (original coordinates). */
  private bandSeed(i: number): Vec3 | undefined {
    const part = this.partition, loaded = this.loaded;
    const c = this.seedComponent[i];
    if (!part || !loaded || c === undefined || c < 0) return undefined;
    const g = loaded.geometry;
    const s = runSync(pieceSeedSteps(g.getAttribute('position').array as Float32Array, g.index!.array as Uint32Array, part, c));
    const o = loaded.offset;
    return [s[0] + o[0], s[1] + o[1], s[2] + o[2]];
  }

  /** Where a region that follows other annotations lies (original coordinates). */
  private autoRegionSeed(i: number): Vec3 | undefined {
    const up = this.upper, loaded = this.loaded;
    const c = this.upperComponent[i];
    if (!up || !loaded || c === undefined || c < 0) return undefined;
    const g = loaded.geometry;
    const s = runSync(pieceSeedSteps(g.getAttribute('position').array as Float32Array, g.index!.array as Uint32Array, up.partition, c));
    const o = loaded.offset;
    return [s[0] + o[0], s[1] + o[1], s[2] + o[2]];
  }

  /**
   * Split the surface (in slices): the lower layer along all the curves, the upper along the boundary curves alone;
   * a lower piece thus lies wholly in one upper piece. Then find the regions again.
   */
  private updatePartition(): void {
    const token = ++this.partitionToken;
    void (async () => {
      const base = this.measureBase, loaded = this.loaded;
      const st = this.store.state;
      const chains = await this.curveChains(st.curves);
      if (!chains || !base || !loaded || token !== this.partitionToken) return;
      const g = loaded.geometry;
      const pos = g.getAttribute('position').array as Float32Array;
      const idx = g.index!.array as Uint32Array;
      const cuts = layerCurves(st.curves.map((c, i) => ({ attributes: c.attributes, chain: chains[i] })), st.specimen.type);
      const part = await runSliced(regionsSteps(pos, idx, base.edges, cuts.lower.flatMap((c) => c.chain)));
      if (token !== this.partitionToken || this.loaded !== loaded) return;
      const boundary = cuts.upper.flatMap((c) => c.chain);
      const key = JSON.stringify(boundary);
      const upperPart = this.upper?.key === key ? this.upper.partition : await runSliced(regionsSteps(pos, idx, base.edges, boundary));
      const over = await runSliced(overPiecesSteps(part, upperPart));
      const bands = await this.bandsOf(st, chains, part, boundary, this.retouchSides);
      if (token !== this.partitionToken || this.loaded !== loaded) return;
      this.partition = part;
      this.partitionVersion++;
      this.upper = { key, partition: upperPart, over };
      this.rawLower = { partition: part, over };
      this.retouchBands = bands;
      this.bandKey = '';
      await this.updatePlatformAuto();
      if (token !== this.partitionToken) return;
      this.resolveRegionsNow();
    })();
  }

  /** Where the bands of a project's retouch curves lie among the pieces `part` of its lower layer (in slices). `known`: what is kept while the curves stay. */
  private async bandsOf(st: Readonly<ProjectState>, chains: readonly number[][], part: Partition, boundary: readonly number[], known: Map<string, { key: string; side: RetouchSide | null }>): Promise<Map<string, { pieces: number[]; area: number }>> {
    const out = new Map<string, { pieces: number[]; area: number }>();
    const base = this.measureBase, loaded = this.loaded;
    if (!base || !loaded || st.specimen.type !== 'flake') return out;
    const g = loaded.geometry;
    const pos = g.getAttribute('position').array as Float32Array;
    const idx = g.index!.array as Uint32Array;
    for (const r of st.regions) {
      const i = r.auto && r.curveId ? st.curves.findIndex((c) => c.id === r.curveId) : -1;
      if (i < 0) continue;
      const c = st.curves[i];
      const which = c.retouchSide === 'larger' ? 'larger' : 'smaller';
      const key = JSON.stringify([boundary, chains[i], which]);
      let had = known.get(c.id);
      if (had?.key !== key) {
        had = { key, side: await runSliced(retouchSideSteps(pos, idx, base.edges, boundary, chains[i], which)) };
        known.set(c.id, had);
      }
      if (had.side) out.set(c.id, { pieces: await runSliced(bandPiecesSteps(part, had.side)), area: had.side.cut.areas[had.side.piece] });
    }
    return out;
  }

  /** Each band's pieces (those a region of its own holds stay that region's), by the id of the region following its curve. */
  private bandGroups(st: Readonly<ProjectState>, part: Partition, bands: ReadonlyMap<string, { pieces: number[]; area: number }>): Map<string, number[]> {
    return bandGroupsOf(st, part, bands, (q, p) => this.pieceAt(q, p));
  }

  /** Each retouch band one piece in the lower layer, for what comes after to go by. */
  private applyBands(): void {
    const raw = this.rawLower, up = this.upper;
    if (!raw || !up) return;
    const groups = this.bandGroups(this.store.state, raw.partition, this.retouchBands);
    const key = JSON.stringify([...groups]);
    if (key === this.bandKey) return;
    this.bandKey = key;
    const { partition, map } = mergePieces(raw.partition, [...groups.values()]);
    const over = new Int32Array(partition.count);
    raw.over.forEach((u, p) => (over[map[p]] = u));
    this.partition = partition;
    this.upper = { ...up, over };
    this.bandPiece = new Map([...groups].map(([id, pieces]) => [id, map[pieces[0]]]));
    this.partitionVersion++;
  }

  /** The closed platform outline of a flake. */
  private platformOutline(): Curve | null {
    if (!this.isFlake()) return null;
    return this.store.state.curves.find((c) => c.attributes.type === PLATFORM_OUTLINE && c.closed) ?? null;
  }

  /** The smaller of the two pieces the platform outline makes: where the region that follows it lies. */
  private async updatePlatformAuto(): Promise<void> {
    const outline = this.platformOutline();
    const base = this.measureBase, loaded = this.loaded;
    const token = ++this.platformToken;
    if (!outline || !base || !loaded) {
      this.platformAuto = null;
      return;
    }
    const key = JSON.stringify(outline.points);
    if (this.platformAuto?.key === key) return;
    const seed = await this.outlineSeed(outline);
    if (token !== this.platformToken || this.loaded !== loaded) return;
    this.platformAuto = seed ? { key, seed } : null;
  }

  /** The smaller of the two pieces a closed platform outline makes: a point in it, original coordinates (once per outline; observers' outlines too). */
  private async outlineSeed(outline: Curve): Promise<Vec3 | null> {
    const base = this.measureBase, loaded = this.loaded;
    const key = JSON.stringify(outline.points);
    const known = this.outlineSeeds.get(key);
    if (known !== undefined) return known;
    if (!base || !loaded) return null;
    const barrier = await this.barrierFor([outline]);
    if (!barrier || this.loaded !== loaded) return null;
    const g = loaded.geometry;
    const pos = g.getAttribute('position').array as Float32Array;
    const idx = g.index!.array as Uint32Array;
    const part = await runSliced(regionsSteps(pos, idx, base.edges, barrier));
    const found = await runSliced(smallerPieceSteps(pos, idx, base.edges, barrier, part));
    if (this.loaded !== loaded) return null;
    const o = loaded.offset;
    const seed: Vec3 | null = found ? [found.seed[0] + o[0], found.seed[1] + o[1], found.seed[2] + o[2]] : null;
    this.outlineSeeds.set(key, seed);
    return seed;
  }

  /** A piece of an upper partition holding a point. */
  private pieceAt(part: Partition, p: Vec3): number {
    const f = this.faceAt(p);
    return f >= 0 ? part.region[f] : -1;
  }

  /** The piece of each upper region of a project (−1: none, or a lower region): by its seed, or, one that follows other annotations, as they say, unless a region the user typed is there. */
  private upperComponents(st: Readonly<ProjectState>, part: Partition, platformSeed: Vec3 | null): number[] {
    return upperComponentsOf(st, part, platformSeed, (q, p) => this.pieceAt(q, p));
  }

  facesOpen(): boolean {
    const st = this.store.state;
    if (st.specimen.type !== 'flake' || !this.upper) return false;
    const faces = st.regions.flatMap((r, i) => (r.auto && (r.type === 'ventral' || r.type === 'dorsal') ? [i] : []));
    return faces.length > 0 && faces.every((i) => this.upperComponent[i] < 0);
  }

  /** The point of the platform outline nearest to a point; null without an outline (closed or not, a click can be placed on it). */
  private onPlatformOutline(p: Vec3): Vec3 | null {
    const c = this.store.state.curves.find((x) => x.attributes.type === PLATFORM_OUTLINE);
    if (!c) return null;
    const cum = arcLengths(c.points, c.closed);
    return pointAtArc(c.points, c.closed, cum, nearestArc(c.points, c.closed, cum, p));
  }

  /** What each landmark is called in the view: those of a flake's own by what they are. */
  private labelledLandmarks(): ReturnType<typeof shownLandmarks> {
    const st = this.store.state;
    const fixed = shownLandmarks(st);
    const sides = platformSides(st.flake.axis?.matrix, fixed);
    return fixed.map((l) => {
      if (!l.code) return l;
      if (l.code === 'pop') return { ...l, name: t('landmark.pop') };
      const name = landmarkName(l, sides);
      return { ...l, name: t(name === 'platform_left' ? 'landmark.platformLeft' : name === 'platform_right' ? 'landmark.platformRight' : 'landmark.platformEnd') };
    });
  }

  // ------------------------------------------------------------ flake

  private isFlake(): boolean {
    return this.store.state.specimen.type === 'flake';
  }

  /** What a curve is measured along (a flake's edge, without what runs along the platform outline). */
  private lineOf(c: Curve): MeasuredLine {
    return measuredLine(c, this.store.state);
  }

  private isCore(): boolean {
    return this.store.state.specimen.type === 'core';
  }

  private isGeneric(): boolean {
    return this.store.state.specimen.type === 'generic';
  }

  /** What the arrows are coloured by: the setting, as far as the specimen's type has it. */
  private arrowColorMode(): ArrowColorMode {
    return arrowColorModeOf(this.display.arrows.colorMode, this.store.state.specimen.type);
  }

  /** Whether a region lies in the lower layer of a project: not the upper layer's, nor on another type of specimen one left over that followed a flake's annotations. */
  private inLowerLayer(st: Readonly<ProjectState>, r: ProjectState['regions'][number]): boolean {
    return inLowerLayer(st, r);
  }

  flakeMeasures(): FlakeMeasures | null {
    return this.isFlake() ? (this.flake?.measures ?? null) : null;
  }

  flakeEmptyReasons(): FlakeResult['reasons'] | null {
    return this.isFlake() ? (this.flake?.reasons ?? null) : null;
  }

  /** Look at the flake as the technical frame says, the whole of it: the dorsal face toward the viewer, the platform down. Only the camera moves. */
  private orientToAxis(): void {
    const m = this.isFlake() ? this.store.state.flake.axis?.matrix : null;
    if (!m || !this.viewer) return;
    const a = frameAxes(m);
    this.viewer.viewFrom(a.z, a.y, undefined, undefined, true);
  }

  /** The technical axis drawn: its frame found on the mesh (in slices), then one undo step with the arrow. */
  private drawAxis(s: { p: Vec3; n: Vec3 }, e: { p: Vec3; n: Vec3 }): void {
    void this.applyAxis({ start: s.p, startNormal: s.n, end: e.p, endNormal: e.n });
  }

  private moveAxisEnd(which: 'start' | 'end', point: Vec3, normal: Vec3): void {
    const a = this.store.state.flake.axis;
    if (!a) return;
    void this.applyAxis(which === 'start' ? { start: point, startNormal: normal, end: a.end, endNormal: a.endNormal } : { start: a.start, startNormal: a.startNormal, end: point, endNormal: normal });
  }

  private async applyAxis(v: Pick<TechnicalAxis, 'start' | 'end' | 'startNormal' | 'endNormal'>): Promise<void> {
    const base = this.measureBase, loaded = this.loaded;
    if (!base || !loaded) return;
    const g = loaded.geometry;
    const fr = await runSliced(technicalFrameSteps({ positions: g.getAttribute('position').array as Float32Array, index: g.index!.array as Uint32Array, offset: loaded.offset, orientationSign: loaded.orientationSign, meanEdge: base.meanEdge }, v.start, v.end));
    if (this.loaded !== loaded || !this.isFlake()) return;
    const first = !this.store.state.flake.axis?.matrix;
    const axis = setTechnicalAxis(this.store, { ...v, matrix: fr.ok ? fr.matrix : null, failure: fr.ok ? null : fr.reason });
    this.selection.set(axis.id);
    // the first frame opens the profile panel
    if (first && axis.matrix && !this.display.profile) this.setDisplay((d) => (d.profile = true), 'profile');
    if (!fr.ok) this.feedback.toast(t(`axis.${fr.reason}`), 'warn', 4000);
  }

  /** Measure the flake again shortly: several changes of one step make one computation. */
  private scheduleFlake(): void {
    clearTimeout(this.flakeTimer);
    this.flakeTimer = window.setTimeout(() => void this.updateFlake(), 30);
  }

  /** The flake's platform region: the pieces of surface of its `platform` regions, and their area. */
  private platformPieces(): { pieces: Set<number>; area: number } | null {
    const part = this.upper?.partition;
    if (!part) return null;
    const pieces = new Set<number>();
    this.store.state.regions.forEach((r, i) => {
      const c = this.upperComponent[i];
      if (r.type === 'platform' && c >= 0) pieces.add(c);
    });
    if (!pieces.size) return null;
    let area = 0;
    for (const c of pieces) area += part.areas[c];
    return { pieces, area };
  }

  /** A flake's measurements from its annotations (in slices); the last request wins. */
  private async updateFlake(): Promise<void> {
    const token = ++this.flakeToken;
    const base = this.measureBase, loaded = this.loaded;
    const st = this.store.state;
    if (!this.isFlake() || !base || !loaded) {
      this.flake = null;
      this.sidebar.refresh('flake');
      this.updateProfile();
      return;
    }
    const g = loaded.geometry;
    const positions = g.getAttribute('position').array as Float32Array;
    const index = g.index!.array as Uint32Array;
    await this.morphOf(loaded);
    if (this.loaded !== loaded) return;
    const plat = this.platformPieces();
    const faces = plat ? await runSliced(facesOfPiecesSteps(this.upper!.partition, plat.pieces)) : null;
    if (token !== this.flakeToken) return;
    const axis = st.flake.axis;
    // the longitudinal section changes only with the axis
    const sectionKey = JSON.stringify([axis?.matrix, axis?.start]);
    const known = this.flakeSection?.loaded === loaded && this.flakeSection.key === sectionKey ? this.flakeSection.line : undefined;
    const result = await runSliced(
      flakeMeasuresSteps({
        positions,
        index,
        offset: loaded.offset,
        matrix: axis?.matrix ?? null,
        P: axis?.start ?? null,
        ends: st.landmarks.filter((l) => l.code === 'platform_end').map((l) => l.point),
        platformFaces: faces,
        platformArea: plat?.area ?? null,
        unit: st.specimen.unit,
        meanEdge: base.meanEdge,
        morph: this.flakeMorph!.value,
        candidates: bvhPlaneCandidates(g),
        section: known,
      }),
    );
    if (token !== this.flakeToken) return;
    if (axis?.matrix) this.flakeSection = { loaded, key: sectionKey, line: result.section };
    this.flake = result;
    this.sidebar.refresh('flake');
    this.updateProfile();
    this.syncCrossSection();
    this.refreshHint();
    // the file holds the results too
    if (this.unsaved) {
      this.scheduleAutosave();
      this.scheduleFolderSave();
    }
  }

  /** The morphological dimensions of a mesh: computed once. */
  private async morphOf(loaded: LoadedMesh): Promise<MorphDimensions | null> {
    if (this.flakeMorph?.loaded !== loaded) {
      const positions = loaded.geometry.getAttribute('position').array as Float32Array;
      const value = await runSliced(morphDimensionsSteps(positions));
      if (this.loaded === loaded) this.flakeMorph = { loaded, value };
      return value;
    }
    return this.flakeMorph.value;
  }

  // ------------------------------------------------------------ edge angles

  edgeAngleResult(curveId: string): EdgeAngleResult | null {
    return this.edgeResults.get(curveId)?.result ?? null;
  }

  // ------------------------------------------------------------ geometric morphometrics

  gmResult(): GmResult | null {
    return this.gm;
  }

  /** The semilandmarks in the view, when asked for (not in figures or comparisons). */
  private syncGmLayer(): void {
    const layer = this.gmLayer, loaded = this.loaded;
    if (!layer) return;
    const shown = this.mode !== 'present' && this.mode !== 'compare' && this.mode !== 'retouch' && !!this.gm && !!loaded;
    // all the semilandmarks (the display panel's, a flake's) or those on the surface (the panel's own)
    const all = this.display.gmPoints && this.isFlake();
    const on = shown && (all || this.display.gmSurface);
    layer.group.visible = on;
    if (on) {
      const rows = this.gm!.rows.filter((r) => !r.missing && (all ? r.kind !== 'fixed' : r.kind === 'surface'));
      layer.sync(rows.map((r) => r.point), loaded!.offset, rows.map((r) => !!r.flagged));
    }
    this.viewer?.requestRender();
  }

  private gmKey(): string {
    const st = this.store.state;
    const axis = st.flake.axis;
    return JSON.stringify([st.specimen.type, st.gm, axis?.matrix, axis?.start, st.landmarks.map((l) => [l.id, l.code, l.name, l.point]), st.semilandmarks, st.curves.map((c) => [c.id, c.points, c.closed, c.attributes.type]), this.partitionVersion, this.upperComponent, this.seedComponent, this.templateThere()]);
  }

  private scheduleGm(): void {
    clearTimeout(this.gmTimer);
    this.gmTimer = window.setTimeout(() => void this.updateGm(), 60);
  }

  /** A flake's points from its annotations and the configuration (in slices); the last request wins. */
  private async updateGm(): Promise<void> {
    const token = ++this.gmToken;
    const base = this.measureBase, loaded = this.loaded;
    const st = this.store.state;
    if (!this.isFlake() && !gmInUse(st.gm, st.specimen.type)) {
      if (this.gm) {
        this.gm = null;
        this.sidebar.refresh('landmarks');
        this.updateStatus();
      }
      this.gmDoneKey = '';
      this.syncGmLayer();
      return;
    }
    if (!base || !loaded || !this.partition) return;
    const key = this.gmKey();
    if (key === this.gmDoneKey) return;
    const byTemplate = usesTemplate(st.gm, st.specimen.type);
    const plat = byTemplate ? null : this.platformPieces();
    const faces = plat ? await runSliced(facesOfPiecesSteps(this.upper!.partition, plat.pieces)) : null;
    if (token !== this.gmToken) return;
    const g = loaded.geometry;
    const pos = g.getAttribute('position').array as Float32Array;
    const idx = g.index!.array as Uint32Array;
    const result = await runSliced(gmSteps(st, { positions: pos, index: idx, offset: loaded.offset, platformFaces: faces, candidates: bvhRayCandidates(g), centroid: base.vertices?.mean, regions: byTemplate ? this.gmRegions(pos, idx) : null, templateAvailable: this.templateThere() }));
    if (token !== this.gmToken || this.loaded !== loaded) return;
    this.gm = byTemplate ? { ...result, key: gmCacheKey(st) } : result;
    this.gmDoneKey = key;
    if (this.workspace && this.wsIndex >= 0) this.gmSeen.set(this.workspace.meshes[this.wsIndex], gmStanding(this.gm));
    this.syncGmLayer();
    this.sidebar.refresh('landmarks');
    this.updateStatus();
    if (this.workspace) this.sidebar.refresh('workspace');
    if (this.unsaved) {
      this.scheduleAutosave();
      this.scheduleFolderSave();
    }
  }

  /** Where the points by a template go on the open model; a region's tree stays while the pieces do. */
  private gmRegions(positions: ArrayLike<number>, index: ArrayLike<number>) {
    if (this.gmTreesOf !== this.partitionVersion) {
      this.gmTrees = new Map();
      this.gmTreesOf = this.partitionVersion;
    }
    return regionSourceOf(this.store.state, { lower: this.partition!, upper: this.upper?.partition ?? null, lowerComponent: this.seedComponent, upperComponent: this.upperComponent }, positions, index, this.gmTrees);
  }

  /** The template's model is in the open folder (with no folder there is nothing to look in). */
  private templateThere(): boolean {
    const t = this.store.state.gm.template;
    return !t || !this.workspace || this.workspace.meshes.includes(t.file);
  }

  /** The template's own annotations, wherever they are to be had: the open model's, or its project in the folder. */
  private templateState(): Readonly<ProjectState> | null {
    const st = this.store.state;
    const t = st.gm.template;
    if (!t) return null;
    if (st.mesh?.sha256 === t.sha256) return st;
    const i = this.workspace?.meshes.indexOf(t.file) ?? -1;
    return i >= 0 ? (this.modelProject(t.file, i)?.state ?? null) : null;
  }

  /** How the template stands, for the panel; null without one. */
  gmTemplateInfo(): { file: string; seed: number; isThis: boolean; changed: boolean; missing: boolean } | null {
    const st = this.store.state;
    const t = st.gm.template;
    if (!t) return null;
    const own = this.templateState();
    const anchors = own ? gmAnchorRows({ ...own, gm: st.gm }).rows.map((r) => r.point) : null;
    return { file: t.file, seed: t.seed, isThis: st.mesh?.sha256 === t.sha256, changed: !!own && !!anchors && (anchorsHashOf(anchors) !== t.anchorsHash || regionsHashOf(own) !== t.regionsHash), missing: !this.templateThere() };
  }

  /** What the folder holds to choose from in the lists: landmark names, curve and region types. */
  gmCandidates(): { landmarks: string[]; curves: string[]; regions: string[] } {
    const states = [this.store.state, ...(this.projectIndex?.all() ?? []).map((p) => p.state)];
    const of = (list: unknown[]) => [...new Set(list.filter((v): v is string => typeof v === 'string' && v !== ''))];
    return {
      landmarks: of(states.flatMap((s) => s.landmarks.filter((l) => !l.code).map((l) => l.name))),
      curves: of(states.flatMap((s) => s.curves.map((c) => c.attributes.type))),
      regions: of(states.flatMap((s) => s.regions.map((r) => r.type))),
    };
  }

  /**
   * The open specimen as the template: its points laid on its regions, by a seed (going on from the last when it already is the template, or asked to lay them again).
   * It has to have all the configuration asks for: otherwise nothing changes, and it says what lacks.
   */
  async layGmTemplate(): Promise<void> {
    const st = this.store.state;
    const base = this.measureBase, loaded = this.loaded;
    if (!base || !loaded || !st.mesh || !this.partition || this.gmLaying) return;
    const anchors = gmAnchorRows(st);
    const g = loaded.geometry;
    const pos = g.getAttribute('position').array as Float32Array;
    const idx = g.index!.array as Uint32Array;
    const source = this.gmRegions(pos, idx);
    const lacks: Array<{ code: GmMissing; name: string }> = [...(anchors.details ?? []), ...anchors.missing.filter((m) => !(anchors.details ?? []).some((d) => d.code === m)).map((code) => ({ code, name: '' }))];
    const found = st.gm.patches.map((p) => {
      const f = source.find(p.regionType);
      if ('reason' in f) lacks.push({ code: f.reason, name: p.regionType });
      return f;
    });
    if (lacks.length) {
      this.feedback.toast(t('gm.template.cannot', { what: lacks.map((d) => t(`gm.missing.${d.code}`, { name: d.name })).join(', ') }), 'warn', 6000);
      return;
    }
    const seed = st.gm.template?.sha256 === st.mesh.sha256 ? st.gm.template.seed + 1 : GM_TEMPLATE_PARAMETERS.SEED_START;
    this.gmLaying = true;
    this.sidebar.refresh('landmarks');
    try {
      const patches: NonNullable<GmConfig['template']>['patches'] = [];
      for (const [i, p] of st.gm.patches.entries()) {
        const f = found[i];
        if ('reason' in f) return;
        const laid = await runSliced(layPatchSteps(pos, idx, base.edges, f.faces, p.count, seed + i, loaded.offset));
        if (this.loaded !== loaded) return;
        if (!laid) {
          this.feedback.toast(t('gm.template.tooSmall', { name: p.regionType, n: p.count }), 'warn', 6000);
          return;
        }
        patches.push({ regionType: p.regionType, points: laid.points });
      }
      const rows = anchors.rows.map((r) => r.point);
      setGmConfig(this.store, { template: { file: this.currentFile(), sha256: st.mesh.sha256, seed, patches, anchors: rows, anchorsHash: anchorsHashOf(rows), regionsHash: regionsHashOf(st) } });
    } finally {
      this.gmLaying = false;
      this.sidebar.refresh('landmarks');
    }
  }

  gmLayingNow(): boolean {
    return this.gmLaying;
  }

  /** The points of the open model are up to date. */
  private async gmSettled(): Promise<void> {
    const t0 = performance.now();
    while (performance.now() - t0 < 120_000) {
      if (this.gmDoneKey === this.gmKey() && this.partition) return;
      await nextFrame();
    }
  }

  /** In a folder the configuration is the folder's: kept in its file (read-only folder: for the session, and with the projects to download). */
  private keepFolderGm(): void {
    const ws = this.workspace;
    if (!ws) return;
    const config = structuredClone(this.store.state.gm);
    if (JSON.stringify(config) === JSON.stringify(this.folderGm)) return;
    this.folderGm = config;
    this.gmSeen.clear();
    if (ws.writable) void ws.write(GM_CONFIG_FILE, JSON.stringify(config, null, 2)).catch((e) => this.feedback.toast(t('workspace.saveFailed', { msg: (e as Error).message }), 'error'));
  }

  private async readFolderGm(ws: Workspace): Promise<GmConfig | null> {
    try {
      return (await ws.exists(GM_CONFIG_FILE)) ? parseGmConfig(JSON.parse(await (await ws.read(GM_CONFIG_FILE)).text())) : null;
    } catch {
      return null;
    }
  }

  /**
   * The specimens of a summary by the folder's configuration. By a template: what is stored stands while what it was made from is the same (`gmCacheKey`), the rest is made in the
   * batch worker. By the grid: stored points of another configuration are made anew on their models (these are opened in turn); a specimen that lacks an annotation needs no model to tell so.
   */
  private async gmOfFolder(specimens: BatchSpecimen[], config: GmConfig, measurer: MeshMeasurer): Promise<void> {
    const ws = this.workspace!;
    const start = this.wsIndex;
    const summary = gmConfigSummary(config);
    const gridOf = (c: Pick<GmConfig, 'fixed' | 'edge' | 'platformOutline' | 'ventral' | 'dorsal' | 'platform'>) => JSON.stringify([c.fixed, c.edge, c.platformOutline, c.ventral, c.dorsal, c.platform]);
    const wanted = gridOf(config);
    const there = !config.template || ws.meshes.includes(config.template.file);
    let opened = false;
    for (const s of specimens) {
      const type = s.state.specimen.type;
      if (usesTemplate(config, type)) {
        s.state = { ...s.state, gm: config };
        if (!gmInUse(config, type)) {
          s.gm = null;
          continue;
        }
        const key = gmCacheKey(s.state);
        if (s.gm?.key === key) continue;
        const i = ws.meshes.indexOf(s.file);
        if (i < 0) continue;
        if (this.gm?.key === key && this.wsIndex === i) {
          s.gm = { config: summary, ...this.gm };
          continue;
        }
        const made = await measurer.gm(await ws.read(s.file), s.state, there);
        s.gm = { config: summary, ...made, key };
        this.gmSeen.set(s.file, gmStanding(made));
        continue;
      }
      s.state = { ...s.state, gm: config };
      const lacks = gmMissingInputs(s.state);
      if (lacks.length) {
        s.gm = { config: summary, complete: false, missing: lacks, rows: [], curves: [], surfaces: [] };
        continue;
      }
      if (s.gm && gridOf(s.gm.config) === wanted) continue;
      const i = ws.meshes.indexOf(s.file);
      if (i < 0) continue;
      opened = true;
      await this.openWorkspaceMesh(i, true);
      await this.settled();
      await this.gmSettled();
      if (this.gm && this.wsIndex === i) s.gm = { config: summary, ...this.gm };
    }
    if (opened && start >= 0) await this.openWorkspaceMesh(start, true);
  }

  setEdgeSeries(series: string): void {
    this.edgeSeries = series;
    this.syncEdgeColors();
    this.syncAnnotations();
    this.sidebar.refresh('edge');
  }

  setEdgeColorMode(mode: 'angle' | 'sharp'): void {
    this.edgeColorMode = mode;
    this.syncEdgeColors();
    this.syncAnnotations();
    this.sidebar.refresh('edge');
  }

  retouchAngleResult(curveId: string): RetouchAngleResult | null {
    const r = this.retouchResults.get(curveId)?.result ?? null;
    return r?.stations.some((s) => s.stretches.length) ? r : null;
  }

  /** The curve's sharp stretches under the rule (null without a threshold, or without angles). */
  sharpOf(curveId: string): SharpResult | null {
    const c = this.store.curve(curveId), r = this.edgeAngleResult(curveId);
    return c && r ? sharpOfCurve(r, this.lineOf(c).closed, this.store.state.sharpEdge, this.store.state.specimen.unit) : null;
  }

  /** A threshold from the angles themselves: of this model, or, in a folder, of every model. */
  async suggestSharpEdge(): Promise<void> {
    const st = this.store.state;
    const rule = st.sharpEdge;
    const live = this.edgeAngleCurves();
    const values = live.flatMap((r) => ruleValues(r, rule));
    if (this.workspace && this.projectIndex) {
      await this.projectIndex.ready();
      for (const p of this.projectIndex.all()) {
        if (p.sha256 && p.sha256 === st.mesh?.sha256) continue;
        const curves = (p.derived.edgeAngles as { curves?: EdgeAngleResult[] } | null | undefined)?.curves ?? [];
        for (const r of curves) values.push(...ruleValues(r, rule));
      }
    }
    const threshold = suggestThreshold(values.filter((v): v is number => v !== null));
    if (threshold === null) {
      this.feedback.toast(t('toast.sharpNoSplit'), 'warn', 4000);
      return;
    }
    const value = Math.round(threshold * 10) / 10;
    setSharpEdge(this.store, { threshold: value });
    this.edgeSeries = `d${rule.distance}`;
    this.edgeMethod = rule.method;
    this.setEdgeColorMode('sharp');
    this.feedback.toast(t('toast.sharpSuggested', { value: fmtNum(value, 1) }));
  }

  /** In a folder the rule is the folder's: kept in its file (read-only folder: for the session, and with the projects to download). */
  private keepFolderSharp(): void {
    const ws = this.workspace;
    if (!ws) return;
    const rule = { ...this.store.state.sharpEdge };
    if (JSON.stringify(rule) === JSON.stringify(this.folderSharp)) return;
    this.folderSharp = rule;
    if (ws.writable) void ws.write(SHARP_EDGE_FILE, JSON.stringify(rule, null, 2)).catch((e) => this.feedback.toast(t('workspace.saveFailed', { msg: (e as Error).message }), 'error'));
  }

  /** The folder's rule, when it has one. */
  private async readFolderSharp(ws: Workspace): Promise<SharpEdgeRule | null> {
    try {
      return (await ws.exists(SHARP_EDGE_FILE)) ? parseSharpEdge(JSON.parse(await (await ws.read(SHARP_EDGE_FILE)).text())) : null;
    } catch {
      return null;
    }
  }

  private scheduleRetouchAngles(): void {
    clearTimeout(this.retouchTimer);
    this.retouchTimer = window.setTimeout(() => void this.updateRetouchAngles(), 60);
  }

  /** The retouch layers along the curves measured (in slices): only of those whose curve, unit, pieces or layers changed; the last request wins. */
  private async updateRetouchAngles(): Promise<void> {
    const token = ++this.retouchToken;
    const base = this.measureBase, loaded = this.loaded, part = this.partition;
    if (!base || !loaded || !part) return;
    const st = this.store.state;
    const pieces = new Map<number, RetouchPiece>();
    st.regions.forEach((r, i) => {
      const c = this.seedComponent[i];
      if (r.type === 'retouch' && c >= 0 && !pieces.has(c)) pieces.set(c, { region: r.id, layer: r.retouchLayer ?? 1 });
    });
    const piecesKey = JSON.stringify([this.partitionVersion, [...pieces]]);
    const curves = st.curves.filter((c) => measuresEdgeAngle(c, st.specimen.type));
    let changed = false;
    for (const id of [...this.retouchResults.keys()]) {
      if (curves.some((c) => c.id === id)) continue;
      this.retouchResults.delete(id);
      changed = true;
    }
    const g = loaded.geometry;
    const candidates = bvhPlaneCandidates(g);
    for (const c of curves) {
      const line = this.lineOf(c);
      const key = JSON.stringify([line.points, line.closed, st.specimen.unit, piecesKey]);
      if (this.retouchResults.get(c.id)?.key === key) continue;
      const found = pieces.size
        ? await runSliced(retouchSectionsSteps({ positions: g.getAttribute('position').array as Float32Array, index: g.index!.array as Uint32Array, offset: loaded.offset, points: line.points, closed: line.closed, unit: st.specimen.unit, meanEdge: base.meanEdge, candidates, pieceOfFace: part.region, pieces }))
        : null;
      if (token !== this.retouchToken || this.loaded !== loaded) return;
      this.retouchResults.set(c.id, { key, result: found?.result ?? null, sections: found?.sections ?? [], length: found?.length ?? 0 });
      changed = true;
    }
    this.scheduleRetouchIndices();
    if (!changed) return;
    this.sidebar.refresh('edge');
    this.syncAnnotations();
    if (this.unsaved) {
      this.scheduleAutosave();
      this.scheduleFolderSave();
    }
  }

  private scheduleRetouchIndices(): void {
    clearTimeout(this.retouchIndexTimer);
    this.retouchIndexTimer = window.setTimeout(() => void this.updateRetouchIndices(), 60);
  }

  /** A flake's retouch indices (in slices), from the stations' sections: the mesh is not cut again; the last request wins. */
  private async updateRetouchIndices(): Promise<void> {
    const token = ++this.retouchIndexToken;
    const base = this.measureBase, loaded = this.loaded, part = this.partition, up = this.upper;
    const st = this.store.state;
    if (!this.isFlake() || !base || !loaded || !part || !up) {
      this.retouchIndex = null;
      this.retouchIndexKey = '';
      this.edgeDetails = null;
      return;
    }
    const pieces = new Map<number, RetouchPiece>();
    const faceOfPiece = new Map<number, number>();
    st.regions.forEach((r, i) => {
      const c = this.seedComponent[i];
      if (r.type === 'retouch' && c >= 0 && !pieces.has(c)) pieces.set(c, { region: r.id, layer: r.retouchLayer ?? 1 });
      const u = this.upperComponent[i];
      const code = r.type === 'dorsal' ? FACE_DORSAL : r.type === 'ventral' ? FACE_VENTRAL : r.type === 'platform' ? FACE_PLATFORM : 0;
      if (code && u >= 0 && !faceOfPiece.has(u)) faceOfPiece.set(u, code);
    });
    const measured = st.curves.filter((c) => measuresEdgeAngle(c, st.specimen.type));
    const settings = retouchSettingsOf(st.flake);
    const matrix = st.flake.axis?.matrix ?? null;
    const facesKey = JSON.stringify([up.key, [...faceOfPiece]]);
    const frameKey = JSON.stringify([settings.axis, settings.flip, matrix, st.specimen.frame?.matrix ?? null, facesKey]);
    const fitKey = JSON.stringify([frameKey, st.specimen.unit, this.partitionVersion, [...pieces], measured.map((c) => [c.id, c.attributes.type, c.closed, this.retouchResults.get(c.id)?.key ?? null]), base.volume]);
    const fitLength = this.fitPreview ?? settings.fitLength;
    const key = `${fitKey}|${fitLength}`;
    if (key === this.retouchIndexKey) return;
    const g = loaded.geometry;
    const positions = g.getAttribute('position').array as Float32Array;
    const index = g.index!.array as Uint32Array;
    if (this.retouchFaces?.key !== facesKey) {
      const faces = await runSliced(faceOfTrianglesSteps(up.partition.region, faceOfPiece));
      if (token !== this.retouchIndexToken || this.loaded !== loaded) return;
      this.retouchFaces = { key: facesKey, faces };
    }
    const faceOf = this.retouchFaces.faces;
    if (this.retouchFrame?.key !== frameKey) {
      const longest = settings.axis === 'longest' || (settings.axis === 'auto' && !matrix);
      const morph = longest ? await this.morphOf(loaded) : null;
      if (token !== this.retouchIndexToken || this.loaded !== loaded) return;
      const frame = await runSliced(segmentFrameSteps({ positions, index, offset: loaded.offset, orientationSign: loaded.orientationSign, faceOf, settings, matrix, morph, specimenFrame: st.specimen.frame?.matrix ?? null }));
      const outline = frame.frame ? await runSliced(segmentOutlineSteps(positions, frame.frame)) : null;
      if (token !== this.retouchIndexToken || this.loaded !== loaded) return;
      this.retouchFrame = { key: frameKey, frame, outline };
    }
    const curves: RetouchCurve[] = measured.map((c) => {
      const r = this.retouchResults.get(c.id);
      return { curveId: c.id, edge: c.attributes.type === 'edge', closed: this.lineOf(c).closed, length: r?.length ?? 0, stations: r?.result?.stations ?? [], sections: r?.sections ?? [] };
    });
    const input: RetouchIndexInput = { positions, index, offset: loaded.offset, faceOf, pieceOfFace: part.region, pieces, curves, unit: st.specimen.unit, meanEdge: base.meanEdge, volume: base.volume, fitLength, frame: this.retouchFrame.frame, outline: this.retouchFrame.outline };
    const result = await runSliced(retouchIndexSteps(input));
    if (token !== this.retouchIndexToken || this.loaded !== loaded) return;
    this.retouchIndex = result;
    this.edgeDetails = null;
    this.retouchIndexKey = key;
    this.retouchFitKey = fitKey;
    this.retouchPieces = pieces;
    this.retouchLastInput = input;
    // the row picked may have gone with a change
    if (this.planEdgeId && !this.workingEdgeDetails().some((d) => d.row.id === this.planEdgeId)) this.planEdgeId = null;
    this.updateRetouch();
    this.sidebar.refresh('retouch');
    if (this.fitPreview === null && this.unsaved) {
      this.scheduleAutosave();
      this.scheduleFolderSave();
    }
  }

  // ------------------------------------------------------------ the retouch mode

  retouchResult(): RetouchIndexResult | null {
    return this.retouchIndex;
  }

  /** The curves measured that have stations. */
  private retouchCurves(): Curve[] {
    const st = this.store.state;
    return st.curves.filter((c) => measuresEdgeAngle(c, st.specimen.type) && (this.edgeResults.get(c.id)?.result?.stations.length ?? 0) > 0);
  }

  /** Where the station goes by itself: the largest missing area of a curve (where Morales et al. took the section), else its middle. */
  private defaultStation(curveId?: string): { curveId: string; k: number } | null {
    const curves = this.retouchCurves();
    if (!curves.length) return null;
    let best: RetouchStationRow | null = null;
    for (const r of this.retouchIndex?.indices.stations ?? []) {
      if (r.filled || (curveId && r.curveId !== curveId) || !curves.some((c) => c.id === r.curveId)) continue;
      if (!best || (r.removed_area ?? 0) > (best.removed_area ?? 0)) best = r;
    }
    if (best) return { curveId: best.curveId, k: best.station };
    const id = curveId ?? curves.find((c) => c.id === this.selection.id)?.id ?? curves[0].id;
    return { curveId: id, k: Math.floor((this.edgeResults.get(id)?.result?.stations.length ?? 1) / 2) };
  }

  /** The current station, kept valid. */
  private ensureStation(): { curveId: string; k: number } | null {
    const cur = this.retouchStation;
    const stations = cur ? this.edgeResults.get(cur.curveId)?.result?.stations : null;
    const ok = !!cur && !!stations && cur.k < stations.length && this.retouchCurves().some((c) => c.id === cur.curveId);
    if (!ok || this.stationAuto) this.retouchStation = this.defaultStation(ok && !this.stationAuto ? cur.curveId : undefined);
    return this.retouchStation;
  }

  retouchStationNow(): { curveId: string; station: number; position: number } | null {
    const s = this.retouchStation;
    const at = s ? this.edgeResults.get(s.curveId)?.result?.stations[s.k] : null;
    return s && at ? { curveId: s.curveId, station: s.k, position: at.position } : null;
  }

  moveRetouchStation(curveId: string, k: number): void {
    const n = this.edgeResults.get(curveId)?.result?.stations.length ?? 0;
    if (!n) return;
    this.stationAuto = false;
    this.retouchStation = { curveId, k: Math.max(0, Math.min(n - 1, k)) };
    this.queueStation();
  }

  moveRetouchPosition(curveId: string, position: number): void {
    const stations = this.edgeResults.get(curveId)?.result?.stations ?? [];
    let best = 0;
    stations.forEach((s, k) => {
      if (Math.abs(s.position - position) < Math.abs(stations[best].position - position)) best = k;
    });
    this.moveRetouchStation(curveId, best);
  }

  useRetouchCurve(curveId: string): void {
    this.stationAuto = false;
    this.retouchStation = this.defaultStation(curveId);
    this.queueStation();
  }

  /** ← / →: round a closed curve; an open one stops at its ends. */
  private stepStation(step: number): void {
    const s = this.ensureStation();
    const c = s ? this.store.curve(s.curveId) : null;
    const n = s ? (this.edgeResults.get(s.curveId)?.result?.stations.length ?? 0) : 0;
    if (!s || !c || !n) return;
    this.moveRetouchStation(s.curveId, this.lineOf(c).closed ? ((s.k + step) % n + n) % n : s.k + step);
  }

  /** A press in the view: to the station nearest it, if one is near; held, along the curve it is on. */
  private placeStation(x: number, y: number, following: boolean): boolean {
    const viewer = this.viewer;
    if (!viewer) return false;
    const current = this.retouchStation?.curveId;
    const curves = following ? this.retouchCurves().filter((c) => c.id === current) : this.retouchCurves();
    let best: { curveId: string; k: number } | null = null, least = Infinity;
    for (const c of curves) {
      this.edgeResults.get(c.id)?.result?.stations.forEach((s, k) => {
        if (!s.point) return;
        const q = viewer.project(new THREE.Vector3(s.point[0], s.point[1], s.point[2]));
        const d = Math.hypot(q.x - x, q.y - y);
        if (q.visible && d < least) {
          least = d;
          best = { curveId: c.id, k };
        }
      });
    }
    if (!best || (!following && least > STATION_REACH_PX)) return false;
    const { curveId, k } = best as { curveId: string; k: number };
    this.moveRetouchStation(curveId, k);
    return true;
  }

  /** Draw the station's views at most once a frame. */
  private queueStation(): void {
    if (this.stationQueued) return;
    this.stationQueued = requestAnimationFrame(() => {
      this.stationQueued = 0;
      this.syncStation();
    });
  }

  /** The section of a station: the one kept where there is retouch, else cut now. */
  private stationSection(curveId: string, k: number): StationSection | null {
    const kept = this.retouchResults.get(curveId)?.sections[k];
    if (kept) return kept;
    const c = this.store.curve(curveId), loaded = this.loaded, base = this.measureBase, part = this.partition;
    if (!c || !loaded || !base || !part) return null;
    const key = JSON.stringify([curveId, k, this.partitionVersion, this.edgeResults.get(curveId)?.key]);
    if (this.stationCache?.key === key) return this.stationCache.section;
    const g = loaded.geometry;
    const line = this.lineOf(c);
    const section = sectionAtStation({ positions: g.getAttribute('position').array as Float32Array, index: g.index!.array as Uint32Array, offset: loaded.offset, points: line.points, closed: line.closed, unit: this.store.state.specimen.unit, meanEdge: base.meanEdge, candidates: bvhPlaneCandidates(g), pieceOfFace: part.region, pieces: this.retouchPieces }, k);
    this.stationCache = { key, section };
    return section;
  }

  private stationDetail(curveId: string, k: number): RetouchStationDetail | null {
    return this.retouchIndex?.details.find((d) => d.curveId === curveId && d.station === k) ?? null;
  }

  /** The section panel's drawing of the current station. */
  private stationModel(): SectionModel | null {
    const s = this.retouchStation, part = this.partition, base = this.measureBase;
    const sec = s ? this.stationSection(s.curveId, s.k) : null;
    if (!s || !sec || !part || !base) return null;
    const faces = stationFaces(sec, this.retouchFaces?.faces ?? new Uint8Array(part.region.length), part.region, this.retouchPieces, base.meanEdge);
    const layer = this.retouchSeries.startsWith('L') ? Number(this.retouchSeries.slice(1)) : null;
    return sectionModel(sec, this.stationDetail(s.curveId, s.k), faces, layer);
  }

  /** The readings under the section; what is empty says why. */
  private sectionReadings(): SectionReading[] {
    const s = this.retouchStation;
    const u = this.store.state.specimen.unit;
    const row = s ? (this.retouchIndex?.indices.stations.find((r) => r.curveId === s.curveId && r.station === s.k) ?? null) : null;
    const detail = s ? this.stationDetail(s.curveId, s.k) : null;
    const point = s ? this.edgeResults.get(s.curveId)?.result?.stations[s.k]?.point : null;
    const noStation = point ? 'no_retouch_on_edge' : 'section_misses_curve';
    const entry = (id: string, label: string, kind: Quantity, v: number | null | undefined, why: string | null, note?: string): SectionReading => ({ id: `retouch-read-${id}`, label: t(label), value: fmtQuantity(kind, v), unit: quantityUnit(kind, u), why: v === null || v === undefined ? t(`retouch.empty.${why ?? noStation}`) : null, note });
    const surface = detail?.reason ?? null;
    const giur = detail?.giurReason ?? null;
    const faces = row && row.depth_dorsal === null ? 'no_faces' : null;
    return [
      entry('area', 'retouch.read.area', 'area', row?.removed_area, surface, row?.filled ? t('retouch.filled') : undefined),
      entry('angle', 'retouch.read.angle', 'angle', row?.original_angle_deg, surface),
      entry('recession', 'retouch.read.recession', 'length', row?.recession, surface),
      entry('depth-dorsal', 'retouch.read.depthDorsal', 'length', row?.depth_dorsal, faces),
      entry('depth-ventral', 'retouch.read.depthVentral', 'length', row?.depth_ventral, faces),
      entry('t', 'retouch.read.t', 'length', row?.retouch_height, giur),
      entry('T', 'retouch.read.T', 'length', row?.thickness, giur),
      entry('ratio', 'retouch.read.ratio', 'ratio', row?.giur, giur),
    ];
  }

  /** The current station, everywhere it shows. */
  private syncStation(): void {
    const panel = this.sectionPanel, loaded = this.loaded, layer = this.retouchLayer;
    if (!panel || !loaded || !layer || !this.retouching()) return;
    const s = this.retouchStation;
    const st = this.store.state;
    const curves = this.retouchCurves();
    const edge = s ? this.edgeResults.get(s.curveId)?.result : null;
    const at = s ? edge?.stations[s.k] : null;
    const mm = mmPerUnit(st.specimen.unit);
    panel.set(
      s && edge && at
        ? {
            curves: curves.map((c) => ({ id: c.id, label: c.label })),
            curveId: s.curveId,
            station: s.k,
            count: edge.stations.length,
            position: `${fmtNum(at.position, 1)} / ${fmtNum(edge.length, 1)}${st.specimen.unit ? ` ${st.specimen.unit}` : ''}`,
            edge: this.workingEdgeAt(s.curveId, at.position),
            model: this.stationModel(),
            unit: mm !== null ? st.specimen.unit : null,
            minWidth: 5 / (mm ?? 1),
            readings: this.sectionReadings(),
          }
        : null,
    );
    // on the model: the section's line and the point on the edge
    const sec = s ? this.stationSection(s.curveId, s.k) : null;
    if (sec && s) {
      const chain = sec.closed ? [...sec.ways[0].points, sec.A] : [...sec.ways[1].points.slice(1).reverse(), ...sec.ways[0].points];
      layer.syncStation(`${s.curveId}|${s.k}|${this.partitionVersion}|${this.edgeResults.get(s.curveId)?.key}`, [chain], sec.A, loaded.offset);
    } else layer.syncStation('none', [], null, loaded.offset);
    const frame = this.retouchFrame?.frame.frame;
    this.planPanel?.moveStation(at?.point && frame ? onPlan(frame, [at.point[0] - loaded.offset[0], at.point[1] - loaded.offset[1], at.point[2] - loaded.offset[2]]) : null, s?.k ?? 0);
    // another curve: its colours
    if ((s?.curveId ?? null) !== this.edgeColorCurve) this.syncAnnotations();
    this.sidebar.refresh('station');
  }

  private retouching(): boolean {
    return this.mode === 'retouch' && this.isFlake() && this.hasMesh();
  }

  /** Show or hide what the retouch mode shows, and draw it. */
  private updateRetouch(): void {
    const on = this.retouching();
    const wasSection = !!this.sectionEl && !this.sectionEl.hidden, wasPlan = !!this.planEl && !this.planEl.hidden;
    if (this.sectionEl) this.sectionEl.hidden = !on || !this.display.retouchSection;
    if (this.planEl) this.planEl.hidden = !on || !this.display.retouchPlan;
    if (!on) {
      this.retouchLayer?.clear();
      return;
    }
    if (!wasSection) this.sectionFit?.();
    if (!wasPlan) this.planFit?.();
    this.ensureStation();
    this.syncStation();
    this.drawPlan();
    this.syncRetouchEdge();
    void this.updateRetouchExtras();
  }

  /** The original edge on the model: the stations' A0, broken where a station has none of its own. */
  private syncRetouchEdge(): void {
    const layer = this.retouchLayer, loaded = this.loaded;
    if (!layer || !loaded) return;
    if (!this.display.retouchEdge) {
      layer.syncEdge('off', [], loaded.offset);
      return;
    }
    const chains: Vec3[][] = [];
    for (const c of this.retouchCurves()) {
      const stations = this.edgeResults.get(c.id)?.result?.stations ?? [];
      const of = new Map(this.retouchIndex?.details.filter((d) => d.curveId === c.id && d.surface).map((d) => [d.station, d.surface!.A0]));
      const own: Vec3[][] = [];
      let run: Vec3[] = [];
      stations.forEach((_, k) => {
        const p = of.get(k);
        if (p) run.push(p);
        else if (run.length) {
          own.push(run);
          run = [];
        }
      });
      if (run.length) own.push(run);
      // round a closed curve, the last run goes on into the first
      if (this.lineOf(c).closed && of.has(0) && of.has(stations.length - 1)) {
        if (own.length === 1) own[0] = [...own[0], own[0][0]];
        else own[0] = [...own.pop()!, ...own[0]];
      }
      chains.push(...own);
    }
    layer.syncEdge(this.retouchIndexKey, chains, loaded.offset);
  }

  /** What the mode draws from the frame and the regions, each in slices and only when what it depends on changed. */
  private async updateRetouchExtras(): Promise<void> {
    const token = ++this.retouchExtrasToken;
    const fr = this.retouchFrame, part = this.partition, faces = this.retouchFaces, loaded = this.loaded, layer = this.retouchLayer;
    if (!this.retouching() || !loaded || !layer) return;
    const g = loaded.geometry;
    const positions = g.getAttribute('position').array as Float32Array, index = g.index!.array as Uint32Array;
    const frame = fr?.frame.frame, outline = fr?.outline;
    if (fr && frame && outline && part && faces) {
      const loopsKey = JSON.stringify([fr.key, this.partitionVersion, [...this.retouchPieces]]);
      if (this.planLoops?.key !== loopsKey) {
        const loops = await runSliced(planRegionsSteps({ positions, index, faceOf: faces.faces, pieceOfFace: part.region, pieces: this.retouchPieces, frame }));
        if (token !== this.retouchExtrasToken || this.loaded !== loaded) return;
        this.planLoops = { key: loopsKey, loops };
        this.drawPlan();
      }
      if (this.display.retouchLines && this.segmentLines?.key !== fr.key) {
        const lines = await runSliced(segmentLinesSteps({ positions, index, faceOf: faces.faces, frame, outline: drawnOutline(outline) }));
        if (token !== this.retouchExtrasToken || this.loaded !== loaded) return;
        this.segmentLines = { key: fr.key, lines };
      }
    }
    const shown = this.display.retouchLines && frame && this.segmentLines?.key === fr?.key ? this.segmentLines : null;
    layer.syncSegments(shown ? shown.key : 'off', shown?.lines ?? null, loaded.offset);
    // the volume removed along a range of fitted lengths
    const input = this.retouchLastInput;
    if (input && this.fitCurve?.key !== this.retouchFitKey) {
      const key = this.retouchFitKey;
      const points = await runSliced(removedVolumeCurveSteps(input, FIT_CURVE_LENGTHS));
      if (token !== this.retouchExtrasToken || this.loaded !== loaded) return;
      this.fitCurve = { key, points };
      this.sidebar.refresh('retouch');
    }
  }

  retouchFitCurve(): Array<{ length: number; removed: number | null }> | null {
    return this.fitCurve?.key === this.retouchFitKey ? this.fitCurve.points : null;
  }

  previewFitLength(mm: number | null): void {
    // what is being looked at stays while the length changes
    this.stationAuto = false;
    this.fitPreview = mm;
    this.scheduleRetouchIndices();
  }

  private planContent(): { shape: PlanShape; loops: PlanLoops[]; station: { at: P2; index: number } | null; longest: RetouchIndexResult['longest']; edge: { label: string; points: P2[] } | null; highlight: number | null; tag: string; unit: string | null } | null {
    const fr = this.retouchFrame, frame = fr?.frame.frame, loaded = this.loaded;
    if (!fr || !frame || !fr.outline || !loaded) return null;
    if (this.planShapeOf?.key !== fr.key) this.planShapeOf = { key: fr.key, shape: planShape(drawnOutline(fr.outline)) };
    const s = this.retouchStation;
    const point = s ? this.edgeResults.get(s.curveId)?.result?.stations[s.k]?.point : null;
    const o = loaded.offset;
    // a working edge picked: its own chord instead of that of the longest retouched stretch
    const picked = this.planEdgeId ? this.workingEdgeDetails().find((d) => d.row.id === this.planEdgeId) ?? null : null;
    return {
      shape: this.planShapeOf.shape,
      loops: this.planLoops?.loops ?? [],
      station: point && s ? { at: onPlan(frame, [point[0] - o[0], point[1] - o[1], point[2] - o[2]]), index: s.k } : null,
      longest: picked ? picked.chord : (this.retouchIndex?.longest ?? null),
      edge: picked ? { label: picked.row.label || (this.store.curve(picked.row.curveId)?.label ?? ''), points: picked.plan } : null,
      highlight: this.planMarked,
      tag: t(`retouch.axis.${frame.kind}`),
      unit: mmPerUnit(this.store.state.specimen.unit) !== null ? this.store.state.specimen.unit : null,
    };
  }

  private drawPlan(): void {
    const panel = this.planPanel;
    if (!panel || !this.retouching()) return;
    const settings = retouchSettingsOf(this.store.state.flake);
    const fr = this.retouchFrame;
    panel.setControls(settings.axis, fr?.frame.frame?.kind === 'longest');
    panel.set(this.planContent(), this.planFace, fr?.frame.reason ? t(`retouch.empty.${fr.frame.reason}`) : null);
  }

  focusPlanSegment(segment: number): void {
    this.planMarked = this.planMarked === segment ? null : segment;
    this.planFace = segment > 8 ? 'ventral' : 'dorsal';
    this.drawPlan();
    this.sidebar.refresh('retouch');
  }

  planMark(): number | null {
    return this.planMarked;
  }

  focusRetouchSegment(i: number): void {
    const r = this.retouchIndex;
    const row = r?.indices.segments[i], stations = r?.segmentStations[i];
    if (!row || !stations?.length) return;
    this.moveRetouchStation(row.curveId, stations[Math.floor(stations.length / 2)]);
    this.selection.set(row.region);
  }

  setRetouchMethod(method: EdgeChartMethod): void {
    this.retouchMethod = method;
    this.syncEdgeColors();
    this.syncAnnotations();
    this.sidebar.refresh('edge');
  }

  setRetouchSeries(series: string): void {
    this.retouchSeries = series;
    // the edge's colours, and the layer shown on the section
    this.syncEdgeColors();
    this.syncAnnotations();
    this.syncStation();
    this.sidebar.refresh('edge');
  }

  /** The two preview panels; built again in another language. */
  private buildRetouchPanels(): void {
    const section = new RetouchSectionPanel();
    section.onStation = (k) => {
      const s = this.retouchStation;
      if (s) this.moveRetouchStation(s.curveId, k);
    };
    section.onCurve = (id) => this.useRetouchCurve(id);
    section.onExport = (f) => void this.exportRetouchFigure('section', f);
    const sectionFrame = floatingPanel({ id: 'retouch-section', title: t('retouch.section'), pref: 'retouchSectionPanel', area: this.viewportEl, extras: section.extras, resizable: true, onClose: () => this.setDisplay((d) => (d.retouchSection = false), 'retouch') });
    sectionFrame.body.append(section.el);
    if (this.sectionEl) this.sectionEl.replaceWith(sectionFrame.el);
    else this.viewportEl.append(sectionFrame.el);
    this.sectionEl = sectionFrame.el;
    this.sectionFit = sectionFrame.fit;
    this.sectionPanel = section;

    const plan = new RetouchPlanPanel();
    plan.onFace = (f) => {
      this.planFace = f;
      if (this.planMarked !== null && this.planMarked > 8 !== (f === 'ventral')) this.planMarked = null;
      this.drawPlan();
      this.sidebar.refresh('retouch');
    };
    plan.onAxis = (a) => setRetouchAxis(this.store, a as RetouchAxisChoice);
    plan.onFlip = () => setRetouchFlip(this.store, !retouchSettingsOf(this.store.state.flake).flip);
    plan.onExport = (f) => void this.exportRetouchFigure('plan', f);
    plan.onPick = (at, reach) => this.pickOnPlan(at, reach);
    const planFrame = floatingPanel({ id: 'retouch-plan', title: t('retouch.plan'), pref: 'retouchPlanPanel', area: this.viewportEl, extras: plan.extras, resizable: true, onClose: () => this.setDisplay((d) => (d.retouchPlan = false), 'retouch') });
    planFrame.body.append(plan.el);
    if (this.planEl) this.planEl.replaceWith(planFrame.el);
    else this.viewportEl.append(planFrame.el);
    this.planEl = planFrame.el;
    this.planFit = planFrame.fit;
    this.planPanel = plan;
    this.updateRetouch();
  }

  /** A press on the plan, near the outline: to the nearest station. */
  private pickOnPlan(at: P2, reach: number): void {
    const frame = this.retouchFrame?.frame.frame, loaded = this.loaded;
    if (!frame || !loaded) return;
    const o = loaded.offset;
    let best: { curveId: string; k: number } | null = null, least = reach;
    for (const c of this.retouchCurves()) {
      this.edgeResults.get(c.id)?.result?.stations.forEach((s, k) => {
        if (!s.point) return;
        const q = onPlan(frame, [s.point[0] - o[0], s.point[1] - o[1], s.point[2] - o[2]]);
        const d = Math.hypot(q[0] - at[0], q[1] - at[1]);
        if (d < least) {
          least = d;
          best = { curveId: c.id, k };
        }
      });
    }
    if (best) this.moveRetouchStation((best as { curveId: string }).curveId, (best as { k: number }).k);
  }

  /** A preview for a publication: the light colours on white, to the figure's scale where the unit is stated. */
  private retouchPrint(kind: 'section' | 'plan'): { drawing: Drawing; name: string } | null {
    const st = this.store.state;
    const mm = mmPerUnit(st.specimen.unit);
    const pxPerUnit = mm !== null ? mm * this.figure.scale * PX_PER_MM : undefined;
    const unit = mm !== null ? st.specimen.unit : null;
    const panelBox = (kind === 'section' ? this.sectionEl : this.planEl)?.querySelector<SVGElement>('svg')?.getBoundingClientRect();
    const width = panelBox?.width || 420, height = panelBox?.height || 300;
    if (kind === 'section') {
      const s = this.retouchStation, model = this.stationModel();
      const at = s ? this.edgeResults.get(s.curveId)?.result?.stations[s.k] : null;
      const curve = s ? this.store.curve(s.curveId) : null;
      if (!s || !model || !at || !curve) return null;
      const place = Math.round(at.position * (mm ?? 1) * 10) / 10;
      return { drawing: sectionDrawing(model, { palette: PRINT_PALETTE, whole: this.sectionPanel?.whole ?? false, minWidth: 5 / (mm ?? 1), unit, width, height, pxPerUnit }), name: `${this.stem()}_retouch_section_${curve.label}_${place}` };
    }
    const c = this.planContent();
    return c ? { drawing: planDrawing({ ...c, face: this.planFace, palette: PRINT_PALETTE, unit, width, height, pxPerUnit }), name: `${this.stem()}_retouch_plan_${this.planFace}` } : null;
  }

  private async exportRetouchFigure(kind: 'section' | 'plan', format: 'svg' | 'png'): Promise<void> {
    const print = this.retouchPrint(kind);
    if (!print) return;
    const name = `${print.name}.${format}`;
    try {
      if (format === 'svg') await this.save(name, svgFile(print.drawing, `retouch-${kind}`), 'image/svg+xml');
      else {
        const outcome = await saveFile(name, await drawingPng(print.drawing, `retouch-${kind}`, this.figure.dpi), 'image/png');
        if (outcome === 'saved') this.feedback.toast(t('toast.saved', { name }));
      }
    } catch (e) {
      this.feedback.toast((e as Error).message, 'error');
    }
  }

  /** The curves' retouch layers as the derived results hold them. */
  private retouchAngleCurves(): Array<RetouchAngleResult & { curveId: string }> {
    return this.store.state.curves.flatMap((c) => {
      const r = this.retouchAngleResult(c.id);
      return r ? [{ curveId: c.id, ...r }] : [];
    });
  }

  /** The values a curve is coloured by, at its stations: a distance or a layer in the method shown, or whether it is sharp (1, 0). */
  private edgeColorStations(c: Curve, r: EdgeAngleResult, sharp: SharpResult | null): Array<{ position: number; point: Vec3 | null; value: number | null }> {
    if (sharp) {
      const values = ruleValues(r, this.store.state.sharpEdge);
      return r.stations.map((s, k) => ({ position: s.position, point: s.point, value: values[k] === null && !sharp.mask[k] ? null : sharp.mask[k] ? 1 : 0 }));
    }
    if (this.mode === 'retouch') {
      const retouch = this.retouchAngleResult(c.id);
      const m = this.retouchMethod === 'layer_face' && !retouch ? 'three_points' : this.retouchMethod;
      const layers = retouch?.stations.flatMap((s) => s.stretches.map((x) => x.layer)) ?? [];
      const chosen = this.retouchSeries.startsWith('L') ? Number(this.retouchSeries.slice(1)) : null;
      // no line chosen, or one that is not there: the middle distance, or (of layer faces) the layer nearest the edge
      const layer = chosen !== null && layers.includes(chosen) ? chosen : m === 'layer_face' ? Math.min(...layers) : null;
      if (layer !== null) return r.stations.map((s, k) => ({ position: s.position, point: s.point, value: retouch?.stations[k]?.stretches.find((x) => x.layer === layer)?.[m] ?? null }));
      const middle = EDGE_ANGLE_DISTANCES_MM.indexOf(5);
      return r.stations.map((s) => ({ position: s.position, point: s.point, value: m === 'layer_face' ? null : s[m][middle] }));
    }
    const mm = /^d(\d+)$/.exec(this.edgeSeries);
    const d = EDGE_ANGLE_DISTANCES_MM.indexOf((mm ? Number(mm[1]) : 5) as (typeof EDGE_ANGLE_DISTANCES_MM)[number]);
    return r.stations.map((s) => ({ position: s.position, point: s.point, value: s[this.edgeMethod][d] }));
  }

  setEdgeMethod(method: EdgeAngleMethod): void {
    this.edgeMethod = method;
    this.syncEdgeColors();
    this.syncAnnotations();
    this.sidebar.refresh('edge');
  }

  private scheduleEdgeAngles(): void {
    clearTimeout(this.edgeTimer);
    this.edgeTimer = window.setTimeout(() => void this.updateEdgeAngles(), 40);
  }

  /** The edge angles of the curves measured (in slices): only of those that changed; the last request wins. */
  private async updateEdgeAngles(): Promise<void> {
    const token = ++this.edgeToken;
    const base = this.measureBase, loaded = this.loaded;
    if (!base || !loaded) return;
    const st = this.store.state;
    const curves = st.curves.filter((c) => measuresEdgeAngle(c, st.specimen.type));
    for (const id of [...this.edgeResults.keys()]) if (!curves.some((c) => c.id === id)) this.edgeResults.delete(id);
    const g = loaded.geometry;
    const candidates = bvhPlaneCandidates(g);
    for (const c of curves) {
      const line = this.lineOf(c);
      const key = JSON.stringify([line.points, line.closed, st.specimen.unit]);
      if (this.edgeResults.get(c.id)?.key === key) continue;
      const result = await runSliced(edgeAnglesSteps({ positions: g.getAttribute('position').array as Float32Array, index: g.index!.array as Uint32Array, offset: loaded.offset, points: line.points, closed: line.closed, unit: st.specimen.unit, meanEdge: base.meanEdge, candidates }));
      if (token !== this.edgeToken || this.loaded !== loaded) return;
      this.edgeResults.set(c.id, { key, result });
    }
    this.edgeDetails = null;
    this.sidebar.refresh('edge');
    this.syncAnnotations();
    this.updateRetouch();
    this.refreshHint();
    if (this.unsaved) {
      this.scheduleAutosave();
      this.scheduleFolderSave();
    }
  }

  // ------------------------------------------------------------ working edges

  workingEdgeDetails(): WorkingEdgeDetail[] {
    if (this.edgeDetails) return this.edgeDetails;
    const st = this.store.state;
    // a flake's: on another type its working edges stay in the file, with nothing measured on them
    if (!this.isFlake()) return (this.edgeDetails = []);
    const curves = st.curves.filter((c) => measuresEdgeAngle(c, st.specimen.type)).map((c) => ({ id: c.id, ...this.lineOf(c), stations: this.edgeResults.get(c.id)?.result?.stations ?? [], sharp: this.sharpOf(c.id)?.segments ?? null }));
    this.edgeDetails = workingEdgeDetails({ curves, edges: st.workingEdges, unit: st.specimen.unit, retouch: this.retouchIndex, volume: this.measureBase?.volume ?? null });
    return this.edgeDetails;
  }

  workingEdgesOn(curveId: string): Array<{ id: string; label: string; from: number; to: number; color: string }> {
    const st = this.store.state;
    const c = this.store.curve(curveId);
    const own = st.workingEdges.filter((e) => e.curveId === curveId);
    if (!c || !own.length) return [];
    return placedEdges(edgeAxis(this.lineOf(c), st.specimen.unit), own).map((p) => ({ id: p.edge.id, label: p.edge.label, from: p.range.from, to: p.range.to, color: workingEdgeColor(p.edge.label) }));
  }

  workingEdgeAt(curveId: string, position: number): string {
    const st = this.store.state;
    const c = this.store.curve(curveId);
    const own = st.workingEdges.filter((e) => e.curveId === curveId);
    if (!c || !own.length) return '';
    const axis = edgeAxis(this.lineOf(c), st.specimen.unit);
    const placed = placedEdges(axis, own);
    return placed[ownerAt(placed, position, axis.length)]?.edge.label ?? '';
  }

  /** Says why a working edge could not be made or changed. */
  private refuseEdge(r: WorkingEdgeRefusal): void {
    const text = r.reason === 'overlap' ? t('edges.refused.overlap', { with: r.with }) : r.reason === 'short' ? t('edges.refused.short', { min: WORKING_EDGE_MIN_MM }) : t('edges.refused.notMeasured');
    this.feedback.toast(text, 'warn');
  }

  private measuredIds(): Set<string> {
    const st = this.store.state;
    return new Set(st.curves.filter((c) => measuresEdgeAngle(c, st.specimen.type)).map((c) => c.id));
  }

  /** The curve measured under the cursor and the point on it; near an end of a working edge, that very point, so that the two can share it. */
  private edgePlaceAt(x: number, y: number, curveId: string | null): EdgePlace | null {
    const curves = this.curves, viewer = this.viewer;
    if (!curves || !viewer) return null;
    const ids = this.measuredIds();
    const near = curves.pickAmong(curveId ? new Set([...ids].filter((id) => id === curveId)) : ids, x, y, EDGE_PICK_PX);
    if (!near) return null;
    const c = this.store.curve(near.id)!;
    for (const e of this.store.state.workingEdges) {
      if (e.curveId !== near.id) continue;
      for (const p of [e.start, e.end]) {
        const s = viewer.project(new THREE.Vector3(p[0], p[1], p[2]));
        if (s.visible && Math.hypot(s.x - x, s.y - y) <= EDGE_SNAP_PX) return { curveId: near.id, point: p };
      }
    }
    return { curveId: near.id, point: pointOnCurve(this.lineOf(c), near.point) };
  }

  /** The curve under the cursor comes forward; a first point and the stretch so far are shown. */
  private previewEdge(first: EdgePlace | null, over: EdgePlace | null): void {
    const layer = this.workingEdgeLayer, curves = this.curves;
    if (!layer || !curves) return;
    curves.setHoverItem(over?.curveId ?? null);
    const n = this.store.state.nextWorkingEdgeNumber;
    const color = workingEdgeColor(`E${n}`);
    const c = first ? this.store.curve(first.curveId) : undefined;
    const stretch = c && first && over ? curveStretch(this.lineOf(c), first.point, over.point) : null;
    layer.setDraft(stretch, color, [first?.point, over?.point].filter((p): p is Vec3 => !!p));
  }

  private placeWorkingEdge(curveId: string, start: Vec3, end: Vec3): void {
    const out = addWorkingEdge(this.store, { curveId, start, end });
    if (out.refused) this.refuseEdge(out.refused);
    else this.selection.set(out.edge.id);
  }

  /** An end is dragged: along its curve, and no further than it may go. */
  private dragEdgeEnd(end: EdgeEnd, x: number, y: number): void {
    const st = this.store.state;
    const e = this.store.workingEdge(end.id);
    const c = e ? this.store.curve(e.curveId) : undefined;
    const to = c ? this.curves?.nearestPointOn(c.id, x, y) : null;
    if (!e || !c || !to) return;
    const line = this.lineOf(c);
    const point = clampedEnd(line, edgeAxis(line, st.specimen.unit), e, end.which, st.workingEdges.filter((o) => o.curveId === c.id && o.id !== e.id), to);
    this.edgeDrag = { ...end, point };
    this.syncWorkingEdges();
  }

  private finishEdgeDrag(commit: boolean): void {
    const d = this.edgeDrag;
    this.edgeDrag = null;
    if (commit && d) {
      const out = updateWorkingEdge(this.store, d.id, { [d.which]: d.point });
      if (out?.refused) this.refuseEdge(out.refused);
    }
    this.syncWorkingEdges();
  }

  /** The working edges on the model: bands where they are worked on, ticks where the curves show what is measured. */
  private syncWorkingEdges(): void {
    const layer = this.workingEdgeLayer, loaded = this.loaded;
    if (!layer) return;
    const st = this.store.state;
    if (!loaded || !this.isFlake() || (this.mode !== 'annotate' && this.mode !== 'measure' && this.mode !== 'retouch')) {
      layer.sync([], true, false, false, loaded?.offset ?? [0, 0, 0], [0, 0, 0]);
      return;
    }
    const drawn = st.workingEdges.flatMap((e): DrawnEdge[] => {
      const c = this.store.curve(e.curveId);
      if (!c) return [];
      const line = this.lineOf(c);
      // on the curve as it is now: it may have changed since
      const start = pointOnCurve(line, this.edgeDrag?.id === e.id && this.edgeDrag.which === 'start' ? this.edgeDrag.point : e.start);
      const end = pointOnCurve(line, this.edgeDrag?.id === e.id && this.edgeDrag.which === 'end' ? this.edgeDrag.point : e.end);
      return [{ id: e.id, label: e.label, version: `${c.modifiedAt}|${line.points.length}`, stretch: curveStretch(line, start, end), start, end, selected: e.id === this.selection.id }];
    });
    const mesh = st.mesh;
    const centre: Vec3 = mesh ? [(mesh.bboxMin[0] + mesh.bboxMax[0]) / 2, (mesh.bboxMin[1] + mesh.bboxMax[1]) / 2, (mesh.bboxMin[2] + mesh.bboxMax[2]) / 2] : [0, 0, 0];
    layer.sync(drawn, this.mode === 'annotate', this.mode === 'annotate' && this.tools?.activeId === 'select', this.display.arrows.labels, loaded.offset, centre);
  }

  generateWorkingEdges(): void {
    const curves = [...this.retouchResults.entries()].flatMap(([curveId, r]) => (r.result ? [{ curveId, stations: r.result.stations }] : []));
    const made = generateWorkingEdges(this.store, curves);
    this.feedback.toast(made ? t('edges.made', { n: made }) : t('edges.none'), made ? 'info' : 'warn');
  }

  otherEdgeStretch(id: string): void {
    const out = otherWorkingEdgeStretch(this.store, id);
    if (out?.refused) this.refuseEdge(out.refused);
  }

  focusWorkingEdge(id: string): void {
    if (this.planEdgeId === id) this.planEdgeId = null;
    else {
      this.planEdgeId = id;
      const d = this.workingEdgeDetails().find((x) => x.row.id === id);
      if (d && d.focus !== null) this.moveRetouchStation(d.row.curveId, d.focus);
    }
    this.drawPlan();
    this.sidebar.refresh('retouch');
  }

  planEdge(): string | null {
    return this.planEdgeId;
  }

  /** The curves' edge angles as the derived results hold them. */
  private edgeAngleCurves(): Array<EdgeAngleResult & { curveId: string }> {
    return this.store.state.curves.flatMap((c) => {
      const r = this.edgeResults.get(c.id)?.result;
      return r ? [{ curveId: c.id, ...r }] : [];
    });
  }

  /** The measure mode: the selected curve drawn by its angles (the middle distance), with the two ends of the scale beside it. */
  private syncEdgeColors(): void {
    const layer = this.edgeLayer, legend = this.edgeLegend, loaded = this.loaded;
    const retouching = this.mode === 'retouch';
    const c = retouching ? this.store.curve(this.retouchStation?.curveId ?? '') : this.mode === 'measure' ? this.store.curve(this.selection.id ?? '') : undefined;
    const r = c && measuresEdgeAngle(c, this.store.state.specimen.type) ? this.edgeAngleResult(c.id) : null;
    const rule = this.store.state.sharpEdge;
    const sharp = !retouching && c && r && this.edgeColorMode === 'sharp' ? this.sharpOf(c.id) : null;
    const stations = c && r ? this.edgeColorStations(c, r, sharp) : [];
    const values = stations.flatMap((s) => (s.value !== null && s.point ? [s.value] : []));
    if (!layer || !legend || !loaded || !c || values.length < 2) {
      if (this.edgeColorKey) layer?.clear();
      this.edgeColorKey = '';
      this.edgeColorCurve = null;
      if (legend) legend.hidden = true;
      return;
    }
    this.edgeColorCurve = c.id;
    const key = `${this.mode}|${c.id}|${retouching ? `${this.retouchMethod}|${this.retouchSeries}` : `${this.edgeMethod}|${this.edgeSeries}`}|${sharp ? JSON.stringify(rule) : ''}|${this.edgeResults.get(c.id)?.key}|${this.retouchResults.get(c.id)?.key}`;
    if (key === this.edgeColorKey) return;
    this.edgeColorKey = key;
    const lo = Math.min(...values), hi = Math.max(...values);
    const line = this.lineOf(c);
    layer.sync(valuesAlongCurve(line.points, line.closed, stations), line.closed, loaded.offset, sharp ? sharpPaint : rampPaint(lo, hi));
    const ramp = hi - lo < EDGE_ANGLE_FLAT_DEG ? EDGE_ANGLE_RAMP[2] : `linear-gradient(to right,${EDGE_ANGLE_RAMP.join(',')})`;
    clear(legend);
    if (sharp) {
      const swatch = (color: string) => h('span', { class: 'edge-legend-swatch', style: `background:${color}` });
      legend.append(
        swatch(SHARP_COLORS.sharp),
        h('span', { class: 'edge-legend-value', id: 'edge-legend-sharp' }, `≤ ${fmtNum(rule.threshold!, 1)}°`),
        swatch(SHARP_COLORS.other),
        h('span', { class: 'edge-legend-value', id: 'edge-legend-other' }, `> ${fmtNum(rule.threshold!, 1)}°`),
      );
      legend.hidden = false;
      return;
    }
    legend.append(
      h('span', { class: 'edge-legend-value', id: 'edge-legend-min' }, `${fmtQuantity('angle', lo)}°`),
      h('span', { class: 'edge-legend-ramp', style: `background:${ramp}` }),
      h('span', { class: 'edge-legend-value', id: 'edge-legend-max' }, `${fmtQuantity('angle', hi)}°`),
    );
    legend.hidden = false;
  }

  // ------------------------------------------------------------ profile panel

  /** The technical frame in the mesh's own coordinates (they are re-centred). */
  private localFrame(): { frame: ReturnType<typeof frameAxes>; offset: Vec3 } | null {
    const m = this.isFlake() ? this.store.state.flake.axis?.matrix : null;
    const o = this.loaded?.offset;
    if (!m || !o) return null;
    const f = frameAxes(m);
    return { frame: { ...f, origin: [f.origin[0] - o[0], f.origin[1] - o[1], f.origin[2] - o[2]] }, offset: o };
  }

  private profileShown(): boolean {
    return this.display.profile && this.mode !== 'compare' && this.mode !== 'retouch' && this.hasMesh() && !!this.localFrame();
  }

  private buildProfilePanel(): void {
    const panel = floatingPanel({
      id: 'profile',
      title: t('profile.title'),
      pref: 'profilePanel',
      area: this.viewportEl,
      onClose: () => this.setDisplay((d) => (d.profile = false), 'profile'),
    });
    const content = new ProfilePanel();
    content.onMove = (f) => this.moveProfile(f);
    panel.body.append(content.el);
    if (this.profileEl) this.profileEl.replaceWith(panel.el);
    else this.viewportEl.append(panel.el);
    this.profileEl = panel.el;
    this.profileFit = panel.fit;
    this.profilePanel = content;
    this.updateProfile();
  }

  /** Show or hide the panel, and draw what it shows. */
  private updateProfile(): void {
    const el = this.profileEl, panel = this.profilePanel;
    if (!el || !panel) return;
    const shown = this.profileShown();
    const was = !el.hidden;
    el.hidden = !shown;
    const local = this.localFrame();
    const m = this.flake?.measures;
    if (!shown || !local || !m || m.tech_length === null) {
      panel.setContent(null);
      this.ringLayer?.clear();
      return;
    }
    panel.setContent({
      frame: local.frame,
      section: this.flake!.section,
      geometry: this.flake!.geometry,
      offset: local.offset,
      techLength: m.tech_length,
      techWidth: m.tech_width ?? 0,
      techThickness: m.tech_thickness ?? 0,
      unit: this.store.state.specimen.unit,
    });
    if (!was) this.profileFit?.();
    this.syncCrossSection();
  }

  /** The slider, the marker: the section across is cut at most once a frame. */
  private moveProfile(fraction: number): void {
    this.profileAt = fraction;
    if (this.profileFrame) return;
    this.profileFrame = requestAnimationFrame(() => {
      this.profileFrame = 0;
      this.syncCrossSection();
    });
  }

  private syncCrossSection(): void {
    const panel = this.profilePanel, loaded = this.loaded;
    const local = this.localFrame();
    const len = this.flake?.measures.tech_length ?? null;
    if (!panel || !loaded || !local || len === null || !this.profileShown()) {
      this.profileCross = null;
      this.ringLayer?.clear();
      return;
    }
    const g = loaded.geometry;
    const cross = crossSectionAt(g.getAttribute('position').array as Float32Array, g.index!.array as Uint32Array, local.frame, this.profileAt * len, bvhPlaneCandidates(g));
    this.profileCross = cross;
    panel.setCross(this.profileAt, cross);
    // the ring on the model
    const o = local.offset;
    const chains = cross.lines.map((l: SectionLine) => {
      const pts = l.points.map((p): Vec3 => [p[0] + o[0], p[1] + o[1], p[2] + o[2]]);
      return l.closed ? [...pts, pts[0]] : pts;
    });
    this.ringLayer?.sync(`${this.profileAt}|${JSON.stringify(this.store.state.flake.axis?.matrix)}`, chains, o);
  }

  /** Pieces of surface between these curves (in slices); null when the mesh is not ready or changed meanwhile. `specimen`: the type they belong to (an observer's own). */
  private async partitionFor(curves: readonly Curve[], specimen?: SpecimenType): Promise<Partition | null> {
    const base = this.measureBase;
    const loaded = this.loaded;
    const barrier = await this.barrierFor(curves, specimen);
    if (!barrier || !base || !loaded || this.loaded !== loaded) return null;
    const g = loaded.geometry;
    const part = await runSliced(regionsSteps(g.getAttribute('position').array as Float32Array, g.index!.array as Uint32Array, base.edges, barrier));
    return this.loaded === loaded ? part : null;
  }

  /** The mesh edges along these curves (in slices), as vertex pairs; null when the mesh is not ready or changed meanwhile. */
  private async barrierFor(curves: readonly Curve[], specimen?: SpecimenType): Promise<number[] | null> {
    return (await this.curveChains(curves, specimen))?.flat() ?? null;
  }

  /** The mesh edges along each of these curves (in slices), as vertex pairs; null when the mesh is not ready or changed meanwhile. */
  private async curveChains(curves: readonly Curve[], specimen: SpecimenType = this.store.state.specimen.type): Promise<number[][] | null> {
    const base = this.measureBase;
    const loaded = this.loaded;
    const snap = this.surfaceSnap;
    if (!base || !loaded || !snap) return null;
    await snap.prepare('off');
    if (this.loaded !== loaded) return null;
    const search = snap.search(3);
    const path = (a: number, b: number) => {
      if (!search) return null;
      search.start(a, null);
      return search.reach(b) ? search.path(b) : null;
    };
    const chains: number[][] = [];
    for (const c of curves) {
      const chain = await runSliced(polylineEdgesSteps(c.points, c.closed, (p) => snap.nearestVertex(p), base.edges, path));
      if (this.loaded !== loaded) return null;
      chains.push(chain);
    }
    const joined = await runSliced(joinOpenEndsSteps(chains, curves.map((c) => !c.closed), loaded.geometry.getAttribute('position').array as Float32Array, JOIN_REACH_EDGES * base.meanEdge, path, curves.map((c) => isBoundaryCurve(c.attributes.type, specimen)), curves.map((c) => isBoundaryCurve(c.attributes.type, specimen) || (specimen === 'flake' && c.attributes.type === 'retouch'))));
    return this.loaded === loaded ? joined : null;
  }

  /** Which piece each region's seed falls in; areas, totals and conflicts; repaint. */
  private resolveRegionsNow(): void {
    let part = this.partition;
    const base = this.measureBase;
    if (!part || !base) return;
    const st = this.store.state;
    this.applyBands();
    part = this.partition ?? part;
    this.seedComponent = st.regions.map((r) => (!this.inLowerLayer(st, r) ? -1 : r.curveId ? (this.bandPiece.get(r.id) ?? -1) : this.componentAt(r.seed)));
    const up = this.upper;
    this.upperComponent = up ? this.upperComponents(st, up.partition, this.platformOutline() ? (this.platformAuto?.seed ?? null) : null) : st.regions.map(() => -1);
    this.regions = resolveRegions(st.regions, this.seedComponent, part, base.surfaceArea, up && !this.isGeneric() ? { component: this.upperComponent, partition: up.partition, over: up.over } : null);
    const conflicts = this.regions.results.filter((r) => r.conflict).map((r) => r.id).join(',');
    if (conflicts && conflicts !== this.conflictKey) this.feedback.toast(t('toast.regionConflict'), 'warn', 4000);
    this.conflictKey = conflicts;
    this.paintRegions();
    this.updateNodule();
    this.updateBorders();
    this.updateRegionFits();
    this.scheduleFlake();
    this.scheduleRetouchAngles();
    this.scheduleGm();
    this.sidebar.refresh('regions');
    this.updateStatus();
  }

  /** The planes fitted to surface regions (in slices), once the regions are known. */
  private updateRegionFits(): void {
    const token = ++this.regionFitToken;
    const part = this.partition, loaded = this.loaded;
    const st = this.store.state;
    const planes = st.planes.filter((p) => p.method === 'region');
    if (!part || !loaded || !planes.length) {
      if (this.regionFits.size) {
        this.regionFits = new Map();
        this.updatePlanes();
      }
      return;
    }
    const g = loaded.geometry;
    void (async () => {
      const fits = new Map<string, { centroid: Vec3; normal: Vec3; count: number }>();
      for (const p of planes) {
        const pieces = new Set<number>(), upperPieces = new Set<number>();
        for (const id of p.regionIds) {
          const i = st.regions.findIndex((r) => r.id === id);
          if (this.seedComponent[i] >= 0) pieces.add(this.seedComponent[i]);
          if (this.upperComponent[i] >= 0) upperPieces.add(this.upperComponent[i]);
        }
        if (!pieces.size && !upperPieces.size) continue;
        const lower = await runSliced(facesOfPiecesSteps(part, pieces));
        const above = this.upper && upperPieces.size ? await runSliced(facesOfPiecesSteps(this.upper.partition, upperPieces)) : new Uint32Array(0);
        const faces = Uint32Array.from(new Set([...lower, ...above]));
        const fit = await runSliced(regionPlaneSteps(g.getAttribute('position').array as Float32Array, g.index!.array as Uint32Array, faces, loaded.offset));
        if (token !== this.regionFitToken) return;
        if (fit) fits.set(p.id, fit);
      }
      this.regionFits = fits;
      this.updatePlanes();
      this.syncAnnotations();
    })();
  }

  towardViewer(): Vec3 {
    return this.viewer?.towardViewer() ?? [0, 0, 1];
  }

  // ------------------------------------------------------------ workspace

  workspaceInfo(): { name: string; writable: boolean; meshes: string[]; index: number; started: boolean[]; types: Array<SpecimenType | null>; completion: Array<{ done: number; total: number } | null>; gm: Array<{ done: boolean; flagged: number } | null>; template: string | null; undownloaded: number } | null {
    const ws = this.workspace;
    if (!ws) return null;
    const models = ws.meshes.map((p, i) => this.modelProject(p, i));
    return { name: ws.name, writable: ws.writable, meshes: ws.meshes, index: this.wsIndex, started: ws.meshes.map((p) => this.started(p)), types: models.map((m) => m?.state.specimen.type ?? null), completion: models.map((m) => {
      if (!m) return null;
      const { done, total } = annotationStatus(m.state, m.regions);
      return { done, total };
    }), gm: ws.meshes.map((p, i) => this.modelGm(p, i)), template: this.store.state.gm.template?.file ?? this.folderGm?.template?.file ?? null, undownloaded: this.undownloadedCount() };
  }

  /** How a model's points stand, as far as they are known, when points have been asked for (null: they have not, or there is no project). */
  private modelGm(path: string, i: number): { done: boolean; flagged: number } | null {
    const m = this.modelProject(path, i);
    const config = this.folderGm ?? this.store.state.gm;
    if (!m || !gmInUse(config, m.state.specimen.type)) return null;
    if (i === this.wsIndex && this.hasMesh()) return gmStanding(this.gm);
    const seen = this.gmSeen.get(path);
    if (seen) return seen;
    const index = this.projectIndex;
    const stored = (index?.get(projectPathFor(path)) ?? index?.get(legacyProjectPathFor(path)))?.derived.gm as GmDerived | null | undefined;
    // points made by another configuration say nothing of this one
    return gmStanding(stored && sameGmConfig(stored.config, config) ? stored : null);
  }

  /** The open model's project, or what its project file holds, with the regions found on the mesh, as far as they are known (null: no project, or none read yet). */
  private modelProject(path: string, i: number): { state: Readonly<ProjectState>; regions: ReadonlyArray<{ type: string; area: number | null }> | null } | null {
    if (i === this.wsIndex && this.hasMesh()) return { state: this.store.state, regions: this.regions?.results ?? [] };
    const index = this.projectIndex;
    const file = index?.get(projectPathFor(path)) ?? index?.get(legacyProjectPathFor(path));
    if (!file) return null;
    const stored = file.derived.regions;
    return { state: file.state, regions: Array.isArray(stored) && stored.length ? (stored as Array<{ type: string; area: number | null }>) : null };
  }

  /** A model has a project (in the folder, from an earlier version next to it, or edited in this session); none are read for this. */
  private started(path: string): boolean {
    const ws = this.workspace;
    return !!ws && (this.sessionProjects.has(path) || ws.has(projectPathFor(path)) || ws.has(legacyProjectPathFor(path)));
  }

  /** Open a folder of models: writable through the File System Access API, else read from a directory upload. */
  async openFolder(): Promise<void> {
    if (this.batch) return;
    const pick = folderPicker();
    if (pick) {
      try {
        await this.useWorkspace(await workspaceFromHandle(await pick()));
        return;
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return;
        // not allowed here (e.g. inside a frame): read the folder instead
      }
    }
    this.folderInput.click();
  }

  private async useWorkspace(ws: Workspace): Promise<void> {
    await this.flushFolderSave();
    if (!ws.meshes.length) {
      this.feedback.toast(t('workspace.empty', { name: ws.name }), 'warn');
      return;
    }
    // edits of a read-only folder that were not downloaded would be lost with it
    if (this.lossOnLeaving() && !(await this.feedback.confirm(t('dlg.closeModel.title'), t('dlg.closeModel.notDownloaded'), t('dlg.closeModel.yes'), t('dlg.cancel')))) return;
    this.workspace = ws;
    this.wsIndex = -1;
    this.updateStartPage();
    const { ids, duplicates } = specimenIds(ws.meshes);
    this.wsIds = ids;
    this.wsDuplicates = duplicates;
    this.projectIndex = new ProjectIndex(() => ws.projects, async (p) => (await ws.read(p)).text());
    this.sessionProjects.clear();
    this.undownloaded.clear();
    this.gmSeen.clear();
    this.folderSharp = await this.readFolderSharp(ws);
    this.folderGm = await this.readFolderGm(ws);
    this.sidebar.refresh('workspace');
    // the list shows each model's type: every project file is read once, in the background
    const index = this.projectIndex;
    void index.ready().then(() => {
      if (this.projectIndex === index) this.sidebar.refresh('workspace');
    });
    await this.openWorkspaceMesh(0);
  }

  /** The project files that may be model `path`'s, best first: edited in this session, in LithicAnalyst/projects, next to the model (earlier versions). */
  private async folderProjects(path: string): Promise<ProjectState[]> {
    const ws = this.workspace;
    if (!ws) return [];
    const out: ProjectState[] = [];
    const session = this.sessionProjects.get(path);
    if (session) out.push(parseProjectFile(JSON.parse(session)));
    for (const p of [projectPathFor(path), legacyProjectPathFor(path)]) {
      if (!ws.has(p)) continue;
      // read once: what the index holds already is not read again
      const known = this.projectIndex?.get(p);
      try {
        out.push(known ? structuredClone(known.state) : parseProjectFile(JSON.parse(await (await ws.read(p)).text())));
      } catch (e) {
        this.feedback.toast(t('error.project', { msg: `${p}: ${(e as Error).message}` }), 'error');
      }
    }
    return out;
  }

  /** Open model `i` of the folder with its project (the first of its project files made on this very model). */
  async openWorkspaceMesh(i: number, quiet = false): Promise<void> {
    const ws = this.workspace;
    if (!ws || i < 0 || i >= ws.meshes.length) return;
    await this.flushFolderSave();
    const path = ws.meshes[i];
    const projects = await this.folderProjects(path);
    this.wsIndex = i;
    await this.openMeshFile(await ws.read(path), { project: projects, quiet, specimenId: this.wsIds.get(path) });
    if (this.store.state.mesh?.fileName !== baseName(path)) this.wsIndex = -1;
    this.sidebar.refresh('workspace');
  }

  stepWorkspace(step: number): void {
    const ws = this.workspace;
    if (!ws || this.batch) return;
    const i = Math.max(0, Math.min(ws.meshes.length - 1, (this.wsIndex < 0 ? 0 : this.wsIndex) + step));
    if (i !== this.wsIndex) void this.openWorkspaceMesh(i);
  }

  /** The next model (after the open one, round to the start) without a project. */
  nextUnstarted(): void {
    const ws = this.workspace;
    if (!ws || this.batch) return;
    const n = ws.meshes.length;
    for (let k = 1; k <= n; k++) {
      const i = ((this.wsIndex < 0 ? -1 : this.wsIndex) + k + n) % n;
      if (i !== this.wsIndex && !this.started(ws.meshes[i])) {
        void this.openWorkspaceMesh(i);
        return;
      }
    }
    this.feedback.toast(t('workspace.allStarted'), 'info', 2000);
  }

  /** Keep the open model's project up to date: in the folder, or (read-only folder) in this session's memory. */
  private scheduleFolderSave(): void {
    if (!this.workspace || this.wsIndex < 0) return;
    clearTimeout(this.folderSaveTimer);
    this.folderSaveTimer = window.setTimeout(() => void this.flushFolderSave(), 800);
  }

  private async flushFolderSave(): Promise<void> {
    if (!this.folderSaveTimer) return;
    clearTimeout(this.folderSaveTimer);
    this.folderSaveTimer = 0;
    this.keepSessionProject();
    const ws = this.workspace;
    const st = this.store.state;
    if (!ws?.writable || this.wsIndex < 0 || st.mesh?.fileName !== baseName(ws.meshes[this.wsIndex])) return;
    const path = projectPathFor(ws.meshes[this.wsIndex]);
    const file = serializeProject(st, __APP_VERSION__, this.meshResults());
    try {
      await ws.write(path, JSON.stringify(file, null, 2));
      this.projectIndex?.add(path, structuredClone(file));
      this.sidebar.refresh('workspace');
    } catch (e) {
      this.feedback.toast(t('workspace.saveFailed', { msg: (e as Error).message }), 'error');
    }
  }

  /** A read-only folder: the open model's project is kept in memory for the session (not in the browser's small storage). */
  private keepSessionProject(): void {
    const ws = this.workspace;
    const st = this.store.state;
    if (!ws || ws.writable || this.wsIndex < 0 || !this.unsaved || st.mesh?.fileName !== baseName(ws.meshes[this.wsIndex])) return;
    const path = ws.meshes[this.wsIndex];
    const file = serializeProject(st, __APP_VERSION__, this.meshResults());
    this.sessionProjects.set(path, JSON.stringify(file, null, 2));
    this.projectIndex?.add(projectPathFor(path), structuredClone(file));
    this.undownloaded.add(path);
    this.unsaved = false;
    this.sidebar.refresh('workspace');
  }

  /** Models of a read-only folder edited and not downloaded since (the open one included). */
  private undownloadedCount(): number {
    const ws = this.workspace;
    if (!ws || ws.writable) return 0;
    const open = this.wsIndex >= 0 && this.unsaved ? ws.meshes[this.wsIndex] : null;
    return this.undownloaded.size + (open && !this.undownloaded.has(open) ? 1 : 0);
  }

  /** Leaving the folder (or the page) would lose edits not downloaded. */
  private lossOnLeaving(): boolean {
    return this.undownloadedCount() > 0;
  }

  /** Read-only folder: every project edited in this session, as LithicAnalyst/projects/… in one ZIP to unpack into the folder. */
  async downloadProjects(): Promise<void> {
    const ws = this.workspace;
    if (!ws || ws.writable) return;
    clearTimeout(this.folderSaveTimer);
    this.folderSaveTimer = 0;
    this.keepSessionProject();
    if (!this.sessionProjects.size) return;
    const enc = new TextEncoder();
    const name = `${fileStem(ws.name, 'folder')}_projects.zip`;
    const files = [...this.sessionProjects].map(([p, text]) => ({ name: projectPathFor(p), data: enc.encode(text) }));
    if (this.folderSharp) files.push({ name: SHARP_EDGE_FILE, data: enc.encode(JSON.stringify(this.folderSharp, null, 2)) });
    if (this.folderGm) files.push({ name: GM_CONFIG_FILE, data: enc.encode(JSON.stringify(this.folderGm, null, 2)) });
    const outcome = await saveFile(name, zipStored(files), 'application/zip');
    if (outcome === 'saved') {
      this.undownloaded.clear();
      this.feedback.toast(t('toast.saved', { name }));
    } else this.feedback.toast(t(outcome === 'declined' ? 'toast.declined' : outcome === 'busy' ? 'toast.busy' : 'export.zipFailed'), outcome === 'declined' ? 'info' : 'warn');
    this.sidebar.refresh('workspace');
  }

  batchInfo(): { kind: 'measure' | 'figures'; done: number; total: number; failed: number; paused: boolean; eta: number | null } | null {
    const b = this.batch;
    if (!b) return null;
    // the time per model so far (pauses left out) for the models left
    const active = performance.now() - b.started - b.pausedMs - (b.pausedAt ? performance.now() - b.pausedAt : 0);
    const eta = b.done > 0 && b.done < b.total ? ((active / b.done) * (b.total - b.done)) / 1000 : null;
    return { kind: b.kind, done: b.done, total: b.total, failed: b.failed, paused: b.pausedAt !== null, eta };
  }

  cancelBatch(): void {
    if (this.batch) this.batch.cancelled = true;
  }

  private startBatch(kind: 'measure' | 'figures', total: number): NonNullable<App['batch']> {
    const b = (this.batch = { kind, done: 0, total, failed: 0, cancelled: false, started: performance.now(), pausedMs: 0, pausedAt: null as number | null });
    this.sidebar.refresh('workspace');
    // the remaining time counts down between models too
    this.batchTimer = window.setInterval(() => this.sidebar.refresh('workspace'), 1000);
    return b;
  }

  private endBatch(): void {
    this.batch = null;
    clearInterval(this.batchTimer);
    this.sidebar.refresh('workspace');
  }

  /**
   * Somewhere to put the files of one export: a new folder `LithicAnalyst/<kind>/<time>/` of a
   * writable folder (files written as they come), or, for a read-only folder, a ZIP of the same
   * layout downloaded at the end. `finish` writes the manifest and says where it all went.
   */
  private async exportSink(kind: 'exports' | 'figures'): Promise<{ base: string; put: (name: string, data: string | Uint8Array) => Promise<void>; finish: (m: Omit<Manifest, 'files'>) => Promise<string | null> }> {
    const ws = this.workspace!;
    const base = await freshFolder(`${APP_DIR}/${kind}/${timeStamp(new Date())}`, (p) => ws.exists(p));
    const held: Array<{ name: string; data: Uint8Array }> = [];
    const names: string[] = [];
    const enc = new TextEncoder();
    const put = async (name: string, data: string | Uint8Array) => {
      names.push(name);
      if (ws.writable) await ws.write(`${base}/${name}`, data);
      else held.push({ name: `${base}/${name}`, data: typeof data === 'string' ? enc.encode(data) : data });
    };
    const finish = async (m: Omit<Manifest, 'files'>): Promise<string | null> => {
      await put('manifest.json', manifestJson({ ...m, files: [...names] }));
      if (ws.writable) return `${base}/`;
      const zip = `${fileStem(ws.name, 'folder')}_${kind}_${base.split('/').pop()}.zip`;
      const outcome = await saveFile(zip, zipStored(held), 'application/zip');
      return outcome === 'saved' ? zip : null;
    };
    return { base, put, finish };
  }

  /** How the open specimen's points are made; none asked for is no template used. */
  private gmManifestOfOpen(): ReturnType<typeof gmManifest> {
    const config = this.folderGm ?? this.store.state.gm;
    const type = this.store.state.specimen.type;
    return gmManifest(config, gmInUse(config, type) && usesTemplate(config, type));
  }

  private manifestBase(scope: Manifest['scope'], kind: Manifest['kind'], options: Record<string, unknown>): Omit<Manifest, 'files' | 'specimens' | 'failures'> {
    return {
      app: { name: 'LithicAnalyst', version: __APP_VERSION__ },
      createdAt: new Date().toISOString(),
      scope,
      folder: this.workspace?.name ?? null,
      kind,
      options,
      parameters: { flake: FLAKE_PARAMETERS, edgeAngle: EDGE_ANGLE_PARAMETERS, measuredLine: MEASURED_LINE_PARAMETERS, retouchIndex: RETOUCH_INDEX_PARAMETERS, workingEdge: WORKING_EDGE_PARAMETERS, sharpEdge: { ...SHARP_EDGE_PARAMETERS, rule: this.folderSharp ?? this.store.state.sharpEdge }, gm: gmConfigSummary(this.folderGm ?? this.store.state.gm), gmTemplate: GM_TEMPLATE_PARAMETERS, tps: TPS_PARAMETERS },
      gm: this.gmManifestOfOpen(),
      duplicateNames: this.wsDuplicates,
    };
  }

  /** "Done N, failed M", and where the files went. */
  private batchToast(done: number, failures: readonly BatchFailure[], where: string | null): void {
    const parts = [t('batch.done', { n: done, m: failures.length })];
    if (where) parts.push(t('batch.written', { path: where }));
    this.feedback.toast(parts.join(' · '), failures.length ? 'warn' : 'info', 6000);
  }

  /** The batch worker (inlined into the page); null where workers cannot be made. */
  private workerFactory(): (() => Worker) | null {
    return typeof Worker === 'function' ? () => new BatchWorker() : null;
  }

  /** Summary export (whole folder): the tables of every model, merged by kind, in a new export folder. */
  private async exportFolder(bom: boolean): Promise<void> {
    const ws = this.workspace;
    if (!ws || this.batch) return;
    await this.flushFolderSave();
    this.keepSessionProject();
    const batch = this.startBatch('measure', ws.meshes.length);
    let measurer: MeshMeasurer | null = null;
    try {
      const index = this.projectIndex!;
      await index.ready();
      measurer = await createMeasurer(this.workerFactory());
      const specimens: BatchSpecimen[] = [];
      const listed: Manifest['specimens'] = [];
      const failures: BatchFailure[] = [];
      for (const [i, path] of ws.meshes.entries()) {
        if (batch.cancelled) break;
        // each model on its own: one that cannot be read or measured is listed and left out
        try {
          const { specimen, entry } = await this.folderSpecimen(i, path, index, measurer);
          specimens.push(specimen);
          listed.push(entry);
        } catch (e) {
          failures.push({ file: path, reason: e instanceof Error ? e.message : String(e) });
          measurer.drop(i);
          batch.failed++;
        }
        batch.done++;
        this.sidebar.refresh('workspace');
      }
      if (batch.cancelled) return;
      const sink = await this.exportSink('exports');
      // the folder's rule judges every model of it
      const sharp = this.folderSharp;
      const judged = sharp ? specimens.map((s) => ({ ...s, state: { ...s.state, sharpEdge: sharp } })) : specimens;
      for (const f of batchOutputs(judged, { excelBom: bom })) await sink.put(f.suffix, f.text);
      // the same points on every flake
      await this.gmOfFolder(judged, this.folderGm ?? this.store.state.gm, measurer);
      const gm = gmOutputs(judged, { excelBom: bom });
      for (const f of gm.files) await sink.put(f.suffix, f.text);
      if (failures.length) await sink.put('failures.csv', failuresCsv(failures, bom));
      const config = this.folderGm ?? this.store.state.gm;
      const where = await sink.finish({ ...this.manifestBase('folder', 'tables', { excelBom: bom, worker: measurer.inWorker }), specimens: listed, failures, gmSkipped: gm.skipped, gmIncomplete: gm.incomplete, gm: gmManifest(config, judged.some((s) => s.gm?.method === 'template')) });
      this.batchToast(specimens.length, failures, where);
    } catch (e) {
      this.feedback.toast((e as Error).message, 'error');
    } finally {
      measurer?.dispose();
      this.endBatch();
    }
  }

  /**
   * One model of a summary export: its checksum finds its projects (the index); their stored
   * results are used when they can stand for the model, else the model is read and measured (in
   * the worker). The open model uses what is on screen.
   */
  private async folderSpecimen(i: number, path: string, index: ProjectIndex, measurer: MeshMeasurer): Promise<{ specimen: BatchSpecimen; entry: Manifest['specimens'][number] }> {
    const ws = this.workspace!;
    const sha = await measurer.hash(i, await ws.read(path));
    const own = projectPathFor(path), old = legacyProjectPathFor(path);
    const asBatch = (p: IndexedProject): BatchProject => ({ path: p.path, state: p.state, derived: p.derived, appVersion: p.appVersion });
    let projects = index.forMesh(sha).map(asBatch);
    // the copy an earlier version kept next to the model gives way to the one in LithicAnalyst/projects
    if (projects.some((p) => p.path === own)) projects = projects.filter((p) => p.path !== old);
    let primary = projects.find((p) => p.path === own) ?? projects.find((p) => p.path === old) ?? projects[0] ?? null;
    const loaded = this.loaded, base = this.measureBase;
    const open = this.store.state.mesh?.sha256 === sha && !!loaded && !!base;
    let measure: (p: BatchProject, k: number) => ModelMeasures;
    if (open) {
      // the open model: its current annotations and results
      measurer.drop(i);
      const live: BatchProject = {
        path: primary?.path ?? own,
        state: structuredClone(this.store.state) as ProjectState,
        derived: { regions: this.regions?.results ?? [], regionTotals: this.regions?.totals ?? null, nodule: this.nodule, split: this.split, planes: this.planes, flake: this.flake ? { measures: this.flake.measures } : null, edgeAngles: { curves: this.edgeAngleCurves() }, retouchAngles: { curves: this.retouchAngleCurves() }, retouchIndices: this.retouchIndex?.indices ?? null, workingEdges: { edges: this.workingEdgeDetails().map((d) => d.row) }, gm: this.gm ? { config: this.store.state.gm, ...this.gm } : null },
        appVersion: __APP_VERSION__,
      };
      projects = projects.map((p) => (p === primary ? live : p));
      primary = live;
      const positions = loaded!.geometry.getAttribute('position').array as Float32Array;
      const vertices = this.vertexAxes();
      measure = (p) => {
        const m = frameMeasures(positions, base!, p.state.specimen.frame, loaded!.offset);
        return { auto: m.auto, vertices, box: m.box };
      };
    } else {
      const fresh: BatchProject = { path: null, state: emptyProject(), derived: {}, appVersion: __APP_VERSION__ };
      fresh.state.specimen.id = this.wsIds.get(path) ?? baseName(path).replace(/\.[^.]+$/, '');
      primary ??= fresh;
      if (projects.length && projects.every((p) => savedResultsUsable(p, __APP_VERSION__))) {
        measurer.drop(i);
        measure = (p) => savedMeasures(p);
      } else {
        const asked = projects.length ? projects : [primary];
        const m = await measurer.measure(i, asked.map((p) => p.state.specimen.frame));
        measure = (p) => ({ auto: m.auto[Math.max(0, asked.indexOf(p))], vertices: m.vertices, box: m.boxes[Math.max(0, asked.indexOf(p))] });
      }
    }
    const rows = projects.map((p, k) => ({ project: p, measures: measure(p, k) }));
    const specimen = batchSpecimen(path, { project: primary, measures: measure(primary, -1) }, rows);
    return { specimen, entry: { id: primary.state.specimen.id, file: path, sha256: sha, project: primary.path, annotator: primary.state.specimen.annotator } };
  }

  /** Wait until what a figure shows is computed (measurements, regions, sections). */
  private async settled(): Promise<void> {
    const t0 = performance.now();
    while (performance.now() - t0 < 120_000) {
      const st = this.store.state;
      const cutsDone = (ids: string[]) => ids.every((id) => this.cuts.get(id)?.lines !== undefined);
      const planes = this.figure.overlays.planes ? this.planes.filter((p) => p.valid && this.store.plane(p.id)?.visible).map((p) => p.id) : [];
      const ready = !!this.measureBase && (!st.regions.length || !!this.regions) && cutsDone(planes) && cutsDone(st.sections.filter((x) => x.inFigure).map((x) => x.id));
      if (ready) return;
      await nextFrame();
    }
  }

  /** Rendering needs the page in front: wait while it is in the background (shown as paused). */
  private async whileHidden(batch: NonNullable<App['batch']>): Promise<void> {
    if (document.visibilityState !== 'hidden') return;
    batch.pausedAt = performance.now();
    this.sidebar.refresh('workspace');
    await new Promise<void>((resolve) => {
      const on = () => {
        if (document.visibilityState === 'hidden') return;
        document.removeEventListener('visibilitychange', on);
        resolve();
      };
      document.addEventListener('visibilitychange', on);
    });
    batch.pausedMs += performance.now() - batch.pausedAt;
    batch.pausedAt = null;
    this.sidebar.refresh('workspace');
  }

  /** The figure of every model, with the same presentation settings, in a new figures folder (by the models' subfolders). */
  private async batchFigures(format: 'png' | 'svg'): Promise<void> {
    const ws = this.workspace;
    if (!ws || this.batch) return;
    await this.flushFolderSave();
    this.keepSessionProject();
    const start = this.wsIndex;
    const batch = this.startBatch('figures', ws.meshes.length);
    // keep the screen on (if the browser lets us); taken again after the page was in the background
    type Lock = { release(): Promise<void> };
    let lock: Lock | null = null;
    const wake = async () => {
      try {
        lock = (await (navigator as unknown as { wakeLock?: { request(k: string): Promise<Lock> } }).wakeLock?.request('screen')) ?? null;
      } catch {
        lock = null;
      }
    };
    await wake();
    const failures: BatchFailure[] = [];
    const listed: Manifest['specimens'] = [];
    try {
      const sink = await this.exportSink('figures');
      for (const [i, path] of ws.meshes.entries()) {
        if (batch.cancelled) break;
        if (document.visibilityState === 'hidden') {
          await this.whileHidden(batch);
          await wake();
        }
        try {
          await this.openWorkspaceMesh(i, true);
          if (this.wsIndex !== i) throw new Error(t('batch.notOpened'));
          await this.settled();
          await nextFrame();
          const fig = this.makeFigure();
          if (!fig) throw new Error(t('batch.noFigure'));
          const dir = path.includes('/') ? `${path.slice(0, path.lastIndexOf('/'))}/` : '';
          const name = fileStem(this.stem().split('/').pop() ?? '', 'specimen');
          await sink.put(`${dir}${name}_figure.${format}`, format === 'png' ? await fig.png() : await fig.svg());
          const st = this.store.state;
          listed.push({ id: st.specimen.id, file: path, sha256: st.mesh?.sha256 ?? null, project: this.started(path) ? projectPathFor(path) : null, annotator: st.specimen.annotator });
        } catch (e) {
          const msg = e instanceof FigureError && e.code === 'tooLarge' ? t('figure.tooLarge', { msg: e.message }) : e instanceof Error ? e.message : String(e);
          failures.push({ file: path, reason: msg });
          batch.failed++;
        }
        batch.done++;
        this.sidebar.refresh('workspace');
      }
      if (!batch.cancelled) {
        if (failures.length) await sink.put('failures.csv', failuresCsv(failures, this.display.excelBom));
        const where = await sink.finish({ ...this.manifestBase('folder', 'figures', { format, figure: structuredClone(this.figure) }), specimens: listed, failures });
        this.batchToast(listed.length, failures, where);
      }
    } catch (e) {
      this.feedback.toast((e as Error).message, 'error');
    } finally {
      await (lock as Lock | null)?.release().catch(() => {});
      this.endBatch();
      if (start >= 0) await this.openWorkspaceMesh(start, true);
    }
  }

  // ------------------------------------------------------------ export

  /** The data files the current mode exports (figures and sections have their own buttons). */
  private exportables(bom: boolean): Array<{ key: string; label: string; name: string; available: boolean; text: () => string }> {
    const st = this.store.state;
    const stem = this.stem();
    const opts = { excelBom: bom };
    const csv = (key: string, label: string, suffix: string, available: boolean, text: () => string) => ({ key, label, name: `${stem}_${suffix}`, available, text });
    if (this.mode === 'annotate') {
      const lm = this.landmarks;
      return [
        csv('scar-vectors', t('export.csv'), 'scar_vectors.csv', st.scars.some(hasVector), () => scarVectorCsv(st, opts, this.configResult)),
        // a core's; a flake has none
        ...(this.isCore()
          ? [
              csv('configuration', t('export.configuration'), 'configuration.csv', !!this.configResult, () => configurationCsv(st, this.configResult, opts)),
              csv('flaking-surfaces', t('export.flakingSurfaces'), 'flaking_surfaces.csv', !!this.configResult?.surfaces.length, () => flakingSurfacesCsv(st, this.configResult, opts)),
            ]
          : []),
        csv('curves', t('export.curvesCsv'), 'curves.csv', st.curves.length > 0, () => curveCsv(st, opts)),
        csv('regions', t('export.regions'), 'regions.csv', !!this.regions?.results.length, () => regionsCsv(st, this.regions?.results ?? [], opts)),
        ...(this.isGeneric()
          ? []
          : [
              csv('relations', t('export.relations'), 'relations.csv', st.relations.length > 0, () => relationsCsv(st, opts)),
              csv('series', t('export.series'), 'series.csv', st.sequences.some((q) => q.scarIds.length), () => seriesCsv(st, opts)),
            ]),
        csv('landmarks-tps', t('export.landmarksTps'), 'landmarks.tps', lm.rows.length > 0, () => landmarksTps(st, lm)),
        csv('landmarks-fcsv', t('export.landmarksFcsv'), 'landmarks.fcsv', lm.rows.length > 0, () => landmarksFcsv(lm)),
        csv('landmarks-csv', t('export.landmarksCsv'), 'landmarks.csv', lm.rows.length > 0, () => landmarksCsv(st, lm, opts)),
        csv('sliders', t('export.sliders'), 'sliders.csv', lm.sliders.length > 0, () => slidersCsv(lm)),
        // the points for geometric morphometrics: by the grid only when it has them all; by a template what it lacks is written as NA
        ...(this.isFlake() || gmInUse(st.gm, st.specimen.type)
          ? (() => {
              const has = !!this.gm && (this.gm.method === 'template' ? this.gm.rows.some((r) => !r.missing) : this.gm.complete);
              return [
                csv('gm-tps', t('export.gmTps'), 'gm_landmarks.tps', has, () => landmarksTps(st, this.gm!)),
                csv('gm-fcsv', t('export.gmFcsv'), 'gm_landmarks.fcsv', has, () => landmarksFcsv(this.gm!)),
                csv('gm-csv', t('export.gmCsv'), 'gm_landmarks.csv', has, () => gmLandmarksCsv(st, this.gm!, opts)),
                csv('gm-curves', t('export.gmCurves'), 'gm_curves.csv', has && this.gm!.curves.length > 0, () => gmCurvesCsv(this.gm!)),
                csv('gm-surfaces', t('export.gmSurfaces'), 'gm_surfaces.csv', has && this.gm!.surfaces.length > 0, () => gmSurfacesCsv(this.gm!)),
                // (by the grid the files stay those it always had)
                ...(usesTemplate(st.gm, st.specimen.type)
                  ? [
                      csv('gm-smvector', t('export.gmSmvector'), 'gm_smvector.csv', has && this.gm!.curves.length > 0, () => gmSmvectorCsv(this.gm!)),
                      csv('gm-outlines', t('export.gmOutlines'), 'gm_outlines.csv', has && this.gm!.curves.length > 0, () => gmOutlinesCsv(this.gm!)),
                      csv('gm-surp', t('export.gmSurp'), 'gm_surp.csv', has && this.gm!.surfaces.length > 0, () => gmSurpCsv(this.gm!)),
                      csv('gm-models', t('export.gmModels'), 'gm_models.csv', has, () => gmModelsCsv([{ id: st.specimen.id, file: this.currentFile() }])),
                    ]
                  : []),
              ];
            })()
          : []),
      ];
    }
    if (this.mode === 'retouch')
      return [
        csv('flakes', t('export.flakes'), 'flakes.csv', !!this.flake, () => flakesCsv(st, this.flake?.measures ?? null, opts, this.retouchIndex?.indices ?? null)),
        csv('retouch-sections', t('export.retouchSections'), 'retouch_sections.csv', !!this.retouchIndex?.indices.stations.length, () => retouchSectionsCsv(st, this.retouchIndex?.indices ?? null, opts)),
        csv('retouch-segments', t('export.retouchSegments'), 'retouch_segments.csv', !!this.retouchIndex?.indices.segments.length, () => retouchSegmentsCsv(st, this.retouchIndex?.indices ?? null, opts)),
        csv('invasiveness', t('export.invasiveness'), 'invasiveness.csv', !!this.retouchIndex?.indices.penetration.length, () => invasivenessCsv(st, this.retouchIndex?.indices ?? null, opts)),
        csv('retouch-angles', t('export.retouchAngles'), 'retouch_angles.csv', this.retouchAngleCurves().length > 0, () => retouchAnglesCsv(st, this.retouchAngleCurves(), opts)),
        csv('working-edges', t('export.workingEdges'), 'working_edges.csv', this.workingEdgeDetails().length > 0, () => workingEdgesCsv(st, this.workingEdgeDetails().map((d) => d.row), this.edgeAngleCurves(), opts)),
      ];
    if (this.mode === 'measure')
      return [
        // a flake's files: edge angles and working edges have no rows on another type
        ...(this.isFlake()
          ? [
              csv('flakes', t('export.flakes'), 'flakes.csv', !!this.flake, () => flakesCsv(st, this.flake?.measures ?? null, opts, this.retouchIndex?.indices ?? null)),
              csv('edge-angles', t('export.edgeAngles'), 'edge_angles.csv', this.edgeAngleCurves().length > 0, () => edgeAnglesCsv(st, this.edgeAngleCurves(), opts)),
              csv('retouch-angles', t('export.retouchAngles'), 'retouch_angles.csv', this.retouchAngleCurves().length > 0, () => retouchAnglesCsv(st, this.retouchAngleCurves(), opts)),
              csv('retouch-sections', t('export.retouchSections'), 'retouch_sections.csv', !!this.retouchIndex?.indices.stations.length, () => retouchSectionsCsv(st, this.retouchIndex?.indices ?? null, opts)),
              csv('retouch-segments', t('export.retouchSegments'), 'retouch_segments.csv', !!this.retouchIndex?.indices.segments.length, () => retouchSegmentsCsv(st, this.retouchIndex?.indices ?? null, opts)),
              csv('invasiveness', t('export.invasiveness'), 'invasiveness.csv', !!this.retouchIndex?.indices.penetration.length, () => invasivenessCsv(st, this.retouchIndex?.indices ?? null, opts)),
              csv('edge-sharp', t('export.edgeSharp'), 'edge_sharp.csv', st.sharpEdge.threshold !== null && this.edgeAngleCurves().length > 0, () => edgeSharpCsv(st, this.edgeAngleCurves(), opts)),
              csv('working-edges', t('export.workingEdges'), 'working_edges.csv', this.workingEdgeDetails().length > 0, () => workingEdgesCsv(st, this.workingEdgeDetails().map((d) => d.row), this.edgeAngleCurves(), opts)),
            ]
          : []),
        csv('measurements', t('export.measurements'), 'measurements.csv', !!this.auto, () => measurementsCsv(st, this.auto, opts, this.regions?.totals ?? null, this.nodule, this.split, this.currentFile())),
        csv('manual', t('export.manualMeasurements'), 'manual_measurements.csv', st.measurements.length > 0, () => manualMeasurementsCsv(st, opts)),
        csv('planes', t('export.planes'), 'planes.csv', st.planes.length > 0, () => planesCsv(st, this.planes, opts)),
      ];
    if (this.mode === 'compare') {
      // not while it is being recomputed (the previous result would be written)
      const a = this.agreementBusyFlag || this.agreementStale ? null : this.agreement;
      const id = st.specimen.id || stem;
      return [
        csv('agreement', t('export.agreement'), 'agreement.csv', !!a, () => agreementCsv(id, a?.rows ?? [], opts)),
        csv('agreement-summary', t('export.agreementSummary'), 'agreement_summary.csv', !!a, () => agreementSummaryCsv(id, a?.summary ?? [], opts)),
      ];
    }
    return [];
  }

  /** The open model's file: its path in the folder, else its file name. */
  private currentFile(): string {
    const ws = this.workspace;
    return ws && this.wsIndex >= 0 ? ws.meshes[this.wsIndex] : (this.store.state.mesh?.fileName ?? '');
  }

  /**
   * Pick the files to export; several go into one ZIP archive. With a folder open, the
   * scope can be the whole folder (the summary export), and either goes into a new
   * folder LithicAnalyst/exports/<time>/ (a ZIP of that layout for a read-only folder).
   */
  openExport(): void {
    if (!this.hasMesh()) return;
    const files = this.exportables(false);
    if (!files.length) return;
    const ws = this.workspace;
    const boxes = files.map((f) =>
      h('input', { type: 'checkbox', id: `export-file-${f.key}`, 'data-key': f.key, checked: f.available, disabled: !f.available }) as HTMLInputElement,
    );
    const bom = h('input', { type: 'checkbox', id: 'export-bom', checked: this.display.excelBom }) as HTMLInputElement;
    const list = h(
      'div',
      { class: 'export-files', id: 'export-files' },
      ...files.map((f, i) => h('label', { class: `ctl-check export-item${f.available ? '' : ' is-empty'}`, for: boxes[i].id }, boxes[i], h('span', {}, f.label), h('span', { class: 'mono export-name' }, f.name))),
    );
    let scope: 'specimen' | 'folder' = 'specimen';
    const scopes = ws
      ? segmented('export-scope', t('export.scope'), [
          { value: 'specimen', label: t('export.scope.specimen') },
          { value: 'folder', label: t('export.scope.folder') },
        ], scope, (v) => {
          scope = v as typeof scope;
          list.hidden = scope === 'folder';
          // nothing to pick for the whole folder: the button just exports
          const run = list.closest('.modal')?.querySelector('[data-choice="export"]');
          if (run) run.textContent = t(scope === 'folder' ? 'export.runAll' : 'export.run');
        })
      : null;
    if (this.batch) scopes?.el.querySelector<HTMLButtonElement>('[data-value="folder"]')?.setAttribute('disabled', '');
    const body = h(
      'div',
      { class: 'export-list' },
      scopes ? h('div', { class: 'export-scope' }, scopes.el) : null,
      list,
      h('hr', { class: 'rule' }),
      h('label', { class: 'ctl-check', for: 'export-bom' }, bom, h('span', {}, t('export.bom'))),
    );
    void this.feedback
      .choose(t('export.title'), body, [
        { id: 'cancel', label: t('dlg.cancel') },
        { id: 'export', label: t('export.run'), kind: 'primary' },
      ])
      .then(async (choice) => {
        if (choice !== 'export') return;
        if (bom.checked !== this.display.excelBom) this.setDisplay((d) => (d.excelBom = bom.checked), 'other');
        if (scope === 'folder') {
          await this.exportFolder(bom.checked);
          return;
        }
        const chosen = this.exportables(bom.checked).filter((f, i) => f.available && boxes[i].checked);
        if (!chosen.length) return;
        if (ws) {
          // into the folder's exports, never over an earlier export
          const sink = await this.exportSink('exports');
          for (const f of chosen) await sink.put(f.name, f.text());
          const st = this.store.state;
          const where = await sink.finish({
            ...this.manifestBase('specimen', 'tables', { excelBom: bom.checked, files: chosen.map((f) => f.key) }),
            specimens: [{ id: st.specimen.id, file: this.currentFile(), sha256: st.mesh?.sha256 ?? null, project: ws.has(projectPathFor(this.currentFile())) ? projectPathFor(this.currentFile()) : null, annotator: st.specimen.annotator }],
            failures: [],
          });
          if (where) this.feedback.toast(t('batch.written', { path: where }), 'info', 5000);
          return;
        }
        if (chosen.length === 1) {
          const f = chosen[0];
          await this.save(f.name, f.text(), f.name.endsWith('.csv') ? 'text/csv' : 'text/plain');
          return;
        }
        const enc = new TextEncoder();
        const name = `${this.stem()}_export.zip`;
        const outcome = await saveFile(name, zipStored(chosen.map((f) => ({ name: f.name, data: enc.encode(f.text()) }))), 'application/zip');
        if (outcome === 'saved') this.feedback.toast(t('toast.saved', { name }));
        else if (outcome === 'declined') this.feedback.toast(t('toast.declined'));
        else if (outcome === 'busy') this.feedback.toast(t('toast.busy'), 'warn');
        else this.feedback.toast(t('export.zipFailed'), 'error');
      });
  }

  // ------------------------------------------------------------ compare mode

  observerList(): Array<{ id: string; label: string; fileName: string; included: boolean; color: string; current: boolean }> {
    const labels = this.observerLabels();
    return this.observers.map((o) => ({ id: o.id, label: labels.get(o.id)!, fileName: o.fileName, included: o.included, color: o.color, current: !o.state }));
  }

  /** Observer labels, made unique (" (2)", " (3)" …). */
  private observerLabels(): Map<string, string> {
    const out = new Map<string, string>();
    const seen = new Map<string, number>();
    for (const o of this.observers) {
      const base = (o.state ? o.label : this.store.state.specimen.annotator) || t('compare.current');
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      out.set(o.id, n > 1 ? `${base} (${n})` : base);
    }
    return out;
  }

  addObserverFiles(): void {
    this.compareInput.click();
  }

  /** The folder's other project files of this model (by checksum, from the index: each file read once). */
  async addFolderObservers(): Promise<void> {
    const ws = this.workspace, index = this.projectIndex;
    const sha = this.store.state.mesh?.sha256;
    if (!ws || !index || !sha) return;
    await this.flushFolderSave();
    await index.ready();
    const path = this.wsIndex >= 0 ? ws.meshes[this.wsIndex] : null;
    const own = path ? [projectPathFor(path), legacyProjectPathFor(path)] : [];
    const have = new Set(this.observers.map((o) => o.fileName));
    let added = 0;
    for (const p of index.forMesh(sha)) {
      if (own.includes(p.path) || have.has(p.path)) continue;
      const st = structuredClone(p.state);
      const used = new Set(this.observers.map((o) => o.color));
      const color = OBSERVER_COLORS.find((c) => !used.has(c)) ?? OBSERVER_COLORS[this.observers.length % OBSERVER_COLORS.length];
      this.observers.push({ id: uuid(), label: st.specimen.annotator || p.path, fileName: p.path, state: st, included: true, color, layers: null, faces: null, table: landmarkTable(st) });
      added++;
    }
    if (!added) this.feedback.toast(t('compare.noneInFolder'), 'info', 2500);
    this.observersChanged();
  }

  private async addObservers(files: File[]): Promise<void> {
    const sha = this.store.state.mesh?.sha256;
    if (!sha) return;
    for (const f of files) {
      let st: ProjectState;
      try {
        st = parseProjectFile(JSON.parse(await f.text()));
      } catch (err) {
        this.feedback.toast(`${f.name}: ${err instanceof Error ? err.message : String(err)}`, 'error');
        continue;
      }
      if (st.mesh?.sha256 !== sha) {
        this.feedback.toast(t('compare.otherMesh', { name: f.name }), 'warn', 4000);
        continue;
      }
      const used = new Set(this.observers.map((o) => o.color));
      const color = OBSERVER_COLORS.find((c) => !used.has(c)) ?? OBSERVER_COLORS[this.observers.length % OBSERVER_COLORS.length];
      const label = st.specimen.annotator || f.name.replace(/\.json$/i, '').replace(/\.lithicanalyst$/i, '');
      this.observers.push({ id: uuid(), label, fileName: f.name, state: st, included: true, color, layers: null, faces: null, table: landmarkTable(st) });
    }
    this.observersChanged();
  }

  setObserverIncluded(id: string, included: boolean): void {
    const o = this.observers.find((x) => x.id === id);
    if (!o || o.included === included) return;
    o.included = included;
    this.observersChanged();
  }

  removeObserver(id: string): void {
    const o = this.observers.find((x) => x.id === id);
    if (!o || !o.state) return;
    this.disposeObserverLayers(o);
    this.observers = this.observers.filter((x) => x !== o);
    this.observersChanged();
  }

  /** A new mesh: only the open project is left to compare. */
  private resetObservers(): void {
    for (const o of this.observers) this.disposeObserverLayers(o);
    this.observers = this.observers.filter((o) => !o.state);
    this.observers[0].faces = null;
    this.faceAreas = null;
    this.gate = null;
    this.agreement = null;
    this.agreementStale = true;
  }

  private observersChanged(): void {
    this.syncCompare();
    this.agreementStale = true;
    this.scheduleAgreement();
    this.sidebar.refresh('compare');
  }

  compareGate(): number {
    if (this.gate !== null) return this.gate;
    const d = this.viewer?.diagonal ?? 0;
    return d > 0 ? Number((d * 0.1).toPrecision(2)) : 1;
  }

  setCompareGate(v: number): void {
    if (!(v > 0) || v === this.gate) return;
    this.gate = v;
    this.agreementStale = true;
    this.scheduleAgreement();
  }

  agreementResult(): { rows: AgreementRow[]; summary: SummaryRow[] } | null {
    return this.agreement;
  }

  agreementBusy(): boolean {
    return this.agreementBusyFlag;
  }

  agreementFocus(): string | null {
    return this.agreementFocused?.key ?? null;
  }

  relationPending(): boolean {
    const tool = this.tools?.activeTool;
    return tool instanceof RelationTool && tool.pending() !== null;
  }

  toolId(): string | null {
    return this.tools?.activeId ?? null;
  }

  /** Show the pair of items that differ most in a metric, each in its observer's drawing (again: clear). */
  focusAgreement(itemType: string, metric: string, a: string, b: string): void {
    const key = `${itemType}|${metric}|${a}|${b}`;
    const rows = (this.agreement?.rows ?? []).filter((r) => r.itemType === itemType && r.metric === metric && r.a === a && r.b === b && r.itemKey !== 'all' && Number.isFinite(r.value));
    if (this.agreementFocused?.key === key || !rows.length) {
      this.agreementFocused = null;
    } else {
      const worst = rows.reduce((m, r) => (Math.abs(r.value) > Math.abs(m.value) ? r : m), rows[0]);
      const labels = this.observerLabels();
      const byLabel = (label: string) => this.observers.find((o) => labels.get(o.id) === label);
      const items = new Map<string, string>();
      const [ka, kb] = itemType === 'arrow' || itemType === 'curve' ? worst.itemKey.split('|') : [worst.itemKey, worst.itemKey];
      for (const [label, k] of [[a, ka], [b, kb]] as const) {
        const o = byLabel(label);
        const st = o ? (o.state ?? this.store.state) : null;
        if (!o || !st) continue;
        const id =
          itemType === 'arrow'
            ? st.scars.find((x) => x.label === k && x.vector)?.id
            : itemType === 'curve'
              ? st.curves.find((x) => x.label === k)?.id
              : itemType === 'landmark'
                ? st.landmarks.find((x) => x.name === k)?.id
                : semilandmarkPoint(st, k);
        if (id) items.set(o.id, id);
      }
      this.agreementFocused = { key, items };
    }
    this.syncCompare();
    this.sidebar.refresh('compare');
  }

  /** Each observer's annotations in its colour (compare mode); the open project's own layers step aside. */
  private syncCompare(): void {
    const viewer = this.viewer;
    const show = this.mode === 'compare';
    if (!viewer) return;
    for (const o of this.observers) {
      if (!(show && o.included && this.hasMesh())) {
        this.disposeObserverLayers(o);
        continue;
      }
      if (!o.layers) {
        const arrows = new ArrowLayer(viewer), curves = new CurveLayer(viewer), landmarks = new LandmarkLayer(viewer);
        arrows.fixedColor = curves.fixedColor = landmarks.fixedColor = o.color;
        if (this.loaded) curves.setOrigin(this.loaded.offset);
        o.layers = { arrows, curves, landmarks };
      }
      const st = o.state ?? this.store.state;
      const focus = this.agreementFocused?.items.get(o.id) ?? null;
      // only the open project's labels: the others would stack on top of them
      const display = { ...this.display.arrows, labels: this.display.arrows.labels && !o.state };
      o.layers.arrows.sync(st, focus, display, false);
      o.layers.curves.sync(st, focus, display, false);
      o.layers.landmarks.sync(st.landmarks, (o.state ? o.table : this.landmarks)?.sets ?? [], focus, display.labels, this.display.arrows.showHidden);
    }
  }

  private disposeObserverLayers(o: Observer): void {
    const l = o.layers;
    if (!l || !this.viewer) return;
    l.arrows.clearAll();
    l.curves.clearAll();
    l.landmarks.clearAll();
    l.landmarks.dispose();
    for (const g of [l.arrows.group, l.curves.group, l.landmarks.group]) this.viewer.overlay.remove(g);
    o.layers = null;
    this.viewer.requestRender();
  }

  /** Recompute the comparison shortly (only in the compare mode; otherwise when it is entered). */
  private scheduleAgreement(): void {
    this.agreementStale = true;
    if (this.mode !== 'compare') return;
    clearTimeout(this.agreementTimer);
    this.agreementTimer = window.setTimeout(() => void this.updateAgreement(), 200);
  }

  /** The number of a region type in FaceLabels: the codes, then the observers' own texts as they turn up. */
  private faceTypeIndex(type: string): number {
    let i = this.faceTypes.indexOf(type);
    if (i < 0) i = this.faceTypes.push(type) - 1;
    return i;
  }

  /** Region of each triangle by an observer's curves and region seeds, in the two layers (cached until they change). */
  private async observerFaces(o: Observer, st: Readonly<ProjectState>): Promise<{ labels: FaceLabels | null; upper: FaceLabels | null } | null> {
    if (!st.regions.length) return null;
    const key = JSON.stringify([st.specimen.type, st.flake.axis?.end, st.curves.map((c) => [c.points, c.closed, c.attributes.type, c.retouchSide]), st.regions.map((r) => [r.seed, r.type, r.auto, r.curveId])]);
    if (o.faces?.key === key) return o.faces;
    const chains = await this.curveChains(st.curves, st.specimen.type);
    const raw = await this.partitionFor(st.curves, st.specimen.type);
    if (!raw || !chains) return null;
    // its retouch bands one piece each, as the open project's
    const boundary = chains.filter((_, i) => isBoundaryCurve(st.curves[i].attributes.type, st.specimen.type)).flat();
    const groups = this.bandGroups(st, raw, await this.bandsOf(st, chains, raw, boundary, new Map()));
    const { partition: part, map } = mergePieces(raw, [...groups.values()]);
    const lowerPiece = (r: ProjectState['regions'][number]): number => {
      if (r.curveId) {
        const g = groups.get(r.id);
        return g ? map[g[0]] : -1;
      }
      return this.inLowerLayer(st, r) ? this.pieceAt(part, r.seed) : -1;
    };
    const label = (p: Partition, component: readonly number[]): FaceLabels => {
      const owner = new Int32Array(p.count).fill(-1);
      component.forEach((c, i) => {
        if (c >= 0 && owner[c] < 0) owner[c] = i;
      });
      const n = p.region.length;
      const labels: FaceLabels = { type: new Uint8Array(n), region: new Int32Array(n).fill(-1) };
      for (let f = 0; f < n; f++) {
        const i = owner[p.region[f]];
        if (i < 0) continue;
        labels.type[f] = this.faceTypeIndex(st.regions[i].type);
        labels.region[f] = i;
      }
      return labels;
    };
    const labels = label(part, st.regions.map(lowerPiece));
    let upper: FaceLabels | null = null;
    if (st.regions.some((r) => isUpperRegion(r.type, st.specimen.type))) {
      const above = await this.partitionFor(st.curves.filter((c) => isBoundaryCurve(c.attributes.type, st.specimen.type)), st.specimen.type);
      const outline = st.specimen.type === 'flake' ? st.curves.find((c) => c.attributes.type === PLATFORM_OUTLINE && c.closed) : undefined;
      if (above) upper = label(above, this.upperComponents(st, above, outline ? await this.outlineSeed(outline) : null));
    }
    o.faces = { key, labels, upper };
    return o.faces;
  }

  private triangleAreas(): Float32Array | null {
    if (this.faceAreas) return this.faceAreas;
    const g = this.loaded?.geometry;
    if (!g) return null;
    const pos = g.getAttribute('position').array as Float32Array;
    const idx = g.index!.array;
    const out = new Float32Array(idx.length / 3);
    for (let t = 0; t < out.length; t++) {
      const a = 3 * idx[3 * t], b = 3 * idx[3 * t + 1], c = 3 * idx[3 * t + 2];
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      out[t] = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    }
    return (this.faceAreas = out);
  }

  private async updateAgreement(): Promise<void> {
    const token = ++this.agreementToken;
    const base = this.measureBase;
    const loaded = this.loaded;
    const included = this.observers.filter((o) => o.included);
    if (!base || !loaded || included.length < 2) {
      this.agreement = null;
      this.agreementBusyFlag = false;
      this.agreementStale = false;
      this.sidebar.refresh('compare');
      return;
    }
    this.agreementBusyFlag = true;
    this.sidebar.refresh('compare');
    const labels = this.observerLabels();
    const axes = this.vertexAxes();
    const areas = this.triangleAreas();
    const positions = loaded.geometry.getAttribute('position').array as Float32Array;
    const data: ObserverData[] = [];
    for (const o of included) {
      const st = o.state ?? this.store.state;
      const layers = await this.observerFaces(o, st);
      const faces = layers?.labels ?? null;
      if (token !== this.agreementToken) return;
      const auto = autoMeasurements(positions, base, st.specimen.frame);
      const measures: Record<string, number | null> = { length: auto.length, width: auto.width, thickness: auto.thickness };
      if (faces && areas) {
        const sums = new Float64Array(this.faceTypes.length);
        for (let f = 0; f < areas.length; f++) {
          sums[faces.type[f]] += areas[f];
          if (layers?.upper) sums[layers.upper.type[f]] += areas[f];
        }
        // (the user's own types are compared as regions, not as measurements)
        FACE_TYPES.forEach((type, i) => i > 0 && (measures[`area_${type}`] = sums[i]));
        measures.cortex_ratio = base.surfaceArea > 0 ? sums[2] / base.surfaceArea : null;
      }
      data.push({ label: labels.get(o.id)!, state: st, planes: st.planes.map((p) => computePlane(p, st, axes)), faces, upper: layers?.upper ?? null, measures });
      await nextFrame();
      if (token !== this.agreementToken) return;
    }
    const rows = compareObservers(data, { gate: this.compareGate(), faceArea: areas, faceTypes: this.faceTypes });
    if (token !== this.agreementToken) return;
    this.agreement = { rows, summary: summarize(rows) };
    this.agreementFocused = null;
    this.syncCompare();
    this.agreementBusyFlag = false;
    this.agreementStale = false;
    this.sidebar.refresh('compare');
  }

  // ------------------------------------------------------------ landmarks

  landmarkTable(): LandmarkTable {
    return this.landmarks;
  }

  /** Landmark tool: a new landmark, named from the carried-over list while it lasts. */
  private placeLandmark(p: Vec3): void {
    const lm = addLandmark(this.store, p, this.nextName() ?? undefined);
    this.selection.set(lm.id);
  }

  private nextName(): string | null {
    const q = this.names;
    if (!q) return null;
    const used = new Set(this.store.state.landmarks.map((l) => l.name));
    return q.list.find((n) => !used.has(n) && !q.skipped.has(n)) ?? null;
  }

  nameQueue(): { next: string | null } | null {
    return this.names ? { next: this.nextName() } : null;
  }

  /**
   * The names of the last specimen that had landmarks. The current one's names
   * are kept under 'landmarkNames' with its mesh checksum; when another mesh
   * gets landmarks, they move to 'landmarkNamesPrev'.
   */
  previousNames(): string[] {
    const sha = this.store.state.mesh?.sha256;
    const cur = readPref<{ sha: string; names: string[] } | null>('landmarkNames', null);
    if (cur && cur.sha !== sha && cur.names.length) return cur.names;
    return readPref<string[]>('landmarkNamesPrev', []);
  }

  private rememberLandmarkNames(): void {
    const sha = this.store.state.mesh?.sha256;
    if (!sha) return;
    const names = this.store.state.landmarks.filter((l) => !l.code).map((l) => l.name);
    const cur = readPref<{ sha: string; names: string[] } | null>('landmarkNames', null);
    if (cur?.sha === sha) writePref('landmarkNames', { sha, names });
    else if (names.length) {
      if (cur?.names.length) writePref('landmarkNamesPrev', cur.names);
      writePref('landmarkNames', { sha, names });
    }
  }

  reuseNames(): void {
    const list = this.previousNames();
    this.names = list.length ? { list: [...list], skipped: new Set() } : null;
    this.sidebar.refresh('landmarks');
  }

  skipName(): void {
    const n = this.nextName();
    if (n && this.names) this.names.skipped.add(n);
    this.sidebar.refresh('landmarks');
  }

  stopNames(): void {
    this.names = null;
    this.sidebar.refresh('landmarks');
  }

  private landmarkExport(kind: 'tps' | 'fcsv' | 'csv' | 'sliders', bom: boolean): { text: string; name: string; mime: string } {
    const st = this.store.state;
    const tb = this.landmarks;
    switch (kind) {
      case 'tps':
        return { text: landmarksTps(st, tb), name: `${this.stem()}_landmarks.tps`, mime: 'text/plain' };
      case 'fcsv':
        return { text: landmarksFcsv(tb), name: `${this.stem()}_landmarks.fcsv`, mime: 'text/plain' };
      case 'csv':
        return { text: landmarksCsv(st, tb, { excelBom: bom }), name: `${this.stem()}_landmarks.csv`, mime: 'text/csv' };
      default:
        return { text: slidersCsv(tb), name: `${this.stem()}_sliders.csv`, mime: 'text/csv' };
    }
  }

  // ------------------------------------------------------------ relations and sequences

  relationChecks(): RelationChecks {
    const { scarIds, edges, sequences } = relationInputs(this.store.state);
    return checkRelations(scarIds, edges, sequences);
  }

  problemFocus(): number | null {
    return this.problemsOpen ? this.focusedProblem : null;
  }

  setProblems(open: boolean, focus: number | null = null): void {
    this.problemsOpen = open;
    this.focusedProblem = open ? focus : null;
    this.syncAnnotations();
    this.paintRegions();
    this.sidebar.refresh('relations');
  }

  /** Scars to draw highlighted: those of the selected relation, or of the opened problems. */
  private emphasis(): { ids: Set<string>; color: string } | null {
    if (this.mode !== 'annotate') return null;
    const sel = this.selection.id;
    // while sequencing, the colours are the sequences'
    const rel = sel && !this.sequencing() ? this.store.relation(sel) : undefined;
    if (rel) return { ids: new Set([rel.a, rel.b]), color: ARROW_COLORS.selected };
    if (!this.problemsOpen) return null;
    const found = relationProblems(this.relationChecks());
    const shown = this.focusedProblem !== null && found[this.focusedProblem] ? [found[this.focusedProblem]] : found;
    return shown.length ? { ids: new Set(shown.flatMap((p) => p.scars)), color: PROBLEM_COLOR } : null;
  }

  /** The scar under a click: an arrow near it, else the scar region it falls in. */
  private scarAt(x: number, y: number, hit: HitProvider): ScarPick | null {
    const arrow = this.arrows?.pickNearest(x, y);
    if (arrow) return { scarId: arrow.id, selectId: arrow.id };
    const h = hit();
    const part = this.partition;
    if (!h || !part || h.faceIndex < 0) return null;
    const c = part.region[h.faceIndex];
    const i = this.seedComponent.findIndex((x) => x === c);
    const r = i >= 0 ? this.store.state.regions[i] : undefined;
    return r?.scarId && this.store.scar(r.scarId) ? { scarId: r.scarId, selectId: r.id } : null;
  }

  /**
   * Relation tool: the scar clicked first cuts the one clicked second (the
   * order of the clicks is the order of the words), replacing what was
   * recorded for the pair. A small bar next to the click offers to change it.
   */
  private recordRelation(a: string, b: string, at: { x: number; y: number }, from: { x: number; y: number }): void {
    const rel = setRelation(this.store, a, b, 'a_cuts_b');
    if (!rel) return;
    this.selection.set(rel.id);
    this.showRelationChip(rel.id, a, b, at, [from, ...this.scarScreenPoints(a), ...this.scarScreenPoints(b)]);
  }

  /**
   * Change the relation the bar shows: `ab` the first scar cuts the second (key 1),
   * `reverse` the other way round, or back (2), `ind` cannot tell (3), `delete`.
   */
  private applyRelationChoice(choice: 'ab' | 'reverse' | 'ind' | 'delete'): void {
    const c = this.relationChip;
    const r = c ? this.store.relation(c.id) : undefined;
    if (!c || !r) return;
    if (choice === 'delete') deleteRelation(this.store, r.id);
    else if (choice === 'ind') setRelation(this.store, c.a, c.b, 'indeterminate');
    else if (choice === 'ab' || (r.kind === 'a_cuts_b' && r.a === c.b)) setRelation(this.store, c.a, c.b, 'a_cuts_b');
    else setRelation(this.store, c.b, c.a, 'a_cuts_b');
    this.relationChip?.update();
  }

  /** Where a scar shows on screen: points along its arrow, or its regions' seeds. */
  private scarScreenPoints(id: string): Array<{ x: number; y: number }> {
    const v = this.viewer;
    const s = this.store.scar(id);
    if (!v || !s) return [];
    const vec = s.vector;
    const pts: Vec3[] = vec
      ? Array.from({ length: 9 }, (_, i): Vec3 => {
          const f = i / 8, [a, b] = [vec.start, vec.end];
          return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
        })
      : this.store.state.regions.filter((r) => r.scarId === id).map((r) => r.seed);
    return pts.map((p) => v.project(new THREE.Vector3(p[0], p[1], p[2]))).filter((p) => p.visible);
  }

  /** The bar of the relation just recorded (`a` and `b` in the order clicked); null when none is shown. */
  private relationChip: { id: string; a: string; b: string; close: () => void; update: () => void } | null = null;

  /**
   * Place `el` (in the view) next to `at` (client coordinates), on whichever side
   * of the click leaves `avoid` (the two scars) in view.
   */
  private placeNear(el: HTMLElement, at: { x: number; y: number }, avoid: Array<{ x: number; y: number }>): void {
    el.style.visibility = 'hidden';
    const area = this.viewportEl.getBoundingClientRect();
    const w = el.offsetWidth, hgt = el.offsetHeight, gap = 14, margin = 8;
    const cx = at.x - area.left, cy = at.y - area.top;
    // [x, y, 1 when it had to be pushed into the view]
    const spots = [
      [cx + gap, cy + gap],
      [cx - gap - w, cy + gap],
      [cx + gap, cy - gap - hgt],
      [cx - gap - w, cy - gap - hgt],
    ].map(([x, y]) => {
      const fx = Math.max(margin, Math.min(area.width - w - margin, x)), fy = Math.max(margin, Math.min(area.height - hgt - margin, y));
      return [fx, fy, fx !== x || fy !== y ? 1 : 0];
    });
    const inside = (px: number, py: number, [x, y]: number[], pad: number) => px > x - pad && px < x + w + pad && py > y - pad && py < y + hgt + pad;
    // the clicked point counts most, then the scars; a spot that fits as it is beats one pushed into the view
    const cost = (s: number[]) =>
      (inside(cx, cy, s, gap) ? 100 : 0) + avoid.filter((p) => inside(p.x - area.left, p.y - area.top, s, margin)).length + 0.5 * s[2];
    const best = spots.reduce((b, p) => (cost(p) < cost(b) ? p : b), spots[0]);
    el.style.left = `${best[0]}px`;
    el.style.top = `${best[1]}px`;
    el.style.visibility = '';
  }

  /**
   * A small bar next to the second click: "S4 cuts S3" and buttons to reverse it (2),
   * make it "cannot tell" (3) or delete it (Delete); 1 brings back "S4 cuts S3".
   * It takes nothing away from the tool: it goes at the next press in the view, a
   * change of tool, Esc, or when something else is selected.
   */
  private showRelationChip(id: string, a: string, b: string, at: { x: number; y: number }, avoid: Array<{ x: number; y: number }>): void {
    this.relationChip?.close();
    const text = h('span', { class: 'relation-chip-text mono', id: 'relation-chip-text' });
    const button = (choice: 'reverse' | 'ind' | 'delete', key: string, label: string, extra = '') =>
      h('button', { type: 'button', class: `btn btn-sm btn-quiet${extra}`, 'data-choice': choice, 'aria-pressed': 'false', onclick: () => this.applyRelationChoice(choice) }, h('kbd', {}, key), h('span', {}, label));
    const reverse = button('reverse', '2', t('relation.reverse'));
    const ind = button('ind', '3', t('relation.indeterminate'));
    const del = button('delete', 'Del', t('arrows.delete'), ' relation-chip-delete');
    del.removeAttribute('aria-pressed');
    const el = h('div', { class: 'viewport-ui relation-chip', id: 'relation-chip', role: 'group' }, text, reverse, ind, del);
    this.viewportEl.append(el);
    this.placeNear(el, at, avoid);
    const label = (x: string) => this.store.scar(x)?.label ?? '?';
    const update = () => {
      const r = this.store.relation(id);
      if (!r) return close();
      text.textContent = r.kind === 'indeterminate' ? t('relation.pairUnknown', { a: label(a), b: label(b) }) : t('relation.cuts', { a: label(r.a), b: label(r.b) });
      el.setAttribute('aria-label', text.textContent);
      reverse.setAttribute('aria-pressed', String(r.kind === 'a_cuts_b' && r.a === b));
      ind.setAttribute('aria-pressed', String(r.kind === 'indeterminate'));
    };
    // a press in the view (not on the bar) lets it go, and goes on to the tool as usual
    const onDown = (e: PointerEvent) => {
      if (!el.contains(e.target as Node) && onViewport(e.target as Node)) close();
    };
    const close = () => {
      el.remove();
      document.removeEventListener('pointerdown', onDown, true);
      if (this.relationChip === handle) this.relationChip = null;
    };
    const handle = { id, a, b, close, update };
    this.relationChip = handle;
    document.addEventListener('pointerdown', onDown, true);
    update();
  }

  // ------------------------------------------------------------ borders of scars not judged yet

  /** What the borders were last computed from (the partition and the scar of each piece). */
  private bordersFor: { part: Partition | null; key: string } = { part: null, key: '' };

  /** Which scars' regions border on each other (in slices), after the regions are found again (only when the pieces or their scars changed). */
  private updateBorders(): void {
    const part = this.partition, base = this.measureBase, loaded = this.loaded;
    const st = this.store.state;
    // the scar of each piece of surface: its first scar region's
    const scars: string[] = [];
    const owner = new Int32Array(part?.count ?? 0).fill(-1);
    st.regions.forEach((r, i) => {
      const c = this.seedComponent[i];
      if (!part || r.type !== 'scar' || !r.scarId || !this.store.scar(r.scarId) || c < 0 || owner[c] >= 0) return;
      const k = scars.indexOf(r.scarId);
      owner[c] = k >= 0 ? k : scars.push(r.scarId) - 1;
    });
    const key = JSON.stringify([scars, [...owner].flatMap((k, c) => (k >= 0 ? [c, k] : []))]);
    if (part && part === this.bordersFor.part && key === this.bordersFor.key) return;
    this.bordersFor = { part, key };
    const token = ++this.bordersToken;
    this.borderCursor = -1;
    const done = (b: ScarBorder[]) => {
      if (token !== this.bordersToken) return;
      this.borders = b;
      this.showBorders();
      this.sidebar.refresh('relations');
    };
    if (!part || !base || !loaded || scars.length < 2) return done([]);
    const g = loaded.geometry;
    const o = loaded.offset;
    void runSliced(scarBordersSteps(g.getAttribute('position').array as Float32Array, g.index!.array as Uint32Array, base.edges, part.region, owner, scars)).then((list) => {
      if (this.loaded !== loaded) return;
      // the mesh is re-centred: back to original coordinates
      done(list.map((x) => ({ ...x, mid: [x.mid[0] + o[0], x.mid[1] + o[1], x.mid[2] + o[2]] as Vec3 })));
    });
  }

  /** Bordering scars with no relation recorded (not even "cannot tell"). */
  private unjudgedBorders(): ScarBorder[] {
    const st = this.store.state;
    return this.borders.filter((b) => this.store.scar(b.a) && this.store.scar(b.b) && !relationBetween(st, b.a, b.b));
  }

  unjudgedPairs(): number {
    return this.unjudgedBorders().length;
  }

  /** The relation tool draws the borders of the scars not judged yet, dashed. */
  private showBorders(): void {
    const layer = this.borderLayer, loaded = this.loaded;
    if (!layer) return;
    const pairs = this.mode === 'annotate' && this.tools?.activeId === 'relation' && loaded ? this.unjudgedBorders() : [];
    if (!pairs.length || !loaded) {
      layer.clear();
      return;
    }
    const key = `${this.bordersToken}#${pairs.map((p) => `${p.a}|${p.b}`).join(',')}`;
    if (layer.shows(key)) return;
    const pos = loaded.geometry.getAttribute('position').array as Float32Array;
    const o = loaded.offset;
    const at = (v: number): Vec3 => [pos[3 * v] + o[0], pos[3 * v + 1] + o[1], pos[3 * v + 2] + o[2]];
    layer.sync(key, pairs.flatMap((p) => chainEdges(p.edges).map((c) => c.map(at))), o);
  }

  /** Turn the view to the middle of the next border of scars not judged yet. */
  nextUnjudgedPair(): void {
    const pairs = this.unjudgedBorders();
    const v = this.viewer;
    if (!pairs.length || !v) return;
    this.borderCursor = (this.borderCursor + 1) % pairs.length;
    const b = pairs[this.borderCursor];
    const snap = this.surfaceSnap;
    const toward = snap ? snap.normal(snap.nearestVertex(b.mid)) : v.towardViewer();
    v.viewFrom(toward, v.cameraUp(), b.mid, v.currentDistance(), true);
  }

  /** The Harris matrix panel: move it by its title bar, size it from its corner, fold it to one line (all remembered). */
  private buildHarrisPanel(): void {
    const panel = floatingPanel({
      id: 'harris',
      title: t('harris.title'),
      pref: 'harrisPanel',
      area: this.viewportEl,
      resizable: true,
      extras: [h('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'harris-svg', onclick: () => this.exportHarrisSvg() }, 'SVG')],
      onClose: () => {
        // shown by the relation or sequence tool: away until the tool changes
        if (this.harrisAuto()) this.harrisAutoOff = true;
        this.setDisplay((d) => (d.harris = false), 'harris');
      },
    });
    panel.body.addEventListener('click', (e) => {
      const id = (e.target as Element).closest?.('[data-id]')?.getAttribute('data-id');
      if (id) this.selectScar(id);
    });
    if (this.harrisEl) this.harrisEl.replaceWith(panel.el);
    else this.viewportEl.append(panel.el);
    this.harrisEl = panel.el;
    this.harrisBody = panel.body;
    this.harrisFit = panel.fit;
    this.updateHarris();
  }

  private harrisFit: (() => void) | null = null;

  private harrisLayoutNow(): HarrisLayout {
    const { scarIds, edges, sequences } = relationInputs(this.store.state);
    return harrisLayout(scarIds, edges, sequences, checkRelations(scarIds, edges, sequences), undefined, t('harris.unrelated'));
  }

  private harrisStyle(selected: string | null): HarrisStyle {
    const st = this.store.state;
    return { labels: new Map(st.scars.map((s) => [s.id, s.label])), fills: sequenceColors(st.sequences), selected };
  }

  /** The relation or sequence tool is in use on scars: the matrix shows whatever the display setting says. */
  private harrisAuto(): boolean {
    return this.mode === 'annotate' && ['relation', 'sequence'].includes(this.tools?.activeId ?? '') && this.store.state.scars.length > 0;
  }

  /** Redraw the Harris matrix panel (annotate mode, when switched on or while the relation or sequence tool is used). */
  private updateHarris(): void {
    const el = this.harrisEl, body = this.harrisBody;
    if (!el || !body) return;
    const shown = (this.display.harris || (this.harrisAuto() && !this.harrisAutoOff)) && this.mode === 'annotate' && this.hasMesh() && !this.isGeneric();
    const wasShown = !el.hidden;
    el.hidden = !shown;
    if (!shown) return;
    if (!wasShown) this.harrisFit?.();
    body.innerHTML = this.store.state.scars.length ? harrisSvg(this.harrisLayoutNow(), this.harrisStyle(this.selectedScar())) : '';
  }

  /** The scar the selection shows: a selected scar, or a selected region's scar. */
  private selectedScar(): string | null {
    const sel = this.selection.id;
    if (!sel) return null;
    if (this.store.scar(sel)) return sel;
    return this.store.region(sel)?.scarId ?? null;
  }

  /** Select a scar where it shows in 3D: its arrow, else its region. */
  private selectScar(id: string): void {
    const s = this.store.scar(id);
    if (!s) return;
    const region = s.vector ? undefined : this.store.state.regions.find((r) => r.scarId === id);
    this.selection.set(region?.id ?? id);
  }

  exportHarrisSvg(): void {
    if (!this.hasMesh() || !this.store.state.scars.length) return;
    void this.save(`${this.stem()}_harris.svg`, harrisSvg(this.harrisLayoutNow(), this.harrisStyle(null)), 'image/svg+xml');
  }

  volumeSplit(): VolumeSplit | null {
    return this.split;
  }

  meshClosed(): boolean | null {
    return this.measureBase ? this.measureBase.topology.closed : null;
  }

  /**
   * Upper / lower volumes by the chosen plane or closed curve (closed meshes only; in slices),
   * exchanged when the split is swapped. With `reuse` the last result stands if it is of the same plane or curve.
   */
  private updateSplit(reuse = false): void {
    const token = ++this.splitToken;
    const sp = this.store.state.split;
    const base = this.measureBase;
    const loaded = this.loaded;
    const snap = this.surfaceSnap;
    const key = sp ? JSON.stringify([sp.source, sp.id, sp.upHint]) : '';
    this.splitBusy = true;
    const done = (v: SplitResult | null) => {
      if (token !== this.splitToken) return;
      this.splitBusy = false;
      this.splitRaw = { key, value: v };
      this.split = v && sp ? swappedSplit(v, sp.swap) : null;
      this.sidebar.refresh('split');
      // the bicone stands on the split
      this.updateConfiguration();
      this.refreshHint();
    };
    // a core's: on another type the split stays in the file and nothing is computed
    if (!hasVolumeSplit(this.store.state.specimen.type)) return done(null);
    if (reuse && sp && this.splitRaw?.key === key) return done(this.splitRaw.value);
    if (!sp || !base || !loaded || !base.topology.closed) return done(null);
    const g = loaded.geometry;
    const pos = g.getAttribute('position').array as Float32Array;
    const idx = g.index!.array as Uint32Array;
    const o = loaded.offset;
    if (sp.source === 'plane') {
      const r = this.planes.find((p) => p.id === sp.id);
      if (!r?.valid) return done(null);
      void runSliced(splitByPlaneSteps(pos, idx, [r.center![0] - o[0], r.center![1] - o[1], r.center![2] - o[2]], r.normal!)).then(done);
      return;
    }
    const c = this.store.curve(sp.id);
    const fit = c?.closed ? fitPlane(c.points) : null;
    if (!c || !fit || !snap) return done(null);
    let normal = fit.normal;
    if (normal[0] * sp.upHint[0] + normal[1] * sp.upHint[1] + normal[2] * sp.upHint[2] < 0) normal = [-normal[0], -normal[1], -normal[2]];
    void snap.prepare('off').then(async () => {
      if (token !== this.splitToken) return;
      const search = snap.search(3);
      const chain = await runSliced(
        polylineEdgesSteps(c.points, true, (p) => snap.nearestVertex(p), base.edges, (a, b) => {
          if (!search) return null;
          search.start(a, null);
          return search.reach(b) ? search.path(b) : null;
        }),
      );
      if (token !== this.splitToken) return;
      void runSliced(splitByLoopSteps(pos, idx, base.edges, chain, normal)).then(done);
    });
  }

  noduleFit(): (SphereFit & { regions: string[] }) | null {
    return this.nodule;
  }

  /** Fit a sphere to the vertices of the chosen cortex regions (at most ~200 000 of them, evenly picked). */
  private updateNodule(): void {
    const part = this.partition;
    const loaded = this.loaded;
    const st = this.store.state;
    this.nodule = null;
    if (part && loaded && this.regions && !this.isGeneric()) {
      const used = st.regions.filter((r, i) => r.type === 'cortex' && !st.nodule.exclude.includes(r.id) && this.seedComponent[i] >= 0 && this.seedComponent.indexOf(this.seedComponent[i]) === i);
      const comps = new Set(used.map((r) => this.seedComponent[st.regions.indexOf(r)]));
      if (comps.size) {
        const idx = loaded.geometry.index!.array;
        const pos = loaded.geometry.getAttribute('position').array as Float32Array;
        const take = new Uint8Array(pos.length / 3);
        for (let t = 0; t < part.region.length; t++) if (comps.has(part.region[t])) take[idx[3 * t]] = take[idx[3 * t + 1]] = take[idx[3 * t + 2]] = 1;
        const verts: number[] = [];
        let n = 0;
        for (let v = 0; v < take.length; v++) if (take[v]) n++;
        const stride = Math.max(1, Math.ceil(n / 200_000));
        let k = 0;
        const o = loaded.offset;
        for (let v = 0; v < take.length; v++) if (take[v] && k++ % stride === 0) verts.push(pos[3 * v] + o[0], pos[3 * v + 1] + o[1], pos[3 * v + 2] + o[2]);
        const fit = fitSphere(verts);
        if (fit) this.nodule = { ...fit, regions: used.map((r) => r.id) };
      }
    }
    this.showNodule();
    this.sidebar.refresh('nodule');
    this.refreshHint();
  }

  /** The fitted sphere as a wireframe, in the measure mode when asked for. */
  private showNodule(): void {
    const v = this.viewer;
    if (!v) return;
    if (this.noduleMesh) {
      v.overlay.remove(this.noduleMesh);
      this.noduleMesh.geometry.dispose();
      (this.noduleMesh.material as THREE.Material).dispose();
      this.noduleMesh = null;
    }
    const f = this.nodule;
    if (f && this.store.state.nodule.show && this.mode === 'measure') {
      this.noduleMesh = new THREE.Mesh(new THREE.SphereGeometry(f.radius, 48, 24), new THREE.MeshBasicMaterial({ color: REGION_COLORS.cortex, wireframe: true, transparent: true, opacity: 0.45 }));
      this.noduleMesh.position.set(...f.center);
      v.overlay.add(this.noduleMesh);
    }
    v.requestRender();
  }

  private paintRegions(): void {
    const loaded = this.loaded;
    const layer = this.regionLayer;
    if (!layer) return;
    const results = this.regions?.results ?? [];
    const st = this.store.state;
    layer.dimmed = this.mode === 'measure';
    const sequencing = this.sequencing();
    const seq = this.arrowColorMode() === 'sequence' || sequencing ? sequenceColors(st.sequences) : null;
    const loose = sequencing ? this.unsequenced() : null;
    const em = this.emphasis();
    const paints = this.display.regions
      ? results.flatMap((r, i) => {
          const c = this.seedComponent[i];
          if (c < 0 || this.seedComponent.indexOf(c) !== i) return [];
          const hl = !!em && !!r.scarId && em.ids.has(r.scarId);
          return [{ component: c, color: hl ? em!.color : regionColorOf(r, st.scars, seq), selected: hl || r.id === this.selection.id, faded: (!!loose && r.type === 'scar' && !!r.scarId && loose.has(r.scarId)) || (this.mode === 'retouch' && r.type !== 'retouch') }];
        })
      : [];
    const g = loaded?.geometry;
    layer.sync((g?.getAttribute('position') as THREE.BufferAttribute) ?? null, g?.index?.array ?? null, this.partition?.region ?? null, paints, loaded?.offset ?? [0, 0, 0]);
    // the upper layer, fainter, under them
    if (this.upperLayer) {
      this.upperLayer.dimmed = this.mode === 'measure' || this.mode === 'retouch';
      const above = this.display.regions
        ? results.flatMap((r, i) => {
            const c = this.upperComponent[i];
            return c >= 0 && this.upperComponent.indexOf(c) === i ? [{ component: c, color: regionColorOf(r, st.scars, seq), selected: r.id === this.selection.id }] : [];
          })
        : [];
      this.upperLayer.sync((g?.getAttribute('position') as THREE.BufferAttribute) ?? null, g?.index?.array ?? null, this.upper?.partition.region ?? null, above, loaded?.offset ?? [0, 0, 0]);
    }
    this.viewer?.requestRender();
  }

  /** Recompute the planes from their inputs, then their sections of the model (in slices). */
  private updatePlanes(): void {
    const st = this.store.state;
    const axes = this.vertexAxes();
    this.planes = st.planes.map((p) => computePlane(p, st, axes, this.regionFits.get(p.id) ?? null));
    const base = this.measureBase;
    const loaded = this.loaded;
    for (const id of [...this.cuts.keys()]) if (this.store.plane(id) && !this.planes.some((p) => p.id === id && p.valid)) this.cuts.delete(id);
    if (!base || !loaded) return;
    for (const r of this.planes) if (r.valid) this.cutModel(r.id, r.center!, r.normal!);
    this.sidebar?.refresh('planes');
  }

  measuringBusy(): boolean {
    return this.hasMesh() && !this.measureBase;
  }

  /** Measure the mesh in slices after it is shown (area, volume, closedness, principal axes). */
  private startMeasuring(loaded: LoadedMesh): void {
    const token = ++this.measureToken;
    this.measureBase = null;
    this.auto = null;
    this.configBox = null;
    this.autoFrameKey = '';
    const g = loaded.geometry;
    void runSliced(surfaceMeasuresSteps(g.getAttribute('position').array as Float32Array, g.index!.array as Uint32Array)).then((base) => {
      if (token !== this.measureToken) return;
      this.measureBase = base;
      this.updateAuto();
      this.updatePlanes();
      this.updateSections();
      this.updatePartition();
      this.updateSplit();
      this.syncAnnotations();
      this.scheduleEdgeAngles();
    });
  }

  /** Length, width and thickness follow the specimen frame: recompute when it changes. */
  private updateAuto(): void {
    const base = this.measureBase;
    const loaded = this.loaded;
    if (!base || !loaded) return;
    const frame = this.store.state.specimen.frame;
    const key = JSON.stringify(frame);
    if (this.auto && key === this.autoFrameKey) return;
    this.autoFrameKey = key;
    // the same pass gives the box of the volumetric configuration
    const m = frameMeasures(loaded.geometry.getAttribute('position').array as Float32Array, base, frame, loaded.offset);
    this.auto = m.auto;
    this.configBox = m.box;
    this.sidebar.refresh('measure');
    this.updateConfiguration();
    if (this.pickedFace) this.syncAnnotations();
    this.refreshHint();
  }

  saveProject(): void {
    if (!this.hasMesh()) return;
    // agreement analysis tells observers apart by their name
    if (!this.store.state.specimen.annotator.trim()) this.feedback.toast(t('toast.noAnnotator'), 'info', 5000);
    const file = serializeProject(this.store.state, __APP_VERSION__, this.meshResults());
    void this.save(`${this.stem()}.lithicanalyst.json`, JSON.stringify(file, null, 2), 'application/json').then((outcome) => {
      if (outcome !== 'saved') return;
      // a read-only folder: this model's edits are downloaded now
      this.keepSessionProject();
      this.undownloaded.delete(this.currentFile());
      this.unsaved = false;
      this.sidebar.refresh('workspace');
    });
  }

  openProject(): void {
    this.projectInput.click();
  }

  private async save(name: string, text: string, mime: string): Promise<Awaited<ReturnType<typeof saveTextFile>>> {
    const outcome = await saveTextFile(name, text, mime);
    if (outcome === 'saved') this.feedback.toast(t('toast.saved', { name }));
    else if (outcome === 'declined') this.feedback.toast(t('toast.declined'));
    else if (outcome === 'busy') this.feedback.toast(t('toast.busy'), 'warn');
    else this.feedback.showCopy(name, text);
    return outcome;
  }

  private deleteSelection(e: KeyboardEvent): void {
    const sel = this.selection.id;
    if (!sel) return;
    e.preventDefault();
    if (this.mode === 'measure') {
      if (this.store.measurement(sel)) deleteMeasurement(this.store, sel);
      else if (this.store.plane(sel)) deletePlane(this.store, sel);
      return;
    }
    if (this.mode === 'present') {
      if (this.store.section(sel)) deleteSection(this.store, sel);
      return;
    }
    if (this.mode !== 'annotate') return;
    if (this.store.state.flake.axis?.id === sel) deleteTechnicalAxis(this.store);
    else if (this.store.workingEdge(sel)) deleteWorkingEdge(this.store, sel);
    else if (this.store.region(sel)) deleteRegion(this.store, sel);
    else if (this.store.relation(sel)) deleteRelation(this.store, sel);
    else if (this.store.sequence(sel)) deleteSequence(this.store, sel);
    else if (this.store.landmark(sel)) deleteLandmark(this.store, sel);
    else if (this.store.semilandmarkSet(sel)) deleteSemilandmarkSet(this.store, sel);
    else if (this.store.curve(sel)) deleteCurve(this.store, sel);
    else if (this.store.scar(sel)) deleteScar(this.store, sel);
  }

  undo(): void {
    const c = this.store.history.undo();
    if (c) this.feedback.toast(t('toast.undo', { what: t(c.labelKey) }), 'info', 1600);
  }

  redo(): void {
    const c = this.store.history.redo();
    if (c) this.feedback.toast(t('toast.redo', { what: t(c.labelKey) }), 'info', 1600);
  }

  // ------------------------------------------------------------ shading

  private applyShading(): void {
    const mv = this.meshView;
    if (!mv) return;
    if (this.display.shading === 'scan' && !mv.hasScanColors) this.display.shading = 'plain';
    mv.setShading(this.display.shading);
    if (this.display.shading === 'curvature') void this.updateCurvatureColors();
    this.viewer?.requestRender();
  }

  private async updateCurvatureColors(): Promise<void> {
    const svc = this.curvature;
    const mv = this.meshView;
    if (!svc || !mv) return;
    const token = ++this.curvToken;
    this.curvBusy = true;
    this.sidebar.refresh('display');
    const colors = await svc.colors(this.display.curvScale, this.display.curvContrast);
    if (token !== this.curvToken || svc !== this.curvature) return;
    this.curvBusy = false;
    if (colors) mv.setCurvatureColors(colors);
    this.sidebar.refresh('display');
    this.viewer?.requestRender();
  }

  // ------------------------------------------------------------ meshes and projects

  /** Let go of the model and of everything drawn or computed for it (another model follows, or none). */
  private releaseMesh(): void {
    this.relationChip?.close();
    this.clearHints();
    this.surfaceSnap?.dispose();
    this.curvature?.dispose();
    this.meshView?.dispose();
    this.surfaceSnap = null;
    this.curvature = null;
    this.meshView = null;
    this.arrows?.clearAll();
    this.curves?.clearAll();
    this.landmarkLayer?.clearAll();
    this.resetObservers();
    this.measures?.clearAll();
    this.planesLayer?.clearAll();
    this.sectionLayer?.clearAll();
    this.regionLayer?.clear();
    this.upperLayer?.clear();
    this.borderLayer?.clear();
    this.partition = null;
    this.rawLower = null;
    this.retouchBands = new Map();
    this.retouchSides.clear();
    this.bandPiece = new Map();
    this.bandKey = '';
    this.regions = null;
    this.seedComponent = [];
    this.upper = null;
    this.upperComponent = [];
    this.outlineSeeds.clear();
    this.partitionToken++;
    this.nodule = null;
    this.cuts.clear();
    this.planes = [];
    this.borders = [];
    this.bordersToken++;
    this.split = null;
    this.splitRaw = null;
    this.splitBusy = false;
    this.splitToken++;
    this.configBox = null;
    this.configResult = null;
    this.pickedFace = null;
    this.flake = null;
    this.flakeToken++;
    this.edgeResults.clear();
    this.retouchResults.clear();
    this.retouchIndex = null;
    this.retouchIndexKey = '';
    this.retouchIndexToken++;
    this.retouchFrame = null;
    this.retouchFaces = null;
    this.retouchPieces = new Map();
    this.retouchLastInput = null;
    this.retouchFitKey = '';
    this.fitPreview = null;
    this.retouchStation = null;
    this.stationAuto = true;
    this.stationCache = null;
    this.planMarked = null;
    this.planShapeOf = null;
    this.planLoops = null;
    this.segmentLines = null;
    this.fitCurve = null;
    this.retouchExtrasToken++;
    this.retouchLayer?.clear();
    this.gm = null;
    this.gmDoneKey = '';
    this.edgeToken++;
    this.edgeLayer?.clear();
    this.workingEdgeLayer?.clear();
    this.edgeDetails = null;
    this.planEdgeId = null;
    this.edgeDrag = null;
    this.edgeColorKey = '';
    if (this.edgeLegend) this.edgeLegend.hidden = true;
    this.flakeMorph = null;
    this.flakeSection = null;
    this.platformAuto = null;
    this.platformToken++;
    this.regionFits = new Map();
    this.regionFitToken++;
    this.profileCross = null;
    this.profileAt = 0.5;
    this.ringLayer?.clear();
    this.loaded = null;
    this.syncConfigViews();
  }

  /** `specimenId`: the ID a new project gets (in a folder, see specimenIds); else the file name without its extension. */
  private installMesh(loaded: LoadedMesh, specimenId?: string): void {
    const v = this.viewer;
    if (!v) return;
    // an unfinished curve is kept with the previous model, then saved
    this.tools?.cancel();
    this.flushAutosave();
    this.releaseMesh();
    this.loaded = loaded;
    this.meshView = new MeshView(loaded);
    this.meshView.setRoughness(0.95 - 0.7 * GLOSS);
    const g = loaded.geometry;
    this.curvature = new CurvatureService(
      g.getAttribute('position').array as Float32Array,
      g.getAttribute('normal').array as Float32Array,
      g.index!.array as Uint32Array,
      loaded.orientationSign,
    );
    this.surfaceSnap = new SurfaceSnap(loaded, this.curvature, () => this.display.curvScale);
    this.curves?.setOrigin(loaded.offset);
    this.measures?.setOrigin(loaded.offset);
    this.planesLayer?.setOrigin(loaded.offset);
    this.sectionLayer?.setOrigin(loaded.offset);
    this.curvBusy = false;
    v.setMesh(this.meshView.mesh, loaded.offset, loaded.diagonal);

    const prev = this.store.state;
    const fresh = emptyProject();
    fresh.mesh = loaded.info;
    fresh.specimen = {
      id: specimenId ?? loaded.info.fileName.replace(/\.[^.]+$/, ''),
      annotator: readPref('annotator', prev.specimen.annotator),
      unit: readPref('unit', prev.specimen.unit || 'mm'),
      notes: '',
      frame: null,
      // the type chosen on the start page, else as the last one (a project file then says what it is)
      type: this.newSpecimenType(prev.specimen.type),
    };
    this.selection.set(null);
    if (this.workspace && this.folderSharp) fresh.sharpEdge = { ...this.folderSharp };
    if (this.workspace && this.folderGm) fresh.gm = structuredClone(this.folderGm);
    this.store.reset(fresh);
    this.startMeasuring(loaded);
    this.applyShading();
    this.updateMeshDependentUi();
    this.sidebar.refresh('all');
  }

  /**
   * Close the model: finish the tool's work and the pending saves, let go of the
   * model and its layers, the undo history, the selection and the observers
   * compared with it, leave the folder, and go back to the start page. Asks first only
   * when edits would be lost: a read-only folder with edits not downloaded, or
   * an autosave that failed. With no model, only the last of that.
   */
  async closeModel(): Promise<void> {
    if (this.batch) return;
    if (!this.hasMesh()) {
      if (this.workspace) return;
      this.popovers.close();
      this.entered = false;
      this.updateMeshDependentUi();
      return;
    }
    this.popovers.close();
    this.relationChip?.close();
    this.tools?.cancel();
    await this.flushFolderSave();
    this.flushAutosave();
    const readOnly = !!this.workspace && !this.workspace.writable;
    const reason = this.autosaveFailed ? 'dlg.closeModel.autosaveFailed' : readOnly && this.lossOnLeaving() ? 'dlg.closeModel.notDownloaded' : null;
    if (reason && !(await this.feedback.confirm(t('dlg.closeModel.title'), t(reason), t('dlg.closeModel.yes'), t('dlg.cancel')))) return;
    this.setTool('select');
    this.releaseMesh();
    this.viewer?.clearMesh();
    this.measureToken++;
    this.measureBase = null;
    this.auto = null;
    this.autoFrameKey = '';
    this.faceAreas = null;
    this.curvBusy = false;
    this.pendingProject = null;
    this.lastHover = null;
    this.workspace = null;
    this.wsIndex = -1;
    this.projectIndex = null;
    this.wsIds = new Map();
    this.wsDuplicates = [];
    this.sessionProjects.clear();
    this.undownloaded.clear();
    this.autosaveFailed = false;
    this.selection.set(null);
    this.store.reset(emptyProject());
    this.showNodule();
    this.entered = false;
    this.updateMeshDependentUi();
    this.sidebar.refresh('all');
    this.queueCoords();
  }

  private applyProject(state: ProjectState, toastKey: string | null = 'toast.projectLoaded'): void {
    withPlatformEnds(state);
    withRetouchCurvesKept(state);
    state.mesh = this.store.state.mesh;
    this.tools?.cancel();
    this.selection.set(null);
    if (this.workspace && this.folderSharp) state.sharpEdge = { ...this.folderSharp };
    if (this.workspace && this.folderGm) state.gm = structuredClone(this.folderGm);
    this.store.reset(state);
    if (toastKey) this.feedback.toast(t(toastKey, { what: countsText(state) }));
  }

  /** `project`: the project file kept next to the model in a workspace; `quiet`: no questions (batch runs). */
  /** `project`: project files that may be the model's (a folder's); `quiet`: no questions (batch runs); `specimenId`: for a new project. */
  private async openMeshFile(file: File, opts: { project?: ProjectState[]; quiet?: boolean; specimenId?: string } = {}): Promise<void> {
    if (!this.viewer) return;
    const host = this.startShown() ? this.startEl : this.viewportEl;
    try {
      const raw = await readMeshFile(file, async (stage) => {
        this.feedback.busy(t(`load.${stage}`), host);
        await nextFrame();
      });
      this.feedback.busy(t('load.indexing'), host);
      await nextFrame();
      const loaded = buildLoadedMesh(raw);
      this.installMesh(loaded, opts.specimenId);
      this.feedback.busy(null);
      if (!opts.quiet) this.feedback.toast(t('toast.loaded', { name: file.name }));
      await this.afterMeshLoaded(loaded, opts);
    } catch (e) {
      this.feedback.busy(null);
      const err = e as Error;
      if (e instanceof MeshLoadError) {
        const key = { unsupported: 'error.unsupported', pointcloud: 'error.pointcloud', empty: 'error.empty', parse: 'error.parse' }[e.code];
        this.feedback.toast(t(key, { msg: err.message }), 'error');
      } else {
        this.feedback.toast(t('error.parse', { msg: err?.message ?? String(e) }), 'error');
      }
    }
  }

  private async afterMeshLoaded(loaded: LoadedMesh, opts: { project?: ProjectState[]; quiet?: boolean } = {}): Promise<void> {
    const pending = this.pendingProject;
    this.pendingProject = null;
    if (pending && pending.mesh?.sha256 === loaded.info.sha256) {
      this.applyProject(pending);
      return;
    }
    // the first project file made on this very model (an old one next to it may belong to another)
    const kept = opts.project?.find((p) => p.mesh?.sha256 === loaded.info.sha256) ?? null;
    if (opts.quiet) {
      if (kept) this.applyProject(kept, null);
      return;
    }
    const entry = readAutosave(loaded.info.sha256);
    // the project next to the model wins, unless the browser holds later edits of it
    const later = (entry?.file as { modifiedAt?: string } | undefined)?.modifiedAt ?? '';
    if (kept && !(later > kept.modifiedAt)) {
      this.applyProject(kept, null);
      return;
    }
    if (!entry) return;
    let saved: ProjectState;
    try {
      saved = parseProjectFile(entry.file);
    } catch (e) {
      this.feedback.toast(t('error.project', { msg: (e as Error).message }), 'error');
      return;
    }
    if (!saved.scars.length && !saved.curves.length && !saved.measurements.length && !saved.flake.axis) return;
    const when = new Date(entry.savedAt).toLocaleString(getLang() === 'zh' ? 'zh-CN' : 'en-GB');
    const what = countsText(saved);
    const ok = await this.feedback.confirm(
      t('dlg.restore.title'),
      t('dlg.restore.body', { what, time: when }),
      t('dlg.restore.yes'),
      t('dlg.restore.no'),
    );
    if (!ok) return;
    this.applyProject(saved, null);
    this.feedback.toast(t('toast.restored', { what }));
  }

  private async openProjectFile(file: File): Promise<void> {
    let state: ProjectState;
    try {
      state = parseProjectFile(JSON.parse(await file.text()));
    } catch (e) {
      this.feedback.toast(t('error.project', { msg: (e as Error).message }), 'error');
      return;
    }
    const cur = this.store.state.mesh;
    if (state.mesh && (!cur || state.mesh.sha256 !== cur.sha256)) {
      const buttons = [
        { id: 'cancel', label: t('dlg.cancel') },
        ...(cur ? [{ id: 'load', label: t('dlg.mismatch.yes') }] : []),
        { id: 'open', label: t('dlg.mismatch.openModel'), kind: 'primary' as const },
      ];
      const choice = await this.feedback.choose(t('dlg.mismatch.title'), t('dlg.mismatch.body', { file: state.mesh.fileName }), buttons);
      if (choice === 'open') {
        this.pendingProject = state;
        this.meshInput.click();
        return;
      }
      if (choice !== 'load') return;
    }
    if (!cur) return;
    this.applyProject(state);
  }

  private handleFile(file: File): void {
    const ext = extensionOf(file.name);
    if (ext === 'json') void this.openProjectFile(file);
    else if (['ply', 'stl', 'obj'].includes(ext)) void this.openMeshFile(file);
    else this.feedback.toast(t('error.unsupported'), 'error');
  }

  // ------------------------------------------------------------ autosave

  private scheduleAutosave(): void {
    if (!this.autosaveOk) return;
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => this.writeAutosaveNow(), 600);
  }

  /** Write a pending autosave immediately (before switching meshes or leaving the page). */
  private flushAutosave(): void {
    if (!this.autosaveTimer) return;
    clearTimeout(this.autosaveTimer);
    this.writeAutosaveNow();
  }

  private writeAutosaveNow(): void {
    this.autosaveTimer = 0;
    const st = this.store.state;
    if (!st.mesh) return;
    const ok = writeAutosave(st.mesh.sha256, serializeProject(st, __APP_VERSION__, this.meshResults()));
    this.autosaveFailed = !ok;
    // the browser's storage is small; say so once instead of failing silently
    if (!ok && !this.autosaveWarned) {
      this.autosaveWarned = true;
      this.feedback.toast(t('toast.autosaveFull'), 'warn', 6000);
    }
  }

  // ------------------------------------------------------------ wiring

  private wireFiles(): void {
    this.meshInput.addEventListener('change', () => {
      const f = this.meshInput.files?.[0];
      this.meshInput.value = '';
      if (f) void this.openMeshFile(f);
      else this.pendingProject = null;
    });
    this.projectInput.addEventListener('change', () => {
      const f = this.projectInput.files?.[0];
      this.projectInput.value = '';
      if (f) void this.openProjectFile(f);
    });
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    let depth = 0;
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      depth++;
      this.dropEl.hidden = false;
    });
    window.addEventListener('dragover', (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) this.dropEl.hidden = true;
    });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      this.dropEl.hidden = true;
      const f = e.dataTransfer?.files?.[0];
      if (f) this.handleFile(f);
    });
  }

  private wireKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (document.querySelector('.modal-backdrop')) return;
      // the start page's keys are its controls' own
      if (this.startShown()) return;
      if (e.key === 'Escape' && this.popovers.close()) {
        e.preventDefault();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 's') {
        e.preventDefault();
        this.saveProject();
        return;
      }
      if (isTyping(e.target)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      // the bar of the relation just recorded: 1 / 2 / 3, Delete; Esc lets it go
      if (this.relationChip && !mod && !e.altKey && !e.shiftKey) {
        const choice = CHIP_KEYS[e.code];
        if (choice || e.key === 'Escape') {
          e.preventDefault();
          if (choice) this.applyRelationChoice(choice);
          else this.relationChip.close();
          return;
        }
      }
      const tool = this.tools?.activeTool ?? null;
      if (e.key === 'Shift') tool?.modifiersChanged?.(e);
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else if (!tool?.undoStep?.()) this.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        this.redo();
        return;
      }
      if (mod || e.altKey) return;
      const sel = this.selection.id;
      if (e.code === 'Space') {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        this.tools?.setSpaceHeld(true);
        return;
      }
      if (e.code === 'KeyL') {
        if (!e.repeat) this.tools?.setLightHeld(true);
        return;
      }
      if (e.repeat && !['BracketLeft', 'BracketRight', 'Backspace', 'ArrowLeft', 'ArrowRight'].includes(e.code)) return;
      switch (e.code) {
        case 'KeyM':
          // (no model: the modes are not shown)
          if (this.hasMesh()) this.cycleMode();
          return;
        case 'KeyA':
          if (this.hasMesh() && this.mode === 'annotate') this.setTool('draw');
          return;
        case 'KeyR':
          if (this.hasMesh() && this.mode === 'annotate') this.setTool('region');
          return;
        case 'KeyP':
          if (this.hasMesh() && this.mode === 'annotate') this.setTool('curve');
          return;
        case 'KeyW':
          if (this.hasMesh() && this.mode === 'annotate' && this.isFlake()) this.setTool('working-edge');
          return;
        case 'KeyB':
          if (this.hasMesh() && this.mode === 'annotate' && !this.isGeneric()) this.setTool('relation');
          return;
        case 'KeyQ':
          if (this.hasMesh() && this.mode === 'annotate' && !this.isGeneric()) this.setTool('sequence');
          return;
        case 'KeyK':
          if (this.hasMesh() && this.mode === 'annotate') this.setTool('landmark');
          return;
        case 'KeyT':
          if (this.hasMesh() && this.mode === 'annotate' && this.isFlake()) this.setTool('axis');
          return;
        case 'KeyF':
          if (this.hasMesh() && this.mode !== 'compare') this.orientToAxis();
          return;
        case 'KeyX':
          if (this.hasMesh() && this.mode === 'present') this.setTool('section');
          return;
        case 'ArrowLeft':
        case 'ArrowRight':
          if (this.retouching()) {
            e.preventDefault();
            this.stepStation((e.code === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1));
          }
          return;
        case 'KeyD':
        case 'KeyG':
        case 'KeyN': {
          // N: a new sequence, in the sequence tool
          if (e.code === 'KeyN' && this.sequencing()) {
            this.newSequence();
            return;
          }
          const tool = MEASURE_TOOLS.find(([, , k]) => `Key${k}` === e.code);
          if (tool && this.hasMesh() && this.mode === 'measure') this.setTool(tool[0]);
          return;
        }
        case 'KeyV':
          this.setTool('select');
          return;
        case 'KeyS':
          if (['curve', 'landmark', 'axis'].includes(this.tools?.activeId ?? '')) this.cycleSnap();
          return;
        case 'Enter':
        case 'NumpadEnter':
          if (tool?.commit?.()) e.preventDefault();
          return;
        case 'Escape':
          // first what is fixed of a measure's drawing
          if (this.unpinHint()) return;
          if (!this.tools?.cancel()) {
            if (this.pickedFace) this.selectConfigFace(null);
            this.selection.set(null);
          }
          return;
        case 'Backspace':
          if (tool?.undoStep?.()) {
            e.preventDefault();
            return;
          }
          if (e.repeat) return;
          this.deleteSelection(e);
          return;
        case 'Delete':
          this.deleteSelection(e);
          return;
        case 'KeyH':
          this.viewer?.viewAll(true);
          return;
        case 'PageDown':
        case 'PageUp':
          if (this.workspace) {
            e.preventDefault();
            // Shift + PageDown: the next model not started yet
            if (e.shiftKey && e.code === 'PageDown') this.nextUnstarted();
            else this.stepWorkspace(e.code === 'PageDown' ? 1 : -1);
          }
          return;
        case 'KeyC':
          if (this.lastHover) {
            this.viewer?.setRotationCenter(this.lastHover.point);
            this.feedback.toast(t('toast.rotationCentre'), 'info', 1200);
          }
          return;
        case 'BracketRight':
        case 'BracketLeft': {
          if (this.mode !== 'annotate') return;
          // step through the kind of item that is selected (arrows first when nothing is)
          const st = this.store.state;
          const ids = (sel && this.store.curve(sel)) || (!sel && !st.scars.length) ? st.curves.map((c) => c.id) : st.scars.map((a) => a.id);
          if (!ids.length) return;
          const i = sel ? ids.indexOf(sel) : -1;
          const step = e.code === 'BracketRight' ? 1 : -1;
          this.selection.set(ids[(i + step + ids.length) % ids.length] ?? ids[0]);
          return;
        }
        default:
          break;
      }
      if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) {
        this.showHelp();
        return;
      }
      const digit = /^Digit([1-9])$/.exec(e.code) ?? /^Numpad([1-9])$/.exec(e.code);
      // the sequence tool: 1–9 choose the current sequence
      if (digit && !e.shiftKey && this.sequencing()) {
        const q = this.store.state.sequences[Number(digit[1]) - 1];
        if (q) this.setCurrentSequence(q.id);
        return;
      }
      if (digit && sel && this.mode === 'annotate') {
        // a generic specimen's arrows have no attributes, nor its regions layers
        const generic = this.isGeneric();
        if (generic && (e.shiftKey || this.store.scar(sel))) return;
        // Shift + 1–5: the selected arrow's termination, or the selected retouch region's layer
        if (e.shiftKey) {
          const region = this.store.region(sel);
          if (region?.type === 'retouch') {
            const layer = Number(digit[1]);
            if ((RETOUCH_LAYERS as readonly number[]).includes(layer)) setRegionRetouchLayer(this.store, sel, layer);
            return;
          }
          const f = shiftNumberKeyField(SCAR_FIELDS);
          const opt = f?.options?.[Number(digit[1]) - 1];
          if (f && opt && this.store.scar(sel)) setScarAttribute(this.store, sel, f.key, opt.value);
          return;
        }
        const specimenType = this.store.state.specimen.type;
        if (this.store.region(sel)) {
          const field = numberKeyField(REGION_FIELDS);
          const opt = field ? keyedOptions(field, specimenType)[Number(digit[1]) - 1] : undefined;
          if (opt === 'custom') {
            // not typed into the box it opens
            e.preventDefault();
            return this.sidebar.openCustomType();
          }
          if (opt) this.setRegionTypeFor(sel, opt.value as RegionType);
          return;
        }
        const isCurve = !!this.store.curve(sel);
        const f = numberKeyField(isCurve ? CURVE_FIELDS : SCAR_FIELDS);
        if (!f) return;
        const opt = keyedOptions(f, specimenType)[Number(digit[1]) - 1];
        // "custom": the user's own text
        if (opt === 'custom') {
          // not typed into the box it opens
          e.preventDefault();
          return this.sidebar.openCustomType();
        }
        if (!opt) return;
        if (isCurve) setCurveAttribute(this.store, sel, f.key, opt.value);
        else setScarAttribute(this.store, sel, f.key, opt.value);
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.tools?.setSpaceHeld(false);
      if (e.code === 'KeyL') this.tools?.setLightHeld(false);
      if (e.key === 'Shift' && !isTyping(e.target)) this.tools?.activeTool?.modifiersChanged?.(e);
    });
    window.addEventListener('blur', () => {
      this.tools?.setSpaceHeld(false);
      this.tools?.setLightHeld(false);
    });
  }

  /**
   * Select tool: the item under the cursor changed or the cursor moved over it; after a
   * pause its label and kind are shown next to the cursor ("S2 · Scar arrow").
   */
  private hoverTip(item: { id: string; x: number; y: number } | null): void {
    clearTimeout(this.hoverTipTimer);
    tips.hideAt();
    if (!item) return;
    this.hoverTipTimer = window.setTimeout(() => {
      const s = this.store;
      const scar = s.scar(item.id), curve = s.curve(item.id), landmark = s.landmark(item.id), m = s.measurement(item.id);
      const shownName = landmark ? this.labelledLandmarks().find((l) => l.id === landmark.id)?.name : '';
      const label = s.state.flake.axis?.id === item.id
        ? t('hover.axis')
        : scar
        ? `${scar.label} · ${t(this.isGeneric() ? 'hover.arrow.generic' : 'hover.arrow')}`
        : curve
          ? `${curve.label} · ${t('hover.curve')}`
          : landmark
            ? `${shownName} · ${t('hover.landmark')}`
            : m
              ? `${m.label} · ${t(`measure.type.${m.type}`)}`
              : null;
      if (label) tips.showAt(item.x, item.y, { label });
    }, 300);
  }

  /** The shortcuts: two columns (general and mouse; the modes), keys as key caps, no explanations. */
  private showHelp(): void {
    const specimen = this.store.state.specimen.type;
    const keyCount = (f: FieldDef | undefined) => (f ? keyedOptions(f, specimen).length : 0);
    const count = Math.max(keyCount(numberKeyField(SCAR_FIELDS)), keyCount(numberKeyField(CURVE_FIELDS)), keyCount(numberKeyField(REGION_FIELDS))) || 5;
    const generic = this.isGeneric();
    /** Keys ("Ctrl+Z / Ctrl+Shift+Z", "1 / 2 / 3 · Delete") as key caps; `hold`: to be held down. */
    const keys = (spec: string, hold: boolean): HTMLElement => {
      const dt = h('dt', {});
      if (hold) dt.append(h('span', { class: 'help-hold' }, t('help.hold')), ' ');
      spec.split(/( \/ | · | – )/).forEach((part, i) => dt.append(i % 2 ? h('span', { class: 'help-key-sep' }, part) : h('kbd', {}, part)));
      return dt;
    };
    type Row = [string, string, boolean?];
    const group = (title: string, rows: Row[], mouse = false): HTMLElement[] => [
      h('h3', {}, title),
      h('dl', {}, ...rows.flatMap(([k, v, hold]) => [mouse ? h('dt', { class: 'help-mouse' }, t(k)) : keys(k, !!hold), h('dd', {}, t(v))])),
    ];
    const left = h(
      'div',
      { class: 'help-col' },
      ...group(t('help.group.general'), [
        ['M', 'help.k.mode'],
        ['V', 'help.k.select'],
        ['H', 'help.k.fit'],
        ['C', 'help.k.centre'],
        ['L', 'help.k.light', true],
        ['Space', 'help.k.space', true],
        ['Esc', 'help.k.esc'],
        ['Delete', 'help.k.delete'],
        ['Ctrl+Z / Ctrl+Shift+Z', 'help.k.undo'],
        ['Ctrl+S', 'help.k.save'],
        ['PageUp / PageDown', 'help.k.workspace'],
        ['Shift+PageDown', 'help.k.nextNew'],
      ]),
      ...group(
        t('help.group.mouse'),
        [
          ['help.m.leftDrag', 'help.m.rotate'],
          ['help.m.rightDrag', 'help.m.rotateDrawing'],
          ['help.m.middleDrag', 'help.m.pan'],
          ['help.m.wheel', 'help.m.zoom'],
          ['help.m.dblclick', 'help.m.centre'],
          ['help.m.firstPoint', 'help.m.close'],
        ],
        true,
      ),
    );
    const right = h(
      'div',
      { class: 'help-col' },
      ...group(t('appMode.annotate'), [
        ...(this.isFlake() ? ([['T', 'help.k.axis'], ['F', 'help.k.orient']] as Row[]) : []),
        ['A', 'help.k.draw'],
        ['P', 'help.k.curve'],
        ...(this.isFlake() ? ([['W', 'help.k.workingEdge']] as Row[]) : []),
        ['R', 'help.k.region'],
        ...(generic ? [] : ([['B', 'help.k.relation'], ['Q', 'help.k.sequence']] as Row[])),
        ['K', 'help.k.landmark'],
        ...(generic
          ? ([['1', 'help.k.customType']] as Row[])
          : ([
              ['1 / 2 / 3 · Delete', 'help.k.relationPick'],
              ['1 – 9 / N', 'help.k.sequencePick'],
              [`1 – ${count}`, 'help.k.complete'],
              [`Shift+1 – ${shiftNumberKeyField(SCAR_FIELDS)?.options?.length ?? 5}`, 'help.k.termination'],
            ] as Row[])),
        ['S', 'help.k.snap'],
        ['Shift', 'help.k.shift', true],
        ['Enter', 'help.k.finish'],
        ['Backspace', 'help.k.back'],
        ['] / [', 'help.k.next'],
      ]),
      ...group(t('appMode.measure'), [
        ['D / G / N', 'help.k.measure'],
        ['Backspace', 'help.k.back'],
      ]),
      ...((this.hasMesh() ? this.isFlake() : this.newSpecimenType() === 'flake')
        ? group(t('appMode.retouch'), [
            ['← / →', 'help.k.stationStep'],
            ['Shift+← / Shift+→', 'help.k.stationJump'],
          ])
        : []),
      ...group(t('appMode.present'), [['X', 'help.k.section']]),
    );
    const body = h('div', { class: 'help-cols', id: 'help-cols' }, left, right);
    void this.feedback.choose(t('help.title'), body, [{ id: 'close', label: t('dlg.close'), kind: 'primary' }], { wide: true });
  }

  /** Small hook for automated tests and power users (window.lithicanalyst). */
  private exposeDebugApi(): void {
    const api = {
      version: __APP_VERSION__,
      /** The shell's appearance (light or dark). */
      theme: () => getTheme(),
      state: () => this.store.state,
      selection: () => this.selection.id,
      selectForTest: (id: string | null) => this.selection.set(id),
      project: (p: Vec3) => this.viewer?.project(new THREE.Vector3(p[0], p[1], p[2])),
      /** Surface point under a client position, or null. */
      pick: (x: number, y: number): Vec3 | null => {
        const hit = this.viewer?.pickSurface(x, y);
        return hit ? [hit.point.x, hit.point.y, hit.point.z] : null;
      },
      view: (toward: Vec3, up: Vec3) => this.viewer?.viewFrom(toward, up),
      setTool: (id: string) => this.setTool(id),
      mode: () => this.mode,
      setMode: (m: AppMode) => this.setMode(m),
      exportCsvText: () => scarVectorCsv(this.store.state, { excelBom: false }, this.configResult),
      /** A flake's frame and measurements (null for a core). */
      flake: () =>
        this.isFlake()
          ? { axis: this.store.state.flake.axis, frameSource: frameSource(this.store.state), measures: this.flake?.measures ?? null, reasons: this.flake?.reasons ?? null, geometry: this.flake?.geometry ?? null, parameters: FLAKE_PARAMETERS, platformAuto: this.platformAuto?.seed ?? null }
          : null,
      /** The profile panel: shown or not, where the section across is (share of the technical length), its width and thickness, and how many lines the ring on the model has. */
      sectionPanel: () => ({
        shown: !!this.profileEl && !this.profileEl.hidden,
        at: this.profileAt,
        width: this.profileCross?.width ?? null,
        thickness: this.profileCross?.thickness ?? null,
        ring: this.ringLayer?.group.children.length ?? 0,
      }),
      exportFlakesCsvText: () => flakesCsv(this.store.state, this.flake?.measures ?? null, { excelBom: false }, this.retouchIndex?.indices ?? null),
      /** A flake's retouch indices as stored, and why what is empty is empty. */
      retouch: () => {
        const r = this.retouchIndex;
        return r ? { ...r.indices, reasons: r.reasons, stationReasons: r.details.map((d) => ({ curveId: d.curveId, station: d.station, reason: d.reason, giurReason: d.giurReason })) } : null;
      },
      /** The retouch mode: the current station, and what each view says it is. */
      retouchView: () => {
        const panel = (id: string) => document.querySelector(id)?.getAttribute('data-station') ?? null;
        return {
          station: this.retouchStationNow(),
          marker: this.retouchLayer?.stationPoint() ?? null,
          lines: this.retouchLayer?.counts() ?? null,
          section: panel('#retouch-section-drawing'),
          plan: panel('#retouch-plan-station'),
          chart: document.querySelector('#retouch-chart-cursor')?.getAttribute('data-position') ?? null,
          tool: this.tools?.activeId ?? null,
          face: this.planFace,
          mark: this.planMarked,
          fitCurve: this.retouchFitCurve(),
          /** The segments' middles on the model. */
          segments: this.retouchFrame?.frame.frame && this.planShapeOf
            ? this.planShapeOf.shape.segments.map((s) => {
                const f = this.retouchFrame!.frame.frame!, o = this.loaded?.offset ?? [0, 0, 0];
                return { segment: s.segment, model: [0, 1, 2].map((i) => f.origin[i] + o[i] + s.at[0] * f.x[i] + s.at[1] * f.y[i]) };
              })
            : null,
        };
      },
      /** Its settings, through the actions. */
      retouchSettings: (change: { fitLength?: number | null; axis?: RetouchAxisChoice; flip?: boolean }) => {
        if (change.fitLength !== undefined) setRetouchFitLength(this.store, change.fitLength);
        if (change.axis !== undefined) setRetouchAxis(this.store, change.axis);
        if (change.flip !== undefined) setRetouchFlip(this.store, change.flip);
      },
      /** A curve's edge angles (null: not measured, or no unit stated). */
      edgeAngles: (curveId: string) => this.edgeAngleResult(curveId),
      /** What the edge-angle colours show (null: none), and the two ends of their scale. */
      edgeColors: () => (this.edgeColorKey ? { key: this.edgeColorKey, min: this.edgeLegend?.querySelector('#edge-legend-min')?.textContent ?? null, max: this.edgeLegend?.querySelector('#edge-legend-max')?.textContent ?? null } : null),
      exportEdgeAnglesCsvText: () => edgeAnglesCsv(this.store.state, this.edgeAngleCurves(), { excelBom: false }),
      /** Where the end of an arrow being dragged is shown. */
      endpointPreview: () => this.arrows?.endpointOverride?.point ?? null,
      gm: () => this.gm,
      exportGmText: (kind: 'tps' | 'csv' | 'curves' | 'surfaces') => {
        const g = this.gm;
        if (!g) return '';
        const st = this.store.state;
        return kind === 'tps' ? landmarksTps(st, g) : kind === 'csv' ? gmLandmarksCsv(st, g, { excelBom: false }) : kind === 'curves' ? gmCurvesCsv(g) : gmSurfacesCsv(g);
      },
      gmTemplate: () => this.store.state.gm.template,
      gmTemplateInfo: () => this.gmTemplateInfo(),
      layGmTemplate: () => this.layGmTemplate(),
      gmDrawn: () => this.gmLayer?.counts() ?? null,
      retouchAngles: (curveId: string) => this.retouchAngleResult(curveId),
      sharpEdge: (curveId: string) => this.sharpOf(curveId),
      exportRetouchAnglesCsvText: () => retouchAnglesCsv(this.store.state, this.retouchAngleCurves(), { excelBom: false }),
      /** Each working edge's row, why what is empty is empty, and how it is drawn. */
      workingEdges: () => ({ rows: this.workingEdgeDetails().map((d) => ({ ...d.row, reasons: d.reasons, focus: d.focus })), drawn: this.workingEdgeLayer?.counts() ?? null, picked: this.planEdgeId, pending: this.tools?.activeTool instanceof WorkingEdgeTool ? this.tools.activeTool.pending() : null }),
      exportWorkingEdgesCsvText: () => workingEdgesCsv(this.store.state, this.workingEdgeDetails().map((d) => d.row), this.edgeAngleCurves(), { excelBom: false }),
      exportEdgeSharpCsvText: () => edgeSharpCsv(this.store.state, this.edgeAngleCurves(), { excelBom: false }),
      /** The volumetric configuration (null without arrows or before the mesh is measured). */
      configuration: () => this.configResult,
      bicone: () => (isBicone(this.configResult) ? this.configResult : null),
      light: () => ({ ...this.display.light }),
      configFace: () => this.pickedFace,
      selectConfigFace: (face: ConfigPick | null, turn = false) => this.selectConfigFace(face, turn),
      /** Why the bicone shows nothing (null: it does, or the box is used). */
      configStatus: () => this.configStatus(),
      /** Where a face's (or a cone's) middle is on the page, on the view cube and on the sketch (null when it faces away). */
      cubeFacePoint: (face: ConfigPick) => this.viewCube?.faceCentreClient(face) ?? null,
      sketchFacePoint: (face: ConfigPick) => this.sketch?.faceCentreClient(face) ?? null,
      /** The sketch's arrows: how many, and where the middle of a scar's is on the page (null when it faces away). */
      sketchArrowCount: () => this.sketch?.arrowCount() ?? 0,
      /** How many times the sketch and the view cube were drawn (the sketch only when it changes or is turned). */
      sketchRenders: () => this.sketch?.renders ?? 0,
      sketchOutlineWidth: () => this.sketch?.outlineWidth() ?? null,
      sketchOutlineBox: () => this.sketch?.outlineBox() ?? null,
      cubeDraws: () => this.viewCube?.draws ?? 0,
      sketchArrowPoint: (id: string) => this.sketch?.arrowClient(id) ?? null,
      /** Whether the configuration panel is shown. */
      configPanelShown: () => !!this.configEl && !this.configEl.hidden,
      exportConfigurationCsvText: () => configurationCsv(this.store.state, this.configResult, { excelBom: false }),
      exportFlakingSurfacesCsvText: () => flakingSurfacesCsv(this.store.state, this.configResult, { excelBom: false }),
      exportCurvesCsvText: () => curveCsv(this.store.state, { excelBom: false }),
      autoMeasurements: () => this.auto,
      planes: () => this.planes,
      planeSectionCount: (id: string) => this.cuts.get(id)?.lines?.length ?? null,
      sectionFigure: async (id: string, format: 'png' | 'svg') => {
        const sec = this.store.section(id);
        const fig = sec ? this.makeFigure(sec) : null;
        if (!fig) return null;
        return { layout: fig.layout, data: format === 'svg' ? await fig.svg() : btoa(Array.from(await fig.png(), (c) => String.fromCharCode(c)).join('')) };
      },
      clipping: () => this.meshView?.material.clippingPlanes?.length ?? 0,
      exportPlanesCsvText: () => planesCsv(this.store.state, this.planes, { excelBom: false }),
      towardViewer: () => this.viewer?.towardViewer() ?? null,
      cameraUp: () => this.viewer?.cameraUp() ?? null,
      /** Render the figure; PNG bytes as base64, or the SVG text. */
      figure: async (format: 'png' | 'svg') => {
        const fig = this.makeFigure();
        if (!fig) return null;
        if (format === 'svg') return { layout: fig.layout, data: await fig.svg() };
        const bytes = await fig.png();
        return { layout: fig.layout, data: btoa(Array.from(bytes, (c) => String.fromCharCode(c)).join('')) };
      },
      exportMeasurementsCsvText: () => measurementsCsv(this.store.state, this.auto, { excelBom: false }, this.regions?.totals ?? null, this.nodule, this.split, this.currentFile()),
      volumeSplit: () => this.split,
      /** The drawing of how a measure was taken: which row, what is fixed, its parts and what is on the view. */
      measureHint: () => ({
        key: this.hintShown?.key ?? null,
        pinned: this.hintPinned,
        prims: (this.hintShown?.hint ?? []).map((p) => ({ kind: p.kind, part: p.part, role: p.kind === 'faces' ? p.tint : p.role, label: p.kind === 'line' || p.kind === 'arc' ? (p.label ?? null) : null, points: p.kind === 'faces' ? null : p.points })),
        drawn: this.hintLayer?.counts() ?? null,
        labels: [...document.querySelectorAll<HTMLElement>('.hint-label')].map((el) => el.textContent ?? ''),
      }),
      nodule: () => this.nodule,
      regions: () => this.regions,
      regionCount: () => this.partition?.count ?? null,
      exportRegionsCsvText: () => regionsCsv(this.store.state, this.regions?.results ?? [], { excelBom: false }),
      exportManualMeasurementsCsvText: () => manualMeasurementsCsv(this.store.state, { excelBom: false }),
      exportRelationsCsvText: () => relationsCsv(this.store.state, { excelBom: false }),
      landmarkTable: () => this.landmarks,
      agreement: () => this.agreement,
      agreementBusy: () => this.agreementBusyFlag,
      observers: () => this.observerList(),
      workspace: () => this.workspaceInfo(),
      /** Open a folder given as a directory handle (tests hand in one of their own). */
      openFolderHandle: async (handle: DirectoryHandle) => this.useWorkspace(await workspaceFromHandle(handle)),
      /** Specimen IDs of the folder's models, by path. */
      specimenIds: () => Object.fromEntries(this.wsIds),
      batch: () => this.batchInfo(),
      exportLandmarksText: (kind: 'tps' | 'fcsv' | 'csv' | 'sliders') => this.landmarkExport(kind, false).text,
      exportSeriesCsvText: () => seriesCsv(this.store.state, { excelBom: false }),
      relationChecks: () => this.relationChecks(),
      harris: () => this.harrisLayoutNow(),
      harrisSvg: () => harrisSvg(this.harrisLayoutNow(), this.harrisStyle(null)),
      /** Scars drawn highlighted (a selected relation's, or those of the opened problems). */
      highlighted: () => [...(this.emphasis()?.ids ?? [])],
      /** Scar clicked first with the relation tool (null when none). */
      relationPending: (): string | null => {
        const tool = this.tools?.activeTool;
        return tool instanceof RelationTool ? tool.pending() : null;
      },
      /** The sequence the sequence tool puts scars into. */
      currentSequence: () => this.currentSequence,
      /** Pairs of scars whose regions border on each other: all of them, and those with no relation yet. */
      borders: () => ({ all: this.borders.map((b) => [b.a, b.b, b.length] as const), unjudged: this.unjudgedBorders().map((b) => [b.a, b.b] as const) }),
      /** Whether the Harris matrix panel is shown. */
      harrisShown: () => !!this.harrisEl && !this.harrisEl.hidden,
      /** Arrows drawn faded (scars in no sequence, while sequencing). */
      fadedArrows: () => [...(this.arrows?.faded ?? [])],
      /** Lines drawn along the borders of scars not judged yet (two per chain: outline and core). */
      borderLines: () => this.borderLayer?.group.children.length ?? 0,
      /** The point the camera turns around. */
      viewTarget: (): Vec3 | null => (this.viewer ? [this.viewer.controls.target.x, this.viewer.controls.target.y, this.viewer.controls.target.z] : null),
      closeModel: () => this.closeModel(),
      module: () => (this.startShown() ? null : this.hasMesh() ? this.store.state.specimen.type : this.newSpecimenType()),
      /** What the specimen has of what it is annotated with. */
      annotationStatus: () => annotationStatus(this.store.state, this.regions?.results ?? []),
      /** A platform end placed by hand at a point, on the outline, as in a file from before they followed the curves. */
      placePlatformEnd: (p: Vec3) => {
        const on = this.onPlatformOutline(p);
        if (on) this.selection.set(placePlatformEnd(this.store, on));
      },
      /** The type asked for the next curve drawn. */
      nextCurveType: () => this.nextCurveType,
      /** A landmark's diameter on the screen as drawn, in CSS pixels. */
      landmarkDiameter: (id: string) => this.landmarkLayer?.screenDiameter(id) ?? null,
      /** Points of the measurement being taken (null when no measuring tool is active). */
      measureDraft: (): Vec3[] | null => {
        const tool = this.tools?.activeTool;
        return tool instanceof MeasureTool ? tool.draftPoints() : null;
      },
      /** Points of the curve being drawn (null when the curve tool is not active). */
      curveDraft: (): Vec3[] | null => {
        const tool = this.tools?.activeTool;
        return tool instanceof DrawCurveTool ? tool.draftPoints() : null;
      },
      projectJson: () => serializeProject(this.store.state, __APP_VERSION__, this.meshResults()),
      /** Snapping on the current mesh: readiness and per-vertex feature strength (for tests). */
      snap: {
        prepare: (mode: SnapMode) => this.surfaceSnap?.prepare(mode) ?? Promise.resolve(false),
        strongest: (mode: SnapMode, count: number) => this.surfaceSnap?.strongest(mode, count) ?? [],
        strengthAt: (mode: SnapMode, p: Vec3) => this.surfaceSnap?.strengthAt(mode, p) ?? null,
      },
    };
    (window as unknown as { lithicanalyst: typeof api }).lithicanalyst = api;
  }
}

/** The file name of a path in a folder. */
const baseName = (path: string): string => path.split('/').pop() ?? path;

/** A semilandmark row key (`<set label>_<number>`) as the landmark layer's point id (`<set id>#<index>`). */
function semilandmarkPoint(st: Readonly<ProjectState>, key: string): string | undefined {
  const m = /^(.*)_(\d+)$/.exec(key);
  const set = m ? st.semilandmarks.find((x) => x.label === m[1]) : undefined;
  return set && m ? `${set.id}#${Number(m[2]) - 1}` : undefined;
}

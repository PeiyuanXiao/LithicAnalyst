import * as THREE from 'three';
import { CurvatureService } from '../compute/curvatureService';
import { autoMeasurements, surfaceMeasuresSteps, type SurfaceMeasures } from '../compute/measure';
import { intersectPlaneSteps, type PrincipalAxes, type Polyline } from '../compute/meshGeometry';
import { computePlane, type PlaneResult } from '../compute/planes';
import { runSliced } from '../compute/steps';
import { SNAP_MODES, type SnapMode } from '../compute/surfacePath';
import { addLandmark, deleteLandmark, deleteSemilandmarkSet, addPlane, addRegion, addSequence, deleteCurve, deleteMeasurement, deletePlane, deleteRegion, deleteRelation, deleteScar, deleteSection, deleteSequence, relationBetween, setCurveAttribute, setRegionType, setRelation, setScarAttribute, setScarSequence, updateSpecimen } from '../core/actions';
import type { AutoMeasurements, MeshResults } from '../core/derived';
import { frameAxes, frameFromView, frameWithVertical, rotateFrame } from '../core/frame';
import { measurementUnit, measurementValue } from '../core/measurements';
import { CURVE_FIELDS, numberKeyField, REGION_FIELDS, SCAR_FIELDS, shiftNumberKeyField } from '../core/fields';
import { parseProjectFile, serializeProject } from '../core/schema';
import { emptyProject, ProjectStore, type Change } from '../core/store';
import { hasVector, type Curve, type Measurement, type ProjectState, type RegionType, type Section, type Vec3 } from '../core/types';
import { autosaveAvailable, readAutosave, readPref, writeAutosave, writePref } from '../io/autosave';
import { curveCsv, manualMeasurementsCsv, measurementsCsv, planesCsv, regionsCsv, relationsCsv, scarVectorCsv, seriesCsv } from '../io/csv';
import { buildLoadedMesh, centredMesh, extensionOf, MeshLoadError, readMeshFile, type LoadedMesh } from '../io/loadMesh';
import { folderPicker, projectNameFor, workspaceFromFiles, workspaceFromHandle, type Workspace } from '../io/workspace';
import { batchOutputs, type BatchSpecimen } from '../io/batch';
import { zipStored } from '../io/zip';
import { fileStem, initHostDownloads, saveFile, saveTextFile } from '../io/saveFile';
import { ArrowLayer, arrowColor, ARROW_COLORS, DEFAULT_ARROW_DISPLAY } from '../render/arrowLayer';
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
import { landmarkTable, type LandmarkTable } from '../compute/landmarks';
import { landmarksCsv, landmarksFcsv, landmarksTps, slidersCsv } from '../io/landmarks';
import { LANDMARK_COLORS, LandmarkLayer } from '../render/landmarkLayer';
import { declutterLabels } from '../render/labelLayout';
import { LandmarkTool } from '../tools/landmarkTool';
import { compareObservers, FACE_TYPES, summarize, type AgreementRow, type FaceLabels, type ObserverData, type SummaryRow } from '../compute/agreement';
import { uuid } from '../core/ids';
import { agreementCsv, agreementSummaryCsv } from '../io/csv';
import type { HitProvider } from '../tools/tool';
import { polylineEdges, regionsSteps, resolveRegions, type Partition, type RegionResult, type RegionTotals } from '../compute/regions';
import { fitSphere, type SphereFit } from '../compute/sphere';
import { splitByLoopSteps, splitByPlaneSteps, type VolumeSplit } from '../compute/split';
import { fitPlane } from '../compute/meshGeometry';
import { DEFAULT_FIGURE, FigureError, figureLayout, FIGURE_VIEWS, renderFigure, type Figure, type FigureContext, type FigureLayout, type FigureSettings, type SectionDrawing } from '../render/figure';
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
import type { ToolContext } from '../tools/tool';
import { ToolController } from '../tools/toolController';
import { APP_MODES, type AppApi, type AppMode, type DisplayAspect, type DisplaySettings } from './appApi';
import { fmtCount, fmtQuantity, quantityUnit } from '../core/format';
import { numRow, segmented, softSet, textRow, textValueRow } from './controls';
import { Popovers, onViewport } from './popover';
import { clear, h, icon, icon20, ICONS, ICONS20 } from './dom';
import { Feedback } from './feedback';
import { getLang, htmlLang, langInfo, LANGS, onLangChange, setLang, t } from './i18n';
import { buildSidebar, type RefreshKind, type Sidebar } from './sidebar';
import { getTheme, onThemeChange, toggleTheme } from './theme';
import { tip, tips } from './tooltip';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

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
  faces: { key: string; labels: FaceLabels | null } | null;
  table: LandmarkTable | null;
}

function loadDisplay(): DisplaySettings {
  // settings of earlier versions that are no longer kept: the view's background (the theme
  // decides it now), gloss and the fill light (fixed)
  const { background: _background, gloss: _gloss, ...saved } = readPref<Partial<DisplaySettings> & { background?: unknown; gloss?: unknown }>('display', {});
  return {
    ...DEFAULT_DISPLAY,
    ...saved,
    shading: saved.shading === 'curvature' ? 'curvature' : 'plain',
    curvScale: Math.max(0, Math.min(100, Math.round(saved.curvScale ?? DEFAULT_DISPLAY.curvScale))),
    light: { ...DEFAULT_LIGHT, ...(saved.light ?? {}), fillIntensity: DEFAULT_LIGHT.fillIntensity },
    arrows: { ...DEFAULT_ARROW_DISPLAY, ...(saved.arrows ?? {}) },
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
  private seedComponent: number[] = [];
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
  private faceAreas: Float32Array | null = null;
  /** Largest distance for matching arrows and curves (null: a tenth of the model's diagonal). */
  private gate: number | null = null;
  /** The agreement row shown in 3D and the item it shows for each observer (by observer id). */
  private agreementFocused: { key: string; items: Map<string, string> } | null = null;
  private workspace: Workspace | null = null;
  /** The workspace model that is open (−1: none, or a model opened from elsewhere). */
  private wsIndex = -1;
  private folderSaveTimer = 0;
  private batch: { kind: 'measure' | 'figures'; done: number; total: number; cancelled: boolean } | null = null;
  batchFormat: 'png' | 'svg' = 'png';
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
  private readonly emptyEl: HTMLElement;
  private readonly coordEl: HTMLElement;
  private readonly dropEl: HTMLElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private saveBtn!: HTMLButtonElement;
  private fileBtn!: HTMLButtonElement;
  private specimenBar!: HTMLElement;
  private specimenRefs: { id: HTMLInputElement; unit: HTMLSelectElement; annotator: HTMLInputElement | HTMLTextAreaElement; notes: HTMLInputElement | HTMLTextAreaElement; meta: HTMLElement; name: HTMLElement; unitText: HTMLElement } | null = null;
  readonly popovers = new Popovers();
  private displayCtl: HTMLElement | null = null;
  private appModeSeg: ToolRow | null = null;
  private modeSeg: ToolRow | null = null;
  private snapSeg: ReturnType<typeof segmented> | null = null;
  private snapEl: HTMLElement | null = null;
  private measureSeg: ToolRow | null = null;
  private presentSeg: ToolRow | null = null;
  private toolSep: HTMLElement | null = null;
  private themeBtn: HTMLButtonElement | null = null;
  private hoverTipTimer = 0;
  private measureBase: SurfaceMeasures | null = null;
  private auto: AutoMeasurements | null = null;
  private autoFrameKey = '';
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
    this.emptyEl = h('div', { class: 'viewport-ui vp-empty' });
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
    this.viewportEl.append(...corners, this.toolbarEl, this.emptyEl, this.coordEl, this.dropEl);
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
    this.regionLayer = new RegionLayer(viewer.scene);
    this.landmarkLayer = new LandmarkLayer(viewer);
    this.landmarkLayer.onLabelClick = (id) => this.selection.set(id);
    this.borderLayer = new BorderLayer(viewer);

    viewer.onFrame(() => {
      this.lights!.update(viewer.camera, viewer.controls.target, viewer.diagonal * 3);
      if (this.occlusionDirty && performance.now() - this.lastOcclusion > 90) {
        this.occlusionDirty = false;
        this.lastOcclusion = performance.now();
        this.arrows?.updateOcclusion();
        this.curves?.updateOcclusion();
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
    };
    this.tools = new ToolController(ctx, this.viewportEl);
    this.tools.register(new SelectTool(ctx));
    this.tools.register(new DrawArrowTool(ctx));
    this.tools.register(new DrawCurveTool(ctx));
    for (const type of ['distance', 'geodesic', 'angle'] as const) this.tools.register(new MeasureTool(ctx, type));
    this.tools.register(new SectionTool(ctx, this.viewportEl, () => this.modelCentre()));
    this.tools.register(new ClickTool('region', (hit) => this.clickRegion(hit.point, hit.faceIndex)));
    this.tools.register(new LandmarkTool(ctx, this.landmarkLayer, (p) => this.placeLandmark(p)));
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
    this.buildEmptyState();
    this.buildHarrisPanel();
    this.buildDisplayControl();
    this.updateSpecimenBar();
    this.setTool('select');

    this.store.subscribe((c) => this.onStoreChange(c));
    this.store.history.onChange(() => this.updateUndoButtons());
    this.selection.onChange((id) => {
      // the relation's bar goes once something else is selected
      if (this.relationChip && id !== this.relationChip.id) this.relationChip.close();
      this.syncAnnotations();
      if (this.store.region(this.selection.id ?? '') || this.regions?.results.length) this.paintRegions();
      this.sidebar.refresh('selection');
      this.updateHarris();
      this.updateCursor();
    });
    onLangChange(() => this.rebuildChrome());
    onThemeChange(() => this.paintThemeButton());

    this.wireFiles();
    this.wireKeyboard();
    window.addEventListener('pagehide', () => this.flushAutosave());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushAutosave();
    });
    this.exposeDebugApi();
    this.updateUndoButtons();
    this.updateMeshDependentUi();
  }

  // ------------------------------------------------------------ chrome

  /**
   * Top bar: name and version, the specimen; the modes in the middle; File, Save, undo
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
        h('div', { class: 'brand' }, h('span', { class: 'brand-name' }, 'LithicAnalyst'), h('span', { class: 'brand-ver mono' }, `v${__APP_VERSION__}`)),
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
    const annotator = textRow('specimen-annotator', t('field.annotator'), '', (v) => {
      updateSpecimen(this.store, { annotator: v });
      writePref('annotator', v);
    });
    const notes = textRow('specimen-notes', t('field.notes'), '', (v) => updateSpecimen(this.store, { notes: v }), { multiline: true });
    const meta = h('dl', { class: 'num-grid', id: 'specimen-meta' });
    const panel = h('div', { class: 'popover spec-panel', id: 'specimen-panel', role: 'dialog', 'aria-label': t('sec.specimen'), hidden: true }, head, annotator.el, notes.el, meta);
    const name = h('span', { class: 'spec-name', id: 'specimen-name' });
    const unitText = h('span', { class: 'spec-unit', id: 'specimen-unit-text' });
    const more = h('button', { type: 'button', class: 'spec-btn', id: 'specimen-more', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => this.popovers.toggle(more, panel) }, name, unitText, icon(ICONS.chevron));
    tip(more, t('sec.specimen'));
    this.specimenRefs = { id, unit, annotator: annotator.input, notes: notes.input, meta, name, unitText };
    return h('div', { class: 'menu-wrap spec-bar', id: 'specimen-bar' }, more, panel);
  }

  private updateSpecimenBar(): void {
    const r = this.specimenRefs;
    if (!r) return;
    const st = this.store.state;
    this.specimenBar.hidden = !st.mesh;
    softSet(r.id, st.specimen.id);
    if (r.unit.value !== st.specimen.unit) r.unit.value = st.specimen.unit;
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
      { value: 'draw', icon: ICONS20.arrow, name: t('mode.draw'), key: 'A' },
      { value: 'curve', icon: ICONS20.curve, name: t('mode.curve'), key: 'P' },
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
    this.toolbarEl.append(this.modeSeg.el, this.measureSeg.el, this.presentSeg.el, this.toolSep, fit, this.snapEl);
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
    if (this.modeSeg) this.modeSeg.el.hidden = !annotate;
    if (this.measureSeg) this.measureSeg.el.hidden = this.mode !== 'measure';
    if (this.presentSeg) this.presentSeg.el.hidden = this.mode !== 'present';
    if (this.toolSep) this.toolSep.hidden = this.mode === 'compare';
    if (this.snapEl) this.snapEl.hidden = !annotate || !['curve', 'landmark'].includes(this.tools?.activeId ?? '');
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

  /** Without a model: open one (or a folder, or a project); dropping a file works too. */
  private buildEmptyState(): void {
    clear(this.emptyEl);
    this.emptyEl.append(
      h('button', { type: 'button', class: 'btn btn-primary btn-lg', id: 'empty-open', onclick: () => this.meshInput.click() }, icon(ICONS.cube), t('header.openMesh')),
      h(
        'div',
        { class: 'vp-empty-row' },
        h('button', { type: 'button', class: 'btn', id: 'empty-open-folder', onclick: () => void this.openFolder() }, icon(ICONS.open), t('header.openFolder')),
        h('button', { type: 'button', class: 'btn', id: 'empty-open-project', onclick: () => this.openProject() }, icon(ICONS.project), t('header.openProject')),
      ),
      h('span', { class: 'vp-empty-formats mono' }, 'PLY · STL · OBJ'),
    );
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
    this.buildEmptyState();
    this.buildHarrisPanel();
    this.buildDisplayControl();
    this.updateSpecimenBar();
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
    this.emptyEl.hidden = has;
    this.toolbarEl.hidden = !has;
    this.saveBtn.disabled = !has;
    if (this.closeItem) this.closeItem.disabled = !has;
    // the main action: opening something until a model is open, then saving
    this.fileBtn.classList.toggle('btn-primary', !has);
    this.fileBtn.classList.toggle('btn-quiet', has);
    this.saveBtn.classList.toggle('btn-primary', has);
    this.saveBtn.classList.toggle('btn-quiet', !has);
    if (this.displayCtl) this.displayCtl.hidden = !has;
    this.updateSpecimenBar();
    this.sidebar.refresh('mesh');
    this.updateHarris();
  }

  private updateCursor(): void {
    const tools = this.tools;
    if (!tools) return;
    const tool = tools.activeTool;
    let cursor = tool ? tool.cursor() : 'default';
    if (tools.navigating) cursor = 'grab';
    if (tools.adjustingLight) cursor = 'crosshair';
    this.viewportEl.style.cursor = cursor;
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
    if (sel && !this.store.scar(sel) && !this.store.curve(sel) && !this.store.measurement(sel) && !this.store.plane(sel) && !this.store.section(sel) && !this.store.region(sel) && !this.store.relation(sel) && !this.store.sequence(sel) && !this.store.landmark(sel) && !this.store.semilandmarkSet(sel))
      this.selection.set(null);
    if (['landmarks', 'curves', 'reset'].includes(c.kind)) this.landmarks = landmarkTable(this.store.state);
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
    else if (c.kind === 'regions' || c.kind === 'scars') this.resolveRegionsNow();
    if (c.kind === 'nodule') this.updateNodule();
    if (['split', 'planes', 'curves', 'scars', 'reset'].includes(c.kind)) this.updateSplit();
    this.syncAnnotations();
    const map: Record<Change['kind'], RefreshKind> = { scars: 'arrows', curves: 'curves', measurements: 'measurements', planes: 'planes', sections: 'sections', regions: 'regions', relations: 'relations', sequences: 'sequences', landmarks: 'landmarks', nodule: 'nodule', split: 'split', specimen: 'specimen', reset: 'all' };
    this.sidebar.refresh(map[c.kind]);
    if (c.kind === 'curves' || c.kind === 'reset') this.sidebar.refresh('landmarks');
    if (c.kind === 'specimen') {
      this.sidebar.refresh('arrows');
      this.sidebar.refresh('curves');
      this.sidebar.refresh('measurements');
    }
    if (c.kind === 'specimen' || c.kind === 'reset') {
      this.updateSpecimenBar();
      this.updateAuto();
      this.sidebar.refresh('figure');
    }
    if (['scars', 'sequences', 'reset'].includes(c.kind)) this.updateSequenceBar();
    this.relationChip?.update();
    this.unsaved = c.kind !== 'reset';
    if (c.kind !== 'reset') {
      this.scheduleAutosave();
      this.scheduleFolderSave();
    }
    this.scheduleAgreement();
    this.queueCoords();
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

  private syncAnnotations(): void {
    const handles = this.tools?.activeId === 'select' && this.mode === 'annotate';
    // the measure mode is about measurements: annotations are drawn faded there
    const dim = this.mode === 'measure';
    if (this.arrows) this.arrows.dimmed = dim;
    if (this.curves) this.curves.dimmed = dim;
    if (this.landmarkLayer) this.landmarkLayer.dimmed = dim;
    this.arrows?.setHighlight(this.emphasis());
    // the user's own colour setting comes back when the sequence tool is left
    const sequencing = this.sequencing();
    if (this.arrows) this.arrows.faded = sequencing ? this.unsequenced() : null;
    this.arrows?.sync(this.store.state, this.selection.id, sequencing ? { ...this.display.arrows, colorMode: 'sequence' } : this.display.arrows, handles);
    this.showBorders();
    this.curves?.sync(this.store.state, this.selection.id, this.display.arrows, handles);
    this.measures?.sync(this.store.state, this.selection.id, this.mode === 'measure', (m) => `${m.label}  ${this.formatMeasurement(m)}`);
    this.landmarkLayer?.sync(this.store.state.landmarks, this.landmarks.sets, this.selection.id, this.display.arrows.labels, this.display.arrows.showHidden);
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
    if (this.landmarkLayer) this.landmarkLayer.group.visible = shown(f.landmarks);
    if (this.regionLayer) this.regionLayer.group.visible = shown(f.regions);
    this.viewer?.requestRender();
  }

  setTool(id: string): void {
    const changed = id !== this.tools?.activeId;
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
  setMode(mode: AppMode): void {
    if (mode === this.mode) return;
    // tools belong to their mode; an unfinished curve is kept (as on Esc)
    this.relationChip?.close();
    this.tools?.activeTool?.clearHover?.();
    this.setTool('select');
    this.mode = mode;
    writePref('mode', mode);
    if (mode === 'present') this.viewFrame(false);
    if (mode === 'compare' && this.agreementStale) this.scheduleAgreement();
    this.viewportEl.dataset.mode = mode;
    this.appModeSeg?.set(mode);
    this.updateToolbar();
    this.syncAnnotations();
    this.paintRegions();
    this.showNodule();
    this.updateHarris();
    this.sidebar.refresh('mode');
  }

  private cycleMode(): void {
    this.setMode(APP_MODES[(APP_MODES.indexOf(this.mode) + 1) % APP_MODES.length]);
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
    const p = addPlane(this.store, 'all_vertices', this.viewer.towardViewer());
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
    updateSpecimen(this.store, { frame: { matrix: matrix.map((x) => Math.round(x * 1e9) / 1e9), source } }, merge);
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
    // fine turning (from a fixed start) is one undo step
    this.setFrame(rotateFrame(base ?? f.matrix, deg), f.source, !!base);
  }

  clearFrame(): void {
    if (this.store.state.specimen.frame) updateSpecimen(this.store, { frame: null }, false);
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
      regions: this.regionLayer?.group,
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
    try {
      return renderFigure(ctx, frame, st.specimen.unit, settings, {
        arrows: (() => {
          const seq = this.display.arrows.colorMode === 'sequence' ? sequenceColors(st.sequences) : null;
          return st.scars.flatMap((s) => (s.vector ? [{ ...s.vector, color: arrowColor(s, this.display.arrows.colorMode, seq) }] : []));
        })(),
        curves: st.curves.map((c) => ({ points: c.points, closed: c.closed, color: curveColor(c) })),
        planes: visiblePlanes.flatMap((p) => {
          const lines = this.cuts.get(p.id)?.lines;
          return lines ? [{ lines, color: planeColor(p.label) }] : [];
        }),
        landmarks: [
          ...st.landmarks.map((l) => ({ point: l.point, color: LANDMARK_COLORS.fixed, fixed: true })),
          ...this.landmarks.sets.flatMap((q) => q.points.map((p) => ({ point: p, color: LANDMARK_COLORS.semi, fixed: false }))),
        ],
        sections: only ? this.sectionDrawings([only]) : this.sectionDrawings(st.sections.filter((x) => x.inFigure)),
      });
    } finally {
      this.regionLayer?.useFigureStyle(false);
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
    return { measurements: this.auto, vertices: this.vertexAxes(), regions: this.regions, nodule: this.nodule, split: this.split };
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
    const r = addRegion(this.store, [point.x, point.y, point.z], 'scar', this.scarStartingIn(c));
    this.selection.set(r.id);
  }

  setRegionType(id: string, type: string): void {
    this.setRegionTypeFor(id, type as RegionType);
  }

  private setRegionTypeFor(id: string, type: RegionType): void {
    const r = this.store.region(id);
    if (!r) return;
    setRegionType(this.store, id, type, type === 'scar' ? this.scarStartingIn(this.componentAt(r.seed)) : null);
  }

  /** Split the surface along the curves (in slices), then find the regions again. */
  private updatePartition(): void {
    const token = ++this.partitionToken;
    void this.partitionFor(this.store.state.curves).then((part) => {
      if (!part || token !== this.partitionToken) return;
      this.partition = part;
      this.resolveRegionsNow();
    });
  }

  /** Pieces of surface between these curves (in slices); null when the mesh is not ready or changed meanwhile. */
  private async partitionFor(curves: readonly Curve[]): Promise<Partition | null> {
    const base = this.measureBase;
    const loaded = this.loaded;
    const snap = this.surfaceSnap;
    if (!base || !loaded || !snap) return null;
    await snap.prepare('off');
    if (this.loaded !== loaded) return null;
    const search = snap.search(3);
    const barrier: number[] = [];
    for (const c of curves)
      barrier.push(
        ...polylineEdges(c.points, c.closed, (p) => snap.nearestVertex(p), base.edges, (a, b) => {
          if (!search) return null;
          search.start(a, null);
          return search.reach(b) ? search.path(b) : null;
        }),
      );
    const g = loaded.geometry;
    const part = await runSliced(regionsSteps(g.getAttribute('position').array as Float32Array, g.index!.array as Uint32Array, base.edges, barrier));
    return this.loaded === loaded ? part : null;
  }

  /** Which piece each region's seed falls in; areas, totals and conflicts; repaint. */
  private resolveRegionsNow(): void {
    const part = this.partition;
    const base = this.measureBase;
    if (!part || !base) return;
    const st = this.store.state;
    this.seedComponent = st.regions.map((r) => this.componentAt(r.seed));
    this.regions = resolveRegions(st.regions, this.seedComponent, part, base.surfaceArea);
    const conflicts = this.regions.results.filter((r) => r.conflict).map((r) => r.id).join(',');
    if (conflicts && conflicts !== this.conflictKey) this.feedback.toast(t('toast.regionConflict'), 'warn', 4000);
    this.conflictKey = conflicts;
    this.paintRegions();
    this.updateNodule();
    this.updateBorders();
    this.sidebar.refresh('regions');
  }

  towardViewer(): Vec3 {
    return this.viewer?.towardViewer() ?? [0, 0, 1];
  }

  // ------------------------------------------------------------ workspace

  workspaceInfo(): { name: string; writable: boolean; meshes: string[]; index: number } | null {
    const ws = this.workspace;
    return ws ? { name: ws.name, writable: ws.writable, meshes: ws.meshes, index: this.wsIndex } : null;
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
    this.workspace = ws;
    this.wsIndex = -1;
    this.sidebar.refresh('workspace');
    await this.openWorkspaceMesh(0);
  }

  /** The project files of the folder written for this model (by its checksum), each read once per call. */
  private async folderProjects(sha: string): Promise<Array<{ name: string; state: ProjectState; derived: Record<string, unknown> }>> {
    const ws = this.workspace;
    if (!ws) return [];
    const out: Array<{ name: string; state: ProjectState; derived: Record<string, unknown> }> = [];
    for (const name of ws.projects) {
      try {
        const raw = JSON.parse(await (await ws.read(name)).text());
        if (raw?.mesh?.sha256 !== sha) continue;
        out.push({ name, state: parseProjectFile(raw), derived: (raw.derived ?? {}) as Record<string, unknown> });
      } catch {
        // not a project file of this app
      }
    }
    return out;
  }

  /** Open model `i` of the workspace with the project kept next to it. */
  async openWorkspaceMesh(i: number, quiet = false): Promise<void> {
    const ws = this.workspace;
    if (!ws || i < 0 || i >= ws.meshes.length) return;
    await this.flushFolderSave();
    const name = ws.meshes[i];
    let project: ProjectState | null = null;
    if (ws.projects.includes(projectNameFor(name))) {
      try {
        project = parseProjectFile(JSON.parse(await (await ws.read(projectNameFor(name))).text()));
      } catch (e) {
        this.feedback.toast(t('error.project', { msg: (e as Error).message }), 'error');
      }
    }
    this.wsIndex = i;
    await this.openMeshFile(await ws.read(name), { project, quiet });
    if (this.store.state.mesh?.fileName !== name) this.wsIndex = -1;
    this.sidebar.refresh('workspace');
  }

  stepWorkspace(step: number): void {
    const ws = this.workspace;
    if (!ws || this.batch) return;
    const i = Math.max(0, Math.min(ws.meshes.length - 1, (this.wsIndex < 0 ? 0 : this.wsIndex) + step));
    if (i !== this.wsIndex) void this.openWorkspaceMesh(i);
  }

  /** Writable workspace: keep the project file next to the open model up to date. */
  private scheduleFolderSave(): void {
    if (!this.workspace?.writable || this.wsIndex < 0) return;
    clearTimeout(this.folderSaveTimer);
    this.folderSaveTimer = window.setTimeout(() => void this.flushFolderSave(), 800);
  }

  private async flushFolderSave(): Promise<void> {
    if (!this.folderSaveTimer) return;
    clearTimeout(this.folderSaveTimer);
    this.folderSaveTimer = 0;
    const ws = this.workspace;
    const st = this.store.state;
    if (!ws?.writable || this.wsIndex < 0 || st.mesh?.fileName !== ws.meshes[this.wsIndex]) return;
    try {
      await ws.write(projectNameFor(ws.meshes[this.wsIndex]), JSON.stringify(serializeProject(st, __APP_VERSION__, this.meshResults()), null, 2));
    } catch (e) {
      this.feedback.toast(t('workspace.saveFailed', { msg: (e as Error).message }), 'error');
    }
  }

  batchInfo(): { kind: 'measure' | 'figures'; done: number; total: number } | null {
    return this.batch;
  }

  cancelBatch(): void {
    if (this.batch) this.batch.cancelled = true;
  }

  /** Write a batch output into the folder, or download it when the folder is read-only. */
  private async putFile(name: string, data: string | Uint8Array, mime: string): Promise<void> {
    const ws = this.workspace;
    if (ws?.writable) await ws.write(name, data);
    else if (typeof data === 'string') await this.save(name, data, mime);
    else await saveFile(name, data, mime);
  }

  runBatch(kind: 'measure' | 'figures'): void {
    if (this.batch || !this.workspace) return;
    void (kind === 'measure' ? this.batchMeasure() : this.batchFigures());
  }

  /** Automatic measurements of every model, with the derived results of its projects, merged by kind. */
  private async batchMeasure(): Promise<void> {
    const ws = this.workspace!;
    await this.flushFolderSave();
    const batch = (this.batch = { kind: 'measure' as const, done: 0, total: ws.meshes.length, cancelled: false });
    this.sidebar.refresh('workspace');
    const specimens: BatchSpecimen[] = [];
    try {
      for (const name of ws.meshes) {
        if (batch.cancelled) break;
        const raw = await readMeshFile(await ws.read(name));
        const mesh = centredMesh(raw);
        const base = await runSliced(surfaceMeasuresSteps(mesh.positions, mesh.index));
        const axes = { ...base.vertices, mean: [base.vertices.mean[0] + mesh.offset[0], base.vertices.mean[1] + mesh.offset[1], base.vertices.mean[2] + mesh.offset[2]] as Vec3 };
        const projects = await this.folderProjects(raw.sha256);
        const open = this.store.state.mesh?.sha256 === raw.sha256;
        const primary = projects.find((p) => p.name === projectNameFor(name)) ?? projects[0] ?? null;
        let state: ProjectState;
        let derived: Record<string, unknown>;
        if (open) {
          // the open model: its current annotations and results
          state = structuredClone(this.store.state) as ProjectState;
          derived = { regions: this.regions?.results ?? [], regionTotals: this.regions?.totals ?? null, nodule: this.nodule, split: this.split };
        } else if (primary) {
          state = primary.state;
          derived = primary.derived;
        } else {
          state = emptyProject();
          state.specimen.id = name.replace(/\.[^.]+$/, '');
          derived = {};
        }
        const observers = new Map<string, Record<string, number>>();
        for (const p of projects) {
          const st = open && p === primary ? state : p.state;
          const who = st.specimen.annotator || p.name;
          if (observers.has(who)) continue;
          const a = autoMeasurements(mesh.positions, base, st.specimen.frame);
          const d = open && p === primary ? derived : p.derived;
          const values: Record<string, number> = { length: a.length, width: a.width, thickness: a.thickness };
          const totals = d.regionTotals as { cortexRatio?: number } | null | undefined;
          if (typeof totals?.cortexRatio === 'number') values.cortex_ratio = totals.cortexRatio;
          const nod = d.nodule as { radius?: number } | null | undefined;
          if (typeof nod?.radius === 'number') values.nodule_radius = nod.radius;
          const sp = d.split as { ratio?: number | null } | null | undefined;
          if (typeof sp?.ratio === 'number') values.volume_ratio = sp.ratio;
          for (const m of st.measurements) values[m.label] = measurementValue(m);
          observers.set(who, values);
        }
        specimens.push({
          state,
          auto: autoMeasurements(mesh.positions, base, state.specimen.frame),
          planes: state.planes.map((p) => computePlane(p, state, axes)),
          regions: (derived.regions as BatchSpecimen['regions']) ?? [],
          regionTotals: (derived.regionTotals as BatchSpecimen['regionTotals']) ?? null,
          nodule: (derived.nodule as BatchSpecimen['nodule']) ?? null,
          split: (derived.split as BatchSpecimen['split']) ?? null,
          observers,
        });
        batch.done++;
        this.sidebar.refresh('workspace');
        await nextFrame();
      }
      if (!batch.cancelled) {
        const stem = fileStem(ws.name, 'batch');
        for (const f of batchOutputs(specimens, { excelBom: this.display.excelBom })) await this.putFile(`${stem}_${f.suffix}`, f.text, f.suffix.endsWith('.csv') ? 'text/csv' : 'text/plain');
        this.feedback.toast(t('workspace.batchDone', { n: specimens.length }));
      }
    } catch (e) {
      this.feedback.toast((e as Error).message, 'error');
    } finally {
      this.batch = null;
      this.sidebar.refresh('workspace');
    }
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

  /** The figure of every model, with the same presentation settings. */
  private async batchFigures(): Promise<void> {
    const ws = this.workspace!;
    const start = this.wsIndex;
    const format = this.batchFormat;
    const batch = (this.batch = { kind: 'figures' as const, done: 0, total: ws.meshes.length, cancelled: false });
    this.sidebar.refresh('workspace');
    try {
      for (let i = 0; i < ws.meshes.length; i++) {
        if (batch.cancelled) break;
        await this.openWorkspaceMesh(i, true);
        await this.settled();
        await nextFrame();
        const fig = this.makeFigure();
        if (fig) await this.putFile(`${this.stem()}_figure.${format}`, format === 'png' ? await fig.png() : await fig.svg(), format === 'png' ? 'image/png' : 'image/svg+xml');
        batch.done++;
        this.sidebar.refresh('workspace');
      }
      if (!batch.cancelled) this.feedback.toast(t('workspace.batchDone', { n: batch.done }));
    } catch (e) {
      const msg = e instanceof FigureError && e.code === 'tooLarge' ? t('figure.tooLarge', { msg: e.message }) : (e as Error).message;
      this.feedback.toast(msg, 'error');
    } finally {
      this.batch = null;
      if (start >= 0) await this.openWorkspaceMesh(start, true);
      this.sidebar.refresh('workspace');
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
        csv('scar-vectors', t('export.csv'), 'scar_vectors.csv', st.scars.some(hasVector), () => scarVectorCsv(st, opts)),
        csv('curves', t('export.curvesCsv'), 'curves.csv', st.curves.length > 0, () => curveCsv(st, opts)),
        csv('regions', t('export.regions'), 'regions.csv', !!this.regions?.results.length, () => regionsCsv(st, this.regions?.results ?? [], opts)),
        csv('relations', t('export.relations'), 'relations.csv', st.relations.length > 0, () => relationsCsv(st, opts)),
        csv('series', t('export.series'), 'series.csv', st.sequences.some((q) => q.scarIds.length), () => seriesCsv(st, opts)),
        csv('landmarks-tps', t('export.landmarksTps'), 'landmarks.tps', lm.rows.length > 0, () => landmarksTps(st, lm)),
        csv('landmarks-fcsv', t('export.landmarksFcsv'), 'landmarks.fcsv', lm.rows.length > 0, () => landmarksFcsv(lm)),
        csv('landmarks-csv', t('export.landmarksCsv'), 'landmarks.csv', lm.rows.length > 0, () => landmarksCsv(st, lm, opts)),
        csv('sliders', t('export.sliders'), 'sliders.csv', lm.sliders.length > 0, () => slidersCsv(lm)),
      ];
    }
    if (this.mode === 'measure')
      return [
        csv('measurements', t('export.measurements'), 'measurements.csv', !!this.auto, () => measurementsCsv(st, this.auto, opts, this.regions?.totals ?? null, this.nodule, this.split)),
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

  /** Pick the files to export; several go into one ZIP archive. */
  openExport(): void {
    if (!this.hasMesh()) return;
    const files = this.exportables(false);
    if (!files.length) return;
    const boxes = files.map((f) =>
      h('input', { type: 'checkbox', id: `export-file-${f.key}`, 'data-key': f.key, checked: f.available, disabled: !f.available }) as HTMLInputElement,
    );
    const bom = h('input', { type: 'checkbox', id: 'export-bom', checked: this.display.excelBom }) as HTMLInputElement;
    const body = h(
      'div',
      { class: 'export-list' },
      ...files.map((f, i) => h('label', { class: `ctl-check export-item${f.available ? '' : ' is-empty'}`, for: boxes[i].id }, boxes[i], h('span', {}, f.label), h('span', { class: 'mono export-name' }, f.name))),
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
        const chosen = this.exportables(bom.checked).filter((f, i) => f.available && boxes[i].checked);
        if (!chosen.length) return;
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

  /** Region of each triangle by an observer's curves and region seeds (cached until they change). */
  private async observerFaces(o: Observer, st: Readonly<ProjectState>): Promise<FaceLabels | null> {
    if (!st.regions.length) return null;
    const key = JSON.stringify([st.curves.map((c) => [c.points, c.closed]), st.regions.map((r) => [r.seed, r.type])]);
    if (o.faces?.key === key) return o.faces.labels;
    const part = await this.partitionFor(st.curves);
    if (!part) return null;
    const owner = new Int32Array(part.count).fill(-1);
    st.regions.forEach((r, i) => {
      const f = this.faceAt(r.seed);
      const c = f >= 0 ? part.region[f] : -1;
      if (c >= 0 && owner[c] < 0) owner[c] = i;
    });
    const n = part.region.length;
    const labels: FaceLabels = { type: new Uint8Array(n), region: new Int32Array(n).fill(-1) };
    for (let f = 0; f < n; f++) {
      const i = owner[part.region[f]];
      if (i < 0) continue;
      labels.type[f] = FACE_TYPES.indexOf(st.regions[i].type);
      labels.region[f] = i;
    }
    o.faces = { key, labels };
    return labels;
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
      const faces = await this.observerFaces(o, st);
      if (token !== this.agreementToken) return;
      const auto = autoMeasurements(positions, base, st.specimen.frame);
      const measures: Record<string, number | null> = { length: auto.length, width: auto.width, thickness: auto.thickness };
      if (faces && areas) {
        const sums = new Float64Array(FACE_TYPES.length);
        for (let f = 0; f < areas.length; f++) sums[faces.type[f]] += areas[f];
        FACE_TYPES.forEach((type, i) => i > 0 && (measures[`area_${type}`] = sums[i]));
        measures.cortex_ratio = base.surfaceArea > 0 ? sums[2] / base.surfaceArea : null;
      }
      data.push({ label: labels.get(o.id)!, state: st, planes: st.planes.map((p) => computePlane(p, st, axes)), faces, measures });
      await nextFrame();
      if (token !== this.agreementToken) return;
    }
    const rows = compareObservers(data, { gate: this.compareGate(), faceArea: areas });
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
    const names = this.store.state.landmarks.map((l) => l.name);
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
    const body = h('div', { class: 'harris-body', id: 'harris-body' });
    body.addEventListener('click', (e) => {
      const id = (e.target as Element).closest?.('[data-id]')?.getAttribute('data-id');
      if (id) this.selectScar(id);
    });
    type Geometry = { x?: number; y?: number; w?: number; h?: number; collapsed?: boolean };
    const geo: Geometry = { ...readPref<Geometry>('harrisPanel', {}) };
    const fold = h('button', { type: 'button', class: 'icon-btn harris-fold', id: 'harris-fold', 'aria-label': t('harris.fold'), title: t('harris.fold') }, icon(ICONS.chevron)) as HTMLButtonElement;
    const head = h(
      'div',
      { class: 'harris-head' },
      h('span', { class: 'harris-title' }, t('harris.title')),
      h('button', { type: 'button', class: 'btn btn-quiet btn-sm', id: 'harris-svg', onclick: () => this.exportHarrisSvg() }, 'SVG'),
      fold,
      h('button', { type: 'button', class: 'icon-btn', id: 'harris-close', 'aria-label': t('dlg.close'), onclick: () => {
        // shown by the relation or sequence tool: away until the tool changes
        if (this.harrisAuto()) this.harrisAutoOff = true;
        this.setDisplay((d) => (d.harris = false), 'harris');
      } }, icon(ICONS.close)),
    );
    const grip = h('div', { class: 'harris-grip', 'aria-hidden': 'true' });
    const el = h('div', { class: 'viewport-ui harris-panel', id: 'harris-panel', hidden: true }, head, body, grip);
    // the remembered place and size, fitted into the view as it is now (the pref keeps what was chosen)
    const apply = () => {
      const W = this.viewportEl.clientWidth, H = this.viewportEl.clientHeight;
      const fits = W > 0 && H > 0;
      const w = geo.w && fits ? Math.min(geo.w, W) : geo.w;
      const hgt = geo.h && fits ? Math.min(geo.h, H) : geo.h;
      if (geo.x !== undefined && geo.y !== undefined) {
        const x = fits ? Math.max(0, Math.min(geo.x, W - (w || el.offsetWidth || 200))) : geo.x;
        const y = fits ? Math.max(0, Math.min(geo.y, H - (hgt && !geo.collapsed ? hgt : 36))) : geo.y;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.bottom = 'auto';
      }
      if (w && hgt) {
        el.style.width = `${w}px`;
        el.style.height = geo.collapsed ? '' : `${hgt}px`;
        el.style.maxWidth = el.style.maxHeight = 'none';
      }
      el.classList.toggle('is-collapsed', !!geo.collapsed);
      fold.setAttribute('aria-expanded', String(!geo.collapsed));
    };
    const save = () => writePref('harrisPanel', geo);
    fold.addEventListener('click', () => {
      geo.collapsed = !geo.collapsed;
      apply();
      save();
    });
    // drag with the title bar, size with the corner; kept inside the view
    const drag = (handle: HTMLElement, move: (dx: number, dy: number, start: DOMRect, area: DOMRect) => void) => {
      let from: { x: number; y: number; rect: DOMRect; area: DOMRect } | null = null;
      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || (e.target as Element).closest('button')) return;
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        from = { x: e.clientX, y: e.clientY, rect: el.getBoundingClientRect(), area: this.viewportEl.getBoundingClientRect() };
      });
      handle.addEventListener('pointermove', (e) => {
        if (from) move(e.clientX - from.x, e.clientY - from.y, from.rect, from.area);
      });
      const end = () => {
        if (!from) return;
        from = null;
        save();
      };
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    };
    drag(head, (dx, dy, r, area) => {
      geo.x = Math.round(Math.max(0, Math.min(area.width - r.width, r.left - area.left + dx)));
      geo.y = Math.round(Math.max(0, Math.min(area.height - r.height, r.top - area.top + dy)));
      apply();
    });
    drag(grip, (dx, dy, r, area) => {
      geo.x ??= Math.round(r.left - area.left);
      geo.y ??= Math.round(r.top - area.top);
      geo.w = Math.round(Math.max(200, Math.min(area.width - geo.x, r.width + dx)));
      geo.h = Math.round(Math.max(120, Math.min(area.height - geo.y, r.height + dy)));
      geo.collapsed = false;
      apply();
    });
    if (this.harrisEl) this.harrisEl.replaceWith(el);
    else {
      this.viewportEl.append(el);
      new ResizeObserver(() => this.harrisFit?.()).observe(this.viewportEl);
    }
    apply();
    this.harrisEl = el;
    this.harrisBody = body;
    this.harrisFit = apply;
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
    const shown = (this.display.harris || (this.harrisAuto() && !this.harrisAutoOff)) && this.mode === 'annotate' && this.hasMesh();
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

  /** Upper / lower volumes by the chosen plane or closed curve (closed meshes only; in slices). */
  private updateSplit(): void {
    const token = ++this.splitToken;
    const sp = this.store.state.split;
    const base = this.measureBase;
    const loaded = this.loaded;
    const snap = this.surfaceSnap;
    const done = (v: VolumeSplit | null) => {
      if (token !== this.splitToken) return;
      this.split = v;
      this.sidebar.refresh('split');
    };
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
    void snap.prepare('off').then(() => {
      if (token !== this.splitToken) return;
      const search = snap.search(3);
      const chain = polylineEdges(c.points, true, (p) => snap.nearestVertex(p), base.edges, (a, b) => {
        if (!search) return null;
        search.start(a, null);
        return search.reach(b) ? search.path(b) : null;
      });
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
    this.split = null;
    this.splitToken++;
    if (part && loaded && this.regions) {
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
    const seq = this.display.arrows.colorMode === 'sequence' || sequencing ? sequenceColors(st.sequences) : null;
    const loose = sequencing ? this.unsequenced() : null;
    const em = this.emphasis();
    const paints = this.display.regions
      ? results.flatMap((r, i) => {
          const c = this.seedComponent[i];
          if (c < 0 || this.seedComponent.indexOf(c) !== i) return [];
          const hl = !!em && !!r.scarId && em.ids.has(r.scarId);
          return [{ component: c, color: hl ? em!.color : regionColorOf(r, st.scars, seq), selected: hl || r.id === this.selection.id, faded: !!loose && r.type === 'scar' && !!r.scarId && loose.has(r.scarId) }];
        })
      : [];
    const g = loaded?.geometry;
    layer.sync((g?.getAttribute('position') as THREE.BufferAttribute) ?? null, g?.index?.array ?? null, this.partition?.region ?? null, paints, loaded?.offset ?? [0, 0, 0]);
    this.viewer?.requestRender();
  }

  /** Recompute the planes from their inputs, then their sections of the model (in slices). */
  private updatePlanes(): void {
    const st = this.store.state;
    const axes = this.vertexAxes();
    this.planes = st.planes.map((p) => computePlane(p, st, axes));
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
    this.auto = autoMeasurements(loaded.geometry.getAttribute('position').array as Float32Array, base, frame);
    this.sidebar.refresh('measure');
  }

  saveProject(): void {
    if (!this.hasMesh()) return;
    // agreement analysis tells observers apart by their name
    if (!this.store.state.specimen.annotator.trim()) this.feedback.toast(t('toast.noAnnotator'), 'info', 5000);
    const file = serializeProject(this.store.state, __APP_VERSION__, this.meshResults());
    void this.save(`${this.stem()}.lithicanalyst.json`, JSON.stringify(file, null, 2), 'application/json').then((outcome) => {
      if (outcome === 'saved') this.unsaved = false;
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
    if (this.store.region(sel)) deleteRegion(this.store, sel);
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
    this.borderLayer?.clear();
    this.partition = null;
    this.regions = null;
    this.seedComponent = [];
    this.partitionToken++;
    this.nodule = null;
    this.cuts.clear();
    this.planes = [];
    this.borders = [];
    this.bordersToken++;
    this.loaded = null;
  }

  private installMesh(loaded: LoadedMesh): void {
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
      id: loaded.info.fileName.replace(/\.[^.]+$/, ''),
      annotator: readPref('annotator', prev.specimen.annotator),
      unit: readPref('unit', prev.specimen.unit || 'mm'),
      notes: '',
      frame: null,
    };
    this.selection.set(null);
    this.store.reset(fresh);
    this.startMeasuring(loaded);
    this.applyShading();
    this.updateMeshDependentUi();
    this.sidebar.refresh('all');
  }

  /**
   * Close the model: finish the tool's work and the pending saves, let go of the
   * model and its layers, the undo history, the selection and the observers
   * compared with it, leave the folder, and show the empty view. Asks first only
   * when edits would be lost: a read-only folder with edits not downloaded, or
   * an autosave that failed.
   */
  async closeModel(): Promise<void> {
    if (!this.hasMesh() || this.batch) return;
    this.popovers.close();
    this.relationChip?.close();
    this.tools?.cancel();
    await this.flushFolderSave();
    this.flushAutosave();
    const readOnly = !!this.workspace && !this.workspace.writable;
    const reason = this.autosaveFailed ? 'dlg.closeModel.autosaveFailed' : readOnly && this.unsaved ? 'dlg.closeModel.notDownloaded' : null;
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
    this.autosaveFailed = false;
    this.selection.set(null);
    this.store.reset(emptyProject());
    this.showNodule();
    this.updateMeshDependentUi();
    this.sidebar.refresh('all');
    this.queueCoords();
  }

  private applyProject(state: ProjectState, toastKey: string | null = 'toast.projectLoaded'): void {
    state.mesh = this.store.state.mesh;
    this.tools?.cancel();
    this.selection.set(null);
    this.store.reset(state);
    if (toastKey) this.feedback.toast(t(toastKey, { what: countsText(state) }));
  }

  /** `project`: the project file kept next to the model in a workspace; `quiet`: no questions (batch runs). */
  private async openMeshFile(file: File, opts: { project?: ProjectState | null; quiet?: boolean } = {}): Promise<void> {
    if (!this.viewer) return;
    const host = this.viewportEl;
    try {
      const raw = await readMeshFile(file, async (stage) => {
        this.feedback.busy(t(`load.${stage}`), host);
        await nextFrame();
      });
      this.feedback.busy(t('load.indexing'), host);
      await nextFrame();
      const loaded = buildLoadedMesh(raw);
      this.installMesh(loaded);
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

  private async afterMeshLoaded(loaded: LoadedMesh, opts: { project?: ProjectState | null; quiet?: boolean } = {}): Promise<void> {
    const pending = this.pendingProject;
    this.pendingProject = null;
    if (pending && pending.mesh?.sha256 === loaded.info.sha256) {
      this.applyProject(pending);
      return;
    }
    const kept = opts.project && opts.project.mesh?.sha256 === loaded.info.sha256 ? opts.project : null;
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
    if (!saved.scars.length && !saved.curves.length && !saved.measurements.length) return;
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
      if (e.repeat && !['BracketLeft', 'BracketRight', 'Backspace'].includes(e.code)) return;
      switch (e.code) {
        case 'KeyM':
          this.cycleMode();
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
        case 'KeyB':
          if (this.hasMesh() && this.mode === 'annotate') this.setTool('relation');
          return;
        case 'KeyQ':
          if (this.hasMesh() && this.mode === 'annotate') this.setTool('sequence');
          return;
        case 'KeyK':
          if (this.hasMesh() && this.mode === 'annotate') this.setTool('landmark');
          return;
        case 'KeyX':
          if (this.hasMesh() && this.mode === 'present') this.setTool('section');
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
          if (this.tools?.activeId === 'curve' || this.tools?.activeId === 'landmark') this.cycleSnap();
          return;
        case 'Enter':
        case 'NumpadEnter':
          if (tool?.commit?.()) e.preventDefault();
          return;
        case 'Escape':
          if (!this.tools?.cancel()) this.selection.set(null);
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
            this.stepWorkspace(e.code === 'PageDown' ? 1 : -1);
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
        // Shift + 1–5: the selected arrow's termination
        if (e.shiftKey) {
          const f = shiftNumberKeyField(SCAR_FIELDS);
          const opt = f?.options?.[Number(digit[1]) - 1];
          if (f && opt && this.store.scar(sel)) setScarAttribute(this.store, sel, f.key, opt.value);
          return;
        }
        if (this.store.region(sel)) {
          const opt = numberKeyField(REGION_FIELDS)?.options?.[Number(digit[1]) - 1];
          if (opt) this.setRegionTypeFor(sel, opt.value as RegionType);
          return;
        }
        const isCurve = !!this.store.curve(sel);
        const f = numberKeyField(isCurve ? CURVE_FIELDS : SCAR_FIELDS);
        const opt = f?.options?.[Number(digit[1]) - 1];
        if (!f || !opt) return;
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
      const label = scar
        ? `${scar.label} · ${t('hover.arrow')}`
        : curve
          ? `${curve.label} · ${t('hover.curve')}`
          : landmark
            ? `${landmark.name} · ${t('hover.landmark')}`
            : m
              ? `${m.label} · ${t(`measure.type.${m.type}`)}`
              : null;
      if (label) tips.showAt(item.x, item.y, { label });
    }, 300);
  }

  /** The shortcuts: two columns (general and mouse; the modes), keys as key caps, no explanations. */
  private showHelp(): void {
    const count = Math.max(numberKeyField(SCAR_FIELDS)?.options?.length ?? 0, numberKeyField(CURVE_FIELDS)?.options?.length ?? 0) || 5;
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
        ['A', 'help.k.draw'],
        ['P', 'help.k.curve'],
        ['R', 'help.k.region'],
        ['B', 'help.k.relation'],
        ['Q', 'help.k.sequence'],
        ['K', 'help.k.landmark'],
        ['1 / 2 / 3 · Delete', 'help.k.relationPick'],
        ['1 – 9 / N', 'help.k.sequencePick'],
        [`1 – ${count}`, 'help.k.complete'],
        [`Shift+1 – ${shiftNumberKeyField(SCAR_FIELDS)?.options?.length ?? 5}`, 'help.k.termination'],
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
      exportCsvText: () => scarVectorCsv(this.store.state, { excelBom: false }),
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
      exportMeasurementsCsvText: () => measurementsCsv(this.store.state, this.auto, { excelBom: false }, this.regions?.totals ?? null, this.nodule, this.split),
      volumeSplit: () => this.split,
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

/** A semilandmark row key (`<set label>_<number>`) as the landmark layer's point id (`<set id>#<index>`). */
function semilandmarkPoint(st: Readonly<ProjectState>, key: string): string | undefined {
  const m = /^(.*)_(\d+)$/.exec(key);
  const set = m ? st.semilandmarks.find((x) => x.label === m[1]) : undefined;
  return set && m ? `${set.id}#${Number(m[2]) - 1}` : undefined;
}

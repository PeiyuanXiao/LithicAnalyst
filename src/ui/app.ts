import * as THREE from 'three';
import { CurvatureService } from '../compute/curvatureService';
import { autoMeasurements, surfaceMeasuresSteps, type SurfaceMeasures } from '../compute/measure';
import { runSliced } from '../compute/steps';
import { SNAP_MODES, type SnapMode } from '../compute/surfacePath';
import { deleteCurve, deleteMeasurement, deleteScar, setCurveAttribute, setScarAttribute } from '../core/actions';
import type { AutoMeasurements } from '../core/derived';
import { measurementUnit, measurementValue } from '../core/measurements';
import { CURVE_FIELDS, numberKeyField, SCAR_FIELDS } from '../core/fields';
import { parseProjectFile, serializeProject } from '../core/schema';
import { emptyProject, ProjectStore, type Change } from '../core/store';
import type { Measurement, ProjectState, Vec3 } from '../core/types';
import { autosaveAvailable, readAutosave, readPref, writeAutosave, writePref } from '../io/autosave';
import { curveCsv, manualMeasurementsCsv, measurementsCsv, scarVectorCsv } from '../io/csv';
import { buildLoadedMesh, extensionOf, MeshLoadError, readMeshFile, type LoadedMesh } from '../io/loadMesh';
import { fileStem, initHostDownloads, saveTextFile } from '../io/saveFile';
import { ArrowLayer, DEFAULT_ARROW_DISPLAY } from '../render/arrowLayer';
import { CurveLayer } from '../render/curveLayer';
import { MeasureLayer } from '../render/measureLayer';
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
import { segmented } from './controls';
import { clear, h, icon, ICONS } from './dom';
import { Feedback } from './feedback';
import { getLang, onLangChange, setLang, t } from './i18n';
import { buildSidebar, fmtNum, type RefreshKind, type Sidebar } from './sidebar';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const DEFAULT_DISPLAY: DisplaySettings = {
  shading: 'plain',
  light: { ...DEFAULT_LIGHT },
  gloss: 0.45,
  curvScale: 2,
  curvContrast: 1,
  background: 'light',
  arrows: { ...DEFAULT_ARROW_DISPLAY },
  curveSnap: 'ridge',
  excelBom: false,
};

function loadDisplay(): DisplaySettings {
  const saved = readPref<Partial<DisplaySettings>>('display', {});
  return {
    ...DEFAULT_DISPLAY,
    ...saved,
    shading: saved.shading === 'curvature' ? 'curvature' : 'plain',
    background: saved.background === 'dark' ? 'dark' : 'light',
    curvScale: Math.max(0, Math.min(100, Math.round(saved.curvScale ?? DEFAULT_DISPLAY.curvScale))),
    light: { ...DEFAULT_LIGHT, ...(saved.light ?? {}) },
    arrows: { ...DEFAULT_ARROW_DISPLAY, ...(saved.arrows ?? {}) },
    curveSnap: SNAP_MODES.includes(saved.curveSnap as SnapMode) ? (saved.curveSnap as SnapMode) : DEFAULT_DISPLAY.curveSnap,
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

const MEASURE_TOOLS: Array<[string, string, string]> = [
  ['measure-distance', 'tool.distance', 'D'],
  ['measure-geodesic', 'tool.geodesic', 'G'],
  ['measure-angle', 'tool.angle', 'N'],
];

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

  private viewer: Viewer | null = null;
  private lights: LightRig | null = null;
  private arrows: ArrowLayer | null = null;
  private curves: CurveLayer | null = null;
  private measures: MeasureLayer | null = null;
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
  private appModeSeg: ReturnType<typeof segmented> | null = null;
  private modeSeg: ReturnType<typeof segmented> | null = null;
  private snapSeg: ReturnType<typeof segmented> | null = null;
  private snapEl: HTMLElement | null = null;
  private measureSeg: ReturnType<typeof segmented> | null = null;
  private measureBase: SurfaceMeasures | null = null;
  private auto: AutoMeasurements | null = null;
  private autoFrameKey = '';
  private measureToken = 0;
  private readonly meshInput: HTMLInputElement;
  private readonly projectInput: HTMLInputElement;

  constructor(private readonly root: HTMLElement) {
    document.documentElement.lang = getLang() === 'zh' ? 'zh-CN' : 'en';
    this.appEl = h('div', { class: 'app' });
    this.viewportEl = h('section', { class: 'viewport', id: 'viewport', 'data-bg': this.display.background, 'data-mode': this.mode });
    this.toolbarEl = h('div', { class: 'viewport-ui vp-toolbar' });
    this.emptyEl = h('div', { class: 'viewport-ui vp-empty' });
    this.coordEl = h('span', { class: 'viewport-ui status-coords mono', id: 'status-coords' });
    this.dropEl = h('div', { class: 'drop-overlay', hidden: true }, icon(ICONS.open));
    this.meshInput = h('input', { type: 'file', accept: '.ply,.stl,.obj', hidden: true, id: 'file-mesh' }) as HTMLInputElement;
    this.projectInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, id: 'file-project' }) as HTMLInputElement;
    this.feedback = new Feedback(this.appEl);
    this.sidebar = buildSidebar(this);
  }

  // ------------------------------------------------------------ startup

  async start(): Promise<void> {
    initHostDownloads();
    this.header = this.buildHeader();
    const main = h('main', { class: 'workspace' }, this.viewportEl, this.sidebar.el);
    this.appEl.prepend(this.header, main);
    this.appEl.append(this.meshInput, this.projectInput);
    this.root.append(this.appEl);

    try {
      this.viewer = new Viewer(this.viewportEl);
    } catch {
      this.viewportEl.append(h('div', { class: 'vp-error' }, h('p', {}, t('error.webgl'))));
      return;
    }
    const viewer = this.viewer;
    this.viewportEl.append(this.toolbarEl, this.emptyEl, this.coordEl, this.dropEl);
    this.lights = new LightRig(viewer.scene);
    this.lights.set(this.display.light);
    this.arrows = new ArrowLayer(viewer);
    this.arrows.onLabelClick = (id) => this.selection.set(id);
    this.curves = new CurveLayer(viewer);
    this.curves.onLabelClick = (id) => this.selection.set(id);
    this.measures = new MeasureLayer(viewer);
    this.measures.onLabelClick = (id) => this.selection.set(id);

    viewer.onFrame(() => {
      this.lights!.update(viewer.camera, viewer.controls.target, viewer.diagonal * 3);
      if (this.occlusionDirty && performance.now() - this.lastOcclusion > 90) {
        this.occlusionDirty = false;
        this.lastOcclusion = performance.now();
        this.arrows?.updateOcclusion();
        this.curves?.updateOcclusion();
        this.measures?.updateOcclusion();
      }
    });
    viewer.onCameraChange(() => {
      this.occlusionDirty = true;
    });

    const ctx: ToolContext = {
      viewer,
      store: this.store,
      arrows: this.arrows,
      curves: this.curves,
      measures: this.measures,
      selection: this.selection,
      snap: () => this.surfaceSnap,
      snapMode: () => this.display.curveSnap,
      notify: (key, tone) => this.feedback.toast(t(key), tone === 'warn' ? 'warn' : 'info'),
      changed: () => this.updateCursor(),
      editable: () => this.mode === 'annotate',
    };
    this.tools = new ToolController(ctx, this.viewportEl);
    this.tools.register(new SelectTool(ctx));
    this.tools.register(new DrawArrowTool(ctx));
    this.tools.register(new DrawCurveTool(ctx));
    for (const type of ['distance', 'geodesic', 'angle'] as const) this.tools.register(new MeasureTool(ctx, type));
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
    this.setTool('select');

    this.store.subscribe((c) => this.onStoreChange(c));
    this.store.history.onChange(() => this.updateUndoButtons());
    this.selection.onChange(() => {
      this.syncAnnotations();
      this.sidebar.refresh('selection');
      this.updateCursor();
    });
    onLangChange(() => this.rebuildChrome());

    this.wireFiles();
    this.wireKeyboard();
    this.applyBackground();
    window.addEventListener('pagehide', () => this.flushAutosave());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushAutosave();
    });
    this.exposeDebugApi();
    this.updateUndoButtons();
    this.updateMeshDependentUi();
  }

  // ------------------------------------------------------------ chrome

  private buildHeader(): HTMLElement {
    const btn = (id: string, iconPath: string, label: string, onclick: () => void, kind = 'btn-quiet', title?: string) =>
      h('button', { type: 'button', id, class: `btn ${kind} hdr-btn`, onclick, title: title ?? label }, icon(iconPath), h('span', { class: 'btn-text' }, label)) as HTMLButtonElement;
    this.undoBtn = h('button', { type: 'button', class: 'icon-btn', id: 'btn-undo', 'aria-label': t('header.undo'), onclick: () => this.undo() }, icon(ICONS.undo)) as HTMLButtonElement;
    this.redoBtn = h('button', { type: 'button', class: 'icon-btn', id: 'btn-redo', 'aria-label': t('header.redo'), onclick: () => this.redo() }, icon(ICONS.redo)) as HTMLButtonElement;
    this.saveBtn = btn('btn-save-project', ICONS.save, t('header.saveProject'), () => this.saveProject(), 'btn-quiet', `${t('header.saveProject')} (Ctrl+S)`);
    this.appModeSeg = segmented('app-mode', null, APP_MODES.map((m) => ({ value: m, label: t(`appMode.${m}`), title: `${t(`appMode.${m}`)} (M)` })), this.mode, (v) =>
      this.setMode(v as AppMode),
    );
    this.appModeSeg.el.classList.add('seg-app-mode');
    this.appModeSeg.el.setAttribute('aria-label', t('appMode.label'));
    return h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-name' }, 'LithicAnalyst'), h('span', { class: 'brand-ver mono' }, `v${__APP_VERSION__}`)),
      this.appModeSeg.el,
      h(
        'nav',
        { class: 'top-actions', 'aria-label': 'File' },
        btn('btn-open', ICONS.open, t('header.openMesh'), () => this.meshInput.click(), 'btn-primary', 'PLY · STL · OBJ'),
        btn('btn-open-project', ICONS.open, t('header.openProject'), () => this.openProject()),
        this.saveBtn,
        h('span', { class: 'hdr-sep', 'aria-hidden': 'true' }),
        this.undoBtn,
        this.redoBtn,
        h('button', { type: 'button', class: 'btn btn-quiet hdr-btn', id: 'btn-lang', onclick: () => setLang(getLang() === 'zh' ? 'en' : 'zh') }, icon(ICONS.lang), h('span', { class: 'btn-text' }, t('header.otherLang'))),
        h('button', { type: 'button', class: 'icon-btn', id: 'btn-help', title: `${t('header.help')} (?)`, 'aria-label': t('header.help'), onclick: () => this.showHelp() }, icon(ICONS.help)),
      ),
    );
  }

  private buildToolbar(): void {
    clear(this.toolbarEl);
    this.modeSeg = segmented('mode', null, [
      { value: 'select', label: `${t('mode.select')}  V` },
      { value: 'draw', label: `${t('mode.draw')}  A` },
      { value: 'curve', label: `${t('mode.curve')}  P` },
    ], this.tools?.activeId ?? 'select', (v) => this.setTool(v));
    this.modeSeg.el.classList.add('seg-mode');
    this.snapSeg = segmented('snap', null, SNAP_MODES.map((m) => ({ value: m, label: t(`snap.${m}`) })), this.display.curveSnap, (v) =>
      this.setDisplay((d) => (d.curveSnap = v as SnapMode), 'snap'),
    );
    this.snapSeg.el.setAttribute('aria-label', t('snap.label'));
    this.snapEl = h('div', { class: 'tb-snap', id: 'snap-control', title: `${t('snap.label')} (S)` }, icon(ICONS.magnet), this.snapSeg.el);
    this.measureSeg = segmented('measure-tool', null, [
      { value: 'select', label: `${t('mode.select')}  V` },
      ...MEASURE_TOOLS.map(([id, key, k]) => ({ value: id, label: `${t(key)}  ${k}` })),
    ], this.tools?.activeId ?? 'select', (v) => this.setTool(v));
    this.measureSeg.el.classList.add('seg-mode');
    const fit = h('button', { type: 'button', class: 'icon-btn tb-btn', id: 'btn-fit', title: `${t('view.fit')} (H)`, 'aria-label': t('view.fit'), onclick: () => this.viewer?.fitView() }, icon(ICONS.fit));
    this.toolbarEl.append(this.modeSeg.el, this.measureSeg.el, this.snapEl, fit);
    this.updateToolbar();
  }

  /** Tools of the current work mode only. */
  private updateToolbar(): void {
    const annotate = this.mode === 'annotate';
    if (this.modeSeg) this.modeSeg.el.hidden = !annotate;
    if (this.measureSeg) this.measureSeg.el.hidden = this.mode !== 'measure';
    if (this.snapEl) this.snapEl.hidden = !annotate || this.tools?.activeId !== 'curve';
  }

  private buildEmptyState(): void {
    clear(this.emptyEl);
    this.emptyEl.append(
      h('button', { type: 'button', class: 'btn btn-primary btn-lg', id: 'empty-open', onclick: () => this.meshInput.click() }, icon(ICONS.open), t('header.openMesh')),
      h('span', { class: 'vp-empty-formats mono' }, 'PLY · STL · OBJ'),
    );
  }

  private rebuildChrome(): void {
    const newHeader = this.buildHeader();
    this.header.replaceWith(newHeader);
    this.header = newHeader;
    const newSidebar = buildSidebar(this);
    this.sidebar.el.replaceWith(newSidebar.el);
    this.sidebar = newSidebar;
    this.buildToolbar();
    this.buildEmptyState();
    this.updateUndoButtons();
    this.updateMeshDependentUi();
    this.updateCursor();
    this.queueCoords();
  }

  private updateUndoButtons(): void {
    const hst = this.store.history;
    this.undoBtn.disabled = !hst.canUndo;
    this.redoBtn.disabled = !hst.canRedo;
    this.undoBtn.title = hst.undoLabelKey ? `${t('header.undo')}: ${t(hst.undoLabelKey)} (Ctrl+Z)` : `${t('header.undo')} (Ctrl+Z)`;
    this.redoBtn.title = hst.redoLabelKey ? `${t('header.redo')}: ${t(hst.redoLabelKey)} (Ctrl+Shift+Z)` : `${t('header.redo')} (Ctrl+Shift+Z)`;
  }

  private updateMeshDependentUi(): void {
    const has = this.hasMesh();
    this.emptyEl.hidden = has;
    this.toolbarEl.hidden = !has;
    this.saveBtn.disabled = !has;
    this.sidebar.refresh('mesh');
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
    this.updateToolbar();
  }

  private queueCoords(): void {
    if (this.coordsQueued) return;
    this.coordsQueued = true;
    requestAnimationFrame(() => {
      this.coordsQueued = false;
      const hit = this.lastHover;
      const m = this.store.state.mesh;
      let text = '';
      if (hit) {
        const u = this.store.state.specimen.unit;
        text = `${t('status.cursor', { x: fmtNum(hit.point.x, 2), y: fmtNum(hit.point.y, 2), z: fmtNum(hit.point.z, 2) })}${u ? ` ${u}` : ''}`;
      } else if (m) {
        text = t('status.mesh', { v: m.vertexCount.toLocaleString('en-US'), t: m.triangleCount.toLocaleString('en-US') });
      }
      this.coordEl.textContent = text;
    });
  }

  private applyBackground(): void {
    this.viewportEl.dataset.bg = this.display.background;
    const bg = getComputedStyle(this.viewportEl).getPropertyValue('--viewport-bg').trim() || '#d6dad4';
    this.viewer?.setBackground(bg);
  }

  // ------------------------------------------------------------ state → view

  private onStoreChange(c: Change): void {
    const sel = this.selection.id;
    if (sel && !this.store.scar(sel) && !this.store.curve(sel) && !this.store.measurement(sel)) this.selection.set(null);
    this.syncAnnotations();
    const map: Record<Change['kind'], RefreshKind> = { scars: 'arrows', curves: 'curves', measurements: 'measurements', specimen: 'specimen', reset: 'all' };
    this.sidebar.refresh(map[c.kind]);
    if (c.kind === 'specimen') {
      this.sidebar.refresh('arrows');
      this.sidebar.refresh('curves');
      this.sidebar.refresh('measurements');
    }
    if (c.kind === 'specimen' || c.kind === 'reset') this.updateAuto();
    if (c.kind !== 'reset') this.scheduleAutosave();
    this.queueCoords();
  }

  private syncAnnotations(): void {
    const handles = this.tools?.activeId === 'select' && this.mode === 'annotate';
    this.arrows?.sync(this.store.state, this.selection.id, this.display.arrows, handles);
    this.curves?.sync(this.store.state, this.selection.id, this.display.arrows, handles);
    this.measures?.sync(this.store.state, this.selection.id, this.mode === 'measure', (m) => `${m.label}  ${this.formatMeasurement(m)}`);
    this.occlusionDirty = true;
  }

  setTool(id: string): void {
    this.tools?.setActive(id);
    this.syncAnnotations();
    this.updateCursor();
  }

  /** Switch the work mode. The selection and the undo history are kept. */
  setMode(mode: AppMode): void {
    if (mode === this.mode) return;
    // tools belong to their mode; an unfinished curve is kept (as on Esc)
    this.setTool('select');
    this.mode = mode;
    writePref('mode', mode);
    this.viewportEl.dataset.mode = mode;
    this.appModeSeg?.set(mode);
    this.updateToolbar();
    this.syncAnnotations();
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
        this.meshView?.setRoughness(0.95 - 0.7 * this.display.gloss);
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
      case 'background':
        this.applyBackground();
        this.sidebar.refresh('display');
        break;
      case 'arrows':
        this.syncAnnotations();
        this.sidebar.refresh('display');
        this.sidebar.refresh('arrows');
        this.sidebar.refresh('curves');
        break;
      case 'snap':
        this.snapSeg?.set(this.display.curveSnap);
        this.refreshCurveTool();
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
    v.viewFrom(toward, v.cameraUp(), mid, Math.max(len * 3.2, v.diagonal * 0.4));
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
    v.viewFrom(toward, v.cameraUp(), center, Math.max(size * 2.2, v.diagonal * 0.35));
  }

  private stem(): string {
    const st = this.store.state;
    return fileStem(st.specimen.id || (st.mesh ? st.mesh.fileName.replace(/\.[^.]+$/, '') : ''), 'specimen');
  }

  exportCsv(): void {
    if (!this.hasMesh()) return;
    const csv = scarVectorCsv(this.store.state, { excelBom: this.display.excelBom });
    void this.save(`${this.stem()}_scar_vectors.csv`, csv, 'text/csv');
  }

  exportCurvesCsv(): void {
    if (!this.hasMesh() || !this.store.state.curves.length) return;
    const csv = curveCsv(this.store.state, { excelBom: this.display.excelBom });
    void this.save(`${this.stem()}_curves.csv`, csv, 'text/csv');
  }

  /** "12.345 mm" or "37.2°". */
  formatMeasurement(m: Measurement): string {
    const v = measurementValue(m);
    if (m.type === 'angle') return `${fmtNum(v, 1)}°`;
    const u = measurementUnit(m, this.store.state.specimen.unit);
    return `${fmtNum(v, 3)}${u ? ` ${u}` : ''}`;
  }

  autoMeasurements(): AutoMeasurements | null {
    return this.auto;
  }

  measuringBusy(): boolean {
    return this.hasMesh() && !this.measureBase;
  }

  exportMeasurementsCsv(): void {
    if (!this.hasMesh() || !this.auto) return;
    const csv = measurementsCsv(this.store.state, this.auto, { excelBom: this.display.excelBom });
    void this.save(`${this.stem()}_measurements.csv`, csv, 'text/csv');
  }

  exportManualMeasurementsCsv(): void {
    if (!this.hasMesh() || !this.store.state.measurements.length) return;
    const csv = manualMeasurementsCsv(this.store.state, { excelBom: this.display.excelBom });
    void this.save(`${this.stem()}_manual_measurements.csv`, csv, 'text/csv');
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
    const file = serializeProject(this.store.state, __APP_VERSION__, this.auto);
    void this.save(`${this.stem()}.lithicanalyst.json`, JSON.stringify(file, null, 2), 'application/json');
  }

  openProject(): void {
    this.projectInput.click();
  }

  private async save(name: string, text: string, mime: string): Promise<void> {
    const outcome = await saveTextFile(name, text, mime);
    if (outcome === 'saved') this.feedback.toast(t('toast.saved', { name }));
    else if (outcome === 'declined') this.feedback.toast(t('toast.declined'));
    else if (outcome === 'busy') this.feedback.toast(t('toast.busy'), 'warn');
    else this.feedback.showCopy(name, text);
  }

  private deleteSelection(e: KeyboardEvent): void {
    const sel = this.selection.id;
    if (!sel) return;
    e.preventDefault();
    if (this.mode === 'measure') {
      if (this.store.measurement(sel)) deleteMeasurement(this.store, sel);
      return;
    }
    if (this.store.curve(sel)) deleteCurve(this.store, sel);
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

  private installMesh(loaded: LoadedMesh): void {
    const v = this.viewer;
    if (!v) return;
    // an unfinished curve is kept with the previous model, then saved
    this.tools?.cancel();
    this.flushAutosave();
    this.surfaceSnap?.dispose();
    this.curvature?.dispose();
    this.meshView?.dispose();
    this.arrows?.clearAll();
    this.curves?.clearAll();
    this.measures?.clearAll();
    this.loaded = loaded;
    this.meshView = new MeshView(loaded);
    this.meshView.setRoughness(0.95 - 0.7 * this.display.gloss);
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

  private applyProject(state: ProjectState, toastKey: string | null = 'toast.projectLoaded'): void {
    state.mesh = this.store.state.mesh;
    this.tools?.cancel();
    this.selection.set(null);
    this.store.reset(state);
    if (toastKey) this.feedback.toast(t(toastKey, { what: countsText(state) }));
  }

  private async openMeshFile(file: File): Promise<void> {
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
      this.feedback.toast(t('toast.loaded', { name: file.name }));
      await this.afterMeshLoaded(loaded);
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

  private async afterMeshLoaded(loaded: LoadedMesh): Promise<void> {
    const pending = this.pendingProject;
    this.pendingProject = null;
    if (pending && pending.mesh?.sha256 === loaded.info.sha256) {
      this.applyProject(pending);
      return;
    }
    const entry = readAutosave(loaded.info.sha256);
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
    const ok = writeAutosave(st.mesh.sha256, serializeProject(st, __APP_VERSION__, this.auto));
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
        case 'KeyP':
          if (this.hasMesh() && this.mode === 'annotate') this.setTool('curve');
          return;
        case 'KeyD':
        case 'KeyG':
        case 'KeyN': {
          const tool = MEASURE_TOOLS.find(([, , k]) => `Key${k}` === e.code);
          if (tool && this.hasMesh() && this.mode === 'measure') this.setTool(tool[0]);
          return;
        }
        case 'KeyV':
          this.setTool('select');
          return;
        case 'KeyS':
          if (this.tools?.activeId === 'curve') this.cycleSnap();
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
          if (e.repeat || this.mode === 'present') return;
          this.deleteSelection(e);
          return;
        case 'Delete':
          if (this.mode !== 'present') this.deleteSelection(e);
          return;
        case 'KeyH':
          this.viewer?.fitView();
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
      if (digit && sel && this.mode === 'annotate') {
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

  private showHelp(): void {
    const count = Math.max(numberKeyField(SCAR_FIELDS)?.options?.length ?? 0, numberKeyField(CURVE_FIELDS)?.options?.length ?? 0) || 5;
    const rows: Array<[string, string]> = [
      ['M', t('help.k.mode')],
      ['A', t('help.k.draw')],
      ['D / G / N', t('help.k.measure')],
      ['P', t('help.k.curve')],
      ['V', t('help.k.select')],
      ['S', t('help.k.snap')],
      ['Shift', t('help.k.shift')],
      ['Enter', t('help.k.finish')],
      ['Backspace', t('help.k.back')],
      [`1 – ${count}`, t('help.k.complete')],
      ['Delete', t('help.k.delete')],
      ['] / [', t('help.k.next')],
      ['Ctrl+Z / Ctrl+Shift+Z', t('help.k.undo')],
      ['Ctrl+S', t('help.k.save')],
      ['H', t('help.k.fit')],
      ['C', t('help.k.centre')],
      ['L', t('help.k.light')],
      ['Space', t('help.k.space')],
      ['Esc', t('help.k.esc')],
    ];
    const mouse: Array<[string, string]> = [
      [t('help.m.rotate'), t('help.m.rotateKeys')],
      [t('help.m.pan'), t('help.m.panKeys')],
      [t('help.m.zoom'), t('help.m.zoomKeys')],
      [t('help.m.centre'), t('help.m.centreKeys')],
      [t('help.m.close'), t('help.m.closeKeys')],
    ];
    const body = h(
      'div',
      { class: 'help' },
      h('dl', { class: 'help-keys' }, ...rows.flatMap(([k, v]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, v)])),
      h('hr', { class: 'rule' }),
      h('dl', { class: 'help-keys' }, ...mouse.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    );
    void this.feedback.choose(t('help.title'), body, [{ id: 'close', label: t('dlg.close'), kind: 'primary' }]);
  }

  /** Small hook for automated tests and power users (window.lithicanalyst). */
  private exposeDebugApi(): void {
    const api = {
      version: __APP_VERSION__,
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
      exportMeasurementsCsvText: () => measurementsCsv(this.store.state, this.auto, { excelBom: false }),
      exportManualMeasurementsCsvText: () => manualMeasurementsCsv(this.store.state, { excelBom: false }),
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
      projectJson: () => serializeProject(this.store.state, __APP_VERSION__, this.auto),
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

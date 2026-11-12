import {
  AddCurveCommand,
  AddMeasurementCommand,
  AddPlaneCommand,
  AddRegionCommand,
  AddSectionCommand,
  AddScarCommand,
  CompoundCommand,
  DeleteCurveCommand,
  DeleteMeasurementCommand,
  DeletePlaneCommand,
  DeleteRegionCommand,
  DeleteSectionCommand,
  DeleteScarCommand,
  ImportScarsCommand,
  SetLandmarksCommand,
  SetNoduleCommand,
  SetRelationsCommand,
  SetConfigurationCommand,
  SetFlakeCommand, SetSharpEdgeCommand, SetGmConfigCommand,
  SetSequencesCommand,
  SetSplitCommand,
  SetSpecimenCommand,
  SetWorkingEdgesCommand,
  UpdateCurveCommand,
  UpdatePlaneCommand,
  UpdateRegionCommand,
  UpdateSectionCommand,
  UpdateScarCommand,
  type Command,
} from './commands';
import { editedCompletion, type CurveShape } from './curveGeometry';
import { emptyCorrections, hasFaceCorrections, joinKey } from '../compute/configuration';
import { orderSequences, relationInputs } from '../compute/relations';
import type { RetouchStation } from '../compute/retouchAngle';
import { clampFitLength } from '../compute/retouchIndex';
import { measuredLine, platformEndsOf } from '../compute/measuredLine';
import { autoRetouchCurves } from '../compute/retouchBand';
import { edgeAxis, refusalOf, retouchRunEdges, type WorkingEdgeRefusal } from '../compute/workingEdge';
import { curveFieldByKey, defaultAttributes, defaultCurveAttributes, fieldByKey, measuresEdgeAngle, PLATFORM_OUTLINE, withAttribute, type BiconeRole, type BiconeSide, type ConfigFace, type ConfigModel, type ConfigRole, type Polarity, type SpecimenType } from './fields';
import { curveLabelForNumber, labelForNumber, nowIso, uuid } from './ids';
import { landmarkData, type LandmarkData, type ProjectStore } from './store';
import { retouchSettingsOf, type RetouchAxisChoice, type RetouchSettings } from './types';
import type { GmConfig, ImportRecord, SharpEdgeRule, AttributeValue, ConfigCorrections, Curve, CurveCompletion, Landmark, Measurement, MeasureType, Plane, PlaneMethod, ProjectState, Region, RegionType, Relation, RelationKind, Scar, ScarWithVector, Section, SemilandmarkSet, Sequence, SpecimenFrame, SpecimenInfo, TechnicalAxis, Vec3, WorkingEdge } from './types';
import { copy, distance } from './vec';

/** High-level, undoable operations. UI code calls these, never the store's "_" methods. */

export interface NewArrowInput {
  start: Vec3;
  end: Vec3;
  startNormal: Vec3;
  endNormal: Vec3;
  attributes?: Record<string, AttributeValue>;
  label?: string;
}

/** A new scar with a direction arrow. */
export function addScarVector(store: ProjectStore, input: NewArrowInput): ScarWithVector {
  const n = store.state.nextLabelNumber;
  const t = nowIso();
  const scar: ScarWithVector = {
    id: uuid(),
    label: input.label ?? labelForNumber(n),
    vector: {
      start: copy(input.start),
      end: copy(input.end),
      startNormal: copy(input.startNormal),
      endNormal: copy(input.endNormal),
    },
    attributes: { ...defaultAttributes(), ...(input.attributes ?? {}) },
    createdAt: t,
    modifiedAt: t,
  };
  store.history.execute(new AddScarCommand(scar, input.label ? null : n));
  return scar;
}

/** An arrow brought in from a file, already on the surface. */
export interface ImportedArrow {
  start: Vec3;
  end: Vec3;
  /** The outward normal for both ends. */
  normal: Vec3;
  /** To be checked: an end lay too far from the surface. */
  review: boolean;
}

/**
 * Scar vectors from a file: new scars after those there are, labelled on from them, with nothing else filled in, and the record of
 * the import (`imports`). One undo step, which takes the record away too.
 */
export function importScars(store: ProjectStore, arrows: readonly ImportedArrow[], record: Omit<ImportRecord, 'arrows' | 'review' | 'date'>, date = nowIso()): ImportRecord {
  let n = store.state.nextLabelNumber;
  const scars: ScarWithVector[] = arrows.map((a) => ({
    id: uuid(),
    label: labelForNumber(n++),
    vector: { start: copy(a.start), end: copy(a.end), startNormal: copy(a.normal), endNormal: copy(a.normal) },
    attributes: defaultAttributes(),
    createdAt: date,
    modifiedAt: date,
  }));
  const full: ImportRecord = { ...structuredClone(record), date, arrows: scars.map((s) => s.id), review: scars.filter((_, i) => arrows[i].review).map((s) => s.id) };
  store.history.execute(new ImportScarsCommand(scars, full, n));
  return full;
}

/** Deleting a scar also takes it out of its relations and its sequence (one undo step). */
function deleteScarCommands(store: ProjectStore, id: string): Command[] {
  const parts: Command[] = [new DeleteScarCommand(id)];
  const rel = store.state.relations;
  if (rel.some((r) => r.a === id || r.b === id))
    parts.push(new SetRelationsCommand('cmd.deleteArrow', structuredClone(rel), structuredClone(rel.filter((r) => r.a !== id && r.b !== id))));
  const seq = store.state.sequences;
  if (seq.some((q) => q.scarIds.includes(id)))
    parts.push(new SetSequencesCommand('cmd.deleteArrow', structuredClone(seq), seq.map((q) => ({ ...structuredClone(q), scarIds: q.scarIds.filter((x) => x !== id) }))));
  return parts;
}

export function deleteScar(store: ProjectStore, id: string): void {
  if (!store.scar(id)) return;
  const parts = deleteScarCommands(store, id);
  store.history.execute(parts.length === 1 ? parts[0] : new CompoundCommand('cmd.deleteArrow', parts));
}

function update(
  store: ProjectStore,
  id: string,
  labelKey: string,
  change: (a: Scar) => void,
  mergeKey: string | null = null,
): void {
  const before = store.scar(id);
  if (!before) return;
  const after = structuredClone(before);
  change(after);
  after.modifiedAt = nowIso();
  store.history.execute(new UpdateScarCommand(labelKey, structuredClone(before), after, mergeKey));
}

export function moveEndpoint(
  store: ProjectStore,
  id: string,
  which: 'start' | 'end',
  point: Vec3,
  normal: Vec3,
): void {
  const v = store.scar(id)?.vector;
  if (!v) return;
  const other = which === 'start' ? v.end : v.start;
  if (distance(point, other) === 0) return;
  update(store, id, 'cmd.moveEndpoint', (x) => {
    if (!x.vector) return;
    if (which === 'start') {
      x.vector.start = copy(point);
      x.vector.startNormal = copy(normal);
    } else {
      x.vector.end = copy(point);
      x.vector.endNormal = copy(normal);
    }
  });
}

/** Set a field; fields that follow from it change in the same step (completeness → termination). */
export function setScarAttribute(store: ProjectStore, id: string, key: string, value: AttributeValue): void {
  const a = store.scar(id);
  if (!a || a.attributes[key] === value) return;
  const next = withAttribute(a.attributes, key, value);
  if (!next) return;
  const isText = fieldByKey(key)?.type === 'text';
  update(store, id, 'cmd.editField', (x) => {
    x.attributes = next;
  }, isText ? `attr:${key}:${id}` : null);
}

export function setScarLabel(store: ProjectStore, id: string, label: string): void {
  const a = store.scar(id);
  if (!a || a.label === label) return;
  update(store, id, 'cmd.renameArrow', (x) => {
    x.label = label;
  }, `label:${id}`);
}

// ---------------------------------------------------------------- curves

const copyShape = (s: CurveShape): CurveShape => ({
  anchors: s.anchors.map(copy),
  points: s.points.map(copy),
  anchorIndex: [...s.anchorIndex],
  closed: s.closed,
});

export interface NewCurveInput extends CurveShape {
  attributes?: Record<string, AttributeValue>;
  label?: string;
}

function newCurve(store: ProjectStore, input: NewCurveInput): { curve: Curve; command: AddCurveCommand } {
  const n = store.state.nextCurveNumber;
  const t = nowIso();
  const curve: Curve = {
    id: uuid(),
    label: input.label ?? curveLabelForNumber(n),
    ...copyShape(input),
    attributes: { ...defaultCurveAttributes(), ...(input.attributes ?? {}) },
    createdAt: t,
    modifiedAt: t,
  };
  return { curve, command: new AddCurveCommand(curve, input.label ? null : n) };
}

export function addCurve(store: ProjectStore, input: NewCurveInput): Curve {
  const { curve, command } = newCurve(store, input);
  store.history.execute(command);
  return curve;
}

/** What of the landmarks follows from the curves being `curves`: a flake's platform ends where the edge meets the outline. */
function endChanges(store: ProjectStore, curves: readonly Curve[], labelKey: string, type = store.state.specimen.type): Command[] {
  if (type !== 'flake') return [];
  const before = landmarkData(store.state);
  const after = structuredClone(before);
  syncPlatformEnds(after, curves);
  return JSON.stringify(after) === JSON.stringify(before) ? [] : [new SetLandmarksCommand(labelKey, before, after)];
}

/** A new curve with its type, in one step: what drawing it and then giving it the type would do. */
export function addCurveOfType(store: ProjectStore, input: NewCurveInput, type: string): Curve {
  const { curve, command } = newCurve(store, { ...input, attributes: { ...(input.attributes ?? {}), type } });
  const { replaced, regions } = typeChanges(store, curve, [...store.state.curves, curve], 'cmd.addCurve');
  const parts = [...replaced, command, ...regions];
  store.history.execute(parts.length === 1 ? command : new CompoundCommand('cmd.addCurve', parts));
  return curve;
}

/**
 * The commands that bring a flake's regions that follow other annotations in line with `after`: the platform comes with a
 * platform outline, the ventral and dorsal faces with an edge and a technical frame, a retouch region with a retouch curve that has
 * both ends on an edge. `seed`: any point, for those that are new (their pieces are worked out from what they follow).
 */
function autoRegionChanges(store: ProjectStore, after: { curves: readonly Curve[]; axis: TechnicalAxis | null }, seed: Vec3): Command[] {
  const st = store.state;
  const wanted: RegionType[] = [];
  if (st.specimen.type === 'flake') {
    if (after.curves.some((c) => c.attributes.type === PLATFORM_OUTLINE)) wanted.push('platform');
    if (after.axis?.matrix && after.curves.some((c) => c.attributes.type === 'edge')) wanted.push('ventral', 'dorsal');
  }
  const bands = st.specimen.type === 'flake' ? autoRetouchCurves(after.curves) : [];
  const parts: Command[] = st.regions.filter((r) => r.auto && (r.curveId ? !bands.some((c) => c.id === r.curveId) : !wanted.includes(r.type))).map((r) => new DeleteRegionCommand(r.id));
  let n = st.nextRegionNumber;
  const t = nowIso();
  for (const type of wanted) {
    if (st.regions.some((r) => r.auto && r.type === type)) continue;
    parts.push(new AddRegionCommand({ id: uuid(), label: `R${n}`, seed: copy(seed), type, scarId: null, auto: true, createdAt: t, modifiedAt: t }, n));
    n++;
  }
  for (const c of bands) {
    if (st.regions.some((r) => r.auto && r.curveId === c.id)) continue;
    parts.push(new AddRegionCommand({ id: uuid(), label: `R${n}`, seed: copy(c.points[0]), type: 'retouch', scarId: null, retouchLayer: 1, auto: true, curveId: c.id, createdAt: t, modifiedAt: t }, n));
    n++;
  }
  return parts;
}

/** The working edges of these curves go with them. */
function edgesOfCurvesGone(store: ProjectStore, labelKey: string, ids: readonly string[]): Command[] {
  const st = store.state;
  if (!st.workingEdges.some((e) => ids.includes(e.curveId))) return [];
  return [setEdges(store, labelKey, st.workingEdges.filter((e) => !ids.includes(e.curveId)), st.nextWorkingEdgeNumber)];
}

export function deleteCurve(store: ProjectStore, id: string): void {
  const c = store.curve(id);
  if (!c) return;
  const left = store.state.curves.filter((x) => x.id !== id);
  const parts: Command[] = [new DeleteCurveCommand(id), ...edgesOfCurvesGone(store, 'cmd.deleteCurve', [id]), ...autoRegionChanges(store, { curves: left, axis: store.state.flake.axis }, c.points[0]), ...endChanges(store, left, 'cmd.deleteCurve')];
  store.history.execute(parts.length === 1 ? parts[0] : new CompoundCommand('cmd.deleteCurve', parts));
}

function updateCurve(
  store: ProjectStore,
  id: string,
  labelKey: string,
  change: (c: Curve) => void,
  mergeKey: string | null = null,
): void {
  const before = store.curve(id);
  if (!before) return;
  const after = structuredClone(before);
  change(after);
  after.modifiedAt = nowIso();
  store.history.execute(new UpdateCurveCommand(labelKey, structuredClone(before), after, mergeKey));
}

/** A change of a curve's points: with what follows from them, in one step. */
function reshapeCurve(store: ProjectStore, id: string, labelKey: string, change: (c: Curve) => void): void {
  const before = store.curve(id);
  if (!before) return;
  const after = structuredClone(before);
  change(after);
  after.modifiedAt = nowIso();
  const update = new UpdateCurveCommand(labelKey, structuredClone(before), after);
  const curves = store.state.curves.map((x) => (x.id === id ? after : x));
  const parts: Command[] = [update, ...autoRegionChanges(store, { curves, axis: store.state.flake.axis }, after.points[0]), ...endChanges(store, curves, labelKey)];
  store.history.execute(parts.length === 1 ? update : new CompoundCommand(labelKey, parts));
}

/** Replace the traced geometry (after moving an anchor); automatic anchors of a completed loop that moved become the user's. */
export function setCurveShape(store: ProjectStore, id: string, shape: CurveShape): void {
  reshapeCurve(store, id, 'cmd.editCurve', (c) => {
    const completion = shape.closed ? editedCompletion(c.completion, c.anchors, shape.anchors) : undefined;
    Object.assign(c, copyShape(shape));
    if (completion) c.completion = completion;
    else delete c.completion;
  });
}

/**
 * Close an open curve along the edge of the model ("Complete loop"), in one step that undo
 * takes back to the open curve; `completion` marks the anchors placed automatically (null: none).
 */
export function completeCurveLoop(store: ProjectStore, id: string, shape: CurveShape, completion: CurveCompletion | null): void {
  reshapeCurve(store, id, 'cmd.completeLoop', (c) => {
    Object.assign(c, copyShape(shape));
    if (completion) c.completion = structuredClone(completion);
    else delete c.completion;
  });
}

/**
 * What follows from curve `c` having its type in `curves`: a flake has one platform outline, so a new one takes the
 * place of the old, and the region that follows the outline comes and goes with it.
 */
function typeChanges(store: ProjectStore, c: Curve, curves: readonly Curve[], labelKey: string): { replaced: Command[]; regions: Command[] } {
  const st = store.state;
  const replaced: Command[] = [];
  let left = curves;
  if (c.attributes.type === PLATFORM_OUTLINE) {
    const old = st.curves.filter((o) => o.id !== c.id && o.attributes.type === PLATFORM_OUTLINE);
    for (const o of old) replaced.push(new DeleteCurveCommand(o.id));
    replaced.push(...edgesOfCurvesGone(store, labelKey, old.map((o) => o.id)));
    left = curves.filter((x) => x.id === c.id || x.attributes.type !== PLATFORM_OUTLINE);
  }
  return { replaced, regions: [...autoRegionChanges(store, { curves: left, axis: st.flake.axis }, c.points[0]), ...endChanges(store, left, labelKey)] };
}

/** A curve's type. */
function setCurveType(store: ProjectStore, c: Curve, value: AttributeValue): void {
  const after = structuredClone(c);
  after.attributes.type = value;
  after.modifiedAt = nowIso();
  // (made a retouch curve anew, it starts anew)
  if (value === 'retouch') delete after.retouchSide;
  const update = new UpdateCurveCommand('cmd.editField', structuredClone(c), after);
  const { replaced, regions } = typeChanges(store, after, store.state.curves.map((x) => (x.id === c.id ? after : x)), 'cmd.editField');
  const parts = [...replaced, update, ...regions];
  store.history.execute(parts.length === 1 ? parts[0] : new CompoundCommand('cmd.editField', parts));
}

export function setCurveAttribute(store: ProjectStore, id: string, key: string, value: AttributeValue): void {
  const c = store.curve(id);
  if (!c || c.attributes[key] === value) return;
  if (key === 'type') return setCurveType(store, c, value);
  const isText = curveFieldByKey(key)?.type === 'text';
  updateCurve(store, id, 'cmd.editField', (x) => {
    x.attributes[key] = value;
  }, isText ? `curve-attr:${key}:${id}` : null);
}

/** Whether a curve's edge angles are measured. */
export function setCurveEdgeAngle(store: ProjectStore, id: string, on: boolean): void {
  updateCurve(store, id, 'cmd.editField', (c) => {
    c.edgeAngle = on;
  });
}

export function setCurveLabel(store: ProjectStore, id: string, label: string): void {
  const c = store.curve(id);
  if (!c || c.label === label) return;
  updateCurve(store, id, 'cmd.renameCurve', (x) => {
    x.label = label;
  }, `curve-label:${id}`);
}

// ---------------------------------------------------------------- working edges

const setEdges = (store: ProjectStore, labelKey: string, edges: readonly WorkingEdge[], next: number, mergeKey: string | null = null): SetWorkingEdgesCommand =>
  new SetWorkingEdgesCommand(labelKey, { edges: structuredClone(store.state.workingEdges), next: store.state.nextWorkingEdgeNumber }, { edges: structuredClone([...edges]), next }, mergeKey);

/** What came of a change to the working edges: the edge, or why it was not made. */
export type WorkingEdgeOutcome = { edge: WorkingEdge; refused: null } | { edge: null; refused: WorkingEdgeRefusal };

/** Why this curve cannot have this stretch as a working edge; `except`: the edge being changed. */
function refusal(store: ProjectStore, curveId: string, start: Vec3, end: Vec3, except: string | null): WorkingEdgeRefusal | null {
  const st = store.state;
  const c = store.curve(curveId);
  if (!c || !measuresEdgeAngle(c, st.specimen.type)) return { reason: 'not_measured' };
  return refusalOf(edgeAxis(measuredLine(c, st), st.specimen.unit), start, end, st.workingEdges.filter((e) => e.curveId === curveId && e.id !== except));
}

/** A new working edge on a curve whose edge angles are measured; not where it is too short or overlaps another. */
export function addWorkingEdge(store: ProjectStore, input: { curveId: string; start: Vec3; end: Vec3; name?: string }): WorkingEdgeOutcome {
  const refused = refusal(store, input.curveId, input.start, input.end, null);
  if (refused) return { edge: null, refused };
  const st = store.state;
  const n = st.nextWorkingEdgeNumber;
  const t = nowIso();
  const edge: WorkingEdge = { id: uuid(), label: `E${n}`, name: input.name ?? '', curveId: input.curveId, start: copy(input.start), end: copy(input.end), createdAt: t, modifiedAt: t };
  store.history.execute(setEdges(store, 'cmd.addWorkingEdge', [...st.workingEdges, edge], n + 1));
  return { edge, refused: null };
}

/** Its ends or its name; ends that would make it too short or overlap another are refused, and it stays as it is. */
export function updateWorkingEdge(store: ProjectStore, id: string, patch: { start?: Vec3; end?: Vec3; name?: string }): WorkingEdgeOutcome | null {
  const e = store.workingEdge(id);
  if (!e) return null;
  const start = patch.start ?? e.start, end = patch.end ?? e.end;
  if (patch.start || patch.end) {
    const refused = refusal(store, e.curveId, start, end, id);
    if (refused) return { edge: null, refused };
  }
  const after: WorkingEdge = { ...e, start: copy(start), end: copy(end), name: patch.name ?? e.name, modifiedAt: nowIso() };
  const st = store.state;
  store.history.execute(setEdges(store, 'cmd.editWorkingEdge', st.workingEdges.map((x) => (x.id === id ? after : x)), st.nextWorkingEdgeNumber, patch.name !== undefined && !patch.start && !patch.end ? `edge-name:${id}` : null));
  return { edge: after, refused: null };
}

/** The other way round a closed curve: its two ends exchanged. */
export function otherWorkingEdgeStretch(store: ProjectStore, id: string): WorkingEdgeOutcome | null {
  const e = store.workingEdge(id);
  return e ? updateWorkingEdge(store, id, { start: e.end, end: e.start }) : null;
}

export function deleteWorkingEdge(store: ProjectStore, id: string): void {
  const st = store.state;
  if (!store.workingEdge(id)) return;
  store.history.execute(setEdges(store, 'cmd.deleteWorkingEdge', st.workingEdges.filter((e) => e.id !== id), st.nextWorkingEdgeNumber));
}

/** A working edge on each retouched stretch of the curves measured that have none, in one step; those with any stay as they are. Their number. */
export function generateWorkingEdges(store: ProjectStore, curves: ReadonlyArray<{ curveId: string; stations: readonly RetouchStation[] }>): number {
  const st = store.state;
  const edges = [...st.workingEdges];
  let n = st.nextWorkingEdgeNumber;
  const t = nowIso();
  for (const { curveId, stations } of curves) {
    const c = store.curve(curveId);
    if (!c || !measuresEdgeAngle(c, st.specimen.type) || st.workingEdges.some((e) => e.curveId === curveId)) continue;
    const line = measuredLine(c, st);
    const axis = edgeAxis(line, st.specimen.unit);
    for (const r of retouchRunEdges(line, stations, st.specimen.unit)) {
      if (refusalOf(axis, r.start, r.end, edges.filter((e) => e.curveId === curveId))) continue;
      edges.push({ id: uuid(), label: `E${n}`, name: '', curveId, start: copy(r.start), end: copy(r.end), createdAt: t, modifiedAt: t });
      n++;
    }
  }
  const made = edges.length - st.workingEdges.length;
  if (made) store.history.execute(setEdges(store, 'cmd.generateWorkingEdges', edges, n));
  return made;
}

// ---------------------------------------------------------------- measurements

export interface NewMeasurementInput {
  type: MeasureType;
  points: Vec3[];
  path?: Vec3[] | null;
}

export function addMeasurement(store: ProjectStore, input: NewMeasurementInput): Measurement {
  const n = store.state.nextMeasureNumber;
  const t = nowIso();
  const m: Measurement = {
    id: uuid(),
    label: `M${n}`,
    type: input.type,
    points: input.points.map(copy),
    path: input.type === 'geodesic' && input.path ? input.path.map(copy) : null,
    createdAt: t,
    modifiedAt: t,
  };
  store.history.execute(new AddMeasurementCommand(m, n));
  return m;
}

export function deleteMeasurement(store: ProjectStore, id: string): void {
  if (!store.measurement(id)) return;
  store.history.execute(new DeleteMeasurementCommand(id));
}

// ---------------------------------------------------------------- planes

/** A new plane; `upHint` is the direction toward the viewer at the time. */
export function addPlane(store: ProjectStore, method: PlaneMethod, upHint: Vec3): Plane {
  const n = store.state.nextPlaneNumber;
  const t = nowIso();
  const plane: Plane = {
    id: uuid(),
    label: `P${n}`,
    method,
    excludeCompleteness: [],
    curveIds: [],
    regionIds: [],
    upHint: copy(upHint),
    visible: true,
    createdAt: t,
    modifiedAt: t,
  };
  store.history.execute(new AddPlaneCommand(plane, n));
  return plane;
}

export function deletePlane(store: ProjectStore, id: string): void {
  if (!store.plane(id)) return;
  store.history.execute(new DeletePlaneCommand(id));
}

function updatePlane(store: ProjectStore, id: string, labelKey: string, change: (p: Plane) => void): void {
  const before = store.plane(id);
  if (!before) return;
  const after = structuredClone(before);
  change(after);
  if (JSON.stringify(after) === JSON.stringify(before)) return;
  after.modifiedAt = nowIso();
  store.history.execute(new UpdatePlaneCommand(labelKey, structuredClone(before), after));
}

export const setPlaneMethod = (store: ProjectStore, id: string, method: PlaneMethod): void =>
  updatePlane(store, id, 'cmd.editPlane', (p) => {
    p.method = method;
  });

/** Leave a completeness category out of (or back into) a scar_starts plane. */
export const setPlaneExclusion = (store: ProjectStore, id: string, code: string, excluded: boolean): void =>
  updatePlane(store, id, 'cmd.editPlane', (p) => {
    const set = new Set(p.excludeCompleteness);
    if (excluded) set.add(code);
    else set.delete(code);
    p.excludeCompleteness = [...set];
  });

/** Use (or stop using) a curve in a curves plane. */
export const setPlaneCurve = (store: ProjectStore, id: string, curveId: string, used: boolean): void =>
  updatePlane(store, id, 'cmd.editPlane', (p) => {
    const ids = p.curveIds.filter((x) => x !== curveId);
    if (used) ids.push(curveId);
    p.curveIds = ids;
  });

/** Use (or stop using) a surface region in a region plane. */
export const setPlaneRegion = (store: ProjectStore, id: string, regionId: string, used: boolean): void =>
  updatePlane(store, id, 'cmd.editPlane', (p) => {
    const ids = p.regionIds.filter((x) => x !== regionId);
    if (used) ids.push(regionId);
    p.regionIds = ids;
  });

export const flipPlane = (store: ProjectStore, id: string): void =>
  updatePlane(store, id, 'cmd.flipPlane', (p) => {
    p.upHint = [-p.upHint[0], -p.upHint[1], -p.upHint[2]];
  });

export const setPlaneVisible = (store: ProjectStore, id: string, visible: boolean): void =>
  updatePlane(store, id, 'cmd.editPlane', (p) => {
    p.visible = visible;
  });

// ---------------------------------------------------------------- sections

export function addSection(store: ProjectStore, input: { point: Vec3; normal: Vec3; across: Vec3 }): Section {
  const n = store.state.nextSectionNumber;
  const t = nowIso();
  const section: Section = {
    id: uuid(),
    label: `X${n}`,
    point: copy(input.point),
    normal: copy(input.normal),
    across: copy(input.across),
    keep: 'both',
    fill: 'hatch',
    inFigure: true,
    createdAt: t,
    modifiedAt: t,
  };
  store.history.execute(new AddSectionCommand(section, n));
  return section;
}

export function deleteSection(store: ProjectStore, id: string): void {
  if (!store.section(id)) return;
  store.history.execute(new DeleteSectionCommand(id));
}

export function updateSection(store: ProjectStore, id: string, patch: Partial<Pick<Section, 'keep' | 'fill' | 'inFigure'>>): void {
  const before = store.section(id);
  if (!before) return;
  const after = { ...structuredClone(before), ...patch };
  if (JSON.stringify(after) === JSON.stringify(before)) return;
  after.modifiedAt = nowIso();
  store.history.execute(new UpdateSectionCommand(structuredClone(before), after));
}

// ---------------------------------------------------------------- regions

/** A scar without a direction, for a scar region with no arrow origin in it. */
function newAreaScar(store: ProjectStore): { scar: Scar; command: AddScarCommand } {
  const n = store.state.nextLabelNumber;
  const t = nowIso();
  const scar: Scar = { id: uuid(), label: labelForNumber(n), vector: null, attributes: defaultAttributes(), createdAt: t, modifiedAt: t };
  return { scar, command: new AddScarCommand(scar, n) };
}

/**
 * A region at `seed`. A scar region is linked to `scarId` (a scar whose arrow
 * starts in it), or to a new scar without a direction — in the same undo step.
 */
export function addRegion(store: ProjectStore, seed: Vec3, type: RegionType, scarId: string | null): Region {
  const n = store.state.nextRegionNumber;
  const t = nowIso();
  const parts = [];
  let linked = scarId;
  const scarRegion = isScarRegion(store, type);
  if (scarRegion && !linked) {
    const s = newAreaScar(store);
    parts.push(s.command);
    linked = s.scar.id;
  }
  const region: Region = { id: uuid(), label: `R${n}`, seed: copy(seed), type, scarId: scarRegion ? linked : null, createdAt: t, modifiedAt: t };
  parts.push(new AddRegionCommand(region, n));
  store.history.execute(parts.length === 1 ? parts[0] : new CompoundCommand('cmd.addRegion', parts));
  return region;
}

/** A region that has a scar: on a generic specimen "scar" would be the user's own word, with no scar to it. */
const isScarRegion = (store: ProjectStore, type: RegionType): boolean => type === 'scar' && store.state.specimen.type !== 'generic';

/** A region that follows a retouch curve, given up by the user: the curve has none from now on. */
function bandGivenUp(store: ProjectStore, region: Region): Command[] {
  const c = region.auto && region.curveId ? store.curve(region.curveId) : undefined;
  if (!c) return [];
  return [new UpdateCurveCommand('cmd.editRegion', structuredClone(c), { ...structuredClone(c), retouchSide: 'off', modifiedAt: nowIso() })];
}

/** The scar created for a region (no direction) is removed with it when nothing else uses it. */
function dropAreaScar(store: ProjectStore, region: Region): Command[] {
  const scar = region.scarId ? store.scar(region.scarId) : undefined;
  if (!scar || scar.vector) return [];
  if (store.state.regions.some((r) => r.id !== region.id && r.scarId === scar.id)) return [];
  return deleteScarCommands(store, scar.id);
}

/**
 * Change a region's type; becoming a scar links it to `scarId` or to a new scar without a direction.
 * The region that followed the platform outline is the user's from then on, at `seed` (where it was).
 */
export function setRegionType(store: ProjectStore, id: string, type: RegionType, scarId: string | null, seed?: Vec3): void {
  const before = store.region(id);
  if (!before || before.type === type) return;
  const parts: Command[] = [];
  let linked = scarId ?? before.scarId;
  const scarRegion = isScarRegion(store, type);
  if (scarRegion && !linked) {
    const s = newAreaScar(store);
    parts.push(s.command);
    linked = s.scar.id;
  }
  const after: Region = { ...structuredClone(before), type, scarId: scarRegion ? linked : null, modifiedAt: nowIso() };
  if (type === 'retouch') after.retouchLayer = before.retouchLayer ?? 1;
  else delete after.retouchLayer;
  parts.push(...bandGivenUp(store, before));
  if (after.auto) {
    delete after.auto;
    delete after.curveId;
    if (seed) after.seed = copy(seed);
  }
  parts.push(new UpdateRegionCommand(structuredClone(before), after));
  if (!scarRegion) parts.push(...dropAreaScar(store, before));
  store.history.execute(parts.length === 1 ? parts[0] : new CompoundCommand('cmd.editRegion', parts));
}

/** Which scar a scar region belongs to (a scar's two parts may be two regions); a scar without a direction made for this region goes when nothing else uses it. */
export function setRegionScar(store: ProjectStore, id: string, scarId: string): void {
  const before = store.region(id);
  if (!before || before.type !== 'scar' || before.scarId === scarId || !store.scar(scarId)) return;
  const update = new UpdateRegionCommand(structuredClone(before), { ...structuredClone(before), scarId, modifiedAt: nowIso() });
  const drop = dropAreaScar(store, before);
  store.history.execute(drop.length ? new CompoundCommand('cmd.editRegion', [update, ...drop]) : update);
}

/** Which retouch layer a retouch region is. */
export function setRegionRetouchLayer(store: ProjectStore, id: string, layer: number): void {
  const before = store.region(id);
  if (!before || before.type !== 'retouch' || before.retouchLayer === layer) return;
  store.history.execute(new UpdateRegionCommand(structuredClone(before), { ...structuredClone(before), retouchLayer: layer, modifiedAt: nowIso() }));
}

export function deleteRegion(store: ProjectStore, id: string): void {
  const r = store.region(id);
  if (!r) return;
  const drop = [...dropAreaScar(store, r), ...bandGivenUp(store, r)];
  store.history.execute(drop.length ? new CompoundCommand('cmd.deleteRegion', [new DeleteRegionCommand(id), ...drop]) : new DeleteRegionCommand(id));
}

/** The region that follows a retouch curve goes to the curve's other side. */
export function otherRetouchSide(store: ProjectStore, regionId: string): void {
  const r = store.region(regionId);
  if (!r?.auto || !r.curveId) return;
  updateCurve(store, r.curveId, 'cmd.editRegion', (c) => {
    if (c.retouchSide === 'larger') delete c.retouchSide;
    else c.retouchSide = 'larger';
  });
}

/** A flake read from a file: retouch curves that reach an edge and have no region following them stay so (regions were marked by hand then). */
export function withRetouchCurvesKept(state: ProjectState): ProjectState {
  if (state.specimen.type !== 'flake') return state;
  for (const c of autoRetouchCurves(state.curves)) if (!state.regions.some((r) => r.curveId === c.id)) c.retouchSide = 'off';
  return state;
}

// ---------------------------------------------------------------- relations and sequences

/** The relation recorded for a pair of scars (either way round), if any. */
export const relationBetween = (state: Readonly<ProjectState>, x: string, y: string): Relation | undefined =>
  state.relations.find((r) => (r.a === x && r.b === y) || (r.a === y && r.b === x));

/**
 * The sequences in the order the relations call for (earliest first, and the
 * members of ordered ones): see orderSequences. Sequences that move are touched.
 */
function ordered(state: Readonly<ProjectState>, sequences: Sequence[], relations: readonly Relation[] = state.relations): Sequence[] {
  const { scarIds, edges } = relationInputs({ scars: state.scars, relations: [...relations], sequences: [] });
  const t = nowIso();
  // orderSequences hands back the same object for a sequence whose members kept their order
  return orderSequences(scarIds, edges, sequences).map((q) => (sequences.includes(q) ? q : { ...q, modifiedAt: t }));
}

/** New relations, with the sequences reordered to follow them in the same undo step. */
function changeRelations(store: ProjectStore, labelKey: string, after: Relation[]): void {
  const before = store.state.relations;
  const seqBefore = store.state.sequences;
  const seqAfter = ordered(store.state, structuredClone(seqBefore), after);
  const rel = new SetRelationsCommand(labelKey, structuredClone(before), after);
  store.history.execute(
    JSON.stringify(seqAfter) === JSON.stringify(seqBefore) ? rel : new CompoundCommand(labelKey, [rel, new SetSequencesCommand(labelKey, structuredClone(seqBefore), seqAfter)]),
  );
}

/** Record "a cuts b" or "cannot tell" for a pair of scars, replacing what was recorded for the pair. */
export function setRelation(store: ProjectStore, a: string, b: string, kind: RelationKind): Relation | null {
  if (a === b || !store.scar(a) || !store.scar(b)) return null;
  const before = store.state.relations;
  const old = relationBetween(store.state, a, b);
  if (old && old.kind === kind && (kind === 'indeterminate' || old.a === a)) return old;
  const t = nowIso();
  const rel: Relation = old ? { ...structuredClone(old), a, b, kind, modifiedAt: t } : { id: uuid(), a, b, kind, createdAt: t, modifiedAt: t };
  changeRelations(store, old ? 'cmd.editRelation' : 'cmd.addRelation', old ? before.map((r) => (r.id === old.id ? rel : structuredClone(r))) : [...structuredClone(before), rel]);
  return rel;
}

export function deleteRelation(store: ProjectStore, id: string): void {
  const before = store.state.relations;
  if (!before.some((r) => r.id === id)) return;
  changeRelations(store, 'cmd.deleteRelation', structuredClone(before.filter((r) => r.id !== id)));
}

/** `reorder`: put the sequences in the order the relations call for (changes of membership); not for manual moves or names. */
function changeSequences(store: ProjectStore, labelKey: string, change: (list: Sequence[]) => Sequence[], mergeKey: string | null = null, reorder = false): void {
  const before = store.state.sequences;
  let after = change(structuredClone(before));
  if (reorder) after = ordered(store.state, after);
  if (JSON.stringify(after) === JSON.stringify(before)) return;
  store.history.execute(new SetSequencesCommand(labelKey, structuredClone(before), after, null, mergeKey));
}

/** A new sequence after (later than) the others, empty or with these scars (taken out of any other). */
export function addSequence(store: ProjectStore, scarIds: string[] = []): Sequence {
  const n = store.state.nextSequenceNumber;
  const t = nowIso();
  const ids = scarIds.filter((id) => store.scar(id));
  // ordered from the start: its members follow the relations (the order of the clicks where they decide nothing)
  const q: Sequence = { id: uuid(), label: `Q${n}`, scarIds: ids, ordered: true, createdAt: t, modifiedAt: t };
  const before = store.state.sequences;
  const rest = structuredClone(before).map((x) => (x.scarIds.some((id) => ids.includes(id)) ? { ...x, scarIds: x.scarIds.filter((id) => !ids.includes(id)), modifiedAt: t } : x));
  store.history.execute(new SetSequencesCommand('cmd.addSequence', structuredClone(before), ordered(store.state, [...rest, q]), n + 1));
  return q;
}

export const deleteSequence = (store: ProjectStore, id: string): void =>
  changeSequences(store, 'cmd.deleteSequence', (list) => list.filter((q) => q.id !== id), null, true);

/** Rename a sequence, or order it within (its members then follow the relations). */
export function updateSequence(store: ProjectStore, id: string, patch: Partial<Pick<Sequence, 'label' | 'ordered'>>): void {
  const q = store.sequence(id);
  if (!q || Object.entries(patch).every(([k, v]) => q[k as keyof typeof patch] === v)) return;
  const key = 'label' in patch ? `sequence-label:${id}` : null;
  changeSequences(store, 'cmd.editSequence', (list) => list.map((q) => (q.id === id ? { ...q, ...patch, modifiedAt: nowIso() } : q)), key, 'ordered' in patch);
}

/** Move a sequence earlier (−1) or later (+1). */
export function moveSequence(store: ProjectStore, id: string, step: -1 | 1): void {
  changeSequences(store, 'cmd.editSequence', (list) => {
    const i = list.findIndex((q) => q.id === id);
    const j = i + step;
    if (i < 0 || j < 0 || j >= list.length) return list;
    [list[i], list[j]] = [list[j], list[i]];
    return list;
  });
}

/**
 * Put a scar at the end of a sequence (taking it out of any other), or out of
 * every sequence (null); the sequences then follow the relations (one undo step).
 */
export function setScarSequence(store: ProjectStore, scarId: string, sequenceId: string | null): void {
  if (!store.scar(scarId)) return;
  if (sequenceId && store.sequence(sequenceId)?.scarIds.includes(scarId)) return;
  changeSequences(
    store,
    'cmd.editSequence',
    (list) =>
      list.map((q) => {
        const ids = q.scarIds.filter((x) => x !== scarId);
        if (q.id === sequenceId) ids.push(scarId);
        return ids.length === q.scarIds.length && q.id !== sequenceId ? q : { ...q, scarIds: ids, modifiedAt: nowIso() };
      }),
    null,
    true,
  );
}

/** Move a scar earlier (−1) or later (+1) within its sequence. */
export function moveInSequence(store: ProjectStore, scarId: string, step: -1 | 1): void {
  changeSequences(store, 'cmd.editSequence', (list) =>
    list.map((q) => {
      const i = q.scarIds.indexOf(scarId);
      const j = i + step;
      if (i < 0 || j < 0 || j >= q.scarIds.length) return q;
      const ids = [...q.scarIds];
      [ids[i], ids[j]] = [ids[j], ids[i]];
      return { ...q, scarIds: ids, modifiedAt: nowIso() };
    }),
  );
}

// ---------------------------------------------------------------- landmarks

function changeLandmarks(store: ProjectStore, labelKey: string, change: (d: LandmarkData) => void, mergeKey: string | null = null): void {
  const before = landmarkData(store.state);
  const after = structuredClone(before);
  change(after);
  if (JSON.stringify(after) === JSON.stringify(before)) return;
  store.history.execute(new SetLandmarksCommand(labelKey, before, after, mergeKey));
}

const touch = <T extends { modifiedAt: string }>(x: T): T => Object.assign(x, { modifiedAt: nowIso() });

/** A new fixed landmark at the end of the list, named `name` or LM1, LM2, … */
export function addLandmark(store: ProjectStore, point: Vec3, name?: string): Landmark {
  const n = store.state.nextLandmarkNumber;
  const t = nowIso();
  const lm: Landmark = { id: uuid(), name: name ?? `LM${n}`, point: copy(point), createdAt: t, modifiedAt: t };
  changeLandmarks(store, 'cmd.addLandmark', (d) => {
    d.landmarks.push(structuredClone(lm));
    if (name === undefined) d.nextLandmarkNumber = n + 1;
  });
  return lm;
}

export const moveLandmark = (store: ProjectStore, id: string, point: Vec3): void =>
  changeLandmarks(store, 'cmd.moveLandmark', (d) => {
    const l = d.landmarks.find((x) => x.id === id);
    if (l && l.code !== 'pop' && JSON.stringify(l.point) !== JSON.stringify(point)) {
      touch(l).point = copy(point);
      // moved by hand, it stays where it was put
      delete l.auto;
    }
  });

export const renameLandmark = (store: ProjectStore, id: string, name: string): void =>
  changeLandmarks(store, 'cmd.renameLandmark', (d) => {
    const l = d.landmarks.find((x) => x.id === id);
    if (l && !l.code && l.name !== name) touch(l).name = name;
  }, `landmark-name:${id}`);

/** Move a landmark to position `index` of the list (the export order). */
export const reorderLandmark = (store: ProjectStore, id: string, index: number): void =>
  changeLandmarks(store, 'cmd.reorderLandmarks', (d) => {
    const i = d.landmarks.findIndex((x) => x.id === id);
    if (i < 0) return;
    const [l] = d.landmarks.splice(i, 1);
    d.landmarks.splice(Math.max(0, Math.min(index, d.landmarks.length)), 0, l);
  });

/** A landmark out of the list; semilandmark sets that ended at it run to the curve's end instead. */
function removeLandmark(d: LandmarkData, id: string): void {
  d.landmarks = d.landmarks.filter((x) => x.id !== id);
  for (const q of d.semilandmarks) {
    if (q.startLandmarkId === id) touch(q).startLandmarkId = null;
    if (q.endLandmarkId === id) touch(q).endLandmarkId = null;
  }
}

/**
 * Delete a landmark. The point of percussion goes only with the technical axis. A platform end that follows the curves
 * goes with them, and one moved by hand goes back to following them (it goes only if they have no place for it).
 */
export const deleteLandmark = (store: ProjectStore, id: string): void =>
  changeLandmarks(store, 'cmd.deleteLandmark', (d) => {
    const l = d.landmarks.find((x) => x.id === id);
    if (l?.code === 'pop' || l?.auto) return;
    if (l?.code !== 'platform_end' || store.state.specimen.type !== 'flake') return removeLandmark(d, id);
    touch(l).auto = true;
    syncPlatformEnds(d, store.state.curves);
  });

/** At most two platform ends: a third click moves the nearest of the two. */
export const MAX_PLATFORM_ENDS = 2;

/**
 * The platform ends that follow the curves, where the edge meets the outline. Those moved by hand (or in an earlier file) stay, and take the place
 * nearest them; what is left goes to the others, which keep their ids, so that what refers to them stays with them.
 */
function syncPlatformEnds(d: LandmarkData, curves: readonly Curve[]): void {
  let found = platformEndsOf(curves);
  const take = (from: Vec3): Vec3 | null => {
    if (!found.length) return null;
    const near = found.reduce((b, p) => (distance(p, from) < distance(b, from) ? p : b), found[0]);
    found = found.filter((p) => p !== near);
    return near;
  };
  const ends = d.landmarks.filter((l) => l.code === 'platform_end');
  const byHand = ends.filter((l) => !l.auto);
  for (const l of byHand) take(l.point);
  found = found.slice(0, Math.max(0, MAX_PLATFORM_ENDS - byHand.length));
  for (const l of ends.filter((x) => x.auto)) {
    const p = take(l.point);
    if (!p) removeLandmark(d, l.id);
    else if (JSON.stringify(l.point) !== JSON.stringify(p)) touch(l).point = copy(p);
  }
  const t = nowIso();
  for (const p of found) d.landmarks.push({ id: uuid(), name: 'platform_end', point: copy(p), code: 'platform_end', auto: true, createdAt: t, modifiedAt: t });
}

/** A flake read from a file: its ends as the curves say, for a file from before they did. */
export function withPlatformEnds(state: ProjectState): ProjectState {
  if (state.specimen.type !== 'flake') return state;
  const d = landmarkData(state);
  syncPlatformEnds(d, state.curves);
  return Object.assign(state, d);
}

/** A platform end at `point` (on the platform outline). */
export function placePlatformEnd(store: ProjectStore, point: Vec3): string {
  const ends = store.state.landmarks.filter((l) => l.code === 'platform_end');
  if (ends.length >= MAX_PLATFORM_ENDS) {
    const near = ends.reduce((b, l) => (distance(l.point, point) < distance(b.point, point) ? l : b), ends[0]);
    moveLandmark(store, near.id, point);
    return near.id;
  }
  const t = nowIso();
  const lm: Landmark = { id: uuid(), name: 'platform_end', point: copy(point), code: 'platform_end', createdAt: t, modifiedAt: t };
  changeLandmarks(store, 'cmd.addLandmark', (d) => void d.landmarks.push(structuredClone(lm)));
  return lm.id;
}

/** New curve semilandmarks on a curve (10 points by default). */
export function addSemilandmarkSet(store: ProjectStore, curveId: string, count = 10): SemilandmarkSet {
  const n = store.state.nextSemilandmarkNumber;
  const t = nowIso();
  const set: SemilandmarkSet = { id: uuid(), label: `SL${n}`, curveId, count, startLandmarkId: null, endLandmarkId: null, createdAt: t, modifiedAt: t };
  changeLandmarks(store, 'cmd.addSemilandmarks', (d) => {
    d.semilandmarks.push(structuredClone(set));
    d.nextSemilandmarkNumber = n + 1;
  });
  return set;
}

export function updateSemilandmarkSet(store: ProjectStore, id: string, patch: Partial<Pick<SemilandmarkSet, 'curveId' | 'count' | 'startLandmarkId' | 'endLandmarkId'>>): void {
  const count = patch.count;
  if (count !== undefined && !(Number.isInteger(count) && count >= 1)) return;
  changeLandmarks(store, 'cmd.editSemilandmarks', (d) => {
    const q = d.semilandmarks.find((x) => x.id === id);
    if (q && Object.entries(patch).some(([k, v]) => q[k as keyof typeof patch] !== v)) Object.assign(touch(q), patch);
  }, 'count' in patch ? `semi-count:${id}` : null);
}

export const deleteSemilandmarkSet = (store: ProjectStore, id: string): void =>
  changeLandmarks(store, 'cmd.deleteSemilandmarks', (d) => {
    d.semilandmarks = d.semilandmarks.filter((x) => x.id !== id);
  });

/** Split the volume by a plane or a closed curve (null: no split); `upHint` orients a curve's normal. */
export function setSplit(store: ProjectStore, split: ProjectState['split']): void {
  const before = store.state.split;
  if (JSON.stringify(before) === JSON.stringify(split)) return;
  store.history.execute(new SetSplitCommand(structuredClone(before), structuredClone(split)));
}

/** Use (or leave out) a cortex region in the nodule sphere fit. */
export function setNoduleRegion(store: ProjectStore, regionId: string, used: boolean): void {
  const before = store.state.nodule;
  const exclude = before.exclude.filter((id) => id !== regionId);
  if (!used) exclude.push(regionId);
  if (exclude.length === before.exclude.length && exclude.every((x) => before.exclude.includes(x))) return;
  store.history.execute(new SetNoduleCommand(structuredClone(before), { ...before, exclude }));
}

export function setNoduleShown(store: ProjectStore, show: boolean): void {
  const before = store.state.nodule;
  if (before.show === show) return;
  store.history.execute(new SetNoduleCommand(structuredClone(before), { ...before, show }));
}

// ---------------------------------------------------------------- specimen

/**
 * `merge`: quick successive edits of the same fields become one undo step (typing, dragging a
 * slider). A new orientation (also setting or clearing the frame) clears the configuration's
 * corrections by face in the same step; true when it did.
 */
export function updateSpecimen(store: ProjectStore, patch: Partial<SpecimenInfo>, merge = true): boolean {
  const before = store.state.specimen;
  const after = { ...structuredClone(before), ...patch };
  if (JSON.stringify(before) === JSON.stringify(after)) return false;
  const key = Object.keys(patch).sort().join(',');
  const turned = JSON.stringify(before.frame?.matrix ?? null) !== JSON.stringify(after.frame?.matrix ?? null);
  const corrections = store.state.configuration;
  // the polarity, the model and the bicone's corrections (by side of the split curve, not by face) stay;
  // a flake's frame is not the one the corrections name faces of (see setSpecimenType)
  const config = turned && before.type !== 'flake' && hasFaceCorrections(corrections)
    ? { before: structuredClone(corrections), after: { ...emptyCorrections(), polarity: corrections.polarity, model: corrections.model, bicone: structuredClone(corrections.bicone) } }
    : null;
  store.history.execute(new SetSpecimenCommand(structuredClone(before), after, merge ? `specimen:${key}` : null, config));
  return !!config;
}

/**
 * Switch the type of specimen. Nothing is deleted: a flake keeps its own frame and the other types share theirs (the one
 * not in use waits in `flake.otherFrame`), so the core's corrections by face stay right when it comes back.
 */
export function setSpecimenType(store: ProjectStore, type: SpecimenType): void {
  const before = store.state.specimen;
  if (before.type === type) return;
  if (before.type !== 'flake' && type !== 'flake') {
    store.history.execute(new SetSpecimenCommand(structuredClone(before), { ...structuredClone(before), type }));
    return;
  }
  const flake = store.state.flake;
  store.history.execute(
    new CompoundCommand('cmd.editSpecimen', [
      new SetFlakeCommand('cmd.editSpecimen', structuredClone(flake), { ...structuredClone(flake), otherFrame: structuredClone(before.frame) }),
      new SetSpecimenCommand(structuredClone(before), { ...structuredClone(before), type, frame: structuredClone(flake.otherFrame) }),
      ...endChanges(store, store.state.curves, 'cmd.editSpecimen', type),
    ]),
  );
}

/** What counts as a sharp edge. */
export function setSharpEdge(store: ProjectStore, change: Partial<SharpEdgeRule>): void {
  const before = store.state.sharpEdge;
  const after = { ...before, ...change };
  if (after.method === before.method && after.distance === before.distance && after.threshold === before.threshold) return;
  store.history.execute(new SetSharpEdgeCommand({ ...before }, after));
}

/** Which points a flake has for geometric morphometrics; no annotation changes with it. */
export function setGmConfig(store: ProjectStore, change: Partial<GmConfig>): void {
  const before = store.state.gm;
  const after = { ...structuredClone(before), ...structuredClone(change) };
  if (JSON.stringify(after) === JSON.stringify(before)) return;
  store.history.execute(new SetGmConfigCommand(structuredClone(before), after));
}

// ---------------------------------------------------------------- retouch indices

/** A flake's settings of the retouch indices; one undo step, none when nothing changes. */
function setRetouchSettings(store: ProjectStore, change: Partial<RetouchSettings>): void {
  const flake = store.state.flake;
  const before = retouchSettingsOf(flake);
  const after = { ...before, ...change };
  if (after.fitLength === before.fitLength && after.axis === before.axis && after.flip === before.flip) return;
  const next = structuredClone(flake);
  if (after.fitLength === null && after.axis === 'auto' && !after.flip) delete next.retouch;
  else next.retouch = after;
  store.history.execute(new SetFlakeCommand('cmd.retouchSettings', structuredClone(flake), next));
}

/** The length of section the original surface lines are fitted to, in mm (null: the default); out of range, the nearest in it. */
export function setRetouchFitLength(store: ProjectStore, value: number | null): void {
  setRetouchSettings(store, { fitLength: value === null ? null : clampFitLength(value) });
}

/** The frame the retouch indices are laid out on. */
export function setRetouchAxis(store: ProjectStore, axis: RetouchAxisChoice): void {
  setRetouchSettings(store, { axis });
}

/** The longest axis the other way round. */
export function setRetouchFlip(store: ProjectStore, flip: boolean): void {
  setRetouchSettings(store, { flip });
}

// ---------------------------------------------------------------- technical axis

/** The frame source of a frame made from the technical axis. */
export const TECHNICAL_FRAME = 'technical_axis';

const isTechnicalFrame = (f: SpecimenFrame | null): boolean => !!f && f.source.startsWith(TECHNICAL_FRAME);

const roundedMatrix = (m: readonly number[]): number[] => m.map((x) => Math.round(x * 1e9) / 1e9);

export interface NewAxisInput {
  start: Vec3;
  end: Vec3;
  startNormal: Vec3;
  endNormal: Vec3;
  matrix: number[] | null;
  failure: TechnicalAxis['failure'];
}

/**
 * Draw (or replace, or move an end of) the technical axis, in one undo step: the axis, the point of
 * percussion at its start, and the specimen frame from it — back to none when no frame could be made.
 */
export function setTechnicalAxis(store: ProjectStore, input: NewAxisInput): TechnicalAxis {
  const st = store.state;
  const t = nowIso();
  const old = st.flake.axis;
  const axis: TechnicalAxis = {
    id: old?.id ?? uuid(),
    start: copy(input.start),
    end: copy(input.end),
    startNormal: copy(input.startNormal),
    endNormal: copy(input.endNormal),
    matrix: input.matrix ? roundedMatrix(input.matrix) : null,
    failure: input.failure,
    createdAt: old?.createdAt ?? t,
    modifiedAt: t,
  };
  const parts: Command[] = [new SetFlakeCommand('cmd.setAxis', structuredClone(st.flake), { ...structuredClone(st.flake), axis })];
  const lmBefore = landmarkData(st);
  const lmAfter = structuredClone(lmBefore);
  const pop = lmAfter.landmarks.find((l) => l.code === 'pop');
  if (pop) touch(pop).point = copy(input.start);
  else lmAfter.landmarks.unshift({ id: uuid(), name: 'pop', point: copy(input.start), code: 'pop', createdAt: t, modifiedAt: t });
  parts.push(new SetLandmarksCommand('cmd.setAxis', lmBefore, lmAfter));
  parts.push(...autoRegionChanges(store, { curves: st.curves, axis }, input.start));
  const before = st.specimen;
  const frame: SpecimenFrame | null = axis.matrix ? { matrix: [...axis.matrix], source: TECHNICAL_FRAME } : isTechnicalFrame(before.frame) ? null : before.frame;
  if (JSON.stringify(frame) !== JSON.stringify(before.frame)) parts.push(new SetSpecimenCommand(structuredClone(before), { ...structuredClone(before), frame: structuredClone(frame) }));
  store.history.execute(new CompoundCommand('cmd.setAxis', parts));
  return axis;
}

/** Delete the technical axis with the point of percussion; the frame made from it goes too (back to the principal axes). */
export function deleteTechnicalAxis(store: ProjectStore): void {
  const st = store.state;
  if (!st.flake.axis) return;
  const parts: Command[] = [new SetFlakeCommand('cmd.deleteAxis', structuredClone(st.flake), { ...structuredClone(st.flake), axis: null })];
  const lmBefore = landmarkData(st);
  const lmAfter = structuredClone(lmBefore);
  const pop = lmAfter.landmarks.find((l) => l.code === 'pop');
  if (pop) {
    lmAfter.landmarks = lmAfter.landmarks.filter((l) => l !== pop);
    for (const q of lmAfter.semilandmarks) {
      if (q.startLandmarkId === pop.id) touch(q).startLandmarkId = null;
      if (q.endLandmarkId === pop.id) touch(q).endLandmarkId = null;
    }
    parts.push(new SetLandmarksCommand('cmd.deleteAxis', lmBefore, lmAfter));
  }
  parts.push(...autoRegionChanges(store, { curves: st.curves, axis: null }, st.flake.axis.start));
  if (isTechnicalFrame(st.specimen.frame)) parts.push(new SetSpecimenCommand(structuredClone(st.specimen), { ...structuredClone(st.specimen), frame: null }));
  store.history.execute(new CompoundCommand('cmd.deleteAxis', parts));
}

// ---------------------------------------------------------------- volumetric configuration

function changeConfiguration(store: ProjectStore, edit: (c: ConfigCorrections) => void): void {
  const before = store.state.configuration;
  const after = structuredClone(before) as ConfigCorrections;
  edit(after);
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  store.history.execute(new SetConfigurationCommand('cmd.editConfiguration', structuredClone(before), after));
}

/** The role of a face (null: back to the automatic one). */
export const setConfigRole = (store: ProjectStore, face: ConfigFace, role: ConfigRole | null): void =>
  changeConfiguration(store, (c) => {
    if (role === null) delete c.roles[face];
    else c.roles[face] = role;
  });

/** Whether two adjacent flaking faces are one flaking surface (null: automatic). */
export const setConfigJoin = (store: ProjectStore, a: ConfigFace, b: ConfigFace, joined: boolean | null): void =>
  changeConfiguration(store, (c) => {
    if (joined === null) delete c.joins[joinKey(a, b)];
    else c.joins[joinKey(a, b)] = joined;
  });

/** Wide or narrow (null: automatic), written to every face of the face's flaking surface (`surface`). */
export const setConfigSurfaceType = (store: ProjectStore, face: ConfigFace, type: 'wide' | 'narrow' | null, surface: readonly ConfigFace[] = [face]): void =>
  changeConfiguration(store, (c) => {
    for (const f of new Set([face, ...surface])) {
      if (type === null) delete c.surfaceType[f];
      else c.surfaceType[f] = type;
    }
  });

/** Long or short exploitation axis (null: automatic), written like the surface type. */
export const setConfigAxis = (store: ProjectStore, face: ConfigFace, axis: 'long' | 'short' | null, surface: readonly ConfigFace[] = [face]): void =>
  changeConfiguration(store, (c) => {
    for (const f of new Set([face, ...surface])) {
      if (axis === null) delete c.axis[f];
      else c.axis[f] = axis;
    }
  });

/**
 * Back to the automatic values of a face: its role, the surface type and axis
 * (on every face of its flaking surface, `surface`, where they were written
 * together) and the joins with it.
 */
export const resetConfigFace = (store: ProjectStore, face: ConfigFace, surface: readonly ConfigFace[] = [face]): void =>
  changeConfiguration(store, (c) => {
    delete c.roles[face];
    for (const f of new Set([face, ...surface])) {
      delete c.surfaceType[f];
      delete c.axis[f];
    }
    for (const k of Object.keys(c.joins)) if (k.split('|').includes(face)) delete c.joins[k];
  });

/** The overall polarity (null: automatic). */
export const setConfigPolarity = (store: ProjectStore, polarity: Polarity | null): void =>
  changeConfiguration(store, (c) => {
    c.polarity = polarity;
  });

/** The model of the configuration: the box or the bicone on the split curve. */
export const setConfigModel = (store: ProjectStore, model: ConfigModel): void =>
  changeConfiguration(store, (c) => {
    c.model = model;
  });

/** The role of one of the bicone's cones, by its physical side (null: back to the automatic one). */
export const setBiconeRole = (store: ProjectStore, side: BiconeSide, role: BiconeRole | null): void =>
  changeConfiguration(store, (c) => {
    if (role === null) delete c.bicone.roles[side];
    else c.bicone.roles[side] = role;
  });

/** Split the volume along a closed curve and use the bicone on it, in one step that undo takes back whole. */
export function setBiconeSplit(store: ProjectStore, split: NonNullable<ProjectState['split']>): void {
  const before = store.state.configuration;
  const after = { ...(structuredClone(before) as ConfigCorrections), model: 'bicone' as const };
  store.history.execute(
    new CompoundCommand('cmd.useBicone', [
      new SetSplitCommand(structuredClone(store.state.split), structuredClone(split)),
      new SetConfigurationCommand('cmd.editConfiguration', structuredClone(before), after),
    ]),
  );
}

/** Exchange the upper and lower side of the volume split (also the bicone's cones). */
export function swapSplit(store: ProjectStore): void {
  const sp = store.state.split;
  if (sp) setSplit(store, { ...sp, swap: !sp.swap });
}

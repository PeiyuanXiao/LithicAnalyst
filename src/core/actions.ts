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
  SetNoduleCommand,
  SetRelationsCommand,
  SetSequencesCommand,
  SetSplitCommand,
  SetSpecimenCommand,
  UpdateCurveCommand,
  UpdatePlaneCommand,
  UpdateRegionCommand,
  UpdateSectionCommand,
  UpdateScarCommand,
  type Command,
} from './commands';
import type { CurveShape } from './curveGeometry';
import { curveFieldByKey, defaultAttributes, defaultCurveAttributes, fieldByKey } from './fields';
import { curveLabelForNumber, labelForNumber, nowIso, uuid } from './ids';
import type { ProjectStore } from './store';
import type { AttributeValue, Curve, Measurement, MeasureType, Plane, PlaneMethod, ProjectState, Region, RegionType, Relation, RelationKind, Scar, ScarWithVector, Section, Sequence, SpecimenInfo, Vec3 } from './types';
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

export function setScarAttribute(store: ProjectStore, id: string, key: string, value: AttributeValue): void {
  const a = store.scar(id);
  if (!a || a.attributes[key] === value) return;
  const isText = fieldByKey(key)?.type === 'text';
  update(store, id, 'cmd.editField', (x) => {
    x.attributes[key] = value;
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

export function addCurve(store: ProjectStore, input: NewCurveInput): Curve {
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
  store.history.execute(new AddCurveCommand(curve, input.label ? null : n));
  return curve;
}

export function deleteCurve(store: ProjectStore, id: string): void {
  if (!store.curve(id)) return;
  store.history.execute(new DeleteCurveCommand(id));
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

/** Replace the traced geometry (after moving an anchor). */
export function setCurveShape(store: ProjectStore, id: string, shape: CurveShape): void {
  updateCurve(store, id, 'cmd.editCurve', (c) => Object.assign(c, copyShape(shape)));
}

export function setCurveAttribute(store: ProjectStore, id: string, key: string, value: AttributeValue): void {
  const c = store.curve(id);
  if (!c || c.attributes[key] === value) return;
  const isText = curveFieldByKey(key)?.type === 'text';
  updateCurve(store, id, 'cmd.editField', (x) => {
    x.attributes[key] = value;
  }, isText ? `curve-attr:${key}:${id}` : null);
}

export function setCurveLabel(store: ProjectStore, id: string, label: string): void {
  const c = store.curve(id);
  if (!c || c.label === label) return;
  updateCurve(store, id, 'cmd.renameCurve', (x) => {
    x.label = label;
  }, `curve-label:${id}`);
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
  if (type === 'scar' && !linked) {
    const s = newAreaScar(store);
    parts.push(s.command);
    linked = s.scar.id;
  }
  const region: Region = { id: uuid(), label: `R${n}`, seed: copy(seed), type, scarId: type === 'scar' ? linked : null, createdAt: t, modifiedAt: t };
  parts.push(new AddRegionCommand(region, n));
  store.history.execute(parts.length === 1 ? parts[0] : new CompoundCommand('cmd.addRegion', parts));
  return region;
}

/** The scar created for a region (no direction) is removed with it when nothing else uses it. */
function dropAreaScar(store: ProjectStore, region: Region): Command[] {
  const scar = region.scarId ? store.scar(region.scarId) : undefined;
  if (!scar || scar.vector) return [];
  if (store.state.regions.some((r) => r.id !== region.id && r.scarId === scar.id)) return [];
  return deleteScarCommands(store, scar.id);
}

/** Change a region's type; becoming a scar links it to `scarId` or to a new scar without a direction. */
export function setRegionType(store: ProjectStore, id: string, type: RegionType, scarId: string | null): void {
  const before = store.region(id);
  if (!before || before.type === type) return;
  const parts: Command[] = [];
  let linked = scarId ?? before.scarId;
  if (type === 'scar' && !linked) {
    const s = newAreaScar(store);
    parts.push(s.command);
    linked = s.scar.id;
  }
  const after: Region = { ...structuredClone(before), type, scarId: type === 'scar' ? linked : null, modifiedAt: nowIso() };
  parts.push(new UpdateRegionCommand(structuredClone(before), after));
  if (type !== 'scar') parts.push(...dropAreaScar(store, before));
  store.history.execute(parts.length === 1 ? parts[0] : new CompoundCommand('cmd.editRegion', parts));
}

export function deleteRegion(store: ProjectStore, id: string): void {
  const r = store.region(id);
  if (!r) return;
  const drop = dropAreaScar(store, r);
  store.history.execute(drop.length ? new CompoundCommand('cmd.deleteRegion', [new DeleteRegionCommand(id), ...drop]) : new DeleteRegionCommand(id));
}

// ---------------------------------------------------------------- relations and sequences

/** The relation recorded for a pair of scars (either way round), if any. */
export const relationBetween = (state: Readonly<ProjectState>, x: string, y: string): Relation | undefined =>
  state.relations.find((r) => (r.a === x && r.b === y) || (r.a === y && r.b === x));

/** Record "a cuts b" or "cannot tell" for a pair of scars, replacing what was recorded for the pair. */
export function setRelation(store: ProjectStore, a: string, b: string, kind: RelationKind): Relation | null {
  if (a === b || !store.scar(a) || !store.scar(b)) return null;
  const before = store.state.relations;
  const old = relationBetween(store.state, a, b);
  if (old && old.kind === kind && (kind === 'indeterminate' || old.a === a)) return old;
  const t = nowIso();
  const rel: Relation = old ? { ...structuredClone(old), a, b, kind, modifiedAt: t } : { id: uuid(), a, b, kind, createdAt: t, modifiedAt: t };
  const after = old ? before.map((r) => (r.id === old.id ? rel : structuredClone(r))) : [...structuredClone(before), rel];
  store.history.execute(new SetRelationsCommand(old ? 'cmd.editRelation' : 'cmd.addRelation', structuredClone(before), after));
  return rel;
}

export function deleteRelation(store: ProjectStore, id: string): void {
  const before = store.state.relations;
  if (!before.some((r) => r.id === id)) return;
  store.history.execute(new SetRelationsCommand('cmd.deleteRelation', structuredClone(before), structuredClone(before.filter((r) => r.id !== id))));
}

function changeSequences(store: ProjectStore, labelKey: string, change: (list: Sequence[]) => Sequence[], mergeKey: string | null = null): void {
  const before = store.state.sequences;
  const after = change(structuredClone(before));
  if (JSON.stringify(after) === JSON.stringify(before)) return;
  store.history.execute(new SetSequencesCommand(labelKey, structuredClone(before), after, null, mergeKey));
}

/** A new, empty sequence after (later than) the others. */
export function addSequence(store: ProjectStore): Sequence {
  const n = store.state.nextSequenceNumber;
  const t = nowIso();
  const q: Sequence = { id: uuid(), label: `Q${n}`, scarIds: [], ordered: false, createdAt: t, modifiedAt: t };
  const before = store.state.sequences;
  store.history.execute(new SetSequencesCommand('cmd.addSequence', structuredClone(before), [...structuredClone(before), q], n + 1));
  return q;
}

export const deleteSequence = (store: ProjectStore, id: string): void =>
  changeSequences(store, 'cmd.deleteSequence', (list) => list.filter((q) => q.id !== id));

export function updateSequence(store: ProjectStore, id: string, patch: Partial<Pick<Sequence, 'label' | 'ordered'>>): void {
  const q = store.sequence(id);
  if (!q || Object.entries(patch).every(([k, v]) => q[k as keyof typeof patch] === v)) return;
  const key = 'label' in patch ? `sequence-label:${id}` : null;
  changeSequences(store, 'cmd.editSequence', (list) => list.map((q) => (q.id === id ? { ...q, ...patch, modifiedAt: nowIso() } : q)), key);
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

/** Put a scar at the end of a sequence (taking it out of any other), or out of every sequence (null). */
export function setScarSequence(store: ProjectStore, scarId: string, sequenceId: string | null): void {
  if (!store.scar(scarId)) return;
  if (sequenceId && store.sequence(sequenceId)?.scarIds.includes(scarId)) return;
  changeSequences(store, 'cmd.editSequence', (list) =>
    list.map((q) => {
      const ids = q.scarIds.filter((x) => x !== scarId);
      if (q.id === sequenceId) ids.push(scarId);
      return ids.length === q.scarIds.length && q.id !== sequenceId ? q : { ...q, scarIds: ids, modifiedAt: nowIso() };
    }),
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

/** `merge`: quick successive edits of the same fields become one undo step (typing, dragging a slider). */
export function updateSpecimen(store: ProjectStore, patch: Partial<SpecimenInfo>, merge = true): void {
  const before = store.state.specimen;
  const after = { ...structuredClone(before), ...patch };
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const key = Object.keys(patch).sort().join(',');
  store.history.execute(new SetSpecimenCommand(structuredClone(before), after, merge ? `specimen:${key}` : null));
}

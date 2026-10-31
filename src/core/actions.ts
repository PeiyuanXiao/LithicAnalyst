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
  SetLandmarksCommand,
  SetNoduleCommand,
  SetRelationsCommand,
  SetConfigurationCommand,
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
import { emptyCorrections, hasFaceCorrections, joinKey } from '../compute/configuration';
import { orderSequences, relationInputs } from '../compute/relations';
import { curveFieldByKey, defaultAttributes, defaultCurveAttributes, fieldByKey, withAttribute, type ConfigFace, type ConfigRole, type Polarity } from './fields';
import { curveLabelForNumber, labelForNumber, nowIso, uuid } from './ids';
import { landmarkData, type LandmarkData, type ProjectStore } from './store';
import type { AttributeValue, ConfigCorrections, Curve, Landmark, Measurement, MeasureType, Plane, PlaneMethod, ProjectState, Region, RegionType, Relation, RelationKind, Scar, ScarWithVector, Section, SemilandmarkSet, Sequence, SpecimenInfo, Vec3 } from './types';
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
    if (l && JSON.stringify(l.point) !== JSON.stringify(point)) touch(l).point = copy(point);
  });

export const renameLandmark = (store: ProjectStore, id: string, name: string): void =>
  changeLandmarks(store, 'cmd.renameLandmark', (d) => {
    const l = d.landmarks.find((x) => x.id === id);
    if (l && l.name !== name) touch(l).name = name;
  }, `landmark-name:${id}`);

/** Move a landmark to position `index` of the list (the export order). */
export const reorderLandmark = (store: ProjectStore, id: string, index: number): void =>
  changeLandmarks(store, 'cmd.reorderLandmarks', (d) => {
    const i = d.landmarks.findIndex((x) => x.id === id);
    if (i < 0) return;
    const [l] = d.landmarks.splice(i, 1);
    d.landmarks.splice(Math.max(0, Math.min(index, d.landmarks.length)), 0, l);
  });

/** Delete a landmark; semilandmark sets that ended at it run to the curve's end instead. */
export const deleteLandmark = (store: ProjectStore, id: string): void =>
  changeLandmarks(store, 'cmd.deleteLandmark', (d) => {
    d.landmarks = d.landmarks.filter((x) => x.id !== id);
    for (const q of d.semilandmarks) {
      if (q.startLandmarkId === id) touch(q).startLandmarkId = null;
      if (q.endLandmarkId === id) touch(q).endLandmarkId = null;
    }
  });

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
  const config = turned && hasFaceCorrections(corrections) ? { before: structuredClone(corrections), after: { ...emptyCorrections(), polarity: corrections.polarity } } : null;
  store.history.execute(new SetSpecimenCommand(structuredClone(before), after, merge ? `specimen:${key}` : null, config));
  return !!config;
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

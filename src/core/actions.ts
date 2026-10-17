import {
  AddCurveCommand,
  AddMeasurementCommand,
  AddPlaneCommand,
  AddSectionCommand,
  AddScarCommand,
  DeleteCurveCommand,
  DeleteMeasurementCommand,
  DeletePlaneCommand,
  DeleteSectionCommand,
  DeleteScarCommand,
  SetSpecimenCommand,
  UpdateCurveCommand,
  UpdatePlaneCommand,
  UpdateSectionCommand,
  UpdateScarCommand,
} from './commands';
import type { CurveShape } from './curveGeometry';
import { curveFieldByKey, defaultAttributes, defaultCurveAttributes, fieldByKey } from './fields';
import { curveLabelForNumber, labelForNumber, nowIso, uuid } from './ids';
import type { ProjectStore } from './store';
import type { AttributeValue, Curve, Measurement, MeasureType, Plane, PlaneMethod, Scar, ScarWithVector, Section, SpecimenInfo, Vec3 } from './types';
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

export function deleteScar(store: ProjectStore, id: string): void {
  if (!store.scar(id)) return;
  store.history.execute(new DeleteScarCommand(id));
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

// ---------------------------------------------------------------- specimen

/** `merge`: quick successive edits of the same fields become one undo step (typing, dragging a slider). */
export function updateSpecimen(store: ProjectStore, patch: Partial<SpecimenInfo>, merge = true): void {
  const before = store.state.specimen;
  const after = { ...structuredClone(before), ...patch };
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const key = Object.keys(patch).sort().join(',');
  store.history.execute(new SetSpecimenCommand(structuredClone(before), after, merge ? `specimen:${key}` : null));
}

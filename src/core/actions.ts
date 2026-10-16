import {
  AddArrowCommand,
  AddCurveCommand,
  DeleteArrowCommand,
  DeleteCurveCommand,
  SetSpecimenCommand,
  UpdateArrowCommand,
  UpdateCurveCommand,
} from './commands';
import type { CurveShape } from './curveGeometry';
import { curveFieldByKey, defaultAttributes, defaultCurveAttributes, fieldByKey } from './fields';
import { curveLabelForNumber, labelForNumber, nowIso, uuid } from './ids';
import type { ProjectStore } from './store';
import type { AttributeValue, Curve, ScarVector, SpecimenInfo, Vec3 } from './types';
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

export function addScarVector(store: ProjectStore, input: NewArrowInput): ScarVector {
  const n = store.state.nextLabelNumber;
  const t = nowIso();
  const arrow: ScarVector = {
    id: uuid(),
    label: input.label ?? labelForNumber(n),
    start: copy(input.start),
    end: copy(input.end),
    startNormal: copy(input.startNormal),
    endNormal: copy(input.endNormal),
    attributes: { ...defaultAttributes(), ...(input.attributes ?? {}) },
    createdAt: t,
    modifiedAt: t,
  };
  store.history.execute(new AddArrowCommand(arrow, input.label ? null : n));
  return arrow;
}

export function deleteScarVector(store: ProjectStore, id: string): void {
  if (!store.arrow(id)) return;
  store.history.execute(new DeleteArrowCommand(id));
}

function update(
  store: ProjectStore,
  id: string,
  labelKey: string,
  change: (a: ScarVector) => void,
  mergeKey: string | null = null,
): void {
  const before = store.arrow(id);
  if (!before) return;
  const after = structuredClone(before);
  change(after);
  after.modifiedAt = nowIso();
  store.history.execute(new UpdateArrowCommand(labelKey, structuredClone(before), after, mergeKey));
}

export function moveEndpoint(
  store: ProjectStore,
  id: string,
  which: 'start' | 'end',
  point: Vec3,
  normal: Vec3,
): void {
  const a = store.arrow(id);
  if (!a) return;
  const other = which === 'start' ? a.end : a.start;
  if (distance(point, other) === 0) return;
  update(store, id, 'cmd.moveEndpoint', (x) => {
    if (which === 'start') {
      x.start = copy(point);
      x.startNormal = copy(normal);
    } else {
      x.end = copy(point);
      x.endNormal = copy(normal);
    }
  });
}

export function setScarAttribute(store: ProjectStore, id: string, key: string, value: AttributeValue): void {
  const a = store.arrow(id);
  if (!a || a.attributes[key] === value) return;
  const isText = fieldByKey(key)?.type === 'text';
  update(store, id, 'cmd.editField', (x) => {
    x.attributes[key] = value;
  }, isText ? `attr:${key}:${id}` : null);
}

export function setScarLabel(store: ProjectStore, id: string, label: string): void {
  const a = store.arrow(id);
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

// ---------------------------------------------------------------- specimen

export function updateSpecimen(store: ProjectStore, patch: Partial<SpecimenInfo>): void {
  const before = store.state.specimen;
  const after = { ...before, ...patch };
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const key = Object.keys(patch).sort().join(',');
  store.history.execute(new SetSpecimenCommand({ ...before }, after, `specimen:${key}`));
}

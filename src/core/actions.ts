import { AddArrowCommand, DeleteArrowCommand, SetSpecimenCommand, UpdateArrowCommand } from './commands';
import { defaultAttributes, fieldByKey } from './fields';
import { labelForNumber, nowIso, uuid } from './ids';
import type { ProjectStore } from './store';
import type { AttributeValue, ScarVector, SpecimenInfo, Vec3 } from './types';
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

export function updateSpecimen(store: ProjectStore, patch: Partial<SpecimenInfo>): void {
  const before = store.state.specimen;
  const after = { ...before, ...patch };
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const key = Object.keys(patch).sort().join(',');
  store.history.execute(new SetSpecimenCommand({ ...before }, after, `specimen:${key}`));
}

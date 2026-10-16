import { CommandHistory } from './commands';
import { nowIso } from './ids';
import type { Curve, MeshInfo, ProjectState, ScarVector, SpecimenInfo } from './types';
import { distance } from './vec';

export type ChangeKind = 'arrows' | 'curves' | 'specimen' | 'reset';

export interface Change {
  kind: ChangeKind;
  ids?: string[];
}

export function emptyProject(): ProjectState {
  const t = nowIso();
  return {
    specimen: { id: '', annotator: '', unit: 'mm', notes: '' },
    mesh: null,
    scarVectors: [],
    curves: [],
    nextLabelNumber: 1,
    nextCurveNumber: 1,
    createdAt: t,
    modifiedAt: t,
  };
}

export const arrowLength = (a: ScarVector): number => distance(a.start, a.end);

/**
 * Holds the project state. Mutating methods prefixed with "_" are for
 * Commands only; everything else should call the actions in actions.ts so the
 * change lands in the undo history.
 */
export class ProjectStore {
  private _state: ProjectState;
  private listeners = new Set<(c: Change) => void>();
  readonly history: CommandHistory;

  constructor(initial?: ProjectState) {
    this._state = initial ?? emptyProject();
    this.history = new CommandHistory(this);
  }

  get state(): Readonly<ProjectState> {
    return this._state;
  }

  subscribe(fn: (c: Change) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(change: Change, touch = true): void {
    if (touch) this._state.modifiedAt = nowIso();
    for (const fn of this.listeners) fn(change);
  }

  arrow(id: string): ScarVector | undefined {
    return this._state.scarVectors.find((a) => a.id === id);
  }

  curve(id: string): Curve | undefined {
    return this._state.curves.find((c) => c.id === id);
  }

  /** Replace the whole project (new mesh, loaded project file). Clears history. */
  reset(state: ProjectState): void {
    this._state = state;
    this.history.clear();
    this.notify({ kind: 'reset' }, false);
  }

  setMesh(mesh: MeshInfo | null): void {
    this._state.mesh = mesh;
  }

  // ---- internal mutations used by commands ----

  _insertArrow(a: ScarVector, index?: number): void {
    const list = this._state.scarVectors;
    if (index === undefined || index < 0 || index > list.length) list.push(a);
    else list.splice(index, 0, a);
  }

  _removeArrow(id: string): { arrow: ScarVector; index: number } | null {
    const list = this._state.scarVectors;
    const index = list.findIndex((a) => a.id === id);
    if (index < 0) return null;
    const [arrow] = list.splice(index, 1);
    return { arrow, index };
  }

  _putArrow(a: ScarVector): void {
    const list = this._state.scarVectors;
    const index = list.findIndex((x) => x.id === a.id);
    if (index >= 0) list[index] = a;
  }

  _insertCurve(c: Curve, index?: number): void {
    const list = this._state.curves;
    if (index === undefined || index < 0 || index > list.length) list.push(c);
    else list.splice(index, 0, c);
  }

  _removeCurve(id: string): { curve: Curve; index: number } | null {
    const list = this._state.curves;
    const index = list.findIndex((c) => c.id === id);
    if (index < 0) return null;
    const [curve] = list.splice(index, 1);
    return { curve, index };
  }

  _putCurve(c: Curve): void {
    const list = this._state.curves;
    const index = list.findIndex((x) => x.id === c.id);
    if (index >= 0) list[index] = c;
  }

  _setSpecimen(s: SpecimenInfo): void {
    this._state.specimen = s;
  }

  _setNextLabelNumber(n: number): void {
    this._state.nextLabelNumber = n;
  }

  _setNextCurveNumber(n: number): void {
    this._state.nextCurveNumber = n;
  }
}

import { CommandHistory } from './commands';
import { nowIso } from './ids';
import type { Curve, Measurement, MeshInfo, Plane, ProjectState, Region, Relation, Scar, ScarVector, Section, Sequence, SpecimenInfo } from './types';
import { distance } from './vec';

export type ChangeKind = 'scars' | 'curves' | 'measurements' | 'planes' | 'sections' | 'regions' | 'relations' | 'sequences' | 'nodule' | 'split' | 'specimen' | 'reset';

export interface Change {
  kind: ChangeKind;
  ids?: string[];
}

export function emptyProject(): ProjectState {
  const t = nowIso();
  return {
    specimen: { id: '', annotator: '', unit: 'mm', notes: '', frame: null },
    mesh: null,
    scars: [],
    curves: [],
    measurements: [],
    planes: [],
    sections: [],
    regions: [],
    relations: [],
    sequences: [],
    nodule: { exclude: [], show: false },
    split: null,
    nextLabelNumber: 1,
    nextCurveNumber: 1,
    nextMeasureNumber: 1,
    nextPlaneNumber: 1,
    nextSectionNumber: 1,
    nextRegionNumber: 1,
    nextSequenceNumber: 1,
    createdAt: t,
    modifiedAt: t,
  };
}

export const vectorLength = (v: ScarVector): number => distance(v.start, v.end);

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

  scar(id: string): Scar | undefined {
    return this._state.scars.find((a) => a.id === id);
  }

  curve(id: string): Curve | undefined {
    return this._state.curves.find((c) => c.id === id);
  }

  measurement(id: string): Measurement | undefined {
    return this._state.measurements.find((m) => m.id === id);
  }

  plane(id: string): Plane | undefined {
    return this._state.planes.find((p) => p.id === id);
  }

  section(id: string): Section | undefined {
    return this._state.sections.find((s) => s.id === id);
  }

  region(id: string): Region | undefined {
    return this._state.regions.find((r) => r.id === id);
  }

  relation(id: string): Relation | undefined {
    return this._state.relations.find((r) => r.id === id);
  }

  sequence(id: string): Sequence | undefined {
    return this._state.sequences.find((q) => q.id === id);
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

  _insertScar(a: Scar, index?: number): void {
    const list = this._state.scars;
    if (index === undefined || index < 0 || index > list.length) list.push(a);
    else list.splice(index, 0, a);
  }

  _removeScar(id: string): { scar: Scar; index: number } | null {
    const list = this._state.scars;
    const index = list.findIndex((a) => a.id === id);
    if (index < 0) return null;
    const [scar] = list.splice(index, 1);
    return { scar, index };
  }

  _putScar(a: Scar): void {
    const list = this._state.scars;
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

  _insertMeasurement(m: Measurement, index?: number): void {
    const list = this._state.measurements;
    if (index === undefined || index < 0 || index > list.length) list.push(m);
    else list.splice(index, 0, m);
  }

  _removeMeasurement(id: string): { measurement: Measurement; index: number } | null {
    const list = this._state.measurements;
    const index = list.findIndex((m) => m.id === id);
    if (index < 0) return null;
    const [measurement] = list.splice(index, 1);
    return { measurement, index };
  }

  _setNextMeasureNumber(n: number): void {
    this._state.nextMeasureNumber = n;
  }

  _insertPlane(p: Plane, index?: number): void {
    const list = this._state.planes;
    if (index === undefined || index < 0 || index > list.length) list.push(p);
    else list.splice(index, 0, p);
  }

  _removePlane(id: string): { plane: Plane; index: number } | null {
    const list = this._state.planes;
    const index = list.findIndex((p) => p.id === id);
    if (index < 0) return null;
    const [plane] = list.splice(index, 1);
    return { plane, index };
  }

  _putPlane(p: Plane): void {
    const list = this._state.planes;
    const index = list.findIndex((x) => x.id === p.id);
    if (index >= 0) list[index] = p;
  }

  _setNextPlaneNumber(n: number): void {
    this._state.nextPlaneNumber = n;
  }

  _insertSection(s: Section, index?: number): void {
    const list = this._state.sections;
    if (index === undefined || index < 0 || index > list.length) list.push(s);
    else list.splice(index, 0, s);
  }

  _removeSection(id: string): { section: Section; index: number } | null {
    const list = this._state.sections;
    const index = list.findIndex((s) => s.id === id);
    if (index < 0) return null;
    const [section] = list.splice(index, 1);
    return { section, index };
  }

  _putSection(s: Section): void {
    const list = this._state.sections;
    const index = list.findIndex((x) => x.id === s.id);
    if (index >= 0) list[index] = s;
  }

  _setNextSectionNumber(n: number): void {
    this._state.nextSectionNumber = n;
  }

  _insertRegion(r: Region, index?: number): void {
    const list = this._state.regions;
    if (index === undefined || index < 0 || index > list.length) list.push(r);
    else list.splice(index, 0, r);
  }

  _removeRegion(id: string): { region: Region; index: number } | null {
    const list = this._state.regions;
    const index = list.findIndex((r) => r.id === id);
    if (index < 0) return null;
    const [region] = list.splice(index, 1);
    return { region, index };
  }

  _putRegion(r: Region): void {
    const list = this._state.regions;
    const index = list.findIndex((x) => x.id === r.id);
    if (index >= 0) list[index] = r;
  }

  _setRelations(list: Relation[]): void {
    this._state.relations = list;
  }

  _setSequences(list: Sequence[]): void {
    this._state.sequences = list;
  }

  _setNextSequenceNumber(n: number): void {
    this._state.nextSequenceNumber = n;
  }

  _setSplit(s: ProjectState['split']): void {
    this._state.split = s;
  }

  _setNodule(n: ProjectState['nodule']): void {
    this._state.nodule = n;
  }

  _setNextRegionNumber(n: number): void {
    this._state.nextRegionNumber = n;
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

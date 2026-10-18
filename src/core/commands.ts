import type { Curve, Measurement, Plane, ProjectState, Region, Scar, Section, SpecimenInfo } from './types';
import type { ProjectStore } from './store';

/**
 * Every change to project data goes through a Command. That single rule gives
 * undo/redo, autosave and an operation trail for free, and lets new features
 * (new annotation layers) plug into the same history.
 */
export interface Command {
  /** i18n key describing the change, e.g. "cmd.addArrow". */
  readonly labelKey: string;
  readonly createdAt: number;
  apply(store: ProjectStore): void;
  revert(store: ProjectStore): void;
  /** Absorb a following command of the same kind (e.g. typing in a note). */
  merge?(next: Command): boolean;
}

const MERGE_WINDOW_MS = 1500;

export class CommandHistory {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private listeners = new Set<() => void>();
  readonly limit = 1000;

  constructor(private readonly store: ProjectStore) {}

  execute(cmd: Command): void {
    cmd.apply(this.store);
    const last = this.undoStack[this.undoStack.length - 1];
    if (!(last && last.merge && last.merge(cmd))) {
      this.undoStack.push(cmd);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.redoStack = [];
    this.emit();
  }

  undo(): Command | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    cmd.revert(this.store);
    this.redoStack.push(cmd);
    this.emit();
    return cmd;
  }

  redo(): Command | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    cmd.apply(this.store);
    this.undoStack.push(cmd);
    this.emit();
    return cmd;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoLabelKey(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.labelKey ?? null;
  }
  get redoLabelKey(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.labelKey ?? null;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

const cloneScar = (a: Scar): Scar => structuredClone(a);

export class AddScarCommand implements Command {
  readonly labelKey = 'cmd.addArrow';
  readonly createdAt = Date.now();
  private prevNext = 0;
  constructor(private readonly scar: Scar, private readonly labelNumber: number | null) {}
  apply(store: ProjectStore): void {
    this.prevNext = store.state.nextLabelNumber;
    store._insertScar(cloneScar(this.scar));
    if (this.labelNumber !== null) store._setNextLabelNumber(Math.max(this.prevNext, this.labelNumber + 1));
    store.notify({ kind: 'scars', ids: [this.scar.id] });
  }
  revert(store: ProjectStore): void {
    store._removeScar(this.scar.id);
    store._setNextLabelNumber(this.prevNext);
    store.notify({ kind: 'scars', ids: [this.scar.id] });
  }
}

export class DeleteScarCommand implements Command {
  readonly labelKey = 'cmd.deleteArrow';
  readonly createdAt = Date.now();
  private removed: { scar: Scar; index: number } | null = null;
  constructor(private readonly id: string) {}
  apply(store: ProjectStore): void {
    this.removed = store._removeScar(this.id);
    store.notify({ kind: 'scars', ids: [this.id] });
  }
  revert(store: ProjectStore): void {
    if (this.removed) store._insertScar(cloneScar(this.removed.scar), this.removed.index);
    store.notify({ kind: 'scars', ids: [this.id] });
  }
}

export class UpdateScarCommand implements Command {
  readonly createdAt = Date.now();
  private after: Scar;
  constructor(
    readonly labelKey: string,
    private readonly before: Scar,
    after: Scar,
    /** Commands with the same mergeKey issued within a short window collapse into one undo step. */
    private readonly mergeKey: string | null = null,
  ) {
    this.after = cloneScar(after);
  }
  apply(store: ProjectStore): void {
    store._putScar(cloneScar(this.after));
    store.notify({ kind: 'scars', ids: [this.after.id] });
  }
  revert(store: ProjectStore): void {
    store._putScar(cloneScar(this.before));
    store.notify({ kind: 'scars', ids: [this.before.id] });
  }
  merge(next: Command): boolean {
    if (!(next instanceof UpdateScarCommand)) return false;
    if (!this.mergeKey || next.mergeKey !== this.mergeKey) return false;
    if (next.createdAt - this.createdAt > MERGE_WINDOW_MS) return false;
    this.after = cloneScar(next.after);
    return true;
  }
}

const cloneCurve = (c: Curve): Curve => structuredClone(c);

export class AddCurveCommand implements Command {
  readonly labelKey = 'cmd.addCurve';
  readonly createdAt = Date.now();
  private prevNext = 0;
  constructor(private readonly curve: Curve, private readonly labelNumber: number | null) {}
  apply(store: ProjectStore): void {
    this.prevNext = store.state.nextCurveNumber;
    store._insertCurve(cloneCurve(this.curve));
    if (this.labelNumber !== null) store._setNextCurveNumber(Math.max(this.prevNext, this.labelNumber + 1));
    store.notify({ kind: 'curves', ids: [this.curve.id] });
  }
  revert(store: ProjectStore): void {
    store._removeCurve(this.curve.id);
    store._setNextCurveNumber(this.prevNext);
    store.notify({ kind: 'curves', ids: [this.curve.id] });
  }
}

export class DeleteCurveCommand implements Command {
  readonly labelKey = 'cmd.deleteCurve';
  readonly createdAt = Date.now();
  private removed: { curve: Curve; index: number } | null = null;
  constructor(private readonly id: string) {}
  apply(store: ProjectStore): void {
    this.removed = store._removeCurve(this.id);
    store.notify({ kind: 'curves', ids: [this.id] });
  }
  revert(store: ProjectStore): void {
    if (this.removed) store._insertCurve(cloneCurve(this.removed.curve), this.removed.index);
    store.notify({ kind: 'curves', ids: [this.id] });
  }
}

export class UpdateCurveCommand implements Command {
  readonly createdAt = Date.now();
  private after: Curve;
  constructor(
    readonly labelKey: string,
    private readonly before: Curve,
    after: Curve,
    private readonly mergeKey: string | null = null,
  ) {
    this.after = cloneCurve(after);
  }
  apply(store: ProjectStore): void {
    store._putCurve(cloneCurve(this.after));
    store.notify({ kind: 'curves', ids: [this.after.id] });
  }
  revert(store: ProjectStore): void {
    store._putCurve(cloneCurve(this.before));
    store.notify({ kind: 'curves', ids: [this.before.id] });
  }
  merge(next: Command): boolean {
    if (!(next instanceof UpdateCurveCommand)) return false;
    if (!this.mergeKey || next.mergeKey !== this.mergeKey) return false;
    if (next.createdAt - this.createdAt > MERGE_WINDOW_MS) return false;
    this.after = cloneCurve(next.after);
    return true;
  }
}

export class AddMeasurementCommand implements Command {
  readonly labelKey = 'cmd.addMeasurement';
  readonly createdAt = Date.now();
  private prevNext = 0;
  constructor(private readonly measurement: Measurement, private readonly labelNumber: number) {}
  apply(store: ProjectStore): void {
    this.prevNext = store.state.nextMeasureNumber;
    store._insertMeasurement(structuredClone(this.measurement));
    store._setNextMeasureNumber(Math.max(this.prevNext, this.labelNumber + 1));
    store.notify({ kind: 'measurements', ids: [this.measurement.id] });
  }
  revert(store: ProjectStore): void {
    store._removeMeasurement(this.measurement.id);
    store._setNextMeasureNumber(this.prevNext);
    store.notify({ kind: 'measurements', ids: [this.measurement.id] });
  }
}

export class DeleteMeasurementCommand implements Command {
  readonly labelKey = 'cmd.deleteMeasurement';
  readonly createdAt = Date.now();
  private removed: { measurement: Measurement; index: number } | null = null;
  constructor(private readonly id: string) {}
  apply(store: ProjectStore): void {
    this.removed = store._removeMeasurement(this.id);
    store.notify({ kind: 'measurements', ids: [this.id] });
  }
  revert(store: ProjectStore): void {
    if (this.removed) store._insertMeasurement(structuredClone(this.removed.measurement), this.removed.index);
    store.notify({ kind: 'measurements', ids: [this.id] });
  }
}

export class AddPlaneCommand implements Command {
  readonly labelKey = 'cmd.addPlane';
  readonly createdAt = Date.now();
  private prevNext = 0;
  constructor(private readonly plane: Plane, private readonly labelNumber: number) {}
  apply(store: ProjectStore): void {
    this.prevNext = store.state.nextPlaneNumber;
    store._insertPlane(structuredClone(this.plane));
    store._setNextPlaneNumber(Math.max(this.prevNext, this.labelNumber + 1));
    store.notify({ kind: 'planes', ids: [this.plane.id] });
  }
  revert(store: ProjectStore): void {
    store._removePlane(this.plane.id);
    store._setNextPlaneNumber(this.prevNext);
    store.notify({ kind: 'planes', ids: [this.plane.id] });
  }
}

export class DeletePlaneCommand implements Command {
  readonly labelKey = 'cmd.deletePlane';
  readonly createdAt = Date.now();
  private removed: { plane: Plane; index: number } | null = null;
  constructor(private readonly id: string) {}
  apply(store: ProjectStore): void {
    this.removed = store._removePlane(this.id);
    store.notify({ kind: 'planes', ids: [this.id] });
  }
  revert(store: ProjectStore): void {
    if (this.removed) store._insertPlane(structuredClone(this.removed.plane), this.removed.index);
    store.notify({ kind: 'planes', ids: [this.id] });
  }
}

export class UpdatePlaneCommand implements Command {
  readonly createdAt = Date.now();
  constructor(
    readonly labelKey: string,
    private readonly before: Plane,
    private readonly after: Plane,
  ) {}
  apply(store: ProjectStore): void {
    store._putPlane(structuredClone(this.after));
    store.notify({ kind: 'planes', ids: [this.after.id] });
  }
  revert(store: ProjectStore): void {
    store._putPlane(structuredClone(this.before));
    store.notify({ kind: 'planes', ids: [this.before.id] });
  }
}

export class AddSectionCommand implements Command {
  readonly labelKey = 'cmd.addSection';
  readonly createdAt = Date.now();
  private prevNext = 0;
  constructor(private readonly section: Section, private readonly labelNumber: number) {}
  apply(store: ProjectStore): void {
    this.prevNext = store.state.nextSectionNumber;
    store._insertSection(structuredClone(this.section));
    store._setNextSectionNumber(Math.max(this.prevNext, this.labelNumber + 1));
    store.notify({ kind: 'sections', ids: [this.section.id] });
  }
  revert(store: ProjectStore): void {
    store._removeSection(this.section.id);
    store._setNextSectionNumber(this.prevNext);
    store.notify({ kind: 'sections', ids: [this.section.id] });
  }
}

export class DeleteSectionCommand implements Command {
  readonly labelKey = 'cmd.deleteSection';
  readonly createdAt = Date.now();
  private removed: { section: Section; index: number } | null = null;
  constructor(private readonly id: string) {}
  apply(store: ProjectStore): void {
    this.removed = store._removeSection(this.id);
    store.notify({ kind: 'sections', ids: [this.id] });
  }
  revert(store: ProjectStore): void {
    if (this.removed) store._insertSection(structuredClone(this.removed.section), this.removed.index);
    store.notify({ kind: 'sections', ids: [this.id] });
  }
}

export class UpdateSectionCommand implements Command {
  readonly labelKey = 'cmd.editSection';
  readonly createdAt = Date.now();
  constructor(
    private readonly before: Section,
    private readonly after: Section,
  ) {}
  apply(store: ProjectStore): void {
    store._putSection(structuredClone(this.after));
    store.notify({ kind: 'sections', ids: [this.after.id] });
  }
  revert(store: ProjectStore): void {
    store._putSection(structuredClone(this.before));
    store.notify({ kind: 'sections', ids: [this.before.id] });
  }
}

/** Several commands as one undo step (e.g. a region and the scar created with it). */
export class CompoundCommand implements Command {
  readonly createdAt = Date.now();
  constructor(
    readonly labelKey: string,
    private readonly parts: Command[],
  ) {}
  apply(store: ProjectStore): void {
    for (const c of this.parts) c.apply(store);
  }
  revert(store: ProjectStore): void {
    for (const c of [...this.parts].reverse()) c.revert(store);
  }
}

export class AddRegionCommand implements Command {
  readonly labelKey = 'cmd.addRegion';
  readonly createdAt = Date.now();
  private prevNext = 0;
  constructor(private readonly region: Region, private readonly labelNumber: number) {}
  apply(store: ProjectStore): void {
    this.prevNext = store.state.nextRegionNumber;
    store._insertRegion(structuredClone(this.region));
    store._setNextRegionNumber(Math.max(this.prevNext, this.labelNumber + 1));
    store.notify({ kind: 'regions', ids: [this.region.id] });
  }
  revert(store: ProjectStore): void {
    store._removeRegion(this.region.id);
    store._setNextRegionNumber(this.prevNext);
    store.notify({ kind: 'regions', ids: [this.region.id] });
  }
}

export class DeleteRegionCommand implements Command {
  readonly labelKey = 'cmd.deleteRegion';
  readonly createdAt = Date.now();
  private removed: { region: Region; index: number } | null = null;
  constructor(private readonly id: string) {}
  apply(store: ProjectStore): void {
    this.removed = store._removeRegion(this.id);
    store.notify({ kind: 'regions', ids: [this.id] });
  }
  revert(store: ProjectStore): void {
    if (this.removed) store._insertRegion(structuredClone(this.removed.region), this.removed.index);
    store.notify({ kind: 'regions', ids: [this.id] });
  }
}

export class UpdateRegionCommand implements Command {
  readonly labelKey = 'cmd.editRegion';
  readonly createdAt = Date.now();
  constructor(
    private readonly before: Region,
    private readonly after: Region,
  ) {}
  apply(store: ProjectStore): void {
    store._putRegion(structuredClone(this.after));
    store.notify({ kind: 'regions', ids: [this.after.id] });
  }
  revert(store: ProjectStore): void {
    store._putRegion(structuredClone(this.before));
    store.notify({ kind: 'regions', ids: [this.before.id] });
  }
}

export class SetSplitCommand implements Command {
  readonly labelKey = 'cmd.editSplit';
  readonly createdAt = Date.now();
  constructor(
    private readonly before: ProjectState['split'],
    private readonly after: ProjectState['split'],
  ) {}
  apply(store: ProjectStore): void {
    store._setSplit(structuredClone(this.after));
    store.notify({ kind: 'split' });
  }
  revert(store: ProjectStore): void {
    store._setSplit(structuredClone(this.before));
    store.notify({ kind: 'split' });
  }
}

export class SetNoduleCommand implements Command {
  readonly labelKey = 'cmd.editNodule';
  readonly createdAt = Date.now();
  constructor(
    private readonly before: ProjectState['nodule'],
    private readonly after: ProjectState['nodule'],
  ) {}
  apply(store: ProjectStore): void {
    store._setNodule(structuredClone(this.after));
    store.notify({ kind: 'nodule' });
  }
  revert(store: ProjectStore): void {
    store._setNodule(structuredClone(this.before));
    store.notify({ kind: 'nodule' });
  }
}

export class SetSpecimenCommand implements Command {
  readonly labelKey = 'cmd.editSpecimen';
  readonly createdAt = Date.now();
  private after: SpecimenInfo;
  constructor(
    private readonly before: SpecimenInfo,
    after: SpecimenInfo,
    private readonly mergeKey: string | null = null,
  ) {
    this.after = structuredClone(after);
  }
  apply(store: ProjectStore): void {
    store._setSpecimen(structuredClone(this.after));
    store.notify({ kind: 'specimen' });
  }
  revert(store: ProjectStore): void {
    store._setSpecimen(structuredClone(this.before));
    store.notify({ kind: 'specimen' });
  }
  merge(next: Command): boolean {
    if (!(next instanceof SetSpecimenCommand)) return false;
    if (!this.mergeKey || next.mergeKey !== this.mergeKey) return false;
    if (next.createdAt - this.createdAt > MERGE_WINDOW_MS) return false;
    this.after = structuredClone(next.after);
    return true;
  }
}

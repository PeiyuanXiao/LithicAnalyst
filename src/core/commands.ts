import type { ScarVector, SpecimenInfo } from './types';
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

const cloneArrow = (a: ScarVector): ScarVector => structuredClone(a);

export class AddArrowCommand implements Command {
  readonly labelKey = 'cmd.addArrow';
  readonly createdAt = Date.now();
  private prevNext = 0;
  constructor(private readonly arrow: ScarVector, private readonly labelNumber: number | null) {}
  apply(store: ProjectStore): void {
    this.prevNext = store.state.nextLabelNumber;
    store._insertArrow(cloneArrow(this.arrow));
    if (this.labelNumber !== null) store._setNextLabelNumber(Math.max(this.prevNext, this.labelNumber + 1));
    store.notify({ kind: 'arrows', ids: [this.arrow.id] });
  }
  revert(store: ProjectStore): void {
    store._removeArrow(this.arrow.id);
    store._setNextLabelNumber(this.prevNext);
    store.notify({ kind: 'arrows', ids: [this.arrow.id] });
  }
}

export class DeleteArrowCommand implements Command {
  readonly labelKey = 'cmd.deleteArrow';
  readonly createdAt = Date.now();
  private removed: { arrow: ScarVector; index: number } | null = null;
  constructor(private readonly id: string) {}
  apply(store: ProjectStore): void {
    this.removed = store._removeArrow(this.id);
    store.notify({ kind: 'arrows', ids: [this.id] });
  }
  revert(store: ProjectStore): void {
    if (this.removed) store._insertArrow(cloneArrow(this.removed.arrow), this.removed.index);
    store.notify({ kind: 'arrows', ids: [this.id] });
  }
}

export class UpdateArrowCommand implements Command {
  readonly createdAt = Date.now();
  private after: ScarVector;
  constructor(
    readonly labelKey: string,
    private readonly before: ScarVector,
    after: ScarVector,
    /** Commands with the same mergeKey issued within a short window collapse into one undo step. */
    private readonly mergeKey: string | null = null,
  ) {
    this.after = cloneArrow(after);
  }
  apply(store: ProjectStore): void {
    store._putArrow(cloneArrow(this.after));
    store.notify({ kind: 'arrows', ids: [this.after.id] });
  }
  revert(store: ProjectStore): void {
    store._putArrow(cloneArrow(this.before));
    store.notify({ kind: 'arrows', ids: [this.before.id] });
  }
  merge(next: Command): boolean {
    if (!(next instanceof UpdateArrowCommand)) return false;
    if (!this.mergeKey || next.mergeKey !== this.mergeKey) return false;
    if (next.createdAt - this.createdAt > MERGE_WINDOW_MS) return false;
    this.after = cloneArrow(next.after);
    return true;
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
    this.after = { ...after };
  }
  apply(store: ProjectStore): void {
    store._setSpecimen({ ...this.after });
    store.notify({ kind: 'specimen' });
  }
  revert(store: ProjectStore): void {
    store._setSpecimen({ ...this.before });
    store.notify({ kind: 'specimen' });
  }
  merge(next: Command): boolean {
    if (!(next instanceof SetSpecimenCommand)) return false;
    if (!this.mergeKey || next.mergeKey !== this.mergeKey) return false;
    if (next.createdAt - this.createdAt > MERGE_WINDOW_MS) return false;
    this.after = { ...next.after };
    return true;
  }
}

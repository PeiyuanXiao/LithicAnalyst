/** Which scar vector is selected. UI state only; not part of the project or the undo history. */
export class Selection {
  private _id: string | null = null;
  private listeners = new Set<(id: string | null) => void>();

  get id(): string | null {
    return this._id;
  }

  set(id: string | null): void {
    if (id === this._id) return;
    this._id = id;
    for (const fn of this.listeners) fn(id);
  }

  onChange(fn: (id: string | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

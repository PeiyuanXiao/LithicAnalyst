/**
 * Project files saved where they are (File System Access API: Chrome / Edge, not inside frames).
 * A project chosen in the browser's save dialog, opened through its open dialog or dropped onto the
 * page has a file handle; saving again writes that file instead of downloading a new one. Where the
 * API is missing (other browsers, frames) every function here says so and the caller downloads.
 */

export interface ProjectFileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  queryPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
}

interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}

interface PickerWindow {
  showSaveFilePicker?: (o: { suggestedName: string; types: PickerType[] }) => Promise<ProjectFileHandle>;
  showOpenFilePicker?: (o: { types: PickerType[]; multiple: false }) => Promise<ProjectFileHandle[]>;
}

const PROJECT_TYPES: PickerType[] = [{ description: 'LithicAnalyst project', accept: { 'application/json': ['.json'] } }];

const inFrame = (): boolean => window.self !== window.top;

/** The save dialog, or null where it cannot be used. Call the function in the click or key event itself. */
export function saveFilePicker(): ((suggestedName: string) => Promise<ProjectFileHandle>) | null {
  const w = window as unknown as PickerWindow;
  if (typeof w.showSaveFilePicker !== 'function' || inFrame()) return null;
  return (suggestedName) => w.showSaveFilePicker!({ suggestedName, types: PROJECT_TYPES });
}

/** The open dialog for one project file, or null where it cannot be used. */
export function openFilePicker(): (() => Promise<ProjectFileHandle>) | null {
  const w = window as unknown as PickerWindow;
  if (typeof w.showOpenFilePicker !== 'function' || inFrame()) return null;
  return async () => (await w.showOpenFilePicker!({ types: PROJECT_TYPES, multiple: false }))[0];
}

/** The handle of a file dropped onto the page; ask during the drop event itself (its items are gone after it). */
export function droppedHandle(item: DataTransferItem | undefined): Promise<ProjectFileHandle | null> | null {
  const get = (item as unknown as { getAsFileSystemHandle?: () => Promise<{ kind: string } | null> } | undefined)?.getAsFileSystemHandle;
  if (!item || item.kind !== 'file' || typeof get !== 'function' || inFrame()) return null;
  return get
    .call(item)
    .then((h) => (h && h.kind === 'file' ? (h as ProjectFileHandle) : null))
    .catch(() => null);
}

/**
 * Permission to write the file: asked (when it is not known to be given) at once, so that the
 * browser still sees the click or key press that asked for it. The promise says whether it was given.
 */
export function askToWrite(handle: ProjectFileHandle, granted: boolean): Promise<boolean> {
  if (granted || typeof handle.requestPermission !== 'function') return Promise.resolve(true);
  return handle.requestPermission({ mode: 'readwrite' }).then((p) => p === 'granted');
}

/** Replace the file's contents. */
export async function writeHandle(handle: ProjectFileHandle, text: string): Promise<void> {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

/** The user closed the dialog without choosing. */
export const isAbort = (e: unknown): boolean => (e as { name?: string } | null)?.name === 'AbortError';

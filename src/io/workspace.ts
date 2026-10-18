import { extensionOf, SUPPORTED_EXTENSIONS } from './loadMesh';

/**
 * A folder of models and project files. Chrome and Edge open it through the
 * File System Access API and can write into it; elsewhere the folder is read
 * from a directory upload and is read-only (files are downloaded instead).
 */
export interface Workspace {
  name: string;
  writable: boolean;
  /** Model files, by name. */
  meshes: string[];
  /** Project files (.json), by name. */
  projects: string[];
  read(name: string): Promise<File>;
  /** Writable folders only. */
  write(name: string, data: string | Uint8Array): Promise<void>;
}

interface FileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string | Uint8Array): Promise<void>; close(): Promise<void> }>;
}

export interface DirectoryHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<FileHandle | { kind: 'directory'; name: string }>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandle>;
}

/** The project file kept next to a model: `box.ply` → `box.lithicanalyst.json`. */
export const projectNameFor = (meshName: string): string => `${meshName.replace(/\.[^.]+$/, '')}.lithicanalyst.json`;

const isMesh = (name: string) => (SUPPORTED_EXTENSIONS as readonly string[]).includes(extensionOf(name));
const isProject = (name: string) => extensionOf(name) === 'json';
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** The folder picker, where the browser has one and allows it (not inside a frame); null otherwise. */
export function folderPicker(): (() => Promise<DirectoryHandle>) | null {
  const w = window as unknown as { showDirectoryPicker?: (o: { mode: string }) => Promise<DirectoryHandle> };
  if (typeof w.showDirectoryPicker !== 'function' || window.self !== window.top) return null;
  return () => w.showDirectoryPicker!({ mode: 'readwrite' });
}

export async function workspaceFromHandle(dir: DirectoryHandle): Promise<Workspace> {
  const files = new Map<string, FileHandle>();
  for await (const h of dir.values()) if (h.kind === 'file' && (isMesh(h.name) || isProject(h.name))) files.set(h.name, h as FileHandle);
  const ws: Workspace = {
    name: dir.name,
    writable: true,
    meshes: [...files.keys()].filter(isMesh).sort(byName),
    projects: [...files.keys()].filter(isProject).sort(byName),
    read: async (name) => {
      const h = files.get(name);
      if (!h) throw new Error(`${name} is not in the folder.`);
      return h.getFile();
    },
    write: async (name, data) => {
      const h = files.get(name) ?? (await dir.getFileHandle(name, { create: true }));
      const w = await h.createWritable();
      await w.write(data);
      await w.close();
      if (!files.has(name)) {
        files.set(name, h);
        if (isProject(name)) ws.projects = [...ws.projects, name].sort(byName);
      }
    },
  };
  return ws;
}

/** A directory upload (`<input webkitdirectory>`): the files at the top of the folder, read-only. */
export function workspaceFromFiles(list: readonly File[]): Workspace | null {
  const top = list.filter((f) => (f.webkitRelativePath || f.name).split('/').length <= 2);
  if (!top.length) return null;
  const files = new Map(top.map((f) => [f.name, f]));
  return {
    name: (top[0].webkitRelativePath || '').split('/')[0] || 'folder',
    writable: false,
    meshes: [...files.keys()].filter(isMesh).sort(byName),
    projects: [...files.keys()].filter(isProject).sort(byName),
    read: async (name) => {
      const f = files.get(name);
      if (!f) throw new Error(`${name} is not in the folder.`);
      return f;
    },
    write: async () => {
      throw new Error('This folder is read-only.');
    },
  };
}

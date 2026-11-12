import { extensionOf, SUPPORTED_EXTENSIONS } from './readMesh';

/**
 * A folder of models, read with its subfolders. Chrome and Edge open it through
 * the File System Access API and can write into it; elsewhere the folder is read
 * from a directory upload and is read-only (files are downloaded instead).
 *
 * The app's own files go into `LithicAnalyst/` at the top of the folder:
 * `projects/<model path>.lithicanalyst.json`, `exports/<time>/…` and
 * `figures/<time>/…`. Paths are relative to the folder, with `/`.
 */
export interface Workspace {
  name: string;
  writable: boolean;
  /** Model files, by path, sorted. */
  meshes: string[];
  /** Project files, by path: those in LithicAnalyst/projects/ and (from earlier versions) any next to the models. */
  projects: string[];
  /** IGES files (scar vectors from other programs), by path. */
  iges: string[];
  has(path: string): boolean;
  /** A file or folder at this path (also one the listing leaves out, such as earlier exports). */
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<File>;
  /** Writable folders only; folders on the way are created. */
  write(path: string, data: string | Uint8Array): Promise<void>;
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
  values(): AsyncIterable<FileHandle | DirectoryHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandle>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirectoryHandle>;
}

/** The folder the app keeps its files in. */
export const APP_DIR = 'LithicAnalyst';

/** What counts as a sharp edge in this folder: every model of it is judged alike. */
export const SHARP_EDGE_FILE = `${APP_DIR}/sharp-edge.json`;

/** Which points the flakes of this folder have for geometric morphometrics: every one the same. */
export const GM_CONFIG_FILE = `${APP_DIR}/gm-config.json`;

/** The folder's own settings: neither model nor project, but they are read when it is opened. */
const isFolderSettings = (path: string): boolean => path === SHARP_EDGE_FILE || path === GM_CONFIG_FILE;

/** Where a model's project file goes: `site1/EXP03.ply` → `LithicAnalyst/projects/site1/EXP03.ply.lithicanalyst.json`. */
export const projectPathFor = (meshPath: string): string => `${APP_DIR}/projects/${meshPath}.lithicanalyst.json`;

/** Where earlier versions kept it: next to the model, without the extension (`site1/EXP03.lithicanalyst.json`). */
export const legacyProjectPathFor = (meshPath: string): string => `${meshPath.replace(/\.[^./]+$/, '')}.lithicanalyst.json`;

const isMesh = (name: string) => (SUPPORTED_EXTENSIONS as readonly string[]).includes(extensionOf(name));
const isJson = (name: string) => extensionOf(name) === 'json';
const isIges = (name: string) => ['igs', 'iges'].includes(extensionOf(name));
const byPath = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** A folder that is not read: one starting with ".", or the app's own (other than its projects at the top). */
function skipDir(parts: readonly string[]): boolean {
  if (parts.some((p) => p.startsWith('.'))) return true;
  const app = parts.indexOf(APP_DIR);
  if (app < 0) return false;
  // only LithicAnalyst/projects/… at the top of the folder is read
  return app > 0 || (parts.length > 1 && parts[1] !== 'projects');
}

/** What a file of the folder is: a model, a project file, an IGES file, or none of them. */
export function classify(path: string): 'mesh' | 'project' | 'iges' | null {
  const parts = path.split('/');
  const name = parts.pop()!;
  if (skipDir(parts)) return null;
  if (parts[0] === APP_DIR) return parts[1] === 'projects' && isJson(name) ? 'project' : null;
  if (isMesh(name)) return 'mesh';
  if (isIges(name)) return 'iges';
  return isJson(name) ? 'project' : null;
}

/** The IGES file of a model: in its folder, of the same name (`site1/stone01.ply` → `site1/stone01.igs` or `.iges`, any case). */
export function igesFor(meshPath: string, igesPaths: readonly string[]): string | null {
  const stem = meshPath.replace(/\.[^./]+$/, '').toLowerCase();
  return igesPaths.find((p) => p.replace(/\.[^./]+$/, '').toLowerCase() === stem) ?? null;
}

function listing(paths: Iterable<string>): { meshes: string[]; projects: string[]; iges: string[] } {
  const meshes: string[] = [];
  const projects: string[] = [];
  const iges: string[] = [];
  for (const p of paths) {
    const k = classify(p);
    if (k === 'mesh') meshes.push(p);
    else if (k === 'project') projects.push(p);
    else if (k === 'iges') iges.push(p);
  }
  return { meshes: meshes.sort(byPath), projects: projects.sort(byPath), iges: iges.sort(byPath) };
}

/** The folder picker, where the browser has one and allows it (not inside a frame); null otherwise. */
export function folderPicker(): (() => Promise<DirectoryHandle>) | null {
  const w = window as unknown as { showDirectoryPicker?: (o: { mode: string }) => Promise<DirectoryHandle> };
  if (typeof w.showDirectoryPicker !== 'function' || window.self !== window.top) return null;
  return () => w.showDirectoryPicker!({ mode: 'readwrite' });
}

export async function workspaceFromHandle(root: DirectoryHandle): Promise<Workspace> {
  const files = new Map<string, FileHandle>();
  const dirs = new Map<string, DirectoryHandle>([['', root]]);
  const walk = async (dir: DirectoryHandle, parts: string[]): Promise<void> => {
    for await (const h of dir.values()) {
      if (h.kind === 'directory') {
        const sub = [...parts, h.name];
        if (skipDir(sub)) continue;
        dirs.set(sub.join('/'), h);
        await walk(h, sub);
      } else {
        const path = [...parts, h.name].join('/');
        if (classify(path) || isFolderSettings(path)) files.set(path, h);
      }
    }
  };
  await walk(root, []);
  const dirFor = async (parts: string[]): Promise<DirectoryHandle> => {
    let at = '', dir = root;
    for (const p of parts) {
      at = at ? `${at}/${p}` : p;
      let next = dirs.get(at);
      if (!next) dirs.set(at, (next = await dir.getDirectoryHandle(p, { create: true })));
      dir = next;
    }
    return dir;
  };
  const { meshes, projects, iges } = listing(files.keys());
  const ws: Workspace = {
    name: root.name,
    writable: true,
    meshes,
    projects,
    iges,
    has: (path) => files.has(path),
    exists: async (path) => {
      if (files.has(path) || dirs.has(path)) return true;
      const parts = path.split('/');
      let dir = root;
      for (const [i, p] of parts.entries()) {
        try {
          dir = await dir.getDirectoryHandle(p);
        } catch {
          if (i < parts.length - 1) return false;
          try {
            await dir.getFileHandle(p);
            return true;
          } catch {
            return false;
          }
        }
      }
      return true;
    },
    read: async (path) => {
      const h = files.get(path);
      if (!h) throw new Error(`${path} is not in the folder.`);
      return h.getFile();
    },
    write: async (path, data) => {
      let h = files.get(path);
      if (!h) {
        const parts = path.split('/');
        const name = parts.pop()!;
        h = await (await dirFor(parts)).getFileHandle(name, { create: true });
      }
      const w = await h.createWritable();
      await w.write(data);
      await w.close();
      if (!files.has(path)) {
        files.set(path, h);
        if (classify(path) === 'project') ws.projects = [...ws.projects, path].sort(byPath);
      }
    },
  };
  return ws;
}

/** A directory upload (`<input webkitdirectory>`), read-only; paths are taken below the chosen folder. */
export function workspaceFromFiles(list: readonly File[]): Workspace | null {
  if (!list.length) return null;
  const rel = (f: File) => (f.webkitRelativePath || f.name).split('/').slice(f.webkitRelativePath ? 1 : 0).join('/');
  const files = new Map(list.map((f) => [rel(f), f] as const).filter(([p]) => classify(p) || isFolderSettings(p)));
  const { meshes, projects, iges } = listing(files.keys());
  return {
    name: (list[0].webkitRelativePath || '').split('/')[0] || 'folder',
    writable: false,
    meshes,
    projects,
    iges,
    has: (path) => files.has(path),
    exists: async (path) => files.has(path) || [...files.keys()].some((k) => k.startsWith(`${path}/`)),
    read: async (path) => {
      const f = files.get(path);
      if (!f) throw new Error(`${path} is not in the folder.`);
      return f;
    },
    write: async () => {
      throw new Error('This folder is read-only.');
    },
  };
}

/**
 * The specimen ID of each model: its file name without the extension; where
 * two models share that name (in different subfolders, or with different
 * extensions), the path without the extension (`site1/EXP03`), and with it
 * when that is still the same (`EXP03.ply`, `EXP03.stl`). `duplicates` lists
 * the names that were shared.
 */
export function specimenIds(paths: readonly string[]): { ids: Map<string, string>; duplicates: Array<{ name: string; files: string[] }> } {
  const base = (p: string) => p.split('/').pop()!.replace(/\.[^.]+$/, '');
  const noExt = (p: string) => p.replace(/\.[^./]+$/, '');
  const group = <T>(list: readonly T[], key: (x: T) => string) => {
    const out = new Map<string, T[]>();
    for (const x of list) (out.get(key(x)) ?? out.set(key(x), []).get(key(x))!).push(x);
    return out;
  };
  const ids = new Map<string, string>();
  const duplicates: Array<{ name: string; files: string[] }> = [];
  for (const [name, list] of group(paths, base)) {
    if (list.length === 1) {
      ids.set(list[0], name);
      continue;
    }
    duplicates.push({ name, files: [...list] });
    for (const same of group(list, noExt).values()) for (const p of same) ids.set(p, same.length === 1 ? noExt(p) : p);
  }
  return { ids, duplicates };
}

/** Name of an export folder: the local time, `YYYY-MM-DD_HHMMSS`. */
export function timeStamp(d: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

/** `base`, or `base-2`, `base-3` … when that folder exists already: an export never overwrites. */
export async function freshFolder(base: string, exists: (path: string) => boolean | Promise<boolean>): Promise<string> {
  let name = base;
  for (let k = 2; await exists(name); k++) name = `${base}-${k}`;
  return name;
}

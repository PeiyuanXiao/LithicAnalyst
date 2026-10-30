import { parseProjectFile, PROJECT_FORMAT } from '../core/schema';
import type { ProjectState } from '../core/types';

/** A project file of the folder, read once. */
export interface IndexedProject {
  path: string;
  /** Checksum of the model it was made on (null when the file has none). */
  sha256: string | null;
  state: ProjectState;
  /** The results it stored (`derived`), as written. */
  derived: Record<string, unknown>;
  /** Version of the app that wrote it. */
  appVersion: string;
}

/**
 * Every project file of a folder by the model it belongs to (checksum →
 * projects), for batch exports and comparisons. The files are read the first
 * time the index is needed, each once; files the app writes afterwards are
 * put in as they are written.
 */
export class ProjectIndex {
  private byPath = new Map<string, IndexedProject>();
  private building: Promise<void> | null = null;

  constructor(
    /** The project files to read (paths). */
    private readonly paths: () => readonly string[],
    private readonly read: (path: string) => Promise<string>,
  ) {}

  /** Read the files (once; later calls wait for the same reading). */
  ready(): Promise<void> {
    this.building ??= (async () => {
      for (const path of this.paths()) {
        if (this.byPath.has(path)) continue;
        try {
          this.add(path, JSON.parse(await this.read(path)));
        } catch {
          // not a project file of this app (any .json next to the models is tried)
        }
      }
    })();
    return this.building;
  }

  get built(): boolean {
    return this.building !== null;
  }

  /** A project file as written by the app (parsed JSON), in place of what the path held. */
  add(path: string, raw: unknown): IndexedProject | null {
    const r = raw as { format?: unknown; mesh?: { sha256?: unknown } | null; derived?: unknown; app?: { version?: unknown } } | null;
    if (!r || r.format !== PROJECT_FORMAT) return null;
    const entry: IndexedProject = {
      path,
      sha256: typeof r.mesh?.sha256 === 'string' ? r.mesh.sha256 : null,
      state: parseProjectFile(r),
      derived: r.derived && typeof r.derived === 'object' ? (r.derived as Record<string, unknown>) : {},
      appVersion: typeof r.app?.version === 'string' ? r.app.version : '',
    };
    this.byPath.set(path, entry);
    return entry;
  }

  get(path: string): IndexedProject | undefined {
    return this.byPath.get(path);
  }

  /** The project files of the model with this checksum, in path order. */
  forMesh(sha256: string): IndexedProject[] {
    return [...this.byPath.values()].filter((p) => p.sha256 === sha256).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  }
}

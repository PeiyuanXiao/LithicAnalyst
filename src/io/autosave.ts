import type { ProjectFileV1 } from '../core/schema';

/**
 * Crash recovery in this browser only (localStorage, keyed by the mesh hash).
 * It is a convenience: the project file is the durable copy.
 */
const PREFIX = 'lithicanalyst:autosave:';

export interface AutosaveEntry {
  savedAt: string;
  file: ProjectFileV1;
}

export function autosaveAvailable(): boolean {
  try {
    const k = `${PREFIX}__probe`;
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function writeAutosave(sha256: string, file: ProjectFileV1): boolean {
  try {
    const entry: AutosaveEntry = { savedAt: new Date().toISOString(), file };
    localStorage.setItem(PREFIX + sha256, JSON.stringify(entry));
    return true;
  } catch {
    return false;
  }
}

export function readAutosave(sha256: string): AutosaveEntry | null {
  try {
    const raw = localStorage.getItem(PREFIX + sha256);
    if (!raw) return null;
    const entry = JSON.parse(raw) as AutosaveEntry;
    return entry && entry.file ? entry : null;
  } catch {
    return null;
  }
}

export function clearAutosave(sha256: string): void {
  try {
    localStorage.removeItem(PREFIX + sha256);
  } catch {
    /* ignore */
  }
}

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`lithicanalyst:pref:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`lithicanalyst:pref:${key}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

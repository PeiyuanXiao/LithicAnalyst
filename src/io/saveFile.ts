/**
 * Saving files. In a plain browser (local file, GitHub Pages, …) a normal
 * download is used. When the page runs inside the claude.ai artifact viewer,
 * plain downloads are blocked, so the viewer's "downloads" capability is used
 * instead. If neither works, the caller shows the text for copying.
 */

interface DownloadsNamespace {
  save(req: { filename: string; data: string | Blob | ArrayBuffer | ArrayBufferView }): Promise<{ status: string }>;
}

interface HostWindow {
  claude?: { use?: (name: string) => Promise<unknown> };
}

let downloadsPromise: Promise<DownloadsNamespace | null> | null = null;

export const runningInHost = (): boolean => !!(window as unknown as HostWindow).claude;

/** Call once at startup so the capability is resolved before the first save. */
export function initHostDownloads(): void {
  const host = (window as unknown as HostWindow).claude;
  if (host && typeof host.use === 'function') {
    downloadsPromise = host
      .use('downloads')
      .then((ns) => (ns as DownloadsNamespace | null) ?? null)
      .catch(() => null);
  }
}

export type SaveOutcome = 'saved' | 'declined' | 'busy' | 'fallback';

export async function saveTextFile(filename: string, text: string, mime: string): Promise<SaveOutcome> {
  return saveFile(filename, text, mime);
}

/** Save text or bytes (images). */
export async function saveFile(filename: string, data: string | Uint8Array, mime: string): Promise<SaveOutcome> {
  const text = data;
  if (runningInHost()) {
    const dl = downloadsPromise ? await downloadsPromise : null;
    if (!dl) return 'fallback';
    try {
      await dl.save({ filename, data: text });
      return 'saved';
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'declined') return 'declined';
      if (code === 'rate_limited') return 'busy';
      return 'fallback';
    }
  }
  try {
    const blob = new Blob([text as BlobPart], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15_000);
    return 'saved';
  } catch {
    return 'fallback';
  }
}

/** Safe file name from a specimen id. */
export function fileStem(name: string, fallback = 'specimen'): string {
  const s = name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, '_');
  return s || fallback;
}

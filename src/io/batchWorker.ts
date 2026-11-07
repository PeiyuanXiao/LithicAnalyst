import { runSync } from '../compute/steps';
import { MeshJobs, type JobReply, type JobRequest } from './meshJobs';

/**
 * The batch worker: reads, hashes, parses and measures models away from the
 * page, so a batch export goes on while the window is in the background.
 * Bundled into the single HTML file (imported with `?worker&inline`).
 */
const scope = self as unknown as { onmessage: ((e: MessageEvent<JobRequest>) => void) | null; postMessage(m: JobReply): void };
const jobs = new MeshJobs(async (steps) => runSync(steps));

scope.onmessage = async (e) => {
  const m = e.data;
  try {
    let value: unknown = null;
    if (m.type === 'hash') value = await jobs.hash(m.id, m.file);
    else if (m.type === 'measure') value = await jobs.measure(m.id, m.frames);
    else if (m.type === 'drop') jobs.drop(m.id);
    else if (m.type === 'gm') value = await jobs.gm(m.file, m.state, m.templateAvailable);
    scope.postMessage({ seq: m.seq, ok: true, value });
  } catch (err) {
    scope.postMessage({ seq: m.seq, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};

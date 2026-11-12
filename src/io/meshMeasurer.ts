import type { GmResult } from '../compute/gm';
import { runSliced } from '../compute/steps';
import type { ProjectState, SpecimenFrame } from '../core/types';
import type { Segment } from '../compute/igesAlign';
import { MeshJobs, type IgesCheck, type JobReply, type JobRequest, type MeshMeasures } from './meshJobs';

/** A request without its sequence number (for each kind of request). */
type Request = JobRequest extends infer R ? (R extends JobRequest ? Omit<R, 'seq'> : never) : never;

/** The models of a batch export, measured in the batch worker or, failing that, on the page. */
export interface MeshMeasurer {
  readonly inWorker: boolean;
  hash(id: number, file: File): Promise<string>;
  measure(id: number, frames: Array<SpecimenFrame | null>): Promise<MeshMeasures>;
  drop(id: number): void;
  /** A specimen's points by the template, on its model. */
  gm(file: File, state: ProjectState, templateAvailable: boolean): Promise<GmResult>;
  /** The IGES vectors of model `id` (read by `hash`): their unit, whether they lie on it, and then the arrows; the model is let go. */
  iges(id: number, segments: Segment[], fileFactor: number | null): Promise<IgesCheck>;
  dispose(): void;
}

/** On the page, in slices between frames (where no worker can be made). */
function pageMeasurer(): MeshMeasurer {
  const jobs = new MeshJobs((steps) => runSliced(steps));
  return { inWorker: false, hash: (id, f) => jobs.hash(id, f), measure: (id, fr) => jobs.measure(id, fr), drop: (id) => jobs.drop(id), gm: (f, st, there) => jobs.gm(f, st, there), iges: (id, s, k) => jobs.iges(id, s, k), dispose: () => {} };
}

/**
 * A measurer in a worker made by `make`; when it cannot be made or does not
 * answer (e.g. a host that forbids workers), one on the page instead.
 */
export async function createMeasurer(make: (() => Worker) | null, timeoutMs = 4000): Promise<MeshMeasurer> {
  let worker: Worker;
  try {
    if (!make) return pageMeasurer();
    worker = make();
  } catch {
    return pageMeasurer();
  }
  let seq = 0;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const fail = (e: Error) => {
    for (const w of waiting.values()) w.reject(e);
    waiting.clear();
  };
  worker.onmessage = (e: MessageEvent<JobReply>) => {
    const w = waiting.get(e.data.seq);
    if (!w) return;
    waiting.delete(e.data.seq);
    if (e.data.ok) w.resolve(e.data.value);
    else w.reject(new Error(e.data.error));
  };
  worker.onerror = (e) => fail(new Error(e.message || 'The batch worker stopped.'));
  const ask = <T>(m: Request): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const s = ++seq;
      waiting.set(s, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ ...m, seq: s } as JobRequest);
    });
  const ready = await Promise.race([ask<null>({ type: 'ping' }).then(() => true, () => false), new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs))]);
  if (!ready) {
    worker.terminate();
    return pageMeasurer();
  }
  return {
    inWorker: true,
    hash: (id, file) => ask<string>({ type: 'hash', id, file }),
    measure: (id, frames) => ask<MeshMeasures>({ type: 'measure', id, frames }),
    drop: (id) => void ask({ type: 'drop', id }).catch(() => {}),
    gm: (file, state, templateAvailable) => ask<GmResult>({ type: 'gm', file, state, templateAvailable }),
    iges: (id, segments, fileFactor) => ask<IgesCheck>({ type: 'iges', id, segments, fileFactor }),
    dispose: () => {
      fail(new Error('Cancelled.'));
      worker.terminate();
    },
  };
}

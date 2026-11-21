import { runSliced, type Steps } from '../compute/steps';
import {
  deviationStatsSteps,
  meshMomentsSteps,
  shapeSymmetrySteps,
  symmetryMeshSteps,
  symmetrySidesSteps,
  vertexDeviationSteps,
  wantsShape,
  type DeviationStats,
  type Progress,
  type SymmetryMesh,
  type SymmetryPlane,
  type SymmetrySides,
} from '../compute/symmetry';
import type { Vec3 } from '../core/types';

/**
 * The symmetry references computed away from the page: a model is handed over once (its tree, edges and samples are made
 * there), then each reference's parts are asked for — ① the sides, ② the mirror deviation, ③ the shape symmetry, and the
 * deviation at every vertex for the shading. A new task replaces the one in hand: the part being computed goes on only when the
 * new task asks for it too. The same engine runs on the page (in slices, by runSliced) where no worker can be made.
 */

export type SymmetryPhase = 'sides' | 'deviation' | 'shape' | 'vertices';
export type SymmetryStage = 'prepare' | SymmetryPhase;

/** One reference's inputs (positions' coordinates) and the parts of it asked for, in order. `key` names the inputs. */
export interface SymmetryJob {
  key: string;
  plane: SymmetryPlane;
  /** A closed curve's chain of mesh vertices (only with the sides). */
  chain: number[] | null;
  closed: boolean;
  phases: SymmetryPhase[];
}

export type SymmetryRequest =
  | { type: 'ping' }
  /** The model (copies of its positions and index: they are transferred). */
  | { type: 'mesh'; meshId: number; positions: Float32Array; index: Uint32Array; closed: boolean }
  | { type: 'task'; taskId: number; meshId: number; jobs: SymmetryJob[] }
  /** No model any more. */
  | { type: 'drop' };

export type SymmetryResult =
  | { phase: 'sides'; value: SymmetrySides }
  | { phase: 'deviation'; value: DeviationStats }
  | { phase: 'shape'; value: number | null }
  | { phase: 'vertices'; value: Float32Array };

export type SymmetryReply =
  | { type: 'pong' }
  /** The surface centroid (positions' coordinates), told before the rest of the preparation. */
  | { type: 'mesh'; meshId: number; centroid: Vec3 }
  /** The model is prepared. */
  | { type: 'ready'; meshId: number }
  /** How far the stage in hand is (0–1); `key`: the reference's inputs (null while preparing). */
  | { type: 'progress'; meshId: number; stage: SymmetryStage; key: string | null; share: number }
  | ({ type: 'result'; meshId: number; key: string } & SymmetryResult)
  /** Nothing left of task `taskId`. */
  | { type: 'idle'; meshId: number; taskId: number }
  | { type: 'error'; meshId: number; key: string | null; message: string };

/** At most this long between two reports of progress (and at least one this often while something is computed). */
export const PROGRESS_MS = 100;

/** A turn of the event loop, at once (a message to itself; a timer where there is no channel). */
export function nextTurn(): Promise<void> {
  if (typeof MessageChannel !== 'function') return new Promise((r) => setTimeout(r, 0));
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(null);
  });
}

/** Run in slices of about `budgetMs`, a turn of the event loop in between (in the worker: so that a new task is heard). */
export async function runInSlices<T>(steps: Steps<T>, budgetMs: number): Promise<T> {
  let start = performance.now();
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    if (performance.now() - start > budgetMs) {
      await nextTurn();
      start = performance.now();
    }
  }
}

class Cancelled extends Error {}

interface Item {
  key: string;
  phase: SymmetryPhase;
  job: SymmetryJob;
}

export class SymmetryEngine {
  private meshId = 0;
  private mesh: Promise<SymmetryMesh | null> | null = null;
  private taskId = 0;
  private todo: Item[] = [];
  private running: Item | null = null;
  /** Whether the part being computed is still asked for. */
  private keep = true;
  private looping = false;
  /** What became of each part taken up (tests). */
  readonly log: Array<{ key: string; phase: SymmetryPhase; outcome: 'done' | 'dropped' }> = [];

  constructor(
    private readonly post: (m: SymmetryReply, transfer?: Transferable[]) => void,
    /** Runs a computation in slices, giving the event loop turns. */
    private readonly run: <T>(steps: Steps<T>) => Promise<T>,
  ) {}

  handle(m: SymmetryRequest): void {
    if (m.type === 'ping') this.post({ type: 'pong' });
    else if (m.type === 'mesh') {
      this.meshId = m.meshId;
      this.todo = [];
      this.keep = false;
      this.mesh = this.prepare(m);
    } else if (m.type === 'drop') {
      this.meshId = -1;
      this.mesh = null;
      this.todo = [];
      this.keep = false;
    } else if (m.type === 'task') {
      if (m.meshId !== this.meshId) return;
      this.taskId = m.taskId;
      const items = m.jobs.flatMap((job) => job.phases.map((phase) => ({ key: job.key, phase, job })));
      const r = this.running;
      const at = r ? items.findIndex((i) => i.key === r.key && i.phase === r.phase) : -1;
      // the part in hand goes on when it is asked for again
      this.keep = at >= 0;
      if (at >= 0) items.splice(at, 1);
      this.todo = items;
      void this.loop();
    }
  }

  /** Run `make`'s steps while `alive`, telling the progress now and then. */
  private drive<T>(make: (progress: Progress) => Steps<T>, alive: () => boolean, stage: SymmetryStage, key: string | null): Promise<T> {
    const meshId = this.meshId;
    let share = 0, last = performance.now();
    const steps = make((s) => (share = s));
    const post = this.post;
    // (a stage begun is told at once)
    post({ type: 'progress', meshId, stage, key, share: 0 });
    function* watched(): Steps<T> {
      for (;;) {
        const r = steps.next();
        if (r.done) return r.value;
        if (!alive()) throw new Cancelled();
        const now = performance.now();
        if (now - last >= PROGRESS_MS) {
          last = now;
          post({ type: 'progress', meshId, stage, key, share });
        }
        yield;
      }
    }
    return this.run(watched());
  }

  private async prepare(m: Extract<SymmetryRequest, { type: 'mesh' }>): Promise<SymmetryMesh | null> {
    const id = m.meshId;
    const alive = () => this.meshId === id;
    try {
      const moments = await this.drive(() => meshMomentsSteps(m.positions, m.index), alive, 'prepare', null);
      this.post({ type: 'mesh', meshId: id, centroid: moments.centroid });
      const mesh = await this.drive((p) => symmetryMeshSteps(m.positions, m.index, m.closed, moments, p), alive, 'prepare', null);
      this.post({ type: 'ready', meshId: id });
      return mesh;
    } catch (err) {
      if (!(err instanceof Cancelled)) this.post({ type: 'error', meshId: id, key: null, message: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  private stepsOf(mesh: SymmetryMesh, item: Item, progress: Progress): Steps<SymmetryResult['value']> {
    const j = item.job;
    switch (item.phase) {
      case 'sides':
        return symmetrySidesSteps(mesh, { plane: j.plane, chain: j.chain, closed: j.closed }, progress);
      case 'deviation':
        return deviationStatsSteps(mesh, j.plane, progress);
      case 'shape':
        return shapeSymmetrySteps(mesh, j.plane, progress);
      case 'vertices':
        return vertexDeviationSteps(mesh, j.plane, progress);
    }
  }

  private async loop(): Promise<void> {
    if (this.looping) return;
    this.looping = true;
    let meshId = this.meshId;
    try {
      for (;;) {
        meshId = this.meshId;
        const mesh = this.mesh ? await this.mesh : null;
        // (another model meanwhile: its own preparation)
        if (meshId !== this.meshId) continue;
        if (!mesh) {
          this.todo = [];
          break;
        }
        const item = this.todo.shift();
        if (!item) break;
        this.running = item;
        this.keep = true;
        try {
          const value = await this.drive((p) => this.stepsOf(mesh, item, p), () => this.keep && this.meshId === meshId, item.phase, item.key);
          this.log.push({ key: item.key, phase: item.phase, outcome: 'done' });
          const reply = { type: 'result', meshId, key: item.key, phase: item.phase, value } as SymmetryReply;
          const transfer = item.phase === 'vertices' ? [(value as Float32Array).buffer] : item.phase === 'sides' && (value as SymmetrySides).parts ? [(value as SymmetrySides).parts!.upper.buffer] : [];
          this.post(reply, transfer);
          // sides that a plane does not cut, or of an open mesh: no shape symmetry to compute
          if (item.phase === 'sides' && !wantsShape(value as SymmetrySides)) {
            const at = this.todo.findIndex((x) => x.key === item.key && x.phase === 'shape');
            if (at >= 0) {
              this.todo.splice(at, 1);
              this.post({ type: 'result', meshId, key: item.key, phase: 'shape', value: null });
            }
          }
        } catch (err) {
          if (err instanceof Cancelled) this.log.push({ key: item.key, phase: item.phase, outcome: 'dropped' });
          else this.post({ type: 'error', meshId, key: item.key, message: err instanceof Error ? err.message : String(err) });
        } finally {
          this.running = null;
        }
      }
    } finally {
      this.looping = false;
      this.post({ type: 'idle', meshId: this.meshId, taskId: this.taskId });
    }
  }
}

/** Where the references are computed: in a worker, or on the page. */
export interface SymmetryBackend {
  readonly inWorker: boolean;
  send(m: SymmetryRequest): void;
  listen(f: (m: SymmetryReply) => void): void;
  dispose(): void;
}

/** On the page, by runSliced (where no worker can be made, and in tests). */
export function pageBackend(): SymmetryBackend & { engine: SymmetryEngine } {
  let listener: ((m: SymmetryReply) => void) | null = null;
  // (replies come later, as from a worker)
  const engine = new SymmetryEngine((m) => queueMicrotask(() => listener?.(m)), (s) => runSliced(s));
  return {
    inWorker: false,
    engine,
    send: (m) => engine.handle(m),
    listen: (f) => (listener = f),
    dispose: () => engine.handle({ type: 'drop' }),
  };
}

/**
 * In a worker made by `make`; when it cannot be made, does not answer within `timeoutMs`, or fails, the engine moves to the page:
 * the model and the last task are sent to it again.
 */
export function workerBackend(make: (() => Worker) | null, timeoutMs = 4000): SymmetryBackend {
  let listener: ((m: SymmetryReply) => void) | null = null;
  let page: ReturnType<typeof pageBackend> | null = null;
  let worker: Worker | null = null;
  let mesh: Extract<SymmetryRequest, { type: 'mesh' }> | null = null;
  let task: SymmetryRequest | null = null;
  const toPage = () => {
    if (page) return;
    worker?.terminate();
    worker = null;
    page = pageBackend();
    page.listen((m) => listener?.(m));
    if (mesh) page.send(mesh);
    if (task) page.send(task);
  };
  try {
    worker = make ? make() : null;
  } catch {
    worker = null;
  }
  if (!worker) toPage();
  else {
    let answered = false;
    worker.onmessage = (e: MessageEvent<SymmetryReply>) => {
      if (e.data.type === 'pong') answered = true;
      else listener?.(e.data);
    };
    worker.onerror = () => toPage();
    worker.postMessage({ type: 'ping' } satisfies SymmetryRequest);
    setTimeout(() => {
      if (!answered) toPage();
    }, timeoutMs);
  }
  return {
    get inWorker() {
      return !page;
    },
    send(m) {
      if (m.type === 'mesh') {
        mesh = m;
        task = null;
      } else if (m.type === 'drop') {
        mesh = null;
        task = null;
      } else if (m.type === 'task') task = m;
      if (page) page.send(m);
      else if (m.type === 'mesh') {
        // copies go: the page keeps its own
        const positions = m.positions.slice(), index = m.index.slice();
        worker!.postMessage({ ...m, positions, index }, [positions.buffer, index.buffer]);
      } else worker!.postMessage(m);
    },
    listen: (f) => (listener = f),
    dispose() {
      worker?.terminate();
      page?.dispose();
    },
  };
}

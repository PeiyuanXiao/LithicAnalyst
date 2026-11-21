import { runInSlices, SymmetryEngine, type SymmetryReply, type SymmetryRequest } from './symmetryJobs';

/**
 * The symmetry worker: the references' sides, mirror deviation and shape symmetry away from the page, a turn of its event
 * loop about every 30 ms so that a new task is heard. Bundled into the single HTML file (imported with `?worker&inline`).
 */
const SLICE_MS = 30;
const scope = self as unknown as { onmessage: ((e: MessageEvent<SymmetryRequest>) => void) | null; postMessage(m: SymmetryReply, transfer?: Transferable[]): void };
const engine = new SymmetryEngine((m, transfer) => scope.postMessage(m, transfer ?? []), (steps) => runInSlices(steps, SLICE_MS));
scope.onmessage = (e) => engine.handle(e.data);

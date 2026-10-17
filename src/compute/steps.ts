/**
 * Long computations are written as generators that yield now and then. The
 * same code runs to completion at once (tests, small meshes) or in slices
 * between frames, so a 2-million-triangle scan never freezes the interface.
 */
export type Steps<T> = Generator<void, T, void>;

/** Run to completion. */
export function runSync<T>(steps: Steps<T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Run in slices of about `budgetMs`, giving the browser a turn in between. */
export async function runSliced<T>(steps: Steps<T>, budgetMs = 12): Promise<T> {
  let start = performance.now();
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    if (performance.now() - start > budgetMs) {
      await nextTask();
      start = performance.now();
    }
  }
}

/** True every `every` calls; generators yield on it inside long loops. */
export const YIELD_EVERY = 1 << 15;

import { curvatureColors } from './colormap';
import { buildAdjacency, meanCurvature, robustAbsRange, smoothField, type Adjacency } from './curvature';

const CHECKPOINT = 10;
const RECENT_LEVELS = 3;

/**
 * Lazily computes and caches curvature colours for one mesh.
 * Smoothing levels go up to 100 passes; every 10th level is kept as a
 * checkpoint (plus a few recent levels), so moving the slider in either
 * direction only recomputes the passes since the nearest checkpoint.
 */
export class CurvatureService {
  private adj: Adjacency | null = null;
  private levels = new Map<number, { field: Float32Array; range: number }>();
  private recent: number[] = [];
  private pending: Promise<void> | null = null;
  private disposed = false;

  constructor(
    private readonly positions: ArrayLike<number>,
    private readonly normals: ArrayLike<number>,
    private readonly index: ArrayLike<number>,
    private readonly orientationSign: number,
  ) {}

  dispose(): void {
    this.disposed = true;
    this.levels.clear();
  }

  get ready(): boolean {
    return this.levels.has(0);
  }

  private async ensureRaw(): Promise<void> {
    if (this.levels.has(0)) return;
    if (!this.pending) {
      this.pending = (async () => {
        await new Promise((r) => setTimeout(r, 0));
        const n = this.positions.length / 3;
        this.adj = buildAdjacency(this.index, n);
        const raw = await meanCurvature(this.positions, this.normals, this.adj, this.orientationSign);
        this.levels.set(0, { field: raw, range: robustAbsRange(raw, 0.96) });
      })();
    }
    await this.pending;
  }

  private remember(level: number, field: Float32Array): void {
    this.levels.set(level, { field, range: robustAbsRange(field, 0.96) });
    if (level % CHECKPOINT === 0) return;
    this.recent = [level, ...this.recent.filter((l) => l !== level)];
    for (const old of this.recent.splice(RECENT_LEVELS)) this.levels.delete(old);
  }

  /** Curvature smoothed by `passes` one-ring averaging passes. */
  async field(passes: number): Promise<{ field: Float32Array; range: number } | null> {
    await this.ensureRaw();
    if (this.disposed || !this.adj) return null;
    const target = Math.max(0, Math.round(passes));
    const hit = this.levels.get(target);
    if (hit) return hit;
    let base = 0;
    for (const k of this.levels.keys()) if (k < target && k > base) base = k;
    let level = base;
    let field = this.levels.get(base)!.field;
    while (level < target) {
      const next = Math.min(target, (Math.floor(level / CHECKPOINT) + 1) * CHECKPOINT);
      field = await smoothField(field, this.adj, next - level);
      if (this.disposed) return null;
      level = next;
      if (level % CHECKPOINT === 0 || level === target) this.remember(level, field);
    }
    return this.levels.get(target) ?? null;
  }

  /** Linear-space colours for the given smoothing passes and contrast; null if disposed meanwhile. */
  async colors(passes: number, contrast: number): Promise<Float32Array | null> {
    const f = await this.field(passes);
    if (!f || this.disposed) return null;
    return curvatureColors(f.field, f.range, contrast);
  }
}

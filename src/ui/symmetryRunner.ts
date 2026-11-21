import type { PlaneResult } from '../compute/planes';
import { isComplete, needsCentroid, noSourceValues, symmetrySource, symmetryValues, wantsShape, type SymmetryComputed, type SymmetryPlane, type SymmetryValues } from '../compute/symmetry';
import type { Curve, ProjectState, SymmetryRef, Vec3 } from '../core/types';
import type { SymmetryBackend, SymmetryJob, SymmetryPhase, SymmetryReply, SymmetryStage } from '../io/symmetryJobs';

/** Results kept, by their inputs: going back to a source used before shows its values at once. */
export const SYMMETRY_CACHE_SIZE = 16;
/** Of them, with the deviation at every vertex (a float a vertex). */
const VERTEX_CACHE_SIZE = 4;

/** What the references are computed on: the open model (positions re-centred by `offset`). */
export interface SymmetryModel {
  positions: Float32Array;
  index: Uint32Array;
  offset: Vec3;
  closed: boolean;
  /** The chain of mesh vertices along a closed curve (null: it cannot be followed). */
  chainOf: (curve: Curve) => Promise<number[] | null>;
}

interface Entry {
  key: string;
  /** Positions' coordinates; the normal toward side A (before any swap). */
  plane: SymmetryPlane;
  /** The curve that parts the sides (null: the plane does). */
  curve: Curve | null;
  computed: SymmetryComputed;
  vertices?: Float32Array;
  failed?: boolean;
  /** What the progress counts: the parts asked for when the inputs were new, and the model's preparation if it was not done. */
  planned: { prepare: boolean; phases: SymmetryPhase[] };
}

interface RefState {
  /** The key of its inputs; null: no plane from its source; WAIT: the surface centroid is not known yet. */
  key: string | null;
  /** Its inputs before, shown (faded) until the present ones have their values. */
  prev: string | null;
}

const WAIT = 'wait';

/** How long each stage takes, roughly (for the progress told). */
const WEIGHT: Record<SymmetryStage, number> = { prepare: 3, sides: 1, deviation: 1, shape: 2, vertices: 2 };

/** A reference as its card shows it. */
export interface SymmetryShown {
  /** The values of its present inputs so far (null: none yet). */
  now: SymmetryValues | null;
  /** Those of its inputs before, while the present ones are computed. */
  before: SymmetryValues | null;
  /** The parts there for the present inputs. */
  done: { sides: boolean; deviation: boolean; shape: boolean };
  /** Being computed, or waiting to be: how far (0–1); null: all there. */
  progress: number | null;
}

/**
 * The symmetry references of the open model, computed by a backend (a worker, or the page): the model once, then for each
 * reference the parts its inputs still lack — a new request replaces the one in hand. Results are kept by their inputs (a swap,
 * a label or a note does not count), at most SYMMETRY_CACHE_SIZE of them.
 */
export class SymmetryRunner {
  private meshId = 0;
  private model: SymmetryModel | null = null;
  /** The surface centroid (positions' coordinates), once told. */
  private centroid: Vec3 | null = null;
  private prepared = false;
  private cache = new Map<string, Entry>();
  private refs = new Map<string, RefState>();
  /** Chains by the curve's points: being followed, or followed. */
  private chains = new Map<string, number[] | null | 'pending'>();
  /** `key|phase` asked for and not yet back. */
  private inflight = new Set<string>();
  private taskId = 0;
  private stage: { stage: SymmetryStage; key: string | null; share: number } | null = null;
  private last: { state: Readonly<ProjectState>; planes: readonly PlaneResult[] } | null = null;
  private vertexRefs: string[] = [];
  /** Keys whose vertex deviation is kept, oldest first. */
  private vertexKeys: string[] = [];
  private held = false;

  constructor(
    private readonly backend: SymmetryBackend,
    /** Values came (or went). */
    private readonly onChange: () => void,
    /** Only the progress moved. */
    private readonly onProgress: () => void = onChange,
  ) {
    backend.listen((m) => this.receive(m));
  }

  get inWorker(): boolean {
    return this.backend.inWorker;
  }

  /** Something is computed or waits to be (a reference's parts, or the deviation at the vertices asked for). */
  get busy(): boolean {
    if (!this.model || !this.last) return false;
    for (const ref of this.last.state.symmetry) {
      const rs = this.refs.get(ref.id);
      if (!rs || rs.key === null) continue;
      const e = rs.key === WAIT ? null : this.cache.get(rs.key);
      if (!e || (!e.failed && (!isComplete(e.computed) || (this.vertexRefs.includes(ref.id) && !e.vertices)))) return true;
    }
    return false;
  }

  /** Tests: while held, nothing is asked of the backend (what is wanted waits); let go, it is asked. */
  hold(on: boolean): void {
    this.held = on;
    if (!on && this.dispatch()) this.onChange();
  }

  /** The model went: everything with it. */
  reset(): void {
    this.update(null, [], null);
  }

  /** The surface centroid (original coordinates), once the model's moments are known. */
  surfaceCentroid(): Vec3 | null {
    const c = this.centroid, o = this.model?.offset;
    return c && o ? [c[0] + o[0], c[1] + o[1], c[2] + o[2]] : null;
  }

  /** Ask for what the references lack (nothing when their values stand). */
  update(state: Readonly<ProjectState> | null, planes: readonly PlaneResult[], model: SymmetryModel | null): void {
    if (model?.positions !== this.model?.positions) {
      this.meshId++;
      this.centroid = null;
      this.prepared = false;
      this.cache.clear();
      this.chains.clear();
      this.inflight.clear();
      this.refs.clear();
      this.vertexKeys = [];
      this.stage = null;
      if (model) this.backend.send({ type: 'mesh', meshId: this.meshId, positions: model.positions, index: model.index, closed: model.closed });
      else if (this.model) this.backend.send({ type: 'drop' });
    }
    this.model = model;
    this.last = state ? { state, planes } : null;
    if (!state || !model) {
      this.refs.clear();
      this.onChange();
      return;
    }
    let changed = false;
    for (const id of [...this.refs.keys()])
      if (!state.symmetry.some((s) => s.id === id)) {
        this.refs.delete(id);
        changed = true;
      }
    for (const ref of state.symmetry) if (this.resolve(ref, state, planes, model)) changed = true;
    this.trim();
    if (this.dispatch() || changed) this.onChange();
  }

  /** The key of a reference's inputs, its entry made when they are new; whether the key is another. */
  private resolve(ref: SymmetryRef, state: Readonly<ProjectState>, planes: readonly PlaneResult[], model: SymmetryModel): boolean {
    const o = model.offset;
    const src = symmetrySource(ref, state, planes, this.surfaceCentroid());
    let key: string | null;
    if (!src) key = needsCentroid(ref) && !this.centroid && state.specimen.frame ? WAIT : null;
    else {
      const curve = src.curveId ? (state.curves.find((c) => c.id === src.curveId) ?? null) : null;
      key = JSON.stringify([this.meshId, src.plane.point, src.plane.normal, curve ? curve.points : null, model.closed]);
      let e = this.cache.get(key);
      if (e) this.cache.delete(key);
      else {
        const p = src.plane;
        const plane: SymmetryPlane = { point: [p.point[0] - o[0], p.point[1] - o[1], p.point[2] - o[2]], normal: [...p.normal] as Vec3 };
        e = { key, plane, curve, computed: { plane }, planned: { prepare: !this.prepared, phases: ['sides', 'deviation', 'shape'] } };
      }
      // (the newest last: the oldest go first)
      this.cache.set(key, e);
    }
    const rs = this.refs.get(ref.id);
    if (!rs) this.refs.set(ref.id, { key, prev: null });
    else if (rs.key !== key) {
      const old = rs.key && rs.key !== WAIT ? this.cache.get(rs.key) : undefined;
      if (old && (old.computed.sides || old.computed.deviation || old.computed.shape !== undefined)) rs.prev = rs.key;
      rs.key = key;
    } else return false;
    return true;
  }

  /** At most SYMMETRY_CACHE_SIZE results, the oldest let go first (not those shown). */
  private trim(): void {
    const used = new Set<string>();
    for (const rs of this.refs.values()) {
      if (rs.key) used.add(rs.key);
      if (rs.prev) used.add(rs.prev);
    }
    for (const key of [...this.cache.keys()]) {
      if (this.cache.size <= SYMMETRY_CACHE_SIZE) break;
      if (!used.has(key)) this.cache.delete(key);
    }
  }

  /** The chain along an entry's curve: followed on the page (once); null while it is. */
  private chainOf(e: Entry): number[] | null | 'pending' {
    const curve = e.curve!, model = this.model!;
    const key = JSON.stringify(curve.points);
    const have = this.chains.get(key);
    if (have !== undefined) return have;
    this.chains.set(key, 'pending');
    const meshId = this.meshId;
    void model.chainOf(curve).then(
      (chain) => {
        if (meshId !== this.meshId) return;
        this.chains.set(key, chain ?? []);
        if (this.dispatch()) this.onChange();
      },
      () => {
        if (meshId !== this.meshId) return;
        this.chains.set(key, []);
        if (this.dispatch()) this.onChange();
      },
    );
    return 'pending';
  }

  /** Ask the backend for what is lacking, as one task; nothing when the task in hand asks for just that. Whether it asked. */
  private dispatch(): boolean {
    const model = this.model, last = this.last;
    if (!model || !last) return false;
    const jobs: SymmetryJob[] = [];
    const seen = new Set<string>();
    for (const ref of last.state.symmetry) {
      const rs = this.refs.get(ref.id);
      if (!rs?.key || rs.key === WAIT || seen.has(rs.key)) continue;
      seen.add(rs.key);
      const e = this.cache.get(rs.key);
      if (!e || e.failed) continue;
      const c = e.computed;
      const phases: SymmetryPhase[] = [];
      if (!c.sides) phases.push('sides');
      if (!c.deviation) phases.push('deviation');
      if (c.shape === undefined && (!c.sides || wantsShape(c.sides))) phases.push('shape');
      if (!e.vertices && last.state.symmetry.some((s) => this.vertexRefs.includes(s.id) && this.refs.get(s.id)?.key === e.key)) phases.push('vertices');
      if (!phases.length) continue;
      let chain: number[] | null = null;
      if (e.curve && phases.includes('sides')) {
        const ch = this.chainOf(e);
        // (the sides wait for the chain, and the shape for the sides)
        if (ch === 'pending') continue;
        chain = ch;
      }
      jobs.push({ key: e.key, plane: e.plane, chain: phases.includes('sides') ? chain : null, closed: model.closed, phases });
    }
    const want = new Set(jobs.flatMap((j) => j.phases.map((p) => `${j.key}|${p}`)));
    if (this.held || (want.size === this.inflight.size && [...want].every((x) => this.inflight.has(x)))) return false;
    this.inflight = want;
    this.backend.send({ type: 'task', taskId: ++this.taskId, meshId: this.meshId, jobs });
    return true;
  }

  private receive(m: SymmetryReply): void {
    if (m.type === 'pong' || m.meshId !== this.meshId) return;
    switch (m.type) {
      case 'mesh':
        this.centroid = m.centroid;
        // the specimen frames' mid-planes can be told now
        if (this.last && this.model) this.update(this.last.state, this.last.planes, this.model);
        return;
      case 'ready':
        this.prepared = true;
        return;
      case 'progress':
        this.stage = { stage: m.stage, key: m.key, share: m.share };
        this.onProgress();
        return;
      case 'result': {
        this.inflight.delete(`${m.key}|${m.phase}`);
        const e = this.cache.get(m.key);
        if (e) {
          if (m.phase === 'vertices') this.keepVertices(e, m.value);
          else if (m.phase === 'sides') {
            e.computed.sides = m.value;
            if (!wantsShape(m.value)) e.computed.shape = null;
          } else if (m.phase === 'deviation') e.computed.deviation = m.value;
          else e.computed.shape = m.value;
        }
        if (this.stage?.key === m.key && this.stage.stage === m.phase) this.stage = null;
        this.onChange();
        return;
      }
      case 'idle':
        if (m.taskId !== this.taskId) return;
        this.inflight.clear();
        this.stage = null;
        // (what came meanwhile)
        this.dispatch();
        this.onChange();
        return;
      case 'error': {
        console.error(`symmetry: ${m.message}`);
        if (m.key) {
          const e = this.cache.get(m.key);
          if (e) e.failed = true;
          for (const x of [...this.inflight]) if (x.startsWith(`${m.key}|`)) this.inflight.delete(x);
        }
        this.onChange();
        return;
      }
    }
  }

  private keepVertices(e: Entry, v: Float32Array): void {
    e.vertices = v;
    this.vertexKeys = [...this.vertexKeys.filter((k) => k !== e.key), e.key];
    while (this.vertexKeys.length > VERTEX_CACHE_SIZE) {
      const old = this.cache.get(this.vertexKeys.shift()!);
      if (old) delete old.vertices;
    }
  }

  /** The deviation at every vertex is wanted for these references (the shading's, the one pointed at): asked for when lacking. */
  wantVertices(ids: string[]): void {
    if (ids.length === this.vertexRefs.length && ids.every((x, i) => x === this.vertexRefs[i])) return;
    this.vertexRefs = ids;
    if (this.dispatch()) this.onChange();
  }

  private entryOf(id: string): Entry | null {
    const k = this.refs.get(id)?.key;
    return (k && k !== WAIT && this.cache.get(k)) || null;
  }

  /** A reference's results so far (positions' coordinates), or null. */
  computed(id: string): SymmetryComputed | null {
    return this.entryOf(id)?.computed ?? null;
  }

  /** Whether the reference has a plane, or will have once the model's moments are known. */
  hasSource(id: string): boolean {
    return !!this.refs.get(id)?.key;
  }

  /** A reference's deviation at every vertex, when there. */
  vertexDeviation(id: string): Float32Array | null {
    return this.entryOf(id)?.vertices ?? null;
  }

  /** How far the deviation at every vertex is (0–1), while it is lacking; null when there or not asked for. */
  vertexProgress(id: string): number | null {
    const rs = this.refs.get(id);
    if (!rs?.key) return null;
    const e = this.entryOf(id);
    if (e?.vertices || e?.failed) return null;
    let total = WEIGHT.vertices, done = 0;
    if (!this.prepared) {
      total += WEIGHT.prepare;
      if (this.stage?.stage === 'prepare') done += WEIGHT.prepare * this.stage.share;
    } else if (e && this.stage?.stage === 'vertices' && this.stage.key === e.key) done += WEIGHT.vertices * this.stage.share;
    return done / total;
  }

  private progressOf(e: Entry | null): number {
    if (!e) return this.stage?.stage === 'prepare' ? (WEIGHT.prepare * this.stage.share) / (WEIGHT.prepare + 4) : 0;
    const c = e.computed;
    const has = (p: SymmetryPhase) => (p === 'sides' ? !!c.sides : p === 'deviation' ? !!c.deviation : p === 'shape' ? c.shape !== undefined : !!e.vertices);
    let total = 0, done = 0;
    const part = (s: SymmetryStage, ok: boolean) => {
      total += WEIGHT[s];
      if (ok) done += WEIGHT[s];
      else if (this.stage && this.stage.stage === s && (s === 'prepare' || this.stage.key === e.key)) done += WEIGHT[s] * this.stage.share;
    };
    if (e.planned.prepare) part('prepare', this.prepared);
    for (const p of e.planned.phases) part(p, has(p));
    return total ? Math.min(1, done / total) : 1;
  }

  /** A reference as its card shows it: its values so far, those before, how far the rest is. */
  shown(ref: SymmetryRef, offset: Vec3 | null): SymmetryShown {
    const none = { sides: false, deviation: false, shape: false };
    const rs = this.refs.get(ref.id);
    if (!rs || !offset) return { now: null, before: null, done: none, progress: this.model ? 0 : null };
    if (rs.key === null) return { now: noSourceValues(ref), before: null, done: { sides: true, deviation: true, shape: true }, progress: null };
    const e = this.entryOf(ref.id);
    const old = rs.prev ? this.cache.get(rs.prev) : undefined;
    const c = e?.computed;
    const done = { sides: !!c?.sides, deviation: !!c?.deviation, shape: c?.shape !== undefined };
    const complete = !!e && (e.failed || isComplete(c));
    return {
      now: e ? symmetryValues(ref, e.computed, offset) : null,
      before: old && !complete ? symmetryValues(ref, old.computed, offset) : null,
      done: e?.failed ? { sides: true, deviation: true, shape: true } : done,
      progress: complete ? null : this.progressOf(e),
    };
  }

  /**
   * The values as stored, in the order of the references: those with every part (`partial`: whatever parts are there, the rest
   * empty); those without a plane, empty with the reason.
   */
  values(state: Readonly<ProjectState>, offset: Vec3 | null, partial = false): SymmetryValues[] {
    return state.symmetry.flatMap((ref) => {
      const rs = this.refs.get(ref.id);
      if (!rs) return [];
      if (rs.key === null) return [noSourceValues(ref)];
      const e = this.entryOf(ref.id);
      if (!e || !offset || (!partial && !isComplete(e.computed))) return [];
      return [symmetryValues(ref, e.computed, offset)];
    });
  }
}

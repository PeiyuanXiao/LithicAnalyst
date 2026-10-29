/**
 * Stratigraphy of scars: "A cuts B" means A is later than B. Checks the
 * recorded relations against each other and against the removal sequences,
 * and lays out a Harris matrix. Pure functions on ids.
 */

import type { ProjectState } from '../core/types';

export interface RelationEdge {
  /** The later scar. */
  later: string;
  earlier: string;
}

export interface SequenceInput {
  id: string;
  label: string;
  /** Members; their order counts only when `ordered`. Sequences are listed earliest first. */
  scarIds: string[];
  ordered: boolean;
}

export interface RelationChecks {
  /** Groups of scars whose relations go round in a circle. */
  cycles: string[][];
  /** Relations inside such a group (they cannot all be true). */
  cycleEdges: RelationEdge[];
  /** A cuts B, but A's sequence comes before B's. */
  sequenceConflicts: Array<RelationEdge & { laterSequence: string; earlierSequence: string }>;
  /** A cuts B in the same ordered sequence, but A is listed before B. */
  orderConflicts: Array<RelationEdge & { sequence: string }>;
  /** Scars in no sequence (only reported when there are sequences). */
  unassigned: string[];
  /** Number of problems (the unassigned scars count as one hint). */
  count: number;
}

/** The scars, the "cuts" relations (indeterminate ones are left out) and the sequences of a project. */
export function relationInputs(state: Pick<ProjectState, 'scars' | 'relations' | 'sequences'>): { scarIds: string[]; edges: RelationEdge[]; sequences: SequenceInput[] } {
  return {
    scarIds: state.scars.map((s) => s.id),
    edges: state.relations.filter((r) => r.kind === 'a_cuts_b').map((r) => ({ later: r.a, earlier: r.b })),
    sequences: state.sequences.map((q) => ({ id: q.id, label: q.label, scarIds: q.scarIds, ordered: q.ordered })),
  };
}

const key = (e: RelationEdge) => `${e.later}>${e.earlier}`;

/** Strongly connected components with more than one scar (Tarjan). */
function cyclesOf(nodes: string[], edges: RelationEdge[]): string[][] {
  const out = new Map<string, string[]>();
  for (const n of nodes) out.set(n, []);
  for (const e of edges) out.get(e.later)?.push(e.earlier);
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const comps: string[][] = [];
  const visit = (v: string) => {
    index.set(v, counter);
    low.set(v, counter++);
    stack.push(v);
    onStack.add(v);
    for (const w of out.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) comps.push(comp.reverse());
    }
  };
  for (const n of nodes) if (!index.has(n)) visit(n);
  return comps;
}

export function checkRelations(scarIds: string[], edges: RelationEdge[], sequences: SequenceInput[]): RelationChecks {
  const known = new Set(scarIds);
  const valid = edges.filter((e) => known.has(e.later) && known.has(e.earlier) && e.later !== e.earlier);
  const cycles = cyclesOf(scarIds, valid);
  const inCycle = new Map<string, number>();
  cycles.forEach((c, i) => c.forEach((id) => inCycle.set(id, i)));
  const cycleEdges = valid.filter((e) => inCycle.has(e.later) && inCycle.get(e.later) === inCycle.get(e.earlier));

  const seqOf = new Map<string, number>();
  sequences.forEach((s, i) => s.scarIds.forEach((id) => known.has(id) && !seqOf.has(id) && seqOf.set(id, i)));
  const sequenceConflicts: RelationChecks['sequenceConflicts'] = [];
  const orderConflicts: RelationChecks['orderConflicts'] = [];
  for (const e of valid) {
    const a = seqOf.get(e.later), b = seqOf.get(e.earlier);
    if (a === undefined || b === undefined) continue;
    if (a < b) sequenceConflicts.push({ ...e, laterSequence: sequences[a].id, earlierSequence: sequences[b].id });
    else if (a === b && sequences[a].ordered) {
      const list = sequences[a].scarIds;
      if (list.indexOf(e.later) < list.indexOf(e.earlier)) orderConflicts.push({ ...e, sequence: sequences[a].id });
    }
  }
  const unassigned = sequences.length ? scarIds.filter((id) => !seqOf.has(id)) : [];
  return {
    cycles,
    cycleEdges,
    sequenceConflicts,
    orderConflicts,
    unassigned,
    count: cycles.length + sequenceConflicts.length + orderConflicts.length + (unassigned.length ? 1 : 0),
  };
}

/** One problem found by the checks, with the scars it involves (for listing and highlighting). */
export type RelationProblem =
  | { kind: 'cycle'; scars: string[] }
  | { kind: 'sequence'; scars: [string, string]; sequences: [string, string] }
  | { kind: 'order'; scars: [string, string]; sequence: string }
  | { kind: 'unassigned'; scars: string[] };

export function relationProblems(c: RelationChecks): RelationProblem[] {
  return [
    ...c.cycles.map((scars): RelationProblem => ({ kind: 'cycle', scars })),
    ...c.sequenceConflicts.map((e): RelationProblem => ({ kind: 'sequence', scars: [e.later, e.earlier], sequences: [e.laterSequence, e.earlierSequence] })),
    ...c.orderConflicts.map((e): RelationProblem => ({ kind: 'order', scars: [e.later, e.earlier], sequence: e.sequence })),
    ...(c.unassigned.length ? [{ kind: 'unassigned', scars: c.unassigned } as RelationProblem] : []),
  ];
}

export type RelationResults = RelationChecks & {
  /** The relations left after the transitive reduction (those a Harris matrix draws). */
  direct: RelationEdge[];
};

export function relationResults(state: Pick<ProjectState, 'scars' | 'relations' | 'sequences'>): RelationResults {
  const { scarIds, edges, sequences } = relationInputs(state);
  const checks = checkRelations(scarIds, edges, sequences);
  const known = new Set(scarIds);
  return { ...checks, direct: directRelations(edges.filter((e) => known.has(e.later) && known.has(e.earlier) && e.later !== e.earlier), checks.cycleEdges) };
}

/** Relations implied by others are left out (transitive reduction); relations in a cycle are kept. */
export function directRelations(edges: RelationEdge[], cycleEdges: RelationEdge[]): RelationEdge[] {
  const cyc = new Set(cycleEdges.map(key));
  const dag = edges.filter((e) => !cyc.has(key(e)));
  const out = new Map<string, string[]>();
  for (const e of dag) (out.get(e.later) ?? out.set(e.later, []).get(e.later)!).push(e.earlier);
  const reachableAvoiding = (from: string, to: string): boolean => {
    // is `to` reachable from `from` without using the direct edge from → to?
    const seen = new Set<string>();
    const stack = (out.get(from) ?? []).filter((x) => x !== to);
    while (stack.length) {
      const v = stack.pop()!;
      if (v === to) return true;
      if (seen.has(v)) continue;
      seen.add(v);
      stack.push(...(out.get(v) ?? []));
    }
    return false;
  };
  const unique = new Map(dag.map((e) => [key(e), e]));
  return [...[...unique.values()].filter((e) => !reachableAvoiding(e.later, e.earlier)), ...cycleEdges];
}

/** Which scar is later than which, from all "cuts" relations chained (the transitive closure). */
export interface Stratigraphy {
  /** `a` is later than `b` through one or more relations. */
  later(a: string, b: string): boolean;
  /** `a` comes before (is earlier than) `b`: `b` is later and not also earlier (a cycle). */
  before(a: string, b: string): boolean;
  /** The relations leading from `later` down to `earlier` (fewest steps), or null. */
  chain(later: string, earlier: string): RelationEdge[] | null;
  /** Sequence `p` comes before `q`: a member of q is later than one of p, and no member of p is later than one of q. */
  sequenceBefore(p: readonly string[], q: readonly string[]): boolean;
}

export function stratigraphy(scarIds: readonly string[], edges: readonly RelationEdge[]): Stratigraphy {
  const known = new Set(scarIds);
  const out = new Map<string, string[]>();
  for (const e of edges) if (known.has(e.later) && known.has(e.earlier) && e.later !== e.earlier) (out.get(e.later) ?? out.set(e.later, []).get(e.later)!).push(e.earlier);
  // breadth first from each scar: what lies below it, and the step each was reached from
  const below = new Map<string, Map<string, string>>();
  const reach = (from: string): Map<string, string> => {
    let seen = below.get(from);
    if (seen) return seen;
    seen = new Map();
    const queue = [from];
    for (let i = 0; i < queue.length; i++)
      for (const w of out.get(queue[i]) ?? [])
        if (!seen.has(w)) {
          seen.set(w, queue[i]);
          queue.push(w);
        }
    below.set(from, seen);
    return seen;
  };
  const later = (a: string, b: string) => a !== b && reach(a).has(b);
  return {
    later,
    before: (a, b) => later(b, a) && !later(a, b),
    chain: (a, b) => {
      const seen = reach(a);
      if (a === b || !seen.has(b)) return null;
      const path: RelationEdge[] = [];
      for (let v = b; v !== a; v = seen.get(v)!) path.unshift({ later: seen.get(v)!, earlier: v });
      return path;
    },
    sequenceBefore: (p, q) => q.some((y) => p.some((x) => later(y, x))) && !p.some((x) => q.some((y) => later(x, y))),
  };
}

/**
 * Items reordered so that `before(a, b)` puts a ahead of b, otherwise keeping
 * their order: each step takes the first item nothing left must precede.
 * Items caught in a cycle of `before` keep their order among themselves.
 */
export function stableOrder<T>(items: readonly T[], before: (a: T, b: T) => boolean): T[] {
  const n = items.length;
  const pred: number[][] = items.map((_, i) => items.flatMap((_, j) => (i !== j && before(items[j], items[i]) ? [j] : [])));
  // strongly connected components (Tarjan); constraints inside one are dropped
  const comp = new Int32Array(n).fill(-1);
  const index = new Int32Array(n).fill(-1), low = new Int32Array(n);
  const stack: number[] = [];
  const onStack = new Uint8Array(n);
  let counter = 0, comps = 0;
  const visit = (v: number) => {
    index[v] = low[v] = counter++;
    stack.push(v);
    onStack[v] = 1;
    for (const w of pred[v]) {
      if (index[w] < 0) {
        visit(w);
        low[v] = Math.min(low[v], low[w]);
      } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
    }
    if (low[v] === index[v]) {
      let w: number;
      do {
        w = stack.pop()!;
        onStack[w] = 0;
        comp[w] = comps;
      } while (w !== v);
      comps++;
    }
  };
  for (let v = 0; v < n; v++) if (index[v] < 0) visit(v);
  const placed = new Uint8Array(n);
  const out: T[] = [];
  while (out.length < n) {
    let next = -1;
    for (let i = 0; i < n && next < 0; i++) if (!placed[i] && pred[i].every((j) => placed[j] || comp[j] === comp[i])) next = i;
    placed[next] = 1;
    out.push(items[next]);
  }
  return out;
}

/**
 * The sequences in the order the relations call for (earliest first), and
 * the members of each ordered sequence likewise. Whatever the relations do not
 * decide keeps the order it had; scars or sequences caught in a cycle keep
 * theirs among themselves (the checks report the cycle).
 */
export function orderSequences<T extends Pick<SequenceInput, 'scarIds' | 'ordered'>>(scarIds: readonly string[], edges: readonly RelationEdge[], sequences: readonly T[]): T[] {
  const s = stratigraphy(scarIds, edges);
  const inner = sequences.map((q) => {
    if (!q.ordered || q.scarIds.length < 2) return q;
    const ids = stableOrder(q.scarIds, s.before);
    return ids.every((id, i) => id === q.scarIds[i]) ? q : { ...q, scarIds: ids };
  });
  return stableOrder(inner, (p, q) => s.sequenceBefore(p.scarIds, q.scarIds));
}

export interface HarrisLayout {
  width: number;
  height: number;
  nodes: Array<{ id: string; x: number; y: number }>;
  edges: Array<{ from: string; to: string; cycle: boolean }>;
  boxes: Array<{ sequence: string; label: string; x: number; y: number; w: number; h: number }>;
  /** Scars without any "cuts" relation, set apart in their own column (not in the matrix proper). */
  unrelated: string[];
}

/**
 * Harris matrix: one node per scar, later scars higher up (rows by the longest
 * chain of relations below them, cycles ignored), grouped side by side by
 * sequence, with only the direct relations drawn. Scars without any "cuts"
 * relation (none, or only "cannot tell") stand apart in a last column,
 * framed and labelled `unrelatedLabel`.
 */
export function harrisLayout(
  scarIds: string[],
  edges: RelationEdge[],
  sequences: SequenceInput[],
  checks: RelationChecks,
  cell = { w: 64, h: 52, pad: 14 },
  unrelatedLabel = '',
): HarrisLayout {
  const all = new Set(scarIds);
  const valid = edges.filter((e) => all.has(e.later) && all.has(e.earlier) && e.later !== e.earlier);
  const related = new Set(valid.flatMap((e) => [e.later, e.earlier]));
  const unrelated = scarIds.filter((id) => !related.has(id));
  scarIds = scarIds.filter((id) => related.has(id));
  const known = new Set(scarIds);
  const cyc = new Set(checks.cycleEdges.map(key));
  // rank = longest chain of earlier scars (without cycle edges)
  const below = new Map<string, string[]>();
  for (const e of valid) if (!cyc.has(key(e))) (below.get(e.later) ?? below.set(e.later, []).get(e.later)!).push(e.earlier);
  const rank = new Map<string, number>();
  const rankOf = (v: string, trail: Set<string>): number => {
    if (rank.has(v)) return rank.get(v)!;
    if (trail.has(v)) return 0;
    trail.add(v);
    const r = Math.max(-1, ...(below.get(v) ?? []).map((w) => rankOf(w, trail))) + 1;
    trail.delete(v);
    rank.set(v, r);
    return r;
  };
  scarIds.forEach((id) => rankOf(id, new Set()));
  const top = Math.max(0, ...rank.values());
  // groups: sequences in order, then the scars in none
  const groups: Array<{ sequence: string; label: string; ids: string[] }> = sequences.map((s) => ({ sequence: s.id, label: s.label, ids: s.scarIds.filter((id) => known.has(id)) }));
  const assigned = new Set(groups.flatMap((g) => g.ids));
  const rest = scarIds.filter((id) => !assigned.has(id));
  if (rest.length) groups.push({ sequence: '', label: '', ids: rest });
  const nodes: HarrisLayout['nodes'] = [];
  const boxes: HarrisLayout['boxes'] = [];
  let x0 = cell.pad;
  for (const g of groups) {
    if (!g.ids.length) continue;
    // columns within the group: as many as the busiest row
    const perRow = new Map<number, number>();
    let cols = 1;
    for (const id of g.ids) {
      const r = rank.get(id) ?? 0;
      const c = perRow.get(r) ?? 0;
      perRow.set(r, c + 1);
      cols = Math.max(cols, c + 1);
      nodes.push({ id, x: x0 + cell.pad + c * cell.w + cell.w / 2, y: cell.pad * 2 + (top - r) * cell.h + cell.h / 2 });
    }
    const ys = g.ids.map((id) => nodes.find((n) => n.id === id)!.y);
    if (g.sequence)
      boxes.push({ sequence: g.sequence, label: g.label, x: x0, y: Math.min(...ys) - cell.h / 2 - 4, w: cols * cell.w + 2 * cell.pad, h: Math.max(...ys) - Math.min(...ys) + cell.h + 8 });
    x0 += cols * cell.w + 3 * cell.pad;
  }
  // the unrelated scars: one column, from the top
  const rows = Math.max(scarIds.length ? top + 1 : 0, unrelated.length);
  if (unrelated.length) {
    unrelated.forEach((id, i) => nodes.push({ id, x: x0 + cell.pad + cell.w / 2, y: cell.pad * 2 + i * cell.h + cell.h / 2 }));
    boxes.push({ sequence: '', label: unrelatedLabel, x: x0, y: cell.pad * 2 - 4, w: cell.w + 2 * cell.pad, h: unrelated.length * cell.h + 8 });
    x0 += cell.w + 3 * cell.pad;
  }
  return {
    width: Math.max(x0, 2 * cell.pad + cell.w),
    height: Math.max(1, rows) * cell.h + 4 * cell.pad,
    nodes,
    edges: directRelations(valid, checks.cycleEdges).map((e) => ({ from: e.later, to: e.earlier, cycle: cyc.has(key(e)) })),
    boxes,
    unrelated,
  };
}

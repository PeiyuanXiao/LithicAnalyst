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

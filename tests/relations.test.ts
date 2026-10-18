import { describe, expect, it } from 'vitest';
import { checkRelations, directRelations, harrisLayout, relationInputs, relationProblems, relationResults, type RelationEdge } from '../src/compute/relations';
import { addScarVector, addSequence, deleteRelation, deleteScar, moveInSequence, moveSequence, setRelation, setScarSequence, updateSequence, updateSpecimen } from '../src/core/actions';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import { relationsCsv, seriesCsv } from '../src/io/csv';
import { harrisSvg } from '../src/render/harris';
import { sequenceColor } from '../src/render/sequenceColor';

const cut = (later: string, earlier: string): RelationEdge => ({ later, earlier });

describe('scar relations', () => {
  it('find cycles', () => {
    const c = checkRelations(['a', 'b', 'c', 'd'], [cut('a', 'b'), cut('b', 'c'), cut('c', 'a'), cut('d', 'a')], []);
    expect(c.cycles.map((x) => x.sort())).toEqual([['a', 'b', 'c']]);
    expect(c.cycleEdges).toHaveLength(3);
    expect(c.count).toBe(1);
    expect(checkRelations(['a', 'b'], [cut('a', 'b')], []).count).toBe(0);
  });

  it('find contradictions with the sequences and their order, and scars in none', () => {
    const seqs = [
      { id: 'q1', label: 'Q1', scarIds: ['a', 'b'], ordered: true },
      { id: 'q2', label: 'Q2', scarIds: ['c'], ordered: false },
    ];
    // c (Q2, later sequence) cuts a: fine. a (Q1) cuts c (Q2): contradiction.
    const c = checkRelations(['a', 'b', 'c', 'd'], [cut('c', 'a'), cut('a', 'c'), cut('a', 'b')], seqs);
    expect(c.sequenceConflicts.map((x) => [x.later, x.earlier])).toEqual([['a', 'c']]);
    // a is listed before b in Q1 (earlier), yet a cuts b
    expect(c.orderConflicts.map((x) => [x.later, x.earlier, x.sequence])).toEqual([['a', 'b', 'q1']]);
    expect(c.unassigned).toEqual(['d']);
    // the a ↔ c cycle, both conflicts, and the unassigned hint
    expect(c.count).toBe(4);
    // an unordered sequence has no order to contradict
    expect(checkRelations(['a', 'b'], [cut('a', 'b')], [{ ...seqs[0], ordered: false }]).orderConflicts).toEqual([]);
  });

  it('draw only direct relations, later scars higher up', () => {
    const edges = [cut('a', 'b'), cut('b', 'c'), cut('a', 'c'), cut('x', 'y'), cut('y', 'x')];
    const checks = checkRelations(['a', 'b', 'c', 'x', 'y'], edges, []);
    expect(directRelations(edges, checks.cycleEdges).map((e) => `${e.later}>${e.earlier}`).sort()).toEqual(['a>b', 'b>c', 'x>y', 'y>x']);
    const layout = harrisLayout(['a', 'b', 'c', 'x', 'y'], edges, [], checks);
    const y = Object.fromEntries(layout.nodes.map((n) => [n.id, n.y]));
    expect(y.a).toBeLessThan(y.b);
    expect(y.b).toBeLessThan(y.c);
    expect(layout.edges.filter((e) => e.cycle)).toHaveLength(2);
    // groups by sequence get a box
    const boxed = harrisLayout(['a', 'b', 'c'], edges.slice(0, 3), [{ id: 'q', label: 'Q1', scarIds: ['a', 'b'], ordered: false }], checkRelations(['a', 'b', 'c'], edges.slice(0, 3), []));
    expect(boxed.boxes.map((b) => b.label)).toEqual(['Q1']);
  });
});

describe('relations and sequences in a project', () => {
  const scars = (s: ProjectStore, n: number) =>
    Array.from({ length: n }, (_, i) => addScarVector(s, { start: [i, 0, 0], end: [i, 1, 0], startNormal: [0, 0, 1], endNormal: [0, 0, 1] }).id);

  it('keep one relation per pair, keep "cannot tell", and undo', () => {
    const s = new ProjectStore();
    const [a, b, c] = scars(s, 3);
    setRelation(s, a, b, 'a_cuts_b');
    setRelation(s, b, c, 'indeterminate');
    expect(s.state.relations.map((r) => [r.a, r.b, r.kind])).toEqual([
      [a, b, 'a_cuts_b'],
      [b, c, 'indeterminate'],
    ]);
    // the other way round replaces the pair's relation (same id)
    const id = s.state.relations[0].id;
    setRelation(s, b, a, 'a_cuts_b');
    expect(s.state.relations).toHaveLength(2);
    expect(s.state.relations[0]).toMatchObject({ id, a: b, b: a, kind: 'a_cuts_b' });
    expect(setRelation(s, a, a, 'a_cuts_b')).toBeNull();
    s.history.undo();
    expect(s.state.relations[0]).toMatchObject({ a, b });
    deleteRelation(s, id);
    expect(s.state.relations).toHaveLength(1);
    s.history.undo();
    expect(s.state.relations).toHaveLength(2);
  });

  it('build sequences, order them, and drop a deleted scar in one undo step', () => {
    const s = new ProjectStore();
    const [a, b, c] = scars(s, 3);
    const q1 = addSequence(s);
    const q2 = addSequence(s);
    expect([q1.label, q2.label, s.state.nextSequenceNumber]).toEqual(['Q1', 'Q2', 3]);
    setScarSequence(s, a, q1.id);
    setScarSequence(s, b, q1.id);
    setScarSequence(s, c, q2.id);
    setScarSequence(s, c, q1.id);
    expect(s.state.sequences.map((q) => q.scarIds)).toEqual([[a, b, c], []]);
    moveInSequence(s, c, -1);
    expect(s.state.sequences[0].scarIds).toEqual([a, c, b]);
    moveSequence(s, q2.id, -1);
    expect(s.state.sequences.map((q) => q.label)).toEqual(['Q2', 'Q1']);
    updateSequence(s, q1.id, { ordered: true });
    updateSequence(s, q1.id, { label: 'A' });
    setRelation(s, a, c, 'a_cuts_b');
    const before = structuredClone(s.state);
    deleteScar(s, c);
    expect(s.state.relations).toEqual([]);
    expect(s.state.sequences[1].scarIds).toEqual([a, b]);
    s.history.undo();
    expect(s.state.relations).toEqual(before.relations);
    expect(s.state.sequences).toEqual(before.sequences);
    expect(s.state.scars).toHaveLength(3);
    // undoing the first sequence also gives its number back
    while (s.history.canUndo) s.history.undo();
    expect([s.state.sequences.length, s.state.nextSequenceNumber]).toEqual([0, 1]);
  });

  it('save and read back; unknown scars and duplicates are dropped', () => {
    const s = new ProjectStore(emptyProject());
    updateSpecimen(s, { id: 'LB-2' });
    const [a, b, c] = scars(s, 3);
    setRelation(s, b, a, 'a_cuts_b');
    setRelation(s, c, a, 'indeterminate');
    const q = addSequence(s);
    setScarSequence(s, a, q.id);
    setScarSequence(s, b, q.id);
    updateSequence(s, q.id, { ordered: true });
    addSequence(s);
    const file = JSON.parse(JSON.stringify(serializeProject(s.state, '0.2.0')));
    const back = parseProjectFile(file);
    expect(back.relations).toEqual(s.state.relations);
    expect(back.sequences).toEqual(s.state.sequences);
    expect(back.nextSequenceNumber).toBe(3);
    expect(file.derived.relations).toMatchObject({ count: 1, unassigned: [c], direct: [{ later: b, earlier: a }] });

    file.annotations.relations.push({ a, b, kind: 'indeterminate' }, { a, b: 'gone', kind: 'a_cuts_b' });
    file.annotations.sequences[1].scarIds = [a, c, 'gone'];
    const again = parseProjectFile(file);
    expect(again.relations).toHaveLength(2);
    expect(again.sequences[1].scarIds).toEqual([c]);
    file.annotations.relations[0].kind = 'before';
    expect(() => parseProjectFile(file)).toThrow(/Relation 1: unknown kind/);

    expect(relationsCsv(s.state, { excelBom: false })).toBe('specimen_id,scar_a,scar_b,relation\nLB-2,S2,S1,a_cuts_b\nLB-2,S3,S1,indeterminate\n');
    expect(seriesCsv(s.state, { excelBom: false })).toBe('specimen_id,series_id,series_order,scar_id,order_in_series\nLB-2,Q1,1,S1,1\nLB-2,Q1,1,S2,2\n');
    updateSequence(s, q.id, { ordered: false });
    expect(seriesCsv(s.state, { excelBom: false }).split('\n')[1]).toBe('LB-2,Q1,1,S1,');
  });

  it('list the problems with their scars, and redraw the matrix as relations change', () => {
    const s = new ProjectStore();
    const [a, b, c] = scars(s, 3);
    setRelation(s, a, b, 'a_cuts_b');
    setRelation(s, b, c, 'a_cuts_b');
    const layout = () => {
      const { scarIds, edges, sequences } = relationInputs(s.state);
      return harrisLayout(scarIds, edges, sequences, checkRelations(scarIds, edges, sequences));
    };
    const rows = () => Object.fromEntries(layout().nodes.map((n) => [s.scar(n.id)!.label, n.y]));
    expect(new Set(Object.values(rows())).size).toBe(3);
    setRelation(s, c, a, 'a_cuts_b');
    const r = relationResults(s.state);
    expect(relationProblems(r)).toEqual([{ kind: 'cycle', scars: expect.arrayContaining([a, b, c]) }]);
    expect(layout().edges.every((e) => e.cycle)).toBe(true);
    s.history.undo();
    expect(relationResults(s.state).count).toBe(0);
    expect(rows().S1).toBeLessThan(rows().S2);
    // the SVG: one node per scar, one line per direct relation
    const svg = harrisSvg(layout(), { labels: new Map(s.state.scars.map((x) => [x.id, x.label])), fills: new Map(), selected: a });
    expect(svg.match(/class="hm-node"/g)).toHaveLength(3);
    expect(svg.match(/<line /g)).toHaveLength(2);
    expect(svg).toContain(`data-id="${a}"`);
    const q = addSequence(s);
    setScarSequence(s, b, q.id);
    const p = relationProblems(relationResults(s.state));
    expect(p).toEqual([{ kind: 'unassigned', scars: [a, c] }]);
  });

  it('colour a sequence from light (earliest) to dark (latest)', () => {
    const lum = (hex: string) => [1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0);
    const cols = [0, 1, 2].map((k) => sequenceColor(0, k, 3, true));
    expect(lum(cols[0])).toBeGreaterThan(lum(cols[1]));
    expect(lum(cols[1])).toBeGreaterThan(lum(cols[2]));
    expect(sequenceColor(1, 0, 3, false)).toBe(sequenceColor(1, 2, 3, false));
    expect(sequenceColor(0, 0, 1, false)).not.toBe(sequenceColor(1, 0, 1, false));
  });
});

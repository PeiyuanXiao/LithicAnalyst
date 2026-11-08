import { describe, expect, it } from 'vitest';
import { checkRelations, directRelations, harrisLayout, orderSequences, relationInputs, relationProblems, relationResults, stableOrder, stratigraphy, type RelationEdge } from '../src/compute/relations';
import { addScarVector, addSequence, deleteRelation, deleteScar, moveInSequence, moveSequence, setRelation, setScarSequence, updateSequence, updateSpecimen } from '../src/core/actions';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import { relationsCsv, seriesCsv } from '../src/io/csv';
import { HARRIS_PRINT, HARRIS_SCREEN, harrisSvg } from '../src/render/harris';
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

describe('sequence order from the relations', () => {
  const ordered = (id: string, scarIds: string[]) => ({ id, label: id, scarIds, ordered: true });
  const members = (scarIds: string[], edges: RelationEdge[], ids: string[]) => orderSequences(scarIds, edges, [ordered('q', ids)])[0].scarIds;

  it('follows a chain of relations within a sequence (earliest first)', () => {
    // c cuts b cuts a: a, b, c
    expect(members(['a', 'b', 'c'], [cut('c', 'b'), cut('b', 'a')], ['c', 'a', 'b'])).toEqual(['a', 'b', 'c']);
    // the transitive closure counts: c cuts b, b cuts a, nothing direct between a and c
    expect(members(['a', 'b', 'c'], [cut('c', 'b'), cut('b', 'a')], ['c', 'b', 'a'])).toEqual(['a', 'b', 'c']);
  });

  it('counts relations through scars outside the sequence', () => {
    // b cuts x, x cuts a; x is in no sequence: a comes before b
    expect(members(['a', 'b', 'x'], [cut('b', 'x'), cut('x', 'a')], ['b', 'a'])).toEqual(['a', 'b']);
    const s = stratigraphy(['a', 'b', 'x'], [cut('b', 'x'), cut('x', 'a')]);
    expect(s.later('b', 'a')).toBe(true);
    expect(s.before('a', 'b')).toBe(true);
    expect(s.chain('b', 'a')).toEqual([cut('b', 'x'), cut('x', 'a')]);
    expect(s.chain('a', 'b')).toBeNull();
  });

  it('keeps the order where the relations decide nothing', () => {
    expect(members(['a', 'b', 'c', 'd'], [], ['d', 'b', 'c', 'a'])).toEqual(['d', 'b', 'c', 'a']);
    // only "c cuts a" is decided: c waits until a is placed; d, b and a keep their order
    expect(members(['a', 'b', 'c', 'd'], [cut('c', 'a')], ['d', 'c', 'b', 'a'])).toEqual(['d', 'b', 'a', 'c']);
    // already in order: nothing moves; an unordered sequence is left alone
    const q = ordered('q', ['a', 'b']);
    expect(orderSequences(['a', 'b'], [cut('b', 'a')], [q])[0]).toBe(q);
    const loose = { ...q, scarIds: ['b', 'a'], ordered: false };
    expect(orderSequences(['a', 'b'], [cut('b', 'a')], [loose])[0]).toBe(loose);
  });

  it('leaves a cycle in its order, and still orders the rest around it', () => {
    // a ↔ b cut each other: no order between them
    expect(members(['a', 'b'], [cut('a', 'b'), cut('b', 'a')], ['a', 'b'])).toEqual(['a', 'b']);
    expect(members(['a', 'b'], [cut('a', 'b'), cut('b', 'a')], ['b', 'a'])).toEqual(['b', 'a']);
    // a ↔ b, and both later than c (through a): c first, a and b as they were
    expect(members(['a', 'b', 'c'], [cut('a', 'b'), cut('b', 'a'), cut('a', 'c')], ['b', 'a', 'c'])).toEqual(['c', 'b', 'a']);
  });

  it('orders the sequences: P before Q when a member of Q is later than one of P and none of P later than one of Q', () => {
    const P = ordered('P', ['a']), Q = ordered('Q', ['b']), R = ordered('R', ['c']);
    // b cuts a: P before Q; c is unrelated and keeps its place
    expect(orderSequences(['a', 'b', 'c'], [cut('b', 'a')], [Q, R, P]).map((q) => q.id)).toEqual(['R', 'P', 'Q']);
    // through a scar in no sequence
    expect(orderSequences(['a', 'b', 'x'], [cut('b', 'x'), cut('x', 'a')], [Q, P]).map((q) => q.id)).toEqual(['P', 'Q']);
    // each later than the other somewhere: no order between them
    const P2 = ordered('P', ['a', 'd']);
    expect(orderSequences(['a', 'b', 'd'], [cut('b', 'a'), cut('d', 'b')], [Q, P2]).map((q) => q.id)).toEqual(['Q', 'P']);
    // members and sequences together
    const both = orderSequences(['a', 'b', 'c'], [cut('c', 'b'), cut('b', 'a')], [ordered('Q', ['c', 'b']), ordered('P', ['a'])]);
    expect(both.map((q) => [q.id, q.scarIds])).toEqual([
      ['P', ['a']],
      ['Q', ['b', 'c']],
    ]);
  });

  it('a sequence-level cycle keeps its order', () => {
    // P = {p1, p2}, Q = {q1, q2}, R = {r1, r2}: q1 > p1, r1 > q2, p2 > r2 and no scar cycle
    const P = ordered('P', ['p1', 'p2']), Q = ordered('Q', ['q1', 'q2']), R = ordered('R', ['r1', 'r2']);
    const edges = [cut('q1', 'p1'), cut('r1', 'q2'), cut('p2', 'r2')];
    expect(orderSequences(['p1', 'p2', 'q1', 'q2', 'r1', 'r2'], edges, [R, Q, P]).map((q) => q.id)).toEqual(['R', 'Q', 'P']);
  });

  it('stableOrder takes the first item that nothing left must precede', () => {
    const before = (x: number, y: number) => x === 3 && y === 1;
    expect(stableOrder([1, 2, 3, 4], before)).toEqual([2, 3, 1, 4]);
    expect(stableOrder([], before)).toEqual([]);
  });

  it('reorders in the same undo step as the change of relation or membership', () => {
    const s = new ProjectStore();
    const [a, b, c] = Array.from({ length: 3 }, (_, i) => addScarVector(s, { start: [i, 0, 0], end: [i, 1, 0], startNormal: [0, 0, 1], endNormal: [0, 0, 1] }).id);
    const q = addSequence(s, [a]);
    setScarSequence(s, b, q.id);
    setScarSequence(s, c, q.id);
    updateSequence(s, q.id, { ordered: true });
    expect(s.state.sequences[0].scarIds).toEqual([a, b, c]);
    // a cuts c: a goes after c
    setRelation(s, a, c, 'a_cuts_b');
    expect(s.state.sequences[0].scarIds).toEqual([b, c, a]);
    s.history.undo();
    expect([s.state.relations.length, s.state.sequences[0].scarIds]).toEqual([0, [a, b, c]]);
    s.history.redo();
    // reversing: c cuts a
    setRelation(s, c, a, 'a_cuts_b');
    expect(s.state.sequences[0].scarIds).toEqual([b, a, c]);
    // "cannot tell" decides nothing: the order stays
    setRelation(s, c, a, 'indeterminate');
    expect(s.state.sequences[0].scarIds).toEqual([b, a, c]);
    // a second sequence whose scar cuts b moves after the first … and b cuts it puts it first
    const r = addSequence(s);
    const d = addScarVector(s, { start: [9, 0, 0], end: [9, 1, 0], startNormal: [0, 0, 1], endNormal: [0, 0, 1] }).id;
    setRelation(s, b, d, 'a_cuts_b');
    setScarSequence(s, d, r.id);
    expect(s.state.sequences.map((x) => x.id)).toEqual([r.id, q.id]);
    s.history.undo();
    expect(s.state.sequences.map((x) => x.id)).toEqual([q.id, r.id]);
    // deleting the relation keeps the order (nothing is decided the other way)
    s.history.redo();
    deleteRelation(s, s.state.relations.find((x) => x.a === b)!.id);
    expect(s.state.sequences.map((x) => x.id)).toEqual([r.id, q.id]);
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
    // new sequences are ordered: their members follow the relations
    expect([q1.ordered, q2.ordered]).toEqual([true, true]);
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

    // a file keeps its own value: unordered as written, or (an earlier file without the key) unordered
    file.annotations.sequences[1].ordered = false;
    expect(parseProjectFile(file).sequences[1].ordered).toBe(false);
    delete file.annotations.sequences[1].ordered;
    expect(parseProjectFile(file).sequences[1].ordered).toBe(false);
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
    expect(svg.match(/class="hm-node( is-selected)?"/g)).toHaveLength(3);
    expect(svg.match(/<line /g)).toHaveLength(2);
    expect(svg).toContain(`data-id="${a}"`);
    // exported in print colours (hex only); on the page in the shell's, which follow the theme
    expect(svg).not.toContain('var(--');
    expect(svg.match(/class="hm-node is-selected"/g)).toHaveLength(1);
    const screen = harrisSvg(layout(), { labels: new Map(), fills: new Map([[b, '#3f7fd1']]), selected: a }, HARRIS_SCREEN);
    expect(screen).toContain(`fill="${HARRIS_SCREEN.selectedFill}"`);
    expect(screen).toContain(`stroke="${HARRIS_SCREEN.line}"`);
    expect(screen).toContain('fill="#3f7fd1"');
    expect(screen.match(/fill="var\(--surface\)"/g)).toHaveLength(1);
    expect(HARRIS_PRINT.background).toBeNull();
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

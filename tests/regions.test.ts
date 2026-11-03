import { describe, expect, it } from 'vitest';
import { buildAdjacency } from '../src/compute/curvature';
import { buildEdges, surfaceArea } from '../src/compute/meshGeometry';
import { polylineEdges, regionsSteps, resolveRegions } from '../src/compute/regions';
import { runSync } from '../src/compute/steps';
import { PathSearch } from '../src/compute/surfacePath';
import { addRegion, addScarVector, deleteRegion, setRegionType } from '../src/core/actions';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { ProjectStore } from '../src/core/store';
import type { Vec3 } from '../src/core/types';
import { measurementsCsv, regionsCsv } from '../src/io/csv';
import { box } from './meshes';

describe('regions bounded by curves', () => {
  const b = box([2, 2, 2], 4);
  const vc = b.positions.length / 3;
  const edges = buildEdges(b.index, vc);
  const P = (v: number): Vec3 => [b.positions[3 * v], b.positions[3 * v + 1], b.positions[3 * v + 2]];
  const nearest = (p: Vec3) => {
    let best = 0, bd = Infinity;
    for (let v = 0; v < vc; v++) {
      const d = Math.hypot(P(v)[0] - p[0], P(v)[1] - p[1], P(v)[2] - p[2]);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  };
  const search = new PathSearch(b.positions, buildAdjacency(b.index, vc));
  const path = (a: number, c: number) => {
    search.start(a, null);
    return search.reach(c) ? search.path(c) : null;
  };
  // a closed curve around the box at mid-height, given only by its four corners: the gaps are filled along mesh edges
  const ring: Vec3[] = [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]];
  const faceOf = (p: Vec3) => {
    // the triangle whose centroid is nearest
    let best = 0, bd = Infinity;
    for (let t = 0; t < b.index.length / 3; t++) {
      const c = [0, 1, 2].map((k) => (P(b.index[3 * t])[k] + P(b.index[3 * t + 1])[k] + P(b.index[3 * t + 2])[k]) / 3);
      const d = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  };

  it('split the surface where curves close, with exact areas', () => {
    const barrier = polylineEdges(ring, true, nearest, edges, path);
    expect(barrier.length / 2).toBe(16);
    const part = runSync(regionsSteps(b.positions, b.index, edges, barrier));
    expect(part.count).toBe(2);
    expect([...part.areas].sort()).toEqual([12, 12]);
    // an open curve does not close anything
    const open = polylineEdges(ring, false, nearest, edges, path);
    expect(runSync(regionsSteps(b.positions, b.index, edges, open)).count).toBe(1);
  });

  it('take their type from seeds, count each piece once, and flag two seeds in one piece', () => {
    const s = new ProjectStore();
    const arrow = addScarVector(s, { start: [0, 0, 1], end: [0.5, 0, 1], startNormal: [0, 0, 1], endNormal: [0, 0, 1] });
    const top = addRegion(s, [0.1, 0.1, 1], 'scar', arrow.id);
    const bottom = addRegion(s, [0.1, 0.1, -1], 'cortex', null);
    expect(s.state.scars).toHaveLength(1);
    const part = runSync(regionsSteps(b.positions, b.index, edges, polylineEdges(ring, true, nearest, edges, path)));
    const comp = s.state.regions.map((r) => part.region[faceOf(r.seed)]);
    const { results, totals } = resolveRegions(s.state.regions, comp, part, surfaceArea(b.positions, b.index));
    expect(results.map((r) => [r.label, r.type, r.area, r.conflict])).toEqual([
      ['R1', 'scar', 12, false],
      ['R2', 'cortex', 12, false],
    ]);
    expect(totals).toEqual({ scar: 12, cortex: 12, joint: 0, damage: 0, platform: 0, cortexRatio: 0.5 });

    // a second seed in the bottom half: conflict, and the half counts once
    addRegion(s, [0.5, 0.5, -1], 'joint', null);
    const comp2 = s.state.regions.map((r) => part.region[faceOf(r.seed)]);
    const two = resolveRegions(s.state.regions, comp2, part, 24);
    expect(two.results.map((r) => r.conflict)).toEqual([false, true, true]);
    expect(two.totals.joint).toBe(0);

    // a scar region without an arrow gets a scar without a direction, in the same undo step
    setRegionType(s, bottom.id, 'scar', null);
    expect(s.state.scars).toHaveLength(2);
    expect(s.state.scars[1].vector).toBeNull();
    expect(s.region(bottom.id)!.scarId).toBe(s.state.scars[1].id);
    // …and loses it again when it stops being a scar
    setRegionType(s, bottom.id, 'damage', null);
    expect(s.state.scars).toHaveLength(1);
    s.history.undo();
    expect(s.state.scars).toHaveLength(2);
    s.history.undo();
    expect(s.state.scars).toHaveLength(1);
    expect(s.region(bottom.id)!.type).toBe('cortex');

    deleteRegion(s, top.id);
    expect(s.state.regions.map((r) => r.label)).toEqual(['R2', 'R3']);
    s.history.undo();
    const back = parseProjectFile(JSON.parse(JSON.stringify(serializeProject(s.state, '0.2.0'))));
    expect(back.regions).toEqual(s.state.regions);
    expect(back.nextRegionNumber).toBe(4);

    expect(regionsCsv(s.state, results, { excelBom: false })).toBe('specimen_id,region_id,type,scar_id,area,unit\n,R1,scar,S1,12,mm\n,R2,cortex,,12,mm\n');
    expect(measurementsCsv(s.state, null, { excelBom: false }, totals).split('\n')[1].endsWith(',12,12,0,0,0.5,,,,,,')).toBe(true);
  });
});

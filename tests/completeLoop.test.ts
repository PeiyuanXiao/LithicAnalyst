import { describe, expect, it } from 'vitest';
import { completeLoopSteps } from '../src/compute/completeLoop';
import { buildAdjacency } from '../src/compute/curvature';
import { buildEdges } from '../src/compute/meshGeometry';
import { runSync } from '../src/compute/steps';
import { featureCost } from '../src/compute/surfacePath';
import { addCurve, completeCurveLoop, setCurveShape } from '../src/core/actions';
import { autoSegments, editedCompletion } from '../src/core/curveGeometry';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { ProjectStore } from '../src/core/store';
import type { Vec3 } from '../src/core/types';
import { bicone } from './meshes';

const R = 30, SEG = 96;
const mesh = bicone(R, 10, 20, SEG, 6);
const count = mesh.positions.length / 3;
const point = (v: number): Vec3 => [mesh.positions[3 * v], mesh.positions[3 * v + 1], mesh.positions[3 * v + 2]];
const adjacency = buildAdjacency(mesh.index, count);
// the rim is the one ridge
const strength = new Float32Array(count).map((_, v) => (Math.abs(mesh.positions[3 * v + 2]) < 1e-6 && Math.hypot(mesh.positions[3 * v], mesh.positions[3 * v + 1]) > 1 ? 0.9 : 0));
const cost = featureCost(strength);

/** The rim vertices over the first `deg` degrees (an open curve along the edge, as traced). */
const arc = (deg: number): number[] => Array.from({ length: Math.round((deg / 360) * SEG) + 1 }, (_, j) => mesh.rim + j);

const complete = (verts: number[], points = verts.map(point)) =>
  runSync(completeLoopSteps({ positions: mesh.positions, adjacency, strength, cost, points, first: verts[0], last: verts[verts.length - 1] }));

describe('complete loop', () => {
  it('carries a curve over 120° of the rim round to its start, on the rim', () => {
    const verts = arc(120);
    const res = complete(verts);
    if (!res.ok) throw new Error(res.reason);
    expect(res.chains.length).toBe(res.anchors.length + 1);
    // chains join up: each starts where the last one ended, the last ends at the curve's start
    const stops = [verts[verts.length - 1], ...res.anchors, verts[0]];
    res.chains.forEach((ch, i) => {
      expect(ch[0]).toBe(stops[i]);
      expect(ch[ch.length - 1]).toBe(stops[i + 1]);
    });
    const loop = [...verts, ...res.chains.flatMap((ch) => Array.from(ch).slice(1))].map(point);
    loop.pop();
    // every point within two mean edge lengths of the rim
    const edges = buildEdges(mesh.index, count);
    let sum = 0;
    for (let e = 0; e < edges.v0.length; e++) {
      const a = point(edges.v0[e]), b = point(edges.v1[e]);
      sum += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    }
    const meanEdge = sum / edges.v0.length;
    for (const p of loop) expect(Math.hypot(Math.hypot(p[0], p[1]) - R, p[2])).toBeLessThan(2 * meanEdge);
    // the area it encloses: within 5 % of the circle's
    let a2 = 0;
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i], q = loop[(i + 1) % loop.length];
      a2 += p[0] * q[1] - q[0] * p[1];
    }
    expect(Math.abs(Math.abs(a2 / 2) / (Math.PI * R * R) - 1)).toBeLessThan(0.05);
    // anchors about every 2°: a rim vertex every 3.75° is every other bin, so about 64 of them
    expect(res.anchors.length).toBeGreaterThan(50);
  });

  it('goes either way round, and turns down a curve too short or too straight', () => {
    const back = arc(150).reverse();
    expect(complete(back).ok).toBe(true);
    expect(complete(arc(60))).toEqual({ ok: false, reason: 'short' });
    // a straight line across the top cone
    const line: Vec3[] = Array.from({ length: 10 }, (_, i) => [-10 + (20 * i) / 9, 0.001 * i, 3]);
    expect(runSync(completeLoopSteps({ positions: mesh.positions, adjacency, strength, cost, points: line, first: 0, last: 1 }))).toEqual({ ok: false, reason: 'short' });
  });

  it('fails when no way round is left on the surface', () => {
    // the rim cut out of the mesh: no path from the curve's end back to its start along it
    const verts = arc(120);
    const cut = new Float32Array(cost).fill(1);
    const island = buildAdjacency(mesh.index.filter((_, i, all) => {
      const t = i - (i % 3);
      return [all[t], all[t + 1], all[t + 2]].every((v) => v !== mesh.rim + 70);
    }), count);
    // vertex rim + 70 left unconnected: the outline still finds it; the trace cannot reach it
    const res = runSync(completeLoopSteps({ positions: mesh.positions, adjacency: island, strength: null, cost: cut, points: verts.map(point), first: verts[0], last: verts[verts.length - 1] }));
    expect(res).toEqual({ ok: false, reason: 'loop' });
  });
});

describe('completed loops', () => {
  const shape = () => {
    const pts = arc(360).slice(0, SEG).map(point);
    return { anchors: [pts[0], pts[24], pts[48], pts[72]], points: pts, anchorIndex: [0, 24, 48, 72], closed: true };
  };

  it('dash the segments next to an automatic anchor until the user has moved them all', () => {
    const k = { method: 'outline' as const, firstAutoAnchor: 2, stepDeg: 2 };
    expect(autoSegments({ ...shape(), completion: k })).toEqual([false, true, true, true]);
    const s = shape();
    const moved = s.anchors.map((p, i) => (i === 3 ? ([p[0], p[1], p[2] + 1] as Vec3) : p));
    const k2 = editedCompletion(k, s.anchors, moved)!;
    expect(k2).toEqual({ method: 'outline', firstAutoAnchor: 2, stepDeg: 2, userAnchors: [3] });
    expect(autoSegments({ ...s, completion: k2 })).toEqual([false, true, true, false]);
    const moved2 = moved.map((p, i) => (i === 2 ? ([p[0], p[1], p[2] + 1] as Vec3) : p));
    expect(editedCompletion(k2, moved, moved2)).toBeUndefined();
    // a user anchor moved: nothing changes
    expect(editedCompletion(k, s.anchors, s.anchors.map((p, i) => (i === 0 ? ([0, 0, 0] as Vec3) : p)))).toEqual(k);
  });

  it('one step completes the loop, undo takes it back; moving an automatic anchor makes it the user\'s', () => {
    const store = new ProjectStore();
    const s = shape();
    const open = { anchors: s.anchors.slice(0, 3), points: s.points.slice(0, 49), anchorIndex: [0, 24, 48], closed: false };
    const c = addCurve(store, open);
    completeCurveLoop(store, c.id, s, { method: 'outline', firstAutoAnchor: 3, stepDeg: 2 });
    expect(store.curve(c.id)!.closed).toBe(true);
    expect(store.curve(c.id)!.completion).toEqual({ method: 'outline', firstAutoAnchor: 3, stepDeg: 2 });
    // saved and read back
    expect(parseProjectFile(JSON.parse(JSON.stringify(serializeProject(store.state, 'test')))).curves[0].completion).toEqual({ method: 'outline', firstAutoAnchor: 3, stepDeg: 2 });
    store.history.undo();
    expect(store.curve(c.id)!.closed).toBe(false);
    expect(store.curve(c.id)!.completion).toBeUndefined();
    store.history.redo();
    // the one automatic anchor moved: no completion left
    setCurveShape(store, c.id, { ...s, anchors: s.anchors.map((p, i) => (i === 3 ? ([p[0], p[1], p[2] + 1] as Vec3) : p)) });
    expect(store.curve(c.id)!.completion).toBeUndefined();
    // a file with a completion that does not fit its curve: dropped
    const raw = JSON.parse(JSON.stringify(serializeProject(store.state, 'test')));
    raw.annotations.curves[0].completion = { method: 'outline', firstAutoAnchor: 9, stepDeg: 2 };
    expect(parseProjectFile(raw).curves[0].completion).toBeUndefined();
  });
});

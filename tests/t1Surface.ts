import { buildEdges } from '../src/compute/meshGeometry';
import { joinOpenEndsSteps, polylineEdges, regionsSteps } from '../src/compute/regions';
import { runSync } from '../src/compute/steps';
import type { Vec3 } from '../src/core/types';
import { flakeT1 } from './meshes';

/** T1 with all that goes with a mesh, by hand. */
export function onT1() {
  const m = flakeT1(1);
  const pos = m.positions, idx = m.index;
  const edges = buildEdges(idx, pos.length / 3);
  let sum = 0;
  const nbr = new Map<number, Array<[number, number]>>();
  for (let i = 0; i < edges.v0.length; i++) {
    const a = edges.v0[i], b = edges.v1[i];
    const d = Math.hypot(pos[3 * a] - pos[3 * b], pos[3 * a + 1] - pos[3 * b + 1], pos[3 * a + 2] - pos[3 * b + 2]);
    sum += d;
    (nbr.get(a) ?? nbr.set(a, []).get(a)!).push([b, d]);
    (nbr.get(b) ?? nbr.set(b, []).get(b)!).push([a, d]);
  }
  const path = (from: number, to: number): number[] | null => {
    const dist = new Map<number, number>([[from, 0]]);
    const prev = new Map<number, number>();
    const open = new Set<number>([from]);
    while (open.size) {
      let u = -1, least = Infinity;
      for (const v of open) {
        if (dist.get(v)! < least) {
          least = dist.get(v)!;
          u = v;
        }
      }
      open.delete(u);
      if (u === to) break;
      for (const [v, d] of nbr.get(u) ?? []) {
        if (least + d < (dist.get(v) ?? Infinity)) {
          dist.set(v, least + d);
          prev.set(v, u);
          open.add(v);
        }
      }
    }
    if (!dist.has(to)) return null;
    const out = [to];
    while (out[out.length - 1] !== from) out.push(prev.get(out[out.length - 1])!);
    return out.reverse();
  };
  const nearestVertex = (p: Vec3): number => {
    let best = -1, bd = Infinity;
    for (let v = 0; v < pos.length / 3; v++) {
      const d = (pos[3 * v] - p[0]) ** 2 + (pos[3 * v + 1] - p[1]) ** 2 + (pos[3 * v + 2] - p[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  };
  const faceAt = (p: Vec3): number => {
    let best = -1, bd = Infinity;
    for (let t = 0; 3 * t + 2 < idx.length; t++) {
      const c = [0, 1, 2].map((k) => (pos[3 * idx[3 * t] + k] + pos[3 * idx[3 * t + 1] + k] + pos[3 * idx[3 * t + 2] + k]) / 3);
      const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  };
  const meanEdge = sum / edges.v0.length;
  return {
    m,
    edges,
    meanEdge,
    path,
    faceAt,
    chain: (pts: Vec3[], closed: boolean) => polylineEdges(pts, closed, nearestVertex, edges, path),
    pieces: (barrier: number[]) => runSync(regionsSteps(pos, idx, edges, barrier)),
    join: (chains: number[][], open: boolean[], boundary?: boolean[]) => runSync(joinOpenEndsSteps(chains, open, pos, 4 * meanEdge, path, boundary)),
  };
}

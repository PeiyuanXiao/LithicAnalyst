import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { addCurveOfType, moveLandmark, placePlatformEnd, setTechnicalAxis, updateSpecimen } from '../src/core/actions';
import { frameMatrix } from '../src/core/frame';
import { serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import { T8, t8Arcs, t8Dorsal, t8Mesh, t8Ply, t8Rings, type Vec3 } from './fixtures/meshes';
import { expect, fileMenu, loadMesh, openApp } from './helpers';

/** T8 annotated as a flake, as a project file of t8.ply: its platform outline, its edge, the technical axis and two platform ends by hand. */

/** The platform ends, 6 mm either side on the platform's dorsal edge. */
export const T8_ENDS: [Vec3, Vec3] = [[-6, 0, t8Dorsal(6)], [6, 0, t8Dorsal(6)]];

export function t8Project(annotator: string, o: { P?: Vec3; ends?: [Vec3, Vec3]; unit?: string } = {}): { name: string; text: string } {
  const ply = t8Ply().buffer;
  const m = t8Mesh();
  const rings = t8Rings(false), arcs = t8Arcs(false), R = T8.R;
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], m.positions[i]);
    hi[i % 3] = Math.max(hi[i % 3], m.positions[i]);
  }
  const initial = emptyProject();
  initial.mesh = { fileName: 't8.ply', format: 'ply', fileSize: ply.length, sha256: createHash('sha256').update(ply).digest('hex'), vertexCount: m.positions.length / 3, triangleCount: m.index.length / 3, bboxMin: lo, bboxMax: hi };
  const s = new ProjectStore(initial);
  updateSpecimen(s, { type: 'flake', annotator, unit: o.unit ?? 'mm', id: 'T8' }, false);
  // the platform: along its ventral edge, then back along its dorsal edge (the dome's top over y = 0)
  const out = rings.slice(0, -1);
  const bottom: Vec3[] = [...[...rings].reverse().map((r): Vec3 => [-r, 0, 0]), [0, 0, 0], ...rings.map((r): Vec3 => [r, 0, 0])];
  const top: Vec3[] = [...[...out].reverse().map((r): Vec3 => [r, 0, t8Dorsal(r)]), [0, 0, T8.D], ...out.map((r): Vec3 => [-r, 0, t8Dorsal(r)])];
  const outline = [...bottom, ...top];
  const corner = bottom.length - 1;
  addCurveOfType(s, { anchors: [outline[0], outline[corner], [0, 0, T8.D]], points: outline, anchorIndex: [0, corner, bottom.length + out.length], closed: true }, 'platform_outline');
  // the edge: round the rim from one side of the platform to the other
  const rim: Vec3[] = Array.from({ length: arcs + 1 }, (_, j): Vec3 => {
    if (j === 0) return [-R, 0, 0];
    if (j === arcs) return [R, 0, 0];
    const f = ((-90 + (180 * j) / arcs) * Math.PI) / 180;
    return [R * Math.sin(f), R * Math.cos(f), 0];
  });
  addCurveOfType(s, { anchors: [rim[0], rim[(arcs - 1) / 2], rim[arcs]], points: rim, anchorIndex: [0, (arcs - 1) / 2, arcs], closed: false }, 'edge');
  // the technical axis from P (the exact frame of T8), and the platform ends by hand
  const P = o.P ?? [0, 0, 0];
  setTechnicalAxis(s, { start: P, end: [P[0], 15, 0], startNormal: [0, 0, -1], endNormal: [0, 0, -1], matrix: frameMatrix({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], origin: P }), failure: null });
  // the ends the curves gave (at the platform's corners), each moved by hand on its own side
  const ends = o.ends ?? T8_ENDS;
  const auto = s.state.landmarks.filter((l) => l.code === 'platform_end').sort((a, b) => a.point[0] - b.point[0]);
  if (auto.length === 2) auto.forEach((l, i) => moveLandmark(s, l.id, ends[i]));
  else for (const e of ends) placePlatformEnd(s, e);
  return { name: `t8.${annotator}.lithicanalyst.json`, text: JSON.stringify(serializeProject(s.state, 'test')) };
}

/** T8 open as a flake, its project applied, measured. */
export async function openT8(page: Page, o: Parameters<typeof t8Project>[1] = {}): Promise<void> {
  await openApp(page, 'flake');
  await loadMesh(page, t8Ply());
  const file = t8Project('A', o);
  const chooser = page.waitForEvent('filechooser');
  await fileMenu(page, '#btn-open-project');
  await (await chooser).setFiles({ name: file.name, mimeType: 'application/json', buffer: Buffer.from(file.text) });
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.state().curves.length)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.flake()?.measures?.psia ?? null), { timeout: 30_000 }).not.toBeNull();
}

import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { addCurveOfType, setTechnicalAxis, updateSpecimen } from '../src/core/actions';
import { frameMatrix } from '../src/core/frame';
import { serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import { flakeT9 } from '../tests/meshes';
import { T9, t9Ply, type Vec3 } from './fixtures/meshes';
import { expect, fileMenu, loadMesh, openApp } from './helpers';

/** T9 annotated as a flake, as a project file of t9.ply: its platform outline A–B–C, its edge A–F–B, and the technical axis; no back ridge yet. */

/** A curve through these points, traced about half a millimetre apart as the app traces one. */
const traced = (corners: Vec3[], closed: boolean) => {
  const points: Vec3[] = [];
  const anchorIndex: number[] = [];
  const legs = closed ? corners.length : corners.length - 1;
  for (let i = 0; i < legs; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.5));
    anchorIndex.push(points.length);
    for (let j = 0; j < k; j++) points.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k, a[2] + ((b[2] - a[2]) * j) / k]);
  }
  if (!closed) {
    anchorIndex.push(points.length);
    points.push(corners[corners.length - 1]);
  }
  return { anchors: anchorIndex.map((i) => points[i]), points, anchorIndex, closed };
};

export function t9Project(): { name: string; text: string } {
  const ply = t9Ply().buffer;
  const m = flakeT9();
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], m.positions[i]);
    hi[i % 3] = Math.max(hi[i % 3], m.positions[i]);
  }
  const initial = emptyProject();
  initial.mesh = { fileName: 't9.ply', format: 'ply', fileSize: ply.length, sha256: createHash('sha256').update(ply).digest('hex'), vertexCount: m.positions.length / 3, triangleCount: m.index.length / 3, bboxMin: lo, bboxMax: hi };
  const s = new ProjectStore(initial);
  updateSpecimen(s, { type: 'flake', annotator: 'A', unit: 'mm', id: 'T9' }, false);
  const { A, B, C, F } = T9;
  addCurveOfType(s, traced([A, B, C], true), 'platform_outline');
  addCurveOfType(s, traced([A, F, B], false), 'edge');
  const P: Vec3 = [-2.5, 0, 0];
  setTechnicalAxis(s, { start: P, end: [5, 30, 0], startNormal: [0, 0, -1], endNormal: [0, 0, -1], matrix: frameMatrix({ origin: P, x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }), failure: null });
  return { name: 't9.A.lithicanalyst.json', text: JSON.stringify(serializeProject(s.state, 'test')) };
}

/** T9 open as a flake, its project applied, its faces found. */
export async function openT9(page: Page): Promise<void> {
  await openApp(page, 'flake');
  await loadMesh(page, t9Ply());
  const file = t9Project();
  const chooser = page.waitForEvent('filechooser');
  await fileMenu(page, '#btn-open-project');
  await (await chooser).setFiles({ name: file.name, mimeType: 'application/json', buffer: Buffer.from(file.text) });
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.state().curves.length)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.lithicanalyst.regions()?.results.find((r) => r.type === 'dorsal')?.area ?? null)).not.toBeNull();
}

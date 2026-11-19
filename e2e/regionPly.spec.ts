import { readFileSync } from 'node:fs';
import { BOX } from './fixtures/meshes';
import { expect, openSection, state, test } from './helpers';
import { boxScene } from './boxScene';

/** A binary little-endian PLY of float x, y, z and triangles, read back. */
function readPly(buf: Buffer): { header: string[]; vertices: number[][]; faces: number[][] } {
  const end = buf.indexOf('end_header\n') + 'end_header\n'.length;
  const header = buf.subarray(0, end).toString('utf8').trim().split('\n');
  const count = (el: string) => Number(header.find((l) => l.startsWith(`element ${el} `))!.split(' ')[2]);
  let at = end;
  const vertices: number[][] = [];
  for (let i = 0; i < count('vertex'); i++, at += 12) vertices.push([buf.readFloatLE(at), buf.readFloatLE(at + 4), buf.readFloatLE(at + 8)]);
  const faces: number[][] = [];
  for (let i = 0; i < count('face'); i++, at += 13) faces.push([buf.readUInt8(at), buf.readInt32LE(at + 1), buf.readInt32LE(at + 5), buf.readInt32LE(at + 9)]);
  expect(at).toBe(buf.length);
  return { header, vertices, faces };
}

test('a region as a PLY mesh: its triangles, its vertices in the file\'s coordinates, and where it came from', async ({ page, pageErrors }) => {
  const ids = await boxScene(page);
  await openSection(page, 'regions');
  await page.evaluate((id) => window.lithicanalyst.selectForTest(id), ids.scar);
  const button = page.locator('#region-ply');
  await expect(button).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(download.suggestedFilename()).toBe('box_R1_scar.ply');
  const ply = readPly(readFileSync((await download.path())!));
  const st = await state(page);
  expect(ply.header.slice(0, 2)).toEqual(['ply', 'format binary_little_endian 1.0']);
  expect(ply.header.filter((l) => l.startsWith('comment '))).toEqual([
    `comment LithicAnalyst ${await page.evaluate(() => window.lithicanalyst.version)}`,
    `comment specimen ${st.specimen.id}`,
    'comment region R1 scar',
    'comment unit mm',
    `comment source box.ply sha256 ${st.mesh!.sha256}`,
  ]);
  // as many triangles as the region's piece, each a triangle of its own vertices
  const faces = await page.evaluate((id) => window.lithicanalyst.regionFaceCount(id), ids.scar);
  expect(faces).toBeGreaterThan(0);
  expect(ply.faces.length).toBe(faces);
  expect(ply.faces.every((f) => f[0] === 3 && f.slice(1).every((v) => v >= 0 && v < ply.vertices.length))).toBe(true);
  expect(new Set(ply.vertices.map((v) => v.join())).size).toBe(ply.vertices.length);
  // the top face of the box, inside the rectangle, in the file's coordinates (the box is far from the origin)
  const top = BOX.center[2] + BOX.size[2] / 2;
  expect(ply.vertices.every((v) => Math.abs(v[2] - top) < 1e-3)).toBe(true);
  expect(ply.vertices.every((v) => Math.abs(v[0] - BOX.center[0]) <= 10 + 1e-3 && Math.abs(v[1] - BOX.center[1]) <= 5 + 1e-3)).toBe(true);
  // the area adds up to the region's
  const area = ply.faces.reduce((s, f) => {
    const [a, b, c] = [ply.vertices[f[1]], ply.vertices[f[2]], ply.vertices[f[3]]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    return s + Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
  }, 0);
  const res = (await page.evaluate(() => window.lithicanalyst.regions()))!.results.find((r) => r.id === ids.scar)!;
  expect(area).toBeCloseTo(res.area!, 2);
  expect(pageErrors).toEqual([]);
});

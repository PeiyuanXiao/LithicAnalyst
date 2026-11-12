import { describe, expect, it } from 'vitest';
import { computeConfiguration } from '../src/compute/configuration';
import { autoMeasurements, frameMeasures, surfaceMeasures } from '../src/compute/measure';
import { runSync } from '../src/compute/steps';
import { addLandmark, addPlane, addScarVector, updateSpecimen } from '../src/core/actions';
import { fmtDuration } from '../src/core/format';
import { frameFromView } from '../src/core/frame';
import { parseProjectFile, serializeProject } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import { batchOutputs, batchSpecimen, failuresCsv, iccCsv, mergeCsv, savedMeasures, savedResultsUsable, type BatchProject, type BatchSpecimen } from '../src/io/batch';
import { MeshJobs } from '../src/io/meshJobs';
import { ProjectIndex } from '../src/io/projectIndex';
import { classify, freshFolder, legacyProjectPathFor, projectPathFor, specimenIds, timeStamp, workspaceFromHandle, type DirectoryHandle } from '../src/io/workspace';
import { box, plyBytes } from './meshes';

function specimen(id: string, size: [number, number, number], observers: Record<string, Record<string, number>> = {}, arrows = 0): BatchSpecimen {
  const s = new ProjectStore(emptyProject());
  updateSpecimen(s, { id });
  for (let i = 0; i < arrows; i++) addScarVector(s, { start: [i, 0, 0], end: [i, 1, 0], startNormal: [0, 0, 1], endNormal: [0, 0, 1] });
  if (arrows) addLandmark(s, [0, 0, 0], 'apex');
  const b = box(size, 2);
  return {
    file: `site/${id}.ply`,
    state: s.state,
    auto: autoMeasurements(b.positions, surfaceMeasures(b.positions, b.index), null),
    planes: [],
    configuration: null,
    regions: [],
    regionTotals: null,
    nodule: null,
    split: null,
    flake: null,
    edgeAngles: [], retouchAngles: [], gm: null,
    observers: new Map(Object.entries(observers)),
  };
}

describe('batch outputs', () => {
  it('merge CSV texts under one header', () => {
    expect(mergeCsv(['﻿a,b\n1,2\n', 'a,b\n3,4\n', 'a,b\n'], false)).toBe('a,b\n1,2\n3,4\n');
    expect(mergeCsv(['a\n1\n'], true)).toBe('﻿a\n1\n');
  });

  it('one measurement row per specimen, with its file; kinds without rows are left out', () => {
    const out = batchOutputs([specimen('A', [40, 20, 10], {}, 2), specimen('B', [30, 20, 10])], { excelBom: false });
    expect(out.map((f) => f.suffix)).toEqual(['measurements.csv', 'scar_vectors.csv', 'landmarks.csv', 'landmarks.tps']);
    const rows = out[0].text.trim().split('\n');
    expect(rows).toHaveLength(3);
    expect(rows[0].endsWith(',volume_ratio,file')).toBe(true);
    expect(rows[1].startsWith('A,mm,principal,40,20,10,')).toBe(true);
    expect(rows[1].endsWith(',site/A.ply')).toBe(true);
    expect(rows[2].startsWith('B,mm,principal,30,20,10,')).toBe(true);
    expect(out[1].text.trim().split('\n')).toHaveLength(3);
    expect(out[3].text).toBe('LM3=1\n0 0 0\nID=A\n');
  });

  it('ICC(2,1) over the specimens every observer measured', () => {
    // Shrout & Fleiss (1979): 6 specimens × 4 observers → 0.29; a seventh specimen lacks one observer
    const data = [
      [9, 2, 5, 8],
      [6, 1, 3, 2],
      [8, 4, 6, 8],
      [7, 1, 2, 6],
      [10, 5, 6, 9],
      [6, 2, 4, 7],
    ];
    const specimens = data.map((row, i) => specimen(`S${i}`, [3, 2, 1], Object.fromEntries(row.map((v, k) => [`J${k + 1}`, { length: v }]))));
    specimens.push(specimen('S6', [3, 2, 1], { J1: { length: 1 }, J2: { length: 2 } }));
    const csv = iccCsv(specimens)!.split('\n');
    expect(csv[0]).toBe('measure,n_specimens,n_raters,icc');
    const [m, n, k, icc] = csv[1].split(',');
    expect([m, n, k]).toEqual(['length', '6', '4']);
    expect(Number(icc)).toBeCloseTo(0.29, 2);
    // one observer: no ICC
    expect(iccCsv([specimen('X', [1, 1, 1], { J1: { length: 1 } }), specimen('Y', [1, 1, 1], { J1: { length: 2 } })])).toBeNull();
  });

  it('the volumetric configuration: one row per configured specimen, with its file', () => {
    const a = specimen('A', [40, 20, 10], {}, 2), b = specimen('B', [30, 20, 10]);
    const mesh = box([40, 20, 10], 2);
    a.configuration = computeConfiguration(a.state.scars, a.state.configuration, frameMeasures(mesh.positions, surfaceMeasures(mesh.positions, mesh.index), null).box);
    const out = batchOutputs([a, b], { excelBom: false });
    const text = (suffix: string) => out.find((f) => f.suffix === suffix)!.text.trim().split('\n');
    expect(text('configuration.csv')).toEqual(['specimen_id,model,frame,facial_character,flaking_surface_relation,platform_relation,polarity,file', 'A,box,principal,unifacial,,single,unipolar_longitudinal,site/A.ply']);
    expect(text('flaking_surfaces.csv')[0]).toBe('specimen_id,surface_id,faces,platforms,also_platform,n_scars,surface_type,exploitation_axis,file');
    expect(text('scar_vectors.csv')[0].endsWith(',note,platform_face,flaking_surface,unit,tech_angle_deg,source')).toBe(true);
  });

  it('lists the models that failed', () => {
    expect(failuresCsv([{ file: 'a/b.ply', reason: 'bad, "header"' }], false)).toBe('file,reason\na/b.ply,"bad, ""header"""\n');
  });

  it('the results a project stored give the same tables as measuring the model again', async () => {
    const mesh = box([40, 20, 10], 4);
    const file = new File([plyBytes(mesh) as BlobPart], 'box.ply');
    const jobs = new MeshJobs(async (steps) => runSync(steps));
    const sha = await jobs.hash(1, file);
    // two observers: one along the principal axes, one along a frame of their own
    const frame = { matrix: frameFromView([0, 1, 1], [0, 0, 1], [0, 0, 0])!, source: 'view' };
    const measured = await jobs.measure(1, [null, frame]);
    const project = (annotator: string, f: typeof frame | null, k: number, version = '1.0.0'): BatchProject => {
      const s = new ProjectStore(emptyProject());
      s.setMesh({ fileName: 'box.ply', format: 'ply', fileSize: file.size, sha256: sha, vertexCount: 0, triangleCount: 0, bboxMin: [0, 0, 0], bboxMax: [0, 0, 0] });
      updateSpecimen(s, { id: 'box', annotator, frame: f });
      addPlane(s, 'all_vertices', [0, 0, 1]);
      addScarVector(s, { start: [0, 0, 5], end: [5, 0, 5], startNormal: [0, 0, 1], endNormal: [0, 0, 1] });
      const raw = JSON.parse(JSON.stringify(serializeProject(s.state, version, { measurements: measured.auto[k], vertices: measured.vertices, box: measured.boxes[k] })));
      return { path: `LithicAnalyst/projects/box.${annotator}.json`, state: parseProjectFile(raw), derived: raw.derived, appVersion: raw.app.version };
    };
    const ps = [project('A', null, 0), project('B', frame, 1)];
    expect(ps.every((p) => savedResultsUsable(p, '1.0.0'))).toBe(true);
    // another version, or results missing: the model is measured again
    expect(savedResultsUsable(ps[0], '1.0.1')).toBe(false);
    expect(savedResultsUsable({ ...ps[0], derived: { ...ps[0].derived, vertices: null } }, '1.0.0')).toBe(false);
    expect(savedResultsUsable({ ...ps[0], derived: { ...ps[0].derived, measurements: null } }, '1.0.0')).toBe(false);
    // a project with arrows needs the box of its volumetric configuration
    expect(savedResultsUsable({ ...ps[0], derived: { ...ps[0].derived, configuration: null } }, '1.0.0')).toBe(false);

    const fromSaved = batchSpecimen('box.ply', { project: ps[0], measures: savedMeasures(ps[0]) }, ps.map((p) => ({ project: p, measures: savedMeasures(p) })));
    const again = await new MeshJobs(async (steps) => runSync(steps)).hash(2, file).then(async () => null);
    expect(again).toBeNull();
    const jobs2 = new MeshJobs(async (steps) => runSync(steps));
    await jobs2.hash(2, file);
    const fresh = await jobs2.measure(2, ps.map((p) => p.state.specimen.frame));
    const measures = (k: number) => ({ auto: fresh.auto[k], vertices: fresh.vertices, box: fresh.boxes[k] });
    const fromMesh = batchSpecimen('box.ply', { project: ps[0], measures: measures(0) }, ps.map((p, k) => ({ project: p, measures: measures(k) })));
    const opts = { excelBom: false };
    expect(batchOutputs([fromSaved], opts)).toEqual(batchOutputs([fromMesh], opts));
    const tables = batchOutputs([fromSaved], opts).map((f) => f.suffix);
    expect(tables).toEqual(expect.arrayContaining(['measurements.csv', 'planes.csv', 'scar_vectors.csv', 'configuration.csv', 'flaking_surfaces.csv']));
    // the two observers measured along their own frames
    expect(fromSaved.observers.get('A')!.length).toBeCloseTo(40, 4);
    expect(fromSaved.observers.get('B')!.length).not.toBeCloseTo(40, 1);
  });
});

describe('the folder', () => {
  it("keeps the app's files in LithicAnalyst/, one project per model file", () => {
    expect(projectPathFor('site1/EXP03.ply')).toBe('LithicAnalyst/projects/site1/EXP03.ply.lithicanalyst.json');
    expect(projectPathFor('EXP03.stl')).not.toBe(projectPathFor('EXP03.ply'));
    expect(legacyProjectPathFor('site1/a.b.stl')).toBe('site1/a.b.lithicanalyst.json');
    expect(legacyProjectPathFor('LB-1.ply')).toBe('LB-1.lithicanalyst.json');
    expect(classify('site1/EXP03.PLY')).toBe('mesh');
    expect(classify('EXP03.lithicanalyst.json')).toBe('project');
    expect(classify('LithicAnalyst/projects/site1/EXP03.ply.lithicanalyst.json')).toBe('project');
    expect(classify('LithicAnalyst/exports/2026-10-29_134600/measurements.csv')).toBeNull();
    expect(classify('LithicAnalyst/figures/x/a.ply')).toBeNull();
    expect(classify('.trash/a.ply')).toBeNull();
    expect(classify('site/.cache/a.ply')).toBeNull();
    expect(classify('notes.txt')).toBeNull();
  });

  it('names the specimens by file name, and by path where names are shared', () => {
    const { ids, duplicates } = specimenIds(['site1/EXP03.ply', 'site2/EXP03.ply', 'site1/EXP04.ply', 'EXP05.ply', 'EXP05.stl', 'site3/EXP05.obj']);
    expect(Object.fromEntries(ids)).toEqual({
      'site1/EXP03.ply': 'site1/EXP03',
      'site2/EXP03.ply': 'site2/EXP03',
      'site1/EXP04.ply': 'EXP04',
      'EXP05.ply': 'EXP05.ply',
      'EXP05.stl': 'EXP05.stl',
      'site3/EXP05.obj': 'site3/EXP05',
    });
    expect(duplicates.map((d) => [d.name, d.files.length])).toEqual([
      ['EXP03', 2],
      ['EXP05', 3],
    ]);
  });

  it('names export folders by the time, and never reuses one', async () => {
    expect(timeStamp(new Date(2026, 9, 29, 13, 46, 0))).toBe('2026-10-29_134600');
    const taken = new Set(['x/2026', 'x/2026-2']);
    expect(await freshFolder('x/2026', (p) => taken.has(p))).toBe('x/2026-3');
    expect(await freshFolder('y', () => false)).toBe('y');
  });

  it('reads subfolders, leaves out its own and hidden ones, and writes into new folders', async () => {
    const files = new Map<string, Uint8Array>(
      ['a.ply', 'site1/EXP03.ply', 'site1/EXP03.stl', 'site1/deep/b.obj', '.hidden/c.ply', 'LithicAnalyst/projects/a.ply.lithicanalyst.json', 'LithicAnalyst/exports/old/measurements.csv', 'a.lithicanalyst.json', 'notes.txt'].map((p) => [p, new Uint8Array([1])]),
    );
    const root = memoryFolder('flakes', files);
    const ws = await workspaceFromHandle(root);
    expect(ws.meshes).toEqual(['a.ply', 'site1/deep/b.obj', 'site1/EXP03.ply', 'site1/EXP03.stl']);
    expect(ws.projects).toEqual(['a.lithicanalyst.json', 'LithicAnalyst/projects/a.ply.lithicanalyst.json']);
    expect(await ws.exists('LithicAnalyst/exports/old')).toBe(true);
    expect(await ws.exists('LithicAnalyst/exports/new')).toBe(false);
    await ws.write('LithicAnalyst/projects/site1/EXP03.stl.lithicanalyst.json', '{}');
    expect(new TextDecoder().decode(files.get('LithicAnalyst/projects/site1/EXP03.stl.lithicanalyst.json'))).toBe('{}');
    expect(ws.has('LithicAnalyst/projects/site1/EXP03.stl.lithicanalyst.json')).toBe(true);
    expect(ws.projects).toContain('LithicAnalyst/projects/site1/EXP03.stl.lithicanalyst.json');
  });

  it('reads every project file once, however many models there are', async () => {
    const paths = Array.from({ length: 300 }, (_, i) => `LithicAnalyst/projects/m${i}.ply.lithicanalyst.json`);
    const reads = new Map<string, number>();
    const text = (i: number) => JSON.stringify({ format: 'lithicanalyst-project', formatVersion: 2, app: { name: 'LithicAnalyst', version: '1' }, mesh: { sha256: `sha${i % 150}` }, specimen: { id: `m${i}`, annotator: i < 150 ? 'A' : 'B' }, annotations: {} });
    const index = new ProjectIndex(
      () => [...paths, 'other.json'],
      async (p) => {
        reads.set(p, (reads.get(p) ?? 0) + 1);
        return p === 'other.json' ? '{"not": "a project"}' : text(paths.indexOf(p));
      },
    );
    // a batch over 300 models asks for each model's projects
    await Promise.all([index.ready(), index.ready()]);
    for (let i = 0; i < 300; i++) {
      await index.ready();
      expect(index.forMesh(`sha${i % 150}`).map((p) => p.state.specimen.annotator)).toEqual(['A', 'B']);
    }
    expect(reads.size).toBe(301);
    expect([...reads.values()].every((n) => n === 1)).toBe(true);
    // what the app writes goes in without reading
    index.add(paths[0], JSON.parse(text(0).replace('"m0"', '"m0b"')));
    expect(index.get(paths[0])!.state.specimen.id).toBe('m0b');
    expect(reads.get(paths[0])).toBe(1);
  });
});

describe('time left', () => {
  it('rounds to what is worth saying', () => {
    expect(fmtDuration(3)).toBe('< 10 s');
    expect(fmtDuration(42)).toBe('40 s');
    expect(fmtDuration(150)).toBe('3 min');
    expect(fmtDuration(3900)).toBe('1 h 05 min');
    expect(fmtDuration(-1)).toBe('—');
  });
});

/** A folder in memory behind the File System Access API's handles. */
function memoryFolder(name: string, files: Map<string, Uint8Array>, prefix = ''): DirectoryHandle {
  const fileHandle = (path: string) => ({
    kind: 'file' as const,
    name: path.split('/').pop()!,
    getFile: async () => new File([files.get(path)! as BlobPart], path.split('/').pop()!),
    createWritable: async () => {
      const parts: Uint8Array[] = [];
      return {
        write: async (d: string | Uint8Array) => void parts.push(typeof d === 'string' ? new TextEncoder().encode(d) : d),
        close: async () => {
          const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
          let o = 0;
          for (const p of parts) out.set(p, (o += p.length) - p.length);
          files.set(path, out);
        },
      };
    },
  });
  const children = () => {
    const dirs = new Set<string>(), own: string[] = [];
    for (const p of files.keys()) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length).split('/');
      if (rest.length > 1) dirs.add(rest[0]);
      else own.push(p);
    }
    return { dirs, own };
  };
  return {
    kind: 'directory',
    name,
    values: async function* () {
      const { dirs, own } = children();
      for (const d of dirs) yield memoryFolder(d, files, `${prefix}${d}/`);
      for (const p of own) yield fileHandle(p);
    },
    getFileHandle: async (n, opts) => {
      const path = `${prefix}${n}`;
      if (!files.has(path)) {
        if (!opts?.create) throw new DOMException('missing', 'NotFoundError');
        files.set(path, new Uint8Array());
      }
      return fileHandle(path);
    },
    getDirectoryHandle: async (n, opts) => {
      const exists = [...files.keys()].some((p) => p.startsWith(`${prefix}${n}/`));
      if (!exists && !opts?.create) throw new DOMException('missing', 'NotFoundError');
      return memoryFolder(n, files, `${prefix}${n}/`);
    },
  };
}

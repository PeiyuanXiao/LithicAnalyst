import { describe, expect, it } from 'vitest';
import { emptyFlakeMeasures } from '../src/compute/flake';
import { addSymmetry, setRetouchAxis, setSpecimenType, setTechnologicalAxis, updateSpecimen } from '../src/core/actions';
import { parseProjectFile, serializeProject, upgradeDerived, upgradeTechnical } from '../src/core/schema';
import { emptyProject, ProjectStore } from '../src/core/store';
import { retouchSettingsOf, type Vec3 } from '../src/core/types';
import { flakesCsv, symmetryCsv } from '../src/io/csv';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const n: Vec3 = [0, 0, -1];

/** A flake with a technological axis (its frame the specimen's), a symmetry reference on its X mid-plane, its retouch laid out on it. */
function flake(): ProjectStore {
  const s = new ProjectStore(emptyProject());
  setSpecimenType(s, 'flake');
  updateSpecimen(s, { id: 'F1' });
  setTechnologicalAxis(s, { start: [0, 0, 0], end: [0, 40, 0], startNormal: n, endNormal: n, matrix: identity, failure: null });
  addSymmetry(s, { kind: 'frame', frame: 'technological', axis: 'x' }, [0, 0, 1]);
  setRetouchAxis(s, 'technological');
  return s;
}

describe('"technical" is "technological" (34d)', () => {
  it('a file of before 34d: its codes read as the new ones', () => {
    const file = JSON.parse(JSON.stringify(serializeProject(flake().state, '1.0.0')));
    // as a file of before 34d wrote them
    file.specimen.frame.source = 'technical_axis';
    file.flake.otherFrame = { matrix: identity, source: 'technical_axis; turned' };
    file.symmetry[0].source.frame = 'technical';
    file.flake.retouch.axis = 'technical';
    const st = parseProjectFile(file);
    expect(st.specimen.frame?.source).toBe('technological_axis');
    expect(st.flake.otherFrame?.source).toBe('technological_axis; turned');
    expect(st.symmetry[0].source).toEqual({ kind: 'frame', frame: 'technological', axis: 'x' });
    expect(retouchSettingsOf(st.flake).axis).toBe('technological');
    // written again: only the new codes
    expect(JSON.stringify(serializeProject(st, '1.0.0'))).not.toMatch(/technical/);
  });

  it('the exports have only the new codes', () => {
    const st = flake().state;
    const flakes = flakesCsv(st, emptyFlakeMeasures(), { excelBom: false });
    expect(flakes.split('\n')[1].split(',')[2]).toBe('technological_axis');
    const symmetry = symmetryCsv(st, [], { excelBom: false }).trim().split('\n');
    expect(symmetry[1].split(',').slice(2, 4)).toEqual(['frame', 'technological_x']);
    expect(flakes + symmetry.join('\n')).not.toMatch(/technical/);
  });

  it('the results a file stored: their codes made new too, the rest as written', () => {
    expect(upgradeTechnical('technical')).toBe('technological');
    expect(upgradeTechnical('technical_axis')).toBe('technological_axis');
    expect(upgradeTechnical('view')).toBe('view');
    expect(upgradeTechnical(3)).toBe(3);
    const derived = { flake: { frameSource: 'technical_axis', measures: { ipa: 100 } }, retouchIndices: { axis: 'technical', erp: 0.2 }, gm: { missing: ['technical_axis', 'edge'], rows: [] }, regions: [1] };
    expect(upgradeDerived(derived)).toEqual({ flake: { frameSource: 'technological_axis', measures: { ipa: 100 } }, retouchIndices: { axis: 'technological', erp: 0.2 }, gm: { missing: ['technological_axis', 'edge'], rows: [] }, regions: [1] });
    expect(upgradeDerived({})).toEqual({});
  });
});

import { describe, expect, it } from 'vitest';
import { annotationStatus } from '../src/core/annotationStatus';
import { emptyProject } from '../src/core/store';
import type { Curve, Landmark, ProjectState, Region, Scar, TechnicalAxis } from '../src/core/types';
import { defaultAttributes, type SpecimenType } from '../src/core/fields';

const project = (type: SpecimenType, unit = ''): ProjectState => {
  const st = emptyProject();
  st.specimen = { ...st.specimen, type, unit };
  return st;
};
const curve = (type: string, closed = false): Curve => ({ id: type, label: 'C1', anchors: [], points: [], anchorIndex: [], closed, attributes: { type, note: '' }, createdAt: '', modifiedAt: '' });
const region = (type: string): Region => ({ id: type, label: 'R1', seed: [0, 0, 0], type, scarId: null, createdAt: '', modifiedAt: '' });
const end = (id: string): Landmark => ({ id, name: id, point: [0, 0, 0], code: 'platform_end', createdAt: '', modifiedAt: '' });
const axis = (matrix: number[] | undefined): TechnicalAxis => ({ id: 'a', start: [0, 0, 0], end: [0, 1, 0], startNormal: [0, 0, 1], endNormal: [0, 0, 1], matrix }) as unknown as TechnicalAxis;
const scar = (vector: Scar['vector']): Scar => ({ id: 's', label: 'S1', vector, attributes: defaultAttributes(), createdAt: '', modifiedAt: '' });
const VECTOR = { start: [0, 0, 0], end: [1, 0, 0], startNormal: [0, 0, 1], endNormal: [0, 0, 1] } as Scar['vector'];

const doneOf = (st: ProjectState) => Object.fromEntries(annotationStatus(st).items.map((i) => [i.key, i.done]));
const count = (st: ProjectState) => {
  const s = annotationStatus(st);
  return `${s.done}/${s.total}`;
};

describe('the annotation status of a flake', () => {
  it('has six items that count and one that does not, none done on a blank specimen', () => {
    const s = annotationStatus(project('flake'));
    expect(s.items.map((i) => i.key)).toEqual(['unit', 'axis', 'edge', 'platform_outline', 'platform_ends', 'faces', 'retouch']);
    expect(s.items.filter((i) => i.optional).map((i) => i.key)).toEqual(['retouch']);
    expect(s.items.every((i) => !i.done)).toBe(true);
    expect([s.done, s.total]).toEqual([0, 6]);
  });

  it('counts each item by its own condition', () => {
    const st = project('flake', 'mm');
    expect(count(st)).toBe('1/6');
    expect(doneOf(st).unit).toBe(true);

    // an axis without a frame is none
    st.flake.axis = axis(undefined);
    expect(doneOf(st).axis).toBe(false);
    st.flake.axis = axis([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(doneOf(st).axis).toBe(true);
    expect(count(st)).toBe('2/6');

    // a core's edge is not a flake's
    st.curves.push(curve('core_edge'));
    expect(doneOf(st).edge).toBe(false);
    st.curves.push(curve('edge'));
    expect(doneOf(st).edge).toBe(true);
    expect(count(st)).toBe('3/6');

    // the outline has to be closed
    st.curves.push(curve('platform_outline', false));
    expect(doneOf(st).platform_outline).toBe(false);
    st.curves[st.curves.length - 1] = curve('platform_outline', true);
    expect(doneOf(st).platform_outline).toBe(true);
    expect(count(st)).toBe('4/6');

    // two ends; other landmarks do not count
    st.landmarks.push(end('l'), { ...end('p'), code: 'pop' });
    expect(doneOf(st).platform_ends).toBe(false);
    st.landmarks.push(end('r'));
    expect(doneOf(st).platform_ends).toBe(true);
    expect(count(st)).toBe('5/6');

    // both faces
    st.regions.push(region('dorsal'));
    expect(doneOf(st).faces).toBe(false);
    st.regions.push(region('ventral'));
    expect(doneOf(st).faces).toBe(true);
    expect(count(st)).toBe('6/6');
  });

  it('leaves the optional item out of the count', () => {
    const st = project('flake');
    st.regions.push(region('retouch'));
    expect(doneOf(st).retouch).toBe(true);
    expect(count(st)).toBe('0/6');
  });
});

describe('the annotation status of a core', () => {
  it('has the unit, the scar arrows and the core edge', () => {
    const st = project('core');
    expect(annotationStatus(st).items.map((i) => [i.key, i.optional])).toEqual([['unit', false], ['scar_arrows', false], ['core_edge', false]]);
    expect(count(st)).toBe('0/3');
    st.specimen.unit = 'cm';
    expect(count(st)).toBe('1/3');
    // a scar known only by its area has no arrow
    st.scars.push(scar(null));
    expect(doneOf(st).scar_arrows).toBe(false);
    st.scars.push(scar(VECTOR));
    expect(doneOf(st).scar_arrows).toBe(true);
    // a flake's edge is not a core's
    st.curves.push(curve('edge'));
    expect(doneOf(st).core_edge).toBe(false);
    st.curves.push(curve('core_edge'));
    expect(count(st)).toBe('3/3');
  });
});

describe('the annotation status of a generic specimen', () => {
  it('has the unit alone', () => {
    const st = project('generic');
    expect(annotationStatus(st).items.map((i) => i.key)).toEqual(['unit']);
    expect(count(st)).toBe('0/1');
    st.specimen.unit = 'in';
    expect(count(st)).toBe('1/1');
  });
});

describe('the faces of a flake, as found on the mesh', () => {
  const withFaces = () => {
    const st = project('flake', 'mm');
    st.regions.push(region('dorsal'), region('ventral'));
    return st;
  };
  const faces = (st: ProjectState, found: Array<{ type: string; area: number | null }> | null) => annotationStatus(st, found).items.find((i) => i.key === 'faces')!;

  it('are done when both found a piece of surface', () => {
    const item = faces(withFaces(), [{ type: 'dorsal', area: 10 }, { type: 'ventral', area: 12 }]);
    expect(item.done).toBe(true);
    expect(item.notApart).toBeUndefined();
  });

  it('are not when the regions are there and the two are not apart', () => {
    const item = faces(withFaces(), [{ type: 'dorsal', area: null }, { type: 'ventral', area: null }]);
    expect(item.done).toBe(false);
    expect(item.notApart).toBe(true);
    expect(faces(withFaces(), [{ type: 'dorsal', area: 10 }, { type: 'ventral', area: null }]).done).toBe(false);
    expect(annotationStatus(withFaces(), [{ type: 'dorsal', area: null }, { type: 'ventral', area: null }]).done).toBe(1);
  });

  it('not found yet: not done', () => {
    expect(faces(withFaces(), []).done).toBe(false);
  });

  it('without the regions: nothing to be apart', () => {
    const item = faces(project('flake', 'mm'), []);
    expect(item.done).toBe(false);
    expect(item.notApart).toBeUndefined();
  });

  it('where it is not known, as a file that stored none: by the regions being there', () => {
    expect(faces(withFaces(), null).done).toBe(true);
  });

  it('other items are as they were', () => {
    const st = withFaces();
    st.regions.push(region('retouch'));
    expect(annotationStatus(st, []).items.find((i) => i.key === 'retouch')?.done).toBe(true);
  });
});

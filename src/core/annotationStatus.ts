import type { SpecimenType } from './fields';
import { PLATFORM_OUTLINE } from './fields';
import { platformEndsOf } from '../compute/measuredLine';
import { hasVector, type ProjectState } from './types';

/** What a specimen may still lack; `retouch` is optional (not every flake is retouched). */
export type StatusKey = 'unit' | 'axis' | 'edge' | 'platform_outline' | 'faces' | 'retouch' | 'scar_arrows' | 'core_edge';

export interface StatusItem {
  key: StatusKey;
  done: boolean;
  /** Does not count toward the completeness. */
  optional: boolean;
  /** The dorsal and ventral regions are there and were not found on the mesh: the two faces are not apart. */
  notApart?: true;
  /** There is an edge and a closed platform outline, and the edge does not reach it at both ends. */
  notMeeting?: true;
}

export interface AnnotationStatus {
  items: StatusItem[];
  /** Items done and items there are, the optional ones left out. */
  done: number;
  total: number;
}

type StatusInput = Pick<ProjectState, 'specimen' | 'flake' | 'curves' | 'landmarks' | 'regions' | 'scars'>;

/** A region as found on the mesh (`area`: null when it found no piece of surface). */
type RegionFound = { type: string; area: number | null };

const STATUS_ITEMS: Record<SpecimenType, readonly StatusKey[]> = {
  flake: ['unit', 'axis', 'edge', 'platform_outline', 'faces', 'retouch'],
  core: ['unit', 'scar_arrows', 'core_edge'],
  generic: ['unit'],
};

const OPTIONAL: readonly StatusKey[] = ['retouch'];

/** The edge should reach the closed outline at both ends: that gives the platform ends, and parts the faces. */
const edgeMeetsOutline = (st: StatusInput): boolean => !st.curves.some((c) => c.attributes.type === PLATFORM_OUTLINE && c.closed) || platformEndsOf(st.curves).length >= 2;

const isDone = (key: StatusKey, st: StatusInput, found: readonly RegionFound[] | null): boolean => {
  const curveOfType = (type: string) => st.curves.some((c) => c.attributes.type === type);
  const regionOfType = (type: string) => st.regions.some((r) => r.type === type);
  switch (key) {
    case 'unit':
      return !!st.specimen.unit;
    case 'axis':
      return !!st.flake.axis?.matrix;
    case 'edge':
      return curveOfType('edge') && edgeMeetsOutline(st);
    case 'platform_outline':
      return st.curves.some((c) => c.attributes.type === PLATFORM_OUTLINE && c.closed);
    case 'faces':
      // the regions come as soon as there are an axis and an edge: it takes the mesh to say the two faces are apart
      return found ? ['dorsal', 'ventral'].every((type) => found.some((r) => r.type === type && r.area !== null)) : regionOfType('dorsal') && regionOfType('ventral');
    case 'retouch':
      return regionOfType('retouch');
    case 'scar_arrows':
      return st.scars.some(hasVector);
    case 'core_edge':
      return curveOfType('core_edge');
  }
};

/**
 * Which of what a specimen of its type is annotated with it has so far; from the project and the regions found on the mesh, which
 * a project file stores, so a folder's list needs no model. `found` null: not known (a file from before they were stored), the regions go by being there.
 */
export function annotationStatus(st: StatusInput, found: readonly RegionFound[] | null = null): AnnotationStatus {
  const items = STATUS_ITEMS[st.specimen.type].map((key): StatusItem => {
    const done = isDone(key, st, found);
    const there = st.regions.some((r) => r.type === 'dorsal') && st.regions.some((r) => r.type === 'ventral');
    const notMeeting = key === 'edge' && !done && st.curves.some((c) => c.attributes.type === 'edge');
    return { key, done, optional: OPTIONAL.includes(key), ...(key === 'faces' && !done && there ? { notApart: true as const } : {}), ...(notMeeting ? { notMeeting: true as const } : {}) };
  });
  const counted = items.filter((i) => !i.optional);
  return { items, done: counted.filter((i) => i.done).length, total: counted.length };
}

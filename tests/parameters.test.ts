import { describe, expect, it } from 'vitest';
import { BSA_REF_TRIM } from '../src/compute/bulb';
import { EDGE_ANGLE_PARAMETERS, LINE_REACH_EDGES } from '../src/compute/edgeAngle';
import { FLAKE_PARAMETERS } from '../src/compute/flake';
import { RETOUCH_INDEX_PARAMETERS } from '../src/compute/retouchIndex';
import { SLIVER_EDGES } from '../src/compute/retouchAngle';
import { MIN_AXIS_EDGES, MIN_STRIP_TRIANGLES } from '../src/compute/technologicalFrame';

describe('the parameters recorded with the results and in the manifest (34d)', () => {
  it('have the constants that were left out, at the values they had', () => {
    expect(FLAKE_PARAMETERS).toMatchObject({ MIN_AXIS_EDGES: 5, MIN_STRIP_TRIANGLES: 10, BSA_REF_TRIM: 3 });
    expect([MIN_AXIS_EDGES, MIN_STRIP_TRIANGLES, BSA_REF_TRIM]).toEqual([5, 10, 3]);
    expect(EDGE_ANGLE_PARAMETERS).toMatchObject({ LINE_REACH_EDGES: 3 });
    expect(LINE_REACH_EDGES).toBe(3);
    expect(RETOUCH_INDEX_PARAMETERS).toMatchObject({ SLIVER_EDGES: 2 });
    expect(SLIVER_EDGES).toBe(2);
  });
});

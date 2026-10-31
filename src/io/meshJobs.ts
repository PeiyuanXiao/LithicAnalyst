import { sha256Hex } from '../compute/hash';
import type { ConfigBox } from '../compute/configuration';
import { frameMeasuresSteps, surfaceMeasuresSteps } from '../compute/measure';
import type { PrincipalAxes } from '../compute/meshGeometry';
import type { Steps } from '../compute/steps';
import type { AutoMeasurements } from '../core/derived';
import type { SpecimenFrame, Vec3 } from '../core/types';
import { centredMesh, parseMeshBuffer } from './readMesh';

/** What a batch export needs from a model: its size, shape and box along each frame asked for, and the vertices' principal axes. */
export interface MeshMeasures {
  /** One per frame asked for, in that order. */
  auto: AutoMeasurements[];
  /** The model's box along each frame (volumetric configuration), original coordinates. */
  boxes: ConfigBox[];
  /** Principal axes of all vertices, original coordinates. */
  vertices: PrincipalAxes;
}

/** Runs a computation: at once (in a worker) or in slices between frames (on the page). */
export type Runner = <T>(steps: Steps<T>) => Promise<T>;

/**
 * The work of a batch export on each model, one model per id: first its
 * checksum (the file is read once and kept), then, only when the saved results
 * of its projects cannot be used, the measurements (parsing, joining vertices,
 * measuring). The same code runs in the batch worker and, where a worker
 * cannot be made, on the page.
 */
export class MeshJobs {
  private files = new Map<number, { name: string; size: number; buffer: ArrayBuffer; sha256: string }>();

  constructor(private readonly run: Runner) {}

  async hash(id: number, file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const sha256 = await sha256Hex(buffer);
    this.files.set(id, { name: file.name, size: file.size, buffer, sha256 });
    return sha256;
  }

  /** Measure model `id` along each frame (null: its principal axes); the file is let go. */
  async measure(id: number, frames: ReadonlyArray<SpecimenFrame | null>): Promise<MeshMeasures> {
    const f = this.files.get(id);
    if (!f) throw new Error('The model was not read.');
    this.files.delete(id);
    const mesh = centredMesh(parseMeshBuffer(f.name, f.size, f.buffer, f.sha256));
    const base = await this.run(surfaceMeasuresSteps(mesh.positions, mesh.index));
    const auto: AutoMeasurements[] = [];
    const boxes: ConfigBox[] = [];
    const o = mesh.offset;
    for (const frame of frames) {
      const m = await this.run(frameMeasuresSteps(mesh.positions, base, frame, o));
      auto.push(m.auto);
      boxes.push(m.box);
    }
    const mean: Vec3 = [base.vertices.mean[0] + o[0], base.vertices.mean[1] + o[1], base.vertices.mean[2] + o[2]];
    return { auto, boxes, vertices: { ...base.vertices, mean } };
  }

  drop(id: number): void {
    this.files.delete(id);
  }
}

/** Messages to the batch worker, and its answers (by `seq`). */
export type JobRequest =
  | { seq: number; type: 'ping' }
  | { seq: number; type: 'hash'; id: number; file: File }
  | { seq: number; type: 'measure'; id: number; frames: Array<SpecimenFrame | null> }
  | { seq: number; type: 'drop'; id: number };

export type JobReply = { seq: number; ok: true; value: unknown } | { seq: number; ok: false; error: string };

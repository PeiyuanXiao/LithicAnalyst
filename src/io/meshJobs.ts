import { sha256Hex } from '../compute/hash';
import type { ConfigBox } from '../compute/configuration';
import type { GmResult } from '../compute/gm';
import { frameMeasuresSteps, surfaceMeasuresSteps } from '../compute/measure';
import type { PrincipalAxes } from '../compute/meshGeometry';
import { gmOfProjectSteps } from '../compute/projectRegions';
import type { Steps } from '../compute/steps';
import type { AutoMeasurements } from '../core/derived';
import type { ProjectState, SpecimenFrame, Vec3 } from '../core/types';
import { centredMesh, parseMeshBuffer } from './readMesh';
import { judgeUnits, meshSurfaceSteps, placeArrows, placementOf, type PlacedArrow, type Segment, type UnitJudgement } from '../compute/igesAlign';
import { signedVolume } from '../compute/curvature';
import type { MeshInfo } from '../core/types';

/** A model and the vectors of its IGES file: its checksum and details, the unit judged, and the arrows when they lie on it already. */
export interface IgesCheck {
  info: MeshInfo;
  judgement: UnitJudgement;
  /** On the surface, when `judgement.aligned`; else null. */
  arrows: PlacedArrow[] | null;
}

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

  /** Which unit the IGES vectors of model `id` (read by `hash`) are in and whether they lie on it (`fileFactor`: what the file's header says, in the model's unit); the file is let go. */
  async iges(id: number, segments: Segment[], fileFactor: number | null): Promise<IgesCheck> {
    const f = this.files.get(id);
    if (!f) throw new Error('The model was not read.');
    this.files.delete(id);
    const sha256 = f.sha256;
    const raw = parseMeshBuffer(f.name, f.size, f.buffer, sha256);
    const mesh = centredMesh(raw);
    const sign = signedVolume(mesh.positions, mesh.index) < 0 ? -1 : 1;
    const surface = await this.run(meshSurfaceSteps(mesh.positions, mesh.index, mesh.offset, sign));
    const judgement = judgeUnits(segments, fileFactor, surface);
    const info: MeshInfo = { fileName: raw.fileName, format: raw.format, fileSize: raw.fileSize, sha256, vertexCount: mesh.positions.length / 3, triangleCount: mesh.index.length / 3, bboxMin: mesh.min, bboxMax: mesh.max };
    return { info, judgement, arrows: judgement.aligned ? placeArrows(segments, placementOf(judgement.factor), surface) : null };
  }

  /** A specimen's points by the template, on its model: the model is read for this, and let go. */
  async gm(file: File, state: ProjectState, templateAvailable: boolean): Promise<GmResult> {
    const mesh = centredMesh(parseMeshBuffer(file.name, file.size, await file.arrayBuffer(), ''));
    return this.run(gmOfProjectSteps(state, { positions: mesh.positions, index: mesh.index, offset: mesh.offset }, templateAvailable));
  }
}

/** Messages to the batch worker, and its answers (by `seq`). */
export type JobRequest =
  | { seq: number; type: 'ping' }
  | { seq: number; type: 'hash'; id: number; file: File }
  | { seq: number; type: 'measure'; id: number; frames: Array<SpecimenFrame | null> }
  | { seq: number; type: 'drop'; id: number }
  | { seq: number; type: 'gm'; file: File; state: ProjectState; templateAvailable: boolean }
  | { seq: number; type: 'iges'; id: number; segments: Segment[]; fileFactor: number | null };

export type JobReply = { seq: number; ok: true; value: unknown } | { seq: number; ok: false; error: string };

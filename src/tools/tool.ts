import type { SnapMode } from '../compute/surfacePath';
import type { ProjectStore } from '../core/store';
import type { Vec3 } from '../core/types';
import type { ArrowLayer } from '../render/arrowLayer';
import type { CurveLayer } from '../render/curveLayer';
import type { LandmarkLayer } from '../render/landmarkLayer';
import type { MeasureLayer } from '../render/measureLayer';
import type { SurfaceHit, Viewer } from '../render/viewer';
import type { Selection } from './selection';
import type { SurfaceSnap } from './surfaceSnap';

/** An end of a working edge. */
export interface EdgeEnd {
  id: string;
  which: 'start' | 'end';
}

/** Taking hold of the ends of the working edges. */
export interface EdgeEnds {
  at(x: number, y: number): EdgeEnd | null;
  highlight(end: EdgeEnd | null): void;
  /** Dragged to a client position: it stops at what it may not pass. */
  drag(end: EdgeEnd, x: number, y: number): void;
  /** Let go (false: put back). */
  finish(commit: boolean): void;
}

export interface ToolContext {
  viewer: Viewer;
  store: ProjectStore;
  arrows: ArrowLayer;
  curves: CurveLayer;
  measures: MeasureLayer;
  landmarks: LandmarkLayer;
  selection: Selection;
  /** Path search and snapping on the current mesh (null before a mesh is loaded). */
  snap: () => SurfaceSnap | null;
  /** What curves are drawn toward (ridges, valleys, or nothing). */
  snapMode: () => SnapMode;
  /** The point of the platform outline nearest a point; null without an outline. */
  onPlatformOutline: (point: Vec3) => Vec3 | null;
  /** The type asked for the next curve drawn, if any; asking takes it. */
  takeNextCurveType: () => string | null;
  /** Show a short message (i18n key). */
  notify: (key: string, tone?: 'info' | 'warn') => void;
  /** Tool state changed (status hint, cursor). */
  changed: () => void;
  /** Annotations may be edited (false outside the annotate mode). */
  editable: () => boolean;
  /** The item under the select tool's cursor and where the cursor is (null: none); the app shows its name after a pause. */
  hovered: (item: { id: string; x: number; y: number } | null) => void;
  /** An end of the technical axis was dragged to here. */
  moveAxisEnd: (which: 'start' | 'end', point: Vec3, normal: Vec3) => void;
  edgeEnds: EdgeEnds;
}

/** Lazily computed surface hit for the current pointer event (one ray cast at most). */
export type HitProvider = () => SurfaceHit | null;

/**
 * An interaction tool. New tools (landmarks, curves, surface selection) implement
 * this interface and register with the ToolController; nothing else changes.
 */
export interface Tool {
  readonly id: string;
  activate(): void;
  deactivate(): void;
  /** Return true to consume the press (camera navigation will not see it). */
  pointerDown(e: PointerEvent, hit: HitProvider): boolean;
  pointerMove(e: PointerEvent, hit: HitProvider): void;
  pointerUp(e: PointerEvent, hit: HitProvider): void;
  doubleClick?(e: MouseEvent, hit: HitProvider): void;
  /** The pointer left the view. */
  pointerLeave?(): void;
  /** Forget what is under the cursor (the work mode changed). */
  clearHover?(): void;
  /** Esc. Return true if something was cancelled. */
  cancel(): boolean;
  /** Backspace / Ctrl+Z while the tool has unfinished work: undo its last step. True if handled. */
  undoStep?(): boolean;
  /** Enter: finish the tool's current work. True if handled. */
  commit?(): boolean;
  /** A modifier key changed (e.g. Shift): re-evaluate what is under the cursor. */
  modifiersChanged?(e: KeyboardEvent): void;
  /** i18n key of the hint for the status bar in the current state. */
  hintKey(): string;
  /** CSS cursor for the viewport. */
  cursor(): string;
}

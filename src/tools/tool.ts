import type { ProjectStore } from '../core/store';
import type { ArrowLayer } from '../render/arrowLayer';
import type { SurfaceHit, Viewer } from '../render/viewer';
import type { Selection } from './selection';

export interface ToolContext {
  viewer: Viewer;
  store: ProjectStore;
  arrows: ArrowLayer;
  selection: Selection;
  /** Show a short message (i18n key). */
  notify: (key: string, tone?: 'info' | 'warn') => void;
  /** Tool state changed (status hint, cursor). */
  changed: () => void;
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
  /** Esc. Return true if something was cancelled. */
  cancel(): boolean;
  /** i18n key of the hint for the status bar in the current state. */
  hintKey(): string;
  /** CSS cursor for the viewport. */
  cursor(): string;
}

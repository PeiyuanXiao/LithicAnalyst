import type { ProjectStore } from '../core/store';
import type { ArrowDisplay } from '../render/arrowLayer';
import type { LightSettings } from '../render/lighting';
import type { ShadingMode } from '../render/meshView';
import type { Selection } from '../tools/selection';
import type { Feedback } from './feedback';

export type ViewportBackground = 'light' | 'dark';

export interface DisplaySettings {
  shading: ShadingMode;
  light: LightSettings;
  /** 0 = matte, 1 = glossy. */
  gloss: number;
  /** Smoothing passes for the curvature map (0–100). */
  curvScale: number;
  curvContrast: number;
  background: ViewportBackground;
  arrows: ArrowDisplay;
  excelBom: boolean;
}

export type DisplayAspect = 'light' | 'shading' | 'curvature' | 'background' | 'arrows' | 'other';

/** What the sidebar panels may ask of the application. */
export interface AppApi {
  readonly store: ProjectStore;
  readonly selection: Selection;
  readonly display: DisplaySettings;
  readonly feedback: Feedback;
  setDisplay(change: (d: DisplaySettings) => void, aspect: DisplayAspect): void;
  hasMesh(): boolean;
  hasScanColors(): boolean;
  curvatureBusy(): boolean;
  focusArrow(id: string): void;
  exportCsv(): void;
  saveProject(): void;
  openProject(): void;
}

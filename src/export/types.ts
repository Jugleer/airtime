// src/export/types — the shared vocabulary for the deterministic GIF / WebM
// exporter (DESIGN.md §1 deferred "GIF / video export", now built). Kept free of
// DOM/three/react so the pure schedule + encoder helpers can import it.

/** Output container. WebM is offered ONLY where WebCodecs' VideoEncoder exists. */
export type ExportFormat = 'gif' | 'webm';

/** Frame rate options (DESIGN: 15 / 24 / 30 fps). */
export type ExportFps = 15 | 24 | 30;

/** Resolution scale: 1 = current canvas size, 0.5 = half (smaller files). */
export type ExportScale = 1 | 0.5;

/** The user-chosen export settings (the dialog's form). */
export interface ExportOptions {
  readonly format: ExportFormat;
  /** Number of full pattern loops to render (1–4). */
  readonly loops: number;
  readonly fps: ExportFps;
  readonly scale: ExportScale;
  /**
   * When true, the camera performs exactly ONE full orbit around the current
   * target over the whole export (seamless); otherwise the current interactive
   * camera is frozen (what-you-see-is-what-you-export).
   */
  readonly turntable: boolean;
}

/** The DESIGN defaults for a fresh dialog: one loop, 24 fps, full size, frozen camera. */
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format: 'gif',
  loops: 1,
  fps: 24,
  scale: 1,
  turntable: false,
};

export const EXPORT_LOOPS_MIN = 1;
export const EXPORT_LOOPS_MAX = 4;
export const EXPORT_FPS_CHOICES: readonly ExportFps[] = [15, 24, 30];

/** Progress callback: `done` frames of `total` encoded. */
export type ExportProgress = (done: number, total: number) => void;

/** A cooperative cancellation token the dialog flips when Cancel is pressed. */
export interface ExportCancel {
  cancelled: boolean;
}

/** The outcome of a completed export. */
export interface ExportResult {
  readonly blob: Blob;
  readonly filename: string;
  readonly frameCount: number;
  readonly width: number;
  readonly height: number;
}

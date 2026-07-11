// src/export — deterministic, offline GIF / WebM export of the running pattern
// (DESIGN.md §1 deferred item, now built; §2 determinism makes it frame-exact).
// Public surface for the UI (src/ui/ExportPanel).

export * from './types';
export {
  buildExportSchedule,
  estimateFrameCount,
  orbitPosition,
  type ExportSchedule,
  type Vec3Tuple,
} from './schedule';
export { createGifEncoder, gifFrameCount, isGif89a } from './gif';
export { isWebmExportSupported, isWebm, muxWebm } from './webm';
export { runExport, ExportError, ExportCancelledError } from './capture';

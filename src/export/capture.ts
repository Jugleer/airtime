// src/export/capture — the offline, frame-exact render + encode orchestration
// (DESIGN.md §2: the sim is a pure function of time, so we render each frame from
// the exact sim time t0 + fraction·period rather than screen-capturing in realtime).
//
// The pipeline, per frame k (deterministic — no Date.now / performance sampling;
// the only time source is the precomputed frame schedule):
//   1. set the store's simTime to frameTimes[k] (direct, no clock advance);
//   2. r3f advance(): fires every useFrame subscriber, so the balls/hands/tracers
//      move to that exact sim time;
//   3. place the camera (frozen current view, or the turntable's kth azimuth) and
//      render once more with it;
//   4. draw the WebGL canvas onto a 2D canvas at the target size, read the pixels,
//      hand them to the incremental GIF encoder (or a WebCodecs VideoEncoder);
//   5. yield to the event loop so the dialog's progress bar + Cancel stay live.
// Everything is restored in a finally: sim time, playing state, camera, and the
// render-loop mode — cancellation included.

import { useAppStore } from '../state';
import { currentBeatIndex } from '../state/simulation';
import { sampleCamera } from '../state/sceneBridge';
import { getCaptureRoot } from '../render3d/captureBridge';
import { buildExportSchedule, isBeatGridUniform, orbitPosition, type Vec3Tuple } from './schedule';
import { createGifEncoder } from './gif';
import { isWebmExportSupported, muxWebm, pickWebmCodec, type WebmFrame } from './webm';
import type { ExportCancel, ExportOptions, ExportProgress, ExportResult } from './types';

/** A recoverable export failure (shown to the user, never thrown to the console). */
export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

/** Thrown when the user cancels mid-export; the UI treats it as a clean cancel. */
export class ExportCancelledError extends Error {
  constructor() {
    super('Export cancelled');
    this.name = 'ExportCancelledError';
  }
}

/** Yield a macrotask so the UI (progress bar, Cancel button) can paint. */
function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function sanitizePatternForFilename(text: string): string {
  const cleaned = text.replace(/[^A-Za-z0-9]/g, '');
  return cleaned.length > 0 ? cleaned : 'pattern';
}

/** Round down to an even integer ≥ 2 (VP9/most encoders want even dimensions). */
function evenDim(value: number): number {
  const n = Math.max(2, Math.round(value));
  return n % 2 === 0 ? n : n - 1;
}

/**
 * Render and encode the running pattern to a GIF (or WebM) blob. Resolves with the
 * blob + metadata; rejects with {@link ExportError} (recoverable) or
 * {@link ExportCancelledError} (user cancel). Restores all touched state before it
 * settles, in every path.
 */
export async function runExport(
  options: ExportOptions,
  onProgress: ExportProgress,
  cancel: ExportCancel,
): Promise<ExportResult> {
  const root = getCaptureRoot();
  if (root === null) {
    throw new ExportError('The 3D scene is not ready for export.');
  }
  if (options.format === 'webm' && !(await isWebmExportSupported())) {
    throw new ExportError('WebM export is not supported in this browser.');
  }

  const store = useAppStore.getState();
  const startTime = store.simTime;
  const wasPlaying = store.playing;
  const periodBeats = store.sim.spatialPeriodBeats;
  if (!(periodBeats > 0)) {
    throw new ExportError('This pattern has no repeating loop to export.');
  }
  const approxLoop = periodBeats * store.baseParams.beatPeriod;

  // Pass 1: generate enough of the (append-only) timeline to read the EXACT loop
  // duration from the beat grid (handles a slewing tempo gracefully).
  useAppStore.getState().setSimTime(startTime + (options.loops + 2) * approxLoop + 1);
  const timeline = useAppStore.getState().sim.timeline;
  const startBeat = currentBeatIndex(timeline, startTime);
  let loopDuration: number;
  try {
    loopDuration = timeline.beatTime(startBeat + periodBeats) - timeline.beatTime(startBeat);
  } catch {
    loopDuration = approxLoop;
  }
  if (!(loopDuration > 0)) {
    loopDuration = approxLoop;
  }

  // Refuse to export while the tempo is still slewing. The seamless loop assumes the
  // pattern is exactly periodic (a uniform beat grid), but a slew changes the beat
  // spacing from beat to beat, so one period's duration does not repeat and the loop
  // would hitch at the seam. Sample the grid over [startBeat, startBeat + periodBeats]
  // and bail with a friendly message if it is not uniform (surfaced in the ExportPanel).
  const gridTimes: number[] = [];
  try {
    for (let beat = startBeat; beat <= startBeat + periodBeats; beat++) {
      gridTimes.push(timeline.beatTime(beat));
    }
  } catch {
    // The full span is not in the generated range — skip the check (loopDuration
    // already fell back to the nominal loop above).
    gridTimes.length = 0;
  }
  if (gridTimes.length >= 3 && !isBeatGridUniform(gridTimes)) {
    // Restore the playhead advanced by Pass 1 before bailing (mirrors the ctx bail).
    useAppStore.setState({ simTime: startTime, playing: wasPlaying });
    throw new ExportError('The tempo is still settling — wait a moment and retry.');
  }

  const schedule = buildExportSchedule({
    startTime,
    loopDuration,
    loops: options.loops,
    fps: options.fps,
  });

  // Pass 2: ensure the horizon covers the last frame time exactly, then park the
  // playhead back at t0 (keeping the now-extended sim).
  useAppStore.getState().setSimTime(startTime + schedule.totalDuration + approxLoop);
  useAppStore.setState({ simTime: startTime, playing: false });

  // Target resolution: current canvas CSS size (× scale), floored to even.
  const glCanvas = root.gl.domElement;
  const baseWidth = glCanvas.clientWidth || glCanvas.width;
  const baseHeight = glCanvas.clientHeight || glCanvas.height;
  const width = evenDim(baseWidth * options.scale);
  const height = evenDim(baseHeight * options.scale);

  // Freeze the current interactive camera (position + orbit target) up front.
  const pose = sampleCamera(store.cameraView);
  const cameraPosition = pose.position as Vec3Tuple;
  const target = pose.target as Vec3Tuple;

  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (ctx === null) {
    // Nothing was mutated except the horizon/playhead; restore before bailing.
    useAppStore.setState({ simTime: startTime, playing: wasPlaying });
    throw new ExportError('Could not allocate a capture canvas.');
  }

  const previousFrameloop = root.frameloop;
  root.setFrameloop('never');

  // Restore ALL touched state (playhead, playing, camera, render loop) — used on
  // success, error, and cancel.
  const restore = (): void => {
    root.setFrameloop(previousFrameloop);
    useAppStore.setState({ simTime: startTime, playing: wasPlaying });
    const live = getCaptureRoot();
    if (live !== null) {
      live.camera.position.set(cameraPosition[0], cameraPosition[1], cameraPosition[2]);
      live.camera.lookAt(target[0], target[1], target[2]);
      live.camera.updateMatrixWorld();
      live.gl.render(live.scene, live.camera);
    }
  };

  /** Render frame k, then paint it into the 2D scratch canvas at the target size. */
  const renderFrameToScratch = (k: number): void => {
    useAppStore.setState({ simTime: schedule.frameTimes[k] as number });
    // Fire every useFrame subscriber so the balls/hands move to this sim time; the
    // synthetic timestamp keeps r3f's internal clock advancing without a wall read.
    root.advance((k + 1) * (1000 / options.fps));
    // Place the camera (frozen or turntable) and render with it.
    const position = options.turntable
      ? orbitPosition(cameraPosition, target, schedule.turntableAngles[k] as number)
      : cameraPosition;
    root.camera.position.set(position[0], position[1], position[2]);
    root.camera.lookAt(target[0], target[1], target[2]);
    root.camera.updateMatrixWorld();
    root.gl.render(root.scene, root.camera);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(glCanvas, 0, 0, width, height);
  };

  try {
    const filename = `airtime-${sanitizePatternForFilename(store.sim.patternText)}.${
      options.format === 'webm' ? 'webm' : 'gif'
    }`;

    if (options.format === 'gif') {
      const encoder = createGifEncoder({ width, height, delayMs: schedule.frameDelayMs });
      for (let k = 0; k < schedule.frameCount; k++) {
        if (cancel.cancelled) {
          throw new ExportCancelledError();
        }
        renderFrameToScratch(k);
        encoder.addFrame(ctx.getImageData(0, 0, width, height).data);
        onProgress(k + 1, schedule.frameCount);
        await nextTick();
      }
      const blob = new Blob([encoder.finish() as BlobPart], { type: 'image/gif' });
      return { blob, filename, frameCount: schedule.frameCount, width, height };
    }

    // WebM via WebCodecs.
    const blob = await encodeWebm(schedule, width, height, renderFrameToScratch, scratch, onProgress, cancel);
    return { blob, filename, frameCount: schedule.frameCount, width, height };
  } finally {
    restore();
  }
}

/** Encode the scheduled frames through a WebCodecs VideoEncoder and mux to WebM. */
async function encodeWebm(
  schedule: ReturnType<typeof buildExportSchedule>,
  width: number,
  height: number,
  renderFrameToScratch: (k: number) => void,
  scratch: HTMLCanvasElement,
  onProgress: ExportProgress,
  cancel: ExportCancel,
): Promise<Blob> {
  // Pick the first codec the browser can actually encode at this size.
  const chosen = await pickWebmCodec(width, height);
  if (chosen === null) {
    throw new ExportError('No supported WebM video codec (VP8/VP9) in this browser.');
  }

  const chunks: WebmFrame[] = [];
  // An object holder (not a bare `let`): the error is set inside the encoder's
  // callback, and reading a property keeps TS from narrowing it away as `never`.
  const errorHolder: { current: Error | null } = { current: null };
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ data, keyFrame: chunk.type === 'key', timestampUs: chunk.timestamp });
    },
    error: (err) => {
      errorHolder.current = err instanceof Error ? err : new Error(String(err));
    },
  });
  encoder.configure({ codec: chosen.codec, width, height, framerate: schedule.fps });

  const frameDurationUs = (schedule.totalDuration * 1_000_000) / schedule.frameCount;
  try {
    for (let k = 0; k < schedule.frameCount; k++) {
      if (cancel.cancelled) {
        throw new ExportCancelledError();
      }
      const midError = errorHolder.current;
      if (midError !== null) {
        throw new ExportError(`WebM encoding failed: ${midError.message}`);
      }
      renderFrameToScratch(k);
      const frame = new VideoFrame(scratch, { timestamp: Math.round(k * frameDurationUs) });
      // Keyframe every frame: robust playback without a Cues index (short loop).
      encoder.encode(frame, { keyFrame: true });
      frame.close();
      onProgress(k + 1, schedule.frameCount);
      await nextTick();
    }
    await encoder.flush();
  } finally {
    encoder.close();
  }
  const finalError = errorHolder.current;
  if (finalError !== null) {
    throw new ExportError(`WebM encoding failed: ${finalError.message}`);
  }

  return new Blob(
    [
      muxWebm({
        width,
        height,
        codecId: chosen.id,
        frames: chunks,
        durationMs: schedule.totalDuration * 1000,
      }) as BlobPart,
    ],
    { type: 'video/webm' },
  );
}

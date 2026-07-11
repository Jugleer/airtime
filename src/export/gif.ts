// src/export/gif — a thin, deterministic wrapper over the bundled `gifenc`
// encoder, plus a minimal GIF structure walker used by tests and the e2e check.
//
// Encoding is INCREMENTAL: the capture loop renders + grabs one frame, hands its
// RGBA pixels to {@link GifEncoderSession.addFrame}, then yields; only the header
// and per-frame tables live in memory as we go. Each frame gets its own quantized
// 256-color local palette (gifenc's quantize is deterministic — no RNG — so
// identical pixels always produce identical bytes, honoring the determinism gate).
// A single global palette would shrink files but needs all frames up front; the
// per-frame palette keeps the pipeline streaming and higher-quality for a 3D scene.

import { GIFEncoder, applyPalette, quantize } from 'gifenc';

/** Max colors per frame palette (a full GIF local color table). */
const GIF_MAX_COLORS = 256;

export interface GifEncoderSession {
  /** Encode one RGBA frame (row-major, 4 bytes/px, width·height·4 long). */
  addFrame(rgba: Uint8Array | Uint8ClampedArray): void;
  /** Finalize and return the complete GIF89a byte stream. */
  finish(): Uint8Array;
}

/**
 * The integer centisecond delay for the next frame given the running true-time
 * accumulator, then the advanced accumulator. GIF stores each frame's delay in whole
 * CENTISECONDS, so handing gifenc a uniform fractional millisecond delay (24 fps →
 * 41.667 ms → rounds to 4 cs = 40 ms) makes EVERY frame ~4% fast and the error
 * compounds across the loop — the tempo drifts and, over a full period, the loop seam
 * shifts. Instead we accumulate true elapsed milliseconds and emit
 * round(cumulativeMs / 10) − centisecondsAlreadyEmitted each frame, so the running sum
 * of centiseconds tracks true time to within one centisecond (the per-frame delay
 * dithers between 4 and 5 cs) — correct total duration AND a seamless loop.
 */
function nextFrameDelayCs(cumulativeMs: number, emittedCs: number): { delayCs: number; emittedCs: number } {
  const targetCs = Math.round(cumulativeMs / 10);
  return { delayCs: targetCs - emittedCs, emittedCs: targetCs };
}

/**
 * Per-frame integer centisecond delays for `frameCount` frames each nominally
 * `delayMs` long, via the running-time accumulator ({@link nextFrameDelayCs}). Their
 * sum equals the total duration to within one centisecond. Pure — exported for the
 * tempo unit test; {@link createGifEncoder} applies the same accumulator incrementally.
 */
export function accumulatedFrameDelaysCs(delayMs: number, frameCount: number): number[] {
  const delays: number[] = [];
  let cumulativeMs = 0;
  let emittedCs = 0;
  for (let k = 0; k < frameCount; k++) {
    cumulativeMs += delayMs;
    const step = nextFrameDelayCs(cumulativeMs, emittedCs);
    delays.push(step.delayCs);
    emittedCs = step.emittedCs;
  }
  return delays;
}

/**
 * Start a streaming GIF encode at `width`×`height` with a nominal `delayMs` per-frame
 * delay. Each frame's actual delay comes from the true-time centisecond accumulator
 * (see {@link nextFrameDelayCs}), so the loop keeps both its tempo and its seam. The
 * stream loops forever (`repeat: 0`), so a seamless frame schedule (see ./schedule)
 * plays as an unbroken loop.
 */
export function createGifEncoder(opts: {
  readonly width: number;
  readonly height: number;
  readonly delayMs: number;
}): GifEncoderSession {
  const { width, height, delayMs } = opts;
  const gif = GIFEncoder();
  let cumulativeMs = 0;
  let emittedCs = 0;
  return {
    addFrame(rgba) {
      const palette = quantize(rgba, GIF_MAX_COLORS);
      const index = applyPalette(rgba, palette);
      cumulativeMs += delayMs;
      const step = nextFrameDelayCs(cumulativeMs, emittedCs);
      emittedCs = step.emittedCs;
      // Hand gifenc an exact multiple of 10 ms so its internal round-to-centiseconds
      // is a no-op and the accumulator's integer centisecond delay is written verbatim.
      gif.writeFrame(index, width, height, { palette, delay: step.delayCs * 10, repeat: 0 });
    },
    finish() {
      gif.finish();
      return gif.bytes();
    },
  };
}

/** True when `bytes` begins with the GIF89a signature. */
export function isGif89a(bytes: Uint8Array): boolean {
  // "GIF89a" = 47 49 46 38 39 61
  return (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    bytes[4] === 0x39 &&
    bytes[5] === 0x61
  );
}

/** Walk a byte block's length-prefixed sub-blocks; return the index past the 0 terminator. */
function skipSubBlocks(bytes: Uint8Array, start: number): number {
  let p = start;
  while (p < bytes.length) {
    const size = bytes[p] as number;
    p += 1;
    if (size === 0) {
      break;
    }
    p += size;
  }
  return p;
}

/**
 * Count image frames by walking the GIF block structure (header → logical screen
 * descriptor → extensions/images → trailer), NOT by scanning for the 0x2C byte
 * (which also occurs inside pixel data). Returns 0 for a non-GIF89a stream. Used
 * by the unit tests and the headless e2e assertion.
 */
export function gifFrameCount(bytes: Uint8Array): number {
  if (!isGif89a(bytes)) {
    return 0;
  }
  // Logical Screen Descriptor is 7 bytes at offset 6; its packed byte is at 10.
  const packed = bytes[10] as number;
  const hasGct = (packed & 0x80) !== 0;
  const gctSize = hasGct ? 3 * (1 << ((packed & 0x07) + 1)) : 0;
  let p = 13 + gctSize;
  let frames = 0;
  while (p < bytes.length) {
    const marker = bytes[p] as number;
    if (marker === 0x3b) {
      break; // trailer
    }
    if (marker === 0x21) {
      // Extension: introducer(1) + label(1) + sub-blocks.
      p += 2;
      p = skipSubBlocks(bytes, p);
    } else if (marker === 0x2c) {
      // Image Descriptor: separator(1) + 9 bytes; then optional local color table.
      frames += 1;
      const idPacked = bytes[p + 9] as number;
      const hasLct = (idPacked & 0x80) !== 0;
      const lctSize = hasLct ? 3 * (1 << ((idPacked & 0x07) + 1)) : 0;
      p += 10 + lctSize;
      p += 1; // LZW minimum code size
      p = skipSubBlocks(bytes, p);
    } else {
      break; // malformed / unexpected
    }
  }
  return frames;
}

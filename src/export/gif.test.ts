import { describe, expect, it } from 'vitest';
import { accumulatedFrameDelaysCs, createGifEncoder, gifFrameCount, isGif89a } from './gif';

/** A solid-color w×h RGBA frame. */
function solidFrame(width: number, height: number, r: number, g: number, b: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

describe('gif encoder + inspector', () => {
  it('encodes a valid GIF89a with the expected frame count and trailer', () => {
    const width = 4;
    const height = 4;
    const enc = createGifEncoder({ width, height, delayMs: 66.7 });
    enc.addFrame(solidFrame(width, height, 200, 30, 30));
    enc.addFrame(solidFrame(width, height, 30, 200, 30));
    enc.addFrame(solidFrame(width, height, 30, 30, 200));
    const bytes = enc.finish();

    expect(isGif89a(bytes)).toBe(true);
    expect(bytes[bytes.length - 1]).toBe(0x3b); // trailer
    expect(gifFrameCount(bytes)).toBe(3);
    expect(bytes.length).toBeGreaterThan(20);
  });

  it('is deterministic: identical frames produce identical bytes', () => {
    const build = (): Uint8Array => {
      const enc = createGifEncoder({ width: 3, height: 3, delayMs: 40 });
      enc.addFrame(solidFrame(3, 3, 10, 20, 30));
      enc.addFrame(solidFrame(3, 3, 40, 50, 60));
      return enc.finish();
    };
    expect(Array.from(build())).toEqual(Array.from(build()));
  });

  it('gifFrameCount rejects non-GIF data', () => {
    expect(gifFrameCount(new Uint8Array([1, 2, 3, 4, 5, 6]))).toBe(0);
    expect(isGif89a(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]))).toBe(false); // GIF87a
  });
});

describe('accumulated frame delays keep GIF tempo exact', () => {
  it('24 fps over 25 frames sums to the true duration within 1 cs (4/5 cs pattern)', () => {
    const fps = 24;
    const frames = 25;
    const delayMs = 1000 / fps; // 41.6667 ms — the fractional delay gifenc would round
    const delays = accumulatedFrameDelaysCs(delayMs, frames);
    expect(delays).toHaveLength(frames);
    // Every frame is 4 or 5 centiseconds (40 or 50 ms) — the dither around 41.667 ms.
    expect(delays.every((d) => d === 4 || d === 5)).toBe(true);
    expect(delays).toContain(5); // at least one 5-cs frame, else it would be a flat 4 cs
    // The summed centiseconds equal the true total duration to within one centisecond.
    const summedCs = delays.reduce((a, b) => a + b, 0);
    const trueTotalCs = (delayMs * frames) / 10;
    expect(Math.abs(summedCs - trueTotalCs)).toBeLessThanOrEqual(1);
    // The naive uniform approach (round(41.667/10)=4 cs each) would be ~4% fast:
    expect(4 * frames).toBeLessThan(trueTotalCs - 1); // 100 cs vs ~104.17 cs — visibly off
  });

  it('an already-integer-centisecond delay reproduces a flat schedule', () => {
    // 20 fps = 50 ms = exactly 5 cs: no dither needed, every frame is 5 cs.
    expect(accumulatedFrameDelaysCs(50, 6)).toEqual([5, 5, 5, 5, 5, 5]);
  });
});

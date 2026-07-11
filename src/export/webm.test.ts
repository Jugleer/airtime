import { describe, expect, it } from 'vitest';
import { isWebm, muxWebm, type WebmFrame } from './webm';

/** Read an EBML element id + data size at `offset`; returns the next offset + size. */
function readElement(bytes: Uint8Array, offset: number): { idLen: number; size: number; dataStart: number } {
  // Element id length from the first byte's leading marker.
  const first = bytes[offset] as number;
  let idLen = 1;
  for (let mask = 0x80; mask > 0; mask >>= 1) {
    if (first & mask) {
      break;
    }
    idLen += 1;
  }
  // Data-size VINT length from the byte after the id.
  const sizeFirst = bytes[offset + idLen] as number;
  let sizeLen = 1;
  for (let mask = 0x80; mask > 0; mask >>= 1) {
    if (sizeFirst & mask) {
      break;
    }
    sizeLen += 1;
  }
  let size = sizeFirst & (0xff >> sizeLen);
  for (let i = 1; i < sizeLen; i++) {
    size = size * 256 + (bytes[offset + idLen + i] as number);
  }
  return { idLen, size, dataStart: offset + idLen + sizeLen };
}

function fakeFrame(byte: number, keyFrame: boolean, timestampUs: number): WebmFrame {
  return { data: new Uint8Array([byte, byte, byte, byte]), keyFrame, timestampUs };
}

describe('webm muxer (EBML structure)', () => {
  it('produces a WebM stream with a well-formed EBML header + Segment', () => {
    const frames = [
      fakeFrame(0x11, true, 0),
      fakeFrame(0x22, true, 41_667),
      fakeFrame(0x33, true, 83_333),
    ];
    const bytes = muxWebm({ width: 32, height: 24, codecId: 'V_VP9', frames, durationMs: 125 });

    expect(isWebm(bytes)).toBe(true);

    // First element is the EBML header; its declared size fits inside the stream.
    const ebml = readElement(bytes, 0);
    expect(bytes[0]).toBe(0x1a);
    expect(ebml.dataStart + ebml.size).toBeLessThanOrEqual(bytes.length);

    // The next element is the Segment (id 0x18538067) and covers the remainder.
    const segmentOffset = ebml.dataStart + ebml.size;
    expect(bytes[segmentOffset]).toBe(0x18);
    const segment = readElement(bytes, segmentOffset);
    expect(segment.dataStart + segment.size).toBe(bytes.length);

    // The "webm" DocType string is present in the header bytes.
    const text = String.fromCharCode(...bytes.slice(0, ebml.dataStart + ebml.size));
    expect(text).toContain('webm');
  });

  it('rejects non-webm data', () => {
    expect(isWebm(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe(false);
  });
});

// src/export/webm — a tiny, self-contained WebM (Matroska subset) muxer for the
// WebCodecs export path, plus its feature detection. Deliberately dependency-free
// (CLAUDE.md: bundled/synthesized only, zero external requests) — the alternative,
// MediaRecorder, is realtime screen capture, which the design forbids.
//
// Scope: ONE video track (VP8/VP9), one Cluster per frame, each block a keyframe
// (so playback is robust without a Cues index — fine for a short seamless loop).
// The encoded frames come from WebCodecs' VideoEncoder (see ./capture); this module
// only frames them into the container. The EBML element structure is unit-tested;
// the real VideoEncoder path is exercised only where the browser supports it.

/** One encoded video frame handed to the muxer. */
export interface WebmFrame {
  readonly data: Uint8Array;
  readonly keyFrame: boolean;
  /** Presentation timestamp in microseconds (from the encoder / our schedule). */
  readonly timestampUs: number;
}

/** VP9 first, VP8 fallback — both are royalty-free and widely decodable. The
 * canonical codec candidate list; src/export/capture.ts reuses this (not its own
 * copy) so the "what can we encode" logic lives in one place. */
export const WEBM_CODECS: readonly { readonly codec: string; readonly id: 'V_VP8' | 'V_VP9' }[] = [
  { codec: 'vp09.00.10.08', id: 'V_VP9' },
  { codec: 'vp8', id: 'V_VP8' },
];

/** Nominal probe size for feature detection only — the real export re-probes at its
 * actual target resolution (see capture.ts's encodeWebm), but codec *availability*
 * does not vary with size in practice, so any reasonable size is a valid probe. */
const PROBE_WIDTH = 640;
const PROBE_HEIGHT = 480;

/**
 * Find the first {@link WEBM_CODECS} candidate the browser can actually encode at
 * the given size, or null if none can. Returns null immediately (no probing) when
 * VideoEncoder is unavailable.
 */
export async function pickWebmCodec(
  width: number = PROBE_WIDTH,
  height: number = PROBE_HEIGHT,
): Promise<{ readonly codec: string; readonly id: 'V_VP8' | 'V_VP9' } | null> {
  if (
    typeof globalThis === 'undefined' ||
    typeof (globalThis as { VideoEncoder?: unknown }).VideoEncoder === 'undefined'
  ) {
    return null;
  }
  for (const candidate of WEBM_CODECS) {
    try {
      const support = await VideoEncoder.isConfigSupported({ codec: candidate.codec, width, height });
      if (support.supported === true) {
        return candidate;
      }
    } catch {
      // Try the next codec.
    }
  }
  return null;
}

/**
 * True when the browser can actually ENCODE WebM video (VP8 or VP9), not merely
 * expose the WebCodecs types. iOS Safari, notably, exposes VideoEncoder/VideoFrame
 * but throws/rejects on every VP8/VP9 config — checking type existence alone would
 * show a WebM option that fails at encode time. This probes real support via
 * VideoEncoder.isConfigSupported instead.
 */
export async function isWebmExportSupported(): Promise<boolean> {
  if (
    typeof globalThis === 'undefined' ||
    typeof (globalThis as { VideoEncoder?: unknown }).VideoEncoder === 'undefined' ||
    typeof (globalThis as { VideoFrame?: unknown }).VideoFrame === 'undefined'
  ) {
    return false;
  }
  const chosen = await pickWebmCodec();
  return chosen !== null;
}

// --- EBML primitives ---------------------------------------------------------

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) {
    total += part.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Encode a non-negative integer as a big-endian, minimal-width byte string. */
function uintBytes(value: number): Uint8Array {
  if (value <= 0) {
    return new Uint8Array([0]);
  }
  const bytes: number[] = [];
  let v = value;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return new Uint8Array(bytes);
}

/** Encode an EBML data size as a variable-length integer (VINT) with its marker. */
function vintSize(size: number): Uint8Array {
  let length = 1;
  // Reserve the all-ones pattern (that means "unknown size").
  while (size >= 2 ** (7 * length) - 1) {
    length += 1;
  }
  const bytes = new Uint8Array(length);
  let value = size;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = value & 0xff;
    value = Math.floor(value / 256);
  }
  bytes[0] = (bytes[0] as number) | (0x80 >> (length - 1)); // length-descriptor marker
  return bytes;
}

/** A full EBML element: id (raw, marker included) + data-size VINT + payload. */
function el(id: readonly number[], payload: Uint8Array): Uint8Array {
  return concat([new Uint8Array(id), vintSize(payload.length), payload]);
}

function uintEl(id: readonly number[], value: number): Uint8Array {
  return el(id, uintBytes(value));
}

function stringEl(id: readonly number[], text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return el(id, bytes);
}

function floatEl(id: readonly number[], value: number): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value, false); // big-endian double
  return el(id, new Uint8Array(buf));
}

// --- Matroska element ids ----------------------------------------------------

const ID = {
  EBML: [0x1a, 0x45, 0xdf, 0xa3],
  EBMLVersion: [0x42, 0x86],
  EBMLReadVersion: [0x42, 0xf7],
  EBMLMaxIDLength: [0x42, 0xf2],
  EBMLMaxSizeLength: [0x42, 0xf3],
  DocType: [0x42, 0x82],
  DocTypeVersion: [0x42, 0x87],
  DocTypeReadVersion: [0x42, 0x85],
  Segment: [0x18, 0x53, 0x80, 0x67],
  Info: [0x15, 0x49, 0xa9, 0x66],
  TimecodeScale: [0x2a, 0xd7, 0xb1],
  MuxingApp: [0x4d, 0x80],
  WritingApp: [0x57, 0x41],
  Duration: [0x44, 0x89],
  Tracks: [0x16, 0x54, 0xae, 0x6b],
  TrackEntry: [0xae],
  TrackNumber: [0xd7],
  TrackUID: [0x73, 0xc5],
  TrackType: [0x83],
  FlagLacing: [0x9c],
  CodecID: [0x86],
  Video: [0xe0],
  PixelWidth: [0xb0],
  PixelHeight: [0xba],
  Cluster: [0x1f, 0x43, 0xb6, 0x75],
  Timecode: [0xe7],
  SimpleBlock: [0xa3],
} as const;

/** TimecodeScale of 1e6 ns = 1 ms — cluster timecodes below are in milliseconds. */
const TIMECODE_SCALE_NS = 1_000_000;

function simpleBlock(frame: WebmFrame): Uint8Array {
  // Track number 1 as a VINT (0x81), int16 relative timecode 0, flags, then data.
  const trackVint = new Uint8Array([0x81]);
  const relTimecode = new Uint8Array([0x00, 0x00]);
  const flags = new Uint8Array([frame.keyFrame ? 0x80 : 0x00]);
  return el(ID.SimpleBlock, concat([trackVint, relTimecode, flags, frame.data]));
}

function cluster(frame: WebmFrame): Uint8Array {
  const timecodeMs = Math.max(0, Math.round(frame.timestampUs / 1000));
  return el(ID.Cluster, concat([uintEl(ID.Timecode, timecodeMs), simpleBlock(frame)]));
}

/**
 * Mux encoded VP8/VP9 frames into a complete WebM byte stream. `codecId` is the
 * Matroska codec id ("V_VP9" / "V_VP8"); `frames` carry their own presentation
 * timestamps. `durationMs` (optional) is written into Info for correct total length.
 */
export function muxWebm(opts: {
  readonly width: number;
  readonly height: number;
  readonly codecId: 'V_VP8' | 'V_VP9';
  readonly frames: readonly WebmFrame[];
  readonly durationMs?: number;
}): Uint8Array {
  const { width, height, codecId, frames, durationMs } = opts;

  const ebmlHeader = el(
    ID.EBML,
    concat([
      uintEl(ID.EBMLVersion, 1),
      uintEl(ID.EBMLReadVersion, 1),
      uintEl(ID.EBMLMaxIDLength, 4),
      uintEl(ID.EBMLMaxSizeLength, 8),
      stringEl(ID.DocType, 'webm'),
      uintEl(ID.DocTypeVersion, 2),
      uintEl(ID.DocTypeReadVersion, 2),
    ]),
  );

  const infoChildren: Uint8Array[] = [
    uintEl(ID.TimecodeScale, TIMECODE_SCALE_NS),
    stringEl(ID.MuxingApp, 'airtime'),
    stringEl(ID.WritingApp, 'airtime'),
  ];
  if (durationMs !== undefined && Number.isFinite(durationMs)) {
    infoChildren.push(floatEl(ID.Duration, durationMs));
  }
  const info = el(ID.Info, concat(infoChildren));

  const trackEntry = el(
    ID.TrackEntry,
    concat([
      uintEl(ID.TrackNumber, 1),
      uintEl(ID.TrackUID, 1),
      uintEl(ID.TrackType, 1), // 1 = video
      uintEl(ID.FlagLacing, 0),
      stringEl(ID.CodecID, codecId),
      el(ID.Video, concat([uintEl(ID.PixelWidth, width), uintEl(ID.PixelHeight, height)])),
    ]),
  );
  const tracks = el(ID.Tracks, trackEntry);

  const clusters = frames.map(cluster);
  const segment = el(ID.Segment, concat([info, tracks, ...clusters]));

  return concat([ebmlHeader, segment]);
}

/** True when `bytes` begins with the EBML header id (the WebM magic). */
export function isWebm(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  );
}

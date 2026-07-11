// Type surface for the bundled `gifenc` package (it ships no .d.ts). Only the
// members Airtime's exporter uses are declared. gifenc is a pure, dependency-free
// in-browser GIF encoder (CLAUDE.md: bundled dep, zero external requests).

declare module 'gifenc' {
  /** A palette entry: [r, g, b] (or [r, g, b, a] for rgba formats). */
  export type PaletteColor = number[];
  export type Palette = PaletteColor[];

  export type QuantizeFormat = 'rgb565' | 'rgb444' | 'rgba4444';

  export interface WriteFrameOptions {
    /** Local color table for this frame. REQUIRED on the first frame. */
    readonly palette?: Palette | null;
    /** Frame delay in MILLISECONDS (gifenc rounds to centiseconds internally). */
    readonly delay?: number;
    /** Loop count; 0 = loop forever (written on the first frame). */
    readonly repeat?: number;
    readonly transparent?: boolean;
    readonly transparentIndex?: number;
    readonly colorDepth?: number;
    readonly dispose?: number;
    readonly first?: boolean;
  }

  export interface GIFEncoderInstance {
    reset(): void;
    finish(): void;
    /** A copy of the encoded GIF bytes. */
    bytes(): Uint8Array;
    /** A live view of the encoded GIF bytes (no copy). */
    bytesView(): Uint8Array;
    writeHeader(): void;
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOptions): void;
  }

  export function GIFEncoder(opts?: {
    readonly initialCapacity?: number;
    readonly auto?: boolean;
  }): GIFEncoderInstance;

  export interface QuantizeOptions {
    readonly format?: QuantizeFormat;
    readonly oneBitAlpha?: boolean | number;
    readonly clearAlpha?: boolean;
    readonly clearAlphaThreshold?: number;
    readonly clearAlphaColor?: number;
    readonly useSqrt?: boolean;
  }

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: QuantizeOptions,
  ): Palette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: QuantizeFormat,
  ): Uint8Array;
}

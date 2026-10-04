// Types for the part of gifenc 1.0.3 (MIT) that worker.ts uses. The package ships no types; this
// follows its README. The ES module build is imported directly, since its "browser" field points
// to the CommonJS build.

declare module "gifenc/dist/gifenc.esm.js" {
  export type Palette = number[][];

  export interface FrameOptions {
    palette?: Palette;
    /** Frame delay in milliseconds. */
    delay?: number;
    repeat?: number;
    transparent?: boolean;
    dispose?: number;
  }

  export interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, options?: FrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
  }

  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): Encoder;
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: "rgb565" | "rgb444" | "rgba4444" },
  ): Palette;
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: "rgb565" | "rgb444" | "rgba4444",
  ): Uint8Array;
}

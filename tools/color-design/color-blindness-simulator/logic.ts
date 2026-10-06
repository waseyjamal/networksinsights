// Pure logic of "Color Blindness Simulator": the file rules, the published colour matrices and
// how a picture's pixels are changed, with no DOM, no network and no top-level statements
// (docs/tool-contract.md). ui.tsx decodes the picture and draws each view on a canvas.

export const LIMITS = {
  maxInputBytes: 25 * 1024 * 1024,
  maxFiles: 1,
} as const;

/** Each view is drawn at most this many pixels on its longer side: our own choice, for speed. */
export const VIEW_MAX_SIDE = 1000;

/**
 * Machado, Oliveira and Fernandes (2009), "A Physiologically-based Model for Simulation of Color
 * Vision Deficiency", IEEE TVCG 15(6), severity 1.0, copied from the authors' page
 * (www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html). Rows give the new
 * red, green and blue from the old, in linear RGB.
 */
export const MATRICES = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
  /** No colour at all: every pixel becomes its relative luminance (ITU-R BT.709, as sRGB uses). */
  achromatopsia: [
    [0.2126, 0.7152, 0.0722],
    [0.2126, 0.7152, 0.0722],
    [0.2126, 0.7152, 0.0722],
  ],
} as const;

export type Vision = keyof typeof MATRICES;

export const VISIONS: Record<Vision, { label: string; about: string }> = {
  protanopia: { label: "Protanopia", about: "no red cones" },
  deuteranopia: { label: "Deuteranopia", about: "no green cones" },
  tritanopia: { label: "Tritanopia", about: "no blue cones" },
  achromatopsia: { label: "Achromatopsia", about: "no colour vision" },
};

/** Kept for the manifest's input schema: this tool takes only a picture. */
export interface Input {
  views: Vision[];
}

export const MESSAGES = {
  notAnImage: "This file is not a JPG, PNG or WebP image.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  unreadable: "This image could not be read. It may be damaged.",
} as const;

const TYPES = ["image/jpeg", "image/png", "image/webp"];

export function checkFile(file: { name: string; type: string; size: number }): string | null {
  const known =
    TYPES.includes(file.type) || (file.type === "" && /\.(jpe?g|png|webp)$/i.test(file.name));
  if (!known) return MESSAGES.notAnImage;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return null;
}

/** The size a view is drawn at: the picture's own, or smaller to fit VIEW_MAX_SIDE. */
export function viewSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, VIEW_MAX_SIDE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** An sRGB byte as linear light, 0 to 1 (IEC 61966-2-1). */
export function toLinear(byte: number): number {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Linear light as an sRGB byte, clamped to 0 to 255. */
export function toByte(linear: number): number {
  const value = Math.min(1, Math.max(0, linear));
  const encoded = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

/** One sRGB colour as a person with this vision would see it, in sRGB bytes. */
export function simulate(vision: Vision, rgb: readonly [number, number, number]): number[] {
  const linear = rgb.map(toLinear);
  return MATRICES[vision].map((row) =>
    toByte(row[0] * (linear[0] ?? 0) + row[1] * (linear[1] ?? 0) + row[2] * (linear[2] ?? 0)),
  );
}

/** Changes RGBA pixels in place for a vision; alpha is kept. Bytes are looked up, not recomputed. */
export function simulatePixels(vision: Vision, data: Uint8ClampedArray): void {
  const table = new Float64Array(256);
  for (let byte = 0; byte < 256; byte++) table[byte] = toLinear(byte);
  const m = MATRICES[vision];
  for (let i = 0; i < data.length; i += 4) {
    const r = table[data[i] ?? 0] ?? 0;
    const g = table[data[i + 1] ?? 0] ?? 0;
    const b = table[data[i + 2] ?? 0] ?? 0;
    data[i] = toByte(m[0][0] * r + m[0][1] * g + m[0][2] * b);
    data[i + 1] = toByte(m[1][0] * r + m[1][1] * g + m[1][2] * b);
    data[i + 2] = toByte(m[2][0] * r + m[2][1] * g + m[2][2] * b);
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

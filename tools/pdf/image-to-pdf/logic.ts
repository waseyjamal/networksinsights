// Pure logic of "Image to PDF": the file rules, the order of the list and where each picture sits
// on its page, with no DOM, no network and no top-level statements (docs/tool-contract.md,
// "logic.ts: what pure means"). worker.ts decodes the pictures and writes the PDF with pdf-lib.

export const LIMITS = {
  /** 25 MB per picture. */
  maxInputBytes: 25 * 1024 * 1024,
  maxFiles: 50,
} as const;

/** The largest picture read: 50 megapixels, under 200 MB of memory decoded. */
export const MAX_PIXELS = 50_000_000;

/** PDF sizes are in points, 72 to the inch. */
export const POINTS_PER_MM = 72 / 25.4;

export const PAGE_SIZES = {
  a4: { label: "A4 (210 × 297 mm)", width: 595.28, height: 841.89 },
  letter: { label: "US Letter (8.5 × 11 in)", width: 612, height: 792 },
  fit: { label: "Fit to each picture", width: 0, height: 0 },
} as const;

export type PageSize = keyof typeof PAGE_SIZES;

export const ORIENTATIONS = {
  auto: "Match each picture",
  portrait: "Portrait",
  landscape: "Landscape",
} as const;

export type Orientation = keyof typeof ORIENTATIONS;

export const MARGINS = {
  "0": "None",
  "10": "10 mm",
  "20": "20 mm",
} as const;

export type Margin = keyof typeof MARGINS;

export interface Settings {
  size: PageSize;
  orientation: Orientation;
  margin: Margin;
}

/** Kept for the manifest's input schema. */
export type Input = Settings;

export const INPUT_TYPES = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
} as const;

export type ImageType = keyof typeof INPUT_TYPES;

/** What the page sends the worker: the pictures in the order of the list, and the settings. */
export interface Job extends Settings {
  images: Array<{ name: string; data: Blob }>;
}

export interface JobResult {
  blob: Blob;
  pages: number;
}

export const MESSAGES = {
  notAnImage: "This file is not a JPG, PNG or WebP image.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooManyFiles: (count: number) => `Only ${count} pictures can go into one PDF.`,
  unreadable: (name: string) => `${name} could not be read. It may be damaged.`,
  tooManyPixels: (name: string) =>
    `${name} has more than 50 megapixels, more than the browser can hold.`,
  needOne: "Add at least one picture.",
  failed: "The PDF could not be made.",
} as const;

export function imageTypeOf(file: { name: string; type: string }): ImageType | undefined {
  if (file.type in INPUT_TYPES) return file.type as ImageType;
  if (file.type !== "") return;
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return;
}

export interface Rejected {
  name: string;
  reason: string;
}

export function checkFiles<F extends { name: string; type: string; size: number }>(
  files: readonly F[],
  already = 0,
): { accepted: F[]; rejected: Rejected[] } {
  const accepted: F[] = [];
  const rejected: Rejected[] = [];
  for (const file of files) {
    if (!imageTypeOf(file)) {
      rejected.push({ name: file.name, reason: MESSAGES.notAnImage });
    } else if (file.size > LIMITS.maxInputBytes) {
      rejected.push({
        name: file.name,
        reason: MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes)),
      });
    } else if (already + accepted.length >= LIMITS.maxFiles) {
      rejected.push({ name: file.name, reason: MESSAGES.tooManyFiles(LIMITS.maxFiles) });
    } else {
      accepted.push(file);
    }
  }
  return { accepted, rejected };
}

export function withinPixelLimit(width: number, height: number): boolean {
  return width > 0 && height > 0 && width * height <= MAX_PIXELS;
}

/** The list with the item at `index` moved by one place up (-1) or down (1). */
export function move<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const target = index + by;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item as T);
  return next;
}

/** A page, and the picture's box on it, in points from the bottom left corner. */
export interface Layout {
  pageWidth: number;
  pageHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a picture of `width` by `height` pixels goes. One pixel is one point at most: a picture is
 * shrunk to fit inside the margins, centred, and never enlarged. Fit to each picture makes the
 * page the picture's size plus the margins.
 */
export function layout(width: number, height: number, settings: Settings): Layout {
  const margin = Number(settings.margin) * POINTS_PER_MM;
  if (settings.size === "fit") {
    return {
      pageWidth: width + margin * 2,
      pageHeight: height + margin * 2,
      x: margin,
      y: margin,
      width,
      height,
    };
  }
  const paper = PAGE_SIZES[settings.size];
  const landscape =
    settings.orientation === "landscape" || (settings.orientation === "auto" && width > height);
  const pageWidth = landscape ? paper.height : paper.width;
  const pageHeight = landscape ? paper.width : paper.height;
  const roomWidth = Math.max(1, pageWidth - margin * 2);
  const roomHeight = Math.max(1, pageHeight - margin * 2);
  const scale = Math.min(1, roomWidth / width, roomHeight / height);
  const drawnWidth = width * scale;
  const drawnHeight = height * scale;
  return {
    pageWidth,
    pageHeight,
    x: (pageWidth - drawnWidth) / 2,
    y: (pageHeight - drawnHeight) / 2,
    width: drawnWidth,
    height: drawnHeight,
  };
}

/**
 * How a picture is put in the PDF: pdf-lib writes JPG and PNG. A JPG is saved again as JPG, a PNG
 * or WebP as PNG, so transparency is kept and every picture is upright (the browser applies the
 * camera's orientation when it decodes).
 */
export function embedAs(type: ImageType): "jpg" | "png" {
  return type === "image/jpeg" ? "jpg" : "png";
}

/** The JPG quality a JPG picture is saved again at. */
export const JPG_QUALITY = 0.92;

/** `holiday.jpg` first in the list gives `holiday.pdf`. */
export function outputName(firstName: string | undefined): string {
  const base = (firstName ?? "").replace(/\.[a-z0-9]{1,5}$/i, "").trim();
  return `${base || "images"}.pdf`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

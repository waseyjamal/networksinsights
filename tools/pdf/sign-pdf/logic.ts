// Pure logic of "Sign PDF": the file rules, the signature's box on the page and the trimming of
// the ink, with no DOM, no network and no top-level statements (docs/tool-contract.md, "logic.ts:
// what pure means"). ui.tsx draws the signature and puts it in the PDF with pdf-lib (ADR 0057).
// The result is a picture of a signature, not a certificate-based digital signature.

export const LIMITS = {
  /** 50 MB for the PDF. */
  maxInputBytes: 50 * 1024 * 1024,
  /** One PDF at a time; the signature picture is chosen on its own. */
  maxFiles: 1,
} as const;

/** An uploaded signature picture: up to 5 MB, JPG or PNG. */
export const MAX_SIGNATURE_BYTES = 5 * 1024 * 1024;

/** The gap between the signature and the page edge, in points (half an inch). */
export const EDGE = 36;

export type Source = "draw" | "type" | "upload";

export const SOURCES = {
  draw: "Draw it",
  type: "Type it",
  upload: "Upload a picture",
} as const;

export const POSITIONS = {
  "bottom-right": "Bottom right",
  "bottom-center": "Bottom centre",
  "bottom-left": "Bottom left",
  "top-right": "Top right",
  "top-left": "Top left",
  center: "Centre",
} as const;

export type Position = keyof typeof POSITIONS;

export const WIDTHS = {
  "20": "Small (20% of the page width)",
  "30": "Medium (30%)",
  "40": "Large (40%)",
} as const;

export type Width = keyof typeof WIDTHS;

/** Kept for the manifest's input schema. */
export interface Input {
  source: Source;
  page: number;
  position: Position;
  width: Width;
}

export const MESSAGES = {
  notAPdf: "This file is not a PDF.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  notAPicture: "The signature picture must be a PNG or JPG.",
  pictureTooLarge: "The signature picture is larger than 5 MB.",
  pictureUnreadable: "The browser could not read this picture. It may be damaged.",
  encrypted:
    "This PDF is protected with a password. Remove the password in the program that made it, then try again.",
  unreadable: "This PDF could not be read. It may be damaged or not a real PDF.",
  noPages: "This PDF has no pages.",
  page: (pages: number) =>
    `Choose a page from 1 to ${pages}: this PDF has ${pages} ${pages === 1 ? "page" : "pages"}.`,
  noSignature: "Draw, type or upload your signature first.",
  failed: "The signature could not be added to this PDF.",
} as const;

export function isPdf(file: { name: string; type: string }): boolean {
  if (file.type === "application/pdf") return true;
  return file.type === "" && /\.pdf$/i.test(file.name);
}

export function checkPdf(file: { name: string; type: string; size: number }): string | undefined {
  if (!isPdf(file)) return MESSAGES.notAPdf;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return;
}

export function checkPicture(file: {
  name: string;
  type: string;
  size: number;
}): string | undefined {
  const png = file.type === "image/png" || (file.type === "" && /\.png$/i.test(file.name));
  const jpg = file.type === "image/jpeg" || (file.type === "" && /\.jpe?g$/i.test(file.name));
  if (!png && !jpg) return MESSAGES.notAPicture;
  if (file.size > MAX_SIGNATURE_BYTES) return MESSAGES.pictureTooLarge;
  return;
}

/** A page number the visitor typed, checked against the PDF. */
export function checkPage(value: number | undefined, pages: number): string | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > pages) {
    return MESSAGES.page(pages);
  }
  return;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The signature's box as the page is seen, in points from its bottom left corner. The width is a
 * share of the page width; the height follows the picture, and both shrink if the box would not
 * fit inside the edges.
 */
export function signatureBox(
  page: { width: number; height: number },
  picture: { width: number; height: number },
  position: Position,
  width: Width,
): Box {
  const roomWidth = Math.max(1, page.width - EDGE * 2);
  const roomHeight = Math.max(1, page.height - EDGE * 2);
  let boxWidth = Math.min(roomWidth, (page.width * Number(width)) / 100);
  let boxHeight = (boxWidth * picture.height) / picture.width;
  if (boxHeight > roomHeight) {
    boxHeight = roomHeight;
    boxWidth = (boxHeight * picture.width) / picture.height;
  }
  const left = EDGE;
  const right = page.width - EDGE - boxWidth;
  const centre = (page.width - boxWidth) / 2;
  const bottom = EDGE;
  const top = page.height - EDGE - boxHeight;
  const middle = (page.height - boxHeight) / 2;
  const at: Record<Position, [number, number]> = {
    "bottom-right": [right, bottom],
    "bottom-center": [centre, bottom],
    "bottom-left": [left, bottom],
    "top-right": [right, top],
    "top-left": [left, top],
    center: [centre, middle],
  };
  const [x, y] = at[position];
  return { x, y, width: boxWidth, height: boxHeight };
}

/** The size of a page as it is seen: a page turned a quarter shows its sides swapped. */
export function seenSize(width: number, height: number, rotation: number) {
  const quarter = normalRotation(rotation) % 180 === 90;
  return quarter ? { width: height, height: width } : { width, height };
}

export function normalRotation(rotation: number): number {
  return (((Math.round(rotation / 90) * 90) % 360) + 360) % 360;
}

/**
 * Where to draw the picture in the page's own coordinates, and by how much to turn it, so that it
 * looks upright in `box` on a page shown turned by `rotation` degrees clockwise. `width` and
 * `height` are the page's own size (its media box), not the size it is seen at.
 */
export function placeOnPage(
  box: Box,
  page: { width: number; height: number },
  rotation: number,
): { x: number; y: number; width: number; height: number; rotate: number } {
  const { width: W, height: H } = page;
  const turn = normalRotation(rotation);
  const size = { width: box.width, height: box.height };
  if (turn === 90) return { x: W - box.y, y: box.x, ...size, rotate: 90 };
  if (turn === 180) return { x: W - box.x, y: H - box.y, ...size, rotate: 180 };
  if (turn === 270) return { x: box.y, y: H - box.x, ...size, rotate: 270 };
  return { x: box.x, y: box.y, ...size, rotate: 0 };
}

/**
 * The smallest box around the ink of a drawing, from its RGBA pixels: every pixel whose alpha is
 * over `threshold`. Nothing when the drawing is empty. A margin of `pad` pixels is kept.
 */
export function inkBox(
  data: ArrayLike<number>,
  width: number,
  height: number,
  pad = 4,
  threshold = 8,
): Box | undefined {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return;
  const x = Math.max(0, minX - pad);
  const y = Math.max(0, minY - pad);
  return {
    x,
    y,
    width: Math.min(width, maxX + pad + 1) - x,
    height: Math.min(height, maxY + pad + 1) - y,
  };
}

/** `contract.pdf` becomes `contract-signed.pdf`. */
export function outputName(inputName: string): string {
  const base = inputName.replace(/\.pdf$/i, "").trim() || "document";
  return `${base}-signed.pdf`;
}

/** Reads a number box: empty or not a number gives nothing. */
export function parseNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return;
  return value;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

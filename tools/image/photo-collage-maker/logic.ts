// Pure logic of "Photo Collage Maker": the file rules, the layouts, the output sizes, where each
// photo's cell sits and which part of the photo fills it, with no DOM, no network and no top-level
// statements (docs/tool-contract.md). ui.tsx draws the collage on a canvas from these numbers.

export const LIMITS = {
  /** 25 MB per photo. */
  maxInputBytes: 25 * 1024 * 1024,
  /** The largest layout holds six photos. */
  maxFiles: 6,
} as const;

/** JPG is saved at this quality: our own choice, high so little is lost. */
export const QUALITY = 0.92;

export const RANGES = {
  /** Space between the photos and around them, in pixels of the collage. */
  spacing: { min: 0, max: 100 },
  /** A line around each photo, in pixels of the collage. */
  border: { min: 0, max: 40 },
} as const;

interface Cell {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

/** Each layout is a grid; a cell may span several columns or rows. */
export const LAYOUTS = {
  "2-side": {
    label: "2 photos side by side",
    cols: 2,
    rows: 1,
    cells: [
      { col: 0, row: 0, cols: 1, rows: 1 },
      { col: 1, row: 0, cols: 1, rows: 1 },
    ],
  },
  "2-stack": {
    label: "2 photos, one above the other",
    cols: 1,
    rows: 2,
    cells: [
      { col: 0, row: 0, cols: 1, rows: 1 },
      { col: 0, row: 1, cols: 1, rows: 1 },
    ],
  },
  "3-left": {
    label: "3 photos: one large on the left",
    cols: 2,
    rows: 2,
    cells: [
      { col: 0, row: 0, cols: 1, rows: 2 },
      { col: 1, row: 0, cols: 1, rows: 1 },
      { col: 1, row: 1, cols: 1, rows: 1 },
    ],
  },
  "3-top": {
    label: "3 photos: one large on top",
    cols: 2,
    rows: 2,
    cells: [
      { col: 0, row: 0, cols: 2, rows: 1 },
      { col: 0, row: 1, cols: 1, rows: 1 },
      { col: 1, row: 1, cols: 1, rows: 1 },
    ],
  },
  "4-grid": {
    label: "4 photos in a 2 by 2 grid",
    cols: 2,
    rows: 2,
    cells: [
      { col: 0, row: 0, cols: 1, rows: 1 },
      { col: 1, row: 0, cols: 1, rows: 1 },
      { col: 0, row: 1, cols: 1, rows: 1 },
      { col: 1, row: 1, cols: 1, rows: 1 },
    ],
  },
  "6-grid": {
    label: "6 photos in a 3 by 2 grid",
    cols: 3,
    rows: 2,
    cells: [
      { col: 0, row: 0, cols: 1, rows: 1 },
      { col: 1, row: 0, cols: 1, rows: 1 },
      { col: 2, row: 0, cols: 1, rows: 1 },
      { col: 0, row: 1, cols: 1, rows: 1 },
      { col: 1, row: 1, cols: 1, rows: 1 },
      { col: 2, row: 1, cols: 1, rows: 1 },
    ],
  },
} as const satisfies Record<string, { label: string; cols: number; rows: number; cells: Cell[] }>;

export type LayoutId = keyof typeof LAYOUTS;

export const SIZES = {
  square: { label: "Square, 1080 × 1080", width: 1080, height: 1080 },
  portrait: { label: "Portrait, 1080 × 1350", width: 1080, height: 1350 },
  landscape: { label: "Landscape, 1920 × 1080", width: 1920, height: 1080 },
  story: { label: "Story, 1080 × 1920", width: 1080, height: 1920 },
} as const;

export type SizeId = keyof typeof SIZES;

export const FORMATS = {
  png: { label: "PNG", mime: "image/png", extension: "png" },
  jpg: { label: "JPG", mime: "image/jpeg", extension: "jpg" },
} as const;

export type FormatId = keyof typeof FORMATS;

export interface Settings {
  layout: LayoutId;
  size: SizeId;
  spacing: number;
  border: number;
  /** HEX colours, #rrggbb. */
  borderColor: string;
  background: string;
  format: FormatId;
}

export type Input = Settings;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MESSAGES = {
  notAnImage: "This file is not a JPG, PNG or WebP image.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooMany: `Up to ${LIMITS.maxFiles} photos can be used.`,
  unreadable: "This image could not be read. It may be damaged.",
  needMore: (count: number) =>
    `This layout holds ${count} photos. Add ${count === 1 ? "one more" : "more"} photos, or choose a layout for fewer.`,
  range: (label: string, min: number, max: number) =>
    `${label} must be from ${min} to ${max} pixels.`,
  color: "Use a HEX colour with 6 digits, such as #ffffff.",
  failed: "The collage could not be saved.",
} as const;

const TYPES = ["image/jpeg", "image/png", "image/webp"];

export function checkFile(file: { name: string; type: string; size: number }): string | null {
  const known =
    TYPES.includes(file.type) || (file.type === "" && /\.(jpe?g|png|webp)$/i.test(file.name));
  if (!known) return MESSAGES.notAnImage;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return null;
}

/** How many more photos fit. */
export function room(count: number): number {
  return Math.max(0, LIMITS.maxFiles - count);
}

/** How many photos a layout holds. */
export function slotsOf(layout: LayoutId): number {
  return LAYOUTS[layout].cells.length;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Every problem with the settings, by field. */
export function checkSettings(settings: Settings): Partial<Record<keyof Settings, string>> {
  const errors: Partial<Record<keyof Settings, string>> = {};
  for (const [key, label] of [
    ["spacing", "Spacing"],
    ["border", "Border"],
  ] as const) {
    const { min, max } = RANGES[key];
    const value = settings[key];
    if (!Number.isInteger(value) || value < min || value > max) {
      errors[key] = MESSAGES.range(label, min, max);
    }
  }
  if (!HEX.test(settings.borderColor)) errors.borderColor = MESSAGES.color;
  if (!HEX.test(settings.background)) errors.background = MESSAGES.color;
  return errors;
}

/**
 * The cell of each photo in a collage of `width` by `height` pixels: the grid's columns and rows
 * share the space left after the spacing, which runs between the cells and around the edge.
 */
export function cells(layout: LayoutId, width: number, height: number, spacing: number): Rect[] {
  const grid = LAYOUTS[layout];
  const cellWidth = (width - spacing * (grid.cols + 1)) / grid.cols;
  const cellHeight = (height - spacing * (grid.rows + 1)) / grid.rows;
  return grid.cells.map((cell: Cell) => {
    const { cols, rows } = cell;
    return {
      x: spacing + cell.col * (cellWidth + spacing),
      y: spacing + cell.row * (cellHeight + spacing),
      width: cols * cellWidth + (cols - 1) * spacing,
      height: rows * cellHeight + (rows - 1) * spacing,
    };
  });
}

/**
 * The part of a photo of `width` by `height` that fills a cell, as large as it can be and in the
 * middle: the photo covers the whole cell, and what sticks out is cut off.
 */
export function cover(width: number, height: number, cell: Rect): Rect {
  const scale = Math.max(cell.width / width, cell.height / height);
  const shownWidth = cell.width / scale;
  const shownHeight = cell.height / scale;
  return {
    x: (width - shownWidth) / 2,
    y: (height - shownHeight) / 2,
    width: shownWidth,
    height: shownHeight,
  };
}

/** The line around a cell: drawn inside it, so neighbouring photos never overlap. */
export function borderRect(cell: Rect, border: number): Rect {
  return {
    x: cell.x + border / 2,
    y: cell.y + border / 2,
    width: Math.max(0, cell.width - border),
    height: Math.max(0, cell.height - border),
  };
}

/** `beach.jpg` first gives `beach-collage.png`. */
export function outputName(firstName: string | undefined, format: FormatId): string {
  const base = (firstName ?? "").replace(/\.[^.]+$/, "").trim() || "photo";
  return `${base}-collage.${FORMATS[format].extension}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

// Pure logic of "Watermark PDF": the file rules, the settings and their limits, which characters
// the standard font can draw, and where each copy of the text goes, turned pages included, with no
// DOM, no network and no top-level statements (docs/tool-contract.md, "logic.ts: what pure
// means"). worker.ts opens the PDF and draws the text with pdf-lib (ADR 0057).

export const LIMITS = {
  /** 50 MB, one PDF at a time. */
  maxInputBytes: 50 * 1024 * 1024,
  maxFiles: 1,
} as const;

/** The watermark text: 1 to 100 characters on one line. Our own choice. */
export const MAX_TEXT = 100;

/** Font size in points: 8 to 200. Our own choice. */
export const FONT_SIZE = { min: 8, max: 200, initial: 60 } as const;

/** Opacity in percent: 5 to 100. */
export const OPACITY = { min: 5, max: 100, initial: 25 } as const;

/** The angle in degrees, counterclockwise: -180 to 180. */
export const ANGLE = { min: -180, max: 180, initial: 45 } as const;

/** Helvetica's cap height, as a share of the font size: the text is centred on it. */
export const CAP_HEIGHT = 0.718;

/** The most copies on one page when tiled, so a tiny size cannot make a huge file. Our own choice. */
export const MAX_TILES = 500;

export type Layout = "single" | "tiled";
export type Which = "all" | "chosen";

/** Kept for the manifest's input schema. */
export interface Input {
  text: string;
  fontSize: number;
  color: string;
  opacity: number;
  angle: number;
  layout: Layout;
  which: Which;
  pages: string;
}

export interface Settings {
  text: string;
  fontSize: string;
  color: string;
  opacity: string;
  angle: string;
  layout: Layout;
  which: Which;
  pages: string;
}

export interface Plan {
  text: string;
  fontSize: number;
  /** Red, green and blue, each 0 to 1. */
  rgb: [number, number, number];
  /** 0.05 to 1. */
  opacity: number;
  angle: number;
  layout: Layout;
  pages: number[];
}

/** What the page sends the worker: count the pages, or draw the watermark. */
export type Job = { kind: "count"; file: Blob } | { kind: "watermark"; file: Blob; plan: Plan };

/** What the worker sends back. */
export type JobResult =
  | { kind: "count"; pages: number }
  | { kind: "watermark"; blob: Blob; copies: number };

export const MESSAGES = {
  notAPdf: "This file is not a PDF.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  encrypted:
    "This PDF is protected with a password. Remove the password in the program that made it, then try again.",
  unreadable: "This PDF could not be read. It may be damaged or not a real PDF.",
  noPages: "This PDF has no pages.",
  noText: "Type the watermark text.",
  longText: `The watermark can be at most ${MAX_TEXT} characters.`,
  unsupported: (characters: string) =>
    `The standard PDF font cannot draw ${characters}. Use Latin letters, digits and common punctuation.`,
  fontSize: `The font size must be a whole number from ${FONT_SIZE.min} to ${FONT_SIZE.max} points.`,
  color: "The colour must be a hex colour such as #808080.",
  opacity: `The opacity must be a whole number from ${OPACITY.min} to ${OPACITY.max} percent.`,
  angle: `The angle must be a whole number from ${ANGLE.min} to ${ANGLE.max} degrees.`,
  emptyPages: "Type the pages to watermark, such as 1, 3-4.",
  badPart: (part: string) => `"${part}" is not a page or a range. Write pages like 4 or 2-6.`,
  backwards: (part: string) => `"${part}" runs backwards. Write the smaller page first.`,
  outside: (page: number, pages: number) =>
    `Page ${page} does not exist: this PDF has ${pages} ${pages === 1 ? "page" : "pages"}.`,
  failed: "The watermark could not be added.",
} as const;

/**
 * The characters outside Latin-1 that the standard fonts can still draw (WinAnsiEncoding, PDF 1.7
 * Annex D): the euro sign, curly quotes, dashes, the ellipsis and a few more.
 */
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

/** True when Helvetica, a standard PDF font, can draw this character. */
export function isDrawable(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return WIN_ANSI_EXTRA.includes(character);
}

/** Every character the font cannot draw, each once, in the order they appear. */
export function undrawable(text: string): string[] {
  const seen: string[] = [];
  for (const character of text) {
    if (!isDrawable(character) && !seen.includes(character)) seen.push(character);
  }
  return seen;
}

/** The text after trimming, or an error. Its length counts characters, not UTF-16 units. */
export function checkText(text: string): { ok: true; text: string } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, error: MESSAGES.noText };
  if ([...trimmed].length > MAX_TEXT) return { ok: false, error: MESSAGES.longText };
  const bad = undrawable(trimmed);
  if (bad.length > 0) {
    const list = bad.slice(0, 5).map((character) => `"${character}"`);
    return { ok: false, error: MESSAGES.unsupported(list.join(", ")) };
  }
  return { ok: true, text: trimmed };
}

/** `#rrggbb` or `#rgb` to red, green and blue from 0 to 1. */
export function parseColor(text: string): [number, number, number] | undefined {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!match?.[1]) return;
  const hex =
    match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join("") : match[1];
  return [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

/** A whole number from text, negative allowed, or undefined. */
export function parseInteger(text: string): number | undefined {
  const cleaned = text.replace(/\s/g, "").replace(/^[−–]/, "-");
  if (!/^-?\d+$/.test(cleaned)) return;
  const value = Number(cleaned);
  if (!Number.isSafeInteger(value)) return;
  return value;
}

/**
 * The pages chosen, counted from 1 and sorted, from text such as `1, 3-4, 7-`. A page named twice
 * counts once. `7-` runs to the last page.
 */
export function parsePages(
  text: string,
  pages: number,
): { ok: true; pages: number[] } | { ok: false; error: string } {
  const parts = text
    .split(/[,;]/)
    .map((part) => part.replace(/\s+/g, "").replace(/[–—]/g, "-"))
    .filter((part) => part !== "");
  if (parts.length === 0) return { ok: false, error: MESSAGES.emptyPages };
  const chosen = new Set<number>();
  for (const part of parts) {
    const match = /^(\d+)(?:-(\d*))?$/.exec(part);
    if (!match) return { ok: false, error: MESSAGES.badPart(part) };
    const from = Number(match[1]);
    const to = match[2] === "" ? pages : Number(match[2] ?? from);
    if (from < 1) return { ok: false, error: MESSAGES.badPart(part) };
    if (to < from) return { ok: false, error: MESSAGES.backwards(part) };
    if (from > pages) return { ok: false, error: MESSAGES.outside(from, pages) };
    if (to > pages) return { ok: false, error: MESSAGES.outside(to, pages) };
    for (let page = from; page <= to; page++) chosen.add(page);
  }
  return { ok: true, pages: [...chosen].sort((a, b) => a - b) };
}

/** Checks every setting against its limits. */
export function planWatermark(
  settings: Settings,
  pages: number,
): { ok: true; plan: Plan } | { ok: false; error: string } {
  const text = checkText(settings.text);
  if (!text.ok) return text;
  const fontSize = parseInteger(settings.fontSize);
  if (typeof fontSize === "undefined" || fontSize < FONT_SIZE.min || fontSize > FONT_SIZE.max) {
    return { ok: false, error: MESSAGES.fontSize };
  }
  const rgb = parseColor(settings.color);
  if (!rgb) return { ok: false, error: MESSAGES.color };
  const opacity = parseInteger(settings.opacity);
  if (typeof opacity === "undefined" || opacity < OPACITY.min || opacity > OPACITY.max) {
    return { ok: false, error: MESSAGES.opacity };
  }
  const angle = parseInteger(settings.angle);
  if (typeof angle === "undefined" || angle < ANGLE.min || angle > ANGLE.max) {
    return { ok: false, error: MESSAGES.angle };
  }
  let chosen = Array.from({ length: pages }, (_, index) => index + 1);
  if (settings.which === "chosen") {
    const parsed = parsePages(settings.pages, pages);
    if (!parsed.ok) return parsed;
    chosen = parsed.pages;
  }
  return {
    ok: true,
    plan: {
      text: text.text,
      fontSize,
      rgb,
      opacity: opacity / 100,
      angle,
      layout: settings.layout,
      pages: chosen,
    },
  };
}

/** A page's box in PDF points, and how it is shown: turned 0, 90, 180 or 270 degrees clockwise. */
export interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/** Where pdf-lib draws one copy: the start of its baseline, and its angle counterclockwise. */
export interface Placement {
  x: number;
  y: number;
  rotate: number;
}

/** Normalises any multiple of 90 to 0, 90, 180 or 270. */
export function normalRotation(angle: number): number {
  const quarter = Math.round(angle / 90) * 90;
  return ((quarter % 360) + 360) % 360;
}

/** The centres of the copies, on the page as it is seen (`width` by `height`). */
export function centres(
  layout: Layout,
  width: number,
  height: number,
  textWidth: number,
  fontSize: number,
  spread = 1,
): Array<[number, number]> {
  if (layout === "single") return [[width / 2, height / 2]];
  // Tiled: rows of copies, each row shifted by half a step, past every edge so turned copies
  // still reach the corners. The gaps (two font sizes across, three down) are our own choice.
  const stepX = (textWidth + fontSize * 2) * spread;
  const stepY = fontSize * 3 * spread;
  const reach = Math.hypot(width, height) / 2 + Math.max(textWidth, fontSize);
  const cx = width / 2;
  const cy = height / 2;
  const points: Array<[number, number]> = [];
  const rows = Math.ceil(reach / stepY);
  const columns = Math.ceil(reach / stepX) + 1;
  for (let row = -rows; row <= rows; row++) {
    const shift = Math.abs(row) % 2 === 1 ? stepX / 2 : 0;
    for (let column = -columns; column <= columns; column++) {
      points.push([cx + column * stepX + shift, cy + row * stepY]);
    }
  }
  return points;
}

/**
 * Where to draw one copy so its centre lands at (u, v) on the page as seen and it reads at `angle`
 * there, mapped back into the page's own coordinates for a turned page.
 */
export function placeCopy(
  box: PageBox,
  u: number,
  v: number,
  angle: number,
  textWidth: number,
  fontSize: number,
): Placement {
  const rotation = normalRotation(box.rotation);
  const radians = (angle * Math.PI) / 180;
  const halfWidth = textWidth / 2;
  const halfHeight = (fontSize * CAP_HEIGHT) / 2;
  // The baseline start, on the page as seen: the centre minus the turned half-size.
  const su = u - (halfWidth * Math.cos(radians) - halfHeight * Math.sin(radians));
  const sv = v - (halfWidth * Math.sin(radians) + halfHeight * Math.cos(radians));
  const { x, y, width, height } = box;
  const turn = (value: number) => ((value % 360) + 360) % 360;
  if (rotation === 90) return { x: x + width - sv, y: y + su, rotate: turn(angle + 90) };
  if (rotation === 180) return { x: x + width - su, y: y + height - sv, rotate: turn(angle + 180) };
  if (rotation === 270) return { x: x + sv, y: y + height - su, rotate: turn(angle + 270) };
  return { x: x + su, y: y + sv, rotate: turn(angle) };
}

/**
 * Every copy to draw on one page. Tiled copies whose centre lies outside the page are left out;
 * when more than MAX_TILES would remain, the gaps widen until they fit.
 */
export function placements(
  box: PageBox,
  layout: Layout,
  angle: number,
  textWidth: number,
  fontSize: number,
): Placement[] {
  const sideways = normalRotation(box.rotation) % 180 === 90;
  const width = sideways ? box.height : box.width;
  const height = sideways ? box.width : box.height;
  const margin = Math.max(textWidth, fontSize) / 2;
  const inside = ([u, v]: [number, number]) =>
    layout === "single" ||
    (u >= -margin && u <= width + margin && v >= -margin && v <= height + margin);
  let spread = 1;
  let points = centres(layout, width, height, textWidth, fontSize).filter(inside);
  while (points.length > MAX_TILES) {
    spread *= Math.max(1.05, Math.sqrt(points.length / MAX_TILES));
    points = centres(layout, width, height, textWidth, fontSize, spread).filter(inside);
  }
  return points.map(([u, v]) => placeCopy(box, u, v, angle, textWidth, fontSize));
}

export function isPdf(file: { name: string; type: string }): boolean {
  if (file.type === "application/pdf") return true;
  return file.type === "" && /\.pdf$/i.test(file.name);
}

export function checkFile(file: { name: string; type: string; size: number }): string | undefined {
  if (!isPdf(file)) return MESSAGES.notAPdf;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return;
}

/** `report.pdf` becomes `report-watermarked.pdf`. */
export function outputName(inputName: string): string {
  const base = inputName.replace(/\.pdf$/i, "").trim() || "document";
  return `${base}-watermarked.pdf`;
}

export function pagesLabel(count: number): string {
  return `${count} ${count === 1 ? "page" : "pages"}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

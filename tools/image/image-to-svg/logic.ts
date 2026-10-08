// Pure logic of "Image to SVG": the file rules, the size the picture is traced at, the presets,
// and the SVG text written from imagetracerjs's traced shapes, with a check that the text holds
// nothing but an <svg> of filled <path>s. No DOM, no network and no top-level statements
// (docs/tool-contract.md, "logic.ts: what pure means"). worker.ts runs the tracer (ADR 0069).

import { safeFilename } from "@networksinsights/tool-sdk/download";

export const LIMITS = {
  /** 30 MB per file. */
  maxInputBytes: 30 * 1024 * 1024,
  /** 50 megapixels decoded: larger pictures are refused before they fill the memory. */
  maxPixels: 50_000_000,
  /** Pictures above about 2 megapixels are scaled down before tracing. */
  tracePixels: 2_000_000,
};

export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const MESSAGES = {
  type: "This is not a JPG, PNG or WebP image.",
  tooBig: (limit: string) => `The file is larger than ${limit}.`,
  tooManyPixels: "The picture has more than 50 megapixels. Make it smaller first.",
  unreadable: "The file could not be read as an image. It may be damaged.",
  failed: "Something went wrong while tracing the picture. Please try again.",
  unsafe: "The traced SVG did not pass the safety check, so it is not offered.",
};

export const PRESETS = {
  "2": { label: "2 colours", colours: 2 },
  "4": { label: "4 colours", colours: 4 },
  "8": { label: "8 colours", colours: 8 },
  "16": { label: "16 colours", colours: 16 },
} as const;

export type Preset = keyof typeof PRESETS;

export const DEFAULT_PRESET: Preset = "8";

/** The tracer's settings for a preset. The deterministic colour sampling gives the same SVG for the same picture. */
export function tracerOptions(preset: Preset) {
  return {
    numberofcolors: PRESETS[preset].colours,
    colorsampling: 2,
    colorquantcycles: 3,
    mincolorratio: 0,
    ltres: 1,
    qtres: 1,
    pathomit: 8,
    rightangleenhance: true,
    blurradius: 0,
    layering: 0,
  };
}

/** What the worker is sent: the pixels, already decoded and scaled by the page. */
export interface Job {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  preset: Preset;
}

export interface JobResult {
  svg: string;
  paths: number;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1).replace(/\.0$/, "")} KB`;
  return `${bytes} bytes`;
}

export function checkFile(file: { name: string; type: string; size: number }): string | null {
  const known =
    (ACCEPTED_TYPES as readonly string[]).includes(file.type) ||
    /\.(jpe?g|png|webp)$/i.test(file.name);
  if (!known) return MESSAGES.type;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooBig(formatSize(LIMITS.maxInputBytes));
  return null;
}

/** The size to trace at: the picture's own, or scaled down to about 2 megapixels, never up. */
export function traceSize(
  width: number,
  height: number,
): { width: number; height: number; scaled: boolean } {
  const pixels = width * height;
  if (pixels <= LIMITS.tracePixels) return { width, height, scaled: false };
  const factor = Math.sqrt(LIMITS.tracePixels / pixels);
  return {
    width: Math.max(1, Math.floor(width * factor)),
    height: Math.max(1, Math.floor(height * factor)),
    scaled: true,
  };
}

/** One segment of a traced outline: a line (L) or a quadratic curve (Q). */
export interface TracedSegment {
  type: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3?: number;
  y3?: number;
}

export interface TracedPath {
  segments: TracedSegment[];
  holechildren: number[];
  isholepath: boolean;
}

export interface TracedColour {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** imagetracerjs's "tracedata": one layer of outlines per palette colour. */
export interface TraceData {
  width: number;
  height: number;
  palette: TracedColour[];
  layers: TracedPath[][];
}

const round = (value: number) => {
  const rounded = Math.round(value * 10) / 10;
  if (!Number.isFinite(rounded)) throw new Error("bad coordinate");
  return String(rounded);
};

const channel = (value: number) => String(Math.min(255, Math.max(0, Math.round(value))));

function outline(path: TracedPath): string {
  const first = path.segments[0];
  if (!first) return "";
  let d = `M ${round(first.x1)} ${round(first.y1)} `;
  for (const segment of path.segments) {
    const type = segment.type === "Q" ? "Q" : "L";
    d += `${type} ${round(segment.x2)} ${round(segment.y2)} `;
    if (type === "Q") d += `${round(segment.x3 ?? 0)} ${round(segment.y3 ?? 0)} `;
  }
  return `${d}Z`;
}

/** A hole is drawn in the opposite direction, so the non-zero fill rule leaves it empty. */
function hole(path: TracedPath): string {
  const last = path.segments[path.segments.length - 1];
  if (!last) return "";
  let d = `M ${round(last.type === "Q" ? (last.x3 ?? 0) : last.x2)} ${round(last.type === "Q" ? (last.y3 ?? 0) : last.y2)} `;
  for (let index = path.segments.length - 1; index >= 0; index--) {
    const segment = path.segments[index];
    if (!segment) continue;
    const type = segment.type === "Q" ? "Q" : "L";
    d += `${type} `;
    if (type === "Q") d += `${round(segment.x2)} ${round(segment.y2)} `;
    d += `${round(segment.x1)} ${round(segment.y1)} `;
  }
  return `${d}Z`;
}

/**
 * The SVG text of a trace: an <svg> holding one filled <path> per outline, with its holes. Fully
 * transparent colours are left out. Nothing from the input file reaches the text but numbers.
 */
export function toSvg(data: TraceData): { svg: string; paths: number } {
  const width = Math.round(data.width);
  const height = Math.round(data.height);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  ];
  let paths = 0;
  data.layers.forEach((layer, index) => {
    const colour = data.palette[index];
    if (!colour || colour.a <= 0) return;
    const rgb = `rgb(${channel(colour.r)},${channel(colour.g)},${channel(colour.b)})`;
    const alpha = round(colour.a / 255);
    const opacity = colour.a >= 255 ? "" : ` fill-opacity="${alpha}"`;
    for (const path of layer) {
      if (path.isholepath) continue;
      let d = outline(path);
      for (const child of path.holechildren) {
        const holePath = layer[child];
        if (holePath) d += ` ${hole(holePath)}`;
      }
      if (!d) continue;
      parts.push(`<path fill="${rgb}"${opacity} d="${d}"/>`);
      paths++;
    }
  });
  parts.push("</svg>");
  return { svg: parts.join("\n"), paths };
}

const ALLOWED: Record<string, RegExp> = {
  xmlns: /^http:\/\/www\.w3\.org\/2000\/svg$/,
  width: /^\d+$/,
  height: /^\d+$/,
  viewBox: /^0 0 \d+ \d+$/,
  fill: /^rgb\(\d{1,3},\d{1,3},\d{1,3}\)$/,
  "fill-opacity": /^[\d.]+$/,
  d: /^[MLQZ\d.\s-]+$/,
};

/**
 * Whether an SVG text is only what toSvg writes: one <svg> element of filled <path>s, every
 * attribute from a short list with a plain value. No script, no style, no link and no reference
 * to another file can pass.
 */
export function isSafeSvg(svg: string): boolean {
  const tag = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<>]*")*)\s*(\/?)>/g;
  let at = 0;
  let depth = 0;
  let roots = 0;
  for (let match = tag.exec(svg); match; match = tag.exec(svg)) {
    if (svg.slice(at, match.index).trim() !== "") return false;
    at = match.index + match[0].length;
    const [, closing, name, attributes = "", selfClosing] = match;
    if (closing) {
      if (name !== "svg" || depth !== 1 || attributes.trim() !== "") return false;
      depth = 0;
      continue;
    }
    if (name === "svg") {
      if (depth !== 0 || roots > 0 || selfClosing) return false;
      depth = 1;
      roots++;
    } else if (name === "path") {
      if (depth !== 1 || !selfClosing) return false;
    } else {
      return false;
    }
    const attribute = /([\w:-]+)="([^"]*)"/g;
    for (let pair = attribute.exec(attributes); pair; pair = attribute.exec(attributes)) {
      const rule = ALLOWED[pair[1] ?? ""];
      if (!rule?.test(pair[2] ?? "")) return false;
    }
  }
  return roots === 1 && depth === 0 && svg.slice(at).trim() === "";
}

/** "logo.png" as "logo.svg". */
export function outputName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "") || "image";
  return safeFilename(`${base}.svg`);
}

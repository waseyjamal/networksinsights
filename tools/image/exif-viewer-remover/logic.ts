// Pure logic of "EXIF Viewer & Remover": the file rules, a reader of the blocks a JPEG, PNG or
// WebP file is made of, the JPEG rewrite that drops the metadata blocks and keeps every byte of the
// picture, and the rows the page shows, with no DOM, no network and no top-level statements
// (docs/tool-contract.md, "logic.ts: what pure means"). worker.ts reads the tags with exifr (ADR 0069).

import { safeFilename } from "@networksinsights/tool-sdk/download";

export const LIMITS = {
  /** 50 MB per file: the file is held in memory twice at most, the input and the copy. */
  maxInputBytes: 50 * 1024 * 1024,
};

export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type Format = "jpeg" | "png" | "webp";

/** A metadata block found in a file, as the page names it. */
export type Block = "EXIF" | "XMP" | "IPTC" | "ICC colour profile" | "Comment" | "Text" | "Other";

export const MESSAGES = {
  type: "This is not a JPG, PNG or WebP image.",
  tooBig: (limit: string) => `The file is larger than ${limit}.`,
  unreadable: "The file could not be read as an image. It may be damaged.",
  failed: "Something went wrong while reading the image. Please try again.",
};

export interface Row {
  label: string;
  value: string;
}

export interface Location {
  latitude: number;
  longitude: number;
}

/** What the worker is sent. */
export interface Job {
  file: File;
}

/** What the worker gives back. */
export interface JobResult {
  format: Format;
  rows: Row[];
  location: Location | null;
  /** The EXIF orientation, 1 to 8, or null when the file has none. */
  orientation: number | null;
  blocks: Block[];
  /** JPEG only: the same file without its metadata blocks, picture bytes untouched. */
  cleaned: Blob | null;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

export function checkFile(file: { name: string; type: string; size: number }): string | null {
  if (!formatOfFile(file)) return MESSAGES.type;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooBig(formatSize(LIMITS.maxInputBytes));
  return null;
}

function formatOfFile(file: { name: string; type: string }): Format | null {
  if (file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name)) return "jpeg";
  if (file.type === "image/png" || /\.png$/i.test(file.name)) return "png";
  if (file.type === "image/webp" || /\.webp$/i.test(file.name)) return "webp";
  return null;
}

/** The format from the first bytes, whatever the name says, or null. */
export function sniff(bytes: Uint8Array): Format | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") return "png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  return null;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let text = "";
  for (let i = start; i < start + length && i < bytes.length; i++) {
    text += String.fromCharCode(bytes[i] ?? 0);
  }
  return text;
}

function startsWith(bytes: Uint8Array, start: number, text: string): boolean {
  return ascii(bytes, start, text.length) === text;
}

/** One marker segment of a JPEG before its picture data: where it starts and ends. */
export interface Segment {
  marker: number;
  start: number;
  end: number;
  block: Block | null;
}

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const COM = 0xfe;

function jpegBlock(bytes: Uint8Array, marker: number, data: number): Block | null {
  if (marker === COM) return "Comment";
  if (marker === 0xe1 && startsWith(bytes, data, "Exif\0")) return "EXIF";
  if (marker === 0xe1 && startsWith(bytes, data, "http://ns.adobe.com/")) return "XMP";
  if (marker === 0xed) return "IPTC";
  if (marker === 0xe2 && startsWith(bytes, data, "ICC_PROFILE\0")) return "ICC colour profile";
  // APP0 (JFIF) and APP14 (Adobe) tell the decoder how to read the colours: they are not metadata.
  if (marker === 0xe0 || marker === 0xee) return null;
  if (marker >= 0xe1 && marker <= 0xef) return "Other";
  return null;
}

/** The segments of a JPEG from its start up to the first scan, and where that scan starts. */
export function jpegSegments(bytes: Uint8Array): { segments: Segment[]; scan: number } {
  if (bytes[0] !== 0xff || bytes[1] !== SOI) throw new Error("not a JPEG");
  const segments: Segment[] = [];
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) throw new Error("bad marker");
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker === SOS) return { segments, scan: at };
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    const end = at + 2 + length;
    if (length < 2 || end > bytes.length) throw new Error("bad length");
    segments.push({ marker, start: at, end, block: jpegBlock(bytes, marker, at + 4) });
    at = end;
  }
  throw new Error("no picture data");
}

/** A minimal EXIF block that holds only the orientation, so the picture keeps its rotation. */
export function orientationSegment(orientation: number): Uint8Array {
  const tiff = buildTiff([{ tag: 0x0112, type: "short", value: [orientation] }]);
  return app1Exif(tiff);
}

/** Wraps a TIFF structure as a JPEG APP1 EXIF segment. */
export function app1Exif(tiff: Uint8Array): Uint8Array {
  const segment = new Uint8Array(4 + 6 + tiff.length);
  const length = segment.length - 2;
  segment.set([0xff, 0xe1, length >> 8, length & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0], 0);
  segment.set(tiff, 10);
  return segment;
}

/**
 * The JPEG without its EXIF, XMP, IPTC, comment and other application blocks, and without anything
 * after the end of the picture. The frame, tables and compressed picture data are copied byte for
 * byte, so the decoded pixels do not change. When `orientation` is 2 to 8 a new EXIF block holding
 * only that tag is written, so the picture is still shown the right way round.
 */
export function stripJpeg(bytes: Uint8Array, orientation: number | null): Uint8Array {
  const { segments, scan } = jpegSegments(bytes);
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  const keep = segments.filter(
    (segment) => segment.block === null || segment.block === "ICC colour profile",
  );
  const jfif = keep[0]?.marker === 0xe0 ? (keep.shift() ?? null) : null;
  if (jfif) parts.push(bytes.subarray(jfif.start, jfif.end));
  if (orientation !== null && orientation >= 2 && orientation <= 8) {
    parts.push(orientationSegment(orientation));
  }
  for (const segment of keep) parts.push(bytes.subarray(segment.start, segment.end));
  parts.push(...scanParts(bytes, scan));
  return concat(parts);
}

/**
 * The picture data from the first scan to the end-of-image marker. Between the scans of a
 * progressive JPEG come table segments, which are kept; application and comment segments there
 * are dropped like the ones before the first scan.
 */
function scanParts(bytes: Uint8Array, start: number): Uint8Array[] {
  const parts: Uint8Array[] = [];
  let from = start;
  let at = start;
  // Skip the scan header of the first SOS.
  at += 2 + (((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0));
  while (at + 1 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at++;
      continue;
    }
    const marker = bytes[at + 1] ?? 0;
    // Stuffed byte, restart marker or fill byte: part of the picture data.
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
      at += marker === 0xff ? 1 : 2;
      continue;
    }
    if (marker === EOI) {
      parts.push(bytes.subarray(from, at + 2));
      return parts;
    }
    const end = at + 2 + (((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0));
    if (end > bytes.length) throw new Error("bad length");
    if (marker === COM || (marker >= 0xe0 && marker <= 0xef)) {
      parts.push(bytes.subarray(from, at));
      from = end;
    }
    at = end;
  }
  throw new Error("no end of picture");
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The metadata blocks of a PNG, from its chunk names. */
export function pngBlocks(bytes: Uint8Array): Block[] {
  const found: Block[] = [];
  let at = 8;
  while (at + 8 <= bytes.length) {
    const length =
      (((bytes[at] ?? 0) << 24) >>> 0) +
      ((bytes[at + 1] ?? 0) << 16) +
      ((bytes[at + 2] ?? 0) << 8) +
      (bytes[at + 3] ?? 0);
    const type = ascii(bytes, at + 4, 4);
    if (type === "eXIf") found.push("EXIF");
    else if (type === "iCCP") found.push("ICC colour profile");
    else if (type === "iTXt" && startsWith(bytes, at + 8, "XML:com.adobe.xmp")) found.push("XMP");
    else if (type === "tEXt" || type === "zTXt" || type === "iTXt") found.push("Text");
    if (type === "IEND") break;
    at += 12 + length;
  }
  return unique(found);
}

/** The metadata blocks of a WebP, from its chunk names. */
export function webpBlocks(bytes: Uint8Array): Block[] {
  const found: Block[] = [];
  let at = 12;
  while (at + 8 <= bytes.length) {
    const type = ascii(bytes, at, 4);
    const length =
      (bytes[at + 4] ?? 0) +
      ((bytes[at + 5] ?? 0) << 8) +
      ((bytes[at + 6] ?? 0) << 16) +
      (((bytes[at + 7] ?? 0) << 24) >>> 0);
    if (type === "EXIF") found.push("EXIF");
    else if (type === "XMP ") found.push("XMP");
    else if (type === "ICCP") found.push("ICC colour profile");
    at += 8 + length + (length % 2);
  }
  return unique(found);
}

export function jpegBlocks(bytes: Uint8Array): Block[] {
  return unique(
    jpegSegments(bytes)
      .segments.map((segment) => segment.block)
      .filter((block): block is Block => block !== null),
  );
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/** One TIFF tag for buildTiff. */
export interface TiffEntry {
  tag: number;
  type: "ascii" | "short" | "long" | "rational";
  /** Text for ascii; numbers for short and long; [numerator, denominator] pairs for rational. */
  value: string | number[];
}

const TYPE_CODE = { ascii: 2, short: 3, long: 4, rational: 5 } as const;
const TYPE_SIZE = { ascii: 1, short: 2, long: 4, rational: 8 } as const;

/**
 * A big-endian TIFF structure with IFD0 and, when given, an EXIF and a GPS directory linked from
 * it. The page writes only the orientation with it; the tests build their sample photos with it.
 */
export function buildTiff(
  ifd0: TiffEntry[],
  sub: { exif?: TiffEntry[]; gps?: TiffEntry[] } = {},
): Uint8Array {
  const directories: TiffEntry[][] = [ifd0.slice()];
  const pointers: Array<{ tag: number; entries: TiffEntry[] }> = [];
  if (sub.exif) pointers.push({ tag: 0x8769, entries: sub.exif });
  if (sub.gps) pointers.push({ tag: 0x8825, entries: sub.gps });
  for (const pointer of pointers) {
    directories[0]?.push({ tag: pointer.tag, type: "long", value: [0] });
    directories.push(pointer.entries);
  }
  const count = (entry: TiffEntry) =>
    entry.type === "ascii"
      ? (entry.value as string).length + 1
      : entry.type === "rational"
        ? (entry.value as number[]).length / 2
        : (entry.value as number[]).length;
  const dataSize = (entry: TiffEntry) => count(entry) * TYPE_SIZE[entry.type];
  const sizeOf = (entries: TiffEntry[]) =>
    2 +
    entries.length * 12 +
    4 +
    entries.reduce((sum, entry) => {
      const size = dataSize(entry);
      return sum + (size > 4 ? size + (size % 2) : 0);
    }, 0);

  const offsets: number[] = [];
  let total = 8;
  for (const entries of directories) {
    offsets.push(total);
    total += sizeOf(entries);
  }
  pointers.forEach((pointer, index) => {
    const entry = directories[0]?.find((item) => item.tag === pointer.tag);
    if (entry) entry.value = [offsets[index + 1] ?? 0];
  });

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set([0x4d, 0x4d, 0, 42, 0, 0, 0, 8], 0);
  directories.forEach((entries, index) => {
    const sorted = entries.slice().sort((a, b) => a.tag - b.tag);
    const start = offsets[index] ?? 0;
    let data = start + 2 + sorted.length * 12 + 4;
    view.setUint16(start, sorted.length);
    sorted.forEach((entry, position) => {
      const at = start + 2 + position * 12;
      view.setUint16(at, entry.tag);
      view.setUint16(at + 2, TYPE_CODE[entry.type]);
      view.setUint32(at + 4, count(entry));
      const size = dataSize(entry);
      const target = size > 4 ? data : at + 8;
      if (size > 4) {
        view.setUint32(at + 8, data);
        data += size + (size % 2);
      }
      writeValue(view, target, entry);
    });
  });
  return out;
}

function writeValue(view: DataView, at: number, entry: TiffEntry): void {
  if (entry.type === "ascii") {
    const text = entry.value as string;
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i) & 0xff);
    return;
  }
  const values = entry.value as number[];
  values.forEach((value, index) => {
    if (entry.type === "short") view.setUint16(at + index * 2, value);
    else view.setUint32(at + index * 4, value);
  });
}

export const ORIENTATIONS: Record<number, string> = {
  1: "Normal",
  2: "Mirrored left to right",
  3: "Turned 180°",
  4: "Mirrored top to bottom",
  5: "Mirrored and turned 90° anticlockwise",
  6: "Turned 90° clockwise",
  7: "Mirrored and turned 90° clockwise",
  8: "Turned 90° anticlockwise",
};

/** "2024:05:06 07:08:09" as "2024-05-06 07:08:09"; anything else as it is. */
export function formatDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const match = /^(\d{4}):(\d{2}):(\d{2})(.*)$/.exec(value.trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}${match[4]}` : value.trim();
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function formatCoordinate(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(6)}° ${value < 0 ? negative : positive}`;
}

/**
 * The rows the page shows from exifr's output (tag names as keys, values not translated or
 * revived), and the location when the file has a usable one.
 */
export type Tags = Partial<
  Record<
    | "Make"
    | "Model"
    | "LensModel"
    | "DateTimeOriginal"
    | "CreateDate"
    | "ModifyDate"
    | "Software"
    | "Artist"
    | "Copyright"
    | "Orientation"
    | "latitude"
    | "longitude"
    | "GPSAltitude",
    unknown
  >
>;

export function describe(tags: Tags): {
  rows: Row[];
  location: Location | null;
  orientation: number | null;
} {
  const rows: Row[] = [];
  const add = (label: string, value: string | null) => {
    if (value) rows.push({ label, value });
  };
  const make = text(tags.Make);
  const model = text(tags.Model);
  add(
    "Camera",
    make && model && !model.startsWith(make) ? `${make} ${model}` : (model ?? make ?? null),
  );
  add("Lens", text(tags.LensModel));
  add("Date taken", formatDate(tags.DateTimeOriginal ?? tags.CreateDate));
  add("Date changed", formatDate(tags.ModifyDate));
  add("Software", text(tags.Software));
  add("Artist", text(tags.Artist));
  add("Copyright", text(tags.Copyright));

  const raw = tags.Orientation;
  const orientation =
    typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 8 ? raw : null;
  if (orientation !== null) add("Orientation", `${orientation}: ${ORIENTATIONS[orientation]}`);

  const latitude = tags.latitude;
  const longitude = tags.longitude;
  const location =
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
      ? { latitude, longitude }
      : null;
  if (location) {
    add(
      "GPS location",
      `${formatCoordinate(location.latitude, "N", "S")}, ${formatCoordinate(location.longitude, "E", "W")}`,
    );
  }
  const altitude = tags.GPSAltitude;
  if (location && typeof altitude === "number" && Number.isFinite(altitude)) {
    add("GPS altitude", `${Math.round(altitude * 10) / 10} m`);
  }
  return { rows, location, orientation };
}

/** "photo.jpg" as "photo-no-metadata.jpg"; a PNG or WebP becomes "photo-no-metadata.png". */
export function outputName(name: string, format: Format): string {
  const base = name.replace(/\.[^.]+$/, "") || "photo";
  return safeFilename(`${base}-no-metadata.${format === "jpeg" ? "jpg" : "png"}`);
}

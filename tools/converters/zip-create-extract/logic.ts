// Pure logic of "ZIP create and extract": the limits, a reader of a ZIP's central directory, the
// cleaning of the names inside it, the duplicate names, the checks against zip bombs and the CRC-32
// that proves a file came out whole, with no DOM, no network and no top-level statements
// (docs/tool-contract.md, "logic.ts: what pure means"). worker.ts reads the bytes and runs fflate.

import { safeFilename } from "@networksinsights/tool-sdk/download";

/** The limits the manifest declares and the page enforces: one source for both. */
export const LIMITS = {
  /** 500 MB: the largest ZIP opened, and the most a new ZIP may hold before compression. */
  maxInputBytes: 500 * 1024 * 1024,
  /** 1,000 entries in a ZIP, folders included, and 1,000 files in a new ZIP. */
  maxFiles: 1000,
  /** 1 GB: the most all files of a ZIP may unpack to, by what the ZIP itself declares. */
  maxUnpackedBytes: 1024 * 1024 * 1024,
} as const;

/** How a new ZIP stores its files. */
export const METHODS = {
  deflate: { label: "Compressed (deflate)", level: 6 },
  store: { label: "Stored (no compression)", level: 0 },
} as const;
export type Method = keyof typeof METHODS;

/** Kept for the manifest's input schema: the choice a visitor makes. */
export interface Input {
  mode: "create" | "extract";
  method: Method;
}

export const MESSAGES = {
  notZip: "This file is not a ZIP file this tool can read.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooMany: (count: number, limit: number) =>
    `This ZIP holds ${count.toLocaleString("en")} entries; the limit is ${limit.toLocaleString("en")}.`,
  tooBig: (declared: number, limit: string) =>
    `This ZIP says its files unpack to ${declared.toLocaleString("en")} bytes, more than the ${limit} this tool unpacks. It may be a zip bomb.`,
  encrypted:
    "This ZIP is protected with a password. This tool does not open encrypted ZIP files, so nothing was extracted.",
  zip64:
    "This ZIP uses the ZIP64 format for very large archives, which this tool does not read. Open it with the archive program on your computer.",
  multiDisk: "This ZIP is split across several files, which this tool does not read.",
  damaged: "This ZIP is damaged: its list of files does not match its contents.",
  bomb: (name: string) =>
    `${name} unpacks to more than the ZIP says, so it was stopped. The ZIP may be a zip bomb.`,
  badCrc: (name: string) =>
    `${name} did not come out whole: its checksum does not match. The ZIP may be damaged.`,
  unsupported: (method: string) => `It uses ${method} compression, which this tool cannot unpack.`,
  link: "It is a link to another file, which this tool does not follow.",
  createTooMany: (limit: number) => `A new ZIP may hold up to ${limit.toLocaleString("en")} files.`,
  createTooLarge: (limit: string) => `The files together are larger than ${limit}.`,
  failed: "The browser could not finish the ZIP file.",
} as const;

/** One record of a ZIP's central directory, as stored. */
export interface ZipRecord {
  /** The name's bytes as stored, and whether the UTF-8 flag (bit 11) is set. */
  nameBytes: Uint8Array;
  utf8: boolean;
  /** The Info-ZIP Unicode Path field (0x7075), when present and current. */
  unicodeName: string | null;
  flags: number;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  /** The upper 16 bits of the external attributes: the Unix mode when made on Unix. */
  unixMode: number;
  madeOnUnix: boolean;
}

/** Where the central directory is, from the end of central directory record. */
export interface ZipDirectory {
  entries: number;
  offset: number;
  size: number;
}

export type Located = { ok: true; directory: ZipDirectory } | { ok: false; message: string };

const EOCD = 0x06054b50;
const EOCD64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** How many bytes from the end of a ZIP hold its end record: 22, plus a comment of up to 65,535. */
export const TAIL_BYTES = 22 + 0xffff + 20;

function u16(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
}

function u32(bytes: Uint8Array, at: number): number {
  return (u16(bytes, at) | (u16(bytes, at + 2) << 16)) >>> 0;
}

/**
 * Finds the end of central directory record in the last bytes of a ZIP (`tail`, which ends at the
 * end of the file of `fileSize` bytes) and says where the central directory is.
 */
export function locateDirectory(tail: Uint8Array, fileSize: number): Located {
  const tailStart = fileSize - tail.length;
  for (let at = tail.length - 22; at >= 0; at--) {
    if (u32(tail, at) !== EOCD) continue;
    const commentLength = u16(tail, at + 20);
    if (at + 22 + commentLength !== tail.length) continue;
    const disk = u16(tail, at + 4);
    const directoryDisk = u16(tail, at + 6);
    const onDisk = u16(tail, at + 8);
    const entries = u16(tail, at + 10);
    const size = u32(tail, at + 12);
    const offset = u32(tail, at + 16);
    if (
      (at >= 20 && u32(tail, at - 20) === EOCD64_LOCATOR) ||
      entries === 0xffff ||
      size === 0xffffffff ||
      offset === 0xffffffff
    )
      return { ok: false, message: MESSAGES.zip64 };
    if (disk !== 0 || directoryDisk !== 0 || onDisk !== entries)
      return { ok: false, message: MESSAGES.multiDisk };
    if (offset + size > tailStart + at) return { ok: false, message: MESSAGES.damaged };
    return { ok: true, directory: { entries, offset, size } };
  }
  return { ok: false, message: MESSAGES.notZip };
}

export type Parsed = { ok: true; records: ZipRecord[] } | { ok: false; message: string };

/** Reads every record of a central directory. Any record that does not fit is damage. */
export function readDirectory(bytes: Uint8Array, expected: number): Parsed {
  const records: ZipRecord[] = [];
  let at = 0;
  for (let index = 0; index < expected; index++) {
    if (at + 46 > bytes.length || u32(bytes, at) !== CENTRAL)
      return { ok: false, message: MESSAGES.damaged };
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const commentLength = u16(bytes, at + 32);
    const end = at + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length) return { ok: false, message: MESSAGES.damaged };
    const nameBytes = bytes.slice(at + 46, at + 46 + nameLength);
    const extra = bytes.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
    const compressedSize = u32(bytes, at + 20);
    const uncompressedSize = u32(bytes, at + 24);
    const localHeaderOffset = u32(bytes, at + 42);
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff ||
      hasField(extra, 0x0001)
    )
      return { ok: false, message: MESSAGES.zip64 };
    records.push({
      nameBytes,
      utf8: (u16(bytes, at + 8) & 0x0800) !== 0,
      unicodeName: unicodePath(extra, nameBytes),
      flags: u16(bytes, at + 8),
      method: u16(bytes, at + 10),
      crc32: u32(bytes, at + 16),
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      unixMode: u16(bytes, at + 40),
      madeOnUnix: (bytes[at + 5] ?? 0) === 3,
    });
    at = end;
  }
  return { ok: true, records };
}

function fields(extra: Uint8Array): Array<{ id: number; data: Uint8Array }> {
  const found: Array<{ id: number; data: Uint8Array }> = [];
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = u16(extra, at);
    const size = u16(extra, at + 2);
    if (at + 4 + size > extra.length) break;
    found.push({ id, data: extra.subarray(at + 4, at + 4 + size) });
    at += 4 + size;
  }
  return found;
}

function hasField(extra: Uint8Array, id: number): boolean {
  return fields(extra).some((field) => field.id === id);
}

/** The Info-ZIP Unicode Path field, used only when its CRC matches the stored name. */
function unicodePath(extra: Uint8Array, nameBytes: Uint8Array): string | null {
  const field = fields(extra).find((entry) => entry.id === 0x7075);
  if (!field || field.data.length < 5 || field.data[0] !== 1) return null;
  if (u32(field.data, 1) !== crc32(nameBytes)) return null;
  return new TextDecoder("utf-8", { fatal: false }).decode(field.data.subarray(5));
}

/** Code page 437, the ZIP standard's character set for names not marked as UTF-8: bytes 128-255. */
const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

/**
 * A stored name as text. UTF-8 when the archive marks it so, or when it carries a matching Unicode
 * Path field; plain ASCII as it is; anything else as code page 437, which the ZIP standard names
 * as the default. Invalid UTF-8 becomes the replacement character.
 */
export function decodeName(record: Pick<ZipRecord, "nameBytes" | "utf8" | "unicodeName">): string {
  if (record.unicodeName !== null) return record.unicodeName;
  if (record.utf8) return new TextDecoder("utf-8", { fatal: false }).decode(record.nameBytes);
  let text = "";
  for (const byte of record.nameBytes)
    text += byte < 128 ? String.fromCharCode(byte) : (CP437_HIGH[byte - 128] ?? "?");
  return text;
}

/**
 * A name made safe to show and save: backslashes become slashes, a drive letter and leading
 * slashes go, "." and ".." folders go (no file can climb out of its folder), and control
 * characters are dropped. Returns the cleaned path and whether anything changed.
 */
export function cleanPath(name: string): { path: string; changed: boolean } {
  const parts = name
    .replaceAll("\\", "/")
    .replace(/^[a-zA-Z]:/, "")
    .split("/")
    .map((part) =>
      [...part].filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join(""),
    )
    .filter((part) => part !== "" && part !== "." && part !== "..");
  const path = parts.join("/");
  return { path, changed: path !== name.replace(/\/$/, "") };
}

/** "notes.txt" taken → "notes (2).txt", then "notes (3).txt". */
export function uniqueName(name: string, taken: Set<string>): string {
  const key = (value: string) => value.toLowerCase();
  if (!taken.has(key(name))) {
    taken.add(key(name));
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${extension}`;
    if (!taken.has(key(candidate))) {
      taken.add(key(candidate));
      return candidate;
    }
  }
}

const METHOD_NAMES: Record<number, string> = {
  1: "Shrink",
  6: "Implode",
  9: "Deflate64",
  12: "BZIP2",
  14: "LZMA",
  93: "Zstandard",
  95: "XZ",
  98: "PPMd",
};

/** One file of a ZIP as the page lists it. */
export interface ZipFile {
  index: number;
  /** The cleaned path inside the ZIP, shown to the visitor. */
  path: string;
  /** The name it is saved as: the last part of the path, made unique within this ZIP. */
  saveAs: string;
  /** The path was changed to make it safe. */
  cleaned: boolean;
  size: number;
  compressedSize: number;
  method: number;
  crc32: number;
  localHeaderOffset: number;
  /** Why it cannot be extracted, when it cannot. */
  problem?: string;
}

export type Plan =
  | { ok: true; files: ZipFile[]; folders: number; unpackedBytes: number }
  | { ok: false; message: string };

/**
 * The files of a ZIP and what the tool will do with each, or why it refuses the whole ZIP: too
 * many entries, more declared bytes than the limit, or any encrypted entry. Folders are counted
 * but not listed.
 */
export function planExtract(records: readonly ZipRecord[]): Plan {
  if (records.length > LIMITS.maxFiles)
    return { ok: false, message: MESSAGES.tooMany(records.length, LIMITS.maxFiles) };
  if (records.some((record) => (record.flags & 1) !== 0 || record.method === 99))
    return { ok: false, message: MESSAGES.encrypted };
  const unpackedBytes = records.reduce((sum, record) => sum + record.uncompressedSize, 0);
  if (unpackedBytes > LIMITS.maxUnpackedBytes)
    return {
      ok: false,
      message: MESSAGES.tooBig(unpackedBytes, formatSize(LIMITS.maxUnpackedBytes)),
    };
  const taken = new Set<string>();
  const files: ZipFile[] = [];
  let folders = 0;
  records.forEach((record, index) => {
    const name = decodeName(record);
    if (name.endsWith("/") || name.endsWith("\\")) {
      folders++;
      return;
    }
    const { path, changed } = cleanPath(name);
    const last = path.split("/").pop() || `file-${index + 1}`;
    const isLink = record.madeOnUnix && (record.unixMode & 0xf000) === 0xa000;
    const problem: string | null = isLink
      ? MESSAGES.link
      : record.method === 0 || record.method === 8
        ? null
        : MESSAGES.unsupported(METHOD_NAMES[record.method] ?? `method ${record.method}`);
    files.push({
      index,
      path: path || last,
      saveAs: uniqueName(safeFilename(last), taken),
      cleaned: changed,
      size: record.uncompressedSize,
      compressedSize: record.compressedSize,
      method: record.method,
      crc32: record.crc32,
      localHeaderOffset: record.localHeaderOffset,
      ...(problem ? { problem } : {}),
    });
  });
  return { ok: true, files, folders, unpackedBytes };
}

/**
 * Where a file's data starts, from its local header (30 bytes plus its name and extra field), or
 * null when the header is not there.
 */
export function dataOffset(localHeader: Uint8Array, localHeaderOffset: number): number | null {
  if (localHeader.length < 30 || u32(localHeader, 0) !== LOCAL) return null;
  return localHeaderOffset + 30 + u16(localHeader, 26) + u16(localHeader, 28);
}

/** CRC-32 (the ZIP polynomial 0xEDB88320), continued from `previous` when given. */
export function crc32(bytes: Uint8Array, previous = 0): number {
  let crc = ~previous >>> 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ~crc >>> 0;
}

/** The files a visitor chose for a new ZIP, with the name each gets inside it. */
export type CreatePlan =
  | { ok: true; files: Array<{ index: number; name: string }>; totalBytes: number }
  | { ok: false; message: string };

/** Names in a new ZIP are the file names, made safe, with (2), (3) added to repeats. */
export function planCreate(files: ReadonlyArray<{ name: string; size: number }>): CreatePlan {
  if (files.length > LIMITS.maxFiles)
    return { ok: false, message: MESSAGES.createTooMany(LIMITS.maxFiles) };
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > LIMITS.maxInputBytes)
    return { ok: false, message: MESSAGES.createTooLarge(formatSize(LIMITS.maxInputBytes)) };
  const taken = new Set<string>();
  return {
    ok: true,
    files: files.map((file, index) => ({
      index,
      name: uniqueName(safeFilename(file.name) || `file-${index + 1}`, taken),
    })),
    totalBytes,
  };
}

/** Whether a file looks like a ZIP, by type or extension. */
export function isZipFile(file: { name: string; type: string }): boolean {
  return /zip/i.test(file.type) || /\.zip$/i.test(file.name);
}

/** Bytes as the page shows them: "1 GB", "12.5 MB", "980 KB", "512 bytes". */
export function formatSize(bytes: number): string {
  const units = [
    ["GB", 1024 ** 3],
    ["MB", 1024 ** 2],
    ["KB", 1024],
  ] as const;
  for (const [unit, size] of units) {
    if (bytes >= size) {
      const value = bytes / size;
      const shown = Number.isInteger(value) ? String(value) : value.toFixed(1);
      return `${shown} ${unit}`;
    }
  }
  return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
}

/** Jobs for the worker. A ZIP is listed once, then each file is extracted when asked for. */
export type Job =
  | { kind: "list"; file: Blob }
  | { kind: "extract"; file: Blob; entry: ZipFile }
  | { kind: "create"; files: Blob[]; names: string[]; modified: number[]; method: Method };

export type JobResult =
  | { kind: "list"; plan: Plan }
  | { kind: "extract"; blob: Blob }
  | { kind: "create"; blob: Blob };

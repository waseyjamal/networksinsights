// Pure logic of "Base64 Encoder / Decoder": no DOM, no network, no top-level statements, and imports
// only from zod, the SDK or this folder (docs/tool-contract.md, "logic.ts: what pure means").
//
// Base64 as RFC 4648 defines it, written out here rather than through atob and btoa: those work on
// "binary strings" of Latin-1 characters, so text has to be converted around them, and their error
// is the same bare "invalid character" in every case. This reader says which character is wrong
// and where, reads both alphabets, and accepts the data: URL a browser or a stylesheet uses.

/** The two things the tool does, in the order the workspace shows them. */
export const MODES = ["encode", "decode"] as const;

export type Mode = (typeof MODES)[number];

export const MODE_LABELS: Readonly<Record<Mode, string>> = {
  encode: "Encode",
  decode: "Decode",
};

/** The two alphabets of RFC 4648: section 4 (standard) and section 5 (URL and file name safe). */
export const VARIANTS = ["standard", "url"] as const;

export type Variant = (typeof VARIANTS)[number];

export const VARIANT_LABELS: Readonly<Record<Variant, string>> = {
  standard: "Standard Base64 (+ / and = padding)",
  url: "Base64URL (- _ and no padding)",
};

/** The most bytes the tool encodes, or gives back from a decode: 5 MB. */
export const MAX_BYTES = 5 * 1024 * 1024;

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  mode: Mode;
  variant: Variant;
  text: string;
}

/** What a decode gives back, when the bytes are not text: a guess at the file type from its first bytes. */
export interface FileKind {
  /** The extension to save it with, without the dot. */
  extension: string;
  /** What it is, as a reader names it. */
  label: string;
}

/** What the tool gives back. */
export type Result =
  | { ok: true; mode: "encode"; output: string; inputBytes: number }
  | {
      ok: true;
      mode: "decode";
      bytes: Uint8Array<ArrayBuffer>;
      /** The bytes as text when they are valid UTF-8 without control characters, otherwise null. */
      text: string | null;
      kind: FileKind;
      inputCharacters: number;
    }
  | { ok: false; reason: "empty" | "too-large" | "invalid"; error: string };

const STANDARD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const TAB = 0x09;
const LINE_FEED = 0x0a;
const FORM_FEED = 0x0c;
const CARRIAGE_RETURN = 0x0d;
const SPACE = 0x20;
const PLUS = 0x2b;
const MINUS = 0x2d;
const SLASH = 0x2f;
const EQUALS = 0x3d;
const UNDERSCORE = 0x5f;
const DELETE = 0x7f;

/** What a decode with no file signature it knows is saved as. */
const UNKNOWN_KIND: FileKind = { extension: "bin", label: "Binary data" };
const TEXT_KIND: FileKind = { extension: "txt", label: "Text" };

/** File signatures (the first bytes of a file) that name a type. */
const SIGNATURES: ReadonlyArray<{ bytes: readonly number[]; kind: FileKind }> = [
  {
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    kind: { extension: "png", label: "PNG image" },
  },
  { bytes: [0xff, 0xd8, 0xff], kind: { extension: "jpg", label: "JPEG image" } },
  { bytes: [0x47, 0x49, 0x46, 0x38], kind: { extension: "gif", label: "GIF image" } },
  { bytes: [0x25, 0x50, 0x44, 0x46, 0x2d], kind: { extension: "pdf", label: "PDF document" } },
  { bytes: [0x50, 0x4b, 0x03, 0x04], kind: { extension: "zip", label: "ZIP archive" } },
  { bytes: [0x1f, 0x8b], kind: { extension: "gz", label: "Gzip archive" } },
  { bytes: [0x00, 0x61, 0x73, 0x6d], kind: { extension: "wasm", label: "WebAssembly module" } },
];

/** Encodes or decodes `input.text`. A file goes through encodeBytes instead. */
export function run(input: Input): Result {
  if (input.mode === "decode") return decode(input.text);
  if (input.text === "")
    return { ok: false, reason: "empty", error: "Type or paste text to encode." };
  return encodeBytes(new TextEncoder().encode(input.text), input.variant);
}

/** Encodes bytes (a file, or text as UTF-8) in the given alphabet. */
export function encodeBytes(bytes: Uint8Array, variant: Variant): Result {
  if (bytes.length > MAX_BYTES) return tooLarge(bytes.length);
  return { ok: true, mode: "encode", output: encode(bytes, variant), inputBytes: bytes.length };
}

/** The message for a file over the limit, before it is read. Null when it fits. */
export function checkFileSize(size: number): string | null {
  return size > MAX_BYTES ? tooLarge(size).error : null;
}

/** The Base64 of `bytes`. Standard Base64 is padded with "=" to a multiple of four; Base64URL is not. */
export function encode(bytes: Uint8Array, variant: Variant): string {
  const alphabet = variant === "url" ? URL_ALPHABET : STANDARD_ALPHABET;
  const codes: number[] = [];
  for (let i = 0; i < alphabet.length; i++) codes.push(alphabet.charCodeAt(i));
  const pad = variant === "standard";
  const whole = bytes.length - (bytes.length % 3);
  const rest = bytes.length - whole;
  const out = new Uint8Array(
    pad ? Math.ceil(bytes.length / 3) * 4 : Math.ceil((bytes.length * 4) / 3),
  );
  let o = 0;
  const put = (value: number) => {
    out[o++] = codes[value] as number;
  };
  for (let i = 0; i < whole; i += 3) {
    const n =
      ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    put(n >>> 18);
    put((n >>> 12) & 63);
    put((n >>> 6) & 63);
    put(n & 63);
  }
  if (rest > 0) {
    const n =
      ((bytes[whole] as number) << 16) | (rest === 2 ? (bytes[whole + 1] as number) << 8 : 0);
    put(n >>> 18);
    put((n >>> 12) & 63);
    if (rest === 2) put((n >>> 6) & 63);
    if (pad) {
      if (rest === 1) out[o++] = EQUALS;
      out[o++] = EQUALS;
    }
  }
  // Every byte is ASCII, which UTF-8 reads as itself.
  return new TextDecoder().decode(out);
}

/**
 * Decodes Base64 in either alphabet, with or without padding, and ignores spaces and line breaks.
 * A data: URL ("data:image/png;base64,...") is decoded from after its comma.
 */
export function decode(text: string): Result {
  const start = payloadStart(text);
  if (typeof start !== "number") return start;

  // The value of each character of both alphabets, and -1 for anything else.
  const values = new Int8Array(128).fill(-1);
  for (let i = 0; i < 64; i++) {
    values[STANDARD_ALPHABET.charCodeAt(i)] = i;
    values[URL_ALPHABET.charCodeAt(i)] = i;
  }

  const out = new Uint8Array(Math.floor(((text.length - start) * 3) / 4) + 3);
  let o = 0;
  let group = 0;
  let count = 0;
  let padding = 0;
  let firstPadding = -1;
  let standardAt = -1;
  let urlAt = -1;
  for (let i = start; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isSpace(code)) continue;
    if (code === EQUALS) {
      if (padding === 0) firstPadding = i;
      padding++;
      continue;
    }
    const value = code < 128 ? (values[code] as number) : -1;
    if (value < 0) {
      return invalid(
        `Character ${i + 1}, ${describe(text, i)}, is not Base64. Base64 uses A to Z, a to z, 0 to 9, + and / (or - and _ in Base64URL), and = at the end.`,
      );
    }
    if (padding > 0) {
      return invalid(
        `Character ${firstPadding + 1} is "=" but more Base64 follows it. Padding may only come at the end.`,
      );
    }
    if (code === PLUS || code === SLASH) {
      if (standardAt < 0) standardAt = i;
    } else if (code === MINUS || code === UNDERSCORE) {
      if (urlAt < 0) urlAt = i;
    }
    if (standardAt >= 0 && urlAt >= 0) {
      const [a, b] = standardAt < urlAt ? [standardAt, urlAt] : [urlAt, standardAt];
      return invalid(
        `This mixes the two alphabets: ${describe(text, a)} at character ${a + 1} and ${describe(text, b)} at character ${b + 1}. Standard Base64 uses + and /, Base64URL uses - and _.`,
      );
    }
    group = (group << 6) | value;
    count++;
    if (count % 4 === 0) {
      out[o++] = group >>> 16;
      out[o++] = (group >>> 8) & 255;
      out[o++] = group & 255;
      group = 0;
    }
  }

  if (count === 0) {
    if (padding > 0) return invalid(`There is only padding ("=") here, and no Base64 before it.`);
    return { ok: false, reason: "empty", error: "Paste Base64 to decode." };
  }
  const tail = count % 4;
  if (tail === 1) {
    return invalid(
      "The Base64 is cut short: its last group has a single character, and a group needs at least two. A character may be missing or extra.",
    );
  }
  if (padding > 0 && (padding > 2 || (count + padding) % 4 !== 0)) {
    return invalid(
      `The padding is wrong: ${padding} "=" after ${count} characters. With padding, the length must be a multiple of four.`,
    );
  }
  if (tail === 2) {
    out[o++] = group >>> 4;
  } else if (tail === 3) {
    out[o++] = group >>> 10;
    out[o++] = (group >>> 2) & 255;
  }
  if (o > MAX_BYTES) return tooLarge(o);

  const bytes = out.slice(0, o);
  const decoded = asText(bytes);
  return {
    ok: true,
    mode: "decode",
    bytes,
    text: decoded,
    kind: decoded === null ? kindOf(bytes) : TEXT_KIND,
    inputCharacters: text.length,
  };
}

/** Where the Base64 starts: after the comma of a data: URL, otherwise after leading spaces. */
function payloadStart(text: string): number | Result {
  let i = 0;
  while (i < text.length && isSpace(text.charCodeAt(i))) i++;
  if (text.slice(i, i + 5).toLowerCase() !== "data:") return i;
  const comma = text.indexOf(",", i);
  if (comma < 0) return invalid('This data: URL has no "," before its data.');
  const header = text.slice(i + 5, comma).toLowerCase();
  if (!header.split(";").includes("base64")) {
    return invalid('This data: URL is not Base64: its header has no ";base64" before the ",".');
  }
  return comma + 1;
}

/** The bytes as text, when they are valid UTF-8 without control characters (tabs and line breaks are fine). */
export function asText(bytes: Uint8Array): string | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if ((code < SPACE && !isSpace(code)) || code === DELETE) return null;
  }
  return text;
}

/** A guess at what the bytes are, from the signature at their start. */
export function kindOf(bytes: Uint8Array): FileKind {
  for (const { bytes: signature, kind } of SIGNATURES) {
    if (startsWith(bytes, signature)) return kind;
  }
  // WebP: "RIFF", four bytes of length, then "WEBP".
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])
  ) {
    return { extension: "webp", label: "WebP image" };
  }
  return UNKNOWN_KIND;
}

/** A size as a reader says it: "512 bytes", "1.5 KB", "5 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Number.parseFloat(kb.toFixed(1))} KB`;
  return `${Number.parseFloat((kb / 1024).toFixed(1))} MB`;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, i) => bytes[i] === value);
}

function isSpace(code: number): boolean {
  return (
    code === SPACE ||
    code === LINE_FEED ||
    code === CARRIAGE_RETURN ||
    code === TAB ||
    code === FORM_FEED
  );
}

/** The character at `i`, as a message names it. */
function describe(text: string, i: number): string {
  const code = text.codePointAt(i) ?? 0;
  if (code < SPACE || code === DELETE) {
    return `a control character (U+${code.toString(16).toUpperCase().padStart(4, "0")})`;
  }
  return `"${String.fromCodePoint(code)}"`;
}

function invalid(error: string): Result {
  return { ok: false, reason: "invalid", error };
}

function tooLarge(bytes: number): Extract<Result, { ok: false }> {
  const size = formatSize(bytes);
  const limit = formatSize(MAX_BYTES);
  // Just over the limit, both round to the same "5 MB".
  const error =
    size === limit
      ? `This is just over ${limit}, the most the tool works on.`
      : `This is ${size}, more than the ${limit} the tool works on.`;
  return { ok: false, reason: "too-large", error };
}

// Safe names and types for the files tools give back (ADR 0050, docs/tool-contract.md
// "Downloads"). Pure: logic.ts may use these to name its result, and the browser helper that
// saves the file (saveFile in the design system) uses them too.

/**
 * The media type of every extension a tool may produce, lowercase and without the dot. Anything
 * else is saved as `application/octet-stream`, which a browser only ever downloads. Types that run
 * code when opened in a tab (HTML, SVG, XML) are listed, because tools may produce them, but
 * saveFile only ever downloads a file and never opens one in a tab.
 */
export const DOWNLOAD_TYPES: Readonly<Record<string, string>> = {
  txt: "text/plain;charset=utf-8",
  csv: "text/csv;charset=utf-8",
  tsv: "text/tab-separated-values;charset=utf-8",
  md: "text/markdown;charset=utf-8",
  json: "application/json",
  xml: "application/xml",
  html: "text/html;charset=utf-8",
  css: "text/css;charset=utf-8",
  js: "text/javascript;charset=utf-8",
  yaml: "application/yaml",
  ics: "text/calendar;charset=utf-8",
  vcf: "text/vcard;charset=utf-8",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/vnd.microsoft.icon",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  zip: "application/zip",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** What an unknown extension is saved as. */
export const FALLBACK_TYPE = "application/octet-stream";

/** The longest file name most file systems accept, in UTF-8 bytes. */
export const MAX_FILENAME_BYTES = 255;

/** Names Windows refuses whatever the extension: CON, PRN, AUX, NUL, COM1-9, LPT1-9. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i;

/** The length of a string in UTF-8 bytes, counted from its code points (no TextEncoder: pure ES). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Cuts a string to at most `max` UTF-8 bytes without splitting a character. */
function cutToBytes(text: string, max: number): string {
  let out = "";
  for (const char of text) {
    if (utf8Length(out + char) > max) break;
    out += char;
  }
  return out;
}

/** Characters Windows forbids in a name, and the path separators of every system. */
const FORBIDDEN = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"]);

/**
 * One character of a name, made safe. Bidirectional overrides and isolates, zero-width characters
 * and the BOM are invisible and can make one extension look like another, so they are dropped.
 * Control characters and forbidden characters become `-`.
 */
function replaceUnsafe(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  if (
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  ) {
    return "";
  }
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || FORBIDDEN.has(char)) return "-";
  return char;
}

/** The media type for a file name's extension, or the fallback. */
export function mimeTypeFor(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return FALLBACK_TYPE;
  return DOWNLOAD_TYPES[filename.slice(dot + 1).toLowerCase()] ?? FALLBACK_TYPE;
}

/**
 * A file name that is safe to offer for download, from anything: a name the visitor's file had,
 * text they typed, a title read out of a document.
 *
 * - Path separators, control characters and the characters Windows forbids become `-`, so a name
 *   can never climb out of the download folder or break a file system.
 * - Bidirectional control characters are removed, so `photo\u202Egnp.exe` cannot pose as a PNG.
 * - Leading dots and trailing dots and spaces go, so a name is never hidden or unusable.
 * - A Windows reserved name (CON, NUL, …) gets a `-file` suffix.
 * - The result fits in 255 UTF-8 bytes, keeping the extension.
 * - `extension`, when given, replaces whatever extension the name had.
 * - An empty result becomes `fallback`.
 */
export function safeFilename(
  name: string,
  options: { extension?: string; fallback?: string } = {},
): string {
  const fallback = options.fallback ?? "download";
  let base = Array.from(name.normalize("NFC"), replaceUnsafe)
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");

  let extension = "";
  if (options.extension !== undefined) {
    const wanted = options.extension.replace(/^\.+/, "").toLowerCase();
    extension = /^[a-z0-9]{1,10}$/.test(wanted) ? `.${wanted}` : "";
    const dot = base.lastIndexOf(".");
    if (dot > 0) base = base.slice(0, dot);
  } else {
    const match = /\.[A-Za-z0-9]{1,10}$/.exec(base);
    if (match && match.index > 0) {
      extension = match[0];
      base = base.slice(0, match.index);
    }
  }

  base = base.replace(/[.\s]+$/, "");
  if (base === "") base = fallback;
  if (WINDOWS_RESERVED.test(base.split(".")[0] ?? "")) base = `${base}-file`;
  base = cutToBytes(base, MAX_FILENAME_BYTES - utf8Length(extension)).replace(/[.\s]+$/, "");
  return `${base || fallback}${extension}`;
}

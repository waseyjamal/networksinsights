import { describe, expect, it } from "vitest";
import {
  DOWNLOAD_TYPES,
  FALLBACK_TYPE,
  MAX_FILENAME_BYTES,
  mimeTypeFor,
  safeFilename,
  utf8Length,
} from "./download";

// Invisible characters are built from their code points, so this file shows exactly what it tests.
const RLO = String.fromCharCode(0x202e);
const ZWSP = String.fromCharCode(0x200b);
const BOM = String.fromCharCode(0xfeff);
const NUL = String.fromCharCode(0);
const BELL = String.fromCharCode(7);
const C1 = String.fromCharCode(0x85);

const bytes = utf8Length;

describe("safeFilename", () => {
  it("keeps an ordinary name as it is", () => {
    expect(safeFilename("Holiday photo.jpg")).toBe("Holiday photo.jpg");
    expect(safeFilename("résumé 2026.pdf")).toBe("résumé 2026.pdf");
  });

  it("never lets a name climb out of the download folder", () => {
    expect(safeFilename("../../etc/passwd")).toBe("-..-etc-passwd");
    expect(safeFilename("..\\..\\Windows\\win.ini")).toBe("-..-Windows-win.ini");
    expect(safeFilename("/absolute/path.txt")).toBe("-absolute-path.txt");
  });

  it("replaces control characters and the characters Windows forbids", () => {
    expect(safeFilename(`a${NUL}b${BELL}c${C1}d.txt`)).toBe("a-b-c-d.txt");
    expect(safeFilename('what: "why" <how> | who? * .txt')).toBe("what- -why- -how- - who- -.txt");
  });

  it("removes bidirectional overrides, so an extension cannot be disguised", () => {
    // Shown as "photoexe.png" by a bidi-aware display, really an .exe.
    expect(safeFilename(`photo${RLO}gnp.exe`)).toBe("photognp.exe");
    expect(safeFilename(`in${ZWSP}voice${BOM}.pdf`)).toBe("invoice.pdf");
  });

  it("drops leading dots and trailing dots and spaces", () => {
    expect(safeFilename(".bashrc")).toBe("bashrc");
    expect(safeFilename("report. . .")).toBe("report");
    expect(safeFilename("  spaced   out  .txt ")).toBe("spaced out.txt");
  });

  it("gives Windows reserved names a suffix, whatever their case or extension", () => {
    expect(safeFilename("CON")).toBe("CON-file");
    expect(safeFilename("nul.txt")).toBe("nul-file.txt");
    expect(safeFilename("com1.csv")).toBe("com1-file.csv");
    expect(safeFilename("console.txt")).toBe("console.txt");
  });

  it("falls back when nothing is left", () => {
    expect(safeFilename("")).toBe("download");
    expect(safeFilename("...")).toBe("download");
    expect(safeFilename("  ", { fallback: "result" })).toBe("result");
    expect(safeFilename(".png")).toBe("png");
  });

  it("replaces the extension when one is asked for", () => {
    expect(safeFilename("scan.jpeg", { extension: "pdf" })).toBe("scan.pdf");
    expect(safeFilename("notes", { extension: ".TXT" })).toBe("notes.txt");
    expect(safeFilename("", { extension: "png" })).toBe("download.png");
    // An extension that is not a plain word is ignored rather than trusted.
    expect(safeFilename("a.txt", { extension: "exe/../x" })).toBe("a");
  });

  it(`fits in ${MAX_FILENAME_BYTES} UTF-8 bytes and keeps the extension`, () => {
    const long = safeFilename(`${"é".repeat(400)}.jpg`);
    expect(bytes(long)).toBeLessThanOrEqual(MAX_FILENAME_BYTES);
    expect(long.endsWith(".jpg")).toBe(true);
    // No character is cut in half.
    expect(long).not.toContain("�");
    const emoji = safeFilename(`${"📄".repeat(100)}.txt`);
    expect(bytes(emoji)).toBeLessThanOrEqual(MAX_FILENAME_BYTES);
    expect(emoji.endsWith(".txt")).toBe(true);
  });
});

describe("utf8Length", () => {
  it("counts one to four bytes per character, as UTF-8 does", () => {
    expect(utf8Length("a")).toBe(1);
    expect(utf8Length("é")).toBe(2);
    expect(utf8Length("€")).toBe(3);
    expect(utf8Length("📄")).toBe(4);
    expect(utf8Length("aé€📄")).toBe(10);
  });
});

describe("mimeTypeFor", () => {
  it("names the type of a known extension, in any case", () => {
    expect(mimeTypeFor("a.PNG")).toBe("image/png");
    expect(mimeTypeFor("data.json")).toBe("application/json");
    expect(mimeTypeFor("notes.txt")).toBe("text/plain;charset=utf-8");
  });

  it("falls back to a type a browser only ever downloads", () => {
    expect(mimeTypeFor("archive.unknownext")).toBe(FALLBACK_TYPE);
    expect(mimeTypeFor("no-extension")).toBe(FALLBACK_TYPE);
    expect(FALLBACK_TYPE).toBe("application/octet-stream");
  });

  it("lists every extension in lowercase, each with a real media type", () => {
    for (const [extension, type] of Object.entries(DOWNLOAD_TYPES)) {
      expect(extension).toMatch(/^[a-z0-9]+$/);
      expect(type).toMatch(/^[a-z]+\/[a-z0-9.+-]+(;charset=utf-8)?$/);
    }
  });
});

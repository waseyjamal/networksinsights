import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  cleanPath,
  crc32,
  dataOffset,
  decodeName,
  isZipFile,
  LIMITS,
  locateDirectory,
  MESSAGES,
  planCreate,
  planExtract,
  readDirectory,
  TAIL_BYTES,
  uniqueName,
  type ZipRecord,
} from "./logic";

// Every ZIP here is made at run time with fflate, then patched byte by byte where a test needs
// what fflate never writes (encryption flags, ZIP64 markers, false sizes, odd names).

const CENTRAL = [0x50, 0x4b, 0x01, 0x02];

function centralOffsets(zip: Uint8Array): number[] {
  const found: number[] = [];
  for (let at = 0; at + 4 <= zip.length; at++)
    if (CENTRAL.every((byte, i) => zip[at + i] === byte)) found.push(at);
  return found;
}

function put32(bytes: Uint8Array, at: number, value: number) {
  new DataView(bytes.buffer, bytes.byteOffset).setUint32(at, value >>> 0, true);
}

function put16(bytes: Uint8Array, at: number, value: number) {
  new DataView(bytes.buffer, bytes.byteOffset).setUint16(at, value, true);
}

/** Lists a ZIP the way the worker does: its tail, then its central directory. */
function records(zip: Uint8Array): ZipRecord[] | string {
  const tail = zip.subarray(Math.max(0, zip.length - TAIL_BYTES));
  const located = locateDirectory(tail, zip.length);
  if (!located.ok) return located.message;
  const { offset, size, entries } = located.directory;
  const parsed = readDirectory(zip.subarray(offset, offset + size), entries);
  return parsed.ok ? parsed.records : parsed.message;
}

function plan(zip: Uint8Array) {
  const found = records(zip);
  if (typeof found === "string") return { ok: false as const, message: found };
  return planExtract(found);
}

const sample = () =>
  zipSync({
    "hello.txt": [strToU8("Hello, world"), { level: 0 }],
    "docs/": new Uint8Array(0),
    "docs/notes.txt": [strToU8("notes ".repeat(100)), { level: 6 }],
  });

describe("reading a ZIP", () => {
  it("lists files with their sizes, methods and checksums, and counts folders", () => {
    const result = plan(sample());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.folders).toBe(1);
    expect(result.files.map((file) => [file.path, file.saveAs, file.size, file.method])).toEqual([
      ["hello.txt", "hello.txt", 12, 0],
      ["docs/notes.txt", "notes.txt", 600, 8],
    ]);
    expect(result.files[0]?.crc32).toBe(crc32(strToU8("Hello, world")));
    expect(result.unpackedBytes).toBe(612);
  });

  it("finds where each file's data starts", () => {
    const zip = sample();
    const result = plan(zip);
    if (!result.ok) throw new Error(result.message);
    const first = result.files[0];
    if (!first) throw new Error("no file");
    const start = dataOffset(zip.subarray(first.localHeaderOffset), first.localHeaderOffset);
    expect(new TextDecoder().decode(zip.subarray(start ?? 0, (start ?? 0) + 12))).toBe(
      "Hello, world",
    );
    expect(dataOffset(new Uint8Array(30), 0)).toBeNull();
  });

  it("finds the end record behind a comment", () => {
    const zip = sample();
    const comment = strToU8("made by a test");
    const withComment = new Uint8Array(zip.length + comment.length);
    withComment.set(zip);
    withComment.set(comment, zip.length);
    put16(withComment, zip.length - 2, comment.length);
    expect(plan(withComment).ok).toBe(true);
  });

  it("refuses what is not a ZIP, and a damaged list of files", () => {
    expect(plan(strToU8("just some text"))).toEqual({ ok: false, message: MESSAGES.notZip });
    const zip = sample();
    const first = centralOffsets(zip)[0] ?? 0;
    zip[first] = 0;
    expect(plan(zip)).toEqual({ ok: false, message: MESSAGES.damaged });
  });
});

describe("encrypted, ZIP64 and split ZIPs", () => {
  it("refuses a ZIP with any encrypted file", () => {
    const zip = sample();
    const last = centralOffsets(zip).at(-1) ?? 0;
    put16(zip, last + 8, 1);
    expect(plan(zip)).toEqual({ ok: false, message: MESSAGES.encrypted });
  });

  it("refuses AES encryption, method 99", () => {
    const zip = sample();
    put16(zip, (centralOffsets(zip)[0] ?? 0) + 10, 99);
    expect(plan(zip)).toEqual({ ok: false, message: MESSAGES.encrypted });
  });

  it("refuses ZIP64: a ZIP64 locator, or sizes set to 0xFFFFFFFF", () => {
    const zip = sample();
    const locator = new Uint8Array(20);
    put32(locator, 0, 0x07064b50);
    const eocd = zip.subarray(zip.length - 22);
    const withLocator = new Uint8Array(zip.length + 20);
    withLocator.set(zip.subarray(0, zip.length - 22));
    withLocator.set(locator, zip.length - 22);
    withLocator.set(eocd, zip.length - 2);
    expect(plan(withLocator)).toEqual({ ok: false, message: MESSAGES.zip64 });

    const sized = sample();
    put32(sized, (centralOffsets(sized)[0] ?? 0) + 24, 0xffffffff);
    expect(plan(sized)).toEqual({ ok: false, message: MESSAGES.zip64 });
  });

  it("refuses a ZIP split across several files", () => {
    const zip = sample();
    put16(zip, zip.length - 22 + 4, 1);
    expect(plan(zip)).toEqual({ ok: false, message: MESSAGES.multiDisk });
  });
});

describe("the limits, at the exact boundary", () => {
  it("opens 1,000 entries and refuses 1,001", () => {
    const files = (count: number) =>
      Object.fromEntries(Array.from({ length: count }, (_, i) => [`f${i}.txt`, new Uint8Array(0)]));
    expect(LIMITS.maxFiles).toBe(1000);
    expect(plan(zipSync(files(1000))).ok).toBe(true);
    expect(plan(zipSync(files(1001)))).toEqual({
      ok: false,
      message: MESSAGES.tooMany(1001, 1000),
    });
  });

  it("opens a ZIP declaring exactly 1 GB unpacked and refuses one byte more", () => {
    const declare = (total: number) => {
      const zip = sample();
      const [first, second, third] = centralOffsets(zip);
      put32(zip, (first ?? 0) + 24, total - 600);
      put32(zip, (second ?? 0) + 24, 0);
      put32(zip, (third ?? 0) + 24, 600);
      return plan(zip);
    };
    expect(LIMITS.maxUnpackedBytes).toBe(1024 ** 3);
    expect(declare(1024 ** 3).ok).toBe(true);
    expect(declare(1024 ** 3 + 1)).toEqual({
      ok: false,
      message: MESSAGES.tooBig(1024 ** 3 + 1, "1 GB"),
    });
  });

  it("refuses a tiny zip bomb that declares 4 GB before unpacking anything", () => {
    const zip = zipSync({ "bomb.bin": [new Uint8Array(1024), { level: 9 }] });
    expect(zip.length).toBeLessThan(200);
    put32(zip, (centralOffsets(zip)[0] ?? 0) + 24, 0xfffffffe);
    expect(plan(zip)).toEqual({ ok: false, message: MESSAGES.tooBig(0xfffffffe, "1 GB") });
  });

  it("makes a ZIP of exactly 500 MB of files and 1,000 files, and refuses more", () => {
    const at = [{ name: "a.bin", size: LIMITS.maxInputBytes }];
    expect(planCreate(at).ok).toBe(true);
    expect(planCreate([{ name: "a.bin", size: LIMITS.maxInputBytes + 1 }])).toEqual({
      ok: false,
      message: MESSAGES.createTooLarge("500 MB"),
    });
    const many = (count: number) => Array.from({ length: count }, () => ({ name: "a", size: 1 }));
    expect(planCreate(many(1000)).ok).toBe(true);
    expect(planCreate(many(1001))).toEqual({ ok: false, message: MESSAGES.createTooMany(1000) });
  });
});

describe("names", () => {
  it("cleans paths so no file can climb out of its folder", () => {
    expect(cleanPath("../../etc/passwd")).toEqual({ path: "etc/passwd", changed: true });
    expect(cleanPath("C:\\Windows\\win.ini")).toEqual({ path: "Windows/win.ini", changed: true });
    expect(cleanPath("/abs/a.txt")).toEqual({ path: "abs/a.txt", changed: true });
    expect(cleanPath("a/./b/../c.txt")).toEqual({ path: "a/b/c.txt", changed: true });
    expect(cleanPath(`bad${String.fromCharCode(7)}name.txt`)).toEqual({
      path: "badname.txt",
      changed: true,
    });
    expect(cleanPath("docs/report.pdf")).toEqual({ path: "docs/report.pdf", changed: false });
  });

  it("renames repeats with (2), (3), whatever their case", () => {
    const taken = new Set<string>();
    expect(uniqueName("notes.txt", taken)).toBe("notes.txt");
    expect(uniqueName("notes.txt", taken)).toBe("notes (2).txt");
    expect(uniqueName("NOTES.txt", taken)).toBe("NOTES (3).txt");
    expect(uniqueName("README", taken)).toBe("README");
    expect(uniqueName("README", taken)).toBe("README (2)");
  });

  it("saves files with the same name in different folders under different names", () => {
    const zip = zipSync({
      "a/notes.txt": strToU8("a"),
      "b/notes.txt": strToU8("b"),
      "../notes.txt": strToU8("c"),
    });
    const result = plan(zip);
    if (!result.ok) throw new Error(result.message);
    expect(result.files.map((file) => [file.path, file.saveAs, file.cleaned])).toEqual([
      ["a/notes.txt", "notes.txt", false],
      ["b/notes.txt", "notes (2).txt", false],
      ["notes.txt", "notes (3).txt", true],
    ]);
  });

  it("reads UTF-8 names, and names not marked UTF-8 as code page 437", () => {
    const record = (bytes: number[], utf8: boolean) => ({
      nameBytes: Uint8Array.from(bytes),
      utf8,
      unicodeName: null,
    });
    // "café" in UTF-8, and the same letters in code page 437 (0x82 is é).
    expect(decodeName(record([0x63, 0x61, 0x66, 0xc3, 0xa9], true))).toBe("café");
    expect(decodeName(record([0x63, 0x61, 0x66, 0x82], false))).toBe("café");
    expect(decodeName(record([0x41, 0x80, 0x9b], false))).toBe("AÇ¢");
    // Invalid UTF-8 marked as UTF-8 becomes the replacement character.
    expect(decodeName(record([0x61, 0xff], true))).toBe("a\uFFFD");
    expect(decodeName({ ...record([0x3f], false), unicodeName: "日本.txt" })).toBe("日本.txt");
  });

  it("marks non-ASCII names it writes as UTF-8, and reads them back", () => {
    const result = plan(zipSync({ "über.txt": strToU8("x") }));
    if (!result.ok) throw new Error(result.message);
    expect(result.files[0]?.path).toBe("über.txt");
  });

  it("uses an Info-ZIP Unicode Path field only when its checksum matches the name", () => {
    const name = strToU8("x.txt");
    const unicode = strToU8("ünï.txt");
    const field = new Uint8Array(4 + 5 + unicode.length);
    put16(field, 0, 0x7075);
    put16(field, 2, 5 + unicode.length);
    field[4] = 1;
    put32(field, 5, crc32(name));
    field.set(unicode, 9);
    const zip = zipSync({ "x.txt": [strToU8("x"), { extra: { 28789: field.subarray(4) } }] });
    const result = plan(zip);
    if (!result.ok) throw new Error(result.message);
    expect(result.files[0]?.path).toBe("ünï.txt");
  });
});

describe("files that are listed but not extracted", () => {
  it("names the compression it cannot unpack", () => {
    const zip = sample();
    put16(zip, (centralOffsets(zip)[0] ?? 0) + 10, 14);
    const result = plan(zip);
    if (!result.ok) throw new Error(result.message);
    expect(result.files[0]?.problem).toBe(MESSAGES.unsupported("LZMA"));
  });

  it("does not follow links", () => {
    const zip = sample();
    const first = centralOffsets(zip)[0] ?? 0;
    zip[first + 5] = 3;
    put16(zip, first + 40, 0xa1ff);
    const result = plan(zip);
    if (!result.ok) throw new Error(result.message);
    expect(result.files[0]?.problem).toBe(MESSAGES.link);
  });
});

describe("helpers", () => {
  it("computes CRC-32 as ZIP does, in one go or in pieces", () => {
    expect(crc32(strToU8("123456789"))).toBe(0xcbf43926);
    expect(crc32(strToU8("6789"), crc32(strToU8("12345")))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("recognises ZIP files by type or name", () => {
    expect(isZipFile({ name: "a.zip", type: "" })).toBe(true);
    expect(isZipFile({ name: "a", type: "application/x-zip-compressed" })).toBe(true);
    expect(isZipFile({ name: "a.rar", type: "application/vnd.rar" })).toBe(false);
  });
});

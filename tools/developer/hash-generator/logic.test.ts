import { describe, expect, it } from "vitest";
import {
  ALGORITHMS,
  CHUNK_BYTES,
  checkFileSize,
  formatSize,
  hashBytes,
  hashFile,
  MAX_BYTES,
  Md5,
  run,
  toHex,
} from "./logic";

const utf8 = (text: string) => new TextEncoder().encode(text);
const md5 = (bytes: Uint8Array) => {
  const hash = new Md5();
  hash.update(bytes);
  return toHex(hash.digest());
};

/** A reader over bytes in memory that gives back at most `most` bytes a call. */
const reader = (bytes: Uint8Array, most = Number.POSITIVE_INFINITY) => {
  const calls: Array<[number, number]> = [];
  const read = async (start: number, end: number) => {
    calls.push([start, end]);
    return bytes.slice(start, Math.min(end, start + most));
  };
  return { read, calls };
};

describe("MD5", () => {
  // The test suite of RFC 1321, appendix A.5, and the pangram most references use.
  it.each([
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
    [
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
      "d174ab98d277d9f5a5611c2c9f419d9f",
    ],
    [
      "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
      "57edf4a22be3c955ac49da2e2107b67a",
    ],
    ["The quick brown fox jumps over the lazy dog", "9e107d9d372bb6826bd81d3542a419d6"],
  ])("hashes %j", (text, expected) => {
    expect(md5(utf8(text))).toBe(expected);
  });

  it("pads correctly at every length around a block boundary", () => {
    // 55 bytes fit the length in the same block; 56 to 63 need a second one.
    const lengths = [55, 56, 57, 63, 64, 65, 119, 120];
    const hashes = lengths.map((length) => md5(new Uint8Array(length).fill(0x61)));
    expect(new Set(hashes).size).toBe(lengths.length);
    expect(md5(new Uint8Array(64).fill(0x61))).toBe("014842d480b571495a4a0363793f7367");
  });

  it("hashes a million bytes", () => {
    expect(md5(new Uint8Array(1_000_000).fill(0x61))).toBe("7707d6ae4e027c70eea2a935c2296f21");
  });

  it("gives the same digest however the input is split", () => {
    const bytes = new Uint8Array(1000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
    const whole = md5(bytes);
    for (const step of [1, 3, 63, 64, 65, 200, 999]) {
      const hash = new Md5();
      for (let at = 0; at < bytes.length; at += step) hash.update(bytes.subarray(at, at + step));
      expect(toHex(hash.digest())).toBe(whole);
    }
  });
});

describe("run", () => {
  it("gives all four hashes of the text, lowercase hex", async () => {
    const result = await run({ text: "abc" });
    expect(result).toEqual({
      ok: true,
      bytes: 3,
      hashes: {
        md5: "900150983cd24fb0d6963f7d28e17f72",
        sha1: "a9993e364706816aba3e25717850c26c9cd0d89d",
        sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        sha512:
          "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
      },
    });
  });

  it("hashes the text as UTF-8", async () => {
    const result = await run({ text: "café" });
    expect(result.ok && result.bytes).toBe(5);
    expect(result.ok && result.hashes.md5).toBe(md5(new Uint8Array([99, 97, 102, 195, 169])));
  });

  it("gives digests of the lengths each algorithm has", async () => {
    const result = await run({ text: "hello" });
    if (!result.ok) throw new Error("expected hashes");
    const lengths = ALGORITHMS.map((algorithm) => result.hashes[algorithm].length);
    expect(lengths).toEqual([32, 40, 64, 128]);
    for (const algorithm of ALGORITHMS) expect(result.hashes[algorithm]).toMatch(/^[0-9a-f]+$/);
  });

  it("gives nothing for empty text", async () => {
    expect(await run({ text: "" })).toMatchObject({ ok: false, reason: "empty" });
  });

  it("refuses text over 50 MB", async () => {
    const result = await run({ text: "a".repeat(MAX_BYTES + 1) });
    expect(result).toMatchObject({
      ok: false,
      reason: "too-large",
      error: "This is just over 50 MB. The most the tool hashes is 50 MB.",
    });
  });
});

describe("hashFile", () => {
  const bytes = new Uint8Array(10_000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 13) & 0xff;

  it("gives the same hashes as hashing the bytes at once, and reports progress", async () => {
    const { read } = reader(bytes, 777);
    const progress: number[] = [];
    const hashes = await hashFile(bytes.length, read, (done) => progress.push(done));
    expect(hashes).toEqual(await hashBytes(bytes));
    expect(progress.at(-1)).toBe(bytes.length);
    expect(progress.length).toBe(Math.ceil(bytes.length / 777));
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it("asks for at most one chunk at a time", async () => {
    const big = new Uint8Array(CHUNK_BYTES * 2 + 5);
    const { read, calls } = reader(big);
    await hashFile(big.length, read);
    expect(calls).toEqual([
      [0, CHUNK_BYTES],
      [CHUNK_BYTES, CHUNK_BYTES * 2],
      [CHUNK_BYTES * 2, CHUNK_BYTES * 2 + 5],
    ]);
  });

  it("hashes an empty file", async () => {
    const hashes = await hashFile(0, reader(new Uint8Array(0)).read);
    expect(hashes?.md5).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(hashes?.sha256).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("stops and gives null when cancelled", async () => {
    let calls = 0;
    const { read } = reader(bytes, 100);
    const hashes = await hashFile(bytes.length, read, undefined, () => ++calls > 3);
    expect(hashes).toBeNull();
    expect(calls).toBe(4);
  });

  it("fails when the file is shorter than it said", async () => {
    await expect(hashFile(20, reader(new Uint8Array(10)).read)).rejects.toThrow(
      "The file changed while it was being read.",
    );
  });
});

describe("sizes", () => {
  it("accepts a file of exactly 50 MB and refuses one byte more", () => {
    expect(checkFileSize(MAX_BYTES)).toBeNull();
    expect(checkFileSize(MAX_BYTES + 1)).toBe(
      "This is just over 50 MB. The most the tool hashes is 50 MB.",
    );
    expect(checkFileSize(80 * 1024 * 1024)).toBe(
      "This is 80 MB. The most the tool hashes is 50 MB.",
    );
  });

  it("formats sizes as a reader says them", () => {
    expect(formatSize(1)).toBe("1 byte");
    expect(formatSize(3)).toBe("3 bytes");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(MAX_BYTES)).toBe("50 MB");
  });
});

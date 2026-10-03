import { describe, expect, it } from "vitest";
import {
  checkFile,
  checkPassword,
  clipName,
  decrypt,
  decryptedName,
  encrypt,
  encryptedName,
  HEADER_BYTES,
  LIMITS,
  MAX_ENCRYPTED_BYTES,
  MESSAGES,
  packPlaintext,
  readHeader,
  TAG_BYTES,
  unpackPlaintext,
} from "./logic";

const text = (value: string) => new TextEncoder().encode(value);

describe("encrypt and decrypt", () => {
  it("round-trips the bytes and the name, with the documented header", async () => {
    const sealed = await encrypt(text("hello world"), "notes.txt", "correct horse");
    expect([...sealed.subarray(0, 5)]).toEqual([0x4e, 0x49, 0x45, 0x43, 1]);
    expect(sealed.length).toBe(HEADER_BYTES + 2 + "notes.txt".length + 11 + TAG_BYTES);
    const opened = await decrypt(sealed, "correct horse");
    expect(opened.name).toBe("notes.txt");
    expect(new TextDecoder().decode(opened.data)).toBe("hello world");
  });

  it("uses a new salt and IV every time", async () => {
    const a = await encrypt(text("same"), "a", "password1");
    const b = await encrypt(text("same"), "a", "password1");
    expect(a.subarray(5, HEADER_BYTES)).not.toEqual(b.subarray(5, HEADER_BYTES));
  });

  // Four PBKDF2 runs of 600,000 iterations: over 5 seconds on a slow machine under a full run.
  it("refuses a wrong password, a changed byte and a changed header with one message", {
    timeout: 30_000,
  }, async () => {
    const sealed = await encrypt(text("secret"), "s.txt", "password1");
    await expect(decrypt(sealed, "password2")).rejects.toThrow(MESSAGES.wrongPassword);
    const body = sealed.slice();
    body[body.length - 1] = (body[body.length - 1] ?? 0) ^ 1;
    await expect(decrypt(body, "password1")).rejects.toThrow(MESSAGES.wrongPassword);
    const salt = sealed.slice();
    salt[6] = (salt[6] ?? 0) ^ 1;
    await expect(decrypt(salt, "password1")).rejects.toThrow(MESSAGES.wrongPassword);
  });

  it("refuses a file that is not .nienc, a truncated one and a newer version", async () => {
    await expect(decrypt(text("hello, this is plain text, not nienc"), "x")).rejects.toThrow(
      MESSAGES.notNienc,
    );
    const sealed = await encrypt(text("x"), "x", "password1");
    expect(() => readHeader(sealed.subarray(0, HEADER_BYTES + TAG_BYTES - 1))).toThrow(
      MESSAGES.notNienc,
    );
    const newer = sealed.slice();
    newer[4] = 2;
    expect(() => readHeader(newer)).toThrow(MESSAGES.newerVersion);
  });
});

describe("rules", () => {
  it("takes exactly 100 MB to encrypt and refuses one byte more", () => {
    expect(checkFile("encrypt", { size: LIMITS.maxInputBytes })).toBeNull();
    expect(checkFile("encrypt", { size: LIMITS.maxInputBytes + 1 })).toBe(MESSAGES.tooLarge);
    expect(checkFile("encrypt", { size: 0 })).toBe(MESSAGES.empty);
  });

  it("takes the largest .nienc file to decrypt and refuses one byte more", () => {
    expect(MAX_ENCRYPTED_BYTES).toBe(LIMITS.maxInputBytes + 33 + 2 + 255 + 16);
    expect(checkFile("decrypt", { size: MAX_ENCRYPTED_BYTES })).toBeNull();
    expect(checkFile("decrypt", { size: MAX_ENCRYPTED_BYTES + 1 })).toBe(
      MESSAGES.tooLargeEncrypted,
    );
  });

  it("needs 8 characters and a matching confirmation to encrypt", () => {
    expect(checkPassword("encrypt", "1234567", "1234567")).toBe(MESSAGES.shortPassword);
    expect(checkPassword("encrypt", "12345678", "12345678")).toBeNull();
    expect(checkPassword("encrypt", "12345678", "12345679")).toBe(MESSAGES.mismatch);
    expect(checkPassword("decrypt", "", "")).toBe(MESSAGES.shortPassword);
    expect(checkPassword("decrypt", "x", "")).toBeNull();
  });

  it("keeps names to 255 UTF-8 bytes without splitting a character", () => {
    expect(new TextEncoder().encode(clipName("é".repeat(200))).length).toBe(254);
    const packed = packPlaintext("a".repeat(300), text("data"));
    const unpacked = unpackPlaintext(packed);
    expect(unpacked.name).toHaveLength(255);
    expect(new TextDecoder().decode(unpacked.data)).toBe("data");
  });

  it("names the files", () => {
    expect(encryptedName("report.pdf")).toBe("report.pdf.nienc");
    expect(decryptedName("report.pdf", "x.nienc")).toBe("report.pdf");
    expect(decryptedName("../a/b.txt", "x.nienc")).toBe("_a_b.txt");
    expect(decryptedName("", "photo.jpg.nienc")).toBe("photo.jpg");
  });
});

// Pure logic of "File Encrypt and Decrypt": the .nienc format, the size and password rules, and
// encryption and decryption with WebCrypto (crypto.subtle, which browsers, workers and servers all
// have). No DOM, no network, no top-level statements (docs/tool-contract.md). The password is only
// ever passed to PBKDF2; nothing here keeps, logs or returns it.
//
// The .nienc format, version 1. Every number is big endian.
//
//   offset  length  content
//   0       4       the magic bytes "NIEC"
//   4       1       the version, 1
//   5       16      the PBKDF2 salt, random for every file
//   21      12      the AES-GCM nonce (IV), random for every file
//   33      ...     AES-256-GCM ciphertext, with its 16-byte tag at the end
//
// The key is PBKDF2-HMAC-SHA-256 of the password (UTF-8) and the salt, 600,000 iterations, 256
// bits. The 33 header bytes are the additional authenticated data, so a changed header fails like
// a changed ciphertext. The plaintext is a 2-byte length, the original file name in UTF-8 (at most
// 255 bytes), then the file's bytes.

export const MAGIC = [0x4e, 0x49, 0x45, 0x43] as const;
export const VERSION = 1;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const TAG_BYTES = 16;
export const HEADER_BYTES = 4 + 1 + SALT_BYTES + IV_BYTES;
export const MAX_NAME_BYTES = 255;

/**
 * PBKDF2-HMAC-SHA-256 iterations: the OWASP Password Storage Cheat Sheet recommends 600,000
 * (checked 2026-10-03). Fixed for version 1; a new count would be a new version.
 */
export const ITERATIONS = 600_000;

export const LIMITS = {
  /** 100 MB, our own choice: WebCrypto needs the whole file and its result in memory at once. */
  maxInputBytes: 100 * 1024 * 1024,
  maxFiles: 1,
  minPasswordLength: 8,
} as const;

/** The largest .nienc file: a 100 MB file plus the header, the longest name and the tag. */
export const MAX_ENCRYPTED_BYTES =
  LIMITS.maxInputBytes + HEADER_BYTES + 2 + MAX_NAME_BYTES + TAG_BYTES;

export const EXTENSION = ".nienc";

export type Mode = "encrypt" | "decrypt";

export interface Input {
  mode: Mode;
}

export interface Job {
  mode: Mode;
  file: Blob;
  name: string;
  password: string;
}

export interface JobResult {
  blob: Blob;
  name: string;
}

export const MESSAGES = {
  tooLarge: "This file is larger than 100 MB.",
  tooLargeEncrypted: "This file is larger than any .nienc file this tool makes.",
  empty: "This file is empty.",
  shortPassword: "Use a password of at least 8 characters.",
  mismatch: "The two passwords are not the same.",
  notNienc: "This is not a .nienc file made by this tool.",
  newerVersion: "This .nienc file was made by a newer version of this tool.",
  wrongPassword:
    "The file could not be decrypted. The password is wrong, or the file is damaged or was changed.",
  failed: "Something went wrong. Try again.",
} as const;

export class FormatError extends Error {}

/** The reason a file cannot be used in this mode, or null. */
export function checkFile(mode: Mode, file: { size: number }): string | null {
  if (file.size === 0) return MESSAGES.empty;
  if (mode === "encrypt" && file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge;
  if (mode === "decrypt" && file.size > MAX_ENCRYPTED_BYTES) return MESSAGES.tooLargeEncrypted;
  return null;
}

/** The reason a password cannot be used, or null. Decrypting needs no confirmation. */
export function checkPassword(mode: Mode, password: string, confirm: string): string | null {
  if (mode === "decrypt") return password === "" ? MESSAGES.shortPassword : null;
  if ([...password].length < LIMITS.minPasswordLength) return MESSAGES.shortPassword;
  if (password !== confirm) return MESSAGES.mismatch;
  return null;
}

/** The name cut to at most 255 UTF-8 bytes, never in the middle of a character. */
export function clipName(name: string): string {
  const encoder = new TextEncoder();
  let out = "";
  for (const char of name) {
    if (encoder.encode(out + char).length > MAX_NAME_BYTES) break;
    out += char;
  }
  return out;
}

export function writeHeader(salt: Uint8Array, iv: Uint8Array): Uint8Array {
  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC, 0);
  header[4] = VERSION;
  header.set(salt, 5);
  header.set(iv, 5 + SALT_BYTES);
  return header;
}

export function readHeader(bytes: Uint8Array): {
  salt: Uint8Array;
  iv: Uint8Array;
  header: Uint8Array;
} {
  if (bytes.length < HEADER_BYTES + TAG_BYTES || MAGIC.some((byte, i) => bytes[i] !== byte)) {
    throw new FormatError(MESSAGES.notNienc);
  }
  if (bytes[4] !== VERSION) throw new FormatError(MESSAGES.newerVersion);
  return {
    header: bytes.slice(0, HEADER_BYTES),
    salt: bytes.slice(5, 5 + SALT_BYTES),
    iv: bytes.slice(5 + SALT_BYTES, HEADER_BYTES),
  };
}

export function packPlaintext(name: string, data: Uint8Array): Uint8Array {
  const nameBytes = new TextEncoder().encode(clipName(name));
  const out = new Uint8Array(2 + nameBytes.length + data.length);
  new DataView(out.buffer).setUint16(0, nameBytes.length);
  out.set(nameBytes, 2);
  out.set(data, 2 + nameBytes.length);
  return out;
}

export function unpackPlaintext(plain: Uint8Array): { name: string; data: Uint8Array } {
  if (plain.length < 2) throw new FormatError(MESSAGES.notNienc);
  const length = new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getUint16(0);
  if (length > MAX_NAME_BYTES || 2 + length > plain.length)
    throw new FormatError(MESSAGES.notNienc);
  return {
    name: new TextDecoder().decode(plain.subarray(2, 2 + length)),
    data: plain.subarray(2 + length),
  };
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt as Uint8Array<ArrayBuffer>,
      iterations: ITERATIONS,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypts a file's bytes and name into .nienc bytes, with a fresh random salt and IV. */
export async function encrypt(
  data: Uint8Array,
  name: string,
  password: string,
): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const header = writeHeader(salt, iv);
  const key = await deriveKey(password, salt);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: header as Uint8Array<ArrayBuffer>, tagLength: 128 },
      key,
      packPlaintext(name, data) as Uint8Array<ArrayBuffer>,
    ),
  );
  const out = new Uint8Array(HEADER_BYTES + sealed.length);
  out.set(header, 0);
  out.set(sealed, HEADER_BYTES);
  return out;
}

/**
 * Decrypts .nienc bytes. A wrong password, a damaged file and a changed header all fail the same
 * way, with MESSAGES.wrongPassword: GCM cannot tell them apart, and no partial output is given.
 */
export async function decrypt(
  bytes: Uint8Array,
  password: string,
): Promise<{ name: string; data: Uint8Array }> {
  const { header, salt, iv } = readHeader(bytes);
  const key = await deriveKey(password, salt);
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv as Uint8Array<ArrayBuffer>,
          additionalData: header as Uint8Array<ArrayBuffer>,
          tagLength: 128,
        },
        key,
        bytes.subarray(HEADER_BYTES) as Uint8Array<ArrayBuffer>,
      ),
    );
  } catch {
    throw new FormatError(MESSAGES.wrongPassword);
  }
  return unpackPlaintext(plain);
}

/** `report.pdf` gives `report.pdf.nienc`. */
export function encryptedName(name: string): string {
  return `${name || "file"}${EXTENSION}`;
}

/** The name kept inside the file, made safe to save: no folders, never empty. */
export function decryptedName(stored: string, fileName: string): string {
  const base = stored
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  if (base) return base;
  return fileName.toLowerCase().endsWith(EXTENSION)
    ? fileName.slice(0, -EXTENSION.length) || "decrypted"
    : "decrypted";
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

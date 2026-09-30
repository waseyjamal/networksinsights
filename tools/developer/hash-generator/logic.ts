// Pure logic of Hash Generator: the MD5, SHA-1, SHA-256 and SHA-512 digests of text or of a file,
// as lowercase hex. The SHA family comes from crypto.subtle, which every runtime has; MD5 does not,
// so it is written here from RFC 1321 and fed in chunks, which lets a file report its progress.

/** The hashes the tool computes, in the order the page shows them. */
export const ALGORITHMS = ["md5", "sha1", "sha256", "sha512"] as const;
export type Algorithm = (typeof ALGORITHMS)[number];

export const ALGORITHM_LABELS: Readonly<Record<Algorithm, string>> = {
  md5: "MD5",
  sha1: "SHA-1",
  sha256: "SHA-256",
  sha512: "SHA-512",
};

/** The name crypto.subtle.digest knows each SHA hash by. */
const SUBTLE_NAMES = { sha1: "SHA-1", sha256: "SHA-256", sha512: "SHA-512" } as const;

/** The most a text or a file may hold: 50 MB. */
export const MAX_BYTES = 50 * 1024 * 1024;

/** A file is read, and reports its progress, this many bytes at a time. */
export const CHUNK_BYTES = 4 * 1024 * 1024;

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  text: string;
}

export type Hashes = Record<Algorithm, string>;

export type Result =
  | { ok: true; hashes: Hashes; bytes: number }
  | { ok: false; reason: "empty" | "too-large"; error: string };

/** The four hashes of the text, encoded as UTF-8. */
export async function run(input: Input): Promise<Result> {
  if (input.text === "") return { ok: false, reason: "empty", error: "" };
  const bytes = new TextEncoder().encode(input.text);
  if (bytes.length > MAX_BYTES) return tooLarge(bytes.length);
  return { ok: true, hashes: await hashBytes(bytes), bytes: bytes.length };
}

/** The message for a file over the limit, before it is read. Null when it fits. */
export function checkFileSize(size: number): string | null {
  return size > MAX_BYTES ? tooLarge(size).error : null;
}

/** The four hashes of `bytes`. */
export async function hashBytes(bytes: Uint8Array<ArrayBuffer>): Promise<Hashes> {
  const md5 = new Md5();
  md5.update(bytes);
  return { md5: toHex(md5.digest()), ...(await shaHashes(bytes)) };
}

/**
 * The four hashes of a file of `size` bytes, read with `read(start, end)` one chunk at a time.
 * `onProgress` hears how many bytes have been hashed after every chunk. `cancelled` is asked
 * between chunks; when it says yes, the work stops and the result is null.
 */
export async function hashFile(
  size: number,
  read: (start: number, end: number) => Promise<Uint8Array>,
  onProgress?: (done: number) => void,
  cancelled?: () => boolean,
): Promise<Hashes | null> {
  // crypto.subtle hashes one whole buffer, so the chunks are gathered for it as MD5 reads them.
  const all = new Uint8Array(size);
  const md5 = new Md5();
  let done = 0;
  while (done < size) {
    const chunk = await read(done, Math.min(size, done + CHUNK_BYTES));
    if (cancelled?.()) return null;
    if (chunk.length === 0 || done + chunk.length > size) {
      throw new Error("The file changed while it was being read.");
    }
    md5.update(chunk);
    all.set(chunk, done);
    done += chunk.length;
    onProgress?.(done);
  }
  const sha = await shaHashes(all);
  if (cancelled?.()) return null;
  return { md5: toHex(md5.digest()), ...sha };
}

async function shaHashes(bytes: Uint8Array<ArrayBuffer>): Promise<Omit<Hashes, "md5">> {
  const [sha1, sha256, sha512] = await Promise.all(
    (["sha1", "sha256", "sha512"] as const).map(async (algorithm) =>
      toHex(new Uint8Array(await crypto.subtle.digest(SUBTLE_NAMES[algorithm], bytes))),
    ),
  );
  return { sha1: sha1 ?? "", sha256: sha256 ?? "", sha512: sha512 ?? "" };
}

/** Lowercase hex, two digits a byte. */
export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** A size as a reader says it: bytes, KB or MB (1,024-based, as file managers show them). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Number.parseFloat(kb.toFixed(1))} KB`;
  return `${Number.parseFloat((kb / 1024).toFixed(1))} MB`;
}

function tooLarge(size: number): { ok: false; reason: "too-large"; error: string } {
  const shown = formatSize(size);
  const said = shown === formatSize(MAX_BYTES) ? `just over ${shown}` : shown;
  return {
    ok: false,
    reason: "too-large",
    error: `This is ${said}. The most the tool hashes is ${formatSize(MAX_BYTES)}.`,
  };
}

/** floor(abs(sin(i + 1)) * 2^32), the 64 constants of RFC 1321. */
const MD5_K = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
] as const;

/** The left rotations of each round, four to a round. */
const MD5_SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21] as const;

/** MD5 (RFC 1321), fed any number of times with `update`, then read once with `digest`. */
export class Md5 {
  private a = 0x67452301;
  private b = 0xefcdab89 | 0;
  private c = 0x98badcfe | 0;
  private d = 0x10325476;
  /** Bytes waiting for a whole 64-byte block. */
  private readonly pending = new Uint8Array(64);
  private pendingLength = 0;
  /** Bytes fed in all. */
  private length = 0;
  private readonly words = new Int32Array(16);

  update(bytes: Uint8Array): void {
    this.length += bytes.length;
    let offset = 0;
    if (this.pendingLength > 0) {
      const take = Math.min(64 - this.pendingLength, bytes.length);
      this.pending.set(bytes.subarray(0, take), this.pendingLength);
      this.pendingLength += take;
      offset = take;
      if (this.pendingLength < 64) return;
      this.block(this.pending, 0);
      this.pendingLength = 0;
    }
    for (; offset + 64 <= bytes.length; offset += 64) this.block(bytes, offset);
    this.pending.set(bytes.subarray(offset), 0);
    this.pendingLength = bytes.length - offset;
  }

  /** The 16-byte digest. Pads the message, so feed nothing after it. */
  digest(): Uint8Array {
    const bits = this.length * 8;
    const tail = new Uint8Array(this.pendingLength < 56 ? 64 : 128);
    tail.set(this.pending.subarray(0, this.pendingLength));
    tail[this.pendingLength] = 0x80;
    const view = new DataView(tail.buffer);
    view.setUint32(tail.length - 8, bits >>> 0, true);
    view.setUint32(tail.length - 4, Math.floor(bits / 0x100000000), true);
    for (let offset = 0; offset < tail.length; offset += 64) this.block(tail, offset);
    const out = new Uint8Array(16);
    const outView = new DataView(out.buffer);
    outView.setInt32(0, this.a, true);
    outView.setInt32(4, this.b, true);
    outView.setInt32(8, this.c, true);
    outView.setInt32(12, this.d, true);
    return out;
  }

  private block(bytes: Uint8Array, offset: number): void {
    const m = this.words;
    for (let i = 0; i < 16; i++) {
      const at = offset + i * 4;
      m[i] =
        (bytes[at] ?? 0) |
        ((bytes[at + 1] ?? 0) << 8) |
        ((bytes[at + 2] ?? 0) << 16) |
        ((bytes[at + 3] ?? 0) << 24);
    }
    let a = this.a;
    let b = this.b;
    let c = this.c;
    let d = this.d;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) & 15;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) & 15;
      }
      const shift = MD5_SHIFTS[((i >> 4) << 2) | (i & 3)] ?? 0;
      const x = (a + f + (MD5_K[i] ?? 0) + (m[g] ?? 0)) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((x << shift) | (x >>> (32 - shift)))) | 0;
    }
    this.a = (this.a + a) | 0;
    this.b = (this.b + b) | 0;
    this.c = (this.c + c) | 0;
    this.d = (this.d + d) | 0;
  }
}

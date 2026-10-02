// Pure logic of UUID Generator: builds version 4 and version 7 UUIDs (RFC 9562) from random bytes
// and a clock reading that the page passes in, so this file holds no randomness of its own.
//
// Version 4: 122 random bits; the version nibble is 0100 and the variant is 10.
// Version 7: a 48-bit Unix time in milliseconds, then the version nibble 0111, 12 bits (rand_a),
// the variant 10 and 62 random bits (rand_b). rand_a is used as a counter that starts at a random
// value below 2048 and grows by one per UUID in a batch, so a batch sorts in the order it was made.

export type Version = "4" | "7";

export const MIN_COUNT = 1;
export const MAX_COUNT = 1000;

/** The random bytes the page must supply for one UUID. */
export const BYTES_PER_UUID = 16;

/** The largest Unix time in milliseconds that fits the 48 bits of a version 7 UUID. */
export const MAX_TIMESTAMP_MS = 2 ** 48 - 1;

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  version: Version;
  /** How many, as typed. */
  count: string;
  uppercase: boolean;
  noHyphens: boolean;
  braces: boolean;
}

/** What only the page can supply: secure random bytes, and the clock. */
export interface Entropy {
  /** At least BYTES_PER_UUID bytes for every UUID asked for. */
  random: Uint8Array;
  /** Milliseconds since 1970-01-01T00:00:00Z. Read only for version 7. */
  timestampMs: number;
}

export type CountResult = { ok: true; count: number } | { ok: false; error: string };

/** Reads how many UUIDs were asked for: a whole number from 1 to 1,000. */
export function parseCount(text: string): CountResult {
  const t = text.trim();
  if (t === "") return { ok: false, error: "Enter how many UUIDs you want." };
  if (!/^\d+$/.test(t)) {
    return { ok: false, error: "Use a whole number of UUIDs, such as 10." };
  }
  const count = Number(t);
  if (count < MIN_COUNT || count > MAX_COUNT) {
    return { ok: false, error: `Choose from ${MIN_COUNT} to ${MAX_COUNT} UUIDs.` };
  }
  return { ok: true, count };
}

const HEX = "0123456789abcdef";

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += HEX.charAt(byte >> 4) + HEX.charAt(byte & 15);
  return out;
}

/** Builds `count` UUIDs of `version` in their usual form: lowercase, hyphenated, no braces. */
export function buildUuids(version: Version, count: number, entropy: Entropy): string[] {
  if (entropy.random.length < count * BYTES_PER_UUID) {
    throw new RangeError("Not enough random bytes");
  }
  const uuids: string[] = [];
  let counter = 0;
  for (let i = 0; i < count; i += 1) {
    const bytes = entropy.random.slice(i * BYTES_PER_UUID, (i + 1) * BYTES_PER_UUID);
    if (version === "4") {
      bytes[6] = 0x40 | ((bytes[6] ?? 0) & 0x0f);
    } else {
      const ts = entropy.timestampMs;
      const high = Math.floor(ts / 2 ** 32);
      const low = ts % 2 ** 32;
      bytes[0] = (high >> 8) & 0xff;
      bytes[1] = high & 0xff;
      bytes[2] = (low >>> 24) & 0xff;
      bytes[3] = (low >>> 16) & 0xff;
      bytes[4] = (low >>> 8) & 0xff;
      bytes[5] = low & 0xff;
      if (i === 0) counter = (((bytes[6] ?? 0) << 8) | (bytes[7] ?? 0)) & 0x7ff;
      else counter += 1;
      bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
      bytes[7] = counter & 0xff;
    }
    bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
    const hex = toHex(bytes);
    uuids.push(
      `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    );
  }
  return uuids;
}

/** Writes one UUID with the options: uppercase, without hyphens, in braces. */
export function formatUuid(
  uuid: string,
  options: Pick<Input, "uppercase" | "noHyphens" | "braces">,
): string {
  let out = options.noHyphens ? uuid.replaceAll("-", "") : uuid;
  if (options.uppercase) out = out.toUpperCase();
  return options.braces ? `{${out}}` : out;
}

export type Result = { ok: true; uuids: string[]; text: string } | { ok: false; error: string };

/** Makes the UUIDs asked for, written with the options, one per line in `text`. */
export function run(input: Input, entropy: Entropy): Result {
  const count = parseCount(input.count);
  if (!count.ok) return count;
  if (
    input.version === "7" &&
    (!Number.isInteger(entropy.timestampMs) ||
      entropy.timestampMs < 0 ||
      entropy.timestampMs > MAX_TIMESTAMP_MS)
  ) {
    return {
      ok: false,
      error: "The clock of this device gave a time a version 7 UUID cannot hold.",
    };
  }
  const uuids = buildUuids(input.version, count.count, entropy).map((uuid) =>
    formatUuid(uuid, input),
  );
  return { ok: true, uuids, text: uuids.join("\n") };
}

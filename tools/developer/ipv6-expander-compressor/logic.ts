// Pure logic of "IPv6 Address Expander and Compressor": reads IPv6 text (RFC 4291) and writes it in
// full, eight groups of four digits, and in the canonical short form of RFC 5952. Addresses are
// BigInt numbers of 128 bits. No DOM, no network, no top-level statements (docs/tool-contract.md).

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  text: string;
}

/** At most this many lines, one address on each. */
export const MAX_LINES = 500;
export const MAX_CHARS = 30_000;

export const MESSAGES = {
  empty: "Type an IPv6 address, or several, one on each line.",
  tooLong: `Type at most 30,000 characters.`,
  tooManyLines: `Type at most ${MAX_LINES} addresses.`,
  bad: "Not an IPv6 address.",
  zone: "Has a zone (after %); remove it to read the address.",
  prefix: "Has a prefix (after /); type the address alone.",
  twoGaps: 'Uses "::" twice; it may appear only once.',
  groups: "Does not have eight groups of up to four hexadecimal digits.",
  ipv4: "The dotted IPv4 part at the end is not four numbers from 0 to 255 without leading zeros.",
} as const;

type Parsed = { ok: true; value: bigint } | { ok: false; error: string };

function ipv4Part(text: string): number | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255) return null;
    value = value * 256 + Number(part);
  }
  return value;
}

/** IPv6 text as a 128-bit number. Takes `::` once and a dotted IPv4 tail. */
export function parseIpv6(raw: string): Parsed {
  const text = raw.trim();
  if (text.includes("%")) return { ok: false, error: MESSAGES.zone };
  if (text.includes("/")) return { ok: false, error: MESSAGES.prefix };
  if (!/^[0-9a-fA-F:.]+$/.test(text) || !text.includes(":"))
    return { ok: false, error: MESSAGES.bad };
  const halves = text.split("::");
  if (halves.length > 2) return { ok: false, error: MESSAGES.twoGaps };
  const groupsOf = (half: string, isLast: boolean): number[] | string => {
    if (half === "") return [];
    const parts = half.split(":");
    const out: number[] = [];
    for (const [index, part] of parts.entries()) {
      if (part.includes(".")) {
        if (!isLast || index !== parts.length - 1) return MESSAGES.ipv4;
        const v4 = ipv4Part(part);
        if (v4 === null) return MESSAGES.ipv4;
        out.push(Math.floor(v4 / 65536), v4 % 65536);
      } else if (/^[0-9a-f]{1,4}$/i.test(part)) out.push(Number.parseInt(part, 16));
      else return MESSAGES.groups;
    }
    return out;
  };
  const head = groupsOf(halves[0] ?? "", halves.length === 1);
  if (typeof head === "string") return { ok: false, error: head };
  const tail = halves.length === 2 ? groupsOf(halves[1] ?? "", true) : [];
  if (typeof tail === "string") return { ok: false, error: tail };
  let groups = head;
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return { ok: false, error: MESSAGES.groups };
    groups = [...head, ...new Array<number>(missing).fill(0), ...tail];
  }
  if (groups.length !== 8) return { ok: false, error: MESSAGES.groups };
  let value = BigInt(0);
  for (const group of groups) value = (value << BigInt(16)) + BigInt(group);
  return { ok: true, value };
}

export function groupsOf(value: bigint): number[] {
  const groups: number[] = [];
  for (let shift = 112; shift >= 0; shift -= 16) {
    groups.push(Number((value >> BigInt(shift)) & BigInt(0xffff)));
  }
  return groups;
}

/** All eight groups, four lowercase digits each: `2001:0db8:0000:…`. */
export function expand(value: bigint): string {
  return groupsOf(value)
    .map((group) => group.toString(16).padStart(4, "0"))
    .join(":");
}

/**
 * The RFC 5952 form: lowercase, no leading zeros in a group, "::" for the longest run of two or
 * more zero groups (the first such run on a tie, never a single group), and an IPv4-mapped address
 * (::ffff:0:0/96) with its last 32 bits as a dotted IPv4 address (section 5).
 */
export function compress(value: bigint): string {
  const groups = groupsOf(value);
  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  const hexGroups = mapped ? groups.slice(0, 6) : groups;
  let bestStart = -1;
  let bestLength = 0;
  for (let start = 0; start < hexGroups.length; ) {
    if (hexGroups[start] !== 0) {
      start++;
      continue;
    }
    let end = start;
    while (end < hexGroups.length && hexGroups[end] === 0) end++;
    if (end - start > bestLength) {
      bestStart = start;
      bestLength = end - start;
    }
    start = end;
  }
  const hex = (list: number[]) => list.map((group) => group.toString(16)).join(":");
  let text =
    bestLength < 2
      ? hex(hexGroups)
      : `${hex(hexGroups.slice(0, bestStart))}::${hex(hexGroups.slice(bestStart + bestLength))}`;
  if (mapped) {
    const low = Number(value & BigInt(0xffffffff));
    const dotted = [low >>> 24, (low >>> 16) & 255, (low >>> 8) & 255, low & 255].join(".");
    text = `${text}${text.endsWith(":") ? "" : ":"}${dotted}`;
  }
  return text;
}

export type Row =
  | { input: string; ok: true; expanded: string; compressed: string; canonical: boolean }
  | { input: string; ok: false; error: string };

export type Result = { ok: true; rows: Row[] } | { ok: false; error: string };

/** One row for every non-empty line. */
export function run(input: Input): Result {
  if (input.text.length > MAX_CHARS) return { ok: false, error: MESSAGES.tooLong };
  const lines = input.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length === 0) return { ok: false, error: MESSAGES.empty };
  if (lines.length > MAX_LINES) return { ok: false, error: MESSAGES.tooManyLines };
  return {
    ok: true,
    rows: lines.map((line): Row => {
      const parsed = parseIpv6(line);
      if (!parsed.ok) return { input: line, ok: false, error: parsed.error };
      const compressed = compress(parsed.value);
      return {
        input: line,
        ok: true,
        expanded: expand(parsed.value),
        compressed,
        canonical: compressed === line,
      };
    }),
  };
}

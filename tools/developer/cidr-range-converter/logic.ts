// Pure logic of "CIDR to IP Range Converter": a CIDR block becomes its first and last address, and
// a range of addresses becomes the fewest CIDR blocks that cover it exactly. IPv4 and IPv6 both
// become BigInt numbers (32 or 128 bits), so one algorithm serves both. No DOM, no network, no
// top-level statements (docs/tool-contract.md).

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  text: string;
}

export const MAX_CHARS = 200;

export type Family = 4 | 6;

export interface Address {
  family: Family;
  value: bigint;
}

export const MESSAGES = {
  empty: "Type a CIDR block such as 10.0.0.0/22, or a range such as 10.0.0.0 - 10.0.3.255.",
  tooLong: `Type at most ${MAX_CHARS} characters.`,
  badAddress: (text: string) => `"${text}" is not an IPv4 or IPv6 address.`,
  leadingZero: (text: string) =>
    `"${text}" has a leading zero in an IPv4 number. Some programs read 010 as octal, so it is refused.`,
  zone: (text: string) =>
    `"${text}" has a zone (after %). Remove it: a zone is not part of a block.`,
  badPrefix: (text: string, family: Family) =>
    `"${text}" is not a prefix. Write a number from 0 to ${family === 4 ? 32 : 128}.`,
  mixed: "The start and end must both be IPv4 or both be IPv6.",
  backwards: "The range runs backwards: the start address is after the end address.",
  unreadable:
    "Type a CIDR block such as 10.0.0.0/22, or two addresses joined by a dash or the word to.",
} as const;

export const bits = (family: Family): number => (family === 4 ? 32 : 128);

const MAX6 = (BigInt(1) << BigInt(128)) - BigInt(1);

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function parseIpv4Number(text: string): Parsed<bigint> {
  const parts = text.split(".");
  if (parts.length !== 4) return { ok: false, error: MESSAGES.badAddress(text) };
  let value = BigInt(0);
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) {
      return { ok: false, error: MESSAGES.badAddress(text) };
    }
    if (part.length > 1 && part.startsWith("0"))
      return { ok: false, error: MESSAGES.leadingZero(text) };
    value = value * BigInt(256) + BigInt(Number(part));
  }
  return { ok: true, value };
}

/** Eight 16-bit groups from IPv6 text, with `::` and a final dotted IPv4 part (RFC 4291). */
function parseIpv6Number(text: string): Parsed<bigint> {
  const bad = { ok: false as const, error: MESSAGES.badAddress(text) };
  if (text.includes("%")) return { ok: false, error: MESSAGES.zone(text) };
  const halves = text.split("::");
  if (halves.length > 2) return bad;
  const groupsOf = (half: string): number[] | null => {
    if (half === "") return [];
    const out: number[] = [];
    const parts = half.split(":");
    for (const [index, part] of parts.entries()) {
      if (index === parts.length - 1 && part.includes(".")) {
        const v4 = parseIpv4Number(part);
        if (!v4.ok) return null;
        const n = Number(v4.value);
        out.push(Math.floor(n / 65536), n % 65536);
      } else if (/^[0-9a-f]{1,4}$/i.test(part)) out.push(Number.parseInt(part, 16));
      else return null;
    }
    return out;
  };
  const head = groupsOf(halves[0] ?? "");
  const tail = halves.length === 2 ? groupsOf(halves[1] ?? "") : [];
  if (!head || !tail) return bad;
  // A dotted part may come only at the very end.
  if (halves.length === 2 && (halves[0] ?? "").includes(".")) return bad;
  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return bad;
    groups = [...head, ...new Array<number>(missing).fill(0), ...tail];
  } else groups = head;
  if (groups.length !== 8) return bad;
  let value = BigInt(0);
  for (const group of groups) value = (value << BigInt(16)) + BigInt(group);
  return { ok: true, value };
}

export function parseAddress(text: string): Parsed<Address> {
  if (text.includes(":")) {
    const v6 = parseIpv6Number(text);
    return v6.ok ? { ok: true, value: { family: 6, value: v6.value } } : v6;
  }
  const v4 = parseIpv4Number(text);
  return v4.ok ? { ok: true, value: { family: 4, value: v4.value } } : v4;
}

/** IPv4 dotted; IPv6 in the RFC 5952 short form. */
export function formatAddress({ family, value }: Address): string {
  if (family === 4) {
    const n = Number(value);
    return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  }
  return compress6(value);
}

/** RFC 5952: the longest zero run (leftmost on a tie, never one group) as "::", IPv4-mapped dotted. */
function compress6(value: bigint): string {
  const groups: number[] = [];
  for (let shift = 112; shift >= 0; shift -= 16) {
    groups.push(Number((value >> BigInt(shift)) & BigInt(0xffff)));
  }
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

export interface Block {
  family: Family;
  network: bigint;
  prefix: number;
}

export const blockSize = (block: Block): bigint =>
  BigInt(1) << BigInt(bits(block.family) - block.prefix);

export const blockLast = (block: Block): bigint => block.network + blockSize(block) - BigInt(1);

export const formatBlock = (block: Block): string =>
  `${formatAddress({ family: block.family, value: block.network })}/${block.prefix}`;

/** The fewest CIDR blocks that hold exactly the addresses from `start` to `end`. */
export function rangeToBlocks(family: Family, start: bigint, end: bigint): Block[] {
  const width = bits(family);
  const blocks: Block[] = [];
  let at = start;
  while (at <= end) {
    // The biggest block that starts at `at` (it must be aligned) and does not pass `end`.
    let size = 0;
    while (
      size < width &&
      (at & ((BigInt(1) << BigInt(size + 1)) - BigInt(1))) === BigInt(0) &&
      at + (BigInt(1) << BigInt(size + 1)) - BigInt(1) <= end
    )
      size++;
    blocks.push({ family, network: at, prefix: width - size });
    at += BigInt(1) << BigInt(size);
  }
  return blocks;
}

export type Result =
  | {
      ok: true;
      kind: "cidr";
      block: Block;
      /** The address as typed when it was not the start of its block. */
      hostBitsSet: string | null;
      first: string;
      last: string;
      count: bigint;
      mask: string | null;
    }
  | { ok: true; kind: "range"; first: string; last: string; count: bigint; blocks: string[] }
  | { ok: false; error: string };

function cidr(addressText: string, prefixText: string): Result {
  const parsed = parseAddress(addressText);
  if (!parsed.ok) return parsed;
  const { family, value } = parsed.value;
  const width = bits(family);
  if (!/^\d{1,3}$/.test(prefixText) || Number(prefixText) > width) {
    return { ok: false, error: MESSAGES.badPrefix(`/${prefixText}`, family) };
  }
  const prefix = Number(prefixText);
  const all = family === 4 ? BigInt(0xffffffff) : MAX6;
  const hostMask = (BigInt(1) << BigInt(width - prefix)) - BigInt(1);
  const network = value & (all ^ hostMask);
  const block: Block = { family, network, prefix };
  return {
    ok: true,
    kind: "cidr",
    block,
    hostBitsSet: network === value ? null : addressText,
    first: formatAddress({ family, value: network }),
    last: formatAddress({ family, value: blockLast(block) }),
    count: blockSize(block),
    mask: family === 4 ? formatAddress({ family, value: all ^ hostMask }) : null,
  };
}

function range(startText: string, endText: string): Result {
  const start = parseAddress(startText);
  if (!start.ok) return start;
  const end = parseAddress(endText);
  if (!end.ok) return end;
  if (start.value.family !== end.value.family) return { ok: false, error: MESSAGES.mixed };
  if (start.value.value > end.value.value) return { ok: false, error: MESSAGES.backwards };
  const family = start.value.family;
  return {
    ok: true,
    kind: "range",
    first: formatAddress(start.value),
    last: formatAddress(end.value),
    count: end.value.value - start.value.value + BigInt(1),
    blocks: rangeToBlocks(family, start.value.value, end.value.value).map(formatBlock),
  };
}

/** Reads `10.0.0.0/22`, `10.0.0.0 - 10.0.3.255` or `2001:db8:: to 2001:db8::ff`. */
export function run(input: Input): Result {
  const text = input.text.trim();
  if (text === "") return { ok: false, error: MESSAGES.empty };
  if (text.length > MAX_CHARS) return { ok: false, error: MESSAGES.tooLong };
  const block = /^(\S+?)\s*\/\s*(\S*)$/.exec(text);
  if (block) return cidr(block[1] ?? "", block[2] ?? "");
  const pair =
    /^(\S+)\s*(?:\s-\s|\s+to\s+|–|—|,)\s*(\S+)$/i.exec(text) ?? /^([^\s-]+)-([^\s-]+)$/.exec(text);
  if (pair) return range(pair[1] ?? "", pair[2] ?? "");
  if (!/\s/.test(text)) return cidr(text, text.includes(":") ? "128" : "32");
  return { ok: false, error: MESSAGES.unreadable };
}

/** 4294967296 becomes "4,294,967,296"; works for 128-bit counts. */
export function formatCount(count: bigint): string {
  return count.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

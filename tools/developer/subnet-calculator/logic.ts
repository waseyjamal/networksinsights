// Pure logic of "Subnet Calculator": reads an IPv4 address with a prefix or a dotted mask and works
// out its subnet. No DOM, no network, no top-level statements (docs/tool-contract.md). Addresses
// are unsigned 32-bit numbers; `>>> 0` keeps every bit operation unsigned.

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  text: string;
}

/** Longest input read, in characters. */
export const MAX_CHARS = 100;

export const MESSAGES = {
  empty: "Type an IPv4 address with a prefix, such as 192.168.1.10/24.",
  tooLong: `Type at most ${MAX_CHARS} characters.`,
  noPrefix:
    "Add a prefix or a mask after the address, such as 192.168.1.10/24 or 192.168.1.10 255.255.255.0.",
  badAddress: (text: string) =>
    `"${text}" is not an IPv4 address. Write four numbers from 0 to 255 joined by dots.`,
  leadingZero: (text: string) =>
    `"${text}" has a leading zero. Some systems read 010 as octal (8), others as decimal (10), so the tool refuses it rather than guess.`,
  badPrefix: (text: string) =>
    `"${text}" is not a prefix. Write a number from 0 to 32, such as /24.`,
  badMask: (text: string) =>
    `"${text}" is not a subnet mask. A mask is ones followed by zeros, such as 255.255.255.0.`,
} as const;

export type Octets = { ok: true; value: number } | { ok: false; error: string };

/** A dotted IPv4 address as a number. Leading zeros are refused: `010` is octal to some programs. */
export function parseIpv4(text: string): Octets {
  const parts = text.split(".");
  if (parts.length !== 4) return { ok: false, error: MESSAGES.badAddress(text) };
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return { ok: false, error: MESSAGES.badAddress(text) };
    if (part.length > 1 && part.startsWith("0")) {
      return { ok: false, error: MESSAGES.leadingZero(text) };
    }
    const octet = Number(part);
    if (octet > 255) return { ok: false, error: MESSAGES.badAddress(text) };
    value = value * 256 + octet;
  }
  return { ok: true, value };
}

export function formatIpv4(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

/** The mask of a prefix length: /24 is 255.255.255.0, /0 is 0.0.0.0. */
export function maskOf(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

/** The prefix length of a mask, or null when its ones are not all on the left. */
export function prefixOfMask(mask: number): number | null {
  for (let prefix = 0; prefix <= 32; prefix++) if (maskOf(prefix) === mask) return prefix;
  return null;
}

export interface Subnet {
  address: string;
  prefix: number;
  mask: string;
  wildcard: string;
  network: string;
  /** Null for /31 and /32, which have no broadcast address. */
  broadcast: string | null;
  firstHost: string;
  lastHost: string;
  totalAddresses: number;
  usableHosts: number;
  /** The mask written as 32 binary digits in four groups. */
  binaryMask: string;
  /** A short note for /31 and /32. */
  note: string | null;
}

export type Result = { ok: true; subnet: Subnet } | { ok: false; error: string };

/** Everything about the subnet of `address` with `prefix` bits of network. */
export function subnetOf(address: number, prefix: number): Subnet {
  const mask = maskOf(prefix);
  const network = (address & mask) >>> 0;
  const wildcard = ~mask >>> 0;
  const last = (network | wildcard) >>> 0;
  const totalAddresses = 2 ** (32 - prefix);
  const base = {
    address: formatIpv4(address),
    prefix,
    mask: formatIpv4(mask),
    wildcard: formatIpv4(wildcard),
    network: formatIpv4(network),
    totalAddresses,
    binaryMask: (mask.toString(2).padStart(32, "0").match(/.{8}/g) ?? []).join("."),
  };
  if (prefix === 32) {
    return {
      ...base,
      broadcast: null,
      firstHost: formatIpv4(network),
      lastHost: formatIpv4(network),
      usableHosts: 1,
      note: "A /32 is one address: a single host route.",
    };
  }
  if (prefix === 31) {
    return {
      ...base,
      broadcast: null,
      firstHost: formatIpv4(network),
      lastHost: formatIpv4(last),
      usableHosts: 2,
      note: "A /31 is a point-to-point link: both addresses are usable and there is no broadcast (RFC 3021).",
    };
  }
  return {
    ...base,
    broadcast: formatIpv4(last),
    firstHost: formatIpv4(network + 1),
    lastHost: formatIpv4(last - 1),
    usableHosts: totalAddresses - 2,
    note: null,
  };
}

/** Reads `10.0.0.1/8`, `10.0.0.1 /8` or `10.0.0.1 255.0.0.0`. */
export function run(input: Input): Result {
  const text = input.text.trim();
  if (text === "") return { ok: false, error: MESSAGES.empty };
  if (text.length > MAX_CHARS) return { ok: false, error: MESSAGES.tooLong };
  const match = /^([^\s/]+)\s*(?:\/\s*(\S*)|\s+(\S+))?$/.exec(text);
  const addressText = match?.[1] ?? text;
  const address = parseIpv4(addressText);
  if (!address.ok) return address;
  const prefixText = match?.[2];
  const maskText = match?.[3];
  let prefix: number | null = null;
  if (typeof prefixText === "string") {
    if (!/^\d{1,2}$/.test(prefixText) || Number(prefixText) > 32) {
      return { ok: false, error: MESSAGES.badPrefix(`/${prefixText}`) };
    }
    prefix = Number(prefixText);
  } else if (typeof maskText === "string") {
    if (/^\d{1,2}$/.test(maskText) && Number(maskText) <= 32) prefix = Number(maskText);
    else {
      const mask = parseIpv4(maskText);
      if (!mask.ok) return mask;
      prefix = prefixOfMask(mask.value);
      if (prefix === null) return { ok: false, error: MESSAGES.badMask(maskText) };
    }
  } else return { ok: false, error: MESSAGES.noPrefix };
  return { ok: true, subnet: subnetOf(address.value, prefix) };
}

/** 4294967296 becomes "4,294,967,296". */
export function formatCount(count: number): string {
  return count.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

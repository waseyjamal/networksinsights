// Pure logic of "VLSM Calculator": splits one IPv4 network into subnets sized for the hosts each one
// needs, largest first, packed from the start of the network. Each subnet is the smallest block
// whose usable hosts (size minus network and broadcast) hold the need, so the smallest is a /30.
// Sorted largest first, every block starts on a multiple of its own size, so none overlap.
// No DOM, no network, no top-level statements (docs/tool-contract.md).

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  network: string;
  needs: string;
}

export const MAX_SUBNETS = 256;
export const MAX_CHARS = 10_000;

export const MESSAGES = {
  noNetwork: "Type the network to split, such as 192.168.1.0/24.",
  badNetwork:
    "Type the network as an IPv4 address and a prefix from 0 to 30, such as 192.168.1.0/24.",
  badAddress: (text: string) =>
    `"${text}" is not an IPv4 address. Write four numbers from 0 to 255 joined by dots.`,
  leadingZero: (text: string) =>
    `"${text}" has a leading zero. Some programs read 010 as octal, so it is refused.`,
  noNeeds: "Add at least one subnet: a host count on each line, with a name before it if you like.",
  tooMany: `Add at most ${MAX_SUBNETS} subnets.`,
  tooLong: "The list is too long.",
  badLine: (line: string) =>
    `"${line}" is not a subnet. Write a host count, or a name and a host count, such as Sales 50.`,
  zeroHosts: (name: string) => `${name} needs at least 1 host.`,
  tooBig: (name: string, hosts: number) =>
    `${name} needs ${hosts} hosts, more than any IPv4 subnet can hold.`,
  noRoom: (name: string, network: string) =>
    `${name} does not fit: ${network} has no room left for it. Use a larger network or fewer hosts.`,
} as const;

export interface Need {
  name: string;
  hosts: number;
}

export interface Allocation {
  name: string;
  hostsNeeded: number;
  hostsAvailable: number;
  network: string;
  prefix: number;
  mask: string;
  firstHost: string;
  lastHost: string;
  broadcast: string;
}

export type Result =
  | {
      ok: true;
      network: string;
      /** The network as typed when it was not the start of its block. */
      hostBitsSet: string | null;
      subnets: Allocation[];
      /** Addresses of the network still free after the last subnet. */
      freeAddresses: number;
      freeFrom: string | null;
    }
  | { ok: false; error: string };

type Parsed = { ok: true; value: number } | { ok: false; error: string };

export function parseIpv4(text: string): Parsed {
  const parts = text.split(".");
  if (parts.length !== 4) return { ok: false, error: MESSAGES.badAddress(text) };
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) {
      return { ok: false, error: MESSAGES.badAddress(text) };
    }
    if (part.length > 1 && part.startsWith("0"))
      return { ok: false, error: MESSAGES.leadingZero(text) };
    value = value * 256 + Number(part);
  }
  return { ok: true, value };
}

export function formatIpv4(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

const maskOf = (prefix: number) => (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);

/** The longest prefix whose subnet has at least `hosts` usable hosts; /30 at most. */
export function prefixFor(hosts: number): number {
  let bits = 2;
  while (2 ** bits - 2 < hosts) bits++;
  return 32 - bits;
}

/** Lines such as `50`, `Sales 50`, `Sales: 50` or `Sales, 50`. Unnamed lines become Subnet N. */
export function parseNeeds(
  text: string,
): { ok: true; needs: Need[] } | { ok: false; error: string } {
  if (text.length > MAX_CHARS) return { ok: false, error: MESSAGES.tooLong };
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length === 0) return { ok: false, error: MESSAGES.noNeeds };
  if (lines.length > MAX_SUBNETS) return { ok: false, error: MESSAGES.tooMany };
  const needs: Need[] = [];
  for (const [index, line] of lines.entries()) {
    const match = /^(?:(.*?)[\s:,=]+)?(\d{1,10})$/.exec(line);
    if (!match) return { ok: false, error: MESSAGES.badLine(line) };
    const name = match[1]?.trim() || `Subnet ${index + 1}`;
    const hosts = Number(match[2]);
    if (hosts < 1) return { ok: false, error: MESSAGES.zeroHosts(name) };
    if (hosts > 2 ** 32 - 2) return { ok: false, error: MESSAGES.tooBig(name, hosts) };
    needs.push({ name, hosts });
  }
  return { ok: true, needs };
}

export function run(input: Input): Result {
  const networkText = input.network.trim();
  if (networkText === "") return { ok: false, error: MESSAGES.noNetwork };
  const match = /^([^\s/]+)\s*\/\s*(\d{1,2})$/.exec(networkText);
  if (!match) return { ok: false, error: MESSAGES.badNetwork };
  const address = parseIpv4(match[1] ?? "");
  if (!address.ok) return address;
  const prefix = Number(match[2]);
  if (prefix > 30) return { ok: false, error: MESSAGES.badNetwork };
  const parsed = parseNeeds(input.needs);
  if (!parsed.ok) return parsed;

  const base = (address.value & maskOf(prefix)) >>> 0;
  const end = base + 2 ** (32 - prefix);
  const label = `${formatIpv4(base)}/${prefix}`;
  // Largest first; equal needs keep the order they were typed in (sort is stable).
  const ordered = [...parsed.needs].sort((a, b) => b.hosts - a.hosts);
  const subnets: Allocation[] = [];
  let at = base;
  for (const need of ordered) {
    const subnetPrefix = prefixFor(need.hosts);
    const size = 2 ** (32 - subnetPrefix);
    if (subnetPrefix < prefix || at + size > end) {
      return { ok: false, error: MESSAGES.noRoom(need.name, label) };
    }
    subnets.push({
      name: need.name,
      hostsNeeded: need.hosts,
      hostsAvailable: size - 2,
      network: formatIpv4(at),
      prefix: subnetPrefix,
      mask: formatIpv4(maskOf(subnetPrefix)),
      firstHost: formatIpv4(at + 1),
      lastHost: formatIpv4(at + size - 2),
      broadcast: formatIpv4(at + size - 1),
    });
    at += size;
  }
  return {
    ok: true,
    network: label,
    hostBitsSet: base === address.value ? null : networkText,
    subnets,
    freeAddresses: end - at,
    freeFrom: at < end ? formatIpv4(at) : null,
  };
}

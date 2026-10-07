import { describe, expect, it } from "vitest";
import { formatCount, MESSAGES, maskOf, parseIpv4, prefixOfMask, run } from "./logic";

const subnet = (text: string) => {
  const result = run({ text });
  if (!result.ok) throw new Error(result.error);
  return result.subnet;
};

describe("textbook subnets", () => {
  it("192.168.1.10/24", () => {
    expect(subnet("192.168.1.10/24")).toMatchObject({
      network: "192.168.1.0",
      broadcast: "192.168.1.255",
      mask: "255.255.255.0",
      wildcard: "0.0.0.255",
      firstHost: "192.168.1.1",
      lastHost: "192.168.1.254",
      totalAddresses: 256,
      usableHosts: 254,
      binaryMask: "11111111.11111111.11111111.00000000",
    });
  });

  it("172.16.35.123/20", () => {
    expect(subnet("172.16.35.123/20")).toMatchObject({
      network: "172.16.32.0",
      broadcast: "172.16.47.255",
      mask: "255.255.240.0",
      wildcard: "0.0.15.255",
      firstHost: "172.16.32.1",
      lastHost: "172.16.47.254",
      usableHosts: 4094,
    });
  });

  it("10.0.0.130/26 and the /30 of a link", () => {
    expect(subnet("10.0.0.130/26")).toMatchObject({
      network: "10.0.0.128",
      broadcast: "10.0.0.191",
      usableHosts: 62,
    });
    expect(subnet("10.1.1.6/30")).toMatchObject({
      network: "10.1.1.4",
      broadcast: "10.1.1.7",
      firstHost: "10.1.1.5",
      lastHost: "10.1.1.6",
      usableHosts: 2,
    });
  });

  it("takes a dotted mask or a spaced prefix", () => {
    expect(subnet("192.168.1.10 255.255.255.0")).toMatchObject({ prefix: 24 });
    expect(subnet("192.168.1.10 /24")).toMatchObject({ prefix: 24 });
    expect(subnet("192.168.1.10 24")).toMatchObject({ prefix: 24 });
  });
});

describe("edges", () => {
  it("/0 is every address", () => {
    expect(subnet("8.8.8.8/0")).toMatchObject({
      network: "0.0.0.0",
      broadcast: "255.255.255.255",
      mask: "0.0.0.0",
      wildcard: "255.255.255.255",
      totalAddresses: 4294967296,
      usableHosts: 4294967294,
    });
  });

  it("/31 has two usable addresses and no broadcast (RFC 3021)", () => {
    const s = subnet("10.0.0.1/31");
    expect(s).toMatchObject({
      network: "10.0.0.0",
      broadcast: null,
      firstHost: "10.0.0.0",
      lastHost: "10.0.0.1",
      totalAddresses: 2,
      usableHosts: 2,
    });
    expect(s.note).toContain("RFC 3021");
  });

  it("/32 is one host", () => {
    expect(subnet("203.0.113.9/32")).toMatchObject({
      network: "203.0.113.9",
      broadcast: null,
      firstHost: "203.0.113.9",
      lastHost: "203.0.113.9",
      mask: "255.255.255.255",
      wildcard: "0.0.0.0",
      totalAddresses: 1,
      usableHosts: 1,
    });
  });

  it("255.255.255.255/24", () => {
    expect(subnet("255.255.255.255/24")).toMatchObject({
      network: "255.255.255.0",
      broadcast: "255.255.255.255",
    });
  });
});

describe("invalid input", () => {
  it.each([
    ["", MESSAGES.empty],
    ["   ", MESSAGES.empty],
    ["192.168.1.10", MESSAGES.noPrefix],
    ["192.168.1/24", MESSAGES.badAddress("192.168.1")],
    ["192.168.1.256/24", MESSAGES.badAddress("192.168.1.256")],
    ["192.168.1.-1/24", MESSAGES.badAddress("192.168.1.-1")],
    ["a.b.c.d/24", MESSAGES.badAddress("a.b.c.d")],
    ["192.168.1.1/33", MESSAGES.badPrefix("/33")],
    ["192.168.1.1/", MESSAGES.badPrefix("/")],
    ["192.168.1.1/2a", MESSAGES.badPrefix("/2a")],
    ["192.168.1.1 255.0.255.0", MESSAGES.badMask("255.0.255.0")],
    ["::1/128", MESSAGES.badAddress("::1")],
  ])("%j is refused", (text, error) => {
    expect(run({ text })).toEqual({ ok: false, error });
  });

  it("refuses leading zeros in the address and the mask", () => {
    expect(run({ text: "010.0.0.1/8" })).toEqual({
      ok: false,
      error: MESSAGES.leadingZero("010.0.0.1"),
    });
    expect(run({ text: "10.0.0.01/8" })).toEqual({
      ok: false,
      error: MESSAGES.leadingZero("10.0.0.01"),
    });
    expect(run({ text: "10.0.0.1 255.255.255.000" })).toEqual({
      ok: false,
      error: MESSAGES.leadingZero("255.255.255.000"),
    });
    expect(parseIpv4("0.0.0.0")).toEqual({ ok: true, value: 0 });
  });

  it("refuses more than the limit", () => {
    expect(run({ text: `1.1.1.1/24${" ".repeat(100)}x` })).toEqual({
      ok: false,
      error: MESSAGES.tooLong,
    });
  });
});

describe("helpers", () => {
  it("masks and prefixes", () => {
    expect(maskOf(0)).toBe(0);
    expect(maskOf(1)).toBe(0x80000000);
    expect(maskOf(32)).toBe(0xffffffff);
    expect(prefixOfMask(0xfffffffc)).toBe(30);
    expect(prefixOfMask(0xff00ff00)).toBeNull();
  });

  it("formats counts", () => {
    expect(formatCount(4294967296)).toBe("4,294,967,296");
    expect(formatCount(2)).toBe("2");
  });
});

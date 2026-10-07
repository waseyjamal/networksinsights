import { describe, expect, it } from "vitest";
import { formatAddress, formatCount, MESSAGES, parseAddress, run } from "./logic";

const ok = (text: string) => {
  const result = run({ text });
  if (!result.ok) throw new Error(result.error);
  return result;
};

describe("CIDR block to range, IPv4", () => {
  it("10.0.0.0/22", () => {
    expect(ok("10.0.0.0/22")).toMatchObject({
      kind: "cidr",
      first: "10.0.0.0",
      last: "10.0.3.255",
      count: BigInt(1024),
      mask: "255.255.252.0",
      hostBitsSet: null,
    });
  });

  it("an address inside the block names the block and says so", () => {
    expect(ok("192.168.1.130/25")).toMatchObject({
      first: "192.168.1.128",
      last: "192.168.1.255",
      count: BigInt(128),
      hostBitsSet: "192.168.1.130",
    });
  });

  it("/0, /31 and /32", () => {
    expect(ok("0.0.0.0/0")).toMatchObject({
      first: "0.0.0.0",
      last: "255.255.255.255",
      count: BigInt(4294967296),
      mask: "0.0.0.0",
    });
    expect(ok("10.0.0.1/31")).toMatchObject({
      first: "10.0.0.0",
      last: "10.0.0.1",
      count: BigInt(2),
    });
    expect(ok("10.0.0.1/32")).toMatchObject({
      first: "10.0.0.1",
      last: "10.0.0.1",
      count: BigInt(1),
    });
    expect(ok("10.0.0.1")).toMatchObject({ kind: "cidr", count: BigInt(1) });
  });
});

describe("CIDR block to range, IPv6", () => {
  it("2001:db8::/32", () => {
    expect(ok("2001:db8::/32")).toMatchObject({
      first: "2001:db8::",
      last: "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff",
      count: BigInt(2) ** BigInt(96),
      mask: null,
    });
  });

  it("::/0 is every address, ::1/128 is one", () => {
    expect(ok("::/0")).toMatchObject({
      first: "::",
      last: "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
      count: BigInt(2) ** BigInt(128),
    });
    expect(ok("::1/128")).toMatchObject({ first: "::1", last: "::1", count: BigInt(1) });
  });

  it("fe80::1:2/64 with :: in the middle", () => {
    expect(ok("fe80::1:2/64")).toMatchObject({
      first: "fe80::",
      last: "fe80::ffff:ffff:ffff:ffff",
      hostBitsSet: "fe80::1:2",
    });
  });

  it("an IPv6 /127 and a block ending in ::", () => {
    expect(ok("2001:db8::/127")).toMatchObject({ first: "2001:db8::", last: "2001:db8::1" });
    expect(ok("2001:db8:0:1::/64")).toMatchObject({ last: "2001:db8:0:1:ffff:ffff:ffff:ffff" });
  });
});

describe("range to CIDR blocks", () => {
  it("a range that is exactly one block", () => {
    expect(ok("10.0.0.0 - 10.0.3.255")).toMatchObject({
      kind: "range",
      count: BigInt(1024),
      blocks: ["10.0.0.0/22"],
    });
    expect(ok("0.0.0.0-255.255.255.255")).toMatchObject({ blocks: ["0.0.0.0/0"] });
  });

  it("an unaligned IPv4 range needs several blocks", () => {
    expect(ok("192.168.0.5 - 192.168.0.20")).toMatchObject({
      count: BigInt(16),
      blocks: [
        "192.168.0.5/32",
        "192.168.0.6/31",
        "192.168.0.8/29",
        "192.168.0.16/30",
        "192.168.0.20/32",
      ],
    });
    expect(ok("10.0.0.1 to 10.0.0.6")).toMatchObject({
      blocks: ["10.0.0.1/32", "10.0.0.2/31", "10.0.0.4/31", "10.0.0.6/32"],
    });
  });

  it("the worst IPv4 range needs 62 blocks", () => {
    const result = ok("0.0.0.1 - 255.255.255.254");
    if (result.kind !== "range") throw new Error("not a range");
    expect(result.blocks).toHaveLength(62);
    expect(result.blocks[0]).toBe("0.0.0.1/32");
    expect(result.blocks[61]).toBe("255.255.255.254/32");
  });

  it("a single address is one /32", () => {
    expect(ok("10.0.0.7 - 10.0.0.7")).toMatchObject({ blocks: ["10.0.0.7/32"], count: BigInt(1) });
  });

  it("an unaligned IPv6 range", () => {
    expect(ok("2001:db8::1 - 2001:db8::ff")).toMatchObject({
      count: BigInt(255),
      blocks: [
        "2001:db8::1/128",
        "2001:db8::2/127",
        "2001:db8::4/126",
        "2001:db8::8/125",
        "2001:db8::10/124",
        "2001:db8::20/123",
        "2001:db8::40/122",
        "2001:db8::80/121",
      ],
    });
  });

  it("the whole IPv6 space and the worst IPv6 range", () => {
    expect(ok(":: - ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff")).toMatchObject({ blocks: ["::/0"] });
    const worst = ok("::1 - ffff:ffff:ffff:ffff:ffff:ffff:ffff:fffe");
    if (worst.kind !== "range") throw new Error("not a range");
    expect(worst.blocks).toHaveLength(254);
  });
});

describe("parsing IPv6", () => {
  it.each([
    ["::", "::"],
    ["::1", "::1"],
    ["1::", "1::"],
    ["2001:db8::8:800:200c:417a", "2001:db8::8:800:200c:417a"],
    ["2001:0DB8:0000:0000:0000:0000:0000:0001", "2001:db8::1"],
    ["::ffff:192.0.2.1", "::ffff:192.0.2.1"],
    ["1:2:3:4:5:6:7::", "1:2:3:4:5:6:7:0"],
  ])("%s reads as %s", (text, short) => {
    const parsed = parseAddress(text);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(formatAddress(parsed.value)).toBe(short);
  });

  it.each([
    "1::2::3",
    ":::",
    "1:2:3:4:5:6:7:8:9",
    "1:2:3:4:5:6:7",
    "1:2:3:4:5:6:7:8::",
    "12345::",
    "g::1",
    "1.2.3.4::",
  ])("%s is refused", (text) => {
    expect(parseAddress(text)).toEqual({ ok: false, error: MESSAGES.badAddress(text) });
  });
});

describe("invalid input", () => {
  it.each([
    ["", MESSAGES.empty],
    ["10.0.0.0/33", MESSAGES.badPrefix("/33", 4)],
    ["2001:db8::/129", MESSAGES.badPrefix("/129", 6)],
    ["10.0.0.0/", MESSAGES.badPrefix("/", 4)],
    ["010.0.0.0/8", MESSAGES.leadingZero("010.0.0.0")],
    ["10.0.0.256/8", MESSAGES.badAddress("10.0.0.256")],
    ["fe80::1%eth0/64", MESSAGES.zone("fe80::1%eth0")],
    ["10.0.0.0 - ::1", MESSAGES.mixed],
    ["10.0.0.9 - 10.0.0.1", MESSAGES.backwards],
    ["10.0.0.0 and 10.0.0.9", MESSAGES.unreadable],
  ])("%j is refused", (text, error) => {
    expect(run({ text })).toEqual({ ok: false, error });
  });

  it("refuses more than the limit", () => {
    expect(run({ text: "1".repeat(201) })).toEqual({ ok: false, error: MESSAGES.tooLong });
  });
});

it("formats 128-bit counts", () => {
  expect(formatCount(BigInt(2) ** BigInt(128))).toBe(
    "340,282,366,920,938,463,463,374,607,431,768,211,456",
  );
});

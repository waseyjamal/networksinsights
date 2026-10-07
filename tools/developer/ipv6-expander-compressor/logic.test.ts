import { describe, expect, it } from "vitest";
import { compress, expand, MESSAGES, parseIpv6, run } from "./logic";

const value = (text: string) => {
  const parsed = parseIpv6(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
};
const short = (text: string) => compress(value(text));

describe("expanding", () => {
  it.each([
    ["::", "0000:0000:0000:0000:0000:0000:0000:0000"],
    ["::1", "0000:0000:0000:0000:0000:0000:0000:0001"],
    ["1::", "0001:0000:0000:0000:0000:0000:0000:0000"],
    ["2001:db8::1", "2001:0db8:0000:0000:0000:0000:0000:0001"],
    ["fe80::1:2:3", "fe80:0000:0000:0000:0000:0001:0002:0003"],
    ["2001:DB8:0:0:8:800:200C:417A", "2001:0db8:0000:0000:0008:0800:200c:417a"],
    ["::ffff:192.0.2.128", "0000:0000:0000:0000:0000:ffff:c000:0280"],
    ["1:2:3:4:5:6:7::", "0001:0002:0003:0004:0005:0006:0007:0000"],
  ])("%s expands to %s", (text, full) => {
    expect(expand(value(text))).toBe(full);
  });
});

describe("compressing to RFC 5952", () => {
  it("drops leading zeros and writes lowercase (4.1, 4.3)", () => {
    expect(short("2001:0DB8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8::1");
    expect(short("2001:0db8:0aBc:0000:0000:0000:0000:0001")).toBe("2001:db8:abc::1");
  });

  it('uses "::" with "::" at the start, middle and end', () => {
    expect(short("0:0:0:0:0:0:0:1")).toBe("::1");
    expect(short("0:0:0:0:0:0:0:0")).toBe("::");
    expect(short("2001:db8:0:0:0:0:0:0")).toBe("2001:db8::");
    expect(short("2001:db8:0:0:0:0:2:1")).toBe("2001:db8::2:1");
  });

  it("shortens the longest run of zeros (4.2.3)", () => {
    expect(short("2001:0:0:1:0:0:0:1")).toBe("2001:0:0:1::1");
    expect(short("2001:db8:0:0:1:0:0:0")).toBe("2001:db8:0:0:1::");
  });

  it("shortens the leftmost run on a tie (4.2.3)", () => {
    expect(short("2001:db8:0:0:1:0:0:1")).toBe("2001:db8::1:0:0:1");
    expect(short("0:0:1:0:0:1:0:0")).toBe("::1:0:0:1:0:0");
  });

  it('never uses "::" for a single zero group (4.2.2)', () => {
    expect(short("2001:db8:0:1:1:1:1:1")).toBe("2001:db8:0:1:1:1:1:1");
    expect(short("2001:db8::1:1:1:1:1")).toBe("2001:db8:0:1:1:1:1:1");
    expect(short("1:2:3:4:5:6:7::")).toBe("1:2:3:4:5:6:7:0");
    expect(short("::2:3:4:5:6:7:8")).toBe("0:2:3:4:5:6:7:8");
  });

  it("writes an IPv4-mapped address with a dotted tail (section 5)", () => {
    expect(short("0:0:0:0:0:ffff:c000:0280")).toBe("::ffff:192.0.2.128");
    expect(short("::ffff:192.0.2.128")).toBe("::ffff:192.0.2.128");
  });

  it("a full address with no zeros stays as it is", () => {
    expect(short("ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff")).toBe(
      "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    );
  });
});

describe("invalid input", () => {
  it.each([
    ["1::2::3", MESSAGES.twoGaps],
    [":::", MESSAGES.groups],
    ["1:2:3:4:5:6:7", MESSAGES.groups],
    ["1:2:3:4:5:6:7:8:9", MESSAGES.groups],
    ["1:2:3:4:5:6:7:8::", MESSAGES.groups],
    ["12345::1", MESSAGES.groups],
    ["2001:db8:::1", MESSAGES.groups],
    ["g::1", MESSAGES.bad],
    ["192.168.1.1", MESSAGES.bad],
    ["fe80::1%eth0", MESSAGES.zone],
    ["2001:db8::/32", MESSAGES.prefix],
    ["::ffff:192.0.2.256", MESSAGES.ipv4],
    ["::ffff:192.0.02.1", MESSAGES.ipv4],
    ["1.2.3.4::", MESSAGES.ipv4],
  ])("%s is refused", (text, error) => {
    expect(parseIpv6(text)).toEqual({ ok: false, error });
  });
});

describe("run", () => {
  it("reads one address per line and marks the canonical ones", () => {
    const result = run({ text: "2001:db8::1\n\n  2001:0DB8::0001 \nnot-an-address" });
    expect(result).toEqual({
      ok: true,
      rows: [
        {
          input: "2001:db8::1",
          ok: true,
          expanded: "2001:0db8:0000:0000:0000:0000:0000:0001",
          compressed: "2001:db8::1",
          canonical: true,
        },
        {
          input: "2001:0DB8::0001",
          ok: true,
          expanded: "2001:0db8:0000:0000:0000:0000:0000:0001",
          compressed: "2001:db8::1",
          canonical: false,
        },
        { input: "not-an-address", ok: false, error: MESSAGES.bad },
      ],
    });
  });

  it("refuses empty input and too much input", () => {
    expect(run({ text: " \n " })).toEqual({ ok: false, error: MESSAGES.empty });
    expect(run({ text: "::1\n".repeat(501) })).toEqual({ ok: false, error: MESSAGES.tooManyLines });
    expect(run({ text: "a".repeat(30_001) })).toEqual({ ok: false, error: MESSAGES.tooLong });
  });
});

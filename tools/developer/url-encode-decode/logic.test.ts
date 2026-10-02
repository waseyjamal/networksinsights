import { describe, expect, it } from "vitest";
import {
  explainBadPercent,
  type Input,
  KEPT_BY_COMPONENT,
  KEPT_BY_URL,
  KEPT_ENCODED_BY_URL_DECODE,
  MAX_LENGTH,
  run,
} from "./logic";

const go = (mode: Input["mode"], scope: Input["scope"], text: string) => run({ mode, scope, text });
const out = (mode: Input["mode"], scope: Input["scope"], text: string) => {
  const result = go(mode, scope, text);
  if (!result.ok) throw new Error(result.error);
  return result.output;
};

const ASCII = Array.from({ length: 128 }, (_, code) => String.fromCharCode(code));

describe("encode", () => {
  it("answers the examples of its page", () => {
    expect(out("encode", "url", "https://example.com/search?q=café & tea")).toBe(
      "https://example.com/search?q=caf%C3%A9%20&%20tea",
    );
    expect(out("encode", "component", "café & tea")).toBe("caf%C3%A9%20%26%20tea");
  });

  it("encodes a space as %20 and never as +", () => {
    expect(out("encode", "url", "a b+c")).toBe("a%20b+c");
    expect(out("encode", "component", "a b+c")).toBe("a%20b%2Bc");
  });

  it("encodes a character outside the BMP as four UTF-8 bytes", () => {
    expect(out("encode", "component", "😀")).toBe("%F0%9F%98%80");
    expect(out("encode", "url", "日本")).toBe("%E6%97%A5%E6%9C%AC");
  });

  it("encodes the percent sign itself, so an encoded text is encoded twice", () => {
    expect(out("encode", "url", "100%")).toBe("100%25");
    expect(out("encode", "url", "a%20b")).toBe("a%2520b");
  });

  it("leaves exactly the characters the page lists, besides letters and digits", () => {
    const kept = (scope: "url" | "component") =>
      ASCII.filter((ch) => !/[A-Za-z0-9]/.test(ch) && out("encode", scope, ch) === ch).join(" ");
    expect(kept("url")).toBe(
      [...KEPT_BY_URL.split(" ")].sort((a, b) => a.charCodeAt(0) - b.charCodeAt(0)).join(" "),
    );
    expect(kept("component")).toBe(
      [...KEPT_BY_COMPONENT.split(" ")].sort((a, b) => a.charCodeAt(0) - b.charCodeAt(0)).join(" "),
    );
  });

  it("returns an empty text for an empty text", () => {
    expect(go("encode", "url", "")).toEqual({ ok: true, output: "" });
    expect(go("decode", "component", "")).toEqual({ ok: true, output: "" });
  });

  it("refuses a lone surrogate, with its position", () => {
    const result = go("encode", "component", "ab\ud800c");
    expect(result).toEqual({
      ok: false,
      error:
        "The character at position 3 is half of a pair (a lone surrogate) and cannot be encoded as UTF-8.",
    });
    expect(go("encode", "url", "\udc00").ok).toBe(false);
    expect(go("encode", "url", "😀").ok).toBe(true);
  });
});

describe("decode", () => {
  it("answers the examples of its page", () => {
    expect(out("decode", "component", "caf%C3%A9%20%26%20tea")).toBe("café & tea");
    expect(out("decode", "url", "caf%C3%A9%20%26%20tea")).toBe("café %26 tea");
  });

  it("accepts lowercase hex and leaves + alone", () => {
    expect(out("decode", "component", "%e2%82%ac+1")).toBe("€+1");
  });

  it("leaves the reserved characters encoded when decoding a whole URL, and only then", () => {
    for (const ch of KEPT_ENCODED_BY_URL_DECODE.split(" ")) {
      const encoded = encodeURIComponent(ch);
      expect(out("decode", "url", encoded), ch).toBe(encoded);
      expect(out("decode", "component", encoded), ch).toBe(ch);
    }
  });

  it("is the inverse of encode for every scope", () => {
    const samples = ["plain", "a b&c=d/e?f#g", "日本語 😀", "100% sure", "~!*'()-_."];
    for (const text of samples) {
      expect(out("decode", "component", out("encode", "component", text))).toBe(text);
      expect(out("decode", "url", out("encode", "url", text))).toBe(text);
    }
  });
});

describe("bad percent sequences", () => {
  it("names a percent sign without two hex digits", () => {
    expect(go("decode", "component", "50% off")).toEqual({
      ok: false,
      error:
        'The "%" at character 3 is not followed by two hexadecimal digits (found "% o"). A percent sign must be written as %25 to stay a percent sign.',
    });
    expect(go("decode", "url", "%zz").ok).toBe(false);
    expect(go("decode", "url", "abc%").ok).toBe(false);
    expect(go("decode", "url", "abc%4").ok).toBe(false);
  });

  it("names bytes that are not valid UTF-8", () => {
    expect(go("decode", "component", "ok%E0%A4%A")).toMatchObject({ ok: false });
    expect(go("decode", "component", "x%FFy")).toEqual({
      ok: false,
      error:
        'The percent sequences starting at character 2 ("%FF") are not valid UTF-8, so they do not stand for any text.',
    });
    expect(go("decode", "url", "%C3").ok).toBe(false);
  });

  it("shortens a long sequence in the message", () => {
    const result = go("decode", "component", "%FF".repeat(20));
    expect(!result.ok && result.error).toContain("...");
  });

  it("counts a character outside the BMP once", () => {
    const result = go("decode", "component", "😀%zz");
    expect(!result.ok && result.error).toContain("character 2");
  });

  it("finds nothing wrong with good sequences", () => {
    expect(explainBadPercent("a%20b%F0%9F%98%80")).toBeNull();
    expect(explainBadPercent("")).toBeNull();
  });
});

describe("limit", () => {
  it("accepts the limit and refuses one character more", () => {
    expect(go("encode", "component", "a".repeat(MAX_LENGTH)).ok).toBe(true);
    expect(go("encode", "component", "a".repeat(MAX_LENGTH + 1))).toEqual({
      ok: false,
      error: "The text has 1,000,001 characters; the limit is 1,000,000.",
    });
  });
});

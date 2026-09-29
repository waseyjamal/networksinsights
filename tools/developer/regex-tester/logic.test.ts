import { describe, expect, it } from "vitest";
import {
  checkFlags,
  groupNames,
  MAX_MATCHES,
  MAX_PATTERN_CHARS,
  MAX_TEXT_CHARS,
  type Matched,
  run,
  segmentsOf,
} from "./logic";

function matched(pattern: string, flags: string, text: string): Matched {
  const result = run({ pattern, flags, text });
  if (!result.ok) throw new Error(`expected matches, got: ${result.error}`);
  return result;
}

function failure(pattern: string, flags: string, text: string) {
  const result = run({ pattern, flags, text });
  if (result.ok) throw new Error("expected a failure");
  return result;
}

describe("matching", () => {
  it("finds every match with the g flag, with its index and end", () => {
    const result = matched("\\d+", "g", "a1 b22 c333");
    expect(result.matches.map((m) => [m.text, m.index, m.end])).toEqual([
      ["1", 1, 2],
      ["22", 4, 6],
      ["333", 8, 11],
    ]);
    expect(result.global).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it("finds the first match only without the g flag, as JavaScript does", () => {
    const result = matched("\\d+", "", "a1 b22 c333");
    expect(result.matches.map((m) => m.text)).toEqual(["1"]);
    expect(result.global).toBe(false);
  });

  it("finds nothing, without an error, when nothing matches", () => {
    const result = matched("z", "g", "abc");
    expect(result.matches).toEqual([]);
    expect(result.segments).toEqual([{ text: "abc" }]);
  });

  it("gives an empty test string no matches and no segments", () => {
    const result = matched("a", "g", "");
    expect(result.matches).toEqual([]);
    expect(result.segments).toEqual([]);
  });

  it("gives the flags their JavaScript meaning", () => {
    expect(matched("abc", "i", "xABCx").matches[0]?.text).toBe("ABC");
    expect(matched("^b", "gm", "a\nb\nb").matches.map((m) => m.index)).toEqual([2, 4]);
    expect(matched("^b", "g", "a\nb").matches).toEqual([]);
    expect(matched("a.b", "s", "a\nb").matches[0]?.text).toBe("a\nb");
    expect(matched("a.b", "", "a\nb").matches).toEqual([]);
    expect(matched("^.$", "u", "😀").matches[0]?.text).toBe("😀");
    expect(matched("^.$", "", "😀").matches).toEqual([]);
  });

  it("accepts the flags in any order and with spaces around them", () => {
    expect(matched("a", " uigsm ", "aA").matches).toHaveLength(2);
  });

  it("counts indexes in UTF-16 code units", () => {
    expect(matched("b", "g", "😀b").matches[0]?.index).toBe(2);
  });
});

describe("capture groups", () => {
  it("lists each group by number with what it captured", () => {
    const [match] = matched("(\\w+)@(\\w+)\\.com", "", "mail ann@example.com now").matches;
    expect(match?.text).toBe("ann@example.com");
    expect(match?.groups).toEqual([
      { number: 1, name: null, value: "ann" },
      { number: 2, name: null, value: "example" },
    ]);
  });

  it("names named groups and keeps their number", () => {
    const [match] = matched("(?<year>\\d{4})-(\\d\\d)-(?<day>\\d\\d)", "", "on 2026-09-29").matches;
    expect(match?.groups).toEqual([
      { number: 1, name: "year", value: "2026" },
      { number: 2, name: null, value: "09" },
      { number: 3, name: "day", value: "29" },
    ]);
  });

  it("gives null for a group that took no part in the match", () => {
    const [match] = matched("(a)|(b)", "", "b").matches;
    expect(match?.groups).toEqual([
      { number: 1, name: null, value: null },
      { number: 2, name: null, value: "b" },
    ]);
  });

  it("tells an empty capture from a group that did not take part", () => {
    const [match] = matched("(a*)(b)?", "", "c").matches;
    expect(match?.groups.map((g) => g.value)).toEqual(["", null]);
  });

  it("does not count groups that do not capture", () => {
    const [match] = matched("(?:a)(?=b)(b)(?<!c)", "", "ab").matches;
    expect(match?.groups).toEqual([{ number: 1, name: null, value: "b" }]);
  });

  it("reads groups in every match of a global run", () => {
    const result = matched("(\\d)(\\w)", "g", "1a 2b");
    expect(result.matches.map((m) => m.groups.map((g) => g.value))).toEqual([
      ["1", "a"],
      ["2", "b"],
    ]);
  });
});

describe("groupNames", () => {
  it("counts capture groups in order and skips the ones that are not", () => {
    expect(groupNames("(a)(?<x>b)(?:c)(?=d)(?!e)(?<=f)(?<!g)(h)")).toEqual([null, "x", null]);
  });

  it("ignores parentheses that are escaped or inside a class", () => {
    expect(groupNames("\\(a\\)[(]([)])")).toEqual([null]);
    expect(groupNames("[\\]](a)")).toEqual([null]);
  });

  it("finds nothing in a pattern without groups", () => {
    expect(groupNames("a+b")).toEqual([]);
  });
});

describe("empty matches", () => {
  it("steps past an empty match instead of looping for ever", () => {
    const result = matched("x*", "g", "axb");
    expect(result.matches.map((m) => [m.index, m.text])).toEqual([
      [0, ""],
      [1, "x"],
      [2, ""],
      [3, ""],
    ]);
    expect(result.empty).toBe(3);
  });

  it("steps over a whole surrogate pair in unicode mode", () => {
    const result = matched("(?:)", "gu", "😀");
    expect(result.matches.map((m) => m.index)).toEqual([0, 2]);
    expect(matched("(?:)", "g", "😀").matches.map((m) => m.index)).toEqual([0, 1, 2]);
  });

  it("does not highlight an empty match", () => {
    expect(matched("x*", "g", "axb").segments.filter((s) => s.match !== undefined)).toEqual([
      { text: "x", match: 1 },
    ]);
  });
});

describe("segments", () => {
  it("cuts the string into plain runs and numbered matches that join back to the string", () => {
    const text = "a1 b22 c";
    const result = matched("\\d+", "g", text);
    expect(result.segments).toEqual([
      { text: "a" },
      { text: "1", match: 0 },
      { text: " b" },
      { text: "22", match: 1 },
      { text: " c" },
    ]);
    expect(result.segments.map((s) => s.text).join("")).toBe(text);
  });

  it("keeps neighbouring matches apart and covers a match at either end", () => {
    const result = matched("a", "g", "aab");
    expect(result.segments).toEqual([
      { text: "a", match: 0 },
      { text: "a", match: 1 },
      { text: "b" },
    ]);
  });

  it("leaves visitor text as it is, never as markup", () => {
    const result = matched("<b>", "g", "x <b>bold</b>");
    expect(result.segments[1]).toEqual({ text: "<b>", match: 0 });
  });

  it("works from a list of matches alone", () => {
    expect(segmentsOf("abc", [])).toEqual([{ text: "abc" }]);
  });
});

describe("errors", () => {
  it("asks for a pattern when it is empty", () => {
    const result = failure("", "g", "text");
    expect(result.reason).toBe("empty");
  });

  it("says what is wrong with an invalid pattern", () => {
    for (const pattern of ["(", "[a-", "a**", "\\", "(?<n>a)(?<n>b)", "(?<=a"]) {
      const result = failure(pattern, "g", "text");
      expect(result.reason).toBe("pattern");
      expect(result.error).toMatch(/^This is not a valid regular expression\. \S/);
    }
  });

  it("rejects a pattern that is only valid without the u flag", () => {
    expect(failure("\\-", "u", "-").reason).toBe("pattern");
    expect(matched("\\-", "", "-").matches).toHaveLength(1);
  });

  it("names a flag it does not support", () => {
    expect(failure("a", "gy", "a")).toMatchObject({
      reason: "flags",
      error: 'The flag "y" is not supported here. Use g, i, m, s or u.',
    });
    expect(failure("a", "d", "a").reason).toBe("flags");
    expect(failure("a", "g i", "a").reason).toBe("flags");
  });

  it("names a flag written twice", () => {
    expect(failure("a", "gg", "a").error).toBe(
      'The flag "g" is written twice. Each flag counts once.',
    );
  });

  it("reports a flag problem before an empty pattern", () => {
    expect(failure("", "x", "").reason).toBe("flags");
  });

  it("checkFlags accepts none and all five", () => {
    expect(checkFlags("")).toBeNull();
    expect(checkFlags("gimsu")).toBeNull();
  });
});

describe("limits", () => {
  it("stops at the match cap and says it was cut short", () => {
    const result = matched("a", "g", "a".repeat(MAX_MATCHES + 5));
    expect(result.matches).toHaveLength(MAX_MATCHES);
    expect(result.truncated).toBe(true);
  });

  it("is not cut short at exactly the cap", () => {
    const result = matched("a", "g", "a".repeat(MAX_MATCHES));
    expect(result.matches).toHaveLength(MAX_MATCHES);
    expect(result.truncated).toBe(false);
  });

  it("refuses a test string over the limit, and reads one at the limit", () => {
    expect(failure("a", "g", "b".repeat(MAX_TEXT_CHARS + 1)).reason).toBe("too-large");
    expect(matched("a", "g", "b".repeat(MAX_TEXT_CHARS)).matches).toEqual([]);
  });

  it("refuses a pattern over the limit", () => {
    expect(failure("a".repeat(MAX_PATTERN_CHARS + 1), "g", "a").reason).toBe("too-large");
    expect(matched("a".repeat(MAX_PATTERN_CHARS), "g", "a").matches).toEqual([]);
  });

  it("handles a 100 KB test string quickly", () => {
    const text = "The quick brown fox 12345 jumps over the lazy dog.\n".repeat(2000);
    expect(text.length).toBeGreaterThan(100_000);
    const start = performance.now();
    const words = matched("\\b\\w+\\b", "g", text);
    const none = matched("zzz(\\d+)", "gi", text);
    expect(words.truncated).toBe(true);
    expect(words.segments.map((s) => s.text).join("")).toBe(text);
    expect(none.matches).toEqual([]);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

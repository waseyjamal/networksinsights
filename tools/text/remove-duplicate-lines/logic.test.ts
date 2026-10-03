import { describe, expect, it } from "vitest";
import { type Input, MAX_CHARS, run } from "./logic";

const BASE: Omit<Input, "text"> = {
  ignoreCase: false,
  trim: false,
  removeEmpty: false,
  keep: "first",
  sort: "none",
};
const dedupe = (text: string, options: Partial<Input> = {}) => {
  const result = run({ ...BASE, ...options, text });
  if (!result.ok) throw new Error(result.error);
  return result;
};
const EXAMPLE = "apple\nBanana\napple\nbanana\n\ncherry";

describe("run", () => {
  it("answers the example of its page", () => {
    expect(dedupe(EXAMPLE)).toEqual({
      ok: true,
      output: "apple\nBanana\nbanana\n\ncherry",
      before: 6,
      after: 5,
      removed: 1,
    });
    expect(dedupe(EXAMPLE, { ignoreCase: true, removeEmpty: true })).toMatchObject({
      output: "apple\nBanana\ncherry",
      removed: 3,
    });
  });

  it("keeps the first or the last copy, each in its own place", () => {
    expect(dedupe("a\nb\na\nc", { keep: "first" }).output).toBe("a\nb\nc");
    expect(dedupe("a\nb\na\nc", { keep: "last" }).output).toBe("b\na\nc");
    expect(dedupe("A\na", { keep: "last", ignoreCase: true }).output).toBe("a");
  });

  it("trims spaces and tabs at both ends", () => {
    expect(dedupe(" a\na \n\ta", { trim: true }).output).toBe("a");
    expect(dedupe(" a\na ").output).toBe(" a\na ");
  });

  it("keeps one empty line unless empty lines are removed", () => {
    expect(dedupe("a\n\n\nb").output).toBe("a\n\nb");
    expect(dedupe("a\n\n\nb", { removeEmpty: true }).output).toBe("a\nb");
    expect(dedupe("a\n  \nb", { removeEmpty: true }).output).toBe("a\n  \nb");
    expect(dedupe("a\n  \nb", { removeEmpty: true, trim: true }).output).toBe("a\nb");
  });

  it("sorts A to Z or Z to A", () => {
    expect(dedupe("b\nc\na\nb", { sort: "asc" }).output).toBe("a\nb\nc");
    expect(dedupe("b\nc\na\nb", { sort: "desc" }).output).toBe("c\nb\na");
  });

  it("reads CRLF and ignores a final line break", () => {
    expect(dedupe("a\r\na\r\n")).toMatchObject({ output: "a", before: 2, removed: 1 });
    expect(dedupe("")).toMatchObject({ output: "", before: 0, removed: 0 });
    expect(dedupe("\n")).toMatchObject({ before: 1, after: 1 });
  });

  it("handles 1 MB quickly and refuses one character more", () => {
    // 100,000 lines of 9 characters plus a line break: exactly 1,000,000 characters.
    const lines = Array.from(
      { length: 100_000 },
      (_, i) => `line${String(i % 50_000).padStart(5, "0")}`,
    );
    const text = `${lines.join("\n")}\n`;
    expect(text).toHaveLength(MAX_CHARS);
    const started = performance.now();
    const result = dedupe(text, { ignoreCase: true, trim: true, sort: "asc" });
    expect(performance.now() - started).toBeLessThan(1500);
    expect(result).toMatchObject({ before: 100_000, after: 50_000, removed: 50_000 });
    expect(run({ ...BASE, text: `${text}x` })).toEqual({
      ok: false,
      error: "The text is too long: 1,000,001 characters, and the limit is 1,000,000.",
    });
  });
});

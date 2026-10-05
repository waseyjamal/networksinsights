import { describe, expect, it } from "vitest";
import * as yaml from "yaml";
import {
  cleanMessage,
  finish,
  formatYaml,
  type Input,
  LIMITS,
  locate,
  MESSAGES,
  measure,
  precheck,
} from "./logic";

// The tests hand formatYaml() the same `yaml` library worker.ts loads, so they check real output.

const format = (text: string, extra: Partial<Input> = {}) =>
  finish(text, formatYaml(yaml, { text, mode: "format", indent: "2", ...extra }));

describe("precheck", () => {
  it("asks for text when there is none", () => {
    expect(precheck("")).toEqual({ ok: false, reason: "empty", error: MESSAGES.empty });
    expect(precheck("  \n\t")).toMatchObject({ reason: "empty" });
  });

  it("accepts exactly 500,000 characters and refuses one more", () => {
    expect(LIMITS.maxCharacters).toBe(500_000);
    expect(precheck("a".repeat(500_000))).toBeNull();
    expect(precheck("a".repeat(500_001))).toEqual({
      ok: false,
      reason: "tooLong",
      error: "This text is longer than 500,000 characters. Split it into smaller parts.",
    });
  });
});

describe("formatYaml", () => {
  it("formats the page example with 2 spaces", () => {
    const result = format("name: Ada\nlangs: [en, fr]\naddress: {city: London, zip: 007}\n");
    expect(result).toEqual({
      ok: true,
      output: "name: Ada\nlangs:\n  - en\n  - fr\naddress:\n  city: London\n  zip: 007\n",
      documents: 1,
      lines: 7,
      characters: 66,
    });
  });

  it("minifies the page example, and names its duplicate key", () => {
    const example = "name: Ada\nlangs: [en, fr]\naddress: {city: London, zip: 007}\n";
    expect(format(example, { mode: "minify" })).toMatchObject({
      ok: true,
      output: "{name: Ada, langs: [en, fr], address: {city: London, zip: 007}}\n",
    });
    expect(format(`${example}name: Bob\n`)).toMatchObject({
      ok: false,
      error: "Line 4, column 1: Map keys must be unique.",
    });
  });

  it("prints a folded block scalar with its text on one line", () => {
    expect(format("fold: >-\n  one\n  two\n")).toMatchObject({
      ok: true,
      output: "fold: >-\n  one two\n",
    });
  });

  it("indents with 4 spaces", () => {
    const result = format("a:\n  b:\n    - 1\n", { indent: "4" });
    expect(result).toMatchObject({ ok: true, output: "a:\n    b:\n        - 1\n" });
  });

  it("minifies to flow style, one line a document, without comments", () => {
    const text = "# settings\nname: Ada # who\nlangs:\n  - en\n  - fr\n\nnested:\n  a: 1\n";
    expect(format(text, { mode: "minify" })).toMatchObject({
      ok: true,
      output: "{name: Ada, langs: [en, fr], nested: {a: 1}}\n",
    });
  });

  it("keeps every scalar exactly as written", () => {
    const text =
      "big: 12345678901234567890\nhex: 0x1F\nexp: 1e5\nf: 1.50\nnan: .NaN\nzip: 007\nb: yes\nn: ~\nq: \"007\"\ns: 'it''s'\n";
    expect(format(text)).toMatchObject({ ok: true, output: text });
  });

  it("keeps anchors, aliases, tags, block scalars and comments when formatting", () => {
    const text =
      "# top\nbase: &b {k: v}\nuse: *b\nn: !!int 42\nc: !custom hi\nblock: |\n  line 1\n  line 2\nend: 1 # last\n";
    expect(format(text)).toMatchObject({
      ok: true,
      output:
        "# top\nbase: &b\n  k: v\nuse: *b\nn: !!int 42\nc: !custom hi\nblock: |\n  line 1\n  line 2\nend: 1 # last\n",
    });
  });

  it("keeps several documents apart with ---", () => {
    expect(format("a: 1\n---\nb: 2\n")).toMatchObject({
      ok: true,
      output: "a: 1\n---\nb: 2\n",
      documents: 2,
    });
    expect(format("---\na: 1\n---\nb: 2\n", { mode: "minify" })).toMatchObject({
      output: "---\n{a: 1}\n---\n{b: 2}\n",
    });
  });

  it("minified YAML reads back as the same data", () => {
    const text =
      "service:\n  name: api\n  ports: [80, 443]\n  env:\n    - {key: A, value: '1'}\n    - key: B\n      value: \"x: y\"\n  empty:\n  text: |\n    two\n    lines\n";
    const result = format(text, { mode: "minify" });
    if (!result.ok) throw new Error(result.error);
    expect(yaml.parse(result.output)).toEqual(yaml.parse(text));
  });

  it("names the line and column of a duplicate key", () => {
    const result = format("a: 1\nb: 2\na: 3\n");
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      error: "Line 3, column 1: Map keys must be unique.",
      at: { line: 3, column: 1, pointer: "a: 3\n^" },
    });
  });

  it("names a tab used for indentation, and counts the errors after the first", () => {
    const result = format("a: 1\n\tb: 2\nc: [1\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/^Line 2, column 1: Tabs are not allowed as indentation\./);
    expect(result.error).toMatch(/There (is 1 more error|are \d+ more errors) after this one\.$/);
  });

  it("says when there is nothing but comments", () => {
    expect(format("# only a comment\n\n")).toEqual({
      ok: false,
      reason: "empty",
      error: MESSAGES.onlyComments,
    });
  });
});

describe("helpers", () => {
  it("keeps only the sentence of a yaml message", () => {
    expect(cleanMessage("Map keys must be unique at line 3, column 1:\n\na: 3\n^\n")).toBe(
      "Map keys must be unique.",
    );
    expect(cleanMessage("Already ends.")).toBe("Already ends.");
    expect(cleanMessage("")).toBe("This is not valid YAML.");
  });

  it("locates an offset and points at it, cutting long lines", () => {
    expect(locate("ab\ncd", 4)).toEqual({ line: 2, column: 2, pointer: "cd\n ^" });
    const long = `${"x".repeat(100)}!${"y".repeat(100)}`;
    const at = locate(long, 100);
    expect(at.column).toBe(101);
    expect(at.pointer.split("\n")[0]).toBe(`…${"x".repeat(40)}!${"y".repeat(39)}…`);
    expect(at.pointer.split("\n")[1]).toBe(`${" ".repeat(41)}^`);
    expect(locate("a\tb", 2).pointer).toBe("a b\n  ^");
  });

  it("counts lines without the final line break, and characters as code points", () => {
    expect(measure("")).toEqual({ lines: 0, characters: 0 });
    expect(measure("a\nb\n")).toEqual({ lines: 2, characters: 4 });
    expect(measure("😀")).toEqual({ lines: 1, characters: 1 });
  });
});

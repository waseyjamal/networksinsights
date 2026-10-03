import { describe, expect, it } from "vitest";
import { detectDelimiter, type Input, MAX_CHARS, parseCsv, run, value } from "./logic";

const BASE: Omit<Input, "text"> = {
  delimiter: "auto",
  header: true,
  convert: false,
  pretty: false,
};
const json = (text: string, options: Partial<Input> = {}) => {
  const result = run({ ...BASE, ...options, text });
  if (!result.ok) throw new Error(result.error);
  return JSON.parse(result.json) as unknown;
};
const error = (text: string, options: Partial<Input> = {}) => {
  const result = run({ ...BASE, ...options, text });
  if (result.ok) throw new Error("expected an error");
  return result.error;
};

describe("parseCsv", () => {
  it("reads quoted fields, doubled quotes and line breaks inside fields", () => {
    expect(parseCsv('a,"b,c","say ""hi""","x\r\ny"\r\n', ",")).toEqual([
      { fields: ["a", "b,c", 'say "hi"', "x\r\ny"], line: 1 },
    ]);
  });

  it("ends records with CRLF or LF and skips empty lines", () => {
    expect(parseCsv("a\r\nb\n\nc", ",")).toEqual([
      { fields: ["a"], line: 1 },
      { fields: ["b"], line: 2 },
      { fields: ["c"], line: 4 },
    ]);
  });

  it("keeps an empty quoted field as a row", () => {
    expect(parseCsv('""\n', ",")).toEqual([{ fields: [""], line: 1 }]);
    expect(parseCsv("a,\n", ",")).toEqual([{ fields: ["a", ""], line: 1 }]);
  });

  it("counts lines inside quoted fields", () => {
    expect(parseCsv('"a\nb"\nc', ",")).toEqual([
      { fields: ["a\nb"], line: 1 },
      { fields: ["c"], line: 3 },
    ]);
  });
});

describe("detectDelimiter", () => {
  it("picks the most frequent of comma, semicolon and tab in the first record", () => {
    expect(detectDelimiter("a;b;c\n1,2")).toBe("semicolon");
    expect(detectDelimiter("a\tb\n")).toBe("tab");
    expect(detectDelimiter('"a,b,c";d\n')).toBe("semicolon");
    expect(detectDelimiter("a,b;c\n")).toBe("comma");
    expect(detectDelimiter("abc")).toBe("comma");
  });
});

describe("value", () => {
  it("converts only when asked, and only exact forms", () => {
    expect(value("31", false)).toBe("31");
    expect(value("31", true)).toBe(31);
    expect(value("-2.5e3", true)).toBe(-2500);
    expect(value("true", true)).toBe(true);
    expect(value("false", true)).toBe(false);
    expect(value("True", true)).toBe("True");
    expect(value("0123", true)).toBe("0123");
    expect(value("1,000", true)).toBe("1,000");
    expect(value("", true)).toBe("");
    expect(value(" 5", true)).toBe(" 5");
    expect(value("9007199254740993", true)).toBe("9007199254740993");
    expect(value("9007199254740991", true)).toBe(9007199254740991);
  });
});

describe("run", () => {
  it("answers the example of its page", () => {
    const text = 'name,age,note\nAsha,31,"Likes ""tea"", and coffee"\nBen,,true\n';
    expect(json(text)).toEqual([
      { name: "Asha", age: "31", note: 'Likes "tea", and coffee' },
      { name: "Ben", age: "", note: "true" },
    ]);
    expect(json(text, { convert: true })).toEqual([
      { name: "Asha", age: 31, note: 'Likes "tea", and coffee' },
      { name: "Ben", age: "", note: true },
    ]);
  });

  it("gives arrays without a header row", () => {
    expect(json("a,b\n1,2", { header: false })).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("names empty and repeated headers", () => {
    expect(json("a,,a\n1,2,3")).toEqual([{ a: "1", column2: "2", a_2: "3" }]);
    expect(json("__proto__\n1")).toEqual([JSON.parse('{"__proto__":"1"}')]);
  });

  it("drops a byte order mark and honours a chosen delimiter", () => {
    expect(json("﻿a;b\n1;2")).toEqual([{ a: "1", b: "2" }]);
    expect(json("a;b\n1;2", { delimiter: "comma" })).toEqual([{ "a;b": "1;2" }]);
  });

  it("prints pretty or compact", () => {
    const pretty = run({ ...BASE, text: "a\n1", pretty: true });
    expect(pretty.ok && pretty.json).toBe('[\n  {\n    "a": "1"\n  }\n]');
    const compact = run({ ...BASE, text: "a\n1" });
    expect(compact.ok && compact.json).toBe('[{"a":"1"}]');
  });

  it("names the line of a bad row", () => {
    expect(error("a,b\n1,2\n1,2,3")).toBe(
      "Line 3: this row has 3 fields, but the first row has 2. Check for a missing or extra comma, or a field that needs double quotes.",
    );
    expect(error('a\n"open\n')).toBe("Line 2: a quoted field starts here and is never closed.");
    expect(error('a\nb"c')).toMatch(/^Line 2: a double quote is inside a field/);
    expect(error('a\n"b"c')).toMatch(/^Line 2: there is text after the closing double quote/);
  });

  it("accepts exactly the character limit and refuses one more", () => {
    const at = `a\n${"x".repeat(MAX_CHARS - 2)}`;
    expect(at).toHaveLength(MAX_CHARS);
    expect(run({ ...BASE, text: at })).toMatchObject({ ok: true, rows: 1 });
    expect(error(`${at}x`)).toBe(
      "The CSV is too long: 1,000,001 characters, and the limit is 1,000,000.",
    );
  });

  it("refuses empty input", () => {
    expect(error("  ")).toBe("Paste CSV or choose a file.");
    expect(error("\n\n")).toBe("Paste CSV or choose a file.");
  });
});

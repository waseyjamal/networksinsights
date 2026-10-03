import { describe, expect, it } from "vitest";
import { cellText, field, type Input, MAX_CHARS, type Options, run } from "./logic";

const OPTIONS: Options = {
  delimiter: "comma",
  header: true,
  flatten: true,
  quoteAll: false,
  protect: true,
};
const csv = (text: string, options: Partial<Options> = {}) => {
  const result = run({ text, ...OPTIONS, ...options } satisfies Input);
  if (!result.ok) throw new Error(result.error);
  return result.csv;
};

/** Valid JSON of exactly `length` characters. */
const jsonOfLength = (length: number) => {
  const shell = '[{"a":""}]';
  return `[{"a":"${"x".repeat(length - shell.length)}"}]`;
};

describe("run", () => {
  it("answers the example of its page", () => {
    const text = `[
  {"name": "Asha", "city": "Pune", "tags": ["a", "b"], "address": {"zip": "411001"}},
  {"name": "Ben, Jr.", "note": "=1+1"}
]`;
    expect(csv(text)).toBe(
      'name,city,tags,address.zip,note\r\nAsha,Pune,"[""a"",""b""]",411001,\r\n"Ben, Jr.",,,, =1+1\r\n',
    );
    expect(run({ text, ...OPTIONS })).toMatchObject({ rows: 2, columns: 5 });
  });

  it("takes one object as one row", () => {
    expect(csv('{"a": 1, "b": true, "c": null}')).toBe("a,b,c\r\n1,true,\r\n");
  });

  it("leaves nested objects as JSON text when not flattening", () => {
    expect(csv('[{"a": {"b": 1}}]', { flatten: false })).toBe('a\r\n"{""b"":1}"\r\n');
    expect(csv('[{"a": {"b": {"c": 2}}}]')).toBe("a.b.c\r\n2\r\n");
    expect(csv('[{"a": {}}]')).toBe("a\r\n{}\r\n");
  });

  it("quotes per RFC 4180: delimiters, quotes and line breaks", () => {
    expect(csv('[{"a": "say \\"hi\\""}]')).toBe('a\r\n"say ""hi"""\r\n');
    expect(csv('[{"a": "line1\\nline2"}]')).toBe('a\r\n"line1\nline2"\r\n');
    expect(csv('[{"a": "x;y", "b": "p,q"}]', { delimiter: "semicolon" })).toBe(
      'a;b\r\n"x;y";p,q\r\n',
    );
    expect(csv('[{"a": "x\\ty"}]', { delimiter: "tab" })).toBe('a\r\n"x\ty"\r\n');
    expect(csv('[{"a": 1}]', { quoteAll: true })).toBe('"a"\r\n"1"\r\n');
  });

  it("drops the header row when asked", () => {
    expect(csv('[{"a": 1}, {"a": 2}]', { header: false })).toBe("1\r\n2\r\n");
  });

  it("keeps the order keys are first seen and leaves missing keys empty", () => {
    expect(csv('[{"b": 1}, {"a": 2, "b": 3}]')).toBe("b,a\r\n1,\r\n3,2\r\n");
  });

  it("protects text cells that start with a formula character", () => {
    for (const start of ["=", "+", "-", "@", "\t", "\r"]) {
      expect(field(`${start}x`, true, OPTIONS)).toMatch(/^"? /);
    }
    expect(field("-5", false, OPTIONS)).toBe("-5");
    expect(field("=1", true, { ...OPTIONS, protect: false })).toBe("=1");
    expect(csv('[{"a": -5, "b": "-5"}]')).toBe("a,b\r\n-5, -5\r\n");
  });

  it("writes large integers as JavaScript reads them", () => {
    expect(csv('{"id": 12345678901234567890}')).toBe("id\r\n12345678901234567000\r\n");
  });

  it("accepts exactly the character limit and refuses one more", () => {
    expect(run({ text: jsonOfLength(MAX_CHARS), ...OPTIONS })).toMatchObject({ ok: true });
    expect(run({ text: jsonOfLength(MAX_CHARS + 1), ...OPTIONS })).toEqual({
      ok: false,
      error: "The JSON is too long: 1,000,001 characters, and the limit is 1,000,000.",
    });
  });
});

describe("errors", () => {
  it("explains what is wrong", () => {
    expect(run({ text: " ", ...OPTIONS })).toEqual({
      ok: false,
      error: "Paste JSON or choose a file.",
    });
    expect(run({ text: "{", ...OPTIONS })).toMatchObject({ ok: false });
    expect(run({ text: "[]", ...OPTIONS })).toMatchObject({ ok: false });
    expect(run({ text: "[{}]", ...OPTIONS })).toMatchObject({ ok: false });
    expect(run({ text: '[{"a":1}, 2]', ...OPTIONS })).toMatchObject({
      ok: false,
      error: expect.stringContaining("Item 2"),
    });
    expect(run({ text: "42", ...OPTIONS })).toMatchObject({ ok: false });
  });

  it("writes cell text for every kind of value", () => {
    expect(cellText(undefined)).toBe("");
    expect(cellText(null)).toBe("");
    expect(cellText(false)).toBe("false");
    expect(cellText([1, { a: 2 }])).toBe('[1,{"a":2}]');
  });
});

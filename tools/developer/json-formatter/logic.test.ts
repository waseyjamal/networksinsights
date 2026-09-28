import { describe, expect, it } from "vitest";
import {
  describe as describeAt,
  formatInSteps,
  INDENTS,
  type Indent,
  type Input,
  MAX_DEPTH,
  type Mode,
  measure,
  run,
  STEP_SIZE,
} from "./logic";

const format = (text: string, indent: Indent = "2") => run({ text, mode: "format", indent });
const minify = (text: string) => run({ text, mode: "minify", indent: "2" });

/** The output of a valid input, or the test fails with the error. */
function output(text: string, mode: Mode = "format", indent: Indent = "2"): string {
  const result = run({ text, mode, indent });
  if (!result.ok) throw new Error(result.error);
  return result.output;
}

/** The error of an invalid input, or the test fails. */
function failure(text: string) {
  const result = format(text);
  if (result.ok || result.reason !== "invalid") throw new Error("expected invalid JSON");
  return result;
}

/** A document that JSON.stringify writes the same way as the tool: canonical numbers and strings. */
const SAMPLE = {
  name: "Ada",
  tags: ["math", "engines", ""],
  born: 1815,
  ratio: -0.5,
  big: 1e21,
  alive: false,
  spouse: null,
  empty: {},
  none: [],
  nested: { list: [1, [2, [3, {}]], { a: { b: [] } }], quote: 'say "hi"', path: "C:\\temp" },
  unicode: "café 你好 👍🏽",
};

describe("run", () => {
  it("formats the example of the page", () => {
    expect(output('{"name":"Ada","langs":["en","fr"],"active":true}')).toBe(
      [
        "{",
        '  "name": "Ada",',
        '  "langs": [',
        '    "en",',
        '    "fr"',
        "  ],",
        '  "active": true',
        "}",
      ].join("\n"),
    );
  });

  it("formats the way JSON.stringify does for every indentation", () => {
    const text = JSON.stringify(SAMPLE);
    expect(output(text, "format", "2")).toBe(JSON.stringify(SAMPLE, null, 2));
    expect(output(text, "format", "4")).toBe(JSON.stringify(SAMPLE, null, 4));
    expect(output(text, "format", "tab")).toBe(JSON.stringify(SAMPLE, null, "\t"));
  });

  it("minifies the way JSON.stringify does", () => {
    expect(output(JSON.stringify(SAMPLE, null, 4), "minify")).toBe(JSON.stringify(SAMPLE));
  });

  it("gives the same result when run again on its own output", () => {
    for (const indent of INDENTS) {
      const once = output(JSON.stringify(SAMPLE), "format", indent);
      expect(output(once, "format", indent)).toBe(once);
      expect(output(once, "minify")).toBe(JSON.stringify(SAMPLE));
    }
  });

  it("says an empty input is empty, not invalid", () => {
    for (const text of ["", "   ", "\n\t\r\n", String.fromCharCode(0xfeff)]) {
      expect(format(text)).toEqual({
        ok: false,
        reason: "empty",
        error: "Paste or type JSON to begin.",
      });
    }
  });

  it("formats every kind of top-level value", () => {
    expect(output("  42 ")).toBe("42");
    expect(output('"text"')).toBe('"text"');
    expect(output("true")).toBe("true");
    expect(output("null")).toBe("null");
    expect(output("[ ]")).toBe("[]");
    expect(output("{\n}")).toBe("{}");
  });

  it("counts the lines and characters of the output", () => {
    const result = format('{"a":[1,2]}');
    expect(result).toMatchObject({ ok: true, lines: 6, characters: 29 });
    expect(minify('{ "a" : [ 1 , 2 ] }')).toMatchObject({ ok: true, lines: 1, characters: 11 });
  });

  it("skips a byte order mark at the start", () => {
    expect(output(`${String.fromCharCode(0xfeff)}{"a":1}`, "minify")).toBe('{"a":1}');
  });
});

describe("what it keeps exactly as written", () => {
  it("keeps numbers digit for digit, where JSON.parse would round them", () => {
    const text = '{"id":12345678901234567890,"price":1.50,"exp":1E+5,"neg":-0.0e-3}';
    expect(output(text, "minify")).toBe(text);
    expect(JSON.stringify(JSON.parse(text))).not.toBe(text);
  });

  it("keeps escapes, key order and duplicate keys", () => {
    const text = '{"b":"caf\\u00e9 \\"x\\" \\/ \\n","a":1,"a":2}';
    expect(output(text, "minify")).toBe(text);
    expect(output(text)).toBe(`{\n  "b": "caf\\u00e9 \\"x\\" \\/ \\n",\n  "a": 1,\n  "a": 2\n}`);
  });

  it("keeps spaces and emoji inside strings", () => {
    const text = '[ "a  b", " 👨‍👩‍👧 " ]';
    expect(output(text, "minify")).toBe('["a  b"," 👨‍👩‍👧 "]');
  });
});

describe("errors", () => {
  it("gives the line and column of the error, and points at it", () => {
    const result = failure('{\n  "name": "Ada",\n  "age": 36,\n}');
    expect(result.at.line).toBe(4);
    expect(result.at.column).toBe(1);
    expect(result.error).toBe(
      'Line 4, column 1: Remove the comma before "}": JSON does not allow a trailing comma.',
    );
    expect(result.at.pointer).toBe("}\n^");
  });

  it("points at the spot in a long line, cut around it", () => {
    const text = `[${'"x",'.repeat(100)}oops]`;
    const result = failure(text);
    expect(result.at.line).toBe(1);
    expect(result.at.column).toBe(402);
    const [excerpt = "", caret = ""] = result.at.pointer.split("\n");
    expect(excerpt.startsWith("…")).toBe(true);
    expect(excerpt.slice(caret.length - 1, caret.length + 3)).toBe("oops");
    expect(caret.trim()).toBe("^");
    expect(result.error).toContain('found "oops"');
  });

  it("counts columns in characters, not in UTF-16 units", () => {
    const result = failure('["👍🏽", x]');
    // The thumb and its skin tone are two characters, as in most editors.
    expect(result.at.column).toBe(8);
    expect(result.at.pointer).toBe('["👍🏽", x]\n       ^');
  });

  it("names the common mistakes", () => {
    const cases: [string, string][] = [
      ["[1, 2,]", 'Line 1, column 7: Remove the comma before "]"'],
      ["{'a': 1}", "Line 1, column 2: Strings and property names must be in double quotes"],
      ["{a: 1}", "Line 1, column 2: Property names must be in double quotes."],
      ["[\"a\", 'b']", "Line 1, column 7: Strings and property names must be in double quotes"],
      ['{"a": 1 // note\n}', "Line 1, column 9: JSON does not allow comments."],
      ["// note\n{}", "Line 1, column 1: JSON does not allow comments."],
      ['{"a" 1}', 'Line 1, column 6: Expected ":" after the property name but found "1".'],
      [
        '{"a": 1 "b": 2}',
        'Line 1, column 9: Expected "," or "}" after a value in this object but found """.',
      ],
      ["[1 2]", 'Line 1, column 4: Expected "," or "]" after a value in this array but found "2".'],
      [
        '{"a": 1]',
        'Line 1, column 8: Expected "," or "}" after a value in this object but found "]".',
      ],
      [
        '{"a": undefined}',
        'Line 1, column 7: Expected a value (an object, array, string, number, true, false or null) but found "undefined".',
      ],
      ["[NaN]", 'found "NaN".'],
      ["[True]", 'found "True".'],
      [
        '{"a": }',
        'Line 1, column 7: Expected a value (an object, array, string, number, true, false or null) but found "}".',
      ],
      ["[01]", "Line 1, column 2: A number cannot start with a leading zero."],
      ["[-]", 'Line 1, column 3: Expected a digit after "-" but found "]".'],
      ["[.5]", 'found ".".'],
      ["[1.]", 'Line 1, column 4: Expected a digit after the decimal point but found "]".'],
      ["[1e]", 'Line 1, column 4: Expected a digit in the exponent but found "]".'],
      ["[+1]", 'found "+".'],
      ['"a\nb"', "Line 1, column 3: A string cannot hold a line break; write it as an escape"],
      ['"a\tb"', "Line 1, column 3: A string cannot hold a tab;"],
      ['"a\\x"', "Line 1, column 3: A backslash in a string must start an escape"],
      ['"\\u12G4"', "Line 1, column 2: \\u must be followed by four hexadecimal digits."],
      ['{"a": "b', "Line 1, column 7: This string is never closed with a double quote."],
      ['{"a": [1, 2', 'Line 1, column 12: The JSON ends before this array is closed with "]".'],
      ['{"a": 1', 'Line 1, column 8: The JSON ends before this object is closed with "}".'],
      ['{"a":', "Line 1, column 6: The JSON ends where a value was expected."],
      ["{", "Line 1, column 2: The JSON ends where a property name was expected."],
      [
        '{"a": 1} {"b": 2}',
        'Line 1, column 10: Expected the end of the JSON but found "{". JSON holds one top-level value',
      ],
      ["1 2", 'Line 1, column 3: Expected the end of the JSON but found "2".'],
      ["[1]]", 'Line 1, column 4: Expected the end of the JSON but found "]".'],
      ["truex", 'Line 1, column 5: Expected the end of the JSON but found "x".'],
    ];
    for (const [text, start] of cases) {
      const result = failure(text);
      expect(result.error, text).toContain(start);
    }
  });

  it("does not read a closing bracket after a property name as a trailing comma", () => {
    expect(failure('{"a": 1, "b": ]').error).toContain("Expected a value");
    expect(failure('[{"a": ]').error).toContain("Expected a value");
  });

  it("describes control characters by their code", () => {
    expect(describeAt(`[${String.fromCharCode(1)}]`, 1)).toBe("a control character (U+0001)");
    expect(describeAt("[", 1)).toBe("the end of the text");
  });

  it("refuses nesting past the limit, and allows it up to the limit", () => {
    const deep = (depth: number) => `${"[".repeat(depth)}1${"]".repeat(depth)}`;
    expect(output(deep(MAX_DEPTH), "minify")).toBe(deep(MAX_DEPTH));
    const result = failure(deep(MAX_DEPTH + 1));
    expect(result.at.column).toBe(MAX_DEPTH + 1);
    expect(result.error).toContain(`more than ${MAX_DEPTH} levels deep`);
  });
});

describe("measure", () => {
  it("counts lines and characters, an emoji as one character", () => {
    expect(measure("")).toEqual({ lines: 1, characters: 0 });
    expect(measure("a\nb\n")).toEqual({ lines: 3, characters: 4 });
    expect(measure("👍🏽")).toEqual({ lines: 1, characters: 2 });
  });
});

describe("formatInSteps", () => {
  /** Runs the steps to the end and returns the result, the number of steps and the longest one. */
  function drain(input: Input, stepSize?: number) {
    const steps = formatInSteps(input, stepSize);
    let count = 0;
    let longest = 0;
    for (;;) {
      const started = performance.now();
      const step = steps.next();
      longest = Math.max(longest, performance.now() - started);
      count++;
      if (step.done) return { result: step.value, steps: count, longest };
    }
  }

  it("gives the same result as run, whatever the step size", () => {
    const text = JSON.stringify(SAMPLE, null, 2);
    for (const stepSize of [1, 7, 64]) {
      for (const mode of ["format", "minify"] as const) {
        const input: Input = { text, mode, indent: "4" };
        expect(drain(input, stepSize).result).toEqual(run(input));
      }
    }
    expect(drain({ text: "[1,}", mode: "format", indent: "2" }, 1).result).toEqual(format("[1,}"));
  });

  it("formats 1 MB of JSON in steps that each stay short", () => {
    const record = {
      id: 12345,
      name: "Ada Lovelace",
      email: "ada@example.com",
      tags: ["math", "engines"],
      active: true,
      score: 98.6,
      address: { city: "London", zip: null },
    };
    const records: (typeof record)[] = [];
    let size = 0;
    while (size < 1_000_000) {
      records.push(record);
      size += JSON.stringify(record).length + 1;
    }
    const text = JSON.stringify(records);
    expect(text.length).toBeGreaterThan(1_000_000);

    const { result, steps, longest } = drain({ text, mode: "format", indent: "2" });
    expect(steps).toBeGreaterThan(text.length / STEP_SIZE);
    expect(result).toMatchObject({ ok: true, output: JSON.stringify(records, null, 2) });
    // Generous for a slow CI machine; the point is that no step handles the whole text.
    expect(longest).toBeLessThan(500);

    expect(
      run({ text: JSON.stringify(records, null, 4), mode: "minify", indent: "2" }),
    ).toMatchObject({
      ok: true,
      output: text,
    });
  });
});

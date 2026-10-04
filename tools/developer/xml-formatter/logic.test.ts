import { describe, expect, it } from "vitest";
import xmlFormatter from "xml-formatter";
import {
  checkXml,
  finish,
  formatXml,
  type Input,
  LIMITS,
  locate,
  MESSAGES,
  measure,
  precheck,
} from "./logic";

// The tests hand formatXml() the same `xml-formatter` library worker.ts loads, so they check real
// output. checkXml() is tested on its own, since the library alone accepts broken XML.

const format = (text: string, extra: Partial<Input> = {}) =>
  finish(text, formatXml(xmlFormatter, { text, mode: "format", indent: "2", ...extra }));

const error = (text: string) => {
  const result = format(text);
  return result.ok ? "valid" : result.error;
};

describe("precheck", () => {
  it("asks for text when there is none", () => {
    expect(precheck(" \n")).toEqual({ ok: false, reason: "empty", error: MESSAGES.empty });
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

describe("formatXml", () => {
  it("formats the page example with 2 spaces", () => {
    const text = '<note id="7"><to>Ada</to><body>Hello</body><sent/></note>';
    expect(format(text)).toEqual({
      ok: true,
      output: '<note id="7">\n  <to>Ada</to>\n  <body>Hello</body>\n  <sent/>\n</note>\n',
      root: "note",
      elements: 4,
      lines: 5,
      characters: 68,
    });
  });

  it("minifies without whitespace between tags and without comments", () => {
    const text =
      '<note id="7">\n  <to>Ada</to>\n  <!-- draft -->\n  <body>Hello</body>\n  <sent/>\n</note>\n';
    expect(format(text, { mode: "minify" })).toMatchObject({
      ok: true,
      output: '<note id="7"><to>Ada</to><body>Hello</body><sent/></note>\n',
    });
  });

  it("trims text at an end only when that end has a line break", () => {
    for (const mode of ["format", "minify"] as const) {
      expect(format("<a> x  y </a>", { mode })).toMatchObject({ output: "<a> x  y </a>\n" });
      expect(format("<a>\n  x\n</a>", { mode })).toMatchObject({ output: "<a>x</a>\n" });
      expect(format("<a><![CDATA[ \n keep \n ]]></a>", { mode })).toMatchObject({
        output: "<a><![CDATA[ \n keep \n ]]></a>\n",
      });
    }
  });

  it("indents with 4 spaces or tabs", () => {
    expect(format("<a><b/></a>", { indent: "4" })).toMatchObject({
      output: "<a>\n    <b/>\n</a>\n",
    });
    expect(format("<a><b/></a>", { indent: "tab" })).toMatchObject({
      output: "<a>\n\t<b/>\n</a>\n",
    });
  });

  it("keeps the declaration, the DOCTYPE, CDATA, entities and mixed text", () => {
    const text =
      '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE doc [<!ENTITY co "Example Ltd">]><doc><p>Made by &co; &amp; <b>friends</b></p><code><![CDATA[a < b]]></code></doc>';
    expect(format(text)).toMatchObject({
      ok: true,
      output:
        '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE doc [<!ENTITY co "Example Ltd">]>\n<doc>\n  <p>Made by &co; &amp; <b>friends</b></p>\n  <code><![CDATA[a < b]]></code>\n</doc>\n',
    });
  });

  it("drops a byte order mark", () => {
    const bom = String.fromCharCode(0xfeff);
    expect(format(`${bom}<a/>`)).toMatchObject({ ok: true, output: "<a/>\n" });
  });

  it("names the line and column of the page example error", () => {
    const result = format("<note>\n  <to>Ada</from>\n</note>");
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      error:
        "Line 2, column 10: The end tag </from> does not match the open element <to>. Close <to> first.",
      at: { line: 2, column: 10, pointer: "  <to>Ada</from>\n         ^" },
    });
  });
});

describe("checkXml finds what the library lets through", () => {
  it("an element never closed", () => {
    expect(error("<a>\n  <b>\n</a>")).toBe(
      "Line 3, column 1: The end tag </a> does not match the open element <b>. Close <b> first.",
    );
    expect(error("<a><b></b>")).toBe(
      "Line 1, column 1: The element <a> is never closed. Add </a>.",
    );
  });

  it("an end tag with no start tag, and two roots", () => {
    expect(error("<a/></a>")).toBe("Line 1, column 5: The end tag </a> has no start tag.");
    expect(error("<a/><b/>")).toBe(`Line 1, column 5: ${MESSAGES.twoRoots}`);
  });

  it("attributes: quotes, equals, repeats, spaces and <", () => {
    expect(error("<a x=1/>")).toBe(
      "Line 1, column 6: The value of the attribute x must be in quotes.",
    );
    expect(error("<a x/>")).toBe(
      "Line 1, column 5: The attribute x needs = and a value in quotes.",
    );
    expect(error('<a x="1" x="2"/>')).toBe(
      "Line 1, column 10: The attribute x appears twice in the same tag.",
    );
    expect(error('<a x="1"y="2"/>')).toBe(`Line 1, column 9: ${MESSAGES.needsSpace}`);
    expect(error('<a x="1<2"/>')).toBe(
      "Line 1, column 8: The value of the attribute x cannot contain <. Write &lt;.",
    );
    expect(error('<a x="1/>')).toBe(
      "Line 1, column 6: The value of the attribute x is never closed.",
    );
  });

  it("references", () => {
    expect(error("<a>Tom & Jerry</a>")).toBe(`Line 1, column 8: ${MESSAGES.badReference}`);
    expect(error("<a>&nbsp;</a>")).toBe("Line 1, column 4: The entity &nbsp; is not defined.");
    expect(error("<a>&#0;</a>")).toBe("Line 1, column 4: &#0; is not a character XML allows.");
    expect(checkXml("<a>&lt;&#169;&#x1F600;&apos;</a>")).toEqual({
      ok: true,
      root: "a",
      elements: 1,
    });
    // An external DTD can define entities this check cannot read.
    expect(checkXml('<!DOCTYPE html SYSTEM "about:legacy-compat"><html>&nbsp;</html>').ok).toBe(
      true,
    );
  });

  it("text outside the root, comments, CDATA, declarations and DOCTYPE", () => {
    expect(error("hello")).toBe(`Line 1, column 1: ${MESSAGES.textOutside}`);
    expect(error("<a/>tail")).toBe(`Line 1, column 5: ${MESSAGES.textOutside}`);
    expect(error("<!-- just a comment -->")).toBe(`Line 1, column 24: ${MESSAGES.noRoot}`);
    expect(error("<a><!-- a -- b --></a>")).toBe(`Line 1, column 11: ${MESSAGES.doubleHyphen}`);
    expect(error("<a><!-- open</a>")).toBe(`Line 1, column 4: ${MESSAGES.unclosedComment}`);
    expect(error("<a><![CDATA[x</a>")).toBe(`Line 1, column 4: ${MESSAGES.unclosedCdata}`);
    expect(error("<![CDATA[x]]><a/>")).toBe(`Line 1, column 1: ${MESSAGES.cdataOutside}`);
    expect(error("<a>]]></a>")).toBe(`Line 1, column 4: ${MESSAGES.cdataEnd}`);
    expect(error('<a/><?xml version="1.0"?>')).toBe(
      `Line 1, column 5: ${MESSAGES.lateDeclaration}`,
    );
    expect(error("<a><?pi never</a>")).toBe(`Line 1, column 4: ${MESSAGES.unclosedInstruction}`);
    expect(error("<a/><!DOCTYPE a>")).toBe(`Line 1, column 5: ${MESSAGES.doctypePlace}`);
    expect(error("<!DOCTYPE a [<!ENTITY x 'y'>")).toBe(
      `Line 1, column 1: ${MESSAGES.unclosedDoctype}`,
    );
    expect(error("<a><!ELEMENT x></a>")).toBe(`Line 1, column 4: ${MESSAGES.badMarkup}`);
  });

  it("names and forbidden characters", () => {
    expect(error("<1a/>")).toBe(`Line 1, column 2: ${MESSAGES.badName}`);
    expect(error("<a b='1'>")).toBe("Line 1, column 1: The element <a> is never closed. Add </a>.");
    expect(error(`<a>${String.fromCharCode(1)}</a>`)).toBe(
      "Line 1, column 4: The character U+0001 is not allowed in XML.",
    );
    expect(checkXml("<ns:a xmlns:ns='u' xml:lang='en'><é-1.x/></ns:a>")).toEqual({
      ok: true,
      root: "ns:a",
      elements: 2,
    });
  });
});

describe("helpers", () => {
  it("locates an offset and points at it", () => {
    expect(locate("ab\ncd", 4)).toEqual({ line: 2, column: 2, pointer: "cd\n ^" });
    expect(locate("a\tb", 2).pointer).toBe("a b\n  ^");
  });

  it("counts lines without the final line break", () => {
    expect(measure("")).toEqual({ lines: 0, characters: 0 });
    expect(measure("<a/>\n")).toEqual({ lines: 1, characters: 5 });
  });

  it("shows a library failure without a location", () => {
    expect(finish("<a/>", { ok: false, message: MESSAGES.failed, offset: null })).toEqual({
      ok: false,
      reason: "failed",
      error: MESSAGES.failed,
    });
  });
});

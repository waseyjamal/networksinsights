import { describe, expect, it } from "vitest";
import { checkSafeRendering } from "./safe-rendering";

// The safe-rendering rule (ADR 0050): the analyzer against short sources, and every real tool's
// code. There are no tools yet, so the second test starts working when Mission 13 adds one.

const toolCode = import.meta.glob(
  [
    "../../../../../tools/*/*/ui.tsx",
    "../../../../../tools/*/*/logic.ts",
    "../../../../../tools/*/*/worker.ts",
  ],
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

const tsx = (source: string) => checkSafeRendering(source, "ui.tsx");
const ts = (source: string) => checkSafeRendering(source, "logic.ts");

describe("every tool's code", () => {
  it("renders user text as text, never as markup or code", () => {
    for (const [path, source] of Object.entries(toolCode)) {
      expect(checkSafeRendering(source, path), path).toEqual([]);
    }
  });
});

describe("what the rule allows", () => {
  it("passes React text, textContent and plain attributes", () => {
    expect(
      tsx(`
        export default function Ui({ text, url }: { text: string; url: string }) {
          const node = document.createElement("p");
          node.textContent = text;
          setTimeout(() => node.remove(), 10);
          return <a href={url} title={text}>{text}</a>;
        }
      `),
    ).toEqual([]);
  });

  it("never reports a comment or a string that only mentions a sink", () => {
    expect(
      ts(`// never use innerHTML or eval here\nexport const hint = "no innerHTML, no eval()";`),
    ).toEqual([]);
  });

  it("allows reading innerHTML, which parses nothing", () => {
    expect(ts(`export const read = (el: { innerHTML: string }) => el.innerHTML.length;`)).toEqual(
      [],
    );
  });
});

describe("what the rule refuses", () => {
  const cases: Array<[string, string, RegExp]> = [
    ["innerHTML", `el.innerHTML = value;`, /assigns innerHTML/],
    ["innerHTML +=", `el.innerHTML += value;`, /assigns innerHTML/],
    ["outerHTML", `el.outerHTML = value;`, /assigns outerHTML/],
    ["element access", `el["innerHTML"] = value;`, /assigns innerHTML/],
    ["srcdoc", `frame.srcdoc = value;`, /assigns srcdoc/],
    ["insertAdjacentHTML", `el.insertAdjacentHTML("beforeend", value);`, /insertAdjacentHTML/],
    [
      "createContextualFragment",
      `range.createContextualFragment(value);`,
      /createContextualFragment/,
    ],
    ["setHTMLUnsafe", `el.setHTMLUnsafe(value);`, /setHTMLUnsafe/],
    ["document.write", `document.write(value);`, /document\.write/],
    ["eval", `eval(value);`, /eval/],
    ["new Function", `new Function("return 1");`, /Function/],
    [
      "DOMParser",
      `new DOMParser().parseFromString(value, "text/html");`,
      /DOMParser|parseFromString/,
    ],
    ["string timer", `setTimeout("run()", 10);`, /string to setTimeout/],
    ["template timer", "setInterval(`run(" + "$" + "{n})`, 10);", /string to setInterval/],
  ];
  for (const [name, statement, pattern] of cases) {
    it(`refuses ${name}`, () => {
      const problems = ts(
        `export function f(el: any, frame: any, range: any, value: string, n: number) {\n  ${statement}\n}`,
      );
      expect(problems.length, problems.join("; ")).toBeGreaterThan(0);
      expect(problems.join("; ")).toMatch(pattern);
      expect(problems[0]).toMatch(/^line 2: /);
    });
  }

  it("refuses dangerouslySetInnerHTML and srcDoc in JSX", () => {
    expect(
      tsx(
        `export const A = ({ h }: { h: string }) => <div dangerouslySetInnerHTML={{ __html: h }} />;`,
      ),
    ).toEqual([expect.stringMatching(/dangerouslySetInnerHTML/)]);
    expect(tsx(`export const B = ({ h }: { h: string }) => <iframe srcDoc={h} />;`)).toEqual([
      expect.stringMatching(/srcDoc/),
    ]);
  });

  it("refuses a javascript: URL in JSX", () => {
    expect(tsx(`export const C = () => <a href="javascript:alert(1)">x</a>;`)).toEqual([
      expect.stringMatching(/javascript: URL/),
    ]);
    expect(tsx(`export const D = () => <a href={" JavaScript:void 0"}>x</a>;`)).toEqual([
      expect.stringMatching(/javascript: URL/),
    ]);
  });
});

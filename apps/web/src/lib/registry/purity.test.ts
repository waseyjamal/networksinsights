import { ALLOWED_GLOBALS, ALLOWED_IMPORTS, BANNED_GLOBALS } from "@networksinsights/tool-sdk";
import { describe, expect, it } from "vitest";
import { checkLogicPurity } from "./purity";

// The purity rule, checked against fixture files that are real TypeScript, and against short
// sources for the shapes that are easier to read inline.
//
// The real tools are checked too. There are none yet, so that test is empty today and starts
// working the moment Mission 13 adds one, with no change here.

const fixtures = import.meta.glob("./fixtures/purity/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const toolLogic = import.meta.glob("../../../../../tools/*/*/logic.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const fixture = (name: string) => {
  const source = fixtures[`./fixtures/purity/${name}.ts`];
  if (source === undefined) throw new Error(`no purity fixture named ${name}`);
  return checkLogicPurity(source, `${name}.ts`);
};

describe("every tool's logic.ts", () => {
  it("is pure", () => {
    for (const [path, source] of Object.entries(toolLogic)) {
      expect(checkLogicPurity(source, path), path).toEqual([]);
    }
  });
});

describe("what a logic.ts may do", () => {
  it("passes a file that uses allowed globals and allowlisted imports", () => {
    expect(fixture("pure")).toEqual([]);
  });

  it("passes a relative import of a file in the same folder", () => {
    expect(checkLogicPurity('import { x } from "./shared";\nexport const y = x;')).toEqual([]);
  });

  it("passes the web APIs all three runtimes share", () => {
    const source = `export function f(): unknown {
      return [crypto.getRandomValues, crypto.subtle, TextEncoder, TextDecoder, URL,
        URLSearchParams, Intl, structuredClone, atob, btoa, ArrayBuffer, Uint8Array,
        Math.max, Date.now];
    }`;
    expect(checkLogicPurity(source)).toEqual([]);
  });

  it("passes a top-level lookup table, which declares a thing rather than doing one", () => {
    const source = 'export const TABLE = new Map([["a", 1]]);\nexport const RE = /x/g;';
    expect(checkLogicPurity(source)).toEqual([]);
  });

  it("does not mistake a property, a type or an object key for a global", () => {
    const source = `interface Shape { document: string }
      export function f(shape: Shape): { window: string } {
        const bytes: Uint8Array = new Uint8Array(1);
        return { window: shape.document + bytes.length };
      }`;
    expect(checkLogicPurity(source)).toEqual([]);
  });
});

describe("what a logic.ts may not do", () => {
  it("refuses a DOM global", () => {
    expect(fixture("dom-global")).toEqual([
      "uses `document`: the DOM belongs in ui.tsx, not in tool logic",
    ]);
  });

  it("refuses a Node-only global", () => {
    expect(fixture("node-global")).toEqual([
      "uses `process`: Node-only, so the same logic could not run in the browser",
    ]);
  });

  it("refuses network access", () => {
    expect(fixture("network-global")).toEqual([
      "uses `fetch`: tool logic makes no network calls: the runtime decides what leaves the device",
    ]);
  });

  it("refuses a real global that is not on the shared list, and says why", () => {
    expect(fixture("unknown-global")).toEqual([
      "uses the global `WebAssembly`, which is not one of the web APIs a browser, a Web Worker and a server all have",
    ]);
  });

  it("refuses React", () => {
    expect(fixture("react-import")[0]).toContain(
      'imports "react", which is not on the allowed list',
    );
  });

  it("refuses Astro", () => {
    expect(fixture("astro-import")[0]).toContain(
      'imports "astro/config", which is not on the allowed list',
    );
  });

  it("points at the ADR when it refuses a library", () => {
    expect(fixture("react-import")[0]).toContain(
      "adding a library takes an ADR stating its license, size and why",
    );
    expect(fixture("react-import")[0]).toContain(ALLOWED_IMPORTS.join(", "));
  });

  it("refuses work that happens on import", () => {
    expect(fixture("side-effect")).toEqual([
      "has an expression statement at the top level: importing logic.ts must do nothing, so it may only declare things",
    ]);
  });

  it("refuses a relative import that climbs out of the tool folder", () => {
    expect(fixture("relative-escape")).toEqual([
      'imports "../../purity": a tool may only import files from inside its own folder',
    ]);
  });

  it("refuses importing the island or any other UI file", () => {
    expect(fixture("ui-import")).toEqual([
      'imports "./widget.tsx": a .tsx file is UI or content, not logic',
    ]);
    for (const [specifier, extension] of [
      ["./island.astro", ".astro"],
      ["./content/en.mdx", ".mdx"],
      ["./styles.css", ".css"],
    ]) {
      expect(checkLogicPurity(`import "${specifier}";`)).toEqual([
        `imports "${specifier}": a ${extension} file is UI or content, not logic`,
      ]);
    }
  });

  it("refuses a dynamic import and a top-level await", () => {
    expect(checkLogicPurity('export const m = import("./other");')[0]).toContain(
      "uses a dynamic import()",
    );
    expect(checkLogicPurity("export const v = await Promise.resolve(1);")).toContain(
      "awaits at the top level: importing logic.ts must do nothing",
    );
  });

  it("refuses a loop, an if and a throw at the top level", () => {
    expect(checkLogicPurity("if (true) { }")[0]).toContain("has an if statement at the top level");
    expect(checkLogicPurity("for (const x of []) { console.log(x); }")[0]).toContain(
      "has a loop at the top level",
    );
    expect(checkLogicPurity('throw new Error("no");')[0]).toContain(
      "has a throw statement at the top level",
    );
  });

  it("reports every global once, however often it is used", () => {
    const source = "export function f(): void { document.title = document.title; }";
    expect(checkLogicPurity(source)).toHaveLength(1);
  });
});

describe("the rule lists themselves", () => {
  it("starts the import allowlist at Zod and the SDK, and nothing else", () => {
    expect([...ALLOWED_IMPORTS]).toEqual(["zod", "@networksinsights/tool-sdk"]);
  });

  it("never allows and bans the same global", () => {
    for (const name of Object.keys(BANNED_GLOBALS)) {
      expect(ALLOWED_GLOBALS, name).not.toContain(name);
    }
  });

  it("gives every banned global a reason", () => {
    for (const [name, reason] of Object.entries(BANNED_GLOBALS)) {
      expect(reason.length, name).toBeGreaterThan(10);
    }
  });
});

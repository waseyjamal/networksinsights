import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The E2E edge server must serve the build exactly as production does (e2e/wrangler.e2e.jsonc).

const here = dirname(fileURLToPath(import.meta.url));

/** Reads a wrangler.jsonc: whole-line // comments are the only comments these files use. */
function readJsonc(path: string) {
  const text = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  return JSON.parse(text) as {
    compatibility_date: string;
    assets: { directory: string } & Record<string, unknown>;
  };
}

describe("the E2E wrangler config", () => {
  const production = readJsonc(resolve(here, "../../wrangler.jsonc"));
  const e2e = readJsonc(resolve(here, "../../e2e/wrangler.e2e.jsonc"));

  it("serves the same directory with the same asset handling", () => {
    const { directory: prodDir, ...prodRest } = production.assets;
    const { directory: e2eDir, ...e2eRest } = e2e.assets;
    expect(resolve(here, "../../e2e", e2eDir)).toBe(resolve(here, "../..", prodDir));
    expect(e2eRest).toEqual(prodRest);
  });

  it("uses the same compatibility date", () => {
    expect(e2e.compatibility_date).toBe(production.compatibility_date);
  });
});

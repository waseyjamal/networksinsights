// Enforces the rules of docs/design-system.md so they cannot erode quietly:
//   - no raw color values outside tokens.css
//   - the brand gradient only in brand moments
//   - category accents only as small icon tints
//   - one styling source: no <style> blocks in the shared components

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const srcDir = join(import.meta.dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const files = walk(srcDir)
  .filter((file) => /\.(astro|tsx|ts|css)$/.test(file))
  .filter((file) => !/\.test\.tsx?$/.test(file))
  .map((file) => ({
    path: relative(srcDir, file).replaceAll("\\", "/"),
    text: readFileSync(file, "utf8"),
  }));

/** Files where raw colors are allowed: the token source and the color math helpers. */
const rawColorAllowed = new Set(["styles/tokens.css", "lib/color.ts", "lib/tokens.ts"]);
const scanned = files.filter((file) => !rawColorAllowed.has(file.path));

const colorFunction = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const hexColor = /(?<![&\w-])#[0-9a-fA-F]{3,8}\b(?![-\w])/;
const paletteClass =
  /\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|divide|shadow|accent|decoration)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;
const arbitraryColorClass = /\b(?:bg|text|border|ring|fill|stroke)-\[(?:#|rgb|hsl|oklch)/i;

/** Returns each `selector { ... }` header that precedes an occurrence of `needle` in css. */
function selectorsAround(source: string, needle: RegExp): string[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  const flags = needle.flags.includes("g") ? needle.flags : `${needle.flags}g`;
  for (const match of css.matchAll(new RegExp(needle.source, flags))) {
    const before = css.slice(0, match.index);
    const open = before.lastIndexOf("{");
    const start = Math.max(before.lastIndexOf("}", open), before.lastIndexOf(";", open), -1);
    out.push(
      before
        .slice(start + 1, open)
        .replace(/\s+/g, " ")
        .trim(),
    );
  }
  return out;
}

const componentsCss = files.find((file) => file.path === "styles/components.css")?.text ?? "";

describe("design-system rules", () => {
  it("finds the source files it is supposed to check", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(componentsCss.length).toBeGreaterThan(1000);
  });

  it("uses no raw color values outside tokens.css", () => {
    const offenders: string[] = [];
    for (const file of scanned) {
      const text = file.path.endsWith(".css")
        ? file.text.replace(/\/\*[\s\S]*?\*\//g, "")
        : file.text;
      for (const [label, pattern] of [
        ["color function", colorFunction],
        ["hex color", hexColor],
        ["Tailwind palette class", paletteClass],
        ["arbitrary color class", arbitraryColorClass],
      ] as const) {
        const hit = pattern.exec(text);
        if (hit) offenders.push(`${file.path}: ${label} "${hit[0]}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("uses palette variables (--color-*) only where a brand moment needs them", () => {
    // Everything else goes through the theme tokens (--surface, --fg, --brand, ...).
    const allowed = /ni-aurora|ni-constellation/;
    const bad = selectorsAround(componentsCss, /var\(--color-/).filter((sel) => !allowed.test(sel));
    expect(bad).toEqual([]);
  });

  it("keeps the brand gradient to the tool workspace and the style guide swatch", () => {
    const offenders = files
      .filter((file) => file.path !== "styles/tokens.css")
      .filter(
        (file) => file.text.includes("gradient-brand") && !file.path.endsWith("ColorTokens.astro"),
      )
      .filter((file) => file.path !== "styles/components.css");
    expect(offenders.map((file) => file.path)).toEqual([]);
    const selectors = selectorsAround(componentsCss, /var\(--gradient-brand\)/);
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) expect(selector).toMatch(/^\.ni-workspace$/);
  });

  it("uses category accents (--cat-*) only for icon tints", () => {
    const selectors = selectorsAround(componentsCss, /var\(--cat-/);
    expect(selectors.length).toBe(11);
    for (const selector of selectors) expect(selector).toMatch(/^\[data-cat="[a-z-]+"\]$/);
    const utilities = files.filter(
      (file) =>
        file.path !== "styles/tokens.css" &&
        /\b(?:bg|text|border|fill|stroke|ring)-cat-/.test(file.text),
    );
    expect(utilities.map((file) => file.path)).toEqual([]);
  });

  it("sets text inside a <Hero> in --fg, the only text color guaranteed over the constellation", () => {
    // tokens.test.ts checks --fg against the strongest constellation node; --fg-muted and
    // --fg-subtle are not guaranteed there.
    const offenders: string[] = [];
    for (const file of files.filter(
      (f) => f.path.startsWith("pages/") && f.path.endsWith(".astro"),
    )) {
      for (const block of file.text.matchAll(/<Hero>([\s\S]*?)<\/Hero>/g)) {
        if (/text-fg-(?:muted|subtle)/.test(block[1] ?? "")) offenders.push(file.path);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps styles in components.css: the shared components have no <style> blocks", () => {
    const withStyle = files
      .filter((file) => file.path.startsWith("components/ui/") && file.path.endsWith(".astro"))
      .filter((file) => /<style[\s>]/.test(file.text));
    expect(withStyle.map((file) => file.path)).toEqual([]);
  });

  it("styles components only with tokens: no fixed px font sizes, and motion uses the duration tokens", () => {
    const css = componentsCss.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/font-size:\s*\d+(?:\.\d+)?px/);
    const durations = [...css.matchAll(/transition-duration:\s*([^;]+);/g)].map((m) => m[1]);
    for (const value of durations) expect(value).toMatch(/var\(--duration-(?:fast|base|slow)\)/);
  });
});

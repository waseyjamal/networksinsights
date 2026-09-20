// Reads src/styles/tokens.css so tests and the style guide use the same values as the browser.
// The CSS file stays the single source of truth; nothing here duplicates a token.

import { oklchToSrgb, type Rgb } from "./color";

export type TokenMap = Map<string, string>;

export interface Tokens {
  /** `@theme static` declarations: palette, radius, type, motion, gradient. */
  staticTokens: TokenMap;
  /** Names bridged to Tailwind utilities, without the `--color-` prefix. */
  bridge: Set<string>;
  /** Runtime variables of the light theme. */
  light: TokenMap;
  /** Runtime variables of the dark theme (the `theme-dark` utility). */
  dark: TokenMap;
}

interface Block {
  header: string;
  body: string;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Splits CSS into top-level `header { body }` blocks. Nested blocks stay inside `body`. */
function topLevelBlocks(css: string): Block[] {
  const blocks: Block[] = [];
  let depth = 0;
  let start = 0;
  let headerStart = 0;
  let header = "";
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      if (depth === 0) {
        header = css.slice(headerStart, i).trim();
        start = i + 1;
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        blocks.push({ header, body: css.slice(start, i) });
        headerStart = i + 1;
      }
    }
  }
  return blocks;
}

/** Parses `--name: value;` declarations. Values may contain commas and parentheses. */
export function parseDeclarations(body: string): TokenMap {
  const map: TokenMap = new Map();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) map.set(name, value.replace(/\s+/g, " ").trim());
  }
  return map;
}

export function parseTokens(css: string): Tokens {
  const blocks = topLevelBlocks(stripComments(css));
  const find = (header: string) => blocks.filter((b) => b.header === header);

  const staticTokens: TokenMap = new Map();
  for (const block of find("@theme static")) {
    for (const [k, v] of parseDeclarations(block.body)) staticTokens.set(k, v);
  }

  const bridge = new Set<string>();
  for (const block of find("@theme inline")) {
    for (const name of parseDeclarations(block.body).keys()) {
      if (name.startsWith("--color-")) bridge.add(name.slice("--color-".length));
    }
  }

  const lightBlock = blocks.find((b) => /^:root\s*,\s*\[data-theme="light"\]$/.test(b.header));
  const darkBlock = find("@utility theme-dark")[0];
  if (!lightBlock) throw new Error("tokens.css: light block not found");
  if (!darkBlock) throw new Error("tokens.css: theme-dark block not found");

  return {
    staticTokens,
    bridge,
    light: parseDeclarations(lightBlock.body),
    dark: parseDeclarations(darkBlock.body),
  };
}

/** Resolves `var(--x)` references until an `oklch(...)` literal is left. */
export function resolveColor(value: string, scope: TokenMap, staticTokens: TokenMap): string {
  let current = value;
  for (let i = 0; i < 10; i++) {
    const match = /^var\((--[\w-]+)\)$/.exec(current.trim());
    if (!match?.[1]) return current;
    const next = scope.get(match[1]) ?? staticTokens.get(match[1]);
    if (next === undefined) throw new Error(`Unresolved token ${match[1]}`);
    current = next;
  }
  throw new Error(`Token reference loop while resolving ${value}`);
}

export type Theme = "light" | "dark";

/** Resolved colors of one theme, keyed by runtime name without dashes (`--fg` becomes `fg`). */
export function themeColors(tokens: Tokens, theme: Theme): Map<string, Rgb> {
  const scope = theme === "light" ? tokens.light : tokens.dark;
  const out = new Map<string, Rgb>();
  for (const [name, value] of scope) {
    if (!tokens.bridge.has(name.slice(2))) continue;
    out.set(name.slice(2), oklchToSrgb(resolveColor(value, scope, tokens.staticTokens)));
  }
  return out;
}

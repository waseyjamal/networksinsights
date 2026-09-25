// Builds `dist/_headers` from config/headers.ts and the Content-Security-Policy Astro computed for
// each page (ADR 0047, ADR 0048). Pure: the integration in src/integrations/ reads the files and
// writes the result; everything that can be wrong is decided here, where a test can reach it.

import {
  csp,
  embeddablePaths,
  HEADERS_MAX_LINE,
  HEADERS_MAX_RULES,
  IMMUTABLE,
  immutablePaths,
  OVERRIDE_META,
  previewHeaders,
  previewPattern,
  securityHeaders,
} from "../../config/headers";
import { cspHash } from "./hash";

/** What one built page says about its own policy. */
export interface BuiltPage {
  /** The URL path: `/`, `/tools/`, `/404.html`. */
  path: string;
  /** The content of its `<meta http-equiv="content-security-policy">`, or undefined. */
  policy: string | undefined;
  /** Its override marker, when the page has one. */
  override: { adr: string; crossOriginIsolated: boolean } | undefined;
}

export interface HeaderRule {
  pattern: string;
  /** In order. A name starting with "! " removes that header set by an earlier rule. */
  lines: string[];
}

/** `a b; c d;` to `["a b", "c d"]`, whitespace normalized. */
export function directivesOf(policy: string): string[] {
  return policy
    .split(";")
    .map((directive) => directive.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

/** The policy as the header sends it: the page's directives plus the header-only ones. */
export function headerPolicy(pagePolicy: string): string {
  const directives = directivesOf(pagePolicy);
  const names = new Set(directives.map((directive) => directive.split(" ")[0]));
  for (const directive of csp.headerOnly) {
    if (names.has(directive.split(" ")[0])) {
      throw new Error(
        `"${directive.split(" ")[0]}" must not be in the <meta> policy: it is ignored there`,
      );
    }
  }
  return [...directives, ...csp.headerOnly].join("; ");
}

/** The sources of one directive, falling back the way a browser does (-elem, then the base). */
function sourcesFor(directives: readonly string[], names: readonly string[]): string[] {
  for (const name of names) {
    const found = directives.find((directive) => directive.split(" ")[0] === name);
    if (found) return found.split(" ").slice(1);
  }
  return [];
}

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const STYLE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;

/**
 * Every inline script and <style> the browser would run or apply, whose hash is not in the page's
 * policy. Data blocks (JSON-LD) are not code and need none. Astro hashes what it bundles; an
 * is:inline script must have its hash added in astro.config.mjs, or it would be refused.
 */
export function unhashedInline(html: string, policy: string): string[] {
  const directives = directivesOf(policy);
  const scripts = sourcesFor(directives, ["script-src-elem", "script-src", "default-src"]);
  const styles = sourcesFor(directives, ["style-src-elem", "style-src", "default-src"]);
  const problems: string[] = [];
  for (const [, attributes = "", body = ""] of html.matchAll(SCRIPT)) {
    if (/\ssrc=/i.test(attributes)) continue;
    const type = /\stype="([^"]*)"/i.exec(attributes)?.[1]?.toLowerCase();
    if (type !== undefined && type !== "module" && type !== "text/javascript") continue;
    if (!scripts.includes(`'${cspHash(body)}'`)) {
      problems.push(`inline script "${body.trim().slice(0, 60)}…"`);
    }
  }
  for (const [, body = ""] of html.matchAll(STYLE)) {
    if (!styles.includes(`'${cspHash(body)}'`)) {
      problems.push(`inline style "${body.trim().slice(0, 60)}…"`);
    }
  }
  return problems;
}

/** Reads the policy and the override marker out of a built HTML page. */
export function readPage(path: string, html: string): BuiltPage {
  const metas = [...html.matchAll(/<meta\s[^>]*http-equiv="content-security-policy"[^>]*>/gi)];
  if (metas.length > 1) throw new Error(`${path} has ${metas.length} CSP <meta> elements`);
  const policy = metas[0]?.[0].match(/content="([^"]*)"/)?.[1]?.replaceAll("&#39;", "'");
  const marker = new RegExp(`<meta\\s+name="${OVERRIDE_META}"\\s+content="([^"]*)"`).exec(
    html,
  )?.[1];
  let override: BuiltPage["override"];
  if (marker !== undefined) {
    const adr = /\badr=(\d{4})\b/.exec(marker)?.[1];
    if (!adr) throw new Error(`${path}: ${OVERRIDE_META} must name an ADR as adr=NNNN`);
    override = { adr, crossOriginIsolated: /\bcross-origin-isolated\b/.test(marker) };
  }
  if (policy) {
    const problems = unhashedInline(html, policy);
    if (problems.length > 0) {
      throw new Error(
        `${path}: the Content-Security-Policy would refuse ${problems.join(", ")}. Add its hash in astro.config.mjs (ADR 0047).`,
      );
    }
  }
  return { path, policy, override };
}

/**
 * Every page must carry Astro's policy, and every page without an approved override must carry
 * the same one, because a single `/*` rule sends it. A page with an override gets its own rule.
 * The home page's policy is the site's policy.
 */
export function sitePolicy(pages: readonly BuiltPage[]): string {
  const home = pages.find((page) => page.path === "/");
  if (!home?.policy) throw new Error("The home page has no Content-Security-Policy <meta>");
  const base = directivesOf(home.policy).join("; ");
  for (const page of pages) {
    if (!page.policy) throw new Error(`${page.path} has no Content-Security-Policy <meta>`);
    const own = directivesOf(page.policy).join("; ");
    if (page.override && own === base && !page.override.crossOriginIsolated) {
      throw new Error(`${page.path} declares a security override but its policy is the site's`);
    }
    if (!page.override && own !== base) {
      throw new Error(
        `${page.path} has a different Content-Security-Policy from the home page, without an approved override (ADR 0047).\n  home: ${base}\n  page: ${own}`,
      );
    }
  }
  return base;
}

const headerLines = (headers: Readonly<Record<string, string>>) =>
  Object.entries(headers).map(([name, value]) => `${name}: ${value}`);

/** The rules, in the order Cloudflare applies them. */
export function headerRules(pages: readonly BuiltPage[]): HeaderRule[] {
  const policy = sitePolicy(pages);
  const rules: HeaderRule[] = [
    {
      pattern: "/*",
      lines: [`Content-Security-Policy: ${headerPolicy(policy)}`, ...headerLines(securityHeaders)],
    },
    ...embeddablePaths.map((pattern) => ({
      pattern,
      lines: ["! Cross-Origin-Resource-Policy", "Cross-Origin-Resource-Policy: cross-origin"],
    })),
    ...immutablePaths.map((pattern) => ({ pattern, lines: [`Cache-Control: ${IMMUTABLE}`] })),
    { pattern: previewPattern, lines: headerLines(previewHeaders) },
  ];
  for (const page of pages) {
    if (!page.override || !page.policy) continue;
    const lines = [
      "! Content-Security-Policy",
      `Content-Security-Policy: ${headerPolicy(page.policy)}`,
    ];
    if (page.override.crossOriginIsolated) lines.push("Cross-Origin-Embedder-Policy: require-corp");
    rules.push({ pattern: page.path, lines });
  }
  return rules;
}

/** The `_headers` file. Throws past Cloudflare's limits instead of letting rules be dropped. */
export function renderHeadersFile(rules: readonly HeaderRule[]): string {
  if (rules.length > HEADERS_MAX_RULES) {
    throw new Error(
      `_headers has ${rules.length} rules; Cloudflare reads at most ${HEADERS_MAX_RULES}`,
    );
  }
  const text = [
    "# Generated by apps/web/src/integrations/security-headers.ts from src/config/headers.ts.",
    "# Do not edit: change the config (ADR 0047, ADR 0048).",
    "",
    ...rules.flatMap((rule) => [rule.pattern, ...rule.lines.map((line) => `  ${line}`), ""]),
  ].join("\n");
  for (const line of text.split("\n")) {
    if (line.length > HEADERS_MAX_LINE) {
      throw new Error(
        `_headers has a line of ${line.length} characters; Cloudflare's limit is ${HEADERS_MAX_LINE}: ${line.slice(0, 80)}…`,
      );
    }
  }
  return text;
}

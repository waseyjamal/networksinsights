// Does a page's structured data say only what the page shows? (ADR 0039)
//
// Google's guideline is that structured data must describe content that is visible on the page.
// This is the check, run on the HTML of a page by the unit tests, by `pnpm check:seo` on the whole
// build, and (in a real browser) by the end-to-end tests. It returns every problem it finds as a
// sentence, and an empty list means the page is consistent.

import { site } from "../../config/site";
import {
  canonicalLinks,
  datetimesOf,
  hrefsOf,
  jsonLdBlocks,
  metaName,
  squash,
  titleOf,
  visibleBreadcrumbs,
  visibleText,
} from "./html";
import { jsonLdDocumentSchema } from "./schemas";

/**
 * The keys whose value is a constant of the vocabulary or of the site, not a claim about the page.
 * Each has a fixed value in the schema, so a page cannot change what it says through one of them.
 */
const CONSTANT_KEYS = new Set([
  "@context",
  "@type",
  "@id",
  "logo",
  "alternateName",
  "price",
  "priceCurrency",
  "applicationCategory",
  "operatingSystem",
  "browserRequirements",
  "inLanguage",
  "position",
]);

const absolute = (href: string) => (href.startsWith("/") ? `${site.url}${href}` : href);

/** Every string in a JSON value, with the path that leads to it. */
function* strings(
  value: unknown,
  path: string[] = [],
): Generator<{ path: string[]; text: string }> {
  if (typeof value === "string") yield { path, text: value };
  else if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) yield* strings(item, [...path, String(index)]);
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) yield* strings(item, [...path, key]);
  }
}

/** The problems with the structured data of one page's HTML. Empty means it matches the page. */
export function structuredDataProblems(html: string): string[] {
  const problems: string[] = [];

  let blocks: unknown[];
  try {
    blocks = jsonLdBlocks(html);
  } catch (error) {
    return [`a JSON-LD block does not parse: ${(error as Error).message}`];
  }
  if (blocks.length === 0) return problems;

  const canonical = canonicalLinks(html)[0];
  const shown = squash(
    [
      visibleText(html),
      titleOf(html),
      metaName(html, "description") ?? "",
      ...datetimesOf(html),
    ].join(" | "),
  );
  const links = new Set(hrefsOf(html).map(absolute));
  if (canonical) links.add(canonical);

  for (const block of blocks) {
    const parsed = jsonLdDocumentSchema.safeParse(block);
    if (!parsed.success) {
      problems.push(
        `a JSON-LD block does not match its schema: ${parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      );
      continue;
    }

    for (const { path, text } of strings(block)) {
      const key = [...path].reverse().find((part) => Number.isNaN(Number(part))) ?? "";
      if (CONSTANT_KEYS.has(key)) continue;
      const where = path.join(".");
      if (text.startsWith(`${site.url}/`) || text === site.url) {
        // A URL of the site must be one the page links to, or the page's own address.
        if (!links.has(text)) {
          problems.push(`"${where}" points at ${text}, which is not a link on the page`);
        }
        continue;
      }
      if (!shown.includes(squash(text))) {
        problems.push(`"${where}" says ${JSON.stringify(text)}, which the page does not show`);
      }
    }

    for (const node of parsed.data["@graph"]) {
      if (node["@type"] !== "BreadcrumbList") continue;
      const visible = visibleBreadcrumbs(html);
      const written = node.itemListElement.map((item) => item.name);
      if (JSON.stringify(visible.map((crumb) => crumb.label)) !== JSON.stringify(written)) {
        problems.push(
          `the breadcrumb data (${written.join(" > ")}) is not the breadcrumb trail on the page (${visible.map((crumb) => crumb.label).join(" > ")})`,
        );
      }
      node.itemListElement.forEach((item, index) => {
        const crumb = visible[index];
        const expected = crumb?.href === undefined ? canonical : absolute(crumb.href);
        if (expected !== undefined && item.item !== expected) {
          problems.push(
            `breadcrumb ${index + 1} links to ${item.item}, the page links to ${expected}`,
          );
        }
      });
    }
  }
  return problems;
}

// A small reader for the HTML this site generates, used by the tests and by `pnpm check:seo`.
//
// It is deliberately not a general HTML parser. The pages are written by our own templates, so
// their head is regular: one tag per line of interest, double-quoted attributes, no comments
// inside. Reading them with a few patterns needs no dependency, and if a template ever produces
// something these patterns cannot read, the tests fail, which is the point.

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&nbsp;": " ",
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&(?:amp|lt|gt|quot|#39|#x27|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

/** Collapses runs of white space to one space and trims. */
export const squash = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The attributes of one tag, as written. */
function attributesOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const inner = tag.replace(/^<[a-zA-Z0-9-]+/, "");
  for (const match of inner.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:="([^"]*)")?/g)) {
    if (match[1] !== undefined) out[match[1]] = decodeEntities(match[2] ?? "");
  }
  return out;
}

/** The `<head>` of a document, or the whole text when there is none. */
export function headOf(html: string): string {
  const start = html.indexOf("<head");
  const end = html.indexOf("</head>");
  return start === -1 || end === -1 ? html : html.slice(start, end);
}

/** Every tag of one kind in the head: `tagsOf(html, "meta")`. */
export function tagsOf(html: string, name: string): Array<Record<string, string>> {
  return [...headOf(html).matchAll(new RegExp(`<${name}\\b[^>]*>`, "g"))].map((match) =>
    attributesOf(match[0]),
  );
}

/** `<meta name="…">` content, or undefined. */
export function metaName(html: string, name: string): string | undefined {
  return tagsOf(html, "meta").find((tag) => tag.name === name)?.content;
}

/** `<meta property="…">` content, or undefined. */
export function metaProperty(html: string, property: string): string | undefined {
  return tagsOf(html, "meta").find((tag) => tag.property === property)?.content;
}

/** Every `<meta property="og:…">` as `[property, content]`. */
export function openGraphTags(html: string): Array<[string, string]> {
  return tagsOf(html, "meta")
    .filter((tag) => tag.property?.startsWith("og:"))
    .map((tag) => [tag.property ?? "", tag.content ?? ""]);
}

/** Every `<meta name="twitter:…">` as `[name, content]`. */
export function twitterTags(html: string): Array<[string, string]> {
  return tagsOf(html, "meta")
    .filter((tag) => tag.name?.startsWith("twitter:"))
    .map((tag) => [tag.name ?? "", tag.content ?? ""]);
}

/** The href of every `<link rel="canonical">`. */
export function canonicalLinks(html: string): string[] {
  return tagsOf(html, "link")
    .filter((tag) => tag.rel === "canonical")
    .map((tag) => tag.href ?? "");
}

/** The text of `<title>`. */
export function titleOf(html: string): string {
  return decodeEntities(/<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? "");
}

/** The parsed JSON of every `<script type="application/ld+json">`. Throws on a block that does not parse. */
export function jsonLdBlocks(html: string): unknown[] {
  return [
    ...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g),
  ].map((match) => JSON.parse(match[1] ?? ""));
}

const INLINE_TAG =
  /<\/?(?:a|abbr|b|cite|code|del|em|i|ins|kbd|mark|q|s|small|span|strong|sub|sup|time|u)\b[^>]*>/gi;

/** The text a reader sees: scripts, styles and tags removed, entities decoded, white space squashed. */
export function visibleText(html: string): string {
  const body = html.includes("<body") ? html.slice(html.indexOf("<body")) : html;
  return squash(
    decodeEntities(
      body
        .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, " ")
        // Inline elements do not break the text (a browser joins them), so they add no space.
        .replace(INLINE_TAG, "")
        .replace(/<[^>]*>/g, " "),
    ),
  );
}

/** Every `href` in the body, as written. */
export function hrefsOf(html: string): string[] {
  const body = html.includes("<body") ? html.slice(html.indexOf("<body")) : html;
  return [...body.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)].map((match) =>
    decodeEntities(match[1] ?? ""),
  );
}

/** Every `datetime` attribute in the body. */
export function datetimesOf(html: string): string[] {
  return [...html.matchAll(/<time\b[^>]*\sdatetime="([^"]*)"/g)].map((match) => match[1] ?? "");
}

/** The breadcrumb trail the page draws: `[label, href]` for each item, in order. */
export function visibleBreadcrumbs(
  html: string,
): Array<{ label: string; href: string | undefined }> {
  const start = html.indexOf('aria-label="Breadcrumb"');
  if (start === -1) return [];
  const nav = html.slice(start, html.indexOf("</nav>", start));
  return [...nav.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((item) => ({
    label: squash(decodeEntities((item[1] ?? "").replace(/<[^>]*>/g, ""))),
    href: /href="([^"]*)"/.exec(item[1] ?? "")?.[1],
  }));
}

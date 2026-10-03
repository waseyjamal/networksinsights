// Pure logic of "Meta Tag Generator": it checks the fields and writes the HTML tags, escaped for an
// attribute, with no DOM, no network and no top-level statements (docs/tool-contract.md).

export const ROBOTS = [
  "index, follow",
  "noindex, follow",
  "index, nofollow",
  "noindex, nofollow",
] as const;
export type Robots = (typeof ROBOTS)[number];

export const OG_TYPES = ["website", "article"] as const;
export type OgType = (typeof OG_TYPES)[number];

export const TWITTER_CARDS = ["summary", "summary_large_image"] as const;
export type TwitterCard = (typeof TWITTER_CARDS)[number];

/**
 * A rule of thumb, not a limit any search engine publishes: titles around 60 characters and
 * descriptions around 160 often show in full. Engines cut by pixel width, not by characters.
 */
export const RULE_OF_THUMB = { title: 60, description: 160 } as const;

/** Our own cap on each field, so a pasted page cannot freeze the preview. */
export const MAX_FIELD = 2000;

export interface Input {
  title: string;
  description: string;
  canonical: string;
  robots: Robots;
  siteName: string;
  ogType: OgType;
  image: string;
  imageAlt: string;
  twitterCard: TwitterCard;
  twitterSite: string;
}

export type Result =
  | { ok: true; html: string; lineCount: number }
  | { ok: false; errors: Partial<Record<keyof Input, string>> };

/** Escapes text for an HTML attribute value in double quotes, and for element text. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Collapses runs of white space, as a browser does when it shows a title. */
export function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function isAbsoluteHttpUrl(text: string): boolean {
  return /^https?:\/\/[^\s/?#]+\.[^\s/?#]+[^\s]*$/i.test(text);
}

export function run(input: Input): Result {
  const errors: Partial<Record<keyof Input, string>> = {};
  const title = clean(input.title);
  const description = clean(input.description);
  const canonical = input.canonical.trim();
  const image = input.image.trim();
  const handle = input.twitterSite.trim();
  if (title === "") errors.title = "Enter a title.";
  if (description === "") errors.description = "Enter a description.";
  for (const key of Object.keys(input) as Array<keyof Input>) {
    if (input[key].length > MAX_FIELD) errors[key] = `Keep this under ${MAX_FIELD} characters.`;
  }
  if (canonical !== "" && !isAbsoluteHttpUrl(canonical)) {
    errors.canonical = "Use a full address that starts with https:// or http://.";
  }
  if (image !== "" && !isAbsoluteHttpUrl(image)) {
    errors.image = "Use a full address that starts with https:// or http://.";
  }
  if (handle !== "" && !/^@?[A-Za-z0-9_]{1,15}$/.test(handle)) {
    errors.twitterSite = "A handle has 1 to 15 letters, digits or underscores, such as @example.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const e = escapeHtml;
  const lines = [
    `<title>${e(title)}</title>`,
    `<meta name="description" content="${e(description)}">`,
    `<meta name="robots" content="${input.robots}">`,
  ];
  if (canonical) lines.push(`<link rel="canonical" href="${e(canonical)}">`);
  lines.push(
    `<meta property="og:type" content="${input.ogType}">`,
    `<meta property="og:title" content="${e(title)}">`,
    `<meta property="og:description" content="${e(description)}">`,
  );
  if (canonical) lines.push(`<meta property="og:url" content="${e(canonical)}">`);
  const siteName = clean(input.siteName);
  if (siteName) lines.push(`<meta property="og:site_name" content="${e(siteName)}">`);
  const alt = clean(input.imageAlt);
  if (image) {
    lines.push(`<meta property="og:image" content="${e(image)}">`);
    if (alt) lines.push(`<meta property="og:image:alt" content="${e(alt)}">`);
  }
  lines.push(
    `<meta name="twitter:card" content="${input.twitterCard}">`,
    `<meta name="twitter:title" content="${e(title)}">`,
    `<meta name="twitter:description" content="${e(description)}">`,
  );
  if (image) {
    lines.push(`<meta name="twitter:image" content="${e(image)}">`);
    if (alt) lines.push(`<meta name="twitter:image:alt" content="${e(alt)}">`);
  }
  if (handle) {
    lines.push(`<meta name="twitter:site" content="@${handle.replace(/^@/, "")}">`);
  }
  return { ok: true, html: lines.join("\n"), lineCount: lines.length };
}

/** How the URL of a result is usually shown: the host, then the path split by arrows. */
export function displayUrl(canonical: string): string {
  const match = /^https?:\/\/([^/?#]+)([^?#]*)/i.exec(canonical.trim());
  if (!match) return "";
  const host = (match[1] ?? "").toLowerCase();
  const parts = (match[2] ?? "").split("/").filter((part) => part !== "");
  return [host, ...parts].join(" › ");
}

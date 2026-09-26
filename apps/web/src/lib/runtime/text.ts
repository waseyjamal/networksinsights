// Rendering words that came from a visitor (ADR 0050, docs/tool-contract.md "Rendering user
// text"). Import these from "@ui".
//
// In React, `{value}` is already text: React never parses it as markup. These two helpers cover
// the rest: writing text into a node outside React, and turning a URL a visitor typed into an
// href that cannot run code.

/** Puts `value` into `node` as text. Never markup, whatever it contains. */
export function setText(node: Pick<Node, "textContent">, value: unknown): void {
  node.textContent = value === undefined || value === null ? "" : String(value);
}

/** The schemes a link built from visitor input may use. */
export const SAFE_URL_SCHEMES = ["https:", "http:", "mailto:"] as const;

/**
 * The URL, normalized, if it is an absolute http, https or mailto URL; otherwise undefined. A
 * `javascript:`, `data:` or `blob:` URL, or anything that is not a URL, never becomes an href.
 *
 * ```tsx
 * const href = safeUrl(input);
 * return href ? <a href={href}>{input}</a> : <span>{input}</span>;
 * ```
 */
export function safeUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  return (SAFE_URL_SCHEMES as readonly string[]).includes(url.protocol) ? url.href : undefined;
}

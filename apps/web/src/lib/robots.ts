// The value of <meta name="robots">, decided in one place (ADR 0029).

/**
 * Before launch every page is `noindex, nofollow`, whatever the page asks for. After launch a page
 * is indexable unless it opts out (the 404 page, the design-system page). Returns undefined
 * when no robots meta should be rendered.
 */
export function robotsContent({
  launched,
  pageNoindex,
}: {
  launched: boolean;
  pageNoindex: boolean;
}): string | undefined {
  if (!launched) return "noindex, nofollow";
  return pageNoindex ? "noindex" : undefined;
}

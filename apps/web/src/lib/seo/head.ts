// The canonical link, the Open Graph tags and the Twitter/X card tags of a page (ADR 0038).
//
// Pure data in, tags out. `Base.astro` renders what this returns, so there is one place that
// decides what a page says about itself to search engines and to the apps people share it in.

import { site } from "../../config/site";
import { fileUrl, pageUrl } from "./urls";

/** The size every share image is drawn at (ADR 0041). 1200 by 630 is the 1.91:1 that Open Graph
 *  consumers show in full and that X shows as a large card. */
export const SHARE_IMAGE = { width: 1200, height: 630, type: "image/png" } as const;

/** The share image of the home page. Pages without an image of their own use it. */
export const HOME_SHARE_IMAGE = "/og/home.png";

/** The path of a page's share image: `/og/pdf-tools.png`, `/og/word-counter.png`. */
export function shareImagePath(slug: string): string {
  return `/og/${slug}.png`;
}

export interface HeadInput {
  title: string;
  description: string;
  /**
   * The page's own path, taken from the route and never from the host. Absent for a page that is
   * not a canonical object, such as the 404 page, which answers at any address.
   */
  path: string | undefined;
  /** The page opts out of indexing: it gets no canonical link and no `og:url`. */
  noindex: boolean;
  /** The share image: a file path under /og/, and a description of what it shows. */
  image: { path: string; alt: string };
}

export interface HeadTags {
  /** The absolute URL for `<link rel="canonical">`, or undefined when the page has none. */
  canonical: string | undefined;
  /** `<meta property="og:…" content="…">`, in order. */
  openGraph: Array<{ property: string; content: string }>;
  /** `<meta name="twitter:…" content="…">`, in order. */
  twitter: Array<{ name: string; content: string }>;
}

export function buildHead(input: HeadInput): HeadTags {
  const canonical = input.noindex || input.path === undefined ? undefined : pageUrl(input.path);
  if (!input.noindex && canonical === undefined) {
    throw new Error(`The indexable page "${input.title}" has no path, so it has no canonical URL.`);
  }
  const image = fileUrl(input.image.path);

  const openGraph = [
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: site.name },
    { property: "og:locale", content: "en_US" },
    { property: "og:title", content: input.title },
    { property: "og:description", content: input.description },
    ...(canonical ? [{ property: "og:url", content: canonical }] : []),
    { property: "og:image", content: image },
    { property: "og:image:type", content: SHARE_IMAGE.type },
    { property: "og:image:width", content: String(SHARE_IMAGE.width) },
    { property: "og:image:height", content: String(SHARE_IMAGE.height) },
    { property: "og:image:alt", content: input.image.alt },
  ];

  // X reads its own tags first and falls back to Open Graph, so the two sets are identical.
  // There is no `twitter:site`: the site has no account, and one is not invented.
  const twitter = [
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: input.title },
    { name: "twitter:description", content: input.description },
    { name: "twitter:image", content: image },
    { name: "twitter:image:alt", content: input.image.alt },
  ];

  return { canonical, openGraph, twitter };
}

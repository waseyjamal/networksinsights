// The sitemaps of the site: what goes in, its `lastmod`, and the XML (ADR 0040).
//
// A sitemap index lists one sitemap for the pages, one for the categories and one or more for the
// tools. Every entry is an indexable page with a `lastmod` from real data: a tool's `updated`
// date, or the date kept by hand in config/site.ts. There is no `priority` and no `changefreq`,
// which Google ignores. Nothing is written before launch (see `sitemapsExist`).

import { categories, categoriesUpdated, categoryHref } from "../../config/categories";
import { pageUpdated, sitePages } from "../../config/site";
import type { Tool } from "../registry/build";
import { fileUrl, pageUrl } from "./urls";

/** The most URLs one sitemap file may hold (the protocol and Google both say 50,000). */
export const SITEMAP_URL_LIMIT = 50_000;

/** The sitemap index: the one file to give to search engines. */
export const SITEMAP_INDEX_PATH = "/sitemap-index.xml";

export interface SitemapEntry {
  /** The page path: `/word-counter/`. */
  path: string;
  /** The absolute URL. */
  loc: string;
  /** `YYYY-MM-DD`. */
  lastmod: string;
}

export interface SitemapFile {
  /** `pages`, `categories`, `tools`, `tools-2`: the file is `/sitemap-<slug>.xml`. */
  slug: string;
  entries: SitemapEntry[];
}

/** The path of a sitemap file. */
export const sitemapPath = (slug: string) => `/sitemap-${slug}.xml`;

/** The newest of some ISO dates. They sort as text. */
export function newest(dates: readonly string[]): string {
  const [first, ...rest] = dates;
  if (first === undefined) throw new Error("newest() needs at least one date");
  return rest.reduce((latest, date) => (date > latest ? date : latest), first);
}

/**
 * A category page is indexable once it lists at least one tool. An empty one says only that tools
 * are coming, which is not worth a search result, so it is `noindex` and left out of the sitemap
 * until the first tool arrives (ADR 0040).
 */
export const isCategoryIndexable = (toolCount: number): boolean => toolCount > 0;

const entry = (path: string, lastmod: string): SitemapEntry => ({
  path,
  loc: pageUrl(path),
  lastmod,
});

/** Every indexable page, in three groups. The 404 page and the design system are not among them. */
export function indexablePages(tools: readonly Tool[]): {
  pages: SitemapEntry[];
  categories: SitemapEntry[];
  tools: SitemapEntry[];
} {
  const toolDates = tools.map((tool) => tool.manifest.updated);
  const withTools = (own: string) => newest([own, ...toolDates]);

  return {
    pages: [
      entry("/", withTools(pageUpdated.home)),
      entry(sitePages.tools.href, withTools(pageUpdated.tools)),
      entry(sitePages.about.href, pageUpdated.about),
      entry(sitePages.contact.href, pageUpdated.contact),
      entry(sitePages.privacy.href, pageUpdated.privacy),
      entry(sitePages.terms.href, pageUpdated.terms),
    ],
    categories: categories.flatMap((category) => {
      const own = tools.filter((tool) => tool.manifest.category === category.id);
      if (!isCategoryIndexable(own.length)) return [];
      return [
        entry(
          categoryHref(category),
          newest([categoriesUpdated, ...own.map((tool) => tool.manifest.updated)]),
        ),
      ];
    }),
    tools: [...tools]
      .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))
      .map((tool) => entry(tool.href, tool.manifest.updated)),
  };
}

/** Cuts a list into files of at most `limit` entries: `tools`, `tools-2`, `tools-3`, … */
function split(slug: string, entries: SitemapEntry[], limit: number): SitemapFile[] {
  const files: SitemapFile[] = [];
  for (let start = 0; start < entries.length; start += limit) {
    files.push({
      slug: files.length === 0 ? slug : `${slug}-${files.length + 1}`,
      entries: entries.slice(start, start + limit),
    });
  }
  return files;
}

/** The sitemap files for a set of tools. A group with nothing in it has no file. */
export function buildSitemapFiles(
  tools: readonly Tool[],
  limit = SITEMAP_URL_LIMIT,
): SitemapFile[] {
  const groups = indexablePages(tools);
  return [
    ...split("pages", groups.pages, limit),
    ...split("categories", groups.categories, limit),
    ...split("tools", groups.tools, limit),
  ];
}

/** Sitemaps exist only after launch: before it, every page is noindex and nothing is advertised. */
export const sitemapsExist = (launched: boolean): boolean => launched;

const escapeXml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

/** One sitemap file. */
export function renderUrlset(entries: readonly SitemapEntry[]): string {
  const urls = entries.map(
    (item) => `<url><loc>${escapeXml(item.loc)}</loc><lastmod>${item.lastmod}</lastmod></url>`,
  );
  return `${XML_HEADER}\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

/** The index of a set of sitemap files, each with the newest `lastmod` inside it. */
export function renderSitemapIndex(files: readonly SitemapFile[]): string {
  const items = files.map(
    (file) =>
      `<sitemap><loc>${escapeXml(fileUrl(sitemapPath(file.slug)))}</loc><lastmod>${newest(file.entries.map((item) => item.lastmod))}</lastmod></sitemap>`,
  );
  return `${XML_HEADER}\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join("\n")}\n</sitemapindex>\n`;
}

/** The `<loc>` and `<lastmod>` of every `<url>` in a sitemap this module wrote. */
export function readUrlset(xml: string): Array<{ loc: string; lastmod: string | undefined }> {
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => ({
    loc: unescapeXml(/<loc>([^<]*)<\/loc>/.exec(match[1] ?? "")?.[1] ?? ""),
    lastmod: /<lastmod>([^<]*)<\/lastmod>/.exec(match[1] ?? "")?.[1],
  }));
}

/** The `<loc>` of every `<sitemap>` in an index this module wrote. */
export function readSitemapIndex(xml: string): string[] {
  return [...xml.matchAll(/<sitemap>[\s\S]*?<loc>([^<]*)<\/loc>[\s\S]*?<\/sitemap>/g)].map(
    (match) => unescapeXml(match[1] ?? ""),
  );
}

function unescapeXml(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

// `pnpm check:seo`: what search engines and share previews will see, checked on the build output
// (ADR 0038 to 0041). It reads apps/web/dist, the files that are deployed, so it finds what a unit
// test of a template cannot: a page that lost its canonical, a share image that was not built, a
// sitemap that names a page that is noindex. Run it after `pnpm build`.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { categories, categoryHref } from "../../apps/web/src/config/categories";
import { site, sitePages } from "../../apps/web/src/config/site";
import { structuredDataProblems } from "../../apps/web/src/lib/seo/consistency";
import {
  canonicalLinks,
  metaName,
  openGraphTags,
  twitterTags,
} from "../../apps/web/src/lib/seo/html";
import { readSitemapIndex, readUrlset } from "../../apps/web/src/lib/seo/sitemap";

export interface SeoOptions {
  /** The build output. Defaults to apps/web/dist. */
  dist: string;
  /** Whether the site is launched (config/site.ts). Decides which files must exist. */
  launched?: boolean;
}

export interface SeoReport {
  pages: number;
  images: number;
  sitemapUrls: number;
  problems: string[];
}

/** The pages that must always carry a canonical link: the home page and the site pages. */
const CANONICAL_PAGES = ["/", ...Object.values(sitePages).map((page) => page.href)];

/** Pages that opt out of indexing, and so have no canonical link. The offline page is ADR 0052's. */
const NOINDEX_PAGES = new Set(["/404/", "/design-system/", "/offline/"]);

/** Every .html file under a folder, as a page path: `dist/a/index.html` is `/a/`. */
export function htmlPages(dist: string): Array<{ path: string; file: string }> {
  const out: Array<{ path: string; file: string }> = [];
  for (const name of readdirSync(dist, { recursive: true, encoding: "utf8" })) {
    const file = join(dist, name);
    if (!name.endsWith(".html") || !statSync(file).isFile()) continue;
    const posix = name.replaceAll("\\", "/");
    const path =
      posix === "index.html"
        ? "/"
        : posix === "404.html"
          ? "/404/"
          : `/${posix.replace(/(?:^|\/)index\.html$/, "")}/`.replace("//", "/");
    out.push({ path, file });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** The width and height of a PNG, or undefined when the bytes are not one. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function checkSeo(options: SeoOptions): SeoReport {
  const { dist } = options;
  const launched = options.launched ?? site.launched;
  const problems: string[] = [];
  const say = (path: string, message: string) => problems.push(`${path}: ${message}`);

  if (!existsSync(dist)) {
    return {
      pages: 0,
      images: 0,
      sitemapUrls: 0,
      problems: [`${dist} does not exist: run pnpm build first`],
    };
  }

  const pages = htmlPages(dist);
  const images = new Set<string>();
  const canonicalOf = new Map<string, string>();

  for (const { path, file } of pages) {
    const html = readFileSync(file, "utf8");
    const canonicals = canonicalLinks(html);
    const og = new Map(openGraphTags(html));
    const twitter = new Map(twitterTags(html));

    // Canonical: absolute, on the production host, this page's own address, with a trailing slash.
    if (canonicals.length > 1) say(path, `has ${canonicals.length} canonical links`);
    const canonical = canonicals[0];
    if (canonical !== undefined) {
      canonicalOf.set(path, canonical);
      if (canonical !== `${site.url}${path}`) {
        say(path, `canonical is ${canonical}, expected ${site.url}${path}`);
      }
      if (og.get("og:url") !== canonical) say(path, "og:url is not the canonical URL");
    } else {
      if (CANONICAL_PAGES.includes(path)) say(path, "has no canonical link");
      if (og.has("og:url")) say(path, "has an og:url but no canonical link");
    }
    if (
      canonical === undefined &&
      !NOINDEX_PAGES.has(path) &&
      !isCategory(path) &&
      !CANONICAL_PAGES.includes(path)
    ) {
      // A tool page: it is always indexable, so it always has a canonical.
      say(path, "has no canonical link (a tool page is always indexable)");
    }

    // Open Graph and the Twitter/X card: on every page, noindex ones included.
    for (const property of [
      "og:type",
      "og:site_name",
      "og:title",
      "og:description",
      "og:image",
      "og:image:width",
      "og:image:height",
      "og:image:alt",
    ]) {
      if (!og.get(property)) say(path, `is missing ${property}`);
    }
    for (const name of ["twitter:card", "twitter:title", "twitter:description", "twitter:image"]) {
      if (!twitter.get(name)) say(path, `is missing ${name}`);
    }
    if (twitter.get("twitter:card") !== "summary_large_image")
      say(path, "twitter:card is not summary_large_image");
    if (og.get("og:title") !== undefined && !html.includes(`<title>`)) say(path, "has no <title>");
    if (!metaName(html, "description")) say(path, "has no meta description");

    // The share image must be a real file of the right size.
    const image = og.get("og:image");
    if (image !== undefined) {
      if (image !== twitter.get("twitter:image")) say(path, "og:image and twitter:image differ");
      if (!image.startsWith(`${site.url}/`)) {
        say(path, `og:image is not on ${site.url}: ${image}`);
      } else {
        const imagePath = image.slice(site.url.length);
        images.add(imagePath);
      }
    }

    // Structured data: parses, matches its schema, says only what the page shows.
    for (const problem of structuredDataProblems(html)) say(path, problem);
    if (canonical === undefined && /application\/ld\+json/.test(html)) {
      say(path, "has structured data but is not an indexable page");
    }
  }

  for (const imagePath of images) {
    const file = join(dist, imagePath);
    if (!existsSync(file)) {
      problems.push(`${imagePath}: a page names this share image but it was not built`);
      continue;
    }
    const bytes = readFileSync(file);
    const size = pngSize(bytes);
    if (!size) problems.push(`${imagePath}: is not a PNG`);
    else if (size.width !== 1200 || size.height !== 630) {
      problems.push(`${imagePath}: is ${size.width}x${size.height}, expected 1200x630`);
    }
    if (bytes.length > MAX_IMAGE_BYTES) problems.push(`${imagePath}: is over 5 MB`);
  }

  // Every page that is shared has its own card: the home page, each category and each tool.
  for (const { path } of pages) {
    const wanted =
      path === "/"
        ? "/og/home.png"
        : isCategory(path) || isTool(path)
          ? `/og${path.slice(0, -1)}.png`
          : undefined;
    if (wanted !== undefined && !existsSync(join(dist, wanted))) {
      say(path, `its share image ${wanted} was not built`);
    }
  }

  // robots.txt always exists. Its Sitemap line, and the sitemaps and llms.txt, follow the launch flag.
  const robotsFile = join(dist, "robots.txt");
  const robots = existsSync(robotsFile) ? readFileSync(robotsFile, "utf8") : undefined;
  if (robots === undefined) problems.push("/robots.txt: was not built");
  else {
    const hasSitemap = /^Sitemap:/im.test(robots);
    if (launched && !hasSitemap)
      problems.push("/robots.txt: the site is launched but there is no Sitemap line");
    if (!launched && hasSitemap)
      problems.push("/robots.txt: the site is not launched but robots.txt advertises a sitemap");
    if (/^Disallow:\s*\/\s*$/m.test(robots.split(/\n\s*\n/)[0] ?? "")) {
      problems.push("/robots.txt: the default group blocks the whole site (ADR 0029)");
    }
  }

  let sitemapUrls = 0;
  const indexFile = join(dist, "sitemap-index.xml");
  const sitemapFiles = readdirSync(dist).filter((name) => /^sitemap-.*\.xml$/.test(name));
  if (!launched) {
    if (sitemapFiles.length > 0)
      problems.push(
        `${sitemapFiles.join(", ")}: the site is not launched, so there should be no sitemap`,
      );
    if (existsSync(join(dist, "llms.txt")))
      problems.push("/llms.txt: the site is not launched, so there should be no llms.txt");
  } else if (!existsSync(indexFile)) {
    problems.push("/sitemap-index.xml: the site is launched but there is no sitemap index");
  } else {
    const listed = readSitemapIndex(readFileSync(indexFile, "utf8"));
    const urls: string[] = [];
    for (const loc of listed) {
      const name = loc.slice(site.url.length + 1);
      const file = join(dist, name);
      if (!existsSync(file)) {
        problems.push(`/sitemap-index.xml: lists ${loc}, which was not built`);
        continue;
      }
      for (const url of readUrlset(readFileSync(file, "utf8"))) {
        urls.push(url.loc);
        if (!url.lastmod || !/^\d{4}-\d{2}-\d{2}$/.test(url.lastmod))
          problems.push(`${name}: ${url.loc} has no valid lastmod`);
      }
    }
    sitemapUrls = urls.length;
    if (new Set(urls).size !== urls.length) problems.push("sitemaps list a URL twice");
    for (const url of urls) {
      const path = url.slice(site.url.length);
      const page = pages.find((item) => item.path === path);
      if (!page) {
        problems.push(`${url}: is in a sitemap but no such page was built`);
        continue;
      }
      const html = readFileSync(page.file, "utf8");
      if (/noindex/i.test(metaName(html, "robots") ?? ""))
        problems.push(`${url}: is in a sitemap but is noindex`);
      if (canonicalOf.get(path) !== url)
        problems.push(
          `${url}: is in a sitemap but its canonical is ${canonicalOf.get(path) ?? "missing"}`,
        );
    }
    for (const forbidden of NOINDEX_PAGES) {
      if (urls.includes(`${site.url}${forbidden}`))
        problems.push(`${forbidden}: must not be in a sitemap`);
    }
    // Every indexable page is listed: it has a canonical.
    for (const [path] of canonicalOf) {
      if (!urls.includes(`${site.url}${path}`))
        problems.push(`${path}: is indexable but is not in any sitemap`);
    }
    const llms = join(dist, "llms.txt");
    if (!existsSync(llms))
      problems.push("/llms.txt: the site is launched but there is no llms.txt");
    else {
      for (const match of readFileSync(llms, "utf8").matchAll(/\]\((https:[^)]+)\)/g)) {
        if (!urls.includes(match[1] ?? ""))
          problems.push(`/llms.txt: links to ${match[1]}, which is not in a sitemap`);
      }
    }
  }

  return { pages: pages.length, images: images.size, sitemapUrls, problems };
}

const categoryPaths = new Set(categories.map((category) => categoryHref(category)));
const staticPaths = new Set([...CANONICAL_PAGES, ...NOINDEX_PAGES]);
const isCategory = (path: string) => categoryPaths.has(path);
const isTool = (path: string) => !isCategory(path) && !staticPaths.has(path) && path !== "/";

export function formatSeoReport(report: SeoReport, dist: string): string {
  const rel = relative(process.cwd(), dist) || dist;
  const head = `SEO check of ${rel}: ${report.pages} pages, ${report.images} share images, ${report.sitemapUrls} sitemap URLs`;
  return report.problems.length === 0
    ? `${head}\n  ✓ canonical, Open Graph, Twitter card, share images, structured data, robots.txt, sitemaps and llms.txt all agree`
    : `${head}\n\n${report.problems.length} ${report.problems.length === 1 ? "problem" : "problems"}:\n${report.problems.map((problem) => `  ✗ ${problem}`).join("\n")}`;
}

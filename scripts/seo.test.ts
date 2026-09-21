import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { categories } from "../apps/web/src/config/categories";
import { sitePages } from "../apps/web/src/config/site";
import { renderSitemapIndex, renderUrlset, sitemapPath } from "../apps/web/src/lib/seo/sitemap";
import { checkSeo, formatSeoReport, htmlPages, pngSize } from "./lib/seo";
import { scratchRoot } from "./lib/test-support";

// `pnpm check:seo` reads a build. These tests write a small fake build, prove that a correct one
// passes, and break it one way at a time to prove each way is caught.

const SITE = "https://networksinsights.com";
const roots: Array<ReturnType<typeof scratchRoot>> = [];
afterEach(() => {
  for (const scratch of roots.splice(0)) scratch.remove();
});

/** A PNG of a given size: the signature and the IHDR chunk are all the check reads. */
function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "latin1");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

interface PageSpec {
  path: string;
  canonical?: string | false;
  image?: string;
  robots?: string;
  ogUrl?: string | false;
  jsonLd?: unknown;
  twitterCard?: string;
}

function html(page: PageSpec): string {
  const canonical =
    page.canonical === false ? undefined : (page.canonical ?? `${SITE}${page.path}`);
  const ogUrl = page.ogUrl === false ? undefined : (page.ogUrl ?? canonical);
  const image = page.image ?? `${SITE}/og/home.png`;
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="description" content="A description of ${page.path}">
<meta name="robots" content="${page.robots ?? "index, follow"}">
${canonical ? `<link rel="canonical" href="${canonical}">` : ""}
<meta property="og:type" content="website"><meta property="og:site_name" content="NetworksInsights">
<meta property="og:title" content="T"><meta property="og:description" content="D">
${ogUrl ? `<meta property="og:url" content="${ogUrl}">` : ""}
<meta property="og:image" content="${image}"><meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630"><meta property="og:image:alt" content="alt">
<meta name="twitter:card" content="${page.twitterCard ?? "summary_large_image"}"><meta name="twitter:title" content="T">
<meta name="twitter:description" content="D"><meta name="twitter:image" content="${image}">
<title>T</title>
${page.jsonLd ? `<script type="application/ld+json">${JSON.stringify(page.jsonLd)}</script>` : ""}
</head><body><h1>${page.path}</h1></body></html>`;
}

/** A launched or unlaunched fake build: every page, every image, robots.txt, and the sitemaps. */
function build(options: { launched: boolean; tweak?: (dist: string) => void }) {
  const scratch = scratchRoot();
  roots.push(scratch);
  const dist = join(scratch.root, "dist");
  const write = (path: string, content: string | Buffer) => {
    const file = join(dist, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, content);
  };

  const indexable = ["/", ...Object.values(sitePages).map((page) => page.href)];
  for (const path of indexable) {
    write(
      path === "/" ? "index.html" : `${path.slice(1)}index.html`,
      html({ path, robots: options.launched ? "index, follow" : "noindex, nofollow" }),
    );
  }
  write("404.html", html({ path: "/404/", canonical: false, robots: "noindex" }));
  write(
    "design-system/index.html",
    html({ path: "/design-system/", canonical: false, robots: "noindex" }),
  );
  for (const category of categories) {
    // Empty categories: noindex, so no canonical.
    write(
      `${category.slug}/index.html`,
      html({
        path: `/${category.slug}/`,
        canonical: false,
        ogUrl: false,
        robots: "noindex",
        image: `${SITE}/og/${category.slug}.png`,
      }),
    );
    write(`og/${category.slug}.png`, png(1200, 630));
  }
  write("og/home.png", png(1200, 630));

  write(
    "robots.txt",
    `User-agent: *\nAllow: /\n${options.launched ? `\nSitemap: ${SITE}/sitemap-index.xml\n` : ""}`,
  );

  if (options.launched) {
    const entries = indexable.map((path) => ({
      path,
      loc: `${SITE}${path}`,
      lastmod: "2026-09-21",
    }));
    write(sitemapPath("pages").slice(1), renderUrlset(entries));
    write("sitemap-index.xml", renderSitemapIndex([{ slug: "pages", entries }]));
    write("llms.txt", `# NetworksInsights\n\n> x\n\n## Optional\n\n- [About](${SITE}/about/)\n`);
  }
  options.tweak?.(dist);
  return { dist, write, launched: options.launched };
}

const problemsOf = (dist: string, launched: boolean) => checkSeo({ dist, launched }).problems;

describe("a correct build", () => {
  it("passes before launch: canonical on the site pages, noindex pages without one, no sitemap", () => {
    const { dist } = build({ launched: false });
    expect(problemsOf(dist, false)).toEqual([]);
    const report = checkSeo({ dist, launched: false });
    expect(report.pages).toBe(1 + Object.keys(sitePages).length + 2 + categories.length);
    expect(report.sitemapUrls).toBe(0);
  });

  it("passes after launch: the sitemap lists every indexable page, and llms.txt links only to them", () => {
    const { dist } = build({ launched: true });
    expect(problemsOf(dist, true)).toEqual([]);
    expect(checkSeo({ dist, launched: true }).sitemapUrls).toBe(1 + Object.keys(sitePages).length);
  });

  it("finds pages the way the deploy serves them", () => {
    const { dist } = build({ launched: false });
    const paths = htmlPages(dist).map((page) => page.path);
    expect(paths).toContain("/");
    expect(paths).toContain("/tools/");
    expect(paths).toContain("/404/");
    expect(paths).toContain("/design-system/");
  });

  it("prints a summary a person can read", () => {
    const { dist } = build({ launched: false });
    const text = formatSeoReport(checkSeo({ dist, launched: false }), dist);
    expect(text).toContain("SEO check of");
    expect(text).toContain("all agree");
  });
});

describe("canonical links", () => {
  it("catches a site page without one", () => {
    const { dist } = build({
      launched: false,
      tweak: (d) =>
        writeFileSync(
          join(d, "about", "index.html"),
          html({ path: "/about/", canonical: false, ogUrl: false }),
        ),
    });
    expect(problemsOf(dist, false).join("\n")).toContain("/about/: has no canonical link");
  });

  it("catches a canonical on another host, such as a preview", () => {
    const { dist } = build({
      launched: false,
      tweak: (d) =>
        writeFileSync(
          join(d, "index.html"),
          html({ path: "/", canonical: "https://pr-9-networksinsights.x.workers.dev/" }),
        ),
    });
    expect(problemsOf(dist, false).join("\n")).toContain(
      "canonical is https://pr-9-networksinsights.x.workers.dev/, expected https://networksinsights.com/",
    );
  });

  it("catches a canonical without its trailing slash, and one that points at another page", () => {
    const { dist } = build({
      launched: false,
      tweak: (d) => {
        writeFileSync(
          join(d, "tools", "index.html"),
          html({ path: "/tools/", canonical: `${SITE}/tools` }),
        );
        writeFileSync(
          join(d, "about", "index.html"),
          html({ path: "/about/", canonical: `${SITE}/contact/` }),
        );
      },
    });
    const text = problemsOf(dist, false).join("\n");
    expect(text).toContain(
      "/tools/: canonical is https://networksinsights.com/tools, expected https://networksinsights.com/tools/",
    );
    expect(text).toContain("/about/: canonical is https://networksinsights.com/contact/");
  });

  it("catches an og:url that is not the canonical, and an og:url with no canonical", () => {
    const { dist } = build({
      launched: false,
      tweak: (d) => {
        writeFileSync(
          join(d, "tools", "index.html"),
          html({ path: "/tools/", ogUrl: `${SITE}/other/` }),
        );
        writeFileSync(
          join(d, "404.html"),
          html({ path: "/404/", canonical: false, ogUrl: `${SITE}/404/`, robots: "noindex" }),
        );
      },
    });
    const text = problemsOf(dist, false).join("\n");
    expect(text).toContain("/tools/: og:url is not the canonical URL");
    expect(text).toContain("/404/: has an og:url but no canonical link");
  });

  it("catches a tool page without a canonical, since a tool page is always indexable", () => {
    const { dist } = build({
      launched: false,
      tweak: (d) => {
        mkdirSync(join(d, "word-counter"), { recursive: true });
        writeFileSync(
          join(d, "word-counter", "index.html"),
          html({
            path: "/word-counter/",
            canonical: false,
            ogUrl: false,
            image: `${SITE}/og/word-counter.png`,
          }),
        );
        writeFileSync(join(d, "og", "word-counter.png"), png(1200, 630));
      },
    });
    expect(problemsOf(dist, false).join("\n")).toContain(
      "/word-counter/: has no canonical link (a tool page is always indexable)",
    );
  });

  it("catches two canonical links", () => {
    const { dist } = build({
      launched: false,
      tweak: (d) => {
        const page = html({ path: "/", robots: "noindex" }).replace(
          "</head>",
          `<link rel="canonical" href="${SITE}/"></head>`,
        );
        writeFileSync(join(d, "index.html"), page);
      },
    });
    expect(problemsOf(dist, false).join("\n")).toContain("/: has 2 canonical links");
  });
});

describe("Open Graph, Twitter/X and share images", () => {
  it("catches a card that is not a large-image card", () => {
    const { dist } = build({
      launched: false,
      tweak: (d) =>
        writeFileSync(join(d, "index.html"), html({ path: "/", twitterCard: "summary" })),
    });
    expect(problemsOf(dist, false).join("\n")).toContain("twitter:card is not summary_large_image");
  });

  it("catches a share image that was not built", () => {
    const { dist } = build({
      launched: false,
      tweak: (d) =>
        writeFileSync(join(d, "index.html"), html({ path: "/", image: `${SITE}/og/missing.png` })),
    });
    expect(problemsOf(dist, false).join("\n")).toContain(
      "/og/missing.png: a page names this share image but it was not built",
    );
  });

  it("catches an image of the wrong size, and a file that is not a PNG", () => {
    const { dist } = build({
      launched: false,
      tweak: (d) => {
        writeFileSync(join(d, "og", "home.png"), png(600, 315));
        writeFileSync(
          join(d, "og", `${categories[0]?.slug}.png`),
          Buffer.from("not a png at all, just text"),
        );
      },
    });
    const text = problemsOf(dist, false).join("\n");
    expect(text).toContain("/og/home.png: is 600x315, expected 1200x630");
    expect(text).toContain(`/og/${categories[0]?.slug}.png: is not a PNG`);
  });

  it("catches an image on another host", () => {
    const { dist } = build({
      launched: false,
      tweak: (d) =>
        writeFileSync(
          join(d, "index.html"),
          html({ path: "/", image: "https://cdn.example.com/x.png" }),
        ),
    });
    expect(problemsOf(dist, false).join("\n")).toContain(
      "og:image is not on https://networksinsights.com",
    );
  });

  it("catches a category or tool page whose own card was not built", () => {
    const { dist } = build({
      launched: false,
      tweak: (d) => rmSync(join(d, "og", `${categories[1]?.slug}.png`)),
    });
    expect(problemsOf(dist, false).join("\n")).toContain(
      `its share image /og/${categories[1]?.slug}.png was not built`,
    );
  });
});

describe("structured data", () => {
  it("catches a block that does not parse", () => {
    const { dist } = build({
      launched: false,
      tweak: (d) =>
        writeFileSync(
          join(d, "index.html"),
          html({ path: "/" }).replace(
            "</head>",
            '<script type="application/ld+json">{ nope</script></head>',
          ),
        ),
    });
    expect(() => problemsOf(dist, false)).not.toThrow();
    expect(problemsOf(dist, false).join("\n")).toContain("does not parse");
  });

  it("catches structured data on a page that is not indexable", () => {
    const { dist } = build({
      launched: false,
      tweak: (d) =>
        writeFileSync(
          join(d, "404.html"),
          html({
            path: "/404/",
            canonical: false,
            ogUrl: false,
            robots: "noindex",
            jsonLd: { "@context": "https://schema.org", "@graph": [] },
          }),
        ),
    });
    expect(problemsOf(dist, false).join("\n")).toContain(
      "/404/: has structured data but is not an indexable page",
    );
  });
});

describe("robots.txt, sitemaps and llms.txt follow the launch flag", () => {
  it("catches a sitemap before launch", () => {
    const { dist } = build({
      launched: false,
      tweak: (d) => writeFileSync(join(d, "sitemap-index.xml"), "<sitemapindex/>"),
    });
    expect(problemsOf(dist, false).join("\n")).toContain(
      "the site is not launched, so there should be no sitemap",
    );
  });

  it("catches llms.txt before launch", () => {
    const { dist } = build({
      launched: false,
      tweak: (d) => writeFileSync(join(d, "llms.txt"), "# x"),
    });
    expect(problemsOf(dist, false).join("\n")).toContain("no llms.txt");
  });

  it("catches a Sitemap line before launch, and a missing one after", () => {
    const early = build({
      launched: false,
      tweak: (d) =>
        writeFileSync(
          join(d, "robots.txt"),
          `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap-index.xml\n`,
        ),
    });
    expect(problemsOf(early.dist, false).join("\n")).toContain("advertises a sitemap");
    const late = build({
      launched: true,
      tweak: (d) => writeFileSync(join(d, "robots.txt"), "User-agent: *\nAllow: /\n"),
    });
    expect(problemsOf(late.dist, true).join("\n")).toContain("there is no Sitemap line");
  });

  it("catches a robots.txt that blocks the whole site, which would hide the noindex tags (ADR 0029)", () => {
    const { dist } = build({
      launched: false,
      tweak: (d) => writeFileSync(join(d, "robots.txt"), "User-agent: *\nDisallow: /\n"),
    });
    expect(problemsOf(dist, false).join("\n")).toContain("blocks the whole site");
  });

  it("catches a missing robots.txt", () => {
    const { dist } = build({ launched: false, tweak: (d) => rmSync(join(d, "robots.txt")) });
    expect(problemsOf(dist, false).join("\n")).toContain("/robots.txt: was not built");
  });

  it("catches a sitemap that lists a noindex page, the 404 page or a page that does not exist", () => {
    const { dist } = build({
      launched: true,
      tweak: (d) => {
        const entries = [
          { path: "/", loc: `${SITE}/`, lastmod: "2026-09-21" },
          { path: "/design-system/", loc: `${SITE}/design-system/`, lastmod: "2026-09-21" },
          { path: "/404/", loc: `${SITE}/404/`, lastmod: "2026-09-21" },
          { path: "/ghost/", loc: `${SITE}/ghost/`, lastmod: "2026-09-21" },
        ];
        writeFileSync(join(d, "sitemap-pages.xml"), renderUrlset(entries));
      },
    });
    const text = problemsOf(dist, true).join("\n");
    expect(text).toContain("/design-system/: is in a sitemap but is noindex");
    expect(text).toContain("/design-system/: must not be in a sitemap");
    expect(text).toContain("/404/: must not be in a sitemap");
    expect(text).toContain("/ghost/: is in a sitemap but no such page was built");
  });

  it("catches an indexable page that no sitemap lists", () => {
    const { dist } = build({
      launched: true,
      tweak: (d) => {
        const entries = [{ path: "/", loc: `${SITE}/`, lastmod: "2026-09-21" }];
        writeFileSync(join(d, "sitemap-pages.xml"), renderUrlset(entries));
      },
    });
    expect(problemsOf(dist, true).join("\n")).toContain(
      "/about/: is indexable but is not in any sitemap",
    );
  });

  it("catches a missing lastmod, and a URL listed twice", () => {
    const { dist } = build({
      launched: true,
      tweak: (d) => {
        writeFileSync(
          join(d, "sitemap-pages.xml"),
          `<urlset><url><loc>${SITE}/</loc></url><url><loc>${SITE}/</loc><lastmod>2026-09-21</lastmod></url></urlset>`,
        );
      },
    });
    const text = problemsOf(dist, true).join("\n");
    expect(text).toContain("has no valid lastmod");
    expect(text).toContain("list a URL twice");
  });

  it("catches an llms.txt that links to a page the sitemaps do not list", () => {
    const { dist } = build({
      launched: true,
      tweak: (d) =>
        writeFileSync(join(d, "llms.txt"), `# x\n\n## A\n\n- [Ghost](${SITE}/ghost/)\n`),
    });
    expect(problemsOf(dist, true).join("\n")).toContain(
      "/llms.txt: links to https://networksinsights.com/ghost/",
    );
  });

  it("catches a launched site with no sitemap index or no llms.txt", () => {
    const noIndex = build({ launched: true, tweak: (d) => rmSync(join(d, "sitemap-index.xml")) });
    expect(problemsOf(noIndex.dist, true).join("\n")).toContain("no sitemap index");
    const noLlms = build({ launched: true, tweak: (d) => rmSync(join(d, "llms.txt")) });
    expect(problemsOf(noLlms.dist, true).join("\n")).toContain("no llms.txt");
  });
});

describe("the check itself", () => {
  it("says to build first when there is no build", () => {
    const scratch = scratchRoot();
    roots.push(scratch);
    expect(problemsOf(join(scratch.root, "missing"), false).join()).toContain(
      "run pnpm build first",
    );
  });

  it("reads a PNG size from the header, and nothing from other bytes", () => {
    expect(pngSize(png(1200, 630))).toEqual({ width: 1200, height: 630 });
    expect(pngSize(Buffer.from("GIF89a....................."))).toBeUndefined();
    expect(pngSize(Buffer.alloc(3))).toBeUndefined();
  });

  it("is what the real build's index lists when the index is written by the site's own code", () => {
    const xml = renderSitemapIndex([
      { slug: "pages", entries: [{ path: "/", loc: `${SITE}/`, lastmod: "2026-09-21" }] },
    ]);
    expect(xml).toContain(`<loc>${SITE}/sitemap-pages.xml</loc>`);
  });
});

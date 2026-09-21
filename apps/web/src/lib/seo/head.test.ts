import { describe, expect, it } from "vitest";
import { buildHead, HOME_SHARE_IMAGE, SHARE_IMAGE, shareImagePath } from "./head";
import { fileUrl, pageUrl, pathOfSiteUrl } from "./urls";

describe("absolute URLs", () => {
  it("builds page URLs on the production domain, with a trailing slash", () => {
    expect(pageUrl("/")).toBe("https://networksinsights.com/");
    expect(pageUrl("/tools/")).toBe("https://networksinsights.com/tools/");
    expect(pageUrl("/word-counter/")).toBe("https://networksinsights.com/word-counter/");
    expect(pageUrl("/base64-encoder/")).toBe("https://networksinsights.com/base64-encoder/");
  });

  it("refuses a path that is not a canonical page path", () => {
    for (const bad of [
      "/tools", // no trailing slash
      "tools/", // no leading slash
      "/Tools/", // capitals
      "/tools/?q=1", // a query
      "/tools/#top", // a fragment
      "//evil.example/", // a host in disguise
      "https://networksinsights.com/", // already absolute
      "/a b/",
      "",
    ]) {
      expect(() => pageUrl(bad), bad).toThrow(/Not a page path/);
    }
  });

  it("builds file URLs, and refuses page paths and odd paths", () => {
    expect(fileUrl("/og/word-counter.png")).toBe(
      "https://networksinsights.com/og/word-counter.png",
    );
    expect(fileUrl("/robots.txt")).toBe("https://networksinsights.com/robots.txt");
    expect(fileUrl("/sitemap-index.xml")).toBe("https://networksinsights.com/sitemap-index.xml");
    for (const bad of ["/tools/", "/og/x", "og/x.png", "/og/../x.png", "/x.png?v=1"]) {
      expect(() => fileUrl(bad), bad).toThrow(/Not a file path/);
    }
  });

  it("reads the path of a URL on this site and nothing else", () => {
    expect(pathOfSiteUrl("https://networksinsights.com/tools/")).toBe("/tools/");
    expect(pathOfSiteUrl("https://pr-9-networksinsights.x.workers.dev/tools/")).toBeUndefined();
  });
});

describe("share image paths", () => {
  it("puts every image under /og/ as a PNG", () => {
    expect(shareImagePath("pdf-tools")).toBe("/og/pdf-tools.png");
    expect(HOME_SHARE_IMAGE).toBe("/og/home.png");
  });

  it("draws every image at 1200 by 630", () => {
    expect(SHARE_IMAGE).toEqual({ width: 1200, height: 630, type: "image/png" });
  });
});

const image = { path: "/og/word-counter.png", alt: "Word counter" };
const base = {
  title: "Word counter — Free online tool | NetworksInsights",
  description: "Count the words in any text.",
  path: "/word-counter/" as string | undefined,
  noindex: false,
  image,
};

describe("buildHead: an indexable page", () => {
  const head = buildHead(base);
  const og = Object.fromEntries(head.openGraph.map((tag) => [tag.property, tag.content]));
  const tw = Object.fromEntries(head.twitter.map((tag) => [tag.name, tag.content]));

  it("has an absolute canonical URL on the production domain", () => {
    expect(head.canonical).toBe("https://networksinsights.com/word-counter/");
  });

  it("has the four required Open Graph properties and the recommended ones", () => {
    expect(og["og:type"]).toBe("website");
    expect(og["og:title"]).toBe(base.title);
    expect(og["og:url"]).toBe(head.canonical);
    expect(og["og:image"]).toBe("https://networksinsights.com/og/word-counter.png");
    expect(og["og:description"]).toBe(base.description);
    expect(og["og:site_name"]).toBe("NetworksInsights");
    expect(og["og:locale"]).toBe("en_US");
    expect(og["og:image:width"]).toBe("1200");
    expect(og["og:image:height"]).toBe("630");
    expect(og["og:image:type"]).toBe("image/png");
    expect(og["og:image:alt"]).toBe("Word counter");
  });

  it("has a large-image Twitter/X card that repeats the same words", () => {
    expect(tw["twitter:card"]).toBe("summary_large_image");
    expect(tw["twitter:title"]).toBe(base.title);
    expect(tw["twitter:description"]).toBe(base.description);
    expect(tw["twitter:image"]).toBe(og["og:image"]);
    expect(tw["twitter:image:alt"]).toBe("Word counter");
  });

  it("invents no Twitter account", () => {
    expect(Object.keys(tw)).not.toContain("twitter:site");
    expect(Object.keys(tw)).not.toContain("twitter:creator");
  });

  it("gives every tag a non-empty content", () => {
    for (const tag of [...head.openGraph, ...head.twitter]) expect(tag.content).not.toBe("");
  });
});

describe("buildHead: a page that is not a canonical object", () => {
  it("gets no canonical and no og:url when it opts out of indexing", () => {
    const head = buildHead({ ...base, noindex: true, path: undefined });
    expect(head.canonical).toBeUndefined();
    expect(head.openGraph.map((tag) => tag.property)).not.toContain("og:url");
    // It still has a share card, so a link to it previews properly.
    expect(head.openGraph.map((tag) => tag.property)).toContain("og:image");
    expect(head.twitter.map((tag) => tag.name)).toContain("twitter:card");
  });

  it("drops the canonical of a noindex page even when it knows its path", () => {
    expect(buildHead({ ...base, noindex: true }).canonical).toBeUndefined();
  });

  it("refuses an indexable page that has no path", () => {
    expect(() => buildHead({ ...base, path: undefined })).toThrow(/no canonical URL/);
  });
});

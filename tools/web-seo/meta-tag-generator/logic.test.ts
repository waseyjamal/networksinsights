import { describe, expect, it } from "vitest";
import { displayUrl, escapeHtml, type Input, isAbsoluteHttpUrl, MAX_FIELD, run } from "./logic";

const base: Input = {
  title: "Fresh Sourdough Bread",
  description: "Order a fresh sourdough loaf, baked every morning.",
  canonical: "https://example.com/bread/sourdough",
  robots: "index, follow",
  siteName: "Example Bakery",
  ogType: "website",
  image: "",
  imageAlt: "",
  twitterCard: "summary",
  twitterSite: "",
};

describe("run", () => {
  it("writes every tag of the example, in order", () => {
    const result = run(base);
    expect(result.ok && result.html.split("\n")).toEqual([
      "<title>Fresh Sourdough Bread</title>",
      '<meta name="description" content="Order a fresh sourdough loaf, baked every morning.">',
      '<meta name="robots" content="index, follow">',
      '<link rel="canonical" href="https://example.com/bread/sourdough">',
      '<meta property="og:type" content="website">',
      '<meta property="og:title" content="Fresh Sourdough Bread">',
      '<meta property="og:description" content="Order a fresh sourdough loaf, baked every morning.">',
      '<meta property="og:url" content="https://example.com/bread/sourdough">',
      '<meta property="og:site_name" content="Example Bakery">',
      '<meta name="twitter:card" content="summary">',
      '<meta name="twitter:title" content="Fresh Sourdough Bread">',
      '<meta name="twitter:description" content="Order a fresh sourdough loaf, baked every morning.">',
    ]);
  });

  it("adds image, alt text and handle tags, with one @", () => {
    const result = run({
      ...base,
      image: "https://example.com/og.png",
      imageAlt: "A loaf",
      twitterCard: "summary_large_image",
      twitterSite: "example",
    });
    if (!result.ok) throw new Error("expected tags");
    expect(result.html).toContain(
      '<meta property="og:image" content="https://example.com/og.png">',
    );
    expect(result.html).toContain('<meta name="twitter:image:alt" content="A loaf">');
    expect(result.html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(result.html).toContain('<meta name="twitter:site" content="@example">');
  });

  it("escapes quotes and angle brackets so the tags stay valid", () => {
    const result = run({ ...base, title: 'Tom & "Jerry" <b>', canonical: "" });
    if (!result.ok) throw new Error("expected tags");
    expect(result.html).toContain("<title>Tom &amp; &quot;Jerry&quot; &lt;b&gt;</title>");
    expect(result.html).not.toContain("canonical");
    expect(result.html).not.toContain("og:url");
  });

  it("needs a title and a description, and full URLs", () => {
    expect(
      run({ ...base, title: " ", description: "", canonical: "/bread", image: "x.png" }),
    ).toEqual({
      ok: false,
      errors: {
        title: "Enter a title.",
        description: "Enter a description.",
        canonical: "Use a full address that starts with https:// or http://.",
        image: "Use a full address that starts with https:// or http://.",
      },
    });
  });

  it("refuses a handle that is too long or has other characters", () => {
    expect(run({ ...base, twitterSite: "@a_handle_of_16ch" }).ok).toBe(false);
    expect(run({ ...base, twitterSite: "@fifteen_chars15" }).ok).toBe(true);
    expect(run({ ...base, twitterSite: "@bad-handle" }).ok).toBe(false);
  });

  it("takes a field of exactly the cap and refuses one character more", () => {
    expect(run({ ...base, description: "a".repeat(MAX_FIELD) }).ok).toBe(true);
    const over = run({ ...base, description: "a".repeat(MAX_FIELD + 1) });
    expect(over.ok === false && over.errors.description).toBe("Keep this under 2000 characters.");
  });
});

describe("helpers", () => {
  it("escapes the five characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("knows a full URL", () => {
    expect(isAbsoluteHttpUrl("https://example.com")).toBe(true);
    expect(isAbsoluteHttpUrl("ftp://example.com")).toBe(false);
    expect(isAbsoluteHttpUrl("https://localhost")).toBe(false);
    expect(isAbsoluteHttpUrl("javascript:alert(1)")).toBe(false);
  });

  it("shows the URL as host and path parts", () => {
    expect(displayUrl("https://Example.com/bread/sourdough?x=1")).toBe(
      "example.com › bread › sourdough",
    );
    expect(displayUrl("nope")).toBe("");
  });
});

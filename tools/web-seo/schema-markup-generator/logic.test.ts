import { describe, expect, it } from "vitest";
import { type Input, isDate, isUrl, LIMITS, run } from "./logic";

const product: Input = {
  type: "Product",
  values: {
    name: "Sourdough Loaf",
    price: "6.50",
    priceCurrency: "gbp",
    availability: "InStock",
    brand: "Example Bakery",
  },
  questions: [],
};

const parse = (result: ReturnType<typeof run>) => {
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return JSON.parse(result.json);
};

describe("run", () => {
  it("writes the Product example of the page", () => {
    expect(parse(run(product))).toEqual({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Sourdough Loaf",
      brand: { "@type": "Brand", name: "Example Bakery" },
      offers: {
        "@type": "Offer",
        price: "6.50",
        priceCurrency: "GBP",
        availability: "https://schema.org/InStock",
      },
    });
  });

  it("wraps the JSON in a script tag", () => {
    const result = run(product);
    expect(result.ok && result.script.startsWith('<script type="application/ld+json">\n{')).toBe(
      true,
    );
    expect(result.ok && result.script.endsWith("}\n</script>")).toBe(true);
  });

  it("needs a product name and a price", () => {
    expect(run({ ...product, values: {} })).toEqual({
      ok: false,
      errors: { name: "Product name is required.", price: "Price is required." },
    });
    expect(run({ ...product, values: { ...product.values, price: "6,50" } }).ok).toBe(false);
  });

  it("writes an Article with one image as a string and several as a list", () => {
    const one = parse(
      run({
        type: "Article",
        values: { headline: "Hi", image: "https://example.com/a.jpg", authorName: "Sam" },
        questions: [],
      }),
    );
    expect(one.image).toBe("https://example.com/a.jpg");
    expect(one.author).toEqual({ "@type": "Person", name: "Sam" });
    const two = parse(
      run({
        type: "Article",
        values: { image: "https://example.com/a.jpg\nhttps://example.com/b.jpg" },
        questions: [],
      }),
    );
    expect(two.image).toHaveLength(2);
  });

  it("refuses an empty Article, a bad date and a relative image", () => {
    expect(run({ type: "Article", values: {}, questions: [] }).ok).toBe(false);
    const bad = run({
      type: "Article",
      values: { headline: "Hi", datePublished: "2026-02-30", image: "/a.jpg" },
      questions: [],
    });
    expect(bad.ok === false && Object.keys(bad.errors)).toEqual(["image", "datePublished"]);
  });

  it("writes a FAQPage and takes 20 questions but not 21 or none", () => {
    const pairs = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ question: `Q${i}?`, answer: `A${i}.` }));
    const faq = parse(run({ type: "FAQPage", values: {}, questions: pairs(1) }));
    expect(faq.mainEntity).toEqual([
      { "@type": "Question", name: "Q0?", acceptedAnswer: { "@type": "Answer", text: "A0." } },
    ]);
    expect(run({ type: "FAQPage", values: {}, questions: pairs(LIMITS.maxQuestions) }).ok).toBe(
      true,
    );
    expect(run({ type: "FAQPage", values: {}, questions: pairs(21) }).ok).toBe(false);
    expect(run({ type: "FAQPage", values: {}, questions: [] }).ok).toBe(false);
    expect(
      run({ type: "FAQPage", values: {}, questions: [{ question: "Q?", answer: " " }] }),
    ).toEqual({ ok: false, errors: { "answer-0": "Question 1 needs an answer." } });
  });

  it("writes a LocalBusiness address and needs street and town", () => {
    const shop = parse(
      run({
        type: "LocalBusiness",
        values: {
          name: "Bakery",
          streetAddress: "1 High St",
          addressLocality: "Leeds",
          addressCountry: "gb",
        },
        questions: [],
      }),
    );
    expect(shop.address).toEqual({
      "@type": "PostalAddress",
      streetAddress: "1 High St",
      addressLocality: "Leeds",
      addressCountry: "GB",
    });
    expect(run({ type: "LocalBusiness", values: { name: "B" }, questions: [] }).ok).toBe(false);
  });

  it("writes an Organization with sameAs as a list", () => {
    const org = parse(
      run({
        type: "Organization",
        values: { name: "Example", sameAs: "https://example.social/a\n\nhttps://example.social/b" },
        questions: [],
      }),
    );
    expect(org.sameAs).toEqual(["https://example.social/a", "https://example.social/b"]);
  });

  it("escapes < so a value cannot close the script early", () => {
    const result = run({ ...product, values: { ...product.values, name: "</script><b>" } });
    expect(result.ok && result.script).not.toContain("</script><b>");
    expect(parse(result).name).toBe("</script><b>");
  });

  it("takes a field of exactly the cap and refuses one character more", () => {
    const at = run({
      ...product,
      values: { ...product.values, brand: "a".repeat(LIMITS.maxField) },
    });
    expect(at.ok).toBe(true);
    const over = run({
      ...product,
      values: { ...product.values, brand: "a".repeat(LIMITS.maxField + 1) },
    });
    expect(over.ok === false && over.errors.brand).toBe("Keep this under 2000 characters.");
  });
});

describe("checks", () => {
  it("knows real dates and full URLs", () => {
    expect(isDate("2024-02-29")).toBe(true);
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("2026-1-1")).toBe(false);
    expect(isUrl("https://example.com/x")).toBe(true);
    expect(isUrl("example.com")).toBe(false);
  });
});

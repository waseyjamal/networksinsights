import { describe, expect, it } from "vitest";
import { iconPaths } from "../components/ui/icons";
import tokensCss from "../styles/tokens.css?raw";
import { categories, categoryHref, categoryMetaDescription, reservedPaths } from "./categories";
import { staticPagePaths } from "./site";

const slugs = [
  "pdf-tools",
  "image-tools",
  "video-audio-tools",
  "text-tools",
  "calculators",
  "converters",
  "generators",
  "developer-tools",
  "web-seo-tools",
  "color-design-tools",
  "date-time-tools",
];

const unique = (values: readonly string[]) => new Set(values).size === values.length;
const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean);

describe("categories config", () => {
  it("has the eleven categories, with the agreed slugs", () => {
    expect(categories).toHaveLength(11);
    expect(categories.map((category) => category.slug)).toEqual(slugs);
  });

  it("has unique ids, slugs, names, descriptions, intros and meta descriptions", () => {
    for (const field of [
      "id",
      "slug",
      "name",
      "description",
      "intro",
      "metaDescription",
    ] as const) {
      expect(unique(categories.map((category) => category[field])), field).toBe(true);
    }
  });

  it("uses kebab-case slugs", () => {
    for (const category of categories) expect(category.slug).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
  });

  it("collides with no other page", () => {
    for (const category of categories) {
      expect(staticPagePaths as readonly string[], category.slug).not.toContain(category.slug);
    }
    expect(unique(reservedPaths)).toBe(true);
    for (const path of [...slugs, ...staticPagePaths]) expect(reservedPaths).toContain(path);
  });

  it("links to /<slug>/", () => {
    expect(categoryHref({ slug: "pdf-tools" })).toBe("/pdf-tools/");
  });

  it("matches each accent to a color token and each icon to an icon", () => {
    for (const category of categories) {
      expect(category.accent).toBe(`cat-${category.id}`);
      expect(tokensCss, category.accent).toContain(`--color-${category.accent}:`);
      expect(Object.keys(iconPaths), category.icon).toContain(category.icon);
      expect(category.icon).toBe(category.id);
    }
  });

  it("writes two to three sentences of intro, and no filler", () => {
    for (const category of categories) {
      const count = sentences(category.intro).length;
      expect(count, category.id).toBeGreaterThanOrEqual(2);
      expect(count, category.id).toBeLessThanOrEqual(3);
    }
  });

  it("keeps meta descriptions under 160 characters", () => {
    for (const category of categories) {
      expect(category.metaDescription.length, category.id).toBeGreaterThan(50);
      expect(category.metaDescription.length, category.id).toBeLessThan(160);
    }
  });

  it("invents no counts: no digits in any category text", () => {
    for (const category of categories) {
      for (const text of [category.description, category.intro, category.metaDescription]) {
        expect(text, category.id).not.toMatch(/\d/);
      }
    }
  });
});

describe("category meta descriptions with real counts", () => {
  it("adds the number of tools, or says Coming soon when there is none", () => {
    const pdf = { metaDescription: "Free PDF tools, right in your browser." };
    expect(categoryMetaDescription(pdf, 6)).toBe(
      "Free PDF tools, right in your browser. 6 tools on NetworksInsights.",
    );
    expect(categoryMetaDescription(pdf, 1)).toBe(
      "Free PDF tools, right in your browser. 1 tool on NetworksInsights.",
    );
    expect(categoryMetaDescription(pdf, 0)).toBe(
      "Free PDF tools, right in your browser. Coming soon to NetworksInsights.",
    );
  });

  it("stays under 160 characters for every category, up to 999 tools", () => {
    for (const category of categories) {
      for (const count of [0, 1, 999]) {
        expect(categoryMetaDescription(category, count).length, category.id).toBeLessThan(160);
      }
    }
  });

  it("never says Coming soon in the fixed text", () => {
    for (const category of categories) {
      for (const text of [category.description, category.intro, category.metaDescription]) {
        expect(text, category.id).not.toMatch(/coming soon/i);
      }
    }
  });
});

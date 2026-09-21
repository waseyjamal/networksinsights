import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { categories } from "../../config/categories";
import { homeHero } from "../../config/site";
import tokensCss from "../../styles/tokens.css?raw";
import { SHARE_IMAGE } from "./head";
import {
  cardNode,
  categoryCard,
  homeCard,
  type ShareCard,
  shareAlt,
  shareCards,
  shareImageOf,
  sharePalette,
  titleSize,
  toolCard,
} from "./og";
import { cacheKeyOf, measureShareCard, queueShareImages, renderShareImage } from "./og-render";
import { manyTools, toolOf } from "./test-tools";

/** Reads the width and height from a PNG's IHDR chunk, and checks the signature. */
function pngSize(png: Uint8Array) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  expect([...png.slice(0, 8)]).toEqual(signature);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect(String.fromCharCode(...png.slice(12, 16))).toBe("IHDR");
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("which cards there are", () => {
  it("has the home card, one for every category and one for every tool", () => {
    const tools = [toolOf("word-counter", "text"), toolOf("merge-pdf", "pdf")];
    const slugs = shareCards(tools).map((card) => card.slug);
    expect(slugs).toEqual([
      "home",
      ...categories.map((category) => category.slug),
      "word-counter",
      "merge-pdf",
    ]);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("says only what the page says", () => {
    expect(homeCard.title).toBe(homeHero.headline);
    expect(homeCard.subtitle).toBe(homeHero.lead);
    const tool = toolOf("word-counter", "text");
    expect(toolCard(tool)).toEqual({
      slug: "word-counter",
      title: tool.manifest.name,
      subtitle: tool.manifest.summary,
      label: "Text tools",
    });
    const category = categories[0];
    if (!category) throw new Error("no categories");
    expect(categoryCard(category)).toEqual({
      slug: category.slug,
      title: category.name,
      subtitle: category.description,
    });
  });

  it("has an image path and an alt text for each card", () => {
    expect(shareImageOf(homeCard).path).toBe("/og/home.png");
    expect(shareImageOf(toolCard(toolOf("word-counter"))).path).toBe("/og/word-counter.png");
    expect(shareAlt(homeCard)).toContain(homeHero.headline);
  });
});

describe("the palette", () => {
  const palette = sharePalette();

  it("is read from tokens.css, in the dark theme", () => {
    for (const color of [palette.bg, palette.fg, palette.fgMuted, palette.brand]) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
    for (const color of [palette.glowPrimary, palette.glowSecondary]) {
      expect(color).toMatch(/^#[0-9a-f]{8}$/);
    }
    // The dark background is a deep navy, never pure black, like the theme-color meta.
    expect(palette.bg).not.toBe("#000000");
    expect(palette.fg).not.toBe(palette.bg);
  });

  it("fails loudly when a token the card needs is gone", () => {
    expect(() => sharePalette(tokensCss.replaceAll("--brand-soft", "--brand-gone"))).toThrow(
      /brand-soft/,
    );
  });
});

describe("the layout", () => {
  it("shrinks a long title so it stays on the card", () => {
    expect(titleSize("Word counter")).toBeGreaterThan(
      titleSize("Word and character counter with a live preview"),
    );
    expect(titleSize("x".repeat(60))).toBeGreaterThanOrEqual(56);
  });

  it("builds a tree that is exactly the size of the image", () => {
    const node = cardNode(homeCard);
    expect(node.type).toBe("container");
    expect(node.style).toMatchObject({ width: 1200, height: 630 });
  });

  it("keeps the longest allowed name and summary inside the padding", async () => {
    // 60 characters is the longest name; 159 the longest summary (docs/tool-contract.md).
    const longest = {
      slug: "x",
      title: `${"N".repeat(59)}n`,
      subtitle: "Summary words ".repeat(20).slice(0, 159),
      label: "Video and audio tools",
    };
    const layout = await measureShareCard(longest);
    const bottoms = layout.children.map((child) => child.transform[5] + child.height);
    for (const bottom of bottoms)
      expect(bottom, "content must end above the bottom padding").toBeLessThanOrEqual(630 - 72 + 1);
    const tops = layout.children.map((child) => child.transform[5]);
    expect(Math.min(...tops)).toBeGreaterThanOrEqual(72 - 1);
  });
});

describe("rendering", () => {
  it("draws a 1200 by 630 PNG", async () => {
    const png = await renderShareImage(homeCard);
    expect(pngSize(png)).toEqual({ width: SHARE_IMAGE.width, height: SHARE_IMAGE.height });
    expect(png.length).toBeGreaterThan(5_000);
    // A large card can be up to 5 MB on X. These are simple and far smaller.
    expect(png.length).toBeLessThan(500_000);
  });

  it("draws the same bytes for the same card, so a rebuild changes nothing", async () => {
    const card = toolCard(toolOf("word-counter", "text"));
    const first = await renderShareImage(card);
    const second = await renderShareImage(card);
    expect(Buffer.compare(first, second)).toBe(0);
  });

  it("draws different pictures for different cards", async () => {
    const one = await renderShareImage(toolCard(toolOf("word-counter", "text")));
    const two = await renderShareImage(toolCard(toolOf("merge-pdf", "pdf")));
    expect(Buffer.compare(one, two)).not.toBe(0);
  });
});

describe("the cache and the background queue", () => {
  const folder = () => mkdtempSync(join(tmpdir(), "ni-share-"));
  const cards = [
    homeCard,
    toolCard(toolOf("word-counter", "text")),
    toolCard(toolOf("merge-pdf", "pdf")),
  ];

  it("keys a card by everything that decides its pixels, so equal cards share a key", async () => {
    const same = await Promise.all([
      cacheKeyOf(cards[1] as ShareCard),
      cacheKeyOf(cards[1] as ShareCard),
    ]);
    expect(same[0]).toBe(same[1]);
    expect(same[0]).toMatch(/^[0-9a-f]{64}$/);
    const other = await cacheKeyOf({ ...(cards[1] as ShareCard), subtitle: "A different line." });
    expect(other).not.toBe(same[0]);
    expect(await cacheKeyOf({ ...(cards[1] as ShareCard), title: "Another name" })).not.toBe(
      same[0],
    );
  });

  it("writes an image once, reads it back the second time, and redraws only a changed card", async () => {
    const dir = folder();
    const card = cards[1] as ShareCard;
    const first = await renderShareImage(card, dir);
    const [file] = readdirSync(dir);
    expect(readdirSync(dir)).toHaveLength(1);
    expect(file).toMatch(/^[0-9a-f]{64}\.png$/);
    const written = statSync(join(dir, file ?? "")).mtimeMs;

    const second = await renderShareImage(card, dir);
    expect(Buffer.compare(first, second)).toBe(0);
    expect(statSync(join(dir, file ?? "")).mtimeMs).toBe(written);
    expect(readdirSync(dir)).toHaveLength(1);

    await renderShareImage({ ...card, subtitle: "Changed words." }, dir);
    expect(readdirSync(dir)).toHaveLength(2);
    rmSync(dir, { recursive: true });
  });

  it("leaves no half-written file behind", async () => {
    const dir = folder();
    await renderShareImage(cards[0] as ShareCard, dir);
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    rmSync(dir, { recursive: true });
  });

  it("draws queued cards in the background and hands each one over, the same as drawing it directly", async () => {
    const dir = folder();
    const queuedCards = cards.map((card) => ({ ...card, slug: `queued-${card.slug}` }));
    queueShareImages(queuedCards, dir);
    for (const card of queuedCards) {
      const png = await renderShareImage(card);
      expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
      expect(
        Buffer.compare(png, await renderShareImage({ ...card, slug: `direct-${card.slug}` })),
      ).toBe(0);
    }
    expect(readdirSync(dir).length).toBeGreaterThan(0);
    rmSync(dir, { recursive: true });
  });

  it("does not queue a card twice", async () => {
    const card = { ...(cards[0] as ShareCard), slug: "queued-once" };
    queueShareImages([card]);
    queueShareImages([card]);
    expect(pngSize(await renderShareImage(card))).toEqual({ width: 1200, height: 630 });
  });
});

describe("at scale", () => {
  it("draws 300 cards in the background pool, then reads them back from the cache", {
    tags: ["slow"],
    timeout: 180_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "ni-share-scale-"));
    const many = manyTools(300, ["text", "pdf", "image"]).map(toolCard);

    const coldStart = performance.now();
    queueShareImages(many, dir);
    for (const card of many) await renderShareImage(card);
    const cold = performance.now() - coldStart;

    const warmStart = performance.now();
    queueShareImages(many, dir);
    for (const card of many) await renderShareImage(card);
    const warm = performance.now() - warmStart;

    console.log(
      `300 share images: ${(cold / 1000).toFixed(1)} s drawn (${(cold / 300).toFixed(0)} ms each), ${(warm / 1000).toFixed(2)} s from the cache; 1,000 would be about ${(((cold / 300) * 1000) / 1000).toFixed(0)} s drawn`,
    );
    expect(readdirSync(dir)).toHaveLength(300);
    expect(warm).toBeLessThan(cold / 3);
    rmSync(dir, { recursive: true });
  });
});

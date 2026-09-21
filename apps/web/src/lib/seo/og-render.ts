// Draws a share card to a PNG (ADR 0041). This is the only file that touches the native renderer.
//
// The renderer is Takumi (@takumi-rs/core): it turns the box-and-text tree of og.ts into pixels
// without a browser. The typeface is the site's own Geist, the same variable woff2 file the pages
// load, so a share image and a page look like one product. One renderer and one registered font
// are shared by every image of a build.
//
// Two things keep a build of a large site fast. The cards are drawn a few at a time in the
// background (`queueShareImages`), and a card that has not changed is read back from a cache
// folder instead of being drawn again. The cache key is a hash of everything that decides the
// pixels (the box-and-text tree, the font file and the renderer's version), so a card is redrawn
// exactly when it would come out different, and never served stale.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import geistDataUri from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?inline";
import { Renderer } from "@takumi-rs/core";
import { SHARE_IMAGE } from "./head";
import { cardNode, type ShareCard, type SharePalette, sharePalette } from "./og";

/** Where drawn images are kept between builds. `node_modules/.cache` is not in git. */
export const defaultCacheDir = () => join(process.cwd(), "node_modules", ".cache", "share-images");

let ready: Promise<{ renderer: Renderer; palette: SharePalette; salt: string }> | undefined;

/** The bytes of a `data:` URI. Vite inlines the font file as one (`?inline`). */
function bytesOfDataUri(uri: string): Buffer {
  const comma = uri.indexOf(",");
  if (!uri.startsWith("data:") || comma === -1) {
    throw new Error("Expected a data: URI for the font");
  }
  return Buffer.from(
    uri.slice(comma + 1),
    uri.slice(0, comma).endsWith(";base64") ? "base64" : "utf8",
  );
}

/** The installed version of the renderer, read from its package.json, or "unknown". */
function rendererVersion(): string {
  try {
    const file = join(process.cwd(), "node_modules", "@takumi-rs", "core", "package.json");
    return String((JSON.parse(readFileSync(file, "utf8")) as { version?: string }).version);
  } catch {
    return "unknown";
  }
}

function setup() {
  ready ??= (async () => {
    const font = bytesOfDataUri(geistDataUri);
    const renderer = new Renderer();
    await renderer.registerFont({ name: "Geist", data: font });
    // Everything that decides the pixels and is not in the card's own tree.
    const salt = createHash("sha256").update(font).update(rendererVersion()).digest("hex");
    return { renderer, palette: sharePalette(), salt };
  })();
  return ready;
}

/** The cache key of a card: a hash of its tree, the font and the renderer's version. */
export async function cacheKeyOf(card: ShareCard): Promise<string> {
  const { palette, salt } = await setup();
  return createHash("sha256")
    .update(salt)
    .update(JSON.stringify(cardNode(card, palette)))
    .digest("hex");
}

async function draw(card: ShareCard, cacheDir: string | undefined): Promise<Buffer> {
  const { renderer, palette } = await setup();
  const file = cacheDir === undefined ? undefined : join(cacheDir, `${await cacheKeyOf(card)}.png`);
  if (file !== undefined && existsSync(file)) return readFileSync(file);

  const png = await renderer.render(cardNode(card, palette), {
    width: SHARE_IMAGE.width,
    height: SHARE_IMAGE.height,
    format: "png",
  });
  if (file !== undefined && cacheDir !== undefined) {
    // Written under another name and moved into place, so a build that stops halfway never leaves
    // a cache file that is only part of an image.
    mkdirSync(cacheDir, { recursive: true });
    const partial = `${file}.${randomUUID()}.tmp`;
    writeFileSync(partial, png);
    renameSync(partial, file);
  }
  return png;
}

/** Images that were queued and have not been asked for yet, by slug. */
const queued = new Map<string, Promise<Buffer>>();

/**
 * How many cards are drawn at once. The renderer draws on native threads, and Node gives them a
 * pool of four by default, so more than four at a time only waits in line.
 */
const CONCURRENCY = Math.min(4, Math.max(1, availableParallelism()));

/**
 * Starts drawing every card in the background, a few at a time, and returns at once.
 * `renderShareImage` then finds each card ready, or waits for it. Asked for one by one, as each
 * page comes up in the build, a card costs about 160 ms: 160 seconds for a thousand tools. Drawn
 * four at a time they overlap, which keeps the build of a large site from being mostly images
 * (ADR 0041).
 */
export function queueShareImages(cards: readonly ShareCard[], cacheDir?: string): void {
  const todo = cards.filter((card) => !queued.has(card.slug));
  const settle = new Map<
    string,
    { resolve: (png: Buffer) => void; reject: (error: unknown) => void }
  >();
  for (const card of todo) {
    const promise = new Promise<Buffer>((resolve, reject) => {
      settle.set(card.slug, { resolve, reject });
    });
    // A card that nobody asks for must not become an unhandled rejection.
    promise.catch(() => {});
    queued.set(card.slug, promise);
  }

  let cursor = 0;
  const worker = async () => {
    for (let card = todo[cursor++]; card !== undefined; card = todo[cursor++]) {
      const job = settle.get(card.slug);
      try {
        job?.resolve(await draw(card, cacheDir));
      } catch (error) {
        job?.reject(error);
      }
    }
  };
  for (let index = 0; index < CONCURRENCY; index++) void worker();
}

/**
 * The PNG of one card, 1200 by 630. The same card always gives the same bytes. Give `cacheDir`
 * to keep drawn images between runs.
 */
export async function renderShareImage(card: ShareCard, cacheDir?: string): Promise<Buffer> {
  const started = queued.get(card.slug);
  if (started === undefined) return draw(card, cacheDir);
  queued.delete(card.slug);
  return started;
}

/** The layout of a card: where every box and line of text lands. Used by the tests. */
export async function measureShareCard(card: ShareCard) {
  const { renderer, palette } = await setup();
  return renderer.measure(cardNode(card, palette), {
    width: SHARE_IMAGE.width,
    height: SHARE_IMAGE.height,
  });
}

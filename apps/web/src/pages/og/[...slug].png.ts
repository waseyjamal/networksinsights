// The share images: /og/home.png, /og/<category-slug>.png and /og/<tool-id>.png, drawn at build
// time from the same data as the pages (ADR 0041). `og` is a reserved path, so no tool can take it.

import type { APIRoute, GetStaticPaths } from "astro";
import { tools } from "../../lib/registry";
import { shareCards } from "../../lib/seo/og";
import { defaultCacheDir, queueShareImages, renderShareImage } from "../../lib/seo/og-render";

// A build keeps drawn images in node_modules/.cache, so a card that has not changed is not drawn
// again. The dev server draws a card when it is asked for and keeps nothing.
const cacheDir = import.meta.env.PROD ? defaultCacheDir() : undefined;

export const getStaticPaths = (() => {
  const cards = shareCards(tools);
  // In a build every image is drawn, a few at a time, before the pages ask for them. In the dev
  // server it is drawn when asked for, so opening one page does not draw a thousand.
  if (import.meta.env.PROD) queueShareImages(cards, cacheDir);
  return cards.map((card) => ({ params: { slug: card.slug }, props: { card } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) =>
  new Response(new Uint8Array(await renderShareImage(props.card, cacheDir)), {
    headers: { "Content-Type": "image/png" },
  });

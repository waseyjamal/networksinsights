// /favicon.ico: for the browsers and tools that ask for it without reading the page (ADR 0052).
// PNG images of the `any` icon at 16, 32 and 48 pixels in one ICO file.

import type { APIRoute } from "astro";
import { renderIcon } from "../lib/pwa/icon-render";
import { icoOf } from "../lib/pwa/icons";

const SIZES = [16, 32, 48] as const;

export const GET: APIRoute = async () => {
  const images = await Promise.all(
    SIZES.map(async (size) => ({ size, png: await renderIcon({ size, purpose: "any" }) })),
  );
  return new Response(new Uint8Array(icoOf(images)), {
    headers: { "Content-Type": "image/x-icon" },
  });
};

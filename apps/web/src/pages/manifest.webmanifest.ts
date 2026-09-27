// /manifest.webmanifest: what a browser reads to install the site as an app (ADR 0052).

import type { APIRoute } from "astro";
import { webManifest } from "../lib/pwa/manifest";

export const GET: APIRoute = () =>
  new Response(JSON.stringify(webManifest(), null, 2), {
    headers: { "Content-Type": "application/manifest+json" },
  });

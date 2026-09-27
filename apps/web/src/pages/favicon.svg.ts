// /favicon.svg: the constellation mark, drawn from the same data as the app icons (ADR 0052).

import type { APIRoute } from "astro";
import { faviconSvg } from "../lib/pwa/icons";

export const GET: APIRoute = () =>
  new Response(faviconSvg(), { headers: { "Content-Type": "image/svg+xml" } });

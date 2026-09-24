// The search index, at /search-index.<content hash>.json (ADR 0045). Nothing links to it as a
// script or a preload: the browser asks for it only when a visitor shows intent to search
// (ADR 0046). Because the name carries the hash of the content, it can be cached for good.

import type { APIRoute, GetStaticPaths } from "astro";
import { siteSearchIndex } from "../lib/search/site-index";

export const getStaticPaths = (() => [
  { params: { hash: siteSearchIndex.hash } },
]) satisfies GetStaticPaths;

export const GET: APIRoute = () =>
  new Response(siteSearchIndex.json, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

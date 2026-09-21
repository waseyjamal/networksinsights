// /robots.txt, generated from config/crawlers.ts and the launch flag (ADR 0040).

import type { APIRoute } from "astro";
import { crawlers, trainingPolicy } from "../config/crawlers";
import { site } from "../config/site";
import { buildRobotsTxt } from "../lib/seo/robots-txt";

export const GET: APIRoute = () =>
  new Response(buildRobotsTxt({ launched: site.launched, crawlers, trainingPolicy }), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });

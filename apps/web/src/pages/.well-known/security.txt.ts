// /.well-known/security.txt (RFC 9116), generated from lib/seo/security-txt.ts.

import type { APIRoute } from "astro";
import { securityTxtBody } from "../../lib/seo/security-txt";

export const GET: APIRoute = () =>
  new Response(securityTxtBody(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });

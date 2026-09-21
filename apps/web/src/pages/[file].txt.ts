// The generated text files that exist only after launch (ADR 0040, ADR 0042): /llms.txt, and the
// IndexNow key file /<key>.txt. One route serves both because two routes of the same shape would
// collide; `robots.txt` has its own route and always exists.
//
// Before launch `getStaticPaths` returns an empty list, so neither file is built. The key comes
// from the INDEXNOW_KEY variable of the CI build (docs/runbooks/indexnow.md). It is public by
// design, since the file that proves ownership contains it, but it is checked before it is
// written: a key that is not 8 to 128 letters, digits or dashes is never turned into a file.

import type { APIRoute, GetStaticPaths } from "astro";
import { site } from "../config/site";
import { tools } from "../lib/registry";
import { isValidKey } from "../lib/seo/indexnow";
import { buildLlmsTxt } from "../lib/seo/llms-txt";

type Props = { body: string };

export const getStaticPaths = (() => {
  if (!site.launched) return [];
  const key = process.env.INDEXNOW_KEY?.trim();
  return [
    { params: { file: "llms" }, props: { body: buildLlmsTxt(tools) } },
    ...(isValidKey(key) && key !== "llms" ? [{ params: { file: key }, props: { body: key } }] : []),
  ];
}) satisfies GetStaticPaths;

export const GET: APIRoute<Props> = ({ props }) =>
  new Response(props.body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });

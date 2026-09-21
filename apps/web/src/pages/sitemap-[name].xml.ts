// The sitemap index and the sitemaps it lists: /sitemap-index.xml, /sitemap-pages.xml,
// /sitemap-categories.xml and /sitemap-tools.xml (more of the last one past 50,000 tools).
//
// One route serves them all, so that before launch it can emit none: `getStaticPaths` returns an
// empty list while `launched` is false (ADR 0040).

import type { APIRoute, GetStaticPaths } from "astro";
import { site } from "../config/site";
import { tools } from "../lib/registry";
import {
  buildSitemapFiles,
  renderSitemapIndex,
  renderUrlset,
  type SitemapFile,
  sitemapsExist,
} from "../lib/seo/sitemap";

type Props = { xml: string };

export const getStaticPaths = (() => {
  if (!sitemapsExist(site.launched)) return [];
  const files: SitemapFile[] = buildSitemapFiles(tools);
  return [
    { params: { name: "index" }, props: { xml: renderSitemapIndex(files) } },
    ...files.map((file) => ({
      params: { name: file.slug },
      props: { xml: renderUrlset(file.entries) },
    })),
  ];
}) satisfies GetStaticPaths;

export const GET: APIRoute<Props> = ({ props }) =>
  new Response(props.xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });

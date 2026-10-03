import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "meta-tag-generator",
  name: "Meta Tag Generator",
  category: "web-seo",
  summary:
    "Write title, description, canonical, robots, Open Graph and Twitter card tags, see an approximate search preview and copy the HTML.",
  tags: ["seo", "meta-tags", "open-graph", "twitter-card", "html"],
  runtime: "client",
  status: "beta",
  input: z.object({
    title: z.string().max(2000),
    description: z.string().max(2000),
    canonical: z.string().max(2000),
    robots: z.enum(["index, follow", "noindex, follow", "index, nofollow", "noindex, nofollow"]),
    siteName: z.string().max(2000),
    ogType: z.enum(["website", "article"]),
    image: z.string().max(2000),
    imageAlt: z.string().max(2000),
    twitterCard: z.enum(["summary", "summary_large_image"]),
    twitterSite: z.string().max(2000),
  }),
  related: ["url-encode-decode", "word-counter"],
  added: "2026-10-03",
  updated: "2026-10-03",
});

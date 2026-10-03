import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "schema-markup-generator",
  name: "Schema Markup Generator",
  category: "web-seo",
  summary:
    "Make JSON-LD structured data for Article, FAQPage, Product, LocalBusiness and Organization from a form, and copy it into your page.",
  tags: ["seo", "schema", "json-ld", "structured-data"],
  runtime: "client",
  status: "beta",
  input: z.object({
    type: z.enum(["Article", "FAQPage", "Product", "LocalBusiness", "Organization"]),
    values: z.record(z.string(), z.string().max(2000)),
    questions: z
      .array(z.object({ question: z.string().max(2000), answer: z.string().max(2000) }))
      .max(20),
  }),
  related: ["meta-tag-generator", "json-formatter"],
  added: "2026-10-03",
  updated: "2026-10-03",
});

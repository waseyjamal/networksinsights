import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS, MAX_PAGES } from "./logic";

export default defineTool({
  id: "delete-reorder-pdf-pages",
  name: "Delete and Reorder PDF Pages",
  category: "pdf",
  summary:
    "Remove pages from a PDF and put the rest in a new order, with page thumbnails, then download the new PDF.",
  tags: ["pdf", "pages", "reorder", "delete", "organize"],
  accepts: ["PDF"],
  produces: ["PDF"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    order: z.array(z.number().int().min(1).max(MAX_PAGES)).min(1).max(MAX_PAGES),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["split-pdf", "merge-pdf", "rotate-pdf", "pdf-to-jpg"],
  added: "2026-10-05",
  updated: "2026-10-05",
});

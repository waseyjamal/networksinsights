import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { FONT_SIZE, FORMATS, LIMITS, MARGIN, POSITIONS, START } from "./logic";

export default defineTool({
  id: "add-page-numbers-to-pdf",
  name: "Add Page Numbers to PDF",
  category: "pdf",
  summary:
    "Number the pages of a PDF: pick the corner or edge, the format such as Page 1 or 1 of 10, the start number and the pages.",
  tags: ["pdf", "page-numbers", "pages", "numbering"],
  accepts: ["PDF"],
  produces: ["PDF"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    position: z.enum(Object.keys(POSITIONS) as [keyof typeof POSITIONS]),
    format: z.enum(Object.keys(FORMATS) as [keyof typeof FORMATS]),
    start: z.number().int().min(START.min).max(START.max),
    firstPage: z.number().int().min(1),
    fontSize: z.number().int().min(FONT_SIZE.min).max(FONT_SIZE.max),
    margin: z.number().int().min(MARGIN.min).max(MARGIN.max),
    which: z.enum(["all", "chosen"]),
    pages: z.string().max(1000),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["merge-pdf", "split-pdf", "rotate-pdf", "delete-reorder-pdf-pages"],
  added: "2026-10-05",
  updated: "2026-10-05",
});

import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "split-pdf",
  name: "Split PDF",
  category: "pdf",
  summary:
    "Split a PDF into smaller PDFs by page ranges such as 1-3, 5, or into one file for every page, in your browser.",
  tags: ["pdf", "split", "extract-pages", "page-ranges"],
  accepts: ["PDF"],
  produces: ["PDF"],
  runtime: "worker",
  status: "beta",
  input: z.object({ mode: z.enum(["ranges", "every"]), ranges: z.string().max(1000) }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["merge-pdf", "rotate-pdf", "pdf-to-jpg"],
  added: "2026-10-02",
  updated: "2026-10-02",
});

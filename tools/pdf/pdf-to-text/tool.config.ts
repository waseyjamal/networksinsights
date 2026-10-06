import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "pdf-to-text",
  name: "PDF to Text",
  category: "pdf",
  summary:
    "Pull the text out of a PDF in your browser: choose the pages, copy the result or download it as a .txt file.",
  tags: ["pdf", "text", "extract", "txt"],
  accepts: ["PDF"],
  produces: ["TXT"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    which: z.enum(["all", "chosen"]),
    pages: z.string().max(1000),
    markPages: z.boolean(),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["ocr", "pdf-to-jpg", "split-pdf", "word-counter"],
  added: "2026-10-06",
  updated: "2026-10-06",
});

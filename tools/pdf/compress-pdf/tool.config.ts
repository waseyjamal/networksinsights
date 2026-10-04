import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LEVEL_KEYS, type Level, LIMITS } from "./logic";

export default defineTool({
  id: "compress-pdf",
  name: "Compress PDF",
  category: "pdf",
  summary:
    "Make a PDF smaller in your browser by recompressing its pictures, while its text stays sharp and selectable.",
  tags: ["pdf", "compress", "reduce", "size", "shrink"],
  accepts: ["PDF"],
  produces: ["PDF"],
  runtime: "worker",
  status: "beta",
  input: z.object({ level: z.enum(LEVEL_KEYS as [Level, ...Level[]]) }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  budget: {
    maxOnDemandJsKb: 2300,
    reason:
      "PDFium, a PDF engine compiled to WebAssembly (about 2.1 MB gzip), loaded only when the visitor presses Compress",
  },
  related: ["merge-pdf", "split-pdf", "compress-image"],
  added: "2026-10-04",
  updated: "2026-10-04",
});

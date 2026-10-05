import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "edit-pdf",
  name: "Edit PDF",
  category: "pdf",
  summary:
    "Add text, pictures, drawings, highlights and white boxes to a PDF in your browser, then save a new copy without uploading it.",
  tags: ["pdf", "edit", "annotate", "text", "highlight"],
  accepts: ["PDF"],
  produces: ["PDF"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    items: z.array(
      z.object({
        kind: z.enum(["text", "image", "drawing", "highlight", "whitebox"]),
        page: z.number().int().min(1).max(LIMITS.maxPages),
      }),
    ),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["sign-pdf", "watermark-pdf", "add-page-numbers-to-pdf"],
  added: "2026-10-05",
  updated: "2026-10-05",
});

import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

const fraction = z.number().min(0).max(1);

export default defineTool({
  id: "redact-pdf",
  name: "Redact PDF",
  category: "pdf",
  summary:
    "Black out parts of a PDF for real in your browser: draw boxes, and the covered pages become pictures with the text under the boxes gone.",
  tags: ["pdf", "redact", "black-out", "privacy", "censor"],
  accepts: ["PDF"],
  produces: ["PDF"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    boxes: z
      .array(
        z.object({
          page: z.number().int().min(1).max(LIMITS.maxPages),
          x: fraction,
          y: fraction,
          width: fraction,
          height: fraction,
        }),
      )
      .min(1),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["edit-pdf", "pdf-to-text", "split-pdf", "compress-pdf"],
  added: "2026-10-06",
  updated: "2026-10-06",
});

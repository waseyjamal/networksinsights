import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { ANGLE, FONT_SIZE, LIMITS, MAX_TEXT, OPACITY } from "./logic";

export default defineTool({
  id: "watermark-pdf",
  name: "Watermark PDF",
  category: "pdf",
  summary:
    "Stamp a text watermark such as DRAFT or CONFIDENTIAL on a PDF, once or tiled, with your size, colour, opacity and angle.",
  tags: ["pdf", "watermark", "stamp", "confidential", "draft"],
  accepts: ["PDF"],
  produces: ["PDF"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    text: z.string().min(1).max(MAX_TEXT),
    fontSize: z.number().int().min(FONT_SIZE.min).max(FONT_SIZE.max),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    opacity: z.number().int().min(OPACITY.min).max(OPACITY.max),
    angle: z.number().int().min(ANGLE.min).max(ANGLE.max),
    layout: z.enum(["single", "tiled"]),
    which: z.enum(["all", "chosen"]),
    pages: z.string().max(1000),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["add-watermark-to-image", "sign-pdf", "add-page-numbers-to-pdf", "merge-pdf"],
  added: "2026-10-05",
  updated: "2026-10-05",
});

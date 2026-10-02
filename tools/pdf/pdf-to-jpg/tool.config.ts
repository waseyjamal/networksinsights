import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "pdf-to-jpg",
  name: "PDF to JPG",
  category: "pdf",
  summary:
    "Turn the pages of a PDF into JPG pictures in your browser: choose the pages and the quality, then download each picture.",
  tags: ["pdf", "jpg", "convert", "pages", "images"],
  accepts: ["PDF"],
  produces: ["JPG"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    which: z.enum(["all", "chosen"]),
    pages: z.string().max(1000),
    resolution: z.enum(["96", "150", "300"]),
    quality: z.enum(["high", "balanced", "small"]),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["image-to-pdf", "split-pdf", "compress-image"],
  added: "2026-10-02",
  updated: "2026-10-02",
});

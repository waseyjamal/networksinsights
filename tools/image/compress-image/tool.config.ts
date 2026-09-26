import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "compress-image",
  name: "Compress Image",
  category: "image",
  summary:
    "Compress JPG, PNG and WebP images in your browser: pick a quality, compare the sizes and preview, then download the smaller files.",
  tags: ["images", "compress", "jpg", "png", "webp", "file-size"],
  accepts: ["JPG", "PNG", "WebP"],
  produces: ["JPG", "WebP"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    format: z.enum(["jpg", "webp"]),
    quality: z.enum(["high", "balanced", "small"]),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: [],
  added: "2026-09-26",
  updated: "2026-09-26",
});

import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "heic-to-jpg",
  name: "HEIC to JPG",
  category: "image",
  summary:
    "Convert iPhone HEIC and HEIF photos to JPG or PNG in your browser, several at once, then download each picture.",
  tags: ["heic", "heif", "jpg", "png", "convert", "iphone"],
  accepts: ["HEIC", "HEIF"],
  produces: ["JPG", "PNG"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    format: z.enum(["jpg", "png"]),
    quality: z.enum(["high", "balanced", "small"]),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["image-converter", "compress-image", "resize-image"],
  added: "2026-10-03",
  updated: "2026-10-03",
});

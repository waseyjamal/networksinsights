import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "resize-image",
  name: "Resize Image",
  category: "image",
  summary:
    "Resize a JPG, PNG or WebP picture to an exact width and height in pixels, or by a percentage, in your browser.",
  tags: ["images", "resize", "jpg", "png", "webp", "dimensions"],
  accepts: ["JPG", "PNG", "WebP"],
  produces: ["JPG", "PNG", "WebP"],
  runtime: "client",
  status: "beta",
  input: z.object({
    mode: z.enum(["pixels", "percent"]),
    width: z.number().int().min(1).optional(),
    height: z.number().int().min(1).optional(),
    keepRatio: z.boolean(),
    percent: z.number().min(1).max(1000).optional(),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["crop-image", "compress-image", "image-converter"],
  added: "2026-10-02",
  updated: "2026-10-02",
});

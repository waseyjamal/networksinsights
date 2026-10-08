import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS, RANGES } from "./logic";

export default defineTool({
  id: "blur-censor-image",
  name: "Blur & Censor Image",
  category: "image",
  summary:
    "Hide faces, plates or text in a JPG, PNG or WebP picture: draw boxes and fill, pixelate or blur each one.",
  tags: ["blur", "pixelate", "censor", "redact", "image"],
  accepts: ["JPG", "PNG", "WebP"],
  produces: ["PNG", "JPG"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    regions: z
      .array(
        z.object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          width: z.number().min(0).max(1),
          height: z.number().min(0).max(1),
          mode: z.enum(["fill", "pixelate", "blur"]),
          color: z.string(),
          block: z.number().int().min(RANGES.block.min).max(RANGES.block.max),
          radius: z.number().int().min(RANGES.radius.min).max(RANGES.radius.max),
        }),
      )
      .min(1)
      .max(LIMITS.maxRegions),
    format: z.enum(["image/png", "image/jpeg"]),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["exif-viewer-remover", "crop-image", "add-watermark-to-image", "redact-pdf"],
  added: "2026-10-08",
  updated: "2026-10-08",
});

import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS, RANGES } from "./logic";

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

export default defineTool({
  id: "add-text-to-image",
  name: "Add Text to Image",
  category: "image",
  summary:
    "Write text on your own photo in the browser: several layers with font, size, colour, outline and shadow, dragged into place, saved in the same format.",
  tags: ["text", "image", "caption", "photo", "meme"],
  accepts: ["JPG", "PNG", "WebP"],
  produces: ["JPG", "PNG", "WebP"],
  runtime: "client",
  status: "beta",
  input: z.object({
    layers: z
      .array(
        z.object({
          text: z.string().min(1).max(LIMITS.maxTextLength),
          font: z.enum(["sans", "serif", "mono", "verdana", "impact"]),
          bold: z.boolean(),
          size: z.number().min(RANGES.size.min).max(RANGES.size.max),
          color: hex,
          outline: z.number().min(RANGES.outline.min).max(RANGES.outline.max),
          outlineColor: hex,
          shadow: z.boolean(),
          x: z.number().min(RANGES.x.min).max(RANGES.x.max),
          y: z.number().min(RANGES.y.min).max(RANGES.y.max),
        }),
      )
      .min(1)
      .max(LIMITS.maxLayers),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["add-watermark-to-image", "crop-image", "resize-image", "image-converter"],
  added: "2026-10-06",
  updated: "2026-10-06",
});

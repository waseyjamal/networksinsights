import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "add-watermark-to-image",
  name: "Add Watermark to Image",
  category: "image",
  summary:
    "Put a text watermark on a JPG, PNG or WebP picture, once or tiled, with your size, colour, opacity and angle.",
  tags: ["watermark", "image", "text", "copyright"],
  accepts: ["JPG", "PNG", "WebP"],
  produces: ["JPG", "PNG", "WebP"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    text: z.string().min(1).max(100),
    size: z.number().min(1).max(50),
    color: z.string(),
    opacity: z.number().min(5).max(100),
    position: z.enum(["tile", "center", "top-left", "top-right", "bottom-left", "bottom-right"]),
    rotation: z.number().min(-180).max(180),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["resize-image", "compress-image", "crop-image", "image-converter"],
  added: "2026-10-03",
  updated: "2026-10-03",
});

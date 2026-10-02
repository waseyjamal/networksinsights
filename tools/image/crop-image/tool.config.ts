import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "crop-image",
  name: "Crop Image",
  category: "image",
  summary:
    "Crop a JPG, PNG or WebP picture to a free rectangle or a set ratio such as 1:1 or 16:9, in your browser.",
  tags: ["images", "crop", "aspect-ratio", "jpg", "png", "webp"],
  accepts: ["JPG", "PNG", "WebP"],
  produces: ["JPG", "PNG", "WebP"],
  runtime: "client",
  status: "beta",
  input: z.object({
    ratio: z.enum(["free", "1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16"]),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["resize-image", "compress-image", "image-converter"],
  added: "2026-10-02",
  updated: "2026-10-02",
});

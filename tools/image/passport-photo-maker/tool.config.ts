import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { DPI, LIMITS, PAPERS, PRESETS } from "./logic";

export default defineTool({
  id: "passport-photo-maker",
  name: "Passport Photo Maker",
  category: "image",
  summary:
    "Crop a photo to an exact passport photo size at a set DPI, then make a print sheet with as many copies as fit.",
  tags: ["passport", "photo", "print", "crop", "id-photo"],
  accepts: ["JPG", "PNG", "WebP"],
  produces: ["JPG"],
  runtime: "client",
  status: "beta",
  input: z.object({
    size: z.enum([...(Object.keys(PRESETS) as Array<keyof typeof PRESETS>), "custom"]),
    width: z.number().positive(),
    height: z.number().positive(),
    unit: z.enum(["mm", "in"]),
    dpi: z.number().int().min(DPI.min).max(DPI.max),
    paper: z.enum(Object.keys(PAPERS) as [keyof typeof PAPERS, ...Array<keyof typeof PAPERS>]),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["photo-signature-resizer", "crop-image", "resize-image", "compress-image"],
  added: "2026-10-05",
  updated: "2026-10-05",
});

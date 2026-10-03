import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "color-palette-from-image",
  name: "Color Palette from Image",
  category: "color-design",
  summary:
    "Pick up to eight dominant colours from a photo on your device with median cut, and copy each one as a HEX code.",
  tags: ["color", "palette", "image", "hex"],
  accepts: ["JPG", "PNG", "WebP"],
  runtime: "client",
  status: "beta",
  input: z.object({ count: z.number().int().min(1).max(8) }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["color-converter", "css-gradient-generator", "contrast-checker"],
  added: "2026-10-03",
  updated: "2026-10-03",
});

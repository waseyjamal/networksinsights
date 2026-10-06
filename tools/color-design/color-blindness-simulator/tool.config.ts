import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "color-blindness-simulator",
  name: "Color Blindness Simulator",
  category: "color-design",
  summary:
    "See how a picture looks with protanopia, deuteranopia, tritanopia and achromatopsia, side by side with the original, in your browser.",
  tags: ["color-blindness", "accessibility", "cvd", "simulation", "colour"],
  accepts: ["JPG", "PNG", "WebP"],
  runtime: "client",
  status: "beta",
  input: z.object({
    views: z.array(z.enum(["protanopia", "deuteranopia", "tritanopia", "achromatopsia"])),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["contrast-checker", "color-converter", "color-palette-from-image"],
  added: "2026-10-06",
  updated: "2026-10-06",
});

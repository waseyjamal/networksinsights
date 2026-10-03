import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "css-gradient-generator",
  name: "CSS Gradient Generator",
  category: "color-design",
  summary:
    "Build linear, radial and conic CSS gradients with 2 to 6 colour stops, a live preview and the CSS ready to copy.",
  tags: ["css", "gradient", "color", "design"],
  runtime: "client",
  status: "beta",
  input: z.object({
    kind: z.enum(["linear", "radial", "conic"]),
    angle: z.number().min(0).max(360),
    shape: z.enum(["circle", "ellipse"]),
    stops: z
      .array(z.object({ color: z.string(), position: z.number().min(0).max(100) }))
      .min(2)
      .max(6),
  }),
  related: ["color-converter", "contrast-checker"],
  added: "2026-10-03",
  updated: "2026-10-03",
});

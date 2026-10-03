import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

const layer = z.object({
  x: z.number().min(-100).max(100),
  y: z.number().min(-100).max(100),
  blur: z.number().min(0).max(100),
  spread: z.number().min(-50).max(50),
  color: z.string(),
  opacity: z.number().min(0).max(100),
  inset: z.boolean(),
});

export default defineTool({
  id: "box-shadow-generator",
  name: "Box Shadow Generator",
  category: "color-design",
  summary:
    "Design CSS box shadows with up to five layers, inset shadows and a glass card preset, see them live and copy the CSS.",
  tags: ["css", "box-shadow", "shadow", "design"],
  runtime: "client",
  status: "beta",
  input: z.object({ layers: z.array(layer).min(1).max(5), glass: z.boolean() }),
  related: ["css-gradient-generator", "color-converter", "contrast-checker"],
  added: "2026-10-03",
  updated: "2026-10-03",
});

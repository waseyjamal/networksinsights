import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "color-converter",
  name: "Color Converter",
  category: "color-design",
  summary:
    "Convert colors between HEX, RGB and HSL as you type, with a live preview swatch, a color picker and one-click copy for each format.",
  tags: ["color", "hex", "rgb", "hsl", "converter", "css", "design"],
  runtime: "client",
  status: "beta",
  input: z.object({ format: z.enum(["hex", "rgb", "hsl"]), text: z.string() }),
  related: ["hash-generator"],
  added: "2026-09-30",
  updated: "2026-09-30",
});

import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "image-to-svg",
  name: "Image to SVG",
  category: "image",
  summary:
    "Trace a JPG, PNG or WebP image into an SVG vector file with a chosen number of colours, in your browser, and see its size before you save it.",
  tags: ["svg", "vector", "trace", "vectorize"],
  accepts: ["JPG", "PNG", "WebP"],
  produces: ["SVG"],
  runtime: "worker",
  status: "beta",
  input: z.object({ preset: z.enum(["2", "4", "8", "16"]) }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: 1 },
  related: ["image-converter", "resize-image", "exif-viewer-remover"],
  added: "2026-10-07",
  updated: "2026-10-07",
});

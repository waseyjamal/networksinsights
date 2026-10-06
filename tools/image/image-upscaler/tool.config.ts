import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "image-upscaler",
  name: "Image Upscaler",
  category: "image",
  summary:
    "Make a photo four times wider and taller with the Real-ESRGAN model, run in your browser, and save it as a PNG.",
  tags: ["upscale", "enlarge", "super-resolution", "photo", "ai"],
  accepts: ["JPG", "PNG", "WEBP"],
  produces: ["PNG"],
  runtime: "worker",
  status: "beta",
  input: z.object({}),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: 1 },
  related: ["background-remover", "resize-image", "compress-image"],
  added: "2026-10-06",
  updated: "2026-10-06",
});

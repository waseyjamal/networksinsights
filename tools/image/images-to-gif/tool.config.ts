import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS, RANGES } from "./logic";

export default defineTool({
  id: "images-to-gif",
  name: "Images to GIF",
  category: "image",
  summary:
    "Make an animated GIF from your own pictures in the browser: put them in order, set the frame delay, the width and whether it loops.",
  tags: ["gif", "animation", "images", "frames", "slideshow"],
  accepts: ["JPG", "PNG", "WebP"],
  produces: ["GIF"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    width: z.number().int().min(RANGES.width.min).max(RANGES.width.max),
    delay: z.number().int().min(RANGES.delay.min).max(RANGES.delay.max),
    loop: z.enum(["forever", "once"]),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["video-to-gif", "resize-image", "image-converter", "compress-image"],
  added: "2026-10-06",
  updated: "2026-10-06",
});

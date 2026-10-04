import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "video-to-gif",
  name: "Video to GIF",
  category: "video-audio",
  summary:
    "Turn a short part of a video into an animated GIF in your browser, choosing the start, length, width and frame rate.",
  tags: ["video", "gif", "animation", "convert"],
  accepts: ["MP4", "WebM", "MOV"],
  produces: ["GIF"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    start: z.number().min(0),
    length: z.number().min(LIMITS.minClipSeconds).max(LIMITS.maxClipSeconds),
    width: z.number().int().min(LIMITS.minWidth).max(LIMITS.maxWidth),
    fps: z.number().int().min(LIMITS.minFps).max(LIMITS.maxFps),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: 1 },
  related: ["video-compressor", "video-to-audio", "compress-image"],
  added: "2026-10-04",
  updated: "2026-10-04",
});

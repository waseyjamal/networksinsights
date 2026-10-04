import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "video-compressor",
  name: "Video compressor",
  category: "video-audio",
  summary:
    "Make a video file smaller in your browser: pick a quality or an approximate target size, and save it as MP4 or WebM.",
  tags: ["video", "compress", "mp4", "webm", "smaller"],
  accepts: ["MP4", "WebM", "MOV"],
  produces: ["MP4", "WebM"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    container: z.enum(["mp4", "webm"]),
    mode: z.enum(["quality", "size"]),
    quality: z.enum(["high", "medium", "low"]),
    targetMegabytes: z.number().min(LIMITS.minTargetMegabytes),
    resolution: z.enum(["keep", "720", "480"]),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: 1 },
  related: ["video-to-audio", "video-to-gif", "audio-converter"],
  added: "2026-10-04",
  updated: "2026-10-04",
});

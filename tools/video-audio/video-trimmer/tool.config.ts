import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "video-trimmer",
  name: "Video Trimmer",
  category: "video-audio",
  summary:
    "Cut the start and end off a video in your browser: a fast keyframe cut with no re-encoding, or a frame-exact cut.",
  tags: ["video", "trim", "cut", "mp4", "webm"],
  accepts: ["MP4", "WebM", "MOV"],
  produces: ["MP4", "WebM"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    start: z.string().max(20),
    end: z.string().max(20),
    mode: z.enum(["fast", "exact"]),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["video-compressor", "video-to-gif", "video-to-audio", "audio-converter"],
  added: "2026-10-05",
  updated: "2026-10-05",
});

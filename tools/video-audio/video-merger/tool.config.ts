import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "video-merger",
  name: "Video Merger",
  category: "video-audio",
  summary:
    "Join several video clips into one file in your browser: put them in order, and get one MP4 or WebM at the size of the first clip.",
  tags: ["video", "merge", "join", "combine", "mp4", "webm"],
  accepts: ["MP4", "MOV", "WebM"],
  produces: ["MP4", "WebM"],
  runtime: "worker",
  status: "beta",
  input: z.object({ container: z.enum(["mp4", "webm"]) }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["video-trimmer", "video-compressor", "video-to-gif", "audio-cutter"],
  added: "2026-10-06",
  updated: "2026-10-06",
});

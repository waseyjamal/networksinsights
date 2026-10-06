import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "audio-cutter",
  name: "Audio Cutter",
  category: "video-audio",
  summary:
    "Cut the start and end off a recording in your browser: keep the original format with no re-encoding, or get an exact cut as WAV.",
  tags: ["audio", "cut", "trim", "wav", "m4a"],
  accepts: ["WAV", "M4A", "OGG", "WebM"],
  produces: ["M4A", "WAV"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    start: z.string().max(20),
    end: z.string().max(20),
    mode: z.enum(["copy", "wav"]),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["video-trimmer", "audio-converter", "audio-to-mp3", "video-to-audio"],
  added: "2026-10-06",
  updated: "2026-10-06",
});

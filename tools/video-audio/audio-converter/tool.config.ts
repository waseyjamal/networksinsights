import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "audio-converter",
  name: "Audio converter",
  category: "video-audio",
  summary:
    "Convert audio files between WAV, FLAC, OGG Opus and M4A in your browser, with only the formats your browser can write.",
  tags: ["audio", "convert", "wav", "flac", "opus", "m4a"],
  accepts: ["WAV", "FLAC", "OGG", "M4A", "WebM"],
  produces: ["WAV", "FLAC", "OGG", "M4A"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    output: z.enum(["wav", "flac", "ogg", "m4a"]),
    bitrate: z.enum(["96", "128", "192"]),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: 1 },
  related: ["video-to-audio", "video-compressor", "video-to-gif"],
  added: "2026-10-04",
  updated: "2026-10-04",
});

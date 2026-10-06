import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS, RANGES } from "./logic";

export default defineTool({
  id: "audio-silence-remover",
  name: "Audio Silence Remover",
  category: "video-audio",
  summary:
    "Trim the silence at the start, the end and long pauses of a recording in your browser, and bring its loudest peak to one level.",
  tags: ["audio", "silence", "trim", "normalize", "wav"],
  accepts: ["WAV", "M4A", "OGG", "WebM"],
  produces: ["WAV", "M4A", "OGG"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    threshold: z.number().min(RANGES.threshold.min).max(RANGES.threshold.max),
    minSilence: z.number().min(RANGES.minSilence.min).max(RANGES.minSilence.max),
    normalize: z.boolean(),
    output: z.enum(["wav", "m4a", "ogg"]),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["audio-cutter", "audio-converter", "audio-to-mp3", "video-to-audio"],
  added: "2026-10-06",
  updated: "2026-10-06",
});

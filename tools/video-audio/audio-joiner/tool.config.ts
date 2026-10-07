import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "audio-joiner",
  name: "Audio Joiner",
  category: "video-audio",
  summary:
    "Join several recordings into one WAV file, in the order you choose, matching their sample rates and channels first.",
  tags: ["audio", "join", "merge", "combine", "wav"],
  accepts: ["WAV", "M4A", "MP3", "OGG", "FLAC"],
  produces: ["WAV"],
  runtime: "worker",
  status: "beta",
  input: z.object({ order: z.array(z.number().int().min(0)).max(LIMITS.maxFiles) }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["audio-cutter", "audio-converter", "video-merger", "audio-to-mp3"],
  added: "2026-10-07",
  updated: "2026-10-07",
});

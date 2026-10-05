import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "audio-to-mp3",
  name: "Audio to MP3",
  category: "video-audio",
  summary:
    "Convert a WAV, FLAC, M4A, OGG or other recording to MP3 in your browser, without uploading the file anywhere.",
  tags: ["audio", "mp3", "convert", "wav", "flac"],
  accepts: ["WAV", "FLAC", "M4A", "OGG", "Opus", "WebM"],
  produces: ["MP3"],
  runtime: "worker",
  status: "beta",
  input: z.object({ bitrate: z.union([z.literal(128), z.literal(192), z.literal(320)]) }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: 1 },
  related: ["video-to-mp3", "audio-converter", "video-to-audio"],
  added: "2026-10-05",
  updated: "2026-10-05",
});

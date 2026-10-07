import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "speech-to-text",
  name: "Speech to Text",
  category: "video-audio",
  summary:
    "Turn an English recording of up to three minutes into text with the Whisper tiny model, running in your browser.",
  tags: ["speech", "transcribe", "transcription", "audio", "whisper", "ai"],
  accepts: ["WAV", "MP3", "M4A", "OGG", "WebM"],
  produces: ["TXT"],
  runtime: "worker",
  status: "beta",
  input: z.object({}),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: 1 },
  related: ["audio-cutter", "audio-converter", "audio-silence-remover", "ocr"],
  added: "2026-10-07",
  updated: "2026-10-07",
});

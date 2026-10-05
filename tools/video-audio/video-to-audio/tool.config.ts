import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "video-to-audio",
  name: "Video to audio",
  category: "video-audio",
  summary:
    "Pull the sound out of a video and save it as M4A or WAV, in your browser, without uploading the video anywhere.",
  tags: ["video", "audio", "extract", "m4a", "wav"],
  accepts: ["MP4", "WebM", "MOV"],
  produces: ["M4A", "WAV"],
  runtime: "worker",
  status: "beta",
  input: z.object({ output: z.enum(["m4a", "wav"]) }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: 1 },
  related: ["video-to-mp3", "audio-converter", "video-compressor"],
  added: "2026-10-04",
  updated: "2026-10-05",
});

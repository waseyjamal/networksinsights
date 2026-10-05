import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "video-to-mp3",
  name: "Video to MP3",
  category: "video-audio",
  summary:
    "Save the sound of a video as an MP3 file, encoded in your browser, without uploading the video anywhere.",
  tags: ["video", "audio", "mp3", "extract"],
  accepts: ["MP4", "WebM", "MOV"],
  produces: ["MP3"],
  runtime: "worker",
  status: "beta",
  input: z.object({ bitrate: z.union([z.literal(128), z.literal(192), z.literal(320)]) }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: 1 },
  related: ["audio-to-mp3", "video-to-audio", "audio-converter"],
  added: "2026-10-05",
  updated: "2026-10-05",
});

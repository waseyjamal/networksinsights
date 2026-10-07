import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "mute-video",
  name: "Mute Video",
  category: "video-audio",
  summary:
    "Remove the sound from a video by copying its picture into a new file without the audio track, with no re-encoding.",
  tags: ["video", "mute", "remove-audio", "silent"],
  accepts: ["MP4", "MOV", "WebM", "MKV"],
  produces: ["MP4", "MOV", "WebM", "MKV"],
  runtime: "worker",
  status: "beta",
  input: z.object({}),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["video-trimmer", "video-compressor", "video-to-audio", "video-merger"],
  added: "2026-10-07",
  updated: "2026-10-07",
});

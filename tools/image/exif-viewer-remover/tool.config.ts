import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "exif-viewer-remover",
  name: "EXIF Viewer & Remover",
  category: "image",
  summary:
    "See the camera, date and GPS location stored in a photo, then remove that metadata in your browser before you share the picture.",
  tags: ["exif", "metadata", "gps", "privacy", "photo"],
  accepts: ["JPG", "PNG", "WebP"],
  produces: ["JPG", "PNG"],
  runtime: "worker",
  status: "beta",
  input: z.object({}),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: 1 },
  related: ["compress-image", "image-converter", "crop-image"],
  added: "2026-10-07",
  updated: "2026-10-07",
});

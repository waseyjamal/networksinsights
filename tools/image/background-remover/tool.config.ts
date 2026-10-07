import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "background-remover",
  name: "Background Remover",
  category: "image",
  summary:
    "Remove the background from a photo of a person with the MODNet portrait model, in your browser, and save a transparent PNG.",
  tags: ["background", "remove", "transparent", "portrait", "cutout", "ai"],
  accepts: ["JPG", "PNG", "WEBP"],
  produces: ["PNG"],
  runtime: "worker",
  status: "beta",
  input: z.object({}),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: 1 },
  related: ["image-upscaler", "passport-photo-maker", "crop-image"],
  added: "2026-10-06",
  updated: "2026-10-06",
});

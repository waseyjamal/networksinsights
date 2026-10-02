import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS, MAX_KB, MAX_SIDE } from "./logic";

export default defineTool({
  id: "photo-signature-resizer",
  name: "Photo and Signature Resizer",
  category: "image",
  summary:
    "Resize a photo or signature to the exact pixels and the maximum KB an exam or application form asks for, in your browser.",
  tags: ["images", "resize", "exam", "form", "signature", "kb"],
  accepts: ["JPG", "PNG", "WebP"],
  produces: ["JPG"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    width: z.number().int().min(1).max(MAX_SIDE),
    height: z.number().int().min(1).max(MAX_SIDE),
    maxKb: z.number().int().min(1).max(MAX_KB),
    fit: z.enum(["crop", "pad"]),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["resize-image", "compress-image", "crop-image"],
  added: "2026-10-02",
  updated: "2026-10-02",
});

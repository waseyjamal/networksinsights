import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "background-remover",
  name: "Background Remover",
  category: "image",
  summary:
    "Remove the background from a photo in your browser with an on-device AI model, compare before and after, and download a transparent PNG.",
  tags: ["background", "remove-background", "transparent", "png", "cutout", "ai"],
  accepts: ["JPG", "PNG", "WebP"],
  produces: ["PNG"],
  runtime: "worker",
  status: "beta",
  input: z.object({}),
  budget: {
    maxOnDemandJsKb: 3700,
    reason:
      "ONNX Runtime's WebAssembly (3.6 MB gzip) runs the background removal model on the device; it loads only after a visitor adds a photo (ADR 0057). The model file (.onnx, 4.4 MB) is not JavaScript and is not counted here.",
  },
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: [],
  added: "2026-10-02",
  updated: "2026-10-02",
});

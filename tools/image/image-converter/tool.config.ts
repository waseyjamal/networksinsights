import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "image-converter",
  name: "Image Converter",
  category: "image",
  summary:
    "Convert images between JPG, PNG and WebP in your browser, one file or many, and download each result.",
  tags: ["images", "convert", "jpg", "png", "webp"],
  accepts: ["JPG", "PNG", "WebP"],
  produces: ["JPG", "PNG", "WebP"],
  runtime: "worker",
  status: "beta",
  input: z.object({ format: z.enum(["jpg", "png", "webp"]) }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["compress-image"],
  added: "2026-10-02",
  updated: "2026-10-02",
});

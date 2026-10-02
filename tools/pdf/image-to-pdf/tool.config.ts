import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "image-to-pdf",
  name: "Image to PDF",
  category: "pdf",
  summary:
    "Turn JPG, PNG and WebP pictures into one PDF in your browser, in your order, on A4, Letter or pages the size of each picture.",
  tags: ["pdf", "images", "jpg-to-pdf", "png-to-pdf", "convert"],
  accepts: ["JPG", "PNG", "WebP"],
  produces: ["PDF"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    size: z.enum(["a4", "letter", "fit"]),
    orientation: z.enum(["auto", "portrait", "landscape"]),
    margin: z.enum(["0", "10", "20"]),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["merge-pdf", "pdf-to-jpg", "compress-image"],
  added: "2026-10-02",
  updated: "2026-10-02",
});

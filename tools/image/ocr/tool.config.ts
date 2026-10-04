import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "ocr",
  name: "OCR image to text",
  category: "image",
  summary:
    "Read the text in a photo, a scan or a PDF with OCR in your browser, in English or Hindi, then copy it or save a text file.",
  tags: ["ocr", "text", "scan", "pdf", "hindi", "english"],
  accepts: ["PNG", "JPG", "WebP", "PDF"],
  produces: ["TXT"],
  runtime: "worker",
  status: "beta",
  input: z.object({ language: z.enum(["eng", "hin", "both"]) }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  budget: {
    maxOnDemandJsKb: 2048,
    reason:
      "Tesseract, an OCR engine compiled to WebAssembly, and PDF.js for PDF pages, loaded only when the visitor presses Read text",
  },
  related: ["pdf-to-jpg", "image-converter", "word-counter"],
  added: "2026-10-03",
  updated: "2026-10-04",
});

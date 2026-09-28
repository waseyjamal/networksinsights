import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LEVELS, MAX_SIZE, MIN_SIZE } from "./logic";

export default defineTool({
  id: "qr-code-generator",
  name: "QR Code Generator",
  category: "generators",
  summary:
    "Turn any text or link into a QR code as you type, choose its error correction and size, and download it as a PNG image.",
  tags: ["qr-code", "qr", "generator", "barcode", "scan", "link", "url"],
  produces: ["PNG"],
  runtime: "client",
  status: "beta",
  input: z.object({
    text: z.string(),
    level: z.enum(LEVELS),
    size: z.number().int().min(MIN_SIZE).max(MAX_SIZE),
  }),
  related: ["password-generator"],
  added: "2026-09-28",
  updated: "2026-09-28",
});

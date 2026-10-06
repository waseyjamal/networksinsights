import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "unlock-pdf",
  name: "Unlock PDF",
  category: "pdf",
  summary:
    "Remove the password from a PDF you can already open: type its password once and download a copy that opens without one.",
  tags: ["pdf", "password", "unlock", "decrypt"],
  accepts: ["PDF"],
  produces: ["PDF"],
  runtime: "worker",
  status: "beta",
  input: z.object({ password: z.string().min(1).max(1000) }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  budget: {
    maxOnDemandJsKb: 3000,
    reason:
      "PDFium compiled to WebAssembly removes the password and PDF.js checks the copy; both load only when the visitor presses Remove password",
  },
  related: ["compress-pdf", "merge-pdf", "pdf-to-text", "split-pdf"],
  added: "2026-10-06",
  updated: "2026-10-06",
});

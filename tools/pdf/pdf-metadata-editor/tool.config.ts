import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

const field = z.string().max(LIMITS.maxFieldChars);

export default defineTool({
  id: "pdf-metadata-editor",
  name: "PDF Metadata Editor",
  category: "pdf",
  summary:
    "See and change the title, author, subject, keywords, creator and producer stored in a PDF, or clear them, in your browser.",
  tags: ["pdf", "metadata", "properties", "title", "author"],
  accepts: ["PDF"],
  produces: ["PDF"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    title: field,
    author: field,
    subject: field,
    keywords: field,
    creator: field,
    producer: field,
    removeDates: z.boolean(),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["redact-pdf", "compress-pdf", "unlock-pdf", "merge-pdf"],
  added: "2026-10-07",
  updated: "2026-10-07",
});

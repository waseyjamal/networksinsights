import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "merge-pdf",
  name: "Merge PDF",
  category: "pdf",
  summary:
    "Combine several PDF files into one in your browser: put them in order, remove any you do not need, then download.",
  tags: ["pdf", "merge", "combine", "join"],
  accepts: ["PDF"],
  produces: ["PDF"],
  runtime: "worker",
  status: "beta",
  input: z.object({ order: z.array(z.string()).min(2).max(LIMITS.maxFiles) }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["split-pdf", "rotate-pdf", "image-to-pdf"],
  added: "2026-10-02",
  updated: "2026-10-02",
});

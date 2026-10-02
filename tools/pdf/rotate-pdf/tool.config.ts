import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "rotate-pdf",
  name: "Rotate PDF",
  category: "pdf",
  summary:
    "Turn every page of a PDF, or only the pages you choose, by 90, 180 or 270 degrees, and save the corrected file.",
  tags: ["pdf", "rotate", "orientation", "pages"],
  accepts: ["PDF"],
  produces: ["PDF"],
  runtime: "client",
  status: "beta",
  input: z.object({
    turn: z.enum(["90", "180", "270"]),
    which: z.enum(["all", "chosen"]),
    pages: z.string().max(1000),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["merge-pdf", "split-pdf", "pdf-to-jpg"],
  added: "2026-10-02",
  updated: "2026-10-02",
});

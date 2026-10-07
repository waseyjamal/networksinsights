import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

const margin = z.string().max(20);

export default defineTool({
  id: "crop-pdf",
  name: "Crop PDF",
  category: "pdf",
  summary:
    "Trim the margins of every page in a PDF by setting how much to cut from each side, with a preview of the first page.",
  tags: ["pdf", "crop", "margins", "trim", "pages"],
  accepts: ["PDF"],
  produces: ["PDF"],
  runtime: "worker",
  status: "beta",
  input: z.object({ top: margin, right: margin, bottom: margin, left: margin }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["rotate-pdf", "split-pdf", "compress-pdf", "redact-pdf"],
  added: "2026-10-07",
  updated: "2026-10-07",
});

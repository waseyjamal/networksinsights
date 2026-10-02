import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "sign-pdf",
  name: "Sign PDF",
  category: "pdf",
  summary:
    "Put a drawn, typed or uploaded signature picture on a page of a PDF in your browser. A visual signature, not a digital certificate.",
  tags: ["pdf", "signature", "sign", "e-sign"],
  accepts: ["PDF", "PNG", "JPG"],
  produces: ["PDF"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    source: z.enum(["draw", "type", "upload"]),
    page: z.number().int().min(1),
    position: z.enum([
      "bottom-right",
      "bottom-center",
      "bottom-left",
      "top-right",
      "top-left",
      "center",
    ]),
    width: z.enum(["20", "30", "40"]),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["merge-pdf", "rotate-pdf", "image-to-pdf"],
  added: "2026-10-02",
  updated: "2026-10-02",
});

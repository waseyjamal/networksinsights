import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { MODES } from "./logic";

export default defineTool({
  id: "gst-calculator",
  name: "GST Calculator",
  category: "calculators",
  summary:
    "Add GST to an amount or remove it from a GST-inclusive price, at any rate, and see the base amount, GST, the CGST and SGST halves and the total.",
  tags: ["gst", "tax", "india", "cgst", "sgst", "calculator"],
  runtime: "client",
  status: "beta",
  input: z.object({ amount: z.string(), rate: z.string(), mode: z.enum(MODES) }),
  related: ["percentage-calculator", "emi-calculator", "sip-calculator"],
  added: "2026-10-03",
  updated: "2026-10-03",
});

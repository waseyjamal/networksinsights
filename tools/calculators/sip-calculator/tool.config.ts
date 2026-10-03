import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "sip-calculator",
  name: "SIP Calculator",
  category: "calculators",
  summary:
    "Estimate the future value of a monthly SIP from the amount, expected yearly return and years, with invested amount, returns and a year-by-year table.",
  tags: ["sip", "mutual-fund", "investment", "returns", "calculator"],
  runtime: "client",
  status: "beta",
  input: z.object({ amount: z.string(), rate: z.string(), years: z.string() }),
  related: ["compound-interest-calculator", "emi-calculator", "percentage-calculator"],
  added: "2026-10-03",
  updated: "2026-10-03",
});

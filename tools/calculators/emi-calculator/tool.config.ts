import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "emi-calculator",
  name: "EMI Calculator",
  category: "calculators",
  summary:
    "Work out the monthly EMI, total interest and total payment of a loan from its amount, yearly interest rate and tenure, with a month-by-month schedule.",
  tags: ["emi", "loan", "interest", "mortgage", "calculator", "amortization"],
  runtime: "client",
  status: "beta",
  input: z.object({
    amount: z.string(),
    rate: z.string(),
    tenure: z.string(),
    unit: z.enum(["years", "months"]),
  }),
  related: ["percentage-calculator"],
  added: "2026-10-02",
  updated: "2026-10-02",
});

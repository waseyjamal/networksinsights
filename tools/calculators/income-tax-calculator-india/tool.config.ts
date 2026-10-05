import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "income-tax-calculator-india",
  name: "Income Tax Calculator India",
  category: "calculators",
  summary:
    "Estimate income tax for a resident individual in India for tax year 2026-27, under the new and the old regime, side by side.",
  tags: ["income-tax", "india", "tax", "new-regime", "old-regime"],
  runtime: "client",
  status: "beta",
  input: z.object({
    salary: z.string().max(30),
    other: z.string().max(30),
    deductions: z.string().max(30),
    age: z.enum(["below60", "60to79", "80plus"]),
  }),
  related: ["gst-calculator", "fd-calculator", "sip-calculator", "emi-calculator"],
  added: "2026-10-05",
  updated: "2026-10-05",
});

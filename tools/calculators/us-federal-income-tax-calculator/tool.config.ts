import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "us-federal-income-tax-calculator",
  name: "US Federal Income Tax Calculator",
  category: "calculators",
  summary:
    "Estimate US federal income tax for tax year 2026 from your taxable income or with the standard deduction, for all four filing statuses.",
  tags: ["income-tax", "united-states", "tax", "irs", "tax-brackets"],
  runtime: "client",
  status: "beta",
  input: z.object({
    income: z.string().max(30),
    status: z.enum(["single", "joint", "separate", "head"]),
    deduction: z.enum(["standard", "itemized", "none"]),
    itemized: z.string().max(30),
  }),
  related: ["us-mortgage-calculator", "income-tax-calculator-india", "percentage-calculator"],
  added: "2026-10-08",
  updated: "2026-10-08",
});

import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "compound-interest-calculator",
  name: "Compound Interest Calculator",
  category: "calculators",
  summary:
    "Calculate the end balance and interest earned on a sum with compound interest and optional regular deposits, with a year-by-year table.",
  tags: ["compound-interest", "interest", "savings", "investment", "deposit", "calculator"],
  runtime: "client",
  status: "beta",
  input: z.object({
    principal: z.string(),
    rate: z.string(),
    years: z.string(),
    frequency: z.enum(["1", "2", "4", "12", "52", "365"]),
    deposit: z.string(),
  }),
  related: ["emi-calculator", "percentage-calculator"],
  added: "2026-10-02",
  updated: "2026-10-02",
});

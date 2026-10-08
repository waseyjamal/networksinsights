import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "us-mortgage-calculator",
  name: "US Mortgage Calculator",
  category: "calculators",
  summary:
    "Work out the monthly payment on a US home loan, with property tax, insurance, PMI, extra payments and a full amortization table.",
  tags: ["mortgage", "home-loan", "amortization", "united-states", "pmi"],
  runtime: "client",
  status: "beta",
  input: z.object({
    price: z.string().max(30),
    down: z.string().max(30),
    rate: z.string().max(30),
    years: z.string().max(30),
    tax: z.string().max(30),
    insurance: z.string().max(30),
    pmi: z.string().max(30),
    extra: z.string().max(30),
  }),
  related: ["emi-calculator", "canada-mortgage-calculator", "us-federal-income-tax-calculator"],
  added: "2026-10-08",
  updated: "2026-10-08",
});

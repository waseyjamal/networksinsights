import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "canada-mortgage-calculator",
  name: "Canada Mortgage Payment Calculator",
  category: "calculators",
  summary:
    "Work out Canadian mortgage payments with semi-annual compounding, the CMHC minimum down payment and the mortgage loan insurance premium.",
  tags: ["mortgage", "canada", "cmhc", "home-loan", "amortization"],
  runtime: "client",
  status: "beta",
  input: z.object({
    price: z.string().max(30),
    down: z.string().max(30),
    rate: z.string().max(30),
    years: z.string().max(30),
    frequency: z.enum(["monthly", "semi-monthly", "bi-weekly", "weekly"]),
    premiumPaid: z.enum(["added", "separate"]),
  }),
  related: ["us-mortgage-calculator", "emi-calculator", "uk-stamp-duty-calculator"],
  added: "2026-10-08",
  updated: "2026-10-08",
});

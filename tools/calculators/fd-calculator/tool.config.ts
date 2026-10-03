import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { COMPOUNDINGS, TENURE_UNITS } from "./logic";

export default defineTool({
  id: "fd-calculator",
  name: "FD Calculator",
  category: "calculators",
  summary:
    "Work out the maturity amount and interest of a fixed deposit from the deposit, yearly rate, tenure and compounding, with a year-by-year table.",
  tags: ["fd", "fixed-deposit", "interest", "maturity", "savings", "calculator"],
  runtime: "client",
  status: "beta",
  input: z.object({
    amount: z.string(),
    rate: z.string(),
    tenure: z.string(),
    unit: z.enum(TENURE_UNITS),
    compounding: z.enum(COMPOUNDINGS),
  }),
  related: ["compound-interest-calculator", "emi-calculator", "sip-calculator"],
  added: "2026-10-03",
  updated: "2026-10-03",
});

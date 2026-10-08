import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "uk-stamp-duty-calculator",
  name: "UK Stamp Duty Calculator",
  category: "calculators",
  summary:
    "Estimate Stamp Duty Land Tax on a home in England or Northern Ireland, with first-time buyer relief and the higher and non-resident rates.",
  tags: ["stamp-duty", "sdlt", "united-kingdom", "property", "tax"],
  runtime: "client",
  status: "beta",
  input: z.object({
    price: z.string().max(30),
    buyer: z.enum(["home", "first", "additional"]),
    nonResident: z.boolean(),
  }),
  related: ["us-mortgage-calculator", "canada-mortgage-calculator", "percentage-calculator"],
  added: "2026-10-08",
  updated: "2026-10-08",
});

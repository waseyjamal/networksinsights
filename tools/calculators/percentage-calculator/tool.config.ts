import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "percentage-calculator",
  name: "Percentage Calculator",
  category: "calculators",
  summary:
    "Work out a percentage of a number, what percent one number is of another, a percentage change, or add and subtract a percent.",
  tags: ["percentage", "percent", "calculator", "math", "change", "discount"],
  runtime: "client",
  status: "beta",
  input: z.object({
    mode: z.enum(["of", "whatPercent", "change", "addSub"]),
    a: z.string(),
    b: z.string(),
    operation: z.enum(["add", "subtract"]),
  }),
  related: [],
  added: "2026-10-02",
  updated: "2026-10-02",
});

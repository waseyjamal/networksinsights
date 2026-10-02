import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "bmi-calculator",
  name: "BMI Calculator",
  category: "calculators",
  summary:
    "Calculate body mass index from height and weight in metric or imperial units, and see the adult category of the World Health Organization.",
  tags: ["bmi", "body-mass-index", "health", "weight", "height", "calculator"],
  runtime: "client",
  status: "beta",
  input: z.object({
    system: z.enum(["metric", "imperial"]),
    cm: z.string(),
    feet: z.string(),
    inches: z.string(),
    weight: z.string(),
  }),
  related: ["percentage-calculator"],
  added: "2026-10-02",
  updated: "2026-10-02",
});

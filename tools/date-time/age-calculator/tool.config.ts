import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "age-calculator",
  name: "Age Calculator",
  category: "date-time",
  summary:
    "Find an exact age in years, months and days from a birth date, with the total days lived and the date of the next birthday.",
  tags: ["age", "birthday", "date", "birth-date", "calculator"],
  runtime: "client",
  status: "beta",
  input: z.object({ birth: z.string(), on: z.string() }),
  related: [],
  added: "2026-10-02",
  updated: "2026-10-02",
});

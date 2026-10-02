import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "date-difference-calculator",
  name: "Date Difference Calculator",
  category: "date-time",
  summary:
    "Find the time between two dates in years, months, days and weeks, with the total days and the number of weekdays, and an option to count the end date.",
  tags: ["date", "difference", "days-between", "weeks", "weekdays", "calculator"],
  runtime: "client",
  status: "beta",
  input: z.object({ start: z.string(), end: z.string(), includeEnd: z.boolean() }),
  related: ["age-calculator"],
  added: "2026-10-02",
  updated: "2026-10-02",
});

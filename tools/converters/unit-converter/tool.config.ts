import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { GROUPS } from "./logic";

export default defineTool({
  id: "unit-converter",
  name: "Unit Converter",
  category: "converters",
  summary:
    "Convert length, weight, temperature, area, volume, speed, data size and time between metric and imperial units, with exact factors.",
  tags: ["units", "converter", "metric", "imperial", "length", "weight", "temperature"],
  runtime: "client",
  status: "beta",
  input: z.object({ group: z.enum(GROUPS), value: z.string(), from: z.string(), to: z.string() }),
  related: ["percentage-calculator", "color-converter", "time-zone-converter"],
  added: "2026-10-03",
  updated: "2026-10-03",
});

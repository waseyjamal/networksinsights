import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { UNITS, ZONES } from "./logic";

export default defineTool({
  id: "unix-timestamp-converter",
  name: "Unix Timestamp Converter",
  category: "date-time",
  summary:
    "Turn a Unix timestamp in seconds or milliseconds into a UTC, local and ISO 8601 date, or a date and time into a Unix timestamp.",
  tags: ["unix", "timestamp", "epoch", "iso-8601", "utc", "date"],
  runtime: "client",
  status: "beta",
  input: z.object({
    timestamp: z.string(),
    unit: z.enum(UNITS),
    date: z.string(),
    zone: z.enum(ZONES),
  }),
  related: ["time-zone-converter", "date-difference-calculator", "age-calculator"],
  added: "2026-10-03",
  updated: "2026-10-03",
});

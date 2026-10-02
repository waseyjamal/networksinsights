import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "time-zone-converter",
  name: "Time Zone Converter",
  category: "date-time",
  summary:
    "Convert a date and time from one time zone to several others, with daylight saving time handled by your browser's IANA zone data.",
  tags: ["time-zone", "timezone", "converter", "iana", "daylight-saving", "utc"],
  runtime: "client",
  status: "beta",
  input: z.object({
    date: z.string(),
    time: z.string(),
    source: z.string(),
    targets: z.array(z.string()),
  }),
  related: ["date-difference-calculator", "age-calculator"],
  added: "2026-10-02",
  updated: "2026-10-02",
});

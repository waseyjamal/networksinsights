import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { DELIMITERS } from "./logic";

export default defineTool({
  id: "json-to-csv",
  name: "JSON to CSV Converter",
  category: "developer",
  summary:
    "Turn a JSON array of objects into CSV with your choice of delimiter, header row, flattened nested keys and protection against spreadsheet formulas.",
  tags: ["json", "csv", "converter", "spreadsheet", "export"],
  accepts: ["JSON"],
  produces: ["CSV"],
  runtime: "client",
  status: "beta",
  input: z.object({
    text: z.string(),
    delimiter: z.enum(DELIMITERS),
    header: z.boolean(),
    flatten: z.boolean(),
    quoteAll: z.boolean(),
    protect: z.boolean(),
  }),
  related: ["json-formatter"],
  added: "2026-10-03",
  updated: "2026-10-03",
});

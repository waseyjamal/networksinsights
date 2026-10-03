import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { DELIMITERS } from "./logic";

export default defineTool({
  id: "csv-to-json",
  name: "CSV to JSON Parser",
  category: "developer",
  summary:
    "Read CSV with quoted fields and line breaks inside them, and turn it into JSON objects or arrays, with delimiter detection and clear line-numbered errors.",
  tags: ["csv", "json", "converter", "parser", "rfc-4180"],
  accepts: ["CSV"],
  produces: ["JSON"],
  runtime: "client",
  status: "beta",
  input: z.object({
    text: z.string(),
    delimiter: z.enum(DELIMITERS),
    header: z.boolean(),
    convert: z.boolean(),
    pretty: z.boolean(),
  }),
  related: ["json-to-csv", "json-formatter"],
  added: "2026-10-03",
  updated: "2026-10-03",
});

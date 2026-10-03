import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { KEEPS, SORTS } from "./logic";

export default defineTool({
  id: "remove-duplicate-lines",
  name: "Remove Duplicate Lines",
  category: "text",
  summary:
    "Delete repeated lines from a list, with options to ignore case, trim spaces, drop empty lines, keep the first or last copy and sort the result.",
  tags: ["duplicates", "lines", "dedupe", "list", "sort", "text"],
  runtime: "client",
  status: "beta",
  input: z.object({
    text: z.string(),
    ignoreCase: z.boolean(),
    trim: z.boolean(),
    removeEmpty: z.boolean(),
    keep: z.enum(KEEPS),
    sort: z.enum(SORTS),
  }),
  related: ["case-converter", "word-counter", "diff-checker"],
  added: "2026-10-03",
  updated: "2026-10-03",
});

import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { CASES, DIALECT_KEYS, type Dialect, INDENTS, LIMITS } from "./logic";

export default defineTool({
  id: "sql-formatter",
  name: "SQL Formatter",
  category: "developer",
  summary:
    "Format SQL queries in your browser for the SQL dialect you use, with your choice of keyword case and indentation.",
  tags: ["sql", "formatter", "beautifier", "database", "developer"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    text: z.string().max(LIMITS.maxCharacters),
    dialect: z.enum(DIALECT_KEYS as [Dialect, ...Dialect[]]),
    keywordCase: z.enum(CASES),
    indent: z.enum(INDENTS),
  }),
  related: ["json-formatter", "yaml-formatter", "xml-formatter"],
  added: "2026-10-04",
  updated: "2026-10-04",
});

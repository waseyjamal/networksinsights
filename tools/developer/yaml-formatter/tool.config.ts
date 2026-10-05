import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { INDENTS, LIMITS, MODES } from "./logic";

export default defineTool({
  id: "yaml-formatter",
  name: "YAML Formatter",
  category: "developer",
  summary:
    "Format, validate or minify YAML in your browser, and see the line and column of any syntax error.",
  tags: ["yaml", "formatter", "validator", "minifier", "developer"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    text: z.string().max(LIMITS.maxCharacters),
    mode: z.enum(MODES),
    indent: z.enum(INDENTS),
  }),
  related: ["json-formatter", "xml-formatter", "sql-formatter"],
  added: "2026-10-04",
  updated: "2026-10-04",
});

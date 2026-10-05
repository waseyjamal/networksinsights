import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { INDENTS, LIMITS, MODES } from "./logic";

export default defineTool({
  id: "xml-formatter",
  name: "XML Formatter",
  category: "developer",
  summary:
    "Format or minify XML in your browser, check that it is well formed, and see the line and column of any error.",
  tags: ["xml", "formatter", "validator", "minifier", "developer"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    text: z.string().max(LIMITS.maxCharacters),
    mode: z.enum(MODES),
    indent: z.enum(INDENTS),
  }),
  related: ["json-formatter", "yaml-formatter", "sql-formatter"],
  added: "2026-10-04",
  updated: "2026-10-04",
});

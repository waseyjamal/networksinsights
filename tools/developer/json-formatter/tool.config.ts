import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { INDENTS, MODES } from "./logic";

export default defineTool({
  id: "json-formatter",
  name: "JSON Formatter",
  category: "developer",
  summary:
    "Format or minify JSON with 2 spaces, 4 spaces or tabs, validate it, and see the line and column of any syntax error.",
  tags: ["json", "formatter", "beautifier", "minifier", "validator", "developer"],
  runtime: "client",
  status: "beta",
  input: z.object({ text: z.string(), mode: z.enum(MODES), indent: z.enum(INDENTS) }),
  related: ["password-generator", "qr-code-generator"],
  added: "2026-09-28",
  updated: "2026-09-28",
});

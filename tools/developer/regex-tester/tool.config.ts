import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { MAX_TEXT_CHARS } from "./logic";

export default defineTool({
  id: "regex-tester",
  name: "Regex Tester",
  category: "developer",
  summary:
    "Test a JavaScript regular expression against your text as you type, with every match highlighted and its groups listed. Nothing is uploaded.",
  tags: ["regex", "regular-expression", "tester", "matcher", "javascript", "developer"],
  runtime: "client",
  status: "beta",
  input: z.object({ pattern: z.string(), flags: z.string(), text: z.string() }),
  limits: { maxInputBytes: MAX_TEXT_CHARS },
  related: ["json-formatter", "jwt-decoder"],
  added: "2026-09-29",
  updated: "2026-09-29",
});

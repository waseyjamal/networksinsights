import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { MODES } from "./logic";

export default defineTool({
  id: "case-converter",
  name: "Case Converter",
  category: "text",
  summary:
    "Change any text to uppercase, lowercase, title case, sentence case, camelCase, PascalCase, snake_case or kebab-case, as you type.",
  tags: ["uppercase", "lowercase", "title-case", "sentence-case", "camel-case", "text"],
  runtime: "client",
  status: "beta",
  input: z.object({ text: z.string(), mode: z.enum(MODES) }),
  related: ["word-counter"],
  added: "2026-09-28",
  updated: "2026-09-28",
});

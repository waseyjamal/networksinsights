import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

// Fixture: the related tool the happy path links to.
export default defineTool({
  id: "case-converter",
  name: "Case converter",
  category: "text",
  summary: "Switch text between upper case, lower case, title case and sentence case.",
  tags: ["words", "text"],
  runtime: "client",
  status: "beta",
  input: z.object({ text: z.string() }),
  related: [],
  added: "2026-09-20",
  updated: "2026-09-20",
});

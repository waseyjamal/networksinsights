import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

// Fixture: the happy path.
export default defineTool({
  id: "word-counter",
  name: "Word counter",
  category: "text",
  summary: "Count the words, characters and lines in any text, as you type.",
  tags: ["words", "text"],
  runtime: "client",
  status: "beta",
  input: z.object({ text: z.string() }),
  related: ["case-converter"],
  added: "2026-09-20",
  updated: "2026-09-20",
});

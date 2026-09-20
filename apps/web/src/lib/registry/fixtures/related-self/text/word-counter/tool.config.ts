import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

// Fixture: a tool that links to itself.
export default defineTool({
  id: "word-counter",
  name: "Word counter",
  category: "text",
  summary: "Count the words, characters and lines in any text, as you type.",
  tags: ["words", "text"],
  runtime: "client",
  status: "beta",
  input: z.object({ text: z.string() }),
  related: ["word-counter"],
  added: "2026-09-20",
  updated: "2026-09-20",
});

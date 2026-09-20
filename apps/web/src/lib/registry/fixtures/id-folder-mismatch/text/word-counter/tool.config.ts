import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

// Fixture: an id that does not match its folder, so the URL would not match either.
export default defineTool({
  id: "word-count",
  name: "Word counter",
  category: "text",
  summary: "Count the words, characters and lines in any text, as you type.",
  tags: ["words", "text"],
  runtime: "client",
  status: "beta",
  input: z.object({ text: z.string() }),
  related: [],
  added: "2026-09-20",
  updated: "2026-09-20",
});

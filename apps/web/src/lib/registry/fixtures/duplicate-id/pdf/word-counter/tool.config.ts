import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

// Fixture: the other folder claiming the same id.
export default defineTool({
  id: "word-counter",
  name: "Word counter",
  category: "pdf",
  summary: "Count the words in a PDF document without opening a reader.",
  tags: ["words", "text"],
  runtime: "client",
  status: "beta",
  input: z.object({ text: z.string() }),
  related: [],
  added: "2026-09-20",
  updated: "2026-09-20",
});

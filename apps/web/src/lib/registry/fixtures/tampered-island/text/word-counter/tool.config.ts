import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

// Fixture: island.astro edited, which the contract fixes byte for byte.
export default defineTool({
  id: "word-counter",
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

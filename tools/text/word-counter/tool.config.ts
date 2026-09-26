import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "word-counter",
  name: "Word Counter",
  category: "text",
  summary:
    "Count words, characters, sentences, paragraphs and reading time in any text, live as you type or paste.",
  tags: ["words", "characters", "sentences", "reading-time", "text"],
  runtime: "client",
  status: "beta",
  input: z.object({ text: z.string() }),
  related: [],
  added: "2026-09-26",
  updated: "2026-09-26",
});

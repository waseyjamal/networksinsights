import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "diff-checker",
  name: "Text Diff Checker",
  category: "text",
  summary:
    "Compare two texts side by side and see added, removed and unchanged lines highlighted, with a line count, live as you type.",
  tags: ["diff", "compare", "text-comparison", "difference", "changes", "editor"],
  runtime: "client",
  status: "beta",
  input: z.object({ original: z.string(), modified: z.string() }),
  related: ["word-counter", "case-converter", "regex-tester"],
  added: "2026-09-29",
  updated: "2026-09-29",
});

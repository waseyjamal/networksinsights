import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "contrast-checker",
  name: "Contrast Checker",
  category: "color-design",
  summary:
    "Check the WCAG 2.2 contrast ratio between a text colour and a background colour, with pass or fail for AA and AAA, large text and UI components.",
  tags: ["contrast", "wcag", "accessibility", "color", "a11y", "checker"],
  runtime: "client",
  status: "beta",
  input: z.object({ foreground: z.string(), background: z.string() }),
  related: ["color-converter"],
  added: "2026-10-02",
  updated: "2026-10-02",
});

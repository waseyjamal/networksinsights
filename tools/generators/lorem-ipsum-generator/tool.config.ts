import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { UNITS } from "./logic";

export default defineTool({
  id: "lorem-ipsum-generator",
  name: "Filler Text Generator",
  category: "generators",
  summary:
    "Generate filler paragraphs, sentences or words from a Latin-style word list, optionally starting with the classic opening line.",
  tags: ["lorem-ipsum", "filler-text", "dummy-text", "placeholder", "design"],
  runtime: "client",
  status: "beta",
  input: z.object({
    unit: z.enum(UNITS),
    count: z.string(),
    classic: z.boolean(),
    seed: z.number().int(),
  }),
  related: ["password-generator", "uuid-generator", "word-counter"],
  added: "2026-10-03",
  updated: "2026-10-03",
});

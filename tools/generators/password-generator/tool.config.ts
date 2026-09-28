import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { MAX_LENGTH, MIN_LENGTH } from "./logic";

export default defineTool({
  id: "password-generator",
  name: "Password Generator",
  category: "generators",
  summary:
    "Generate strong random passwords from uppercase, lowercase, numbers and symbols, with a strength rating and one-click copy.",
  tags: ["password", "random", "secure", "generator", "strong-password"],
  runtime: "client",
  status: "beta",
  input: z.object({
    length: z.number().int().min(MIN_LENGTH).max(MAX_LENGTH),
    upper: z.boolean(),
    lower: z.boolean(),
    digits: z.boolean(),
    symbols: z.boolean(),
  }),
  related: ["word-counter"],
  added: "2026-09-28",
  updated: "2026-09-28",
});

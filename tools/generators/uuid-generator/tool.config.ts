import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "uuid-generator",
  name: "UUID Generator",
  category: "generators",
  summary:
    "Generate version 4 (random) or version 7 (time-ordered) UUIDs with your browser's secure random numbers, up to 1,000 at once, and copy them all.",
  tags: ["uuid", "guid", "v4", "v7", "random", "identifier", "generator"],
  runtime: "client",
  status: "beta",
  input: z.object({
    version: z.enum(["4", "7"]),
    count: z.string(),
    uppercase: z.boolean(),
    noHyphens: z.boolean(),
    braces: z.boolean(),
  }),
  related: ["password-generator", "hash-generator"],
  added: "2026-10-02",
  updated: "2026-10-02",
});

import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { STYLES, SYSTEMS } from "./logic";

export default defineTool({
  id: "number-to-words",
  name: "Number to Words",
  category: "converters",
  summary:
    "Write a number in English words in the Indian (lakh, crore) or international (million, billion) system, or as rupees and paise or dollars and cents.",
  tags: ["number", "words", "cheque", "lakh", "crore", "spell"],
  runtime: "client",
  status: "beta",
  input: z.object({ text: z.string(), system: z.enum(SYSTEMS), style: z.enum(STYLES) }),
  related: ["unit-converter", "case-converter", "gst-calculator"],
  added: "2026-10-03",
  updated: "2026-10-03",
});

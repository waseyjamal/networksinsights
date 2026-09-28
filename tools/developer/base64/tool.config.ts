import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { MAX_BYTES, MODES, VARIANTS } from "./logic";

export default defineTool({
  id: "base64",
  name: "Base64 Encoder / Decoder",
  category: "developer",
  summary:
    "Encode text or files to Base64 and decode Base64 back to text or a file, in standard or URL-safe Base64URL, right in your browser.",
  tags: ["base64", "encode", "decode", "base64url", "binary", "developer"],
  runtime: "client",
  status: "beta",
  input: z.object({ mode: z.enum(MODES), variant: z.enum(VARIANTS), text: z.string() }),
  limits: { maxInputBytes: MAX_BYTES, maxFiles: 1 },
  related: ["json-formatter", "password-generator"],
  added: "2026-09-29",
  updated: "2026-09-29",
});

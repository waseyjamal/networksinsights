import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { MAX_CHARS } from "./logic";

export default defineTool({
  id: "jwt-decoder",
  name: "JWT Decoder",
  category: "developer",
  summary:
    "Decode a JSON Web Token in your browser and read its header, payload and signature as JSON, with the expiry checked against your clock.",
  tags: ["jwt", "json-web-token", "decode", "header", "payload", "verify", "developer"],
  runtime: "client",
  status: "beta",
  input: z.object({ text: z.string() }),
  limits: { maxInputBytes: MAX_CHARS },
  related: ["json-formatter", "base64"],
  added: "2026-09-29",
  updated: "2026-09-29",
});

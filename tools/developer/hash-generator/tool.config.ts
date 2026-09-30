import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { MAX_BYTES } from "./logic";

export default defineTool({
  id: "hash-generator",
  name: "Hash Generator",
  category: "developer",
  summary:
    "Generate MD5, SHA-1, SHA-256 and SHA-512 hashes of any text or file, all four at once, in lowercase hex, right in your browser.",
  tags: ["hash", "md5", "sha1", "sha256", "sha512", "checksum", "developer"],
  runtime: "client",
  status: "beta",
  input: z.object({ text: z.string() }),
  limits: { maxInputBytes: MAX_BYTES, maxFiles: 1 },
  related: ["jwt-decoder", "base64", "password-generator"],
  added: "2026-09-30",
  updated: "2026-09-30",
});

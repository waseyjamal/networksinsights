import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "file-encrypt-decrypt",
  name: "File Encrypt and Decrypt",
  category: "developer",
  summary:
    "Lock any file with a password using AES-256-GCM in your browser, and unlock it again later with the same password.",
  tags: ["encryption", "aes", "password", "file", "privacy"],
  produces: ["NIENC"],
  runtime: "worker",
  status: "beta",
  input: z.object({ mode: z.enum(["encrypt", "decrypt"]) }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["hash-generator", "password-generator", "base64"],
  added: "2026-10-03",
  updated: "2026-10-03",
});
